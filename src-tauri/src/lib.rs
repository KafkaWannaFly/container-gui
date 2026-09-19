mod commands;
mod docker;
mod error;
mod models;
mod services;

use std::sync::Arc;

use tauri::Manager;

use docker::state::{DockerSessionManager, StreamRegistry};

/// Shared application state handed to every Tauri command.
pub struct AppState {
    pub manager: Arc<DockerSessionManager>,
    pub streams: Arc<StreamRegistry>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let manager = Arc::new(DockerSessionManager::new(handle.clone()));
            let streams = Arc::new(StreamRegistry::default());
            app.manage(AppState {
                manager: manager.clone(),
                streams,
            });

            // Connect first, then start the event worker so it subscribes
            // against a live client.
            tauri::async_runtime::spawn(async move {
                manager.connect_default().await;
                docker::events::spawn(handle, manager);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::containers::list_containers,
            commands::containers::inspect_container,
            commands::containers::container_action,
            commands::containers::stream_container_logs,
            commands::containers::stop_container_logs,
            commands::images::list_images,
            commands::images::pull_image,
            commands::images::cancel_pull,
            commands::images::image_history,
            commands::images::tag_image,
            commands::images::remove_image,
            commands::images::prune_images,
            commands::volumes::list_volumes,
            commands::volumes::remove_volume,
            commands::volumes::prune_volumes,
            commands::system::system_info,
            commands::system::docker_status,
            commands::context::list_contexts,
            commands::context::test_connection,
            commands::context::switch_docker_endpoint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
