//! Engine onboarding: install a backend-only container engine (Podman
//! machine, or the real Docker daemon in a new or existing WSL distro) and
//! connect the session to it. Installs stream phases/output into a channel
//! and are cancellable through the stream registry.

mod docker_wsl;
mod podman;
mod provision_service;

use std::sync::Arc;

use async_trait::async_trait;
pub use provision_service::ProvisionService;

use crate::error::AppResult;
use crate::models::dto::{InstallEventDto, InstallRequest};
use crate::services::infrastructure::IEventSink;

#[async_trait]
pub trait IProvisionService: Send + Sync {
    /// Spawn an install that reports into `sink` until completion, failure,
    /// or cancellation via `stop_stream(stream_id)`. Returns immediately.
    async fn install(
        &self,
        request: InstallRequest,
        stream_id: String,
        sink: Arc<dyn IEventSink<InstallEventDto>>,
    ) -> AppResult<()>;
}
