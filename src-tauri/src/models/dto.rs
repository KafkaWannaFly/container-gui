//! IPC data-transfer objects. Every struct here is serialized to the
//! frontend and must match the Zod schemas in `src/types/docker.ts`
//! (camelCase on the wire).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortMappingDto {
    pub private_port: u16,
    pub public_port: Option<u16>,
    pub ip: Option<String>,
    #[serde(rename = "type")]
    pub typ: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSummaryDto {
    pub id: String,
    pub names: Vec<String>,
    pub image: String,
    pub image_id: String,
    pub state: String,
    pub status: String,
    pub created: i64,
    pub ports: Vec<PortMappingDto>,
    pub compose_project: Option<String>,
    pub compose_service: Option<String>,
    pub compose_working_dir: Option<String>,
    pub compose_config_files: Option<String>,
}

/// One collector sample for one container. Totals are cumulative since the
/// container started; rates are per second over the previous sample and are
/// `None` on the first sample or after a counter reset (container restart).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSampleDto {
    /// Host time (epoch ms) of the poll that produced this sample.
    pub ts: i64,
    pub cpu_percent: Option<f64>,
    pub online_cpus: u32,
    pub memory_usage: i64,
    pub memory_limit: i64,
    pub net_rx: u64,
    pub net_tx: u64,
    pub block_read: u64,
    pub block_write: u64,
    pub pids: u64,
    pub net_rx_rate: Option<f64>,
    pub net_tx_rate: Option<f64>,
    pub block_read_rate: Option<f64>,
    pub block_write_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsLatestDto {
    pub id: String,
    #[serde(flatten)]
    pub sample: MetricSampleDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSeriesDto {
    pub id: String,
    pub samples: Vec<MetricSampleDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSeriesDto {
    /// Spacing between points after downsampling; a larger jump is a gap.
    pub step_ms: i64,
    pub series: Vec<ContainerSeriesDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeItemDto {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created_at: String,
    pub size_bytes: i64,
    pub in_use: bool,
    pub ref_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeMountDto {
    pub destination: String,
    pub read_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeContainerDto {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub mounts: Vec<VolumeMountDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeDetailDto {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created_at: String,
    pub scope: String,
    pub labels: std::collections::HashMap<String, String>,
    pub options: std::collections::HashMap<String, String>,
    pub containers: Vec<VolumeContainerDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageItemDto {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size: i64,
    pub created: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePullProgressDto {
    pub id: String,
    pub status: String,
    pub current_bytes: i64,
    pub total_bytes: i64,
    pub percent: f64,
}

/// One complete log line. `ts` is Docker's RFC 3339 timestamp prefix,
/// empty when the engine did not send one.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogLineDto {
    pub stream: String,
    pub ts: String,
    pub text: String,
}

/// Messages on a log stream channel: batches of lines, then one `end`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LogEventDto {
    Lines { lines: Vec<LogLineDto> },
    End { error: Option<String> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStreamOptions {
    /// Last N lines; `None` streams the whole log.
    pub tail: Option<u64>,
    /// Unix seconds; only lines at or after this time.
    pub since: Option<i64>,
    #[serde(default = "default_true")]
    pub follow: bool,
}

fn default_true() -> bool {
    true
}

/// One directory entry. `kind`: dir | file | link | char | block | fifo |
/// socket | other. `mtime` is unix seconds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntryDto {
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub mode: String,
    pub owner: String,
    pub mtime: i64,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListingDto {
    pub path: String,
    pub entries: Vec<FsEntryDto>,
    /// More entries exist than the requested limit.
    pub truncated: bool,
}

/// Preview of one path. `content` is set for text files only, cut at the
/// requested byte limit (`truncated`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentDto {
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub mode: String,
    pub mtime: i64,
    pub link_target: Option<String>,
    pub content: Option<String>,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecStartOptions {
    pub cmd: Vec<String>,
    pub user: Option<String>,
    pub working_dir: Option<String>,
    #[serde(default)]
    pub env: Vec<String>,
    #[serde(default)]
    pub tty: bool,
    #[serde(default)]
    pub cols: u16,
    #[serde(default)]
    pub rows: u16,
}

/// Messages on an exec session channel: output chunks, then one `exit`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExecEventDto {
    Output {
        stream: String,
        data: String,
    },
    Exit {
        code: Option<i64>,
        error: Option<String>,
    },
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecProbeDto {
    pub shells: Vec<String>,
    pub users: Vec<String>,
    pub os_id: String,
    pub os_name: String,
    pub hostname: String,
}

/// A path that differs from the image: `A`dded, `C`hanged or `D`eleted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangeDto {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerHistoryItemDto {
    pub id: String,
    pub created: i64,
    pub created_by: String,
    pub size: i64,
    pub tags: Vec<String>,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerEventDto {
    pub resource_type: String,
    pub action: String,
    pub actor_id: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContextDto {
    pub name: String,
    pub host: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    Unix,
    Npipe,
    Tcp,
}

impl ConnectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ConnectionKind::Unix => "unix",
            ConnectionKind::Npipe => "npipe",
            ConnectionKind::Tcp => "tcp",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub kind: ConnectionKind,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Connected,
    Standby,
    Connecting,
    Error,
}

impl ConnectionState {
    pub fn as_str(self) -> &'static str {
        match self {
            ConnectionState::Connected => "connected",
            ConnectionState::Standby => "standby",
            ConnectionState::Connecting => "connecting",
            ConnectionState::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatusDto {
    pub endpoint: String,
    pub kind: String,
    pub state: ConnectionState,
    pub engine_version: Option<String>,
    pub api_version: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub ping_ms: Option<u64>,
    pub message: Option<String>,
}

impl DockerStatusDto {
    pub fn standby(endpoint: String, kind: String, message: impl Into<String>) -> Self {
        Self {
            endpoint,
            kind,
            state: ConnectionState::Standby,
            engine_version: None,
            api_version: None,
            os: None,
            arch: None,
            ping_ms: None,
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoDto {
    pub docker_version: String,
    pub api_version: String,
    pub os: String,
    pub arch: String,
    pub kernel_version: String,
    pub containers_running: i64,
    pub containers_paused: i64,
    pub containers_stopped: i64,
    pub containers_total: i64,
    pub images_total: i64,
    pub cpus: i64,
    pub memory_total: i64,
    pub ping_ms: u64,
}

/// One compose file as shown in the Config tab.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeFileDto {
    pub name: String,
    pub path: String,
    pub content: String,
}

/// Everything the group page needs for one compose project. `config` is the
/// parsed output of `docker compose config --format json` (fully merged and
/// interpolated); `resolved` is the same document rendered as YAML.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeProjectDto {
    pub project: String,
    pub workdir: String,
    pub files: Vec<ComposeFileDto>,
    pub config_hash: String,
    pub compose_version: String,
    pub config: serde_json::Value,
    pub resolved: String,
}

/// Result of a `docker compose` lifecycle action.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeRunDto {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeActionRequest {
    pub workdir: String,
    pub files: Vec<String>,
    pub action: String,
    pub service: Option<String>,
    pub replicas: Option<u8>,
    #[serde(default)]
    pub profiles: Vec<String>,
    /// Extra service names for multi-service verbs (`rm`). `service` still
    /// covers the single-service verbs.
    #[serde(default)]
    pub services: Vec<String>,
}
