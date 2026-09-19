use tauri::State;

use crate::AppState;
use crate::docker::{connection, state};
use crate::error::AppResult;
use crate::models::dto::{ConnectionConfig, DockerContextDto, DockerStatusDto};

#[tauri::command]
pub async fn list_contexts() -> Vec<DockerContextDto> {
    connection::list_contexts()
}

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> AppResult<DockerStatusDto> {
    let target = connection::target_from_config(&config)?;
    state::probe_target(&target).await
}

#[tauri::command]
pub async fn switch_docker_endpoint(
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> AppResult<DockerStatusDto> {
    state.manager.apply_config(&config).await
}
