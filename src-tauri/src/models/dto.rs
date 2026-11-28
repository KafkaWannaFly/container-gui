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
    /// `None` until the first disk-usage measurement completes.
    pub size_bytes: Option<i64>,
    pub size_measured_at: Option<i64>,
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
    #[allow(dead_code, reason = "part of the frontend's status schema")]
    Connecting,
    #[allow(dead_code, reason = "part of the frontend's status schema")]
    Error,
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

/* --------------------------- engine onboarding --------------------------- */

/// One installed WSL distribution.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistroDto {
    pub name: String,
    pub state: String,
    pub version: u32,
    /// The distro already ships a Docker daemon (`dockerd` was found inside).
    pub has_docker: bool,
}

/// Host WSL capability, as reported by `wsl.exe`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslReportDto {
    pub installed: bool,
    pub default_version: Option<u32>,
    pub distros: Vec<WslDistroDto>,
    /// Distro names `wsl --install -d <name>` can register (`wsl -l -o`),
    /// filtered to the Docker-supported families. Empty fallback list when
    /// the query is unavailable.
    pub installables: Vec<String>,
}

/// One `podman machine` entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodmanMachineDto {
    pub name: String,
    pub running: bool,
    pub rootless: bool,
}

/// Host capabilities the setup wizard checks before offering an install.
/// Every probe degrades gracefully: missing tools report `None`/`false`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReportDto {
    pub wsl: WslReportDto,
    /// Firmware virtualization / hypervisor presence; `None` when unknown.
    pub virtualization: Option<bool>,
    /// winget version when available.
    pub winget: Option<String>,
    pub podman_version: Option<String>,
    pub docker_version: Option<String>,
    pub podman_machines: Vec<PodmanMachineDto>,
}

/// Which backend the wizard installs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallEngine {
    Podman,
    DockerWsl,
}

/// Which WSL distro the Docker Engine install runs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockerTargetKind {
    /// A distro already registered on this machine.
    Existing,
    /// A popular distro to register first via `wsl --install -d`.
    Install,
}

/// Where to install: a tagged distro choice; `None` means create the new
/// dedicated Alpine import (named from the tarball version, e.g.
/// `Alpine-3.22`, and reported back on the install's `end` event).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerTarget {
    pub kind: DockerTargetKind,
    pub name: String,
}

/// Install options collected on the wizard's options step.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub engine: InstallEngine,
    /// Podman machine name, or Docker Engine distribution name.
    pub unit_name: String,
    /// Docker Engine only: install into an existing or newly registered
    /// distro instead of importing a new dedicated one.
    #[serde(default)]
    pub target: Option<DockerTarget>,
    /// Podman only; Docker Engine always runs as root inside its distro.
    #[serde(default = "default_true")]
    pub rootless: bool,
    #[serde(default = "default_cpus")]
    pub cpus: u32,
    #[serde(default = "default_memory_mib")]
    pub memory_mib: u32,
    #[serde(default = "default_disk_gib")]
    pub disk_gib: u32,
}

fn default_cpus() -> u32 {
    2
}

fn default_memory_mib() -> u32 {
    2048
}

fn default_disk_gib() -> u32 {
    100
}

/// One line of child-process output (`stream`: stdout | stderr).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessLineDto {
    pub stream: String,
    pub text: String,
}

/// Download progress for large install artifacts (WSL rootfs images).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressDto {
    pub bytes: u64,
    pub total_bytes: Option<u64>,
}

/// Messages on the install channel: phase markers, process output, download
/// progress, then exactly one `end`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallEventDto {
    Phase {
        index: u32,
        total: u32,
        name: String,
    },
    Line {
        stream: String,
        text: String,
    },
    Download {
        bytes: u64,
        total_bytes: Option<u64>,
    },
    End {
        error: Option<String>,
        /// Final machine/distribution name the engine was installed as
        /// (the dedicated Alpine import may resolve `Alpine-<version>`).
        unit_name: Option<String>,
    },
}
