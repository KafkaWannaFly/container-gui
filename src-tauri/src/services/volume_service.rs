//! Volume listing, removal and pruning. In-use detection counts the containers
//! (including stopped ones) that mount each named volume, matching the daemon's
//! refCount. Sizes come from a cache, because Docker's disk-usage walk is slow.

use std::collections::{HashMap, HashSet};

use bollard::Docker;
use bollard::models::ContainerSummary;
use bollard::query_parameters::{
    DataUsageOptionsBuilder, ListContainersOptionsBuilder, ListVolumesOptionsBuilder,
    PruneVolumesOptionsBuilder, RemoveVolumeOptionsBuilder,
};

use crate::docker::volume_cache::CachedSize;
use crate::error::AppResult;
use crate::models::dto::{VolumeContainerDto, VolumeDetailDto, VolumeItemDto, VolumeMountDto};

pub async fn volume_detail(client: &Docker, name: &str) -> AppResult<VolumeDetailDto> {
    let filters = HashMap::from([("volume".to_string(), vec![name.to_string()])]);
    let options = ListContainersOptionsBuilder::new()
        .all(true)
        .filters(&filters)
        .build();
    let (volume, containers) = tokio::try_join!(
        client.inspect_volume(name),
        client.list_containers(Some(options)),
    )?;
    Ok(VolumeDetailDto {
        containers: volume_containers(containers, &volume.name),
        name: volume.name,
        driver: volume.driver,
        mountpoint: volume.mountpoint,
        created_at: volume
            .created_at
            .map(|created| created.to_rfc3339())
            .unwrap_or_default(),
        scope: volume
            .scope
            .map(|scope| scope.to_string())
            .unwrap_or_default(),
        labels: volume.labels,
        options: volume.options,
    })
}

fn volume_containers(containers: Vec<ContainerSummary>, name: &str) -> Vec<VolumeContainerDto> {
    containers
        .into_iter()
        .filter_map(|container| {
            // Docker's volume filter also matches mount paths; match the actual named volume.
            let mounts: Vec<_> = container
                .mounts
                .unwrap_or_default()
                .into_iter()
                .filter(|mount| {
                    mount.name.as_deref() == Some(name)
                        && mount.typ.as_ref().is_some_and(|typ| typ == "volume")
                })
                .map(|mount| VolumeMountDto {
                    destination: mount.destination.unwrap_or_default(),
                    read_only: mount.rw.map(|rw| !rw),
                })
                .collect();
            if mounts.is_empty() {
                return None;
            }
            let id = container.id.unwrap_or_default();
            Some(VolumeContainerDto {
                name: container
                    .names
                    .unwrap_or_default()
                    .first()
                    .map(|name| name.trim_start_matches('/').to_string())
                    .unwrap_or_else(|| id.chars().take(12).collect()),
                id,
                image: container.image.unwrap_or_default(),
                state: container
                    .state
                    .map(|state| state.to_string())
                    .unwrap_or_default(),
                status: container.status.unwrap_or_default(),
                mounts,
            })
        })
        .collect()
}

/// Fast list: no disk-usage walk. Sizes come from `cached`, and are `None`
/// for volumes that have never been measured.
pub async fn list_volumes(
    client: &Docker,
    cached: &HashMap<String, CachedSize>,
) -> AppResult<Vec<VolumeItemDto>> {
    let volumes_options = ListVolumesOptionsBuilder::new().build();
    let containers_options = ListContainersOptionsBuilder::new().all(true).build();
    let (response, containers) = tokio::try_join!(
        client.list_volumes(Some(volumes_options)),
        client.list_containers(Some(containers_options)),
    )?;
    let ref_counts = volume_ref_counts(&containers);

    Ok(response
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|volume| {
            let ref_count = ref_counts.get(&volume.name).copied().unwrap_or(0);
            let measured = cached.get(&volume.name);
            VolumeItemDto {
                size_bytes: measured.map(|size| size.size_bytes),
                size_measured_at: measured.map(|size| size.measured_at),
                name: volume.name,
                driver: volume.driver,
                mountpoint: volume.mountpoint,
                created_at: volume
                    .created_at
                    .map(|created| created.to_rfc3339())
                    .unwrap_or_default(),
                in_use: ref_count > 0,
                ref_count,
            }
        })
        .collect())
}

