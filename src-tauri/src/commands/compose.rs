use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::models::dto::{ComposeActionRequest, ComposeProjectDto, ComposeRunDto};
use crate::services::compose_service;

/// Merged config, raw files and metadata for one compose project.
#[tauri::command]
pub async fn compose_project(
    _state: State<'_, AppState>,
    workdir: String,
    files: Vec<String>,
) -> AppResult<ComposeProjectDto> {
    compose_service::project(&workdir, &files).await
}

/// Run an allow-listed `docker compose` lifecycle action.
#[tauri::command]
pub async fn compose_action(request: ComposeActionRequest) -> AppResult<ComposeRunDto> {
    compose_service::run_action(request).await
}
