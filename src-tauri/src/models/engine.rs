//! Engine-neutral records exchanged between services, engine gateways and
//! repositories. Gateways map their engine's wire types (bollard, a future
//! Podman client) into these, so business logic never sees an engine SDK.

use std::collections::HashMap;
use std::path::PathBuf;

use bytes::Bytes;

use crate::models::dto::PortMappingDto;

/// Server-side filter for container listings.
#[derive(Debug, Clone, Default, bon::Builder)]
pub struct ContainerQuery {
    #[builder(default)]
    pub all: bool,
    pub status: Option<String>,
    /// Only containers that mount this named volume.
    pub volume: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ContainerRecord {
    pub id: String,
    /// Names without the leading `/`.
    pub names: Vec<String>,
    pub image: String,
    pub image_id: String,
    /// Lowercase engine state: `running`, `paused`, `exited`, ...
    pub state: String,
    pub status: String,
    pub created: i64,
    pub ports: Vec<PortMappingDto>,
    pub labels: HashMap<String, String>,
    pub mounts: Vec<MountRecord>,
}

#[derive(Debug, Clone, Default)]
pub struct MountRecord {
    /// `volume`, `bind`, `tmpfs`, ...
    pub kind: Option<String>,
    pub name: Option<String>,
    pub destination: Option<String>,
    pub rw: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Kill,
    Pause,
    Unpause,
    Remove,
}

#[derive(Debug, Clone)]
pub struct LogQuery {
    pub follow: bool,
    /// Line count or `all`.
    pub tail: String,
    /// Unix seconds.
    pub since: Option<i32>,
    pub timestamps: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputKind {
    Stdout,
    Stderr,
}

impl OutputKind {
    pub fn as_str(self) -> &'static str {
        match self {
            OutputKind::Stdout => "stdout",
            OutputKind::Stderr => "stderr",
        }
    }
}

/// One chunk of process or log output. Chunks are not line-aligned.
#[derive(Debug, Clone)]
pub struct OutputChunk {
    pub kind: OutputKind,
    pub data: Bytes,
}

/// Raw counters from one stats reading.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct StatsReading {
    /// Engine-side sample time (epoch ms), used for precise rate spans.
    pub read_ms: Option<i64>,
    pub cpu_total: Option<u64>,
    pub system_total: Option<u64>,
    pub online_cpus: u32,
    pub memory_usage: i64,
    pub memory_limit: i64,
    pub net_rx: u64,
    pub net_tx: u64,
    pub block_read: u64,
    pub block_write: u64,
    pub pids: u64,
}

#[derive(Debug, Clone, Default)]
pub struct ExecSpec {
    pub cmd: Vec<String>,
    pub user: Option<String>,
    pub working_dir: Option<String>,
    pub env: Option<Vec<String>>,
    pub tty: bool,
    pub attach_stdin: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PullProgress {
    pub id: String,
    pub status: String,
    pub current: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Default)]
pub struct VolumeRecord {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    /// RFC 3339, empty when unknown.
    pub created_at: String,
    pub scope: String,
    pub labels: HashMap<String, String>,
    pub options: HashMap<String, String>,
}

#[derive(Debug, Clone, Default)]
pub struct EngineVersion {
    pub version: Option<String>,
    pub api_version: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub kernel_version: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct EngineInfo {
    pub os_type: Option<String>,
    pub operating_system: Option<String>,
    pub architecture: Option<String>,
    pub kernel_version: Option<String>,
    pub containers: Option<i64>,
    pub containers_running: Option<i64>,
    pub containers_paused: Option<i64>,
    pub containers_stopped: Option<i64>,
    pub images: Option<i64>,
    pub ncpu: Option<i64>,
    pub mem_total: Option<i64>,
}

/// Where a compose project lives and how `docker compose` reaches it.
#[derive(Debug, Clone)]
pub struct ComposeLocation {
    /// Paths as compose sees them (from the labels); used on its command line
    /// and shown in the UI.
    pub workdir: String,
    pub files: Vec<String>,
    /// The same paths, readable from this process.
    pub host_workdir: PathBuf,
    pub host_files: Vec<PathBuf>,
    /// The WSL distro that owns the project, if any.
    pub distro: Option<String>,
}
