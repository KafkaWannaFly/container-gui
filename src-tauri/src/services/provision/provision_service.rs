//! Install orchestration: register a cancellable stream, then run the chosen
//! engine's install routine. Dropping the routine on cancellation kills any
//! in-flight child process (the runner uses `kill_on_drop`).

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;

use super::{IProvisionService, docker_wsl, podman};
use crate::error::{AppError, AppResult};
use crate::models::dto::{
    ConnectionConfig, ConnectionKind, DockerStatusDto, InstallEngine, InstallEventDto,
    InstallRequest, ProcessLineDto,
};
use crate::repositories::{IEnginePreferenceRepository, IStreamRegistry};
use crate::services::infrastructure::{IEventSink, IHttpDownloader, IProcessRunner};
use crate::services::session::IEngineSession;

pub struct ProvisionService {
    runner: Arc<dyn IProcessRunner>,
    downloader: Arc<dyn IHttpDownloader>,
    session: Arc<dyn IEngineSession>,
    preference: Arc<dyn IEnginePreferenceRepository>,
    streams: Arc<dyn IStreamRegistry>,
    data_dir: PathBuf,
}

#[bon::bon]
impl ProvisionService {
    #[builder]
    pub fn new(
        runner: Arc<dyn IProcessRunner>,
        downloader: Arc<dyn IHttpDownloader>,
        session: Arc<dyn IEngineSession>,
        preference: Arc<dyn IEnginePreferenceRepository>,
        streams: Arc<dyn IStreamRegistry>,
        data_dir: PathBuf,
    ) -> Self {
        Self {
            runner,
            downloader,
            session,
            preference,
            streams,
            data_dir,
        }
    }
}

#[async_trait]
impl IProvisionService for ProvisionService {
    async fn install(
        &self,
        request: InstallRequest,
        stream_id: String,
        sink: Arc<dyn IEventSink<InstallEventDto>>,
    ) -> AppResult<()> {
        let ticket = self.streams.register(stream_id.clone());
        let ctx = InstallCtx {
            runner: self.runner.clone(),
            downloader: self.downloader.clone(),
            session: self.session.clone(),
            preference: self.preference.clone(),
            data_dir: self.data_dir.clone(),
            sink: sink.clone(),
        };
        let streams = self.streams.clone();
        let mut cancelled = ticket.cancelled;
        let token = ticket.token;

        tokio::spawn(async move {
            let result = tokio::select! {
                _ = &mut cancelled => Err(AppError::Cancelled),
                res = ctx.run(request) => res,
            };
            let (error, unit_name) = match result {
                Ok(unit_name) => (None, Some(unit_name)),
                Err(AppError::Cancelled) => (Some("Installation cancelled".to_string()), None),
                Err(err) => (Some(err.to_string()), None),
            };
            let _ = sink.send(InstallEventDto::End { error, unit_name });
            streams.finish(&stream_id, token);
        });
        Ok(())
    }
}

/// Owned handle bundle passed to the per-engine install routines.
pub(super) struct InstallCtx {
    pub runner: Arc<dyn IProcessRunner>,
    pub downloader: Arc<dyn IHttpDownloader>,
    pub session: Arc<dyn IEngineSession>,
    pub preference: Arc<dyn IEnginePreferenceRepository>,
    pub data_dir: PathBuf,
    pub sink: Arc<dyn IEventSink<InstallEventDto>>,
}

impl InstallCtx {
    /// Run the chosen engine's install; resolves to the final machine or
    /// distribution name (the dedicated Alpine import derives its own).
    pub async fn run(&self, request: InstallRequest) -> AppResult<String> {
        match request.engine {
            InstallEngine::Podman => podman::install(self, &request).await,
            InstallEngine::DockerWsl => docker_wsl::install(self, &request).await,
        }
    }

    pub fn emit(&self, event: InstallEventDto) {
        let _ = self.sink.send(event);
    }

    pub fn phase(&self, index: u32, total: u32, name: &str) {
        self.emit(InstallEventDto::Phase {
            index,
            total,
            name: name.to_string(),
        });
    }

    pub fn line(&self, stream: &str, text: impl Into<String>) {
        self.emit(InstallEventDto::Line {
            stream: stream.to_string(),
            text: text.into(),
        });
    }

    /// Run a child process, forwarding each output line to the install sink.
    pub async fn run_stream(&self, program: &str, args: &[String]) -> AppResult<i32> {
        let adapter = Arc::new(LineAdapter {
            sink: self.sink.clone(),
        });
        self.runner.stream(program, args, adapter).await
    }

    /// Run a short probe and capture output (no streaming).
    pub async fn output(&self, program: &str, args: &[String]) -> AppResult<Probe> {
        let out = self.runner.output(program, args).await?;
        Ok(Probe {
            code: out.code,
            stdout: out.stdout,
        })
    }

    /// Switch the session to `config` and remember it as the installed
    /// endpoint (or clear the preference for the platform-default pipe).
    pub async fn connect(
        &self,
        config: ConnectionConfig,
        remember: Option<String>,
    ) -> AppResult<DockerStatusDto> {
        let status = self.session.apply_config(&config).await?;
        self.preference.set_endpoint(remember).await;
        Ok(status)
    }
}

/// Captured probe result used by the install routines.
pub(super) struct Probe {
    pub code: i32,
    pub stdout: String,
}

impl Probe {
    pub fn success(&self) -> bool {
        self.code == 0
    }
}

/// Forwards runner output lines into the install event sink.
struct LineAdapter {
    sink: Arc<dyn IEventSink<InstallEventDto>>,
}

impl IEventSink<ProcessLineDto> for LineAdapter {
    fn send(&self, line: ProcessLineDto) -> bool {
        self.sink.send(InstallEventDto::Line {
            stream: line.stream,
            text: line.text,
        })
    }
}

pub(super) fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

pub(super) fn npipe_config() -> ConnectionConfig {
    ConnectionConfig {
        kind: ConnectionKind::Npipe,
        value: "//./pipe/docker_engine".to_string(),
    }
}

pub(super) fn loopback_tcp_config() -> ConnectionConfig {
    ConnectionConfig {
        kind: ConnectionKind::Tcp,
        value: "127.0.0.1:2375".to_string(),
    }
}
