//! Volume listing, removal and pruning. In-use detection comes from the
//! daemon's own `UsageData.refCount`, which is reliable even for volumes
//! mounted by containers outside this UI.

use std::collections::HashMap;

use bollard::Docker;
use bollard::models::{ContainerSummary, VolumeUsageData};
use bollard::query_parameters::{
    DataUsageOptionsBuilder, ListContainersOptionsBuilder, ListVolumesOptionsBuilder,
    PruneVolumesOptionsBuilder, RemoveVolumeOptionsBuilder,
};

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

pub async fn list_volumes(client: &Docker) -> AppResult<Vec<VolumeItemDto>> {
    let options = ListVolumesOptionsBuilder::new().build();
    let response = client.list_volumes(Some(options)).await?;

    // `GET /volumes` never includes `UsageData`; only the disk-usage endpoint does.
    let usage_options = DataUsageOptionsBuilder::new().verbose(true).build();
    let mut usage_by_name: HashMap<String, VolumeUsageData> = client
        .df(Some(usage_options))
        .await?
        .volume_usage
        .and_then(|usage| usage.items)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let name = item.get("Name")?.as_str()?.to_string();
            let usage = serde_json::from_value(item.get("UsageData")?.clone()).ok()?;
            Some((name, usage))
        })
        .collect();

    Ok(response
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|volume| {
            let usage = usage_by_name
                .remove(&volume.name)
                .or(volume.usage_data)
                .unwrap_or_default();
            let ref_count = usage.ref_count.max(0);
            VolumeItemDto {
                name: volume.name,
                driver: volume.driver,
                mountpoint: volume.mountpoint,
                created_at: volume
                    .created_at
                    .map(|created| created.to_rfc3339())
                    .unwrap_or_default(),
                size_bytes: usage.size.max(0),
                in_use: ref_count > 0,
                ref_count,
            }
        })
        .collect())
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
