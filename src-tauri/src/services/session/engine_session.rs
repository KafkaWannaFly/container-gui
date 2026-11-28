use std::sync::Arc;

use async_trait::async_trait;
use bon::bon;
use tokio::sync::{Mutex, RwLock, watch};

use super::{IEngineSession, probe};
use crate::error::{AppError, AppResult};
use crate::models::dto::{ConnectionConfig, DockerStatusDto};
use crate::services::engine::target::{ConnectionTarget, target_from_config};
use crate::services::engine::{IEngine, IEngineConnector};
use crate::services::infrastructure::IEventPublisher;

struct Session {
    engine: Option<Arc<dyn IEngine>>,
    status: DockerStatusDto,
}

pub struct EngineSession {
    connector: Arc<dyn IEngineConnector>,
    publisher: Arc<dyn IEventPublisher>,
    session: RwLock<Session>,
    target: RwLock<ConnectionTarget>,
    generation: watch::Sender<u64>,
    connect_lock: Mutex<()>,
}

#[bon]
impl EngineSession {
    #[builder]
    pub fn new(connector: Arc<dyn IEngineConnector>, publisher: Arc<dyn IEventPublisher>) -> Self {
        let target = connector.default_target();
        let status = DockerStatusDto::standby(
            target.endpoint(),
            target.kind().to_string(),
            "Connecting to Docker engine…",
        );
        let (generation, _) = watch::channel(0);
        Self {
            connector,
            publisher,
            session: RwLock::new(Session {
                engine: None,
                status,
            }),
            target: RwLock::new(target),
            generation,
            connect_lock: Mutex::new(()),
        }
    }
}

impl EngineSession {
    /// Swap the active endpoint, emit status and bump the generation so
    /// workers resubscribe.
    async fn switch(&self, target: ConnectionTarget) -> AppResult<DockerStatusDto> {
        let _guard = self.connect_lock.lock().await;
        let endpoint = target.endpoint();
        let kind = target.kind().to_string();

        let engine = self.connector.connect(&target)?;
        let status = match probe(engine.as_ref(), &endpoint, &kind).await {
            Ok(status) => status,
            Err(err) => {
                let status =
                    DockerStatusDto::standby(endpoint.clone(), kind.clone(), err.to_string());
                self.store(
                    Session {
                        engine: None,
                        status: status.clone(),
                    },
                    target,
                )
                .await;
                self.publisher.status(&status);
                return Err(err);
            }
        };

        self.store(
            Session {
                engine: Some(engine),
                status: status.clone(),
            },
            target,
        )
        .await;
        self.publisher.status(&status);
        Ok(status)
    }

    async fn store(&self, session: Session, target: ConnectionTarget) {
        *self.session.write().await = session;
        *self.target.write().await = target;
        self.generation.send_modify(|generation| *generation += 1);
    }
}

#[async_trait]
impl IEngineSession for EngineSession {
    async fn engine(&self) -> AppResult<Arc<dyn IEngine>> {
        self.current().await.ok_or(AppError::NotConnected)
    }

    async fn current(&self) -> Option<Arc<dyn IEngine>> {
        self.session.read().await.engine.clone()
    }

    async fn connect_default(&self) {
        let target = self.connector.default_target();
        if let Err(err) = self.switch(target).await {
            self.mark_standby(err.to_string()).await;
        }
    }

    async fn apply_config(&self, config: &ConnectionConfig) -> AppResult<DockerStatusDto> {
        let target = target_from_config(config)?;
        self.switch(target).await
    }

    async fn reconnect(&self) -> AppResult<DockerStatusDto> {
        let target = self.target.read().await.clone();
        self.switch(target).await
    }

    async fn status(&self) -> DockerStatusDto {
        let (engine, current) = {
            let session = self.session.read().await;
            (session.engine.clone(), session.status.clone())
        };
        let Some(engine) = engine else {
            return current;
        };
        match probe(engine.as_ref(), &current.endpoint, &current.kind).await {
            Ok(status) => {
                self.session.write().await.status = status.clone();
                status
            }
            Err(err) => {
                let status =
                    DockerStatusDto::standby(current.endpoint, current.kind, err.to_string());
                self.session.write().await.status = status.clone();
                self.publisher.status(&status);
                status
            }
        }
    }

    async fn mark_standby(&self, message: String) {
        let status = {
            let mut session = self.session.write().await;
            let current = session.status.clone();
            let status = DockerStatusDto::standby(current.endpoint, current.kind, message);
            session.engine = None;
            session.status = status.clone();
            status
        };
        self.publisher.status(&status);
    }

    fn subscribe(&self) -> watch::Receiver<u64> {
        self.generation.subscribe()
    }

    async fn endpoint(&self) -> String {
        self.target.read().await.endpoint()
    }
}
