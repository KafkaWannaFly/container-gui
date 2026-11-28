use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use super::IContainerService;
use super::logs::LineSplitter;
use crate::error::{AppError, AppResult};
use crate::models::dto::{ContainerSummaryDto, LogEventDto, LogStreamOptions};
use crate::models::engine::{ContainerAction, ContainerQuery, ContainerRecord, LogQuery};
use crate::repositories::{IStreamRegistry, StreamTicket};
use crate::services::infrastructure::{IEventSink, IFileWriter};
use crate::services::session::IEngineSession;

const LABEL_COMPOSE_PROJECT: &str = "com.docker.compose.project";
const LABEL_COMPOSE_SERVICE: &str = "com.docker.compose.service";
const LABEL_COMPOSE_WORKING_DIR: &str = "com.docker.compose.project.working_dir";
const LABEL_COMPOSE_CONFIG_FILES: &str = "com.docker.compose.project.config_files";

const LOG_BATCH_INTERVAL: Duration = Duration::from_millis(50);
const LOG_BATCH_MAX: usize = 2_000;

#[derive(bon::Builder)]
pub struct ContainerService {
    session: Arc<dyn IEngineSession>,
    streams: Arc<dyn IStreamRegistry>,
    files: Arc<dyn IFileWriter>,
}

fn parse_action(value: &str) -> AppResult<ContainerAction> {
    match value {
        "start" => Ok(ContainerAction::Start),
        "stop" => Ok(ContainerAction::Stop),
        "restart" => Ok(ContainerAction::Restart),
        "kill" => Ok(ContainerAction::Kill),
        "pause" => Ok(ContainerAction::Pause),
        "unpause" => Ok(ContainerAction::Unpause),
        "remove" => Ok(ContainerAction::Remove),
        other => Err(AppError::Message(format!(
            "Unknown container action: {other}"
        ))),
    }
}

fn summary_of(container: ContainerRecord) -> ContainerSummaryDto {
    let labels = container.labels;
    ContainerSummaryDto {
        id: container.id,
        names: container.names,
        image: container.image,
        image_id: container.image_id,
        state: container.state,
        status: container.status,
        created: container.created,
        ports: container.ports,
        compose_project: labels.get(LABEL_COMPOSE_PROJECT).cloned(),
        compose_service: labels.get(LABEL_COMPOSE_SERVICE).cloned(),
        compose_working_dir: labels.get(LABEL_COMPOSE_WORKING_DIR).cloned(),
        compose_config_files: labels.get(LABEL_COMPOSE_CONFIG_FILES).cloned(),
    }
}

#[async_trait]
impl IContainerService for ContainerService {
    async fn list(&self, all: bool) -> AppResult<Vec<ContainerSummaryDto>> {
        let engine = self.session.engine().await?;
        let query = ContainerQuery::builder().all(all).build();
        let containers = engine.containers().list(&query).await?;
        Ok(containers.into_iter().map(summary_of).collect())
    }

    async fn inspect(&self, id: &str) -> AppResult<serde_json::Value> {
        self.session.engine().await?.containers().inspect(id).await
    }

    async fn action(&self, id: &str, action: &str) -> AppResult<()> {
        let engine = self.session.engine().await?;
        let action = parse_action(action)?;
        engine.containers().action(id, action).await
    }

    async fn stream_logs(
        &self,
        id: String,
        stream_id: String,
        options: LogStreamOptions,
        sink: Arc<dyn IEventSink<LogEventDto>>,
    ) -> AppResult<()> {
        let engine = self.session.engine().await?;
        let StreamTicket {
            token,
            mut cancelled,
        } = self.streams.register(stream_id.clone());
        let streams = self.streams.clone();

        tokio::spawn(async move {
            let tail = options
                .tail
                .map(|tail| tail.to_string())
                .unwrap_or_else(|| "all".to_string());
            let query = LogQuery {
                follow: options.follow,
                tail: tail.clone(),
                since: options.since.map(|since| since as i32),
                timestamps: true,
            };
            let mut stream = engine.containers().logs(&id, &query);
            log::info!("[logs] streaming container {id} (tail {tail})");

            let mut splitter = LineSplitter::default();
            let mut batch = Vec::new();
            let mut ticker = tokio::time::interval(LOG_BATCH_INTERVAL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut error = None;
            let mut open = true;

            loop {
                tokio::select! {
                    _ = &mut cancelled => {
                        open = false;
                        break;
                    }
                    _ = ticker.tick() => {
                        if !batch.is_empty()
                            && !sink.send(LogEventDto::Lines { lines: std::mem::take(&mut batch) })
                        {
                            open = false;
                            break;
                        }
                    }
                    item = stream.next() => match item {
                        Some(Ok(chunk)) => {
                            splitter.push(chunk.kind.as_str(), &String::from_utf8_lossy(&chunk.data), &mut batch);
                            if batch.len() >= LOG_BATCH_MAX
                                && !sink.send(LogEventDto::Lines { lines: std::mem::take(&mut batch) })
                            {
                                open = false;
                                break;
                            }
                        }
                        Some(Err(err)) => {
                            log::error!("[logs] stream for container {id} failed: {err}");
                            error = Some(err.detail());
                            break;
                        }
                        None => break,
                    },
                }
            }

            if open {
                splitter.flush(&mut batch);
                if !batch.is_empty() {
                    sink.send(LogEventDto::Lines { lines: batch });
                }
                sink.send(LogEventDto::End { error });
            }
            log::debug!("[logs] stream for container {id} ended");
            streams.finish(&stream_id, token);
        });
        Ok(())
    }

    /// Streams chunk by chunk so a large log never sits in memory.
    async fn save_logs(&self, id: &str, dest: &str) -> AppResult<String> {
        let engine = self.session.engine().await?;
        let path = Path::new(dest);
        let mut out = self.files.create(path).await.map_err(|err| {
            AppError::Message(format!("Could not create {}: {err}", path.display()))
        })?;
        let query = LogQuery {
            follow: false,
            tail: "all".to_string(),
            since: None,
            timestamps: true,
        };
        let mut stream = engine.containers().logs(id, &query);
        let io_err =
            |err: std::io::Error| AppError::Message(format!("Could not write log file: {err}"));
        // Same reassembly as the live view, so split long lines come out whole.
        let mut splitter = LineSplitter::default();
        let mut lines = Vec::new();
        let mut done = false;
        while !done {
            match stream.next().await.transpose()? {
                Some(chunk) => splitter.push(
                    chunk.kind.as_str(),
                    &String::from_utf8_lossy(&chunk.data),
                    &mut lines,
                ),
                None => {
                    splitter.flush(&mut lines);
                    done = true;
                }
            }
            for line in lines.drain(..) {
                let text = if line.ts.is_empty() {
                    format!("{}\n", line.text)
                } else {
                    format!("{} {}\n", line.ts, line.text)
                };
                out.write_all(text.as_bytes()).await.map_err(io_err)?;
            }
        }
        out.flush().await.map_err(io_err)?;
        Ok(path.display().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actions_parse_and_reject_unknown() {
        assert_eq!(parse_action("kill").unwrap(), ContainerAction::Kill);
        assert!(parse_action("explode").is_err());
    }

    #[test]
    fn summary_reads_compose_labels() {
        let record = ContainerRecord {
            id: "a".into(),
            labels: [(LABEL_COMPOSE_PROJECT.to_string(), "demo".to_string())].into(),
            ..Default::default()
        };
        let summary = summary_of(record);
        assert_eq!(summary.compose_project.as_deref(), Some("demo"));
        assert!(summary.compose_service.is_none());
    }
}
