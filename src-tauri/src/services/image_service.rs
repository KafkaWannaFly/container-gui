//! Image listing, pulls with layer progress, history, tagging and pruning.

use std::collections::HashMap;
use std::sync::Arc;

use bollard::Docker;
use bollard::query_parameters::{
    CreateImageOptionsBuilder, ListImagesOptionsBuilder, PruneImagesOptionsBuilder,
    RemoveImageOptionsBuilder, TagImageOptionsBuilder,
};
use futures_util::StreamExt;
use tauri::ipc::Channel;
use tokio::sync::oneshot;

use crate::docker::state::StreamRegistry;
use crate::error::AppResult;
use crate::models::dto::{ImageItemDto, ImagePullProgressDto, LayerHistoryItemDto};

pub async fn list_images(client: &Docker) -> AppResult<Vec<ImageItemDto>> {
    let options = ListImagesOptionsBuilder::new().all(true).build();
    let images = client.list_images(Some(options)).await?;
    Ok(images
        .into_iter()
        .map(|image| ImageItemDto {
            id: image.id,
            repo_tags: image.repo_tags,
            size: image.size,
            created: image.created,
        })
        .collect())
}

pub async fn image_history(client: &Docker, image: &str) -> AppResult<Vec<LayerHistoryItemDto>> {
    let history = client.image_history(image).await?;
    Ok(history
        .into_iter()
        .map(|layer| LayerHistoryItemDto {
            id: layer.id,
            created: layer.created,
            created_by: layer.created_by,
            size: layer.size,
            tags: layer.tags,
            comment: layer.comment,
        })
        .collect())
}

pub async fn tag_image(client: &Docker, id: &str, repo: &str, tag: &str) -> AppResult<()> {
    let options = TagImageOptionsBuilder::new().repo(repo).tag(tag).build();
    client.tag_image(id, Some(options)).await?;
    Ok(())
}

pub async fn remove_image(client: &Docker, id: &str, force: bool) -> AppResult<()> {
    let options = RemoveImageOptionsBuilder::new().force(force).build();
    client.remove_image(id, Some(options), None).await?;
    Ok(())
}

pub async fn prune_images(client: &Docker, dangling_only: bool) -> AppResult<i64> {
    let options = if dangling_only {
        let filters = HashMap::from([("dangling".to_string(), vec!["true".to_string()])]);
        PruneImagesOptionsBuilder::new().filters(&filters).build()
    } else {
        PruneImagesOptionsBuilder::new().build()
    };
    let response = client.prune_images(Some(options)).await?;
    Ok(response.space_reclaimed.unwrap_or_default())
}

/// Spawn a pull task that reports per-layer progress until completion,
/// failure, or cancellation.
pub fn spawn_pull(
    client: Docker,
    registry: Arc<StreamRegistry>,
    image: String,
    channel: Channel<ImagePullProgressDto>,
) {
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    registry.register_pull(image.clone(), cancel_tx);

    tauri::async_runtime::spawn(async move {
        let options = CreateImageOptionsBuilder::new().from_image(&image).build();
        let mut stream = client.create_image(Some(options), None, None).boxed();

        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                item = stream.next() => {
                    match item {
                        Some(Ok(info)) => {
                            let id = info.id.unwrap_or_default();
                            let status = info.status.unwrap_or_default();
                            if id.is_empty() && status.is_empty() {
                                continue;
                            }
                            let current = info
                                .progress_detail
                                .as_ref()
                                .and_then(|detail| detail.current)
                                .unwrap_or_default();
                            let total = info
                                .progress_detail
                                .as_ref()
                                .and_then(|detail| detail.total)
                                .unwrap_or_default();
                            let percent = if total > 0 {
                                (current as f64 / total as f64) * 100.0
                            } else {
                                0.0
                            };
                            let progress = ImagePullProgressDto {
                                id,
                                status,
                                current_bytes: current,
                                total_bytes: total,
                                percent,
                            };
                            if channel.send(progress).is_err() {
                                break;
                            }
                        }
                        Some(Err(_)) | None => break,
                    }
                }
            }
        }

        registry.finish_pull(&image);
    });
}
