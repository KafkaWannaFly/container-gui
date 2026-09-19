use std::path::PathBuf;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Structured application error. Serialized to the frontend as
/// `{ kind, message }` so the UI can distinguish a permissions problem
/// from an offline daemon.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Docker socket not found at {path}")]
    SocketNotFound { path: String },

    #[error(
        "Permission denied for {path}. User is not in the 'docker' group. Run: sudo usermod -aG docker $USER and restart your WSL2 session."
    )]
    SocketPermissionDenied { path: String },

    #[error("Docker daemon unreachable: {message}")]
    DaemonUnreachable { message: String },

    #[error("Not connected to a Docker daemon")]
    NotConnected,

    #[error("Unsupported Docker host: {host}")]
    UnsupportedHost { host: String },

    #[error("Docker error: {0}")]
    Docker(#[from] bollard::errors::Error),

    #[error("{0}")]
    Message(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::SocketNotFound { .. } => "socket_not_found",
            AppError::SocketPermissionDenied { .. } => "socket_permission_denied",
            AppError::DaemonUnreachable { .. } => "daemon_unreachable",
            AppError::NotConnected => "not_connected",
            AppError::UnsupportedHost { .. } => "unsupported_host",
            AppError::Docker(_) => "docker",
            AppError::Message(_) => "message",
        }
    }

    /// Translate a Bollard error, attaching the endpoint we were talking to
    /// so socket/pipe failures become actionable.
    pub fn from_bollard(err: bollard::errors::Error, endpoint: &str) -> Self {
        match err {
            bollard::errors::Error::SocketNotFoundError(path) => AppError::SocketNotFound { path },
            bollard::errors::Error::IOError { err } => {
                if err.kind() == std::io::ErrorKind::PermissionDenied {
                    AppError::SocketPermissionDenied {
                        path: endpoint.to_string(),
                    }
                } else if matches!(
                    err.kind(),
                    std::io::ErrorKind::ConnectionRefused
                        | std::io::ErrorKind::NotFound
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::BrokenPipe
                        | std::io::ErrorKind::TimedOut
                ) {
                    AppError::DaemonUnreachable {
                        message: err.to_string(),
                    }
                } else {
                    AppError::Docker(bollard::errors::Error::IOError { err })
                }
            }
            other => AppError::Docker(other),
        }
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        AppError::Message(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        AppError::Message(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        AppError::Message(value.to_string())
    }
}

impl From<PathBuf> for AppError {
    fn from(value: PathBuf) -> Self {
        AppError::Message(value.display().to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
