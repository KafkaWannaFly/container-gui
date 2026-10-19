//! Container-engine gateway. Every engine (Docker today, Podman later)
//! implements [`IEngineConnector`] and [`IEngine`]; services only see these
//! traits and the engine-neutral records in `models::engine`. Only the
//! adapter modules (`docker/`) may import an engine SDK such as bollard.

pub mod docker;
pub mod target;

use std::pin::Pin;
use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use futures_util::stream::BoxStream;
use tokio::io::AsyncWrite;

use crate::error::AppResult;
use crate::models::dto::{DockerEventDto, FsChangeDto, ImageItemDto, LayerHistoryItemDto};
use crate::models::engine::{
    ContainerAction, ContainerQuery, ContainerRecord, EngineInfo, EngineVersion, ExecSpec,
    LogQuery, OutputChunk, PullProgress, StatsReading, VolumeRecord,
};
pub use target::ConnectionTarget;

pub type OutputStream = BoxStream<'static, AppResult<OutputChunk>>;
pub type ByteStream = BoxStream<'static, std::io::Result<Bytes>>;

/// Resolves endpoints and opens engine clients.
pub trait IEngineConnector: Send + Sync {
    /// Built-in local endpoint of this engine on this platform.
    fn platform_default(&self) -> ConnectionTarget;
    /// Best-effort endpoint: environment, then CLI context, then platform default.
    fn default_target(&self) -> ConnectionTarget;
    /// Open a client for `target`. Does not verify the engine is reachable;
    /// callers ping through [`ISystemGateway`].
    fn connect(&self, target: &ConnectionTarget) -> AppResult<Arc<dyn IEngine>>;
}

/// One connected engine, grouped by resource.
pub trait IEngine: Send + Sync {
    fn containers(&self) -> &dyn IContainerGateway;
    fn images(&self) -> &dyn IImageGateway;
    fn volumes(&self) -> &dyn IVolumeGateway;
    fn exec(&self) -> &dyn IExecGateway;
    fn system(&self) -> &dyn ISystemGateway;
    fn events(&self) -> &dyn IEventSource;
}

#[async_trait]
pub trait IContainerGateway: Send + Sync {
    async fn list(&self, query: &ContainerQuery) -> AppResult<Vec<ContainerRecord>>;
    /// Raw inspect payload, passed through as JSON so the UI can read any
    /// engine-version-specific field.
    async fn inspect(&self, id: &str) -> AppResult<serde_json::Value>;
    async fn action(&self, id: &str, action: ContainerAction) -> AppResult<()>;
    fn logs(&self, id: &str, query: &LogQuery) -> OutputStream;
    /// One stats reading; `None` when the engine sent nothing.
    async fn stats_once(&self, id: &str) -> AppResult<Option<StatsReading>>;
    async fn changes(&self, id: &str) -> AppResult<Vec<FsChangeDto>>;
    /// `path` as a tar stream (works on stopped containers too).
    fn archive(&self, id: &str, path: &str) -> ByteStream;
}

#[async_trait]
pub trait IImageGateway: Send + Sync {
    async fn list(&self) -> AppResult<Vec<ImageItemDto>>;
    async fn history(&self, image: &str) -> AppResult<Vec<LayerHistoryItemDto>>;
    async fn inspect(&self, image: &str) -> AppResult<serde_json::Value>;
    async fn tag(&self, id: &str, repo: &str, tag: &str) -> AppResult<()>;
    async fn remove(&self, id: &str, force: bool) -> AppResult<()>;
    /// Returns the reclaimed bytes.
    async fn prune(&self, dangling_only: bool) -> AppResult<i64>;
    fn pull(&self, image: &str) -> BoxStream<'static, AppResult<PullProgress>>;
}

#[async_trait]
pub trait IVolumeGateway: Send + Sync {
    async fn list(&self) -> AppResult<Vec<VolumeRecord>>;
    async fn inspect(&self, name: &str) -> AppResult<VolumeRecord>;
    /// Slow disk-usage walk. Only volumes whose size is known.
    async fn sizes(&self) -> AppResult<Vec<(String, i64)>>;
    async fn remove(&self, name: &str, force: bool) -> AppResult<()>;
    /// Prunes every unused volume (named ones too); returns reclaimed bytes.
    async fn prune(&self) -> AppResult<i64>;
}

/// An attached exec process.
pub struct ExecAttachment {
    pub exec_id: String,
    pub output: OutputStream,
    pub input: Pin<Box<dyn AsyncWrite + Send>>,
}

#[async_trait]
pub trait IExecGateway: Send + Sync {
    async fn start(&self, container_id: &str, spec: ExecSpec) -> AppResult<ExecAttachment>;
    async fn resize(&self, exec_id: &str, cols: u16, rows: u16) -> AppResult<()>;
    async fn exit_code(&self, exec_id: &str) -> AppResult<Option<i64>>;
}

#[async_trait]
pub trait ISystemGateway: Send + Sync {
    async fn ping(&self) -> AppResult<()>;
    async fn version(&self) -> AppResult<EngineVersion>;
    async fn info(&self) -> AppResult<EngineInfo>;
}

pub trait IEventSource: Send + Sync {
    /// Container, image and volume events until the connection drops.
    fn subscribe(&self) -> BoxStream<'static, AppResult<DockerEventDto>>;
}
