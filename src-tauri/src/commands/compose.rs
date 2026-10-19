use tauri::State;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{ComposeActionRequest, ComposeProjectDto, ComposeRunDto};

/// Merged config, raw files and metadata for one compose project.
#[tauri::command]
pub async fn compose_project(
    state: State<'_, AppState>,
    workdir: String,
    files: Vec<String>,
) -> AppResult<ComposeProjectDto> {
    state.compose.project(&workdir, &files).await
}

/// Run an allow-listed `docker compose` lifecycle action.
#[tauri::command]
pub async fn compose_action(
    state: State<'_, AppState>,
    request: ComposeActionRequest,
) -> AppResult<ComposeRunDto> {
    state.compose.run_action(request).await
}