/// Number of containers mounting each named volume. A container that mounts
/// the same volume twice counts once.
fn volume_ref_counts(containers: &[ContainerSummary]) -> HashMap<String, i64> {
    let mut counts = HashMap::new();
    for container in containers {
        let names: HashSet<&str> = container
            .mounts
            .iter()
            .flatten()
            .filter(|mount| mount.typ.as_ref().is_some_and(|typ| typ == "volume"))
            .filter_map(|mount| mount.name.as_deref())
            .collect();
        for name in names {
            *counts.entry(name.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

/// Slow: asks the daemon to walk every volume's disk usage. Returns only the
/// volumes whose size is known (Docker reports `-1` when it isn't).
pub async fn measure_volume_sizes(client: &Docker) -> AppResult<Vec<(String, i64)>> {
    let options = DataUsageOptionsBuilder::new().verbose(true).build();
    let sizes = client
        .df(Some(options))
        .await?
        .volume_usage
        .and_then(|usage| usage.items)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let name = item.get("Name")?.as_str()?.to_string();
            let size = item.get("UsageData")?.get("Size")?.as_i64()?;
            (size >= 0).then_some((name, size))
        })
        .collect();
    Ok(sizes)
}

pub async fn remove_volume(client: &Docker, name: &str, force: bool) -> AppResult<()> {
    let options = RemoveVolumeOptionsBuilder::new().force(force).build();
    client.remove_volume(name, Some(options)).await?;
    Ok(())
}

pub async fn prune_volumes(client: &Docker) -> AppResult<i64> {
    // Without `all=true` the daemon (API >= 1.42) only prunes anonymous volumes.
    let filters = std::collections::HashMap::from([("all".to_string(), vec!["true".to_string()])]);
    let options = PruneVolumesOptionsBuilder::new().filters(&filters).build();
    let response = client.prune_volumes(Some(options)).await?;
    Ok(response.space_reclaimed.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matches_exact_named_volumes_and_preserves_mount_access() {
        let containers = serde_json::from_value(json!([
            {
                "Id": "running-id", "Names": ["/database"], "State": "running",
                "Mounts": [
                    {"Type": "volume", "Name": "data", "Destination": "/data", "RW": true},
                    {"Type": "volume", "Name": "data", "Destination": "/backup", "RW": false},
                    {"Type": "volume", "Name": "data-other", "Destination": "/other", "RW": true}
                ]
            },
            {
                "Id": "stopped-id", "Names": ["/stopped"], "State": "exited",
                "Mounts": [{"Type": "volume", "Name": "data", "Destination": "/data"}]
            },
            {
                "Id": "other-id",
                "Mounts": [
                    {"Type": "volume", "Name": "data-other", "Destination": "/data"},
                    {"Type": "bind", "Name": "data", "Destination": "/bind"}
                ]
            },
            {"Id": "no-mounts"}
        ]))
        .unwrap();
        let rows = volume_containers(containers, "data");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "database");
        assert_eq!(rows[0].mounts.len(), 2);
        assert_eq!(rows[0].mounts[0].destination, "/data");
        assert_eq!(rows[0].mounts[0].read_only, Some(false));
        assert_eq!(rows[0].mounts[1].read_only, Some(true));
        assert_eq!(rows[1].state, "exited");
        assert_eq!(rows[1].mounts[0].read_only, None);
    }

    #[test]
    fn unnamed_container_uses_short_id() {
        let containers = serde_json::from_value(json!([{
            "Id": "1234567890123456",
            "Mounts": [{"Type": "volume", "Name": "data", "Destination": "/data", "RW": true}]
        }]))
        .unwrap();
        let rows = volume_containers(containers, "data");
        assert_eq!(rows[0].name, "123456789012");
    }
}
