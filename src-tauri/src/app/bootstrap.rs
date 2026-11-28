//! Builds every repository and service exactly once and injects them through
//! their traits. This is the only place that names concrete implementations.

use std::path::Path;
use std::sync::Arc;

use tauri::AppHandle;

use super::AppState;
use crate::ext::IntoArc;
use crate::repositories::fs::{FsDockerContextRepository, docker_contexts};
use crate::repositories::memory::{
    InMemoryExecSessionRepository, InMemoryMetricsRepository, InMemoryStreamRegistry,
};
use crate::repositories::sqlite::{
    SqliteEnginePreferenceRepository, SqliteMetricsHistoryRepository, SqliteVolumeSizeRepository,
    pool,
};
use crate::repositories::{
    IDockerContextRepository, IEnginePreferenceRepository, IExecSessionRepository,
    IMetricsHistoryRepository, IMetricsRepository, IStreamRegistry, IVolumeSizeRepository,
};
use crate::services::compose::ComposeService;
use crate::services::connection::ConnectionService;
use crate::services::container::ContainerService;
use crate::services::engine::IEngineConnector;
use crate::services::engine::docker::DockerConnector;
use crate::services::environment::{EnvironmentService, IEnvironmentService};
use crate::services::exec::ExecService;
use crate::services::files::FilesService;
use crate::services::image::ImageService;
use crate::services::infrastructure::{
    DockerComposeCli, IComposeRunner, IEventPublisher, IFileWriter, IHttpDownloader,
    IProcessRunner, ReqwestDownloader, TauriEventPublisher, TokioFileWriter, TokioProcessRunner,
};
use crate::services::metrics::{self, IMetricsService, MetricsService};
use crate::services::provision::{IProvisionService, ProvisionService};
use crate::services::session::{EngineSession, IEngineSession};
use crate::services::stream::StreamService;
use crate::services::system::SystemService;
use crate::services::volume::VolumeService;
use crate::services::workers;

/// Wired application: the command-facing state plus what the background
/// workers need.
pub struct Composition {
    pub state: AppState,
    session: Arc<dyn IEngineSession>,
    publisher: Arc<dyn IEventPublisher>,
    metrics: Arc<dyn IMetricsService>,
}

/// One SQLite pool for `data_dir/app.db` (in-memory when unusable), then
/// repositories, then services in dependency order.
pub async fn build(app: &AppHandle, data_dir: &Path) -> Composition {
    // Repositories.
    let pool = pool::open_or_memory(&data_dir.join("app.db")).await;
    let metrics_history: Arc<dyn IMetricsHistoryRepository> =
        SqliteMetricsHistoryRepository::builder()
            .pool(pool.clone())
            .build()
            .into_arc();
    let volume_sizes: Arc<dyn IVolumeSizeRepository> = SqliteVolumeSizeRepository::builder()
        .pool(pool.clone())
        .build()
        .into_arc();
    let live_metrics: Arc<dyn IMetricsRepository> = InMemoryMetricsRepository::builder()
        .capacity(metrics::CAPACITY)
        .build()
        .into_arc();
    let streams: Arc<dyn IStreamRegistry> = InMemoryStreamRegistry::builder().build().into_arc();
    let exec_sessions: Arc<dyn IExecSessionRepository> =
        InMemoryExecSessionRepository::builder().build().into_arc();
    let contexts: Arc<dyn IDockerContextRepository> = FsDockerContextRepository::builder()
        .maybe_docker_dir(docker_contexts::default_docker_dir())
        .build()
        .into_arc();
    let preference: Arc<dyn IEnginePreferenceRepository> =
        SqliteEnginePreferenceRepository::builder()
            .pool(pool)
            .build()
            .into_arc();

    // Infrastructure and engine services.
    let publisher: Arc<dyn IEventPublisher> = TauriEventPublisher::builder()
        .app(app.clone())
        .build()
        .into_arc();
    let file_writer: Arc<dyn IFileWriter> = TokioFileWriter::builder().build().into_arc();
    let compose_runner: Arc<dyn IComposeRunner> = DockerComposeCli::builder().build().into_arc();
    let process_runner: Arc<dyn IProcessRunner> = TokioProcessRunner::builder().build().into_arc();
    let downloader: Arc<dyn IHttpDownloader> = ReqwestDownloader::builder().build().into_arc();
    let connector: Arc<dyn IEngineConnector> = DockerConnector::builder()
        .contexts(contexts.clone())
        .preference(preference.clone())
        .build()
        .into_arc();
    let session: Arc<dyn IEngineSession> = EngineSession::builder()
        .connector(connector.clone())
        .publisher(publisher.clone())
        .build()
        .await
        .into_arc();
    let environment: Arc<dyn IEnvironmentService> = EnvironmentService::builder()
        .runner(process_runner.clone())
        .build()
        .into_arc();
    let provision: Arc<dyn IProvisionService> = ProvisionService::builder()
        .runner(process_runner)
        .downloader(downloader)
        .session(session.clone())
        .preference(preference.clone())
        .streams(streams.clone())
        .data_dir(data_dir.to_path_buf())
        .build()
        .into_arc();

    // Business services.
    let metrics: Arc<dyn IMetricsService> = MetricsService::builder()
        .session(session.clone())
        .live(live_metrics)
        .history(metrics_history)
        .build()
        .into_arc();
    let state = AppState::builder()
        .compose(
            ComposeService::builder()
                .runner(compose_runner)
                .build()
                .into_arc(),
        )
        .connection(
            ConnectionService::builder()
                .session(session.clone())
                .connector(connector)
                .contexts(contexts)
                .preference(preference)
                .build()
                .into_arc(),
        )
        .containers(
            ContainerService::builder()
                .session(session.clone())
                .streams(streams.clone())
                .files(file_writer.clone())
                .build()
                .into_arc(),
        )
        .environment(environment)
        .exec(
            ExecService::builder()
                .session(session.clone())
                .streams(streams.clone())
                .sessions(exec_sessions)
                .build()
                .into_arc(),
        )
        .files(
            FilesService::builder()
                .session(session.clone())
                .files(file_writer)
                .build()
                .into_arc(),
        )
        .images(
            ImageService::builder()
                .session(session.clone())
                .streams(streams.clone())
                .build()
                .into_arc(),
        )
        .metrics(metrics.clone())
        .provision(provision)
        .streams(StreamService::builder().streams(streams).build().into_arc())
        .system(
            SystemService::builder()
                .session(session.clone())
                .build()
                .into_arc(),
        )
        .volumes(
            VolumeService::builder()
                .session(session.clone())
                .sizes(volume_sizes)
                .build()
                .into_arc(),
        )
        .build();

    Composition {
        state,
        session,
        publisher,
        metrics,
    }
}

impl Composition {
    /// Connect first, then start the workers so the event worker subscribes
    /// against a live client.
    pub fn start_workers(&self) {
        let session = self.session.clone();
        let publisher = self.publisher.clone();
        let metrics = self.metrics.clone();
        tauri::async_runtime::spawn(async move {
            session.connect_default().await;
            workers::events::spawn(session, publisher);
            workers::metrics::spawn(metrics);
        });
    }
}
