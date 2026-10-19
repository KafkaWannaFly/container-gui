//! Engine connection management for the settings view: status, available
//! contexts, testing an endpoint and switching to it.

use std::sync::Arc;

use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::dto::{ConnectionConfig, DockerContextDto, DockerStatusDto};
use crate::repositories::IDockerContextRepository;
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
    async fn switch(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto>;
}

#[derive(bon::Builder)]
pub struct ConnectionService {
    session: Arc<dyn IEngineSession>,
    connector: Arc<dyn IEngineConnector>,
    contexts: Arc<dyn IDockerContextRepository>,
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
        self.session.apply_config(config).await
    }
}
