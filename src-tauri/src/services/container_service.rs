//! Container listing, inspection, lifecycle actions and log streams.

use bollard::Docker;
use bollard::container::LogOutput;
use bollard::models::{ContainerStatsResponse, ContainerSummaryStateEnum};
use bollard::query_parameters::{
    KillContainerOptionsBuilder, ListContainersOptionsBuilder, LogsOptionsBuilder,
    RemoveContainerOptionsBuilder, RestartContainerOptionsBuilder, StatsOptionsBuilder,
    StopContainerOptionsBuilder,
};
use futures_util::StreamExt;
use serde_json::Value;
use std::time::Duration;
use tauri::ipc::Channel;

use crate::docker::state::{StreamRegistry, StreamTicket};
use crate::error::{AppError, AppResult};
use crate::models::dto::{
    ContainerLiveStatsDto, ContainerStatsDto, ContainerSummaryDto, LogEventDto, LogLineDto,
    LogStreamOptions, PortMappingDto,
};

const LABEL_COMPOSE_PROJECT: &str = "com.docker.compose.project";
const LABEL_COMPOSE_SERVICE: &str = "com.docker.compose.service";
const LABEL_COMPOSE_WORKING_DIR: &str = "com.docker.compose.project.working_dir";
const LABEL_COMPOSE_CONFIG_FILES: &str = "com.docker.compose.project.config_files";

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
                compose_working_dir: labels.get(LABEL_COMPOSE_WORKING_DIR).cloned(),
                compose_config_files: labels.get(LABEL_COMPOSE_CONFIG_FILES).cloned(),
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

    let usage = usage_of(&response);
    Ok(ContainerStatsDto {
        id: id.to_string(),
        cpu_percent: usage.cpu_percent,
        memory_usage: usage.memory_usage,
        memory_limit: usage.memory_limit,
    })
}

struct Usage {
    cpu_percent: f64,
    online_cpus: u32,
    memory_usage: i64,
    memory_limit: i64,
}

fn usage_of(response: &ContainerStatsResponse) -> Usage {
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
        .unwrap_or(1);

    let memory = response.memory_stats.as_ref();

    Usage {
        cpu_percent: cpu_percent(
            cpu_total,
            prev_total,
            system_total,
            prev_system,
            online_cpus as f64,
        ),
        online_cpus,
        memory_usage: resident_memory(
            memory.and_then(|stats| stats.usage).unwrap_or(0),
            memory.and_then(|stats| stats.stats.as_ref()),
        ),
        memory_limit: memory.and_then(|stats| stats.limit).unwrap_or(0) as i64,
    }
}

/// Full sample for the detail header: usage plus cumulative network and
/// block I/O, summed across interfaces and devices.
fn live_stats_of(response: &ContainerStatsResponse) -> ContainerLiveStatsDto {
    let usage = usage_of(response);
    let (net_rx, net_tx) = response
        .networks
        .iter()
        .flat_map(|networks| networks.values())
        .fold((0, 0), |(rx, tx), net| {
            (
                rx + net.rx_bytes.unwrap_or(0),
                tx + net.tx_bytes.unwrap_or(0),
            )
        });
    let (block_read, block_write) = response
        .blkio_stats
        .as_ref()
        .and_then(|blkio| blkio.io_service_bytes_recursive.as_ref())
        .into_iter()
        .flatten()
        .fold((0, 0), |(read, write), entry| {
            let value = entry.value.unwrap_or(0);
            match entry.op.as_deref() {
                Some(op) if op.eq_ignore_ascii_case("read") => (read + value, write),
                Some(op) if op.eq_ignore_ascii_case("write") => (read, write + value),
                _ => (read, write),
            }
        });
    ContainerLiveStatsDto {
        cpu_percent: usage.cpu_percent,
        online_cpus: usage.online_cpus,
        memory_usage: usage.memory_usage,
        memory_limit: usage.memory_limit,
        net_rx,
        net_tx,
        block_read,
        block_write,
        pids: response
            .pids_stats
            .as_ref()
            .and_then(|pids| pids.current)
            .unwrap_or(0),
    }
}

