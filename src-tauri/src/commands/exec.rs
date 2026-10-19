use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{ExecEventDto, ExecProbeDto, ExecStartOptions};

/// Shells, users and distro available inside a running container.
#[tauri::command]
pub async fn exec_probe(state: State<'_, AppState>, id: String) -> AppResult<ExecProbeDto> {
    state.exec.probe(&id).await
}

/// Start an interactive session; output arrives on `on_event`, input goes
/// through `exec_input`, and `stop_stream` ends it.
#[tauri::command]
pub async fn exec_start(
    state: State<'_, AppState>,
    id: String,
    stream_id: String,
    options: ExecStartOptions,
    on_event: Channel<ExecEventDto>,
) -> AppResult<()> {
    state
        .exec
        .start(id, stream_id, options, Arc::new(on_event))
        .await
}

#[tauri::command]
pub async fn exec_input(
    state: State<'_, AppState>,
    stream_id: String,
    data: String,
) -> AppResult<()> {
    state.exec.input(&stream_id, data.into_bytes())
}

#[tauri::command]
pub async fn exec_resize(
    state: State<'_, AppState>,
    stream_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    state.exec.resize(&stream_id, cols, rows).await
}
