//! Resolve and open Docker engine connections across Unix sockets,
//! Windows named pipes and TCP (including WSL2 relays and Docker
//! contexts).

use std::path::{Path, PathBuf};

use bollard::{API_DEFAULT_VERSION, Docker};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tap::Tap;
use variantly::Variantly;

use crate::error::{AppError, AppResult};
use crate::models::dto::{ConnectionConfig, ConnectionKind};

const REQUEST_TIMEOUT_SECS: u64 = 120;

/// Where to reach the Docker daemon.
#[derive(Debug, Clone, Variantly)]
pub enum ConnectionTarget {
    UnixSocket(PathBuf),
    NamedPipe(String),
    Tcp(String),
}

impl ConnectionTarget {
    /// String shown in the UI (`docker://status.endpoint`).
    pub fn endpoint(&self) -> String {
        match self {
            ConnectionTarget::UnixSocket(path) => format!("unix://{}", path.display()),
            ConnectionTarget::NamedPipe(pipe) => pipe.clone(),
            ConnectionTarget::Tcp(url) => url.clone(),
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            ConnectionTarget::UnixSocket(_) => "unix",
            ConnectionTarget::NamedPipe(_) => "npipe",
            ConnectionTarget::Tcp(_) => "tcp",
        }
    }
}

/// Strip `user:pass@` credentials so an endpoint is safe to log.
fn redact_endpoint(endpoint: &str) -> String {
    match endpoint.split_once("://") {
        Some((scheme, rest)) => match rest.split_once('@') {
            Some((_, host)) => format!("{scheme}://***@{host}"),
            None => endpoint.to_string(),
        },
        None => endpoint.to_string(),
    }
}

/// Build a target from the `ConnectionConfig` sent by the settings view.
pub fn target_from_config(config: &ConnectionConfig) -> AppResult<ConnectionTarget> {
    let raw = config.value.trim();
    if raw.is_empty() {
        return Err(AppError::Message("Docker endpoint is empty".into()));
    }
    Ok(match config.kind {
        ConnectionKind::Unix => {
            ConnectionTarget::UnixSocket(PathBuf::from(strip_scheme(raw, "unix://")))
        }
        ConnectionKind::Npipe => ConnectionTarget::NamedPipe(normalize_npipe(raw)),
        ConnectionKind::Tcp => ConnectionTarget::Tcp(normalize_tcp(raw)),
    })
}

/// Best-effort target: `DOCKER_HOST` → Docker context → platform default.
pub fn default_target() -> ConnectionTarget {
    if let Ok(host) = std::env::var("DOCKER_HOST")
        && let Some(target) = target_from_host(&host)
    {
        return target;
    }

    if let Some(context) = current_context_name()
        && let Some(host) = context_host(&context)
        && let Some(target) = target_from_host(&host)
    {
        return target;
    }

    platform_default()
}

fn platform_default() -> ConnectionTarget {
    #[cfg(windows)]
    {
        ConnectionTarget::NamedPipe("npipe:////./pipe/docker_engine".to_string())
    }
    #[cfg(not(windows))]
    {
        ConnectionTarget::UnixSocket(PathBuf::from("/var/run/docker.sock"))
    }
}

/// Parse a `DOCKER_HOST`/context host string into a target.
pub fn target_from_host(host: &str) -> Option<ConnectionTarget> {
    let host = host.trim();
    if host.is_empty() {
        return None;
    }
    if let Some(path) = host.strip_prefix("unix://") {
        return Some(ConnectionTarget::UnixSocket(PathBuf::from(path)));
    }
    if host.starts_with("npipe://") {
        return Some(ConnectionTarget::NamedPipe(normalize_npipe(host)));
    }
    if host.starts_with("tcp://") || host.starts_with("http://") || host.starts_with("https://") {
        return Some(ConnectionTarget::Tcp(normalize_tcp(host)));
    }
    None
}

/// Open a low-level client for `target`. Does not verify the daemon is
/// reachable — callers ping separately.
pub fn connect(target: &ConnectionTarget) -> AppResult<Docker> {
    let endpoint = target.endpoint();
    let docker = match target {
        ConnectionTarget::UnixSocket(path) => connect_unix(path),
        ConnectionTarget::NamedPipe(pipe) => connect_npipe(pipe),
        ConnectionTarget::Tcp(url) => {
            let addr = normalize_tcp(url);
            Docker::connect_with_http(&addr, REQUEST_TIMEOUT_SECS, API_DEFAULT_VERSION)
                .map_err(|err| AppError::from_bollard(err, &addr))
        }
    }?;

    Ok(docker.tap(|_| {
        log::info!(
            "[docker] connection established: {}",
            redact_endpoint(&endpoint)
        )
    }))
}

#[cfg(unix)]
fn connect_unix(path: &Path) -> AppResult<Docker> {
    let addr = format!("unix://{}", path.display());
    Docker::connect_with_unix(&addr, REQUEST_TIMEOUT_SECS, API_DEFAULT_VERSION)
        .map_err(|err| AppError::from_bollard(err, &addr))
}

#[cfg(not(unix))]
fn connect_unix(path: &Path) -> AppResult<Docker> {
    Err(AppError::UnsupportedHost {
        host: format!(
            "unix://{} (Unix sockets require a Unix host)",
            path.display()
        ),
    })
}

#[cfg(windows)]
fn connect_npipe(pipe: &str) -> AppResult<Docker> {
    let addr = normalize_npipe(pipe);
    Docker::connect_with_named_pipe(&addr, REQUEST_TIMEOUT_SECS, API_DEFAULT_VERSION)
        .map_err(|err| AppError::from_bollard(err, &addr))
}

