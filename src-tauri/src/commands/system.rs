use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::models::dto::SystemInfoDto;
use crate::services::system_service;

#[tauri::command]
pub async fn system_info(state: State<'_, AppState>) -> AppResult<SystemInfoDto> {
    let client = state.manager.required_client().await?;
    system_service::system_info(&client).await
}

#[tauri::command]
pub async fn docker_status(state: State<'_, AppState>) -> AppResult<crate::models::dto::DockerStatusDto> {
    Ok(state.manager.status().await)
}
