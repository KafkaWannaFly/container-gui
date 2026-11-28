//! Engine connection management for the settings view: status, available
//! contexts, testing an endpoint and switching to it.

use std::sync::Arc;

use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::dto::{ConnectionConfig, ConnectionState, DockerContextDto, DockerStatusDto};
use crate::repositories::{IDockerContextRepository, IEnginePreferenceRepository};
use crate::services::engine::IEngineConnector;
use crate::services::engine::target::target_from_config;
use crate::services::session::{IEngineSession, probe};

#[async_trait]
pub trait IConnectionService: Send + Sync {
    async fn status(&self) -> DockerStatusDto;
    /// The built-in `default` context plus every stored CLI context.
    fn list_contexts(&self) -> Vec<DockerContextDto>;
    /// Connect and probe without touching the active session.
    async fn test(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto>;
    /// Switch the active session and remember the endpoint, so startup
    /// reconnects to the last thing that worked.
    async fn switch(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto>;
    /// The endpoint the setup wizard installed (startup's preferred target).
    async fn installed_endpoint(&self) -> Option<String>;
}

#[derive(bon::Builder)]
pub struct ConnectionService {
    session: Arc<dyn IEngineSession>,
    connector: Arc<dyn IEngineConnector>,
    contexts: Arc<dyn IDockerContextRepository>,
    preference: Arc<dyn IEnginePreferenceRepository>,
}

#[async_trait]
impl IConnectionService for ConnectionService {
    async fn status(&self) -> DockerStatusDto {
        self.session.status().await
    }

    fn list_contexts(&self) -> Vec<DockerContextDto> {
        let mut contexts = vec![DockerContextDto {
            name: "default".to_string(),
            host: self.connector.platform_default().endpoint(),
            description: Some("Built-in local engine".to_string()),
        }];
        contexts.extend(self.contexts.list());
        contexts
    }

    async fn test(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto> {
        let target = target_from_config(config)?;
        let engine = self.connector.connect(&target)?;
        probe(engine.as_ref(), &target.endpoint(), target.kind()).await
    }

    async fn switch(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto> {
        let status = self.session.apply_config(config).await?;
        // Only a connected endpoint is worth remembering; a failed switch
        // must not overwrite the last-good choice startup falls back to.
        if status.state == ConnectionState::Connected {
            self.preference
                .set_endpoint(Some(status.endpoint.clone()))
                .await;
        }
        Ok(status)
    }

    async fn installed_endpoint(&self) -> Option<String> {
        self.preference.endpoint().await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use tokio::sync::watch;

    use super::*;
    use crate::error::AppError;
    use crate::models::dto::ConnectionKind;
    use crate::services::engine::IEngine;
    use crate::services::engine::target::ConnectionTarget;
    use crate::services::session::IEngineSession;

    /// Session that answers apply_config with a fixed outcome.
    struct StubSession {
        result: Result<String, ()>,
        generation: watch::Sender<u64>,
    }

    #[async_trait]
    impl IEngineSession for StubSession {
        async fn engine(&self) -> Result<Arc<dyn IEngine>, AppError> {
            Err(AppError::NotConnected)
        }
        async fn current(&self) -> Option<Arc<dyn IEngine>> {
            None
        }
        async fn connect_default(&self) {}
        async fn apply_config(&self, _config: &ConnectionConfig) -> AppResult<DockerStatusDto> {
            match &self.result {
                Ok(endpoint) => Ok(DockerStatusDto {
                    endpoint: endpoint.clone(),
                    kind: "tcp".to_string(),
                    state: ConnectionState::Connected,
                    engine_version: None,
                    api_version: None,
                    os: None,
                    arch: None,
                    ping_ms: None,
                    message: None,
                }),
                Err(()) => Err(AppError::Message("nope".to_string())),
            }
        }
        async fn reconnect(&self) -> AppResult<DockerStatusDto> {
            unreachable!()
        }
        async fn status(&self) -> DockerStatusDto {
            DockerStatusDto::standby("stub".into(), "tcp".into(), "stub")
        }
        async fn mark_standby(&self, _message: String) {}
        fn subscribe(&self) -> watch::Receiver<u64> {
            self.generation.subscribe()
        }
        async fn endpoint(&self) -> String {
            "stub".to_string()
        }
    }

    struct StubConnector;

    #[async_trait]
    impl IEngineConnector for StubConnector {
        fn platform_default(&self) -> ConnectionTarget {
            ConnectionTarget::NamedPipe("npipe:////./pipe/docker_engine".into())
        }
        async fn default_target(&self) -> ConnectionTarget {
            self.platform_default()
        }
        fn connect(&self, _target: &ConnectionTarget) -> AppResult<Arc<dyn IEngine>> {
            unreachable!()
        }
    }

    struct StubContexts;

    impl IDockerContextRepository for StubContexts {
        fn current_context(&self) -> Option<String> {
            None
        }
        fn context_host(&self, _name: &str) -> Option<String> {
            None
        }
        fn list(&self) -> Vec<DockerContextDto> {
            Vec::new()
        }
    }

    struct MemPreference(Mutex<Option<String>>);

    #[async_trait]
    impl IEnginePreferenceRepository for MemPreference {
        async fn endpoint(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
        async fn set_endpoint(&self, endpoint: Option<String>) {
            *self.0.lock().unwrap() = endpoint;
        }
    }

    fn service(session: StubSession, preference: MemPreference) -> ConnectionService {
        ConnectionService::builder()
            .session(Arc::new(session))
            .connector(Arc::new(StubConnector))
            .contexts(Arc::new(StubContexts))
            .preference(Arc::new(preference))
            .build()
    }

    fn tcp_config() -> ConnectionConfig {
        ConnectionConfig {
            kind: ConnectionKind::Tcp,
            value: "tcp://127.0.0.1:2375".into(),
        }
    }

    #[tokio::test]
    async fn switch_remembers_the_connected_endpoint() {
        let preference = MemPreference(Mutex::new(Some("tcp://old".into())));
        let svc = service(
            StubSession {
                result: Ok("tcp://127.0.0.1:2375".into()),
                generation: watch::channel(0).0,
            },
            preference,
        );
        svc.switch(&tcp_config()).await.unwrap();
        assert_eq!(
            svc.installed_endpoint().await.as_deref(),
            Some("tcp://127.0.0.1:2375")
        );
    }

    #[tokio::test]
    async fn failed_switch_keeps_the_last_good_endpoint() {
        let preference = MemPreference(Mutex::new(Some("tcp://last-good".into())));
        let svc = service(
            StubSession {
                result: Err(()),
                generation: watch::channel(0).0,
            },
            preference,
        );
        assert!(svc.switch(&tcp_config()).await.is_err());
        assert_eq!(
            svc.installed_endpoint().await.as_deref(),
            Some("tcp://last-good")
        );
    }
}
