use std::collections::HashMap;

use async_trait::async_trait;
use bollard::models::Volume;
use bollard::query_parameters::{
    DataUsageOptionsBuilder, ListVolumesOptionsBuilder, PruneVolumesOptionsBuilder,
    RemoveVolumeOptionsBuilder,
};

use super::DockerEngine;
use crate::error::AppResult;
use crate::models::engine::VolumeRecord;
use crate::services::engine::IVolumeGateway;

#[async_trait]
impl IVolumeGateway for DockerEngine {
    async fn list(&self) -> AppResult<Vec<VolumeRecord>> {
        let options = ListVolumesOptionsBuilder::new().build();
        let response = self.client.list_volumes(Some(options)).await?;
        Ok(response
            .volumes
            .unwrap_or_default()
            .into_iter()
            .map(record_of)
            .collect())
    }

    async fn inspect(&self, name: &str) -> AppResult<VolumeRecord> {
        Ok(record_of(self.client.inspect_volume(name).await?))
    }

    /// Docker reports `-1` when a size isn't known; those are left out.
    async fn sizes(&self) -> AppResult<Vec<(String, i64)>> {
        let options = DataUsageOptionsBuilder::new().verbose(true).build();
        let sizes = self
            .client
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

    async fn remove(&self, name: &str, force: bool) -> AppResult<()> {
        let options = RemoveVolumeOptionsBuilder::new().force(force).build();
        self.client.remove_volume(name, Some(options)).await?;
        Ok(())
    }

    async fn prune(&self) -> AppResult<i64> {
        // Without `all=true` the daemon (API >= 1.42) only prunes anonymous volumes.
        let filters = HashMap::from([("all".to_string(), vec!["true".to_string()])]);
        let options = PruneVolumesOptionsBuilder::new().filters(&filters).build();
        let response = self.client.prune_volumes(Some(options)).await?;
        Ok(response.space_reclaimed.unwrap_or_default())
    }
}

fn record_of(volume: Volume) -> VolumeRecord {
    VolumeRecord {
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
    }
}
