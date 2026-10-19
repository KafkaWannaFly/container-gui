//! Engine-level info surfaced in the UI.

use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::dto::SystemInfoDto;
use crate::services::session::IEngineSession;

#[async_trait]
pub trait ISystemService: Send + Sync {
    async fn info(&self) -> AppResult<SystemInfoDto>;
}

#[derive(bon::Builder)]
pub struct SystemService {
    session: Arc<dyn IEngineSession>,
}

#[async_trait]
impl ISystemService for SystemService {
    async fn info(&self) -> AppResult<SystemInfoDto> {
        let engine = self.session.engine().await?;
        let system = engine.system();
        let started = Instant::now();
        system.ping().await?;
        let ping_ms = started.elapsed().as_millis() as u64;
        let version = system.version().await?;
        let info = system.info().await?;

        Ok(SystemInfoDto {
            docker_version: version.version.unwrap_or_default(),
            api_version: version.api_version.unwrap_or_default(),
            os: info.operating_system.or(version.os).unwrap_or_default(),
            arch: info.architecture.or(version.arch).unwrap_or_default(),
            kernel_version: version
                .kernel_version
                .or(info.kernel_version)
                .unwrap_or_default(),
            containers_running: info.containers_running.unwrap_or_default(),
            containers_paused: info.containers_paused.unwrap_or_default(),
            containers_stopped: info.containers_stopped.unwrap_or_default(),
            containers_total: info.containers.unwrap_or_default(),
            images_total: info.images.unwrap_or_default(),
            cpus: info.ncpu.unwrap_or_default(),
            memory_total: info.mem_total.unwrap_or_default(),
            ping_ms,
        })
    }
}
