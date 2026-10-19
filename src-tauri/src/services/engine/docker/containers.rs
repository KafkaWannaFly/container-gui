use std::collections::HashMap;

use async_trait::async_trait;
use bollard::models::{ChangeType, ContainerStatsResponse, ContainerSummary};
use bollard::query_parameters::{
    DownloadFromContainerOptionsBuilder, KillContainerOptionsBuilder, ListContainersOptionsBuilder,
    LogsOptionsBuilder, RemoveContainerOptionsBuilder, RestartContainerOptionsBuilder,
    StatsOptionsBuilder, StopContainerOptionsBuilder,
};
use futures_util::StreamExt;

use super::{DockerEngine, output_stream};
use crate::error::AppResult;
use crate::models::dto::{FsChangeDto, PortMappingDto};
use crate::models::engine::{
    ContainerAction, ContainerQuery, ContainerRecord, LogQuery, MountRecord, StatsReading,
};
use crate::services::engine::{ByteStream, IContainerGateway, OutputStream};

#[async_trait]
impl IContainerGateway for DockerEngine {
    async fn list(&self, query: &ContainerQuery) -> AppResult<Vec<ContainerRecord>> {
        let mut filters = HashMap::new();
        if let Some(status) = &query.status {
            filters.insert("status".to_string(), vec![status.clone()]);
        }
        if let Some(volume) = &query.volume {
            filters.insert("volume".to_string(), vec![volume.clone()]);
        }
        let mut options = ListContainersOptionsBuilder::new().all(query.all);
        if !filters.is_empty() {
            options = options.filters(&filters);
        }
        let containers = self.client.list_containers(Some(options.build())).await?;
        Ok(containers.into_iter().map(record_of).collect())
    }

    async fn inspect(&self, id: &str) -> AppResult<serde_json::Value> {
        let response = self.client.inspect_container(id, None).await?;
        Ok(serde_json::to_value(response)?)
    }

    async fn action(&self, id: &str, action: ContainerAction) -> AppResult<()> {
        let client = &self.client;
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

    fn logs(&self, id: &str, query: &LogQuery) -> OutputStream {
        let mut builder = LogsOptionsBuilder::new()
            .follow(query.follow)
            .stdout(true)
            .stderr(true)
            .timestamps(query.timestamps)
            .tail(&query.tail);
        if let Some(since) = query.since {
            builder = builder.since(since);
        }
        output_stream(self.client.logs(id, Some(builder.build())))
    }

    async fn stats_once(&self, id: &str) -> AppResult<Option<StatsReading>> {
        let options = StatsOptionsBuilder::new()
            .stream(false)
            .one_shot(true)
            .build();
        match self.client.stats(id, Some(options)).next().await {
            Some(Ok(response)) => Ok(Some(reading_of(&response))),
            Some(Err(err)) => Err(err.into()),
            None => Ok(None),
        }
    }

    async fn changes(&self, id: &str) -> AppResult<Vec<FsChangeDto>> {
        let changes = self.client.container_changes(id).await?.unwrap_or_default();
        Ok(changes
            .into_iter()
            .map(|change| FsChangeDto {
                path: change.path,
                kind: match change.kind {
                    ChangeType::_0 => "C",
                    ChangeType::_1 => "A",
                    ChangeType::_2 => "D",
                }
                .to_string(),
            })
            .collect())
    }

    fn archive(&self, id: &str, path: &str) -> ByteStream {
        let options = DownloadFromContainerOptionsBuilder::new()
            .path(path)
            .build();
        self.client
            .download_from_container(id, Some(options))
            .map(|chunk| chunk.map_err(std::io::Error::other))
            .boxed()
    }
}

fn record_of(container: ContainerSummary) -> ContainerRecord {
    ContainerRecord {
        id: container.id.unwrap_or_default(),
        names: container
            .names
            .unwrap_or_default()
            .into_iter()
            .map(|name| name.trim_start_matches('/').to_string())
            .collect(),
        image: container.image.unwrap_or_default(),
        image_id: container.image_id.unwrap_or_default(),
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
        labels: container.labels.unwrap_or_default(),
        mounts: container
            .mounts
            .unwrap_or_default()
            .into_iter()
            .map(|mount| MountRecord {
                kind: mount.typ.map(|typ| typ.to_string()),
                name: mount.name,
                destination: mount.destination,
                rw: mount.rw,
            })
            .collect(),
    }
}

fn reading_of(response: &ContainerStatsResponse) -> StatsReading {
    let cpu = response.cpu_stats.as_ref();
    let memory = response.memory_stats.as_ref();
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
    StatsReading {
        read_ms: response
            .read
            .map(|read| read.timestamp_millis())
            .filter(|ms| *ms > 0),
        cpu_total: cpu
            .and_then(|stats| stats.cpu_usage.as_ref())
            .and_then(|usage| usage.total_usage),
        system_total: cpu.and_then(|stats| stats.system_cpu_usage),
        online_cpus: cpu.and_then(|stats| stats.online_cpus).unwrap_or(1),
        memory_usage: resident_memory(
            memory.and_then(|stats| stats.usage).unwrap_or(0),
            memory.and_then(|stats| stats.stats.as_ref()),
        ),
        memory_limit: memory.and_then(|stats| stats.limit).unwrap_or(0) as i64,
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

/// Resident memory, excluding page cache. cgroup v2 reports
/// `inactive_file`, v1 reports `cache`.
fn resident_memory(usage: u64, stats: Option<&HashMap<String, u64>>) -> i64 {
    let cache = stats
        .and_then(|stats| stats.get("inactive_file").or_else(|| stats.get("cache")))
        .copied()
        .unwrap_or(0);
    (usage as i64).saturating_sub(cache as i64).max(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resident_memory_excludes_page_cache() {
        let v2 = HashMap::from([("inactive_file".to_string(), 400)]);
        assert_eq!(resident_memory(1_000, Some(&v2)), 600);
        let v1 = HashMap::from([("cache".to_string(), 250)]);
        assert_eq!(resident_memory(1_000, Some(&v1)), 750);
        assert_eq!(resident_memory(1_000, None), 1_000);
        assert_eq!(resident_memory(100, Some(&v1)), 0);
    }

    #[test]
    fn maps_summary_names_state_and_mounts() {
        let summary: ContainerSummary = serde_json::from_value(json!({
            "Id": "abc", "Names": ["/web"], "State": "running",
            "Labels": {"com.docker.compose.project": "demo"},
            "Mounts": [{"Type": "volume", "Name": "data", "Destination": "/data", "RW": false}]
        }))
        .unwrap();
        let record = record_of(summary);
        assert_eq!(record.names, vec!["web"]);
        assert_eq!(record.state, "running");
        assert_eq!(record.labels["com.docker.compose.project"], "demo");
        assert_eq!(record.mounts[0].kind.as_deref(), Some("volume"));
        assert_eq!(record.mounts[0].rw, Some(false));
    }
}
