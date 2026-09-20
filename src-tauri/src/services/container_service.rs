//! Container listing, inspection, lifecycle actions and log streams.

use bollard::Docker;
use bollard::container::LogOutput;
use bollard::models::ContainerSummaryStateEnum;
use bollard::query_parameters::{
    KillContainerOptionsBuilder, ListContainersOptionsBuilder, LogsOptionsBuilder,
    RemoveContainerOptionsBuilder, RestartContainerOptionsBuilder, StatsOptionsBuilder,
    StopContainerOptionsBuilder,
};
use futures_util::StreamExt;
use serde_json::Value;
use tauri::ipc::Channel;
use tokio::sync::oneshot;

use crate::docker::state::StreamRegistry;
use crate::error::{AppError, AppResult};
use crate::models::dto::{ContainerStatsDto, ContainerSummaryDto, LogChunkDto, PortMappingDto};

const LABEL_COMPOSE_PROJECT: &str = "com.docker.compose.project";
const LABEL_COMPOSE_SERVICE: &str = "com.docker.compose.service";

/// Server-side filter for the container list. Built with `bon` so the
/// command layer can grow optional filters without positional churn.
#[derive(Debug, Clone, bon::Builder)]
pub struct ContainerListFilter {
    pub all: bool,
    pub status: Option<String>,
}

pub async fn list_containers(
    client: &Docker,
    filter: &ContainerListFilter,
) -> AppResult<Vec<ContainerSummaryDto>> {
    let mut options = ListContainersOptionsBuilder::new().all(filter.all);

    if let Some(status) = filter.status.as_deref() {
        let filters =
            std::collections::HashMap::from([("status".to_string(), vec![status.to_string()])]);
        options = options.filters(&filters);
    }

    let containers = client.list_containers(Some(options.build())).await?;
    Ok(containers
        .into_iter()
        .map(|container| {
            let labels = container.labels.unwrap_or_default();
            ContainerSummaryDto {
                id: container.id.unwrap_or_default(),
                names: container
                    .names
                    .unwrap_or_default()
                    .into_iter()
                    .map(|name| name.trim_start_matches('/').to_string())
                    .collect(),
                image: container.image.unwrap_or_default(),
                state: container
                    .state
                    .map(|state| state.to_string())
                    .unwrap_or_default(),
                status: container.status.unwrap_or_default(),
                created: container.created.unwrap_or_default(),
                ports: container
                    .ports
                    .unwrap_or_default()
                    .into_iter()
                    .map(|port| PortMappingDto {
                        private_port: port.private_port,
                        public_port: port.public_port,
                        ip: port.ip,
                        typ: port.typ.map(|kind| kind.to_string()).unwrap_or_default(),
                    })
                    .collect(),
                compose_project: labels.get(LABEL_COMPOSE_PROJECT).cloned(),
                compose_service: labels.get(LABEL_COMPOSE_SERVICE).cloned(),
            }
        })
        .collect())
}

/// One-shot resource usage for every live container. The list endpoint
/// only returns the ids we need, so we re-list rather than trust the UI.
pub async fn list_container_stats(client: &Docker, all: bool) -> AppResult<Vec<ContainerStatsDto>> {
    let options = ListContainersOptionsBuilder::new().all(all).build();
    let containers = client.list_containers(Some(options)).await?;

    let mut stats = Vec::new();
    for container in containers {
        let live = matches!(
            container.state,
            Some(ContainerSummaryStateEnum::RUNNING) | Some(ContainerSummaryStateEnum::PAUSED)
        );
        let Some(id) = container.id else { continue };
        if !live {
            continue;
        }
        // A single unreachable container must not blank the whole column.
        if let Ok(stat) = container_stats(client, &id).await {
            stats.push(stat);
        }
    }
    Ok(stats)
}

