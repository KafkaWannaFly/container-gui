use std::path::PathBuf;

use tauri::State;

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::models::dto::{DirListingDto, FileContentDto, FsChangeDto};
use crate::services::files_service;

/// Entries per listing by default; the UI can ask for more.
const DEFAULT_LIST_LIMIT: usize = 1_000;
const MAX_LIST_LIMIT: usize = 20_000;
/// Preview cap: large files are downloaded, not rendered.
const DEFAULT_PREVIEW_BYTES: u64 = 1024 * 1024;

/// Write text the UI already holds (env export, Dockerfile, file preview) to
/// the path the user chose in the save dialog. Returns the full path.
#[tauri::command]
pub async fn save_text_to_file(dest: String, contents: String) -> AppResult<String> {
    tokio::fs::write(&dest, contents)
        .await
        .map_err(|err| AppError::Message(format!("Could not write {dest}: {err}")))?;
    Ok(dest)
}

/// List one directory (running containers only — it runs `find`/`stat`).
#[tauri::command]
pub async fn list_container_dir(
    state: State<'_, AppState>,
    id: String,
    path: String,
    limit: Option<usize>,
) -> AppResult<DirListingDto> {
    let client = state.manager.required_client().await?;
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    files_service::list_dir(&client, &id, &path, limit).await
}

/// Read up to `max_bytes` of a path; works on stopped containers too.
#[tauri::command]
pub async fn read_container_file(
    state: State<'_, AppState>,
    id: String,
    path: String,
    max_bytes: Option<u64>,
) -> AppResult<FileContentDto> {
    let client = state.manager.required_client().await?;
    let max = max_bytes.unwrap_or(DEFAULT_PREVIEW_BYTES);
    files_service::read_file(&client, &id, &path, max).await
}

#[tauri::command]
pub async fn container_changes(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<FsChangeDto>> {
    let client = state.manager.required_client().await?;
    files_service::changes(&client, &id).await
}

/// Save a file (or a directory as .tar) to the path the user chose in the
/// save dialog; returns the path.
#[tauri::command]
pub async fn save_container_path(
    state: State<'_, AppState>,
    id: String,
    path: String,
    as_archive: bool,
    dest: String,
) -> AppResult<String> {
    let client = state.manager.required_client().await?;
    let dest = PathBuf::from(dest);
    if let Err(err) = files_service::save_path(&client, &id, &path, &dest, as_archive).await {
        let _ = tokio::fs::remove_file(&dest).await;
        return Err(err);
    }
    Ok(dest.display().to_string())
}
