//! Child-process side effects for engine onboarding: capture output or
//! stream combined stdout/stderr lines into a sink. Dropping a running
//! future kills the child (`kill_on_drop`), which is how install
//! cancellation tears down winget/podman/wsl mid-flight.

use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

/// After the child exits, leftover pipe data gets at most this long to
/// arrive before the read is cut short (see the pipe-EOF note on the trait).
const PIPE_GRACE: Duration = Duration::from_millis(1_500);

use crate::error::{AppError, AppResult};
use crate::models::dto::ProcessLineDto;
use crate::services::infrastructure::IEventSink;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Captured result of a short-lived probe command.
#[derive(Debug, Clone)]
pub struct ProcessOutput {
    pub code: i32,
    pub stdout: String,
}

impl ProcessOutput {
    pub fn success(&self) -> bool {
        self.code == 0
    }
}

#[async_trait]
pub trait IProcessRunner: Send + Sync {
    /// Run to completion and capture output. A missing binary is
    /// [`AppError::ProgramNotFound`], not an IO error. Output pipes that stay
    /// open in other processes after the child exits (wsl.exe hands work to
    /// wslservice, which can duplicate the pipe handles) are cut short after
    /// [`PIPE_GRACE`]; the bytes already written are still returned.
    async fn output(&self, program: &str, args: &[String]) -> AppResult<ProcessOutput>;
    /// Stream output lines into `sink` and return the exit code. Stops
    /// early (killing the child) when `sink.send` returns `false` or the
    /// future is dropped; a stopped stream reports [`AppError::Cancelled`].
    async fn stream(
        &self,
        program: &str,
        args: &[String],
        sink: std::sync::Arc<dyn IEventSink<ProcessLineDto>>,
    ) -> AppResult<i32>;
}

#[derive(Default, bon::Builder)]
pub struct TokioProcessRunner {}

impl TokioProcessRunner {
    fn command(program: &str, args: &[String]) -> Command {
        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // wsl.exe prints UTF-16LE unless asked otherwise; older builds
        // ignore the variable, so output is decoded defensively too.
        if program.eq_ignore_ascii_case("wsl") || program.eq_ignore_ascii_case("wsl.exe") {
            cmd.env("WSL_UTF8", "1");
        }
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
}

#[async_trait]
impl IProcessRunner for TokioProcessRunner {
    async fn output(&self, program: &str, args: &[String]) -> AppResult<ProcessOutput> {
        let mut child = Self::command(program, args)
            .spawn()
            .map_err(|err| map_io(program, err))?;
        let mut stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");
        let mut out_bytes: Vec<u8> = Vec::new();
        let mut err_bytes: Vec<u8> = Vec::new();
        let mut out_eof = false;
        let mut err_eof = false;
        let mut status = None;
        let mut grace_end = tokio::time::Instant::now();

        // Same exit-vs-pipe-EOF race as stream(): Command::output() would
        // wait for EOF forever if a helper inherited the pipe handles.
        // read_to_end is cancel-safe, so recreating it each pass just
        // continues appending into the buffers.
        loop {
            tokio::select! {
                _ = stdout.read_to_end(&mut out_bytes), if !out_eof => out_eof = true,
                _ = stderr.read_to_end(&mut err_bytes), if !err_eof => err_eof = true,
                s = child.wait(), if status.is_none() => {
                    status = Some(s.map_err(|err| map_io(program, err))?);
                    grace_end = tokio::time::Instant::now() + PIPE_GRACE;
                }
                _ = tokio::time::sleep_until(grace_end), if status.is_some() && !(out_eof && err_eof) => {
                    out_eof = true;
                    err_eof = true;
                }
                else => break,
            }
        }

        let status = match status {
            Some(status) => status,
            None => child.wait().await.map_err(|err| map_io(program, err))?,
        };
        Ok(ProcessOutput {
            code: status.code().unwrap_or(-1),
            stdout: decode_console(&out_bytes),
        })
    }