async fn container_stats(client: &Docker, id: &str) -> AppResult<ContainerStatsDto> {
    let options = StatsOptionsBuilder::new()
        .stream(false)
        .one_shot(true)
        .build();
    let response = client
        .stats(id, Some(options))
        .next()
        .await
        .transpose()?
        .ok_or_else(|| AppError::Message(format!("No stats returned for container {id}")))?;

    let cpu = response.cpu_stats.as_ref();
    let prev = response.precpu_stats.as_ref();
    let cpu_total = cpu
        .and_then(|stats| stats.cpu_usage.as_ref())
        .and_then(|usage| usage.total_usage);
    let prev_total = prev
        .and_then(|stats| stats.cpu_usage.as_ref())
        .and_then(|usage| usage.total_usage);
    let system_total = cpu.and_then(|stats| stats.system_cpu_usage);
    let prev_system = prev.and_then(|stats| stats.system_cpu_usage);
    let online_cpus = cpu
        .and_then(|stats| stats.online_cpus)
        .or_else(|| prev.and_then(|stats| stats.online_cpus))
        .unwrap_or(1) as f64;

    let memory = response.memory_stats.as_ref();

    Ok(ContainerStatsDto {
        id: id.to_string(),
        cpu_percent: cpu_percent(
            cpu_total,
            prev_total,
            system_total,
            prev_system,
            online_cpus,
        ),
        memory_usage: resident_memory(
            memory.and_then(|stats| stats.usage).unwrap_or(0),
            memory.and_then(|stats| stats.stats.as_ref()),
        ),
        memory_limit: memory.and_then(|stats| stats.limit).unwrap_or(0) as i64,
    })
}

/// `docker stats` CPU formula: share of one core, scaled by core count.
fn cpu_percent(
    total: Option<u64>,
    prev_total: Option<u64>,
    system: Option<u64>,
    prev_system: Option<u64>,
    online_cpus: f64,
) -> f64 {
    match (total, prev_total, system, prev_system) {
        (Some(total), Some(prev_total), Some(system), Some(prev_system))
            if system > prev_system && total >= prev_total =>
        {
            ((total - prev_total) as f64 / (system - prev_system) as f64) * online_cpus * 100.0
        }
        _ => 0.0,
    }
}

/// Resident memory, excluding page cache. cgroup v2 reports
/// `inactive_file`, v1 reports `cache`.
fn resident_memory(usage: u64, stats: Option<&std::collections::HashMap<String, u64>>) -> i64 {
    let cache = stats
        .and_then(|stats| stats.get("inactive_file").or_else(|| stats.get("cache")))
        .copied()
        .unwrap_or(0);
    (usage as i64).saturating_sub(cache as i64).max(0)
}

/// Raw inspect payload, passed through as JSON so the UI can read any
/// engine-version-specific field.
pub async fn inspect_container(client: &Docker, id: &str) -> AppResult<Value> {
    let response = client.inspect_container(id, None).await?;
    Ok(serde_json::to_value(response)?)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Kill,
    Pause,
    Unpause,
    Remove,
}

