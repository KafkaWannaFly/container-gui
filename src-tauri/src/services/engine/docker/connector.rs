//! Open Docker clients over Unix sockets, Windows named pipes and TCP.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use bollard::{API_DEFAULT_VERSION, Docker};
use tap::Tap;

use super::DockerEngine;
use crate::error::{AppError, AppResult};
use crate::repositories::{IDockerContextRepository, IEnginePreferenceRepository};
use crate::services::engine::target::{
    ConnectionTarget, normalize_npipe, normalize_tcp, redact_endpoint, target_from_host,
};
use crate::services::engine::{IEngine, IEngineConnector};

const REQUEST_TIMEOUT_SECS: u64 = 120;

#[derive(bon::Builder)]
pub struct DockerConnector {
    contexts: Arc<dyn IDockerContextRepository>,
    preference: Arc<dyn IEnginePreferenceRepository>,
}

#[async_trait]
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

    /// `DOCKER_HOST` → wizard-installed endpoint → Docker context → platform
    /// default. The wizard preference outranks the ambient context: choosing
    /// an engine here is explicit intent, while `desktop-linux` etc. is
    /// leftover CLI state that would otherwise mask a completed install.
    async fn default_target(&self) -> ConnectionTarget {
        if let Ok(host) = std::env::var("DOCKER_HOST")
            && let Some(target) = target_from_host(&host)
        {
            return target;
        }

        if let Some(host) = self.preference.endpoint().await
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

    /// In-memory preference so tests can pin an installed endpoint.
    struct MemPreference(std::sync::Mutex<Option<String>>);

    #[async_trait]
    impl IEnginePreferenceRepository for MemPreference {
        async fn endpoint(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
        async fn set_endpoint(&self, endpoint: Option<String>) {
            *self.0.lock().unwrap() = endpoint;
        }
    }

    fn connector_with(preference: Option<String>) -> DockerConnector {
        let contexts = FsDockerContextRepository::builder()
            .maybe_docker_dir(docker_contexts::default_docker_dir())
            .build();
        DockerConnector::builder()
            .contexts(Arc::new(contexts))
            .preference(Arc::new(MemPreference(std::sync::Mutex::new(preference))))
            .build()
    }

    #[tokio::test]
    async fn preference_fills_in_before_platform_default() {
        // Only meaningful when DOCKER_HOST is unset; guard so the test does
        // not fight the developer's environment.
        if std::env::var_os("DOCKER_HOST").is_some() {
            return;
        }
        // The wizard endpoint must win even on machines with a current
        // Docker context (e.g. desktop-linux), or installs never "show up"
        // after an app restart.
        let connector = connector_with(Some("tcp://127.0.0.1:2375".into()));
        assert_eq!(
            connector.default_target().await.endpoint(),
            "tcp://127.0.0.1:2375"
        );
    }

    /// Live smoke test: resolves the real endpoint, and when a daemon is
    /// reachable, verifies the container list round-trips. Skips (passes)
    /// when no engine is running so CI without Docker stays green.
    #[tokio::test]
    async fn live_engine_smoke() {
        let connector = connector_with(None);
        let Ok(engine) = connector.connect(&connector.default_target().await) else {
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
