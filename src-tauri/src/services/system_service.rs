//! Engine-level info used by the dashboard.

use bollard::Docker;

use crate::docker::state;
use crate::error::AppResult;
use crate::models::dto::SystemInfoDto;

pub async fn system_info(client: &Docker) -> AppResult<SystemInfoDto> {
    state::collect_system_info(client).await
}
