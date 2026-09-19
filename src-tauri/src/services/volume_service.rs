//! Volume listing, removal and pruning. In-use detection comes from the
//! daemon's own `UsageData.refCount`, which is reliable even for volumes
//! mounted by containers outside this UI.

use bollard::Docker;
use bollard::query_parameters::{
    ListVolumesOptionsBuilder, PruneVolumesOptionsBuilder, RemoveVolumeOptionsBuilder,
};

use crate::error::AppResult;
use crate::models::dto::VolumeItemDto;

pub async fn list_volumes(client: &Docker) -> AppResult<Vec<VolumeItemDto>> {
    let options = ListVolumesOptionsBuilder::new().build();
    let response = client.list_volumes(Some(options)).await?;

    Ok(response
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|volume| {
            let usage = volume.usage_data.unwrap_or_default();
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
    let options = PruneVolumesOptionsBuilder::new().build();
    let response = client.prune_volumes(Some(options)).await?;
    Ok(response.space_reclaimed.unwrap_or_default())
}