/// Stream stats samples (about one per second) for one container until
/// it stops, the channel closes, or the registry cancels `stream_id`.
pub fn spawn_stats_stream(
    client: Docker,
    registry: std::sync::Arc<StreamRegistry>,
    id: String,
    stream_id: String,
    channel: Channel<ContainerLiveStatsDto>,
) {
    let StreamTicket {
        token,
        mut cancelled,
    } = registry.register(stream_id.clone());

    tauri::async_runtime::spawn(async move {
        let options = StatsOptionsBuilder::new().stream(true).build();
        let mut stream = client.stats(&id, Some(options)).boxed();
        loop {
            tokio::select! {
                _ = &mut cancelled => break,
                item = stream.next() => match item {
                    Some(Ok(response)) => {
                        if channel.send(live_stats_of(&response)).is_err() {
                            break;
                        }
                    }
                    Some(Err(err)) => {
                        log::warn!("[stats] stream for container {id} failed: {err}");
                        break;
                    }
                    None => break,
                },
            }
        }
        registry.finish(&stream_id, token);
    });
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

const LOG_BATCH_INTERVAL: Duration = Duration::from_millis(50);
const LOG_BATCH_MAX: usize = 2_000;

/// Reassembles whole lines from Docker's chunked output. Chunks are not
/// line-aligned, so each stream keeps its unterminated tail until the next
/// chunk (or the end of the stream) completes it.
#[derive(Default)]
struct LineSplitter {
    stdout: String,
    stderr: String,
}

impl LineSplitter {
    fn push(&mut self, stream: &'static str, text: &str, out: &mut Vec<LogLineDto>) {
        let buf = if stream == "stderr" {
            &mut self.stderr
        } else {
            &mut self.stdout
        };
        // Docker splits entries over 16 KiB and stamps every piece; drop the
        // repeated stamp so the rejoined line (often JSON) stays intact.
        let text = match text.split_once(' ') {
            Some((head, rest)) if !buf.is_empty() && looks_like_timestamp(head) => rest,
            _ => text,
        };
        buf.push_str(text);
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            out.push(parse_log_line(stream, &line));
        }
    }

    fn flush(&mut self, out: &mut Vec<LogLineDto>) {
        for (stream, buf) in [("stdout", &mut self.stdout), ("stderr", &mut self.stderr)] {
            if !buf.is_empty() {
                out.push(parse_log_line(stream, buf));
                buf.clear();
            }
        }
    }
}

/// Split Docker's `timestamps=true` prefix (`2026-09-23T08:12:03.123456789Z `)
/// from the message.
fn parse_log_line(stream: &str, line: &str) -> LogLineDto {
    let line = line.trim_end_matches(['\n', '\r']);
    let (ts, text) = match line.split_once(' ') {
        Some((head, rest)) if looks_like_timestamp(head) => (head, rest),
        _ if looks_like_timestamp(line) => (line, ""),
        _ => ("", line),
    };
    LogLineDto {
        stream: stream.to_string(),
        ts: ts.to_string(),
        text: text.to_string(),
    }
}

fn looks_like_timestamp(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() >= 20
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[..4].iter().all(u8::is_ascii_digit)
}

