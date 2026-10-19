//! Data-access layer. Each trait is one storage concern; services depend on
//! the traits and `app::bootstrap` picks the implementation. Repositories
//! never call services.

pub mod fs;
pub mod memory;
pub mod sqlite;

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use tokio::sync::{mpsc, oneshot};

use crate::error::AppResult;
use crate::models::dto::{DockerContextDto, MetricSampleDto, MetricsLatestDto};
use crate::models::engine::StatsReading;

/// Persistent metrics history, keyed by endpoint so different daemons never
/// mix.
#[async_trait]
pub trait IMetricsHistoryRepository: Send + Sync {
    async fn insert(&self, endpoint: &str, samples: &[(String, MetricSampleDto)]) -> AppResult<()>;

    /// Samples for `endpoint` at or after `since`, oldest first, per container.
    async fn load(
        &self,
        endpoint: &str,
        since: i64,
    ) -> AppResult<HashMap<String, Vec<MetricSampleDto>>>;

    /// Delete every row older than `cutoff`, across all endpoints.
    async fn prune(&self, cutoff: i64) -> AppResult<u64>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CachedSize {
    pub size_bytes: i64,
    pub measured_at: i64,
}

/// Last measured volume sizes, one row per volume per endpoint.
#[async_trait]
pub trait IVolumeSizeRepository: Send + Sync {
    /// Cached sizes for `endpoint`, keyed by volume name.
    async fn load(&self, endpoint: &str) -> AppResult<HashMap<String, CachedSize>>;

    /// Replace every size stored for `endpoint`, so volumes removed from the
    /// daemon drop out of the cache too.
    async fn replace(
        &self,
        endpoint: &str,
        sizes: &[(String, i64)],
        measured_at: i64,
    ) -> AppResult<()>;
}

/// Live metrics history held in memory: bounded sample series per container,
/// the last raw reading used for rate deltas, and the set of live containers.
pub trait IMetricsRepository: Send + Sync {
    /// Drop all history when the endpoint changes; returns whether it changed.
    fn set_endpoint(&self, endpoint: &str) -> bool;

    /// Seed history loaded from disk, without any previous reading.
    fn restore(&self, history: HashMap<String, Vec<MetricSampleDto>>);

    /// Last reading (and its tick time) of each of `ids` that has one.
    fn previous(&self, ids: &[String]) -> HashMap<String, (i64, StatsReading)>;

    /// Store one tick. Containers missing from `live` lose their previous
    /// reading; samples older than `cutoff` are dropped.
    fn append(
        &self,
        live: HashSet<String>,
        entries: Vec<(String, MetricSampleDto, (i64, StatsReading))>,
        cutoff: i64,
    );

    /// Newest sample of each live container, optionally limited to `ids`.
    fn latest(&self, ids: Option<&[String]>) -> Vec<MetricsLatestDto>;

    /// Samples at or after `since` for each of `ids`, oldest first.
    fn samples_since(&self, ids: &[String], since: i64) -> Vec<(String, Vec<MetricSampleDto>)>;
}

/// Handle a stream task holds: select on `cancelled`, then pass the token
/// back to [`IStreamRegistry::finish`].
pub struct StreamTicket {
    pub token: u64,
    pub cancelled: oneshot::Receiver<()>,
}

/// Cancellation handles for in-flight streams. Log/exec streams are keyed by
/// a caller-chosen stream id; pulls by image name.
pub trait IStreamRegistry: Send + Sync {
    /// Register `stream_id`. Re-registering an id cancels the previous task.
    fn register(&self, stream_id: String) -> StreamTicket;
    fn cancel(&self, stream_id: &str);
    /// Drop the entry once the task ends, unless a newer task re-registered
    /// the same id in the meantime.
    fn finish(&self, stream_id: &str, token: u64);

    fn register_pull(&self, image: String) -> oneshot::Receiver<()>;
    fn cancel_pull(&self, image: &str);
    fn finish_pull(&self, image: &str);
}

/// Input side of live exec sessions, keyed by the caller's stream id.
pub trait IExecSessionRepository: Send + Sync {
    fn insert(&self, stream_id: String, exec_id: String, input: mpsc::UnboundedSender<Vec<u8>>);
    /// Remove `stream_id` only if it still belongs to `exec_id`.
    fn remove(&self, stream_id: &str, exec_id: &str);
    fn input(&self, stream_id: &str) -> Option<mpsc::UnboundedSender<Vec<u8>>>;
    fn exec_id(&self, stream_id: &str) -> Option<String>;
}

/// Docker CLI contexts stored under `~/.docker`.
pub trait IDockerContextRepository: Send + Sync {
    /// `currentContext` from `config.json`.
    fn current_context(&self) -> Option<String>;
    /// Engine host of a named context.
    fn context_host(&self, name: &str) -> Option<String>;
    /// Every stored context except the built-in `default`.
    fn list(&self) -> Vec<DockerContextDto>;
}
