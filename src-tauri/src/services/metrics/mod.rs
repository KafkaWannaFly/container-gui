//! Background resource metrics. Every [`INTERVAL`] the collector takes a
//! one-shot stats reading of each live container and keeps a bounded history
//! per container, so charts survive page changes and the UI never talks to
//! the stats endpoint itself. History is also written to SQLite so it
//! survives an app restart.
//!
//! One-shot readings carry no `precpu_stats`, so CPU% and I/O rates are
//! derived from the previous reading we took ourselves.

mod calc;
mod service;

pub use service::MetricsService;

use std::time::Duration;

use async_trait::async_trait;

use crate::models::dto::{MetricsLatestDto, MetricsSeriesDto};

pub const INTERVAL: Duration = Duration::from_secs(2);
const INTERVAL_MS: i64 = INTERVAL.as_millis() as i64;
const RETENTION_MS: i64 = 30 * 60 * 1000;
/// Most samples kept per container in memory.
pub const CAPACITY: usize = (RETENTION_MS / INTERVAL_MS) as usize;

#[async_trait]
pub trait IMetricsService: Send + Sync {
    /// Newest collector sample per live container (all, or just `ids`).
    fn latest(&self, ids: Option<&[String]>) -> Vec<MetricsLatestDto>;
    /// Collector history for `ids` since `since` (epoch ms), downsampled to
    /// at most `max_points` per container.
    fn series(
        &self,
        ids: &[String],
        since: Option<i64>,
        max_points: Option<usize>,
    ) -> MetricsSeriesDto;
    /// One collector tick (`tick` counts from 1). Skips quietly while
    /// disconnected or when the engine poll fails.
    async fn collect(&self, tick: u64);
}
