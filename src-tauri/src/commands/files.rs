use tauri::State;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{DirListingDto, FileContentDto, FsChangeDto};

/// Write text the UI already holds (env export, Dockerfile, file preview) to
/// the path the user chose in the save dialog. Returns the full path.
#[tauri::command]
pub async fn save_text_to_file(
    state: State<'_, AppState>,
    dest: String,
    contents: String,
) -> AppResult<String> {
    state.files.save_text(dest, contents).await
}

/// List one directory (running containers only).
#[tauri::command]
pub async fn list_container_dir(
    state: State<'_, AppState>,
    id: String,
    path: String,
    limit: Option<usize>,
) -> AppResult<DirListingDto> {
    state.files.list_dir(&id, &path, limit).await
}

/// Read up to `max_bytes` of a path; works on stopped containers too.
#[tauri::command]
pub async fn read_container_file(
    state: State<'_, AppState>,
    id: String,
    path: String,
    max_bytes: Option<u64>,
) -> AppResult<FileContentDto> {
    state.files.read_file(&id, &path, max_bytes).await
}

#[tauri::command]
pub async fn container_changes(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<FsChangeDto>> {
    state.files.changes(&id).await
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
    state.files.save_path(&id, &path, as_archive, dest).await
}
