use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::models::dto::VolumeItemDto;
use crate::services::volume_service;

#[tauri::command]
pub async fn list_volumes(state: State<'_, AppState>) -> AppResult<Vec<VolumeItemDto>> {
    let client = state.manager.required_client().await?;
    volume_service::list_volumes(&client).await
}

#[tauri::command]
pub async fn remove_volume(state: State<'_, AppState>, name: String, force: bool) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    volume_service::remove_volume(&client, &name, force).await
}

#[tauri::command]
pub async fn prune_volumes(state: State<'_, AppState>) -> AppResult<i64> {
    let client = state.manager.required_client().await?;
    volume_service::prune_volumes(&client).await
}
