//! Engine session: the active engine client, connection metadata, and a
//! generation counter that background workers watch for endpoint switches.

mod service;

use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
pub use service::EngineSession;
use tokio::sync::watch;

use crate::error::{AppError, AppResult};
use crate::models::dto::{ConnectionConfig, ConnectionState, DockerStatusDto};
use crate::services::engine::IEngine;

const PING_TIMEOUT: Duration = Duration::from_secs(5);

#[async_trait]
pub trait IEngineSession: Send + Sync {
    /// The connected engine, or [`AppError::NotConnected`].
    async fn engine(&self) -> AppResult<Arc<dyn IEngine>>;
    /// The connected engine, if any.
    async fn current(&self) -> Option<Arc<dyn IEngine>>;
    /// Resolve the default endpoint and try to connect. Never fails: on error
    /// the session stays in standby so the UI can render a retry screen.
    async fn connect_default(&self);
    /// Connect to `config`, replacing the active engine on success.
    async fn apply_config(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto>;
    /// Retry the last-known target (used by the reconnect backoff loop).
    async fn reconnect(&self) -> AppResult<DockerStatusDto>;
    /// Current live status. Probes the daemon; degrades to standby when the
    /// daemon has gone away.
    async fn status(&self) -> DockerStatusDto;
    async fn mark_standby(&self, message: String);
    /// Bumped on every endpoint switch.
    fn subscribe(&self) -> watch::Receiver<u64>;
    /// Endpoint of the current (or last attempted) target.
    async fn endpoint(&self) -> String;
}

/// Ping the engine and collect version metadata into a status payload.
pub async fn probe(engine: &dyn IEngine, endpoint: &str, kind: &str) -> AppResult<DockerStatusDto> {
    let system = engine.system();
    let ping = async {
        let started = Instant::now();
        tokio::time::timeout(PING_TIMEOUT, system.ping())
            .await
            .map_err(|_| AppError::DaemonUnreachable {
                message: "ping timed out".to_string(),
            })??;
        Ok::<_, AppError>(started.elapsed().as_millis() as u64)
    };
    let (ping_ms, version) = tokio::try_join!(ping, system.version())?;
    let os = match version.os {
        Some(os) => Some(os),
        None => system.info().await.ok().and_then(|info| info.os_type),
    };

    Ok(DockerStatusDto {
        endpoint: endpoint.to_string(),
        kind: kind.to_string(),
        state: ConnectionState::Connected,
        engine_version: version.version,
        api_version: version.api_version,
        os,
        arch: version.arch,
        ping_ms: Some(ping_ms),
        message: None,
    })
}
