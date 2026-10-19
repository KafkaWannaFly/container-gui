//! Test doubles for service tests: a session that hands out a fixed engine,
//! and an in-memory engine that answers the calls services make.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use futures_util::stream::BoxStream;
use tokio::sync::watch;

use crate::error::{AppError, AppResult};
use crate::models::dto::{
    ConnectionConfig, DockerEventDto, DockerStatusDto, FsChangeDto, ImageItemDto,
    LayerHistoryItemDto,
};
use crate::models::engine::{
    ContainerAction, ContainerQuery, ContainerRecord, EngineInfo, EngineVersion, ExecSpec,
    LogQuery, PullProgress, StatsReading, VolumeRecord,
};
use crate::services::engine::{
    ByteStream, ExecAttachment, IContainerGateway, IEngine, IEventSource, IExecGateway,
    IImageGateway, ISystemGateway, IVolumeGateway, OutputStream,
};
use crate::services::session::IEngineSession;

pub struct FakeSession {
    engine: Option<Arc<dyn IEngine>>,
    generation: watch::Sender<u64>,
}

impl FakeSession {
    pub const ENDPOINT: &str = "fake://engine";

    pub fn connected(engine: FakeEngine) -> Self {
        Self {
            engine: Some(Arc::new(engine)),
            generation: watch::channel(0).0,
        }
    }

    pub fn disconnected() -> Self {
        Self {
            engine: None,
            generation: watch::channel(0).0,
        }
    }

    fn status(&self) -> DockerStatusDto {
        DockerStatusDto::standby(Self::ENDPOINT.into(), "fake".into(), "fake")
    }
}

#[async_trait]
impl IEngineSession for FakeSession {
    async fn engine(&self) -> AppResult<Arc<dyn IEngine>> {
        self.engine.clone().ok_or(AppError::NotConnected)
    }

    async fn current(&self) -> Option<Arc<dyn IEngine>> {
        self.engine.clone()
    }

    async fn connect_default(&self) {}

    async fn apply_config(&self, _config: &ConnectionConfig) -> AppResult<DockerStatusDto> {
        Ok(self.status())
    }

    async fn reconnect(&self) -> AppResult<DockerStatusDto> {
        Ok(self.status())
    }

    async fn status(&self) -> DockerStatusDto {
        FakeSession::status(self)
    }

    async fn mark_standby(&self, _message: String) {}

    fn subscribe(&self) -> watch::Receiver<u64> {
        self.generation.subscribe()
    }

    async fn endpoint(&self) -> String {
        Self::ENDPOINT.to_string()
    }
}

/// Answers listings, stats and volume sizes from its fields; any other call
/// panics so a test notices an unexpected engine call.
#[derive(Default)]
pub struct FakeEngine {
    pub containers: Vec<ContainerRecord>,
    pub volumes: Vec<VolumeRecord>,
    pub sizes: Vec<(String, i64)>,
    pub stats: HashMap<String, StatsReading>,
}

impl IEngine for FakeEngine {
    fn containers(&self) -> &dyn IContainerGateway {
        self
    }

    fn images(&self) -> &dyn IImageGateway {
        self
    }

    fn volumes(&self) -> &dyn IVolumeGateway {
        self
    }

    fn exec(&self) -> &dyn IExecGateway {
        self
    }

    fn system(&self) -> &dyn ISystemGateway {
        self
    }

    fn events(&self) -> &dyn IEventSource {
        self
    }
}

#[async_trait]
impl IContainerGateway for FakeEngine {
    async fn list(&self, query: &ContainerQuery) -> AppResult<Vec<ContainerRecord>> {
        Ok(self
            .containers
            .iter()
            .filter(|ctr| query.all || ctr.state == "running")
            .filter(|ctr| {
                query.volume.as_ref().is_none_or(|volume| {
                    ctr.mounts
                        .iter()
                        .any(|mount| mount.name.as_ref() == Some(volume))
                })
            })
            .cloned()
            .collect())
    }

    async fn inspect(&self, _id: &str) -> AppResult<serde_json::Value> {
        unimplemented!()
    }

    async fn action(&self, _id: &str, _action: ContainerAction) -> AppResult<()> {
        unimplemented!()
    }

    fn logs(&self, _id: &str, _query: &LogQuery) -> OutputStream {
        unimplemented!()
    }

    async fn stats_once(&self, id: &str) -> AppResult<Option<StatsReading>> {
        Ok(self.stats.get(id).copied())
    }

    async fn changes(&self, _id: &str) -> AppResult<Vec<FsChangeDto>> {
        unimplemented!()
    }

    fn archive(&self, _id: &str, _path: &str) -> ByteStream {
        unimplemented!()
    }
}

#[async_trait]
impl IVolumeGateway for FakeEngine {
    async fn list(&self) -> AppResult<Vec<VolumeRecord>> {
        Ok(self.volumes.clone())
    }

    async fn inspect(&self, name: &str) -> AppResult<VolumeRecord> {
        self.volumes
            .iter()
            .find(|volume| volume.name == name)
            .cloned()
            .ok_or_else(|| AppError::Message(format!("no volume {name}")))
    }

    async fn sizes(&self) -> AppResult<Vec<(String, i64)>> {
        Ok(self.sizes.clone())
    }

    async fn remove(&self, _name: &str, _force: bool) -> AppResult<()> {
        unimplemented!()
    }

    async fn prune(&self) -> AppResult<i64> {
        unimplemented!()
    }
}

#[async_trait]
impl IImageGateway for FakeEngine {
    async fn list(&self) -> AppResult<Vec<ImageItemDto>> {
        unimplemented!()
    }

    async fn history(&self, _image: &str) -> AppResult<Vec<LayerHistoryItemDto>> {
        unimplemented!()
    }

    async fn inspect(&self, _image: &str) -> AppResult<serde_json::Value> {
        unimplemented!()
    }

    async fn tag(&self, _id: &str, _repo: &str, _tag: &str) -> AppResult<()> {
        unimplemented!()
    }

    async fn remove(&self, _id: &str, _force: bool) -> AppResult<()> {
        unimplemented!()
    }

    async fn prune(&self, _dangling_only: bool) -> AppResult<i64> {
        unimplemented!()
    }

    fn pull(&self, _image: &str) -> BoxStream<'static, AppResult<PullProgress>> {
        unimplemented!()
    }
}

#[async_trait]
impl IExecGateway for FakeEngine {
    async fn start(&self, _container_id: &str, _spec: ExecSpec) -> AppResult<ExecAttachment> {
        unimplemented!()
    }

    async fn resize(&self, _exec_id: &str, _cols: u16, _rows: u16) -> AppResult<()> {
        unimplemented!()
    }

    async fn exit_code(&self, _exec_id: &str) -> AppResult<Option<i64>> {
        unimplemented!()
    }
}

#[async_trait]
impl ISystemGateway for FakeEngine {
    async fn ping(&self) -> AppResult<()> {
        Ok(())
    }

    async fn version(&self) -> AppResult<EngineVersion> {
        Ok(EngineVersion::default())
    }

    async fn info(&self) -> AppResult<EngineInfo> {
        Ok(EngineInfo::default())
    }
}

impl IEventSource for FakeEngine {
    fn subscribe(&self) -> BoxStream<'static, AppResult<DockerEventDto>> {
        unimplemented!()
    }
}
