use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;

use crate::app::AppState;
use crate::error::AppResult;
use crate::models::dto::{
    ContainerSummaryDto, LogEventDto, LogStreamOptions, MetricsLatestDto, MetricsSeriesDto,
};

#[tauri::command]
pub async fn list_containers(
    state: State<'_, AppState>,
    all: bool,
) -> AppResult<Vec<ContainerSummaryDto>> {
    state.containers.list(all).await
}

/// Newest collector sample per live container (all, or just `ids`).
#[tauri::command]
pub async fn metrics_latest(
    state: State<'_, AppState>,
    ids: Option<Vec<String>>,
) -> AppResult<Vec<MetricsLatestDto>> {
    Ok(state.metrics.latest(ids.as_deref()))
}

/// Collector history for `ids` since `since` (epoch ms), downsampled to at
/// most `max_points` per container.
#[tauri::command]
pub async fn metrics_series(
    state: State<'_, AppState>,
    ids: Vec<String>,
    since: Option<i64>,
    max_points: Option<usize>,
) -> AppResult<MetricsSeriesDto> {
    Ok(state.metrics.series(&ids, since, max_points))
}

#[tauri::command]
pub async fn inspect_container(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<serde_json::Value> {
    state.containers.inspect(&id).await
}

#[tauri::command]
pub async fn container_action(
    state: State<'_, AppState>,
    id: String,
    action: String,
) -> AppResult<()> {
    state.containers.action(&id, &action).await
}

#[tauri::command]
pub async fn stream_container_logs(
    state: State<'_, AppState>,
    id: String,
    stream_id: String,
    options: LogStreamOptions,
    on_event: Channel<LogEventDto>,
) -> AppResult<()> {
    state
        .containers
        .stream_logs(id, stream_id, options, Arc::new(on_event))
        .await
}

/// Write the container's full log (both streams, with timestamps) to the path
/// the user chose in the save dialog, without routing it through the webview.
/// Returns the path.
#[tauri::command]
pub async fn save_container_logs(
    state: State<'_, AppState>,
    id: String,
    dest: String,
) -> AppResult<String> {
    state.containers.save_logs(&id, &dest).await
}

/// Cancel any log or exec stream by the id its caller registered.
#[tauri::command]
pub async fn stop_stream(state: State<'_, AppState>, stream_id: String) -> AppResult<()> {
    state.streams.cancel(&stream_id);
    Ok(())
}
