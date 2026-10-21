//! Container listing, inspection, lifecycle actions and log streams.

mod logs;
mod service;

use std::sync::Arc;

use async_trait::async_trait;
pub use service::ContainerService;

use crate::error::AppResult;
use crate::models::dto::{ContainerSummaryDto, LogEventDto, LogStreamOptions};
use crate::services::infrastructure::IEventSink;

#[async_trait]
pub trait IContainerService: Send + Sync {
    async fn list(&self, all: bool) -> AppResult<Vec<ContainerSummaryDto>>;
    async fn inspect(&self, id: &str) -> AppResult<serde_json::Value>;
    async fn action(&self, id: &str, action: &str) -> AppResult<()>;
    /// Spawn a logs task that sends line batches into `sink` until the
    /// container stops, the stream errors, or `stream_id` is cancelled.
    /// Always finishes with one `End` event.
    async fn stream_logs(
        &self,
        id: String,
        stream_id: String,
        options: LogStreamOptions,
        sink: Arc<dyn IEventSink<LogEventDto>>,
    ) -> AppResult<()>;
    /// Write the full log (both streams, with timestamps) to `dest`; returns
    /// the path.
    async fn save_logs(&self, id: &str, dest: &str) -> AppResult<String>;
}
