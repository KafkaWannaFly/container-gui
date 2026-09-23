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

/// Configure application logging. Dev builds write to `<project>/logs` (easy
/// to tail); release builds keep the plugin defaults (stdout + OS log dir).
fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .level_for("bollard", log::LevelFilter::Warn)
        .level_for("hyper", log::LevelFilter::Warn)
        .level_for("hyper_util", log::LevelFilter::Warn)
        .max_file_size(5_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll);

    #[cfg(debug_assertions)]
    let builder = {
        use tauri_plugin_log::{Target, TargetKind};
        builder
            .clear_targets()
            .target(Target::new(TargetKind::Webview))
            .target(Target::new(TargetKind::Stdout))
            .target(Target::new(TargetKind::Folder {
                path: std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../logs"),
                file_name: Some("container-gui".into()),
            }))
    };

    builder.build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(log_plugin());

    // Debug-only UI automation bridge for agents (`tauri-pilot`). The plugin
    // opens a named pipe; it is never compiled into release builds.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_pilot::init());

    builder
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
            commands::containers::container_stats,
            commands::containers::inspect_container,
            commands::containers::container_action,
            commands::containers::stream_container_logs,
            commands::containers::stream_container_stats,
            commands::containers::stop_stream,
            commands::containers::save_container_logs,
            commands::files::save_text_to_downloads,
            commands::images::list_images,
            commands::images::pull_image,
            commands::images::cancel_pull,
            commands::images::image_history,
            commands::images::inspect_image,
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
