use async_trait::async_trait;

use super::DockerEngine;
use crate::error::{AppError, AppResult};
use crate::models::engine::{EngineInfo, EngineVersion};
use crate::services::engine::ISystemGateway;

#[async_trait]
impl ISystemGateway for DockerEngine {
    async fn ping(&self) -> AppResult<()> {
        self.client
            .ping()
            .await
            .map_err(|err| AppError::from_bollard(err, &self.endpoint))?;
        Ok(())
    }

    async fn version(&self) -> AppResult<EngineVersion> {
        let version = self
            .client
            .version()
            .await
            .map_err(|err| AppError::from_bollard(err, &self.endpoint))?;
        Ok(EngineVersion {
            version: version.version,
            api_version: version.api_version,
            os: version.os,
            arch: version.arch,
            kernel_version: version.kernel_version,
        })
    }

    async fn info(&self) -> AppResult<EngineInfo> {
        let info = self.client.info().await?;
        Ok(EngineInfo {
            os_type: info.os_type,
            operating_system: info.operating_system,
            architecture: info.architecture,
            kernel_version: info.kernel_version,
            containers: info.containers,
            containers_running: info.containers_running,
            containers_paused: info.containers_paused,
            containers_stopped: info.containers_stopped,
            images: info.images,
            ncpu: info.ncpu,
            mem_total: info.mem_total,
        })
    }
}
