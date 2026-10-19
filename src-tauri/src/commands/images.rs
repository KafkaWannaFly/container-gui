use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{ImageItemDto, ImagePullProgressDto, LayerHistoryItemDto};

#[tauri::command]
pub async fn list_images(state: State<'_, AppState>) -> AppResult<Vec<ImageItemDto>> {
    state.images.list().await
}

#[tauri::command]
pub async fn pull_image(
    state: State<'_, AppState>,
    image_name: String,
    on_progress: Channel<ImagePullProgressDto>,
) -> AppResult<()> {
    state.images.pull(image_name, Arc::new(on_progress)).await
}

#[tauri::command]
pub async fn cancel_pull(state: State<'_, AppState>, image_name: String) -> AppResult<()> {
    state.images.cancel_pull(&image_name);
    Ok(())
}

#[tauri::command]
pub async fn image_history(
    state: State<'_, AppState>,
    image: String,
) -> AppResult<Vec<LayerHistoryItemDto>> {
    state.images.history(&image).await
}

/// Raw image inspect JSON (config, digests, platform).
#[tauri::command]
pub async fn inspect_image(
    state: State<'_, AppState>,
    image: String,
) -> AppResult<serde_json::Value> {
    state.images.inspect(&image).await
}

#[tauri::command]
pub async fn tag_image(
    state: State<'_, AppState>,
    id: String,
    repo: String,
    tag: String,
) -> AppResult<()> {
    state.images.tag(&id, &repo, &tag).await
}

#[tauri::command]
pub async fn remove_image(state: State<'_, AppState>, id: String, force: bool) -> AppResult<()> {
    state.images.remove(&id, force).await
}

#[tauri::command]
pub async fn prune_images(state: State<'_, AppState>, dangling_only: bool) -> AppResult<i64> {
    state.images.prune(dangling_only).await
}
