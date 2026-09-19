use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::models::dto::{ContainerStatsDto, ContainerSummaryDto, LogChunkDto};
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

#[tauri::command]
pub async fn container_stats(
    state: State<'_, AppState>,
    all: bool,
) -> AppResult<Vec<ContainerStatsDto>> {
    let client = state.manager.required_client().await?;
    container_service::list_container_stats(&client, all).await
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
    tail: u64,
    on_chunk: tauri::ipc::Channel<LogChunkDto>,
) -> AppResult<()> {
    let client = state.manager.required_client().await?;
    container_service::spawn_log_stream(client, state.streams.clone(), id, tail, on_chunk);
    Ok(())
}

#[tauri::command]
pub async fn stop_container_logs(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.streams.cancel_logs(&id);
    Ok(())
}
