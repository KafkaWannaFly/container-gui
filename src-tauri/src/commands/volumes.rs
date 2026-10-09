use std::collections::HashMap;

use tauri::State;

use crate::AppState;
use crate::docker::metrics::now_ms;
use crate::error::{AppError, AppResult};
use crate::models::dto::{VolumeDetailDto, VolumeItemDto};
use crate::services::volume_service;

#[tauri::command]
pub async fn volume_detail(state: State<'_, AppState>, name: String) -> AppResult<VolumeDetailDto> {
    let client = state.manager.required_client().await?;
    volume_service::volume_detail(&client, &name).await
}

/// Returns immediately from the size cache; sizes are filled in by
/// `refresh_volume_sizes`. A cache read failure degrades to "unknown sizes".
#[tauri::command]
pub async fn list_volumes(state: State<'_, AppState>) -> AppResult<Vec<VolumeItemDto>> {
    let client = state.manager.required_client().await?;
    let endpoint = state.manager.endpoint().await;
    let cached = state.volumes.load(&endpoint).await.unwrap_or_else(|err| {
        log::warn!("[volumes] size cache read failed: {err}");
        HashMap::new()
    });
    volume_service::list_volumes(&client, &cached).await
}

/// Slow disk-usage walk. Overwrites the cached sizes on success; a call that
/// arrives while one is running returns without doing anything.
#[tauri::command]
pub async fn refresh_volume_sizes(state: State<'_, AppState>) -> AppResult<()> {
    let Some(_guard) = state.volumes.try_begin_refresh() else {
        return Ok(());
    };
    let client = state.manager.required_client().await?;
    let endpoint = state.manager.endpoint().await;
    let sizes = volume_service::measure_volume_sizes(&client).await?;
    state
        .volumes
        .replace(&endpoint, &sizes, now_ms())
        .await
        .map_err(|err| AppError::Message(format!("saving volume sizes: {err}")))
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
