mod app;
mod commands;
mod error;
mod ext;
mod models;
mod repositories;
mod services;

use tauri::Manager;

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(log_plugin());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Debug-only UI automation bridge for agents (`tauri-pilot`). The plugin
    // opens a named pipe; it is never compiled into release builds.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_pilot::init());

    builder
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
            }
            // The app data dir falls back to temp, and the pool to in-memory,
            // when unusable.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("container-gui"));
            let composition =
                tauri::async_runtime::block_on(app::bootstrap::build(app.handle(), &data_dir));
            composition.start_workers();
            app.manage(composition.state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::compose::compose_project,
            commands::compose::compose_action,
            commands::containers::list_containers,
            commands::containers::metrics_latest,
            commands::containers::metrics_series,
            commands::containers::inspect_container,
            commands::containers::container_action,
            commands::containers::stream_container_logs,
            commands::containers::stop_stream,
            commands::containers::save_container_logs,
            commands::files::save_text_to_file,
            commands::files::list_container_dir,
            commands::files::read_container_file,
            commands::files::container_changes,
            commands::files::save_container_path,
            commands::exec::exec_probe,
            commands::exec::exec_start,
            commands::exec::exec_input,
            commands::exec::exec_resize,
            commands::images::list_images,
            commands::images::pull_image,
            commands::images::cancel_pull,
            commands::images::image_history,
            commands::images::inspect_image,
            commands::images::tag_image,
            commands::images::remove_image,
            commands::images::prune_images,
            commands::volumes::list_volumes,
            commands::volumes::refresh_volume_sizes,
            commands::volumes::volume_detail,
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