/// Dump the whole log to `path`, streaming chunk by chunk so a large log
/// never sits in memory.
pub async fn write_logs(client: &Docker, id: &str, path: &std::path::Path) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;

    let file = tokio::fs::File::create(path)
        .await
        .map_err(|err| AppError::Message(format!("Could not create {}: {err}", path.display())))?;
    let mut out = tokio::io::BufWriter::new(file);
    let options = LogsOptionsBuilder::new()
        .follow(false)
        .stdout(true)
        .stderr(true)
        .timestamps(true)
        .tail("all")
        .build();
    let mut stream = client.logs(id, Some(options)).boxed();
    let io_err =
        |err: std::io::Error| AppError::Message(format!("Could not write log file: {err}"));
    // Same reassembly as the live view, so split long lines come out whole.
    let mut splitter = LineSplitter::default();
    let mut lines = Vec::new();
    let mut done = false;
    while !done {
        match stream.next().await.transpose()? {
            Some(LogOutput::StdErr { message }) => {
                splitter.push("stderr", &String::from_utf8_lossy(&message), &mut lines)
            }
            Some(LogOutput::StdOut { message } | LogOutput::Console { message }) => {
                splitter.push("stdout", &String::from_utf8_lossy(&message), &mut lines)
            }
            Some(LogOutput::StdIn { .. }) => continue,
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
    Ok(())
}

/// Spawn a logs task that sends line batches into `channel` until the
/// container stops, the stream errors, or the registry cancels `stream_id`.
/// Always finishes with one `End` event.
pub fn spawn_log_stream(
    client: Docker,
    registry: std::sync::Arc<StreamRegistry>,
    id: String,
    stream_id: String,
    options: LogStreamOptions,
    channel: Channel<LogEventDto>,
) {
    let StreamTicket {
        token,
        mut cancelled,
    } = registry.register(stream_id.clone());

    tauri::async_runtime::spawn(async move {
        let tail = options
            .tail
            .map(|tail| tail.to_string())
            .unwrap_or_else(|| "all".to_string());
        let mut builder = LogsOptionsBuilder::new()
            .follow(options.follow)
            .stdout(true)
            .stderr(true)
            .timestamps(true)
            .tail(&tail);
        if let Some(since) = options.since {
            builder = builder.since(since as i32);
        }
        let mut stream = client.logs(&id, Some(builder.build())).boxed();
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
                        && channel.send(LogEventDto::Lines { lines: std::mem::take(&mut batch) }).is_err()
                    {
                        open = false;
                        break;
                    }
                }
                item = stream.next() => match item {
                    Some(Ok(output)) => {
                        let (name, message) = match output {
                            LogOutput::StdErr { message } => ("stderr", message),
                            LogOutput::StdOut { message } | LogOutput::Console { message } => {
                                ("stdout", message)
                            }
                            LogOutput::StdIn { .. } => continue,
                        };
                        splitter.push(name, &String::from_utf8_lossy(&message), &mut batch);
                        if batch.len() >= LOG_BATCH_MAX
                            && channel.send(LogEventDto::Lines { lines: std::mem::take(&mut batch) }).is_err()
                        {
                            open = false;
                            break;
                        }
                    }
                    Some(Err(err)) => {
                        log::error!("[logs] stream for container {id} failed: {err}");
                        error = Some(err.to_string());
                        break;
                    }
                    None => break,
                },
            }
        }

        if open {
            splitter.flush(&mut batch);
            if !batch.is_empty() {
                let _ = channel.send(LogEventDto::Lines { lines: batch });
            }
            let _ = channel.send(LogEventDto::End { error });
        }
        log::debug!("[logs] stream for container {id} ended");
        registry.finish(&stream_id, token);
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
    fn splitter_joins_partial_chunks_per_stream() {
        let mut splitter = LineSplitter::default();
        let mut out = Vec::new();
        splitter.push("stdout", "2026-09-23T08:00:00.1Z hel", &mut out);
        splitter.push("stderr", "2026-09-23T08:00:00.2Z oops\n", &mut out);
        splitter.push(
            "stdout",
            "lo\r\n2026-09-23T08:00:00.3Z second\n2026-09-23T08:00:00.4Z tail",
            &mut out,
        );
        assert_eq!(
            out.iter()
                .map(|l| (l.stream.as_str(), l.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("stderr", "oops"),
                ("stdout", "hello"),
                ("stdout", "second")
            ]
        );
        assert_eq!(out[1].ts, "2026-09-23T08:00:00.1Z");
        splitter.flush(&mut out);
        assert_eq!(out[3].text, "tail");
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn splitter_drops_stamps_on_split_long_lines() {
        let mut splitter = LineSplitter::default();
        let mut out = Vec::new();
        splitter.push("stdout", "2026-09-23T08:00:00.1Z {\"a\":\"xx", &mut out);
        splitter.push("stdout", "2026-09-23T08:00:00.1Z yy\"}\n", &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "{\"a\":\"xxyy\"}");
    }

    #[test]
    fn log_line_without_timestamp_keeps_text() {
        let line = parse_log_line("stdout", "plain message here\n");
        assert_eq!(line.ts, "");
        assert_eq!(line.text, "plain message here");
        let empty = parse_log_line("stdout", "2026-09-23T08:00:00.123456789Z\n");
        assert_eq!(empty.ts, "2026-09-23T08:00:00.123456789Z");
        assert_eq!(empty.text, "");
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
