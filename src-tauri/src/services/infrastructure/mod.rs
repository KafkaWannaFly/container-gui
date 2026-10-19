//! Infrastructure services: side effects outside the engine and the
//! database (Tauri events, IPC channels, local files, child processes). Other
//! services depend on these traits; only this module may touch
//! `tauri::AppHandle`, `tauri::ipc::Channel`, `tokio::process` or user-chosen
//! file paths.

pub mod compose_runner;
pub mod event_publisher;
pub mod event_sink;
pub mod file_writer;

pub use compose_runner::{DockerComposeCli, IComposeRunner};
pub use event_publisher::{IEventPublisher, TauriEventPublisher};
pub use event_sink::IEventSink;
pub use file_writer::{IFileWriter, TokioFileWriter};