impl ContainerAction {
    pub fn parse(value: &str) -> AppResult<Self> {
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
}

pub async fn execute_action(client: &Docker, id: &str, action: ContainerAction) -> AppResult<()> {
    match action {
        ContainerAction::Start => client.start_container(id, None).await?,
        ContainerAction::Stop => {
            client
                .stop_container(id, Some(StopContainerOptionsBuilder::new().t(10).build()))
                .await?
        }
        ContainerAction::Restart => {
            client
                .restart_container(
                    id,
                    Some(RestartContainerOptionsBuilder::new().t(10).build()),
                )
                .await?
        }
        ContainerAction::Kill => {
            client
                .kill_container(
                    id,
                    Some(KillContainerOptionsBuilder::new().signal("SIGKILL").build()),
                )
                .await?
        }
        ContainerAction::Pause => client.pause_container(id).await?,
        ContainerAction::Unpause => client.unpause_container(id).await?,
        ContainerAction::Remove => {
            client
                .remove_container(
                    id,
                    Some(RemoveContainerOptionsBuilder::new().force(true).build()),
                )
                .await?
        }
    }
    Ok(())
}

/// Spawn a follow-logs task that pushes chunks into `channel` until the
/// container stops, the stream errors, or the registry cancels it.
pub fn spawn_log_stream(
    client: Docker,
    registry: std::sync::Arc<StreamRegistry>,
    id: String,
    tail: u64,
    channel: Channel<LogChunkDto>,
) {
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    registry.register_logs(id.clone(), cancel_tx);

    tauri::async_runtime::spawn(async move {
        let options = LogsOptionsBuilder::new()
            .follow(true)
            .stdout(true)
            .stderr(true)
            .tail(&tail.to_string())
            .build();
        let mut stream = client.logs(&id, Some(options)).boxed();

        log::info!("[logs] streaming container {id} (tail {tail})");

        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                item = stream.next() => {
                    match item {
                        Some(Ok(output)) => {
                            let chunk = match output {
                                LogOutput::StdOut { message } => Some(("stdout", message)),
                                LogOutput::StdErr { message } => Some(("stderr", message)),
                                LogOutput::Console { message } => Some(("stdout", message)),
                                LogOutput::StdIn { .. } => None,
                            };
                            if let Some((stream, message)) = chunk {
                                let text = String::from_utf8_lossy(&message).to_string();
                                if channel
                                    .send(LogChunkDto { stream: stream.to_string(), message: text })
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                        Some(Err(err)) => {
                            log::error!("[logs] stream for container {id} failed: {err}");
                            break;
                        }
                        None => break,
                    }
                }
            }
        }

        log::debug!("[logs] stream for container {id} ended");
        registry.finish_logs(&id);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn cpu_percent_scales_by_online_cores() {
        // `system_cpu_usage` spans all cores, so a fully busy one-core
        // container on a one-core host moves both counters equally.
        assert_eq!(
            cpu_percent(Some(1_000), Some(0), Some(1_000), Some(0), 1.0),
            100.0
        );
        // Half a core.
        assert_eq!(
            cpu_percent(Some(500), Some(0), Some(1_000), Some(0), 1.0),
            50.0
        );
        // Both cores busy on a four-core host.
        assert_eq!(
            cpu_percent(Some(2_000), Some(0), Some(4_000), Some(0), 4.0),
            200.0
        );
    }

    #[test]
    fn cpu_percent_guards_bad_samples() {
        assert_eq!(cpu_percent(None, Some(0), Some(10), Some(0), 4.0), 0.0);
        assert_eq!(cpu_percent(Some(5), Some(0), Some(0), Some(0), 4.0), 0.0);
        assert_eq!(cpu_percent(Some(0), Some(5), Some(10), Some(0), 4.0), 0.0);
    }

    /// Live smoke test: skipped (passes) when no engine is reachable.
    #[tokio::test]
    async fn live_stats_smoke() {
        let target = crate::docker::connection::default_target();
        let Ok(client) = crate::docker::connection::connect(&target) else {
            return;
        };
        if client.ping().await.is_err() {
            return;
        }
        let stats = list_container_stats(&client, true).await;
        assert!(
            stats.is_ok(),
            "list_container_stats failed: {:?}",
            stats.err()
        );
        for stat in stats.unwrap() {
            assert!(
                stat.memory_limit > 0,
                "container {} reported a zero memory limit",
                stat.id
            );
            assert!(stat.cpu_percent >= 0.0);
        }
    }

    #[test]
    fn resident_memory_excludes_page_cache() {
        let v2 = HashMap::from([
            ("inactive_file".to_string(), 400),
            ("anon".to_string(), 600),
        ]);
        assert_eq!(resident_memory(1_000, Some(&v2)), 600);

        let v1 = HashMap::from([("cache".to_string(), 250)]);
        assert_eq!(resident_memory(1_000, Some(&v1)), 750);

        assert_eq!(resident_memory(1_000, None), 1_000);
        // Cache larger than usage must not go negative.
        assert_eq!(resident_memory(100, Some(&v1)), 0);
    }
}
