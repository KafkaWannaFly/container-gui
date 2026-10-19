use tauri::State;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{ConnectionConfig, DockerContextDto, DockerStatusDto};

#[tauri::command]
pub async fn list_contexts(state: State<'_, AppState>) -> AppResult<Vec<DockerContextDto>> {
    Ok(state.connection.list_contexts())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> AppResult<DockerStatusDto> {
    state.connection.test(&config).await
}

#[tauri::command]
pub async fn switch_docker_endpoint(
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> AppResult<DockerStatusDto> {
    state.connection.switch(&config).await
}
