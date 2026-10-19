use async_trait::async_trait;
use bollard::exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults};

use super::{DockerEngine, output_stream};
use crate::error::{AppError, AppResult};
use crate::models::engine::ExecSpec;
use crate::services::engine::{ExecAttachment, IExecGateway};

#[async_trait]
impl IExecGateway for DockerEngine {
    async fn start(&self, container_id: &str, spec: ExecSpec) -> AppResult<ExecAttachment> {
        let exec = self
            .client
            .create_exec(
                container_id,
                CreateExecOptions {
                    cmd: Some(spec.cmd),
                    user: spec.user,
                    working_dir: spec.working_dir,
                    env: spec.env,
                    tty: Some(spec.tty),
                    attach_stdin: Some(spec.attach_stdin),
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    ..Default::default()
                },
            )
            .await?;
        let started = self
            .client
            .start_exec(
                &exec.id,
                Some(StartExecOptions {
                    detach: false,
                    tty: spec.tty,
                    output_capacity: None,
                }),
            )
            .await?;
        let StartExecResults::Attached { output, input } = started else {
            return Err(AppError::Message("exec did not attach".into()));
        };
        Ok(ExecAttachment {
            exec_id: exec.id,
            output: output_stream(output),
            input,
        })
    }

    async fn resize(&self, exec_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        self.client
            .resize_exec(
                exec_id,
                ResizeExecOptions {
                    width: cols,
                    height: rows,
                },
            )
            .await?;
        Ok(())
    }

    async fn exit_code(&self, exec_id: &str) -> AppResult<Option<i64>> {
        Ok(self.client.inspect_exec(exec_id).await?.exit_code)
    }
}
