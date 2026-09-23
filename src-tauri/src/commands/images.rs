use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::models::dto::{ImageItemDto, ImagePullProgressDto, LayerHistoryItemDto};
use crate::services::image_service;

#[tauri::command]
pub async fn list_images(state: State<'_, AppState>) -> AppResult<Vec<ImageItemDto>> {
    let client = state.manager.required_client().await?;
    image_service::list_images(&client).await
}

#[tauri::command]
pub async fn pull_image(
    state: State<'_, AppState>,
    image_name: String,
    on_progress: tauri::ipc::Channel<ImagePullProgressDto>,
) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    image_service::spawn_pull(client, state.streams.clone(), image_name, on_progress);
    Ok(())
}

#[tauri::command]
pub async fn cancel_pull(state: State<'_, AppState>, image_name: String) -> AppResult<()> {
    state.streams.cancel_pull(&image_name);
    Ok(())
}

#[tauri::command]
pub async fn image_history(
    state: State<'_, AppState>,
    image: String,
) -> AppResult<Vec<LayerHistoryItemDto>> {
    let client = state.manager.required_client().await?;
    image_service::image_history(&client, &image).await
}

/// Raw image inspect JSON (config, digests, platform).
#[tauri::command]
pub async fn inspect_image(
    state: State<'_, AppState>,
    image: String,
) -> AppResult<serde_json::Value> {
    let client = state.manager.required_client().await?;
    image_service::inspect_image(&client, &image).await
}

#[tauri::command]
pub async fn tag_image(
    state: State<'_, AppState>,
    id: String,
    repo: String,
    tag: String,
) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    image_service::tag_image(&client, &id, &repo, &tag).await
}

#[tauri::command]
pub async fn remove_image(state: State<'_, AppState>, id: String, force: bool) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    image_service::remove_image(&client, &id, force).await
}

#[tauri::command]
pub async fn prune_images(state: State<'_, AppState>, dangling_only: bool) -> AppResult<i64> {
    let client = state.manager.required_client().await?;
    image_service::prune_images(&client, dangling_only).await
}