    async fn stream(
        &self,
        program: &str,
        args: &[String],
        sink: std::sync::Arc<dyn IEventSink<ProcessLineDto>>,
    ) -> AppResult<i32> {
        let mut child = Self::command(program, args)
            .spawn()
            .map_err(|err| map_io(program, err))?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let mut out_lines = BufReader::new(stdout).lines();
        let mut err_lines = BufReader::new(stderr).lines();
        let mut out_done = false;
        let mut err_done = false;
        // Some tools (notably wsl.exe, which hands work to wslservice) leave
        // the output pipes open in another process after they exit, so pipe
        // EOF can never arrive. Once the child itself is gone, give buffered
        // output a grace period to drain, then stop waiting on the pipes.
        let mut exited = false;
        let mut grace_end = tokio::time::Instant::now();

        loop {
            let line = tokio::select! {
                line = out_lines.next_line(), if !out_done => match line {
                    Ok(Some(text)) => Some(("stdout", text)),
                    _ => { out_done = true; None }
                },
                line = err_lines.next_line(), if !err_done => match line {
                    Ok(Some(text)) => Some(("stderr", text)),
                    _ => { err_done = true; None }
                },
                _ = child.wait(), if !exited => {
                    exited = true;
                    grace_end = tokio::time::Instant::now() + Duration::from_millis(1_500);
                    None
                }
                _ = tokio::time::sleep_until(grace_end), if exited => {
                    out_done = true;
                    err_done = true;
                    None
                }
                else => break,
            };
            if let Some((stream, text)) = line
                && !sink.send(ProcessLineDto {
                    stream: stream.to_string(),
                    text,
                })
            {
                // Receiver gone (or cancelled): drop the child, killing it.
                return Err(AppError::Cancelled);
            }
            if out_done && err_done {
                break;
            }
        }

        let status = child.wait().await.map_err(|err| map_io(program, err))?;
        Ok(status.code().unwrap_or(-1))
    }
}

fn map_io(program: &str, err: std::io::Error) -> AppError {
    if err.kind() == std::io::ErrorKind::NotFound {
        AppError::ProgramNotFound {
            program: program.to_string(),
        }
    } else {
        AppError::Message(format!("Could not run {program}: {err}"))
    }
}

/// Console output is UTF-8 with `WSL_UTF8=1`, but older wsl.exe builds print
/// UTF-16LE regardless; NUL bytes are the tell.
pub fn decode_console(bytes: &[u8]) -> String {
    if bytes.contains(&0) {
        let wide: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        String::from_utf16_lossy(&wide)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Default)]
    struct VecSink {
        lines: Mutex<Vec<ProcessLineDto>>,
        open: bool,
    }

    impl IEventSink<ProcessLineDto> for VecSink {
        fn send(&self, event: ProcessLineDto) -> bool {
            self.lines.lock().unwrap().push(event);
            self.open
        }
    }

    #[test]
    fn decodes_utf16_console_output() {
        let wide: Vec<u8> = "Ubuntu\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(decode_console(&wide), "Ubuntu\n");
        assert_eq!(decode_console(b"Ubuntu\n"), "Ubuntu\n");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn captures_output_and_exit_code() {
        let runner = TokioProcessRunner::builder().build();
        let out = runner
            .output("cmd", &["/C".into(), "echo hello & exit 3".into()])
            .await
            .unwrap();
        assert_eq!(out.code, 3);
        assert!(out.stdout.contains("hello"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn missing_program_is_program_not_found() {
        let runner = TokioProcessRunner::builder().build();
        let err = runner
            .output("container-gui-no-such-binary", &[])
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::ProgramNotFound { .. }));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn streams_output_lines() {
        let runner = TokioProcessRunner::builder().build();
        let sink = Arc::new(VecSink {
            open: true,
            ..Default::default()
        });
        let code = runner
            .stream(
                "cmd",
                &["/C".into(), "echo one & echo two".into()],
                sink.clone(),
            )
            .await
            .unwrap();
        assert_eq!(code, 0);
        let lines = sink.lines.lock().unwrap();
        assert!(lines.iter().any(|line| line.text.contains("one")));
        assert!(lines.iter().any(|line| line.text.contains("two")));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn exited_child_with_leaked_pipes_does_not_hang() {
        // The outer cmd exits immediately but `start /B` spawns a grandchild
        // that inherits (and thus holds) the stdout/stderr pipe handles for
        // ~20s, exactly what wsl.exe does with wslservice after --import.
        // Without the post-exit grace period this stream would never end.
        let runner = TokioProcessRunner::builder().build();
        let sink = Arc::new(VecSink {
            open: true,
            ..Default::default()
        });
        let start = std::time::Instant::now();
        let code = runner
            .stream(
                "cmd",
                &[
                    "/C".into(),
                    r#"start /B cmd /C "ping -n 20 127.0.0.1 >nul" & echo done & exit 0"#.into(),
                ],
                sink,
            )
            .await
            .unwrap();
        assert_eq!(code, 0);
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "stream took {:?}",
            start.elapsed()
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn output_does_not_hang_on_leaked_pipes() {
        // Same handle-inheritance scenario as the stream() test, but through
        // the output() path (detect_pkg). The outer cmd exits but a detached
        // grandchild keeps the stdout/stderr pipe write-ends open, so
        // Command::output()'s read-to-EOF would block forever.
        let runner = TokioProcessRunner::builder().build();
        let start = std::time::Instant::now();
        let out = runner
            .output(
                "cmd",
                &[
                    "/C".into(),
                    r#"start /B cmd /C "ping -n 20 127.0.0.1 >nul" & echo hello & exit 7"#.into(),
                ],
            )
            .await
            .unwrap();
        assert_eq!(out.code, 7);
        assert!(out.stdout.contains("hello"));
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "output took {:?}",
            start.elapsed()
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn closed_sink_cancels_and_kills_child() {
        let runner = TokioProcessRunner::builder().build();
        let sink = Arc::new(VecSink::default());
        let err = runner
            .stream("cmd", &["/C".into(), "ping -n 30 127.0.0.1".into()], sink)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Cancelled));
    }
}
