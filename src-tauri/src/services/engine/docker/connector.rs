//! Open Docker clients over Unix sockets, Windows named pipes and TCP.

use std::path::Path;
use std::sync::Arc;

use bollard::{API_DEFAULT_VERSION, Docker};
use tap::Tap;

use crate::error::{AppError, AppResult};
use crate::repositories::IDockerContextRepository;
use crate::services::engine::target::{
    ConnectionTarget, normalize_npipe, normalize_tcp, redact_endpoint, target_from_host,
};
use crate::services::engine::{IEngine, IEngineConnector};

use super::DockerEngine;

const REQUEST_TIMEOUT_SECS: u64 = 120;

#[derive(bon::Builder)]
pub struct DockerConnector {
    contexts: Arc<dyn IDockerContextRepository>,
}

impl IEngineConnector for DockerConnector {
    fn platform_default(&self) -> ConnectionTarget {
        #[cfg(windows)]
        {
            ConnectionTarget::NamedPipe("npipe:////./pipe/docker_engine".to_string())
        }
        #[cfg(not(windows))]
        {
            ConnectionTarget::UnixSocket(std::path::PathBuf::from("/var/run/docker.sock"))
        }
    }

    /// `DOCKER_HOST` → Docker context → platform default.
    fn default_target(&self) -> ConnectionTarget {
        if let Ok(host) = std::env::var("DOCKER_HOST")
            && let Some(target) = target_from_host(&host)
        {
            return target;
        }

        if let Some(context) = self.contexts.current_context()
            && let Some(host) = self.contexts.context_host(&context)
            && let Some(target) = target_from_host(&host)
        {
            return target;
        }

        self.platform_default()
    }

    fn connect(&self, target: &ConnectionTarget) -> AppResult<Arc<dyn IEngine>> {
        let endpoint = target.endpoint();
        let client = match target {
            ConnectionTarget::UnixSocket(path) => connect_unix(path),
            ConnectionTarget::NamedPipe(pipe) => connect_npipe(pipe),
            ConnectionTarget::Tcp(url) => {
                let addr = normalize_tcp(url);
                Docker::connect_with_http(&addr, REQUEST_TIMEOUT_SECS, API_DEFAULT_VERSION)
                    .map_err(|err| AppError::from_bollard(err, &addr))
            }
        }?;

        let engine = DockerEngine::builder()
            .client(client)
            .endpoint(endpoint.clone())
            .build();
        Ok(Arc::new(engine).tap(|_| {
            log::info!(
                "[docker] connection established: {}",
                redact_endpoint(&endpoint)
            )
        }))
    }
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
    let _ = normalize_npipe;
    Err(AppError::UnsupportedHost {
        host: format!("{pipe} (named pipes require Windows)"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::engine::ContainerQuery;
    use crate::repositories::fs::{FsDockerContextRepository, docker_contexts};

    /// Live smoke test: resolves the real endpoint, and when a daemon is
    /// reachable, verifies the container list round-trips. Skips (passes)
    /// when no engine is running so CI without Docker stays green.
    #[tokio::test]
    async fn live_engine_smoke() {
        let contexts = FsDockerContextRepository::builder()
            .maybe_docker_dir(docker_contexts::default_docker_dir())
            .build();
        let connector = DockerConnector::builder()
            .contexts(Arc::new(contexts))
            .build();
        let Ok(engine) = connector.connect(&connector.default_target()) else {
            return;
        };
        if engine.system().ping().await.is_err() {
            return;
        }
        let query = ContainerQuery::builder().all(true).build();
        let result = engine.containers().list(&query).await;
        assert!(result.is_ok(), "list containers failed: {:?}", result.err());
    }
}
