//! Interactive exec sessions: a long-lived process in the container with
//! stdin fed from the UI and output streamed back over a channel. Works
//! with or without a TTY; the TTY variant also supports resizing.

use std::collections::HashMap;
use std::sync::Mutex;

use bollard::Docker;
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults};
use futures_util::StreamExt;
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use crate::docker::state::{StreamRegistry, StreamTicket};
use crate::error::{AppError, AppResult};
use crate::models::dto::{ExecEventDto, ExecProbeDto, ExecStartOptions};
use crate::services::files_service::run_exec;

/// Input side of live sessions, keyed by the caller's stream id.
#[derive(Default)]
pub struct ExecRegistry {
    sessions: Mutex<HashMap<String, ExecHandle>>,
}

#[derive(Clone)]
struct ExecHandle {
    exec_id: String,
    input: mpsc::UnboundedSender<Vec<u8>>,
}

impl ExecRegistry {
    fn insert(&self, stream_id: String, handle: ExecHandle) {
        self.sessions.lock().unwrap().insert(stream_id, handle);
    }

    fn remove(&self, stream_id: &str, exec_id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        if sessions
            .get(stream_id)
            .is_some_and(|h| h.exec_id == exec_id)
        {
            sessions.remove(stream_id);
        }
    }

    pub fn write(&self, stream_id: &str, data: Vec<u8>) -> AppResult<()> {
        let sessions = self.sessions.lock().unwrap();
        let handle = sessions
            .get(stream_id)
            .ok_or_else(|| AppError::Message("exec session has ended".into()))?;
        handle
            .input
            .send(data)
            .map_err(|_| AppError::Message("exec session has ended".into()))
    }

    fn exec_id(&self, stream_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .unwrap()
            .get(stream_id)
            .map(|h| h.exec_id.clone())
    }
}

/// Decodes UTF-8 across chunk boundaries: a multi-byte character split
/// between two chunks is held back until its remaining bytes arrive.
#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    fn decode(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    return out;
                }
                Err(err) => {
                    let valid = err.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match err.error_len() {
                        // Incomplete trailing sequence: keep it for the next chunk.
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + bad);
                        }
                    }
                }
            }
        }
    }
}

