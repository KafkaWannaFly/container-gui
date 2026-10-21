use std::collections::HashMap;

use async_trait::async_trait;
use bollard::query_parameters::{
    CreateImageOptionsBuilder, ListImagesOptionsBuilder, PruneImagesOptionsBuilder,
    RemoveImageOptionsBuilder, TagImageOptionsBuilder,
};
use futures_util::StreamExt;
use futures_util::stream::BoxStream;

use super::DockerEngine;
use crate::error::AppResult;
use crate::models::dto::{ImageItemDto, LayerHistoryItemDto};
use crate::models::engine::PullProgress;
use crate::services::engine::IImageGateway;

#[async_trait]
impl IImageGateway for DockerEngine {
    async fn list(&self) -> AppResult<Vec<ImageItemDto>> {
        let options = ListImagesOptionsBuilder::new().all(true).build();
        let images = self.client.list_images(Some(options)).await?;
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

    async fn history(&self, image: &str) -> AppResult<Vec<LayerHistoryItemDto>> {
        let history = self.client.image_history(image).await?;
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

    async fn inspect(&self, image: &str) -> AppResult<serde_json::Value> {
        let response = self.client.inspect_image(image).await?;
        Ok(serde_json::to_value(response)?)
    }

    async fn tag(&self, id: &str, repo: &str, tag: &str) -> AppResult<()> {
        let options = TagImageOptionsBuilder::new().repo(repo).tag(tag).build();
        self.client.tag_image(id, Some(options)).await?;
        Ok(())
    }

    async fn remove(&self, id: &str, force: bool) -> AppResult<()> {
        let options = RemoveImageOptionsBuilder::new().force(force).build();
        self.client.remove_image(id, Some(options), None).await?;
        Ok(())
    }

    async fn prune(&self, dangling_only: bool) -> AppResult<i64> {
        let filters = HashMap::from([("dangling".to_string(), vec![dangling_only.to_string()])]);
        let options = PruneImagesOptionsBuilder::new().filters(&filters).build();
        let response = self.client.prune_images(Some(options)).await?;
        Ok(response.space_reclaimed.unwrap_or_default())
    }

    fn pull(&self, image: &str) -> BoxStream<'static, AppResult<PullProgress>> {
        let options = CreateImageOptionsBuilder::new().from_image(image).build();
        self.client
            .create_image(Some(options), None, None)
            .map(|item| {
                let info = item?;
                let detail = info.progress_detail.as_ref();
                Ok(PullProgress {
                    current: detail.and_then(|d| d.current).unwrap_or_default(),
                    total: detail.and_then(|d| d.total).unwrap_or_default(),
                    id: info.id.unwrap_or_default(),
                    status: info.status.unwrap_or_default(),
                })
            })
            .boxed()
    }
}
