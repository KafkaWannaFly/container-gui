//! Exec: interactive sessions with stdin fed from the UI and output streamed
//! back, plus one-shot commands collected in full (also used by the files
//! service for directory listings).

mod service;

pub use service::ExecService;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;

use crate::error::{AppError, AppResult};
use crate::models::dto::{ExecEventDto, ExecProbeDto, ExecStartOptions};
use crate::models::engine::{ExecSpec, OutputKind};
use crate::services::engine::{ExecAttachment, IExecGateway};
use crate::services::infrastructure::IEventSink;

const EXEC_TIMEOUT: Duration = Duration::from_secs(20);
/// Cap on collected stdout so a runaway command can't flood memory.
const OUTPUT_MAX_BYTES: usize = 8 * 1024 * 1024;

#[async_trait]
pub trait IExecService: Send + Sync {
    /// Shells, users and distro available inside a running container.
    async fn probe(&self, id: &str) -> AppResult<ExecProbeDto>;
    /// Start an interactive session; output arrives on `sink`, input goes
    /// through [`IExecService::input`], and cancelling `stream_id` ends it.
    async fn start(
        &self,
        id: String,
        stream_id: String,
        options: ExecStartOptions,
        sink: Arc<dyn IEventSink<ExecEventDto>>,
    ) -> AppResult<()>;
    fn input(&self, stream_id: &str, data: Vec<u8>) -> AppResult<()>;
    async fn resize(&self, stream_id: &str, cols: u16, rows: u16) -> AppResult<()>;
}

pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub exit_code: Option<i64>,
}

/// Run a non-interactive command as root and collect its output.
pub async fn run_collect(
    exec: &dyn IExecGateway,
    id: &str,
    cmd: Vec<String>,
) -> AppResult<ExecOutput> {
    let spec = ExecSpec {
        cmd,
        user: Some("0".to_string()),
        ..Default::default()
    };
    let ExecAttachment {
        exec_id,
        mut output,
        ..
    } = exec.start(id, spec).await?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let collect = async {
        while let Some(chunk) = output.next().await {
            let chunk = chunk?;
            match chunk.kind {
                OutputKind::Stdout => {
                    if stdout.len() < OUTPUT_MAX_BYTES {
                        stdout.extend_from_slice(&chunk.data);
                    }
                }
                OutputKind::Stderr => stderr.extend_from_slice(&chunk.data),
            }
        }
        Ok::<_, AppError>(())
    };
    tokio::time::timeout(EXEC_TIMEOUT, collect)
        .await
        .map_err(|_| AppError::Message("command timed out".into()))??;

    let exit_code = exec.exit_code(&exec_id).await?;
    Ok(ExecOutput {
        stdout,
        stderr: String::from_utf8_lossy(&stderr).trim().to_string(),
        exit_code,
    })
}
