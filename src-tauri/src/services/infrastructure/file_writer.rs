//! Writes to paths the user chose in a save dialog.

use std::path::Path;
use std::pin::Pin;

use async_trait::async_trait;
use tokio::io::AsyncWrite;

pub type FileOut = Pin<Box<dyn AsyncWrite + Send>>;

#[async_trait]
pub trait IFileWriter: Send + Sync {
    async fn write(&self, dest: &Path, contents: &[u8]) -> std::io::Result<()>;
    /// Create (or truncate) `dest` for streaming writes. Callers flush.
    async fn create(&self, dest: &Path) -> std::io::Result<FileOut>;
    /// Best-effort removal of a partial file.
    async fn remove(&self, dest: &Path);
}

#[derive(Default, bon::Builder)]
pub struct TokioFileWriter {}

#[async_trait]
impl IFileWriter for TokioFileWriter {
    async fn write(&self, dest: &Path, contents: &[u8]) -> std::io::Result<()> {
        tokio::fs::write(dest, contents).await
    }

    async fn create(&self, dest: &Path) -> std::io::Result<FileOut> {
        let file = tokio::fs::File::create(dest).await?;
        Ok(Box::pin(tokio::io::BufWriter::new(file)))
    }

    async fn remove(&self, dest: &Path) {
        let _ = tokio::fs::remove_file(dest).await;
    }
}
