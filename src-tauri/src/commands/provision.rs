use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{EnvironmentReportDto, InstallEventDto, InstallRequest};

/// Host capabilities the setup wizard checks before offering an install.
#[tauri::command]
pub async fn environment_report(state: State<'_, AppState>) -> AppResult<EnvironmentReportDto> {
    Ok(state.environment.report().await)
}

/// Install a backend-only engine, streaming phases/output into `on_event`.
/// Cancellable through `stop_stream(stream_id)`.
#[tauri::command]
pub async fn install_engine(
    state: State<'_, AppState>,
    request: InstallRequest,
    stream_id: String,
    on_event: Channel<InstallEventDto>,
) -> AppResult<()> {
    state
        .provision
        .install(request, stream_id, Arc::new(on_event))
        .await
}
