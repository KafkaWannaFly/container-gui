//! Engine endpoints: Unix sockets, Windows named pipes and TCP (including
//! WSL2 relays and CLI contexts), parsed from config, env or context hosts.

use std::path::PathBuf;

use variantly::Variantly;

use crate::error::{AppError, AppResult};
use crate::models::dto::{ConnectionConfig, ConnectionKind};

/// Where to reach the engine daemon.
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
pub fn redact_endpoint(endpoint: &str) -> String {
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

fn strip_scheme<'a>(value: &'a str, scheme: &str) -> &'a str {
    value.strip_prefix(scheme).unwrap_or(value)
}

pub fn normalize_npipe(value: &str) -> String {
    let bare = strip_scheme(value, "npipe://");
    format!("npipe://{bare}")
}

pub fn normalize_tcp(value: &str) -> String {
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
