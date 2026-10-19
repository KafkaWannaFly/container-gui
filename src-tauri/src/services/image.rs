//! Image listing, pulls with layer progress, history, tagging and pruning.

use std::sync::Arc;

use async_trait::async_trait;
use futures_util::StreamExt;

use crate::error::AppResult;
use crate::models::dto::{ImageItemDto, ImagePullProgressDto, LayerHistoryItemDto};
use crate::models::engine::PullProgress;
use crate::repositories::IStreamRegistry;
use crate::services::infrastructure::IEventSink;
use crate::services::session::IEngineSession;

#[async_trait]
pub trait IImageService: Send + Sync {
    async fn list(&self) -> AppResult<Vec<ImageItemDto>>;
    /// Spawn a pull that reports per-layer progress into `sink` until
    /// completion, failure, or [`IImageService::cancel_pull`].
    async fn pull(
        &self,
        image: String,
        sink: Arc<dyn IEventSink<ImagePullProgressDto>>,
    ) -> AppResult<()>;
    fn cancel_pull(&self, image: &str);
    async fn history(&self, image: &str) -> AppResult<Vec<LayerHistoryItemDto>>;
    async fn inspect(&self, image: &str) -> AppResult<serde_json::Value>;
    async fn tag(&self, id: &str, repo: &str, tag: &str) -> AppResult<()>;
    async fn remove(&self, id: &str, force: bool) -> AppResult<()>;
    async fn prune(&self, dangling_only: bool) -> AppResult<i64>;
}

#[derive(bon::Builder)]
pub struct ImageService {
    session: Arc<dyn IEngineSession>,
    streams: Arc<dyn IStreamRegistry>,
}

/// `None` for the empty keep-alive messages some registries send.
fn progress_of(progress: PullProgress) -> Option<ImagePullProgressDto> {
    if progress.id.is_empty() && progress.status.is_empty() {
        return None;
    }
    let percent = if progress.total > 0 {
        (progress.current as f64 / progress.total as f64) * 100.0
    } else {
        0.0
    };
    Some(ImagePullProgressDto {
        id: progress.id,
        status: progress.status,
        current_bytes: progress.current,
        total_bytes: progress.total,
        percent,
    })
}

#[async_trait]
impl IImageService for ImageService {
    async fn list(&self) -> AppResult<Vec<ImageItemDto>> {
        self.session.engine().await?.images().list().await
    }

    async fn pull(
        &self,
        image: String,
        sink: Arc<dyn IEventSink<ImagePullProgressDto>>,
    ) -> AppResult<()> {
        let engine = self.session.engine().await?;
        let mut cancelled = self.streams.register_pull(image.clone());
        let streams = self.streams.clone();

        tokio::spawn(async move {
            let mut stream = engine.images().pull(&image);
            loop {
                tokio::select! {
                    _ = &mut cancelled => break,
                    item = stream.next() => match item {
                        Some(Ok(progress)) => {
                            let Some(progress) = progress_of(progress) else {
                                continue;
                            };
                            if !sink.send(progress) {
                                break;
                            }
                        }
                        Some(Err(_)) | None => break,
                    },
                }
            }
            streams.finish_pull(&image);
        });
        Ok(())
    }

    fn cancel_pull(&self, image: &str) {
        self.streams.cancel_pull(image);
    }

    async fn history(&self, image: &str) -> AppResult<Vec<LayerHistoryItemDto>> {
        self.session.engine().await?.images().history(image).await
    }

    /// Raw image inspect JSON (config, digests, platform).
    async fn inspect(&self, image: &str) -> AppResult<serde_json::Value> {
        self.session.engine().await?.images().inspect(image).await
    }

    async fn tag(&self, id: &str, repo: &str, tag: &str) -> AppResult<()> {
        self.session
            .engine()
            .await?
            .images()
            .tag(id, repo, tag)
            .await
    }

    async fn remove(&self, id: &str, force: bool) -> AppResult<()> {
        self.session
            .engine()
            .await?
            .images()
            .remove(id, force)
            .await
    }

    async fn prune(&self, dangling_only: bool) -> AppResult<i64> {
        self.session
            .engine()
            .await?
            .images()
            .prune(dangling_only)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_skips_empty_and_computes_percent() {
        assert!(progress_of(PullProgress::default()).is_none());
        let dto = progress_of(PullProgress {
            id: "layer".into(),
            status: "Downloading".into(),
            current: 25,
            total: 100,
        })
        .unwrap();
        assert_eq!(dto.percent, 25.0);
    }
}
