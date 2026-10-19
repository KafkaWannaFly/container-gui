use tauri::State;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{VolumeDetailDto, VolumeItemDto};

#[tauri::command]
pub async fn volume_detail(state: State<'_, AppState>, name: String) -> AppResult<VolumeDetailDto> {
    state.volumes.detail(&name).await
}

/// Returns immediately from the size cache; sizes are filled in by
/// `refresh_volume_sizes`.
#[tauri::command]
pub async fn list_volumes(state: State<'_, AppState>) -> AppResult<Vec<VolumeItemDto>> {
    state.volumes.list().await
}

/// Slow disk-usage walk that overwrites the cached sizes.
#[tauri::command]
pub async fn refresh_volume_sizes(state: State<'_, AppState>) -> AppResult<()> {
    state.volumes.refresh_sizes().await
}

#[tauri::command]
pub async fn remove_volume(state: State<'_, AppState>, name: String, force: bool) -> AppResult<()> {
    state.volumes.remove(&name, force).await
}

#[tauri::command]
pub async fn prune_volumes(state: State<'_, AppState>) -> AppResult<i64> {
    state.volumes.prune().await
}
