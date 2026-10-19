use tauri::State;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{DockerStatusDto, SystemInfoDto};

#[tauri::command]
pub async fn system_info(state: State<'_, AppState>) -> AppResult<SystemInfoDto> {
    state.system.info().await
}

#[tauri::command]
pub async fn docker_status(state: State<'_, AppState>) -> AppResult<DockerStatusDto> {
    Ok(state.connection.status().await)
}
