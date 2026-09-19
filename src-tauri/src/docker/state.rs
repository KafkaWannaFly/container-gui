//! Shared session state: the active Docker client, connection metadata
//! and the registry that cancels long-running log/pull streams.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use bollard::Docker;
use tauri::{AppHandle, Emitter};
use tokio::sync::{RwLock, watch};

use crate::docker::connection::{self, ConnectionTarget};
use crate::error::{AppError, AppResult};
use crate::models::dto::{ConnectionConfig, ConnectionState, DockerStatusDto, SystemInfoDto};

const PING_TIMEOUT: Duration = Duration::from_secs(5);

struct Session {
    client: Option<Docker>,
    status: DockerStatusDto,
}

pub struct DockerSessionManager {
    app: AppHandle,
    session: RwLock<Session>,
    target: RwLock<ConnectionTarget>,
    generation: watch::Sender<u64>,
    connect_lock: tokio::sync::Mutex<()>,
}

impl DockerSessionManager {
    pub fn new(app: AppHandle) -> Self {
        let target = connection::default_target();
        let status = DockerStatusDto::standby(
            target.endpoint(),
            target.kind().to_string(),
            "Connecting to Docker engine…",
        );
        let (generation, _) = watch::channel(0);
        Self {
            app,
            session: RwLock::new(Session { client: None, status }),
            target: RwLock::new(target),
            generation,
            connect_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Resolve the default endpoint and try to connect. Never fails — on
    /// error the session stays in standby so the UI can render a retry
    /// screen (verification T1).
    pub async fn connect_default(&self) {
        let target = connection::default_target();
        if let Err(err) = self.switch(target).await {
            self.mark_standby(err.to_string()).await;
        }
    }

    /// Connect to `config`, replacing the active client on success.
    pub async fn apply_config(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto> {
        let target = connection::target_from_config(config)?;
        self.switch(target).await
    }

    /// Swap the active endpoint, emit status and bump the event-stream
    /// generation so the worker resubscribes.
    pub async fn switch(&self, target: ConnectionTarget) -> AppResult<DockerStatusDto> {
        let _guard = self.connect_lock.lock().await;
        let endpoint = target.endpoint();
        let kind = target.kind().to_string();

        let client = connection::connect(&target)?;
        let status = match probe(&client, &endpoint, &kind).await {
            Ok(status) => status,
            Err(err) => {
                let status = DockerStatusDto::standby(endpoint.clone(), kind.clone(), err.to_string());
                self.store(Session { client: None, status: status.clone() }, target).await;
                self.emit_status(&status);
                return Err(err);
            }
        };

        self.store(
            Session { client: Some(client), status: status.clone() },
            target,
        )
        .await;
        self.emit_status(&status);
        Ok(status)
    }

    /// Retry the last-known target (used by the reconnect backoff loop).
    pub async fn reconnect(&self) -> AppResult<DockerStatusDto> {
        let target = self.target.read().await.clone();
        self.switch(target).await
    }

    /// Current live status. Probes the daemon; degrades to standby when
    /// the daemon has gone away.
    pub async fn status(&self) -> DockerStatusDto {
        let client = self.session.read().await.client.clone();
        let Some(client) = client else {
            return self.session.read().await.status.clone();
        };
        let current = self.session.read().await.status.clone();
        match probe(&client, &current.endpoint, &current.kind).await {
            Ok(status) => {
                self.session.write().await.status = status.clone();
                status
            }
            Err(err) => {
                let status = DockerStatusDto::standby(current.endpoint, current.kind, err.to_string());
                self.session.write().await.status = status.clone();
                self.emit_status(&status);
                status
            }
        }
    }

    pub async fn mark_standby(&self, message: impl Into<String>) {
        let current = self.session.read().await.status.clone();
        let status = DockerStatusDto::standby(current.endpoint, current.kind, message);
        {
            let mut session = self.session.write().await;
            session.client = None;
            session.status = status.clone();
        }
        self.emit_status(&status);
    }

    pub async fn client(&self) -> Option<Docker> {
        self.session.read().await.client.clone()
    }

    pub async fn required_client(&self) -> AppResult<Docker> {
        self.client().await.ok_or(AppError::NotConnected)
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.generation.subscribe()
    }

    async fn store(&self, session: Session, target: ConnectionTarget) {
        {
            let mut current = self.session.write().await;
            *current = session;
        }
        *self.target.write().await = target;
        self.generation.send_modify(|generation| *generation += 1);
    }

    fn emit_status(&self, status: &DockerStatusDto) {
        let _ = self.app.emit("docker://status", status.clone());
    }
}

/// Ping the daemon and collect version metadata into a status payload.
async fn probe(client: &Docker, endpoint: &str, kind: &str) -> AppResult<DockerStatusDto> {
    let started = Instant::now();
    tokio::time::timeout(PING_TIMEOUT, client.ping())
        .await
        .map_err(|_| AppError::DaemonUnreachable { message: "ping timed out".to_string() })?
        .map_err(|err| AppError::from_bollard(err, endpoint))?;
    let ping_ms = started.elapsed().as_millis() as u64;

    let version = client
        .version()
        .await
        .map_err(|err| AppError::from_bollard(err, endpoint))?;
    let info = client.info().await.ok();

    Ok(DockerStatusDto {
        endpoint: endpoint.to_string(),
        kind: kind.to_string(),
        state: ConnectionState::Connected,
        engine_version: version.version,
        api_version: version.api_version,
        os: info
            .as_ref()
            .and_then(|info| info.os_type.clone())
            .or(version.os),
        arch: version.arch,
        ping_ms: Some(ping_ms),
        message: None,
    })
}

/// Connect and probe a target without touching the active session.
/// Used by the "Test connection" button.
pub async fn probe_target(target: &ConnectionTarget) -> AppResult<DockerStatusDto> {
    let client = connection::connect(target)?;
    probe(&client, &target.endpoint(), target.kind()).await
}

/// Build the dashboard system-info payload from a live client.
pub async fn collect_system_info(client: &Docker) -> AppResult<SystemInfoDto> {
    let started = Instant::now();
    client.ping().await?;
    let ping_ms = started.elapsed().as_millis() as u64;
    let version = client.version().await?;
    let info = client.info().await?;

    Ok(SystemInfoDto {
        docker_version: version.version.unwrap_or_default(),
        api_version: version.api_version.unwrap_or_default(),
        os: info
            .operating_system
            .or(version.os)
            .unwrap_or_default(),
        arch: info.architecture.or(version.arch).unwrap_or_default(),
        kernel_version: version.kernel_version.or(info.kernel_version).unwrap_or_default(),
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

/// Tracks in-flight log and image-pull streams so unmounting a modal can
/// cancel the backend task (Phase 5.3).
#[derive(Default)]
pub struct StreamRegistry {
    logs: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    pulls: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl StreamRegistry {
    pub fn register_logs(&self, id: String, cancel: tokio::sync::oneshot::Sender<()>) {
        self.logs.lock().unwrap().insert(id, cancel);
    }

    pub fn cancel_logs(&self, id: &str) {
        if let Some(cancel) = self.logs.lock().unwrap().remove(id) {
            let _ = cancel.send(());
        }
    }

    pub fn finish_logs(&self, id: &str) {
        self.logs.lock().unwrap().remove(id);
    }

    pub fn register_pull(&self, image: String, cancel: tokio::sync::oneshot::Sender<()>) {
        self.pulls.lock().unwrap().insert(image, cancel);
    }

    pub fn cancel_pull(&self, image: &str) {
        if let Some(cancel) = self.pulls.lock().unwrap().remove(image) {
            let _ = cancel.send(());
        }
    }

    pub fn finish_pull(&self, image: &str) {
        self.pulls.lock().unwrap().remove(image);
    }
}
