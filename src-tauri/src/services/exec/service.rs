use std::sync::Arc;

use async_trait::async_trait;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use super::{IExecService, run_collect};
use crate::error::{AppError, AppResult};
use crate::models::dto::{ExecEventDto, ExecProbeDto, ExecStartOptions};
use crate::models::engine::{ExecSpec, OutputKind};
use crate::repositories::{IExecSessionRepository, IStreamRegistry, StreamTicket};
use crate::services::engine::ExecAttachment;
use crate::services::infrastructure::IEventSink;
use crate::services::session::IEngineSession;

/// Which shells and users the container offers, plus its distro id for
/// the cheat sheet's package-manager commands. One exec, POSIX sh only.
const PROBE_SCRIPT: &str = r#"for s in /bin/bash /bin/ash /bin/zsh /bin/sh; do [ -x "$s" ] && echo "shell|$s"; done
cut -d: -f1,3 /etc/passwd 2>/dev/null | while IFS=: read -r name uid; do echo "user|$name|$uid"; done
[ -r /etc/os-release ] && . /etc/os-release && echo "os|${ID:-}|${PRETTY_NAME:-}"
echo "host|$(hostname 2>/dev/null)""#;

fn session_ended() -> AppError {
    AppError::Message("exec session has ended".into())
}

#[derive(bon::Builder)]
pub struct ExecService {
    session: Arc<dyn IEngineSession>,
    streams: Arc<dyn IStreamRegistry>,
    sessions: Arc<dyn IExecSessionRepository>,
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

fn parse_probe(text: &str) -> ExecProbeDto {
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
    probe
}

#[async_trait]
impl IExecService for ExecService {
    async fn probe(&self, id: &str) -> AppResult<ExecProbeDto> {
        let engine = self.session.engine().await?;
        let out = run_collect(
            engine.exec(),
            id,
            vec!["sh".into(), "-c".into(), PROBE_SCRIPT.into()],
        )
        .await?;
        let probe = parse_probe(&String::from_utf8_lossy(&out.stdout));
        if probe.shells.is_empty() && out.exit_code != Some(0) {
            return Err(AppError::Message(if out.stderr.is_empty() {
                "no shell found in this container".into()
            } else {
                out.stderr
            }));
        }
        Ok(probe)
    }

    async fn start(
        &self,
        id: String,
        stream_id: String,
        options: ExecStartOptions,
        sink: Arc<dyn IEventSink<ExecEventDto>>,
    ) -> AppResult<()> {
        let engine = self.session.engine().await?;
        let mut env = vec!["TERM=xterm-256color".to_string()];
        env.extend(options.env);
        let spec = ExecSpec {
            cmd: options.cmd,
            user: options.user.filter(|u| !u.is_empty()),
            working_dir: options.working_dir.filter(|w| !w.is_empty()),
            env: Some(env),
            tty: options.tty,
            attach_stdin: true,
        };
        let ExecAttachment {
            exec_id,
            mut output,
            mut input,
        } = engine.exec().start(&id, spec).await?;

        if options.tty && options.cols > 0 && options.rows > 0 {
            let _ = engine
                .exec()
                .resize(&exec_id, options.cols, options.rows)
                .await;
        }

        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        self.sessions.insert(stream_id.clone(), exec_id.clone(), tx);
        let StreamTicket {
            token,
            mut cancelled,
        } = self.streams.register(stream_id.clone());
        let streams = self.streams.clone();
        let sessions = self.sessions.clone();

        tokio::spawn(async move {
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
                            let text = match chunk.kind {
                                OutputKind::Stderr => stderr.decode(&chunk.data),
                                OutputKind::Stdout => stdout.decode(&chunk.data),
                            };
                            if !text.is_empty()
                                && !sink.send(ExecEventDto::Output {
                                    stream: chunk.kind.as_str().to_string(),
                                    data: text,
                                })
                            {
                                break;
                            }
                        }
                        Some(Err(err)) => {
                            error = Some(err.detail());
                            break;
                        }
                        None => break,
                    },
                }
            }
            // Closing stdin ends a shell that is still waiting for input.
            let _ = input.shutdown().await;
            sessions.remove(&stream_id, &exec_id);
            streams.finish(&stream_id, token);
            let code = engine.exec().exit_code(&exec_id).await.ok().flatten();
            sink.send(ExecEventDto::Exit { code, error });
        });
        Ok(())
    }

    fn input(&self, stream_id: &str, data: Vec<u8>) -> AppResult<()> {
        self.sessions
            .input(stream_id)
            .ok_or_else(session_ended)?
            .send(data)
            .map_err(|_| session_ended())
    }

    async fn resize(&self, stream_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let engine = self.session.engine().await?;
        let exec_id = self.sessions.exec_id(stream_id).ok_or_else(session_ended)?;
        engine.exec().resize(&exec_id, cols, rows).await
    }
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

    #[test]
    fn probe_keeps_root_and_human_users() {
        let probe = parse_probe(
            "shell|/bin/sh\nuser|root|0\nuser|daemon|1\nuser|me|1000\nos|alpine|Alpine Linux\nhost|box\n",
        );
        assert_eq!(probe.shells, vec!["/bin/sh"]);
        assert_eq!(probe.users, vec!["root", "me"]);
        assert_eq!(probe.os_name, "Alpine Linux");
        assert_eq!(probe.hostname, "box");
    }
}
