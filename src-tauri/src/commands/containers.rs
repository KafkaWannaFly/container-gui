use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::models::dto::{
    ContainerSummaryDto, LogEventDto, LogStreamOptions, MetricsLatestDto, MetricsSeriesDto,
};
use crate::services::container_service::{self, ContainerListFilter};

#[tauri::command]
pub async fn list_containers(
    state: State<'_, AppState>,
    all: bool,
) -> AppResult<Vec<ContainerSummaryDto>> {
    let client = state.manager.required_client().await?;
    let filter = ContainerListFilter::builder().all(all).build();
    container_service::list_containers(&client, &filter).await
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
    let now = crate::docker::metrics::now_ms();
    Ok(state.metrics.series(&ids, since, max_points, now))
}

#[tauri::command]
pub async fn inspect_container(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<serde_json::Value> {
    let client = state.manager.required_client().await?;
    container_service::inspect_container(&client, &id).await
}

#[tauri::command]
pub async fn container_action(
    state: State<'_, AppState>,
    id: String,
    action: String,
) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    let action = container_service::ContainerAction::parse(&action)?;
    container_service::execute_action(&client, &id, action).await
}

#[tauri::command]
pub async fn stream_container_logs(
    state: State<'_, AppState>,
    id: String,
    stream_id: String,
    options: LogStreamOptions,
    on_event: tauri::ipc::Channel<LogEventDto>,
) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    container_service::spawn_log_stream(
        client,
        state.streams.clone(),
        id,
        stream_id,
        options,
        on_event,
    );
    Ok(())
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
    let client = state.manager.required_client().await?;
    let dest = std::path::PathBuf::from(dest);
    container_service::write_logs(&client, &id, &dest).await?;
    Ok(dest.display().to_string())
}

/// Cancel any log or exec stream by the id its caller registered.
#[tauri::command]
pub async fn stop_stream(state: State<'_, AppState>, stream_id: String) -> AppResult<()> {
    state.streams.cancel(&stream_id);
    Ok(())
}
