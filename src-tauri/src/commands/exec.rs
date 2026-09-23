use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::models::dto::{ExecEventDto, ExecProbeDto, ExecStartOptions};
use crate::services::exec_service;

/// Shells, users and distro available inside a running container.
#[tauri::command]
pub async fn exec_probe(state: State<'_, AppState>, id: String) -> AppResult<ExecProbeDto> {
    let client = state.manager.required_client().await?;
    exec_service::probe(&client, &id).await
}

/// Start an interactive session; output arrives on `on_event`, input goes
/// through `exec_input`, and `stop_stream` ends it.
#[tauri::command]
pub async fn exec_start(
    state: State<'_, AppState>,
    id: String,
    stream_id: String,
    options: ExecStartOptions,
    on_event: tauri::ipc::Channel<ExecEventDto>,
) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    exec_service::start(
        client,
        state.streams.clone(),
        state.execs.clone(),
        id,
        stream_id,
        options,
        on_event,
    )
    .await
}

#[tauri::command]
pub async fn exec_input(
    state: State<'_, AppState>,
    stream_id: String,
    data: String,
) -> AppResult<()> {
    state.execs.write(&stream_id, data.into_bytes())
}

#[tauri::command]
pub async fn exec_resize(
    state: State<'_, AppState>,
    stream_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    exec_service::resize(&client, &state.execs, &stream_id, cols, rows).await
}
