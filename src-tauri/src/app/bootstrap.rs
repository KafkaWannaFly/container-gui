//! Builds every repository and service exactly once and injects them through
//! their traits. This is the only place that names concrete implementations.

use std::path::Path;
use std::sync::Arc;

use tauri::AppHandle;

use super::AppState;
use crate::repositories::fs::{FsDockerContextRepository, docker_contexts};
use crate::repositories::memory::{
    InMemoryExecSessionRepository, InMemoryMetricsRepository, InMemoryStreamRegistry,
};
use crate::repositories::sqlite::{
    SqliteMetricsHistoryRepository, SqliteVolumeSizeRepository, pool,
};
use crate::repositories::{
    IDockerContextRepository, IExecSessionRepository, IMetricsHistoryRepository,
    IMetricsRepository, IStreamRegistry, IVolumeSizeRepository,
};
use crate::services::compose::ComposeService;
use crate::services::connection::ConnectionService;
use crate::services::container::ContainerService;
use crate::services::engine::IEngineConnector;
use crate::services::engine::docker::DockerConnector;
use crate::services::exec::ExecService;
use crate::services::files::FilesService;
use crate::services::image::ImageService;
use crate::services::infrastructure::{
    DockerComposeCli, IComposeRunner, IEventPublisher, IFileWriter, TauriEventPublisher,
    TokioFileWriter,
};
use crate::services::metrics::{self, IMetricsService, MetricsService};
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
    let metrics_history: Arc<dyn IMetricsHistoryRepository> = Arc::new(
        SqliteMetricsHistoryRepository::builder()
            .pool(pool.clone())
            .build(),
    );
    let volume_sizes: Arc<dyn IVolumeSizeRepository> =
        Arc::new(SqliteVolumeSizeRepository::builder().pool(pool).build());
    let live_metrics: Arc<dyn IMetricsRepository> = Arc::new(
        InMemoryMetricsRepository::builder()
            .capacity(metrics::CAPACITY)
            .build(),
    );
    let streams: Arc<dyn IStreamRegistry> = Arc::new(InMemoryStreamRegistry::builder().build());
    let exec_sessions: Arc<dyn IExecSessionRepository> =
        Arc::new(InMemoryExecSessionRepository::builder().build());
    let contexts: Arc<dyn IDockerContextRepository> = Arc::new(
        FsDockerContextRepository::builder()
            .maybe_docker_dir(docker_contexts::default_docker_dir())
            .build(),
    );

    // Infrastructure and engine services.
    let publisher: Arc<dyn IEventPublisher> =
        Arc::new(TauriEventPublisher::builder().app(app.clone()).build());
    let file_writer: Arc<dyn IFileWriter> = Arc::new(TokioFileWriter::builder().build());
    let compose_runner: Arc<dyn IComposeRunner> = Arc::new(DockerComposeCli::builder().build());
    let connector: Arc<dyn IEngineConnector> = Arc::new(
        DockerConnector::builder()
            .contexts(contexts.clone())
            .build(),
    );
    let session: Arc<dyn IEngineSession> = Arc::new(
        EngineSession::builder()
            .connector(connector.clone())
            .publisher(publisher.clone())
            .build(),
    );

    // Business services.
    let metrics: Arc<dyn IMetricsService> = Arc::new(
        MetricsService::builder()
            .session(session.clone())
            .live(live_metrics)
            .history(metrics_history)
            .build(),
    );
    let state = AppState::builder()
        .compose(Arc::new(
            ComposeService::builder().runner(compose_runner).build(),
        ))
        .connection(Arc::new(
            ConnectionService::builder()
                .session(session.clone())
                .connector(connector)
                .contexts(contexts)
                .build(),
        ))
        .containers(Arc::new(
            ContainerService::builder()
                .session(session.clone())
                .streams(streams.clone())
                .files(file_writer.clone())
                .build(),
        ))
        .exec(Arc::new(
            ExecService::builder()
                .session(session.clone())
                .streams(streams.clone())
                .sessions(exec_sessions)
                .build(),
        ))
        .files(Arc::new(
            FilesService::builder()
                .session(session.clone())
                .files(file_writer)
                .build(),
        ))
        .images(Arc::new(
            ImageService::builder()
                .session(session.clone())
                .streams(streams.clone())
                .build(),
        ))
        .metrics(metrics.clone())
        .streams(Arc::new(StreamService::builder().streams(streams).build()))
        .system(Arc::new(
            SystemService::builder().session(session.clone()).build(),
        ))
        .volumes(Arc::new(
            VolumeService::builder()
                .session(session.clone())
                .sizes(volume_sizes)
                .build(),
        ))
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