#[cfg(not(windows))]
fn connect_npipe(pipe: &str) -> AppResult<Docker> {
    Err(AppError::UnsupportedHost {
        host: format!("{pipe} (named pipes require Windows)"),
    })
}

/// Read `~/.docker/config.json` `currentContext`.
pub fn current_context_name() -> Option<String> {
    let home = home_dir()?;
    let raw = std::fs::read_to_string(home.join(".docker").join("config.json")).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    value.get("currentContext")?.as_str().map(str::to_string)
}

/// Read the engine host for a named context from its `meta.json`.
pub fn context_host(context: &str) -> Option<String> {
    let meta = read_context_meta(context)?;
    meta.pointer("/Endpoints/docker/Host")?
        .as_str()
        .map(str::to_string)
}

/// List every context under `~/.docker/contexts/meta`, plus `default`.
pub fn list_contexts() -> Vec<crate::models::dto::DockerContextDto> {
    use crate::models::dto::DockerContextDto;

    let mut contexts = Vec::new();
    let default_host = platform_default().endpoint();
    contexts.push(DockerContextDto {
        name: "default".to_string(),
        host: default_host,
        description: Some("Built-in local engine".to_string()),
    });

    if let Some(dir) = home_dir().map(|home| home.join(".docker").join("contexts").join("meta"))
        && let Ok(entries) = std::fs::read_dir(dir)
    {
        for entry in entries.flatten() {
            let meta_path = entry.path().join("meta.json");
            let Ok(raw) = std::fs::read_to_string(&meta_path) else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            let Some(name) = value.get("Name").and_then(Value::as_str) else {
                continue;
            };
            if name == "default" {
                continue;
            }
            let Some(host) = value
                .pointer("/Endpoints/docker/Host")
                .and_then(Value::as_str)
            else {
                continue;
            };
            contexts.push(DockerContextDto {
                name: name.to_string(),
                host: host.to_string(),
                description: value
                    .pointer("/Metadata/Description")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .filter(|d| !d.is_empty()),
            });
        }
    }

    contexts
}

fn read_context_meta(context: &str) -> Option<Value> {
    // Docker names context metadata directories by the SHA-256 of the
    // context name.
    let mut hasher = Sha256::new();
    hasher.update(context.as_bytes());
    let digest = hasher.finalize();
    let hash: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let path = home_dir()?
        .join(".docker")
        .join("contexts")
        .join("meta")
        .join(hash)
        .join("meta.json");
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn strip_scheme<'a>(value: &'a str, scheme: &str) -> &'a str {
    value.strip_prefix(scheme).unwrap_or(value)
}

fn normalize_npipe(value: &str) -> String {
    let bare = strip_scheme(value, "npipe://");
    format!("npipe://{bare}")
}

fn normalize_tcp(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("http://") {
        format!("tcp://{rest}")
    } else if let Some(rest) = value.strip_prefix("https://") {
        format!("tcp://{rest}")
    } else if value.starts_with("tcp://") {
        value.to_string()
    } else {
        format!("tcp://{value}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_docker_host_strings() {
        assert!(matches!(
            target_from_host("unix:///var/run/docker.sock"),
            Some(ConnectionTarget::UnixSocket(_))
        ));
        assert!(matches!(
            target_from_host("npipe:////./pipe/docker_engine"),
            Some(ConnectionTarget::NamedPipe(_))
        ));
        assert_eq!(
            target_from_host("tcp://127.0.0.1:2375").map(|target| target.endpoint()),
            Some("tcp://127.0.0.1:2375".to_string())
        );
        assert!(target_from_host("").is_none());
        assert!(target_from_host("garbage").is_none());
    }

    #[test]
    fn normalizes_endpoints() {
        assert_eq!(normalize_tcp("127.0.0.1:2375"), "tcp://127.0.0.1:2375");
        assert_eq!(normalize_tcp("http://host:2375"), "tcp://host:2375");
        assert_eq!(
            normalize_npipe("//./pipe/docker_engine"),
            "npipe:////./pipe/docker_engine"
        );
    }

    #[test]
    fn redacts_endpoint_credentials() {
        assert_eq!(
            redact_endpoint("tcp://user:secret@host:2375"),
            "tcp://***@host:2375"
        );
        assert_eq!(
            redact_endpoint("unix:///var/run/docker.sock"),
            "unix:///var/run/docker.sock"
        );
        assert_eq!(
            redact_endpoint("npipe:////./pipe/docker_engine"),
            "npipe:////./pipe/docker_engine"
        );
    }

    /// Live smoke test: resolves the real endpoint, and when a daemon is
    /// reachable, verifies the container list round-trips. Skips (passes)
    /// when no engine is running so CI without Docker stays green.
    #[tokio::test]
    async fn live_engine_smoke() {
        let target = default_target();
        let Ok(client) = connect(&target) else {
            return;
        };
        if client.ping().await.is_err() {
            return;
        }
        let filter = crate::services::container_service::ContainerListFilter::builder()
            .all(true)
            .build();
        let result = crate::services::container_service::list_containers(&client, &filter).await;
        assert!(result.is_ok(), "list_containers failed: {:?}", result.err());
    }

    #[test]
    fn config_kinds_map_to_targets() {
        let target = target_from_config(&ConnectionConfig {
            kind: ConnectionKind::Tcp,
            value: "http://127.0.0.1:2375".into(),
        })
        .unwrap();
        assert_eq!(target.endpoint(), "tcp://127.0.0.1:2375");
        assert_eq!(target.kind(), "tcp");
    }
}
