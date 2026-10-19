use std::sync::Arc;

use crate::services::compose::IComposeService;
use crate::services::connection::IConnectionService;
use crate::services::container::IContainerService;
use crate::services::exec::IExecService;
use crate::services::files::IFilesService;
use crate::services::image::IImageService;
use crate::services::metrics::IMetricsService;
use crate::services::stream::IStreamService;
use crate::services::system::ISystemService;
use crate::services::volume::IVolumeService;

/// Managed Tauri state: the services commands may call, behind their traits.
#[derive(bon::Builder)]
pub struct AppState {
    pub compose: Arc<dyn IComposeService>,
    pub connection: Arc<dyn IConnectionService>,
    pub containers: Arc<dyn IContainerService>,
    pub exec: Arc<dyn IExecService>,
    pub files: Arc<dyn IFilesService>,
    pub images: Arc<dyn IImageService>,
    pub metrics: Arc<dyn IMetricsService>,
    pub streams: Arc<dyn IStreamService>,
    pub system: Arc<dyn ISystemService>,
    pub volumes: Arc<dyn IVolumeService>,
}
