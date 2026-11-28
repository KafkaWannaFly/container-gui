//! HTTP downloads for install artifacts (WSL rootfs images). Progress is
//! reported into a sink; dropping the future aborts the transfer and removes
//! the partial file.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use crate::models::dto::DownloadProgressDto;
use crate::services::infrastructure::IEventSink;

#[async_trait]
pub trait IHttpDownloader: Send + Sync {
    /// GET `url` and return the body as text (small listings, manifests).
    async fn text(&self, url: &str) -> AppResult<String>;
    /// Stream `url` into `dest`, reporting byte progress. A closed sink
    /// cancels the download ([`AppError::Cancelled`]); partial files are
    /// removed on any failure.
    async fn download(
        &self,
        url: &str,
        dest: &Path,
        sink: Arc<dyn IEventSink<DownloadProgressDto>>,
    ) -> AppResult<()>;
}

#[derive(bon::Builder)]
pub struct ReqwestDownloader {
    #[builder(skip)]
    client: reqwest::Client,
}

#[async_trait]
impl IHttpDownloader for ReqwestDownloader {
    async fn text(&self, url: &str) -> AppResult<String> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|err| AppError::Message(format!("GET {url} failed: {err}")))?;
        response
            .text()
            .await
            .map_err(|err| AppError::Message(format!("Reading {url} failed: {err}")))
    }

    async fn download(
        &self,
        url: &str,
        dest: &Path,
        sink: Arc<dyn IEventSink<DownloadProgressDto>>,
    ) -> AppResult<()> {
        let result = transfer(&self.client, url, dest, sink).await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(dest).await;
        }
        result
    }
}

async fn transfer(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    sink: Arc<dyn IEventSink<DownloadProgressDto>>,
) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|err| {
            AppError::Message(format!("Could not create {}: {err}", parent.display()))
        })?;
    }
    let response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|err| AppError::Message(format!("GET {url} failed: {err}")))?;
    let total_bytes = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|err| AppError::Message(format!("Could not create {}: {err}", dest.display())))?;
    let mut bytes: u64 = 0;
    let _ = sink.send(DownloadProgressDto { bytes, total_bytes });
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|err| AppError::Message(format!("Download {url} failed: {err}")))?;
        file.write_all(&chunk).await.map_err(|err| {
            AppError::Message(format!("Writing {} failed: {err}", dest.display()))
        })?;
        bytes += chunk.len() as u64;
        if !sink.send(DownloadProgressDto { bytes, total_bytes }) {
            return Err(AppError::Cancelled);
        }
    }
    file.flush()
        .await
        .map_err(|err| AppError::Message(format!("Writing {} failed: {err}", dest.display())))?;
    Ok(())
}