pub async fn start(
    client: Docker,
    registry: std::sync::Arc<StreamRegistry>,
    execs: std::sync::Arc<ExecRegistry>,
    id: String,
    stream_id: String,
    options: ExecStartOptions,
    channel: Channel<ExecEventDto>,
) -> AppResult<()> {
    let mut env = vec!["TERM=xterm-256color".to_string()];
    env.extend(options.env);
    let exec = client
        .create_exec(
            &id,
            CreateExecOptions {
                cmd: Some(options.cmd),
                user: options.user.filter(|u| !u.is_empty()),
                working_dir: options.working_dir.filter(|w| !w.is_empty()),
                env: Some(env),
                tty: Some(options.tty),
                attach_stdin: Some(true),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                ..Default::default()
            },
        )
        .await?;
    let started = client
        .start_exec(
            &exec.id,
            Some(StartExecOptions {
                detach: false,
                tty: options.tty,
                output_capacity: None,
            }),
        )
        .await?;
    let StartExecResults::Attached {
        mut output,
        mut input,
    } = started
    else {
        return Err(AppError::Message("exec did not attach".into()));
    };

    if options.tty && options.cols > 0 && options.rows > 0 {
        let _ = client
            .resize_exec(
                &exec.id,
                ResizeExecOptions {
                    width: options.cols,
                    height: options.rows,
                },
            )
            .await;
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    execs.insert(
        stream_id.clone(),
        ExecHandle {
            exec_id: exec.id.clone(),
            input: tx,
        },
    );
    let StreamTicket {
        token,
        mut cancelled,
    } = registry.register(stream_id.clone());

    tauri::async_runtime::spawn(async move {
        let mut stdout = Utf8Stream::default();
        let mut stderr = Utf8Stream::default();
        let mut error = None;
        loop {
            tokio::select! {
                _ = &mut cancelled => break,
                data = rx.recv() => match data {
                    Some(bytes) => {
                        if input.write_all(&bytes).await.is_err() || input.flush().await.is_err() {
                            break;
                        }
                    }
                    None => break,
                },
                item = output.next() => match item {
                    Some(Ok(chunk)) => {
                        let (stream, text) = match chunk {
                            LogOutput::StdErr { message } => ("stderr", stderr.decode(&message)),
                            LogOutput::StdOut { message } | LogOutput::Console { message } => {
                                ("stdout", stdout.decode(&message))
                            }
                            LogOutput::StdIn { .. } => continue,
                        };
                        if !text.is_empty()
                            && channel
                                .send(ExecEventDto::Output { stream: stream.to_string(), data: text })
                                .is_err()
                        {
                            break;
                        }
                    }
                    Some(Err(err)) => {
                        error = Some(err.to_string());
                        break;
                    }
                    None => break,
                },
            }
        }
        // Closing stdin ends a shell that is still waiting for input.
        let _ = input.shutdown().await;
        execs.remove(&stream_id, &exec.id);
        registry.finish(&stream_id, token);
        let code = client
            .inspect_exec(&exec.id)
            .await
            .ok()
            .and_then(|info| info.exit_code);
        let _ = channel.send(ExecEventDto::Exit { code, error });
    });
    Ok(())
}

pub async fn resize(
    client: &Docker,
    execs: &ExecRegistry,
    stream_id: &str,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let exec_id = execs
        .exec_id(stream_id)
        .ok_or_else(|| AppError::Message("exec session has ended".into()))?;
    client
        .resize_exec(
            &exec_id,
            ResizeExecOptions {
                width: cols,
                height: rows,
            },
        )
        .await?;
    Ok(())
}

/// Which shells and users the container offers, plus its distro id for
/// the cheat sheet's package-manager commands. One exec, POSIX sh only.
const PROBE_SCRIPT: &str = r#"for s in /bin/bash /bin/ash /bin/zsh /bin/sh; do [ -x "$s" ] && echo "shell|$s"; done
cut -d: -f1,3 /etc/passwd 2>/dev/null | while IFS=: read -r name uid; do echo "user|$name|$uid"; done
[ -r /etc/os-release ] && . /etc/os-release && echo "os|${ID:-}|${PRETTY_NAME:-}"
echo "host|$(hostname 2>/dev/null)""#;

pub async fn probe(client: &Docker, id: &str) -> AppResult<ExecProbeDto> {
    let out = run_exec(
        client,
        id,
        vec!["sh".into(), "-c".into(), PROBE_SCRIPT.into()],
    )
    .await?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut probe = ExecProbeDto::default();
    for line in text.lines() {
        let mut parts = line.split('|');
        match (parts.next(), parts.next(), parts.next()) {
            (Some("shell"), Some(path), _) => probe.shells.push(path.to_string()),
            (Some("user"), Some(name), Some(uid)) => {
                // Service accounts (uid < 1000 other than root) clutter the picker.
                let uid: u32 = uid.parse().unwrap_or(u32::MAX);
                if uid == 0 || (1000..65534).contains(&uid) {
                    probe.users.push(name.to_string());
                }
            }
            (Some("os"), Some(os_id), pretty) => {
                probe.os_id = os_id.to_string();
                probe.os_name = pretty.unwrap_or_default().to_string();
            }
            (Some("host"), Some(host), _) => probe.hostname = host.to_string(),
            _ => {}
        }
    }
    if probe.shells.is_empty() && out.exit_code != Some(0) {
        return Err(AppError::Message(if out.stderr.is_empty() {
            "no shell found in this container".into()
        } else {
            out.stderr
        }));
    }
    Ok(probe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_stream_holds_split_characters() {
        let mut dec = Utf8Stream::default();
        let bytes = "héllo ✓".as_bytes();
        let (a, b) = bytes.split_at(2); // splits inside 'é'
        let first = dec.decode(a);
        let second = dec.decode(b);
        assert_eq!(first, "h");
        assert_eq!(format!("{first}{second}"), "héllo ✓");
    }

    #[test]
    fn utf8_stream_replaces_invalid_bytes() {
        let mut dec = Utf8Stream::default();
        assert_eq!(dec.decode(&[b'a', 0xff, b'b']), "a\u{FFFD}b");
    }
}
