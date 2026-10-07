//! Compose project reads and lifecycle actions.
//!
//! Bollard has no Compose support, so this module drives the `docker compose`
//! v2 CLI directly. There is no maintained Rust crate that covers the command
//! surface we need (up/down/restart/scale/profiles/remove-orphans/build/pull +
//! resolved config); the crates that do execute only wrap this same binary.
//!
//! Callers pass the project working directory and its compose files (read from
//! the `com.docker.compose.project.*` labels) so the backend never has to
//! re-list containers just to find them.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::models::dto::{ComposeActionRequest, ComposeFileDto, ComposeProjectDto, ComposeRunDto};

/// `docker compose config` reads files and env; it should never take long.
const CONFIG_TIMEOUT: Duration = Duration::from_secs(20);
/// `up`/`build`/`pull` can download images, so give actions more room.
const ACTION_TIMEOUT: Duration = Duration::from_secs(600);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Release builds use the GUI subsystem; keep child consoles from flashing.
fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = cmd;
}

fn is_linux_path(path: &str) -> bool {
    path.starts_with('/') && !path.starts_with("//")
}

fn join_linux(workdir: &str, file: &str) -> String {
    if file.starts_with('/') {
        file.to_string()
    } else {
        format!("{}/{file}", workdir.trim_end_matches('/'))
    }
}

/// Projects started from a WSL distro carry Linux paths in their compose
/// labels. Their files are reachable from Windows through the `\\wsl$` share,
/// but `docker compose` itself must run inside the distro: run from Windows it
/// rewrites relative bind mounts to UNC paths and recreates containers with
/// broken mounts, and it misses the distro's environment.
#[cfg(windows)]
mod wsl {
    use std::os::windows::process::CommandExt as _;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    fn list(running: bool) -> Vec<String> {
        let mut cmd = Command::new("wsl.exe");
        cmd.args(["-l", "-q"]);
        if running {
            cmd.arg("--running");
        }
        let Ok(out) = cmd
            .env("WSL_UTF8", "1")
            .stdin(Stdio::null())
            .creation_flags(super::CREATE_NO_WINDOW)
            .output()
        else {
            return Vec::new();
        };
        if !out.status.success() {
            return Vec::new();
        }
        // Older wsl.exe ignores WSL_UTF8 and prints UTF-16LE.
        let text = if out.stdout.contains(&0) {
            let wide: Vec<u16> = out
                .stdout
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_le_bytes(*pair))
                .collect();
            String::from_utf16_lossy(&wide)
        } else {
            String::from_utf8_lossy(&out.stdout).into_owned()
        };
        text.lines()
            .map(|line| line.trim().trim_matches('\0').to_string())
            .filter(|line| !line.is_empty())
            .collect()
    }

    pub fn unc(distro: &str, path: &str) -> PathBuf {
        PathBuf::from(format!(r"\\wsl$\{distro}{}", path.replace('/', "\\")))
    }

    /// The distro holding `workdir`. Running distros are probed first; the
    /// default distro (listed first) is the only stopped one we probe, since
    /// touching a distro's share boots it.
    pub fn distro_for(workdir: &str) -> Option<String> {
        let running = list(true);
        if let Some(found) = running.iter().find(|distro| unc(distro, workdir).is_dir()) {
            return Some(found.clone());
        }
        let default = list(false).into_iter().next()?;
        (!running.contains(&default) && unc(&default, workdir).is_dir()).then_some(default)
    }
}

/// Where a compose project lives and how to run `docker compose` for it.
struct Location {
    /// Paths as compose sees them (from the labels); used on its command line
    /// and shown in the UI.
    workdir: String,
    files: Vec<String>,
    /// The same paths, readable from this process.
    host_workdir: PathBuf,
    host_files: Vec<PathBuf>,
    /// The WSL distro that owns the project, if any.
    distro: Option<String>,
}

impl Location {
    fn new(workdir: &str, files: &[String]) -> Self {
        #[cfg(windows)]
        if is_linux_path(workdir)
            && let Some(distro) = wsl::distro_for(workdir)
        {
            let files: Vec<String> = files.iter().map(|file| join_linux(workdir, file)).collect();
            return Self {
                host_workdir: wsl::unc(&distro, workdir),
                host_files: files.iter().map(|file| wsl::unc(&distro, file)).collect(),
                workdir: workdir.to_string(),
                files,
                distro: Some(distro),
            };
        }
        let host_workdir = PathBuf::from(workdir);
        let host_files = resolve_paths(&host_workdir, files);
        Self {
            workdir: workdir.to_string(),
            files: host_files
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            host_workdir,
            host_files,
            distro: None,
        }
    }

    /// `docker compose -f …`, inside the owning WSL distro when there is one.
    fn command(&self) -> AppResult<Command> {
        if self.files.is_empty() {
            return Err(AppError::Message(
                "No compose files were provided for this project".to_string(),
            ));
        }
        let mut cmd = match &self.distro {
            Some(distro) => {
                let mut cmd = Command::new("wsl.exe");
                // A login shell puts the distro's docker on PATH; "$@" passes
                // every argument verbatim, so `--profile *` is never globbed.
                cmd.args(["-d", distro, "--cd", &self.workdir, "-e", "sh", "-lc"])
                    .arg("exec docker compose \"$@\"")
                    .arg("sh");
                cmd
            }
            None => {
                let mut cmd = Command::new("docker");
                cmd.arg("compose");
                cmd.current_dir(&self.host_workdir);
                cmd
            }
        };
        for file in &self.files {
            cmd.arg("-f").arg(file);
        }
        cmd.stdin(Stdio::null());
        cmd.kill_on_drop(true);
        hide_window(&mut cmd);
        Ok(cmd)
    }

    fn display_path(&self, name: &str) -> String {
        if is_linux_path(&self.workdir) {
            join_linux(&self.workdir, name)
        } else {
            Path::new(&self.workdir)
                .join(name)
                .to_string_lossy()
                .into_owned()
        }
    }
}

/// The `docker compose` version per place it runs (host or a WSL distro).
async fn compose_version(location: &Location) -> String {
    static CACHE: OnceLock<Mutex<HashMap<Option<String>, String>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(version) = cache
        .lock()
        .ok()
        .and_then(|map| map.get(&location.distro).cloned())
    {
        return version;
    }
    let version = match location.command() {
        Ok(mut cmd) => {
            match tokio::time::timeout(CONFIG_TIMEOUT, cmd.args(["version", "--short"]).output())
                .await
            {
                Ok(Ok(out)) if out.status.success() => {
                    String::from_utf8_lossy(&out.stdout).trim().to_string()
                }
                _ => return "unknown".to_string(),
            }
        }
        Err(_) => return "unknown".to_string(),
    };
    if let Ok(mut map) = cache.lock() {
        map.insert(location.distro.clone(), version.clone());
    }
    version
}

fn resolve_paths(workdir: &Path, files: &[String]) -> Vec<PathBuf> {
    files
        .iter()
        .map(|file| {
            let path = PathBuf::from(file);
            if path.is_absolute() {
                path
            } else {
                workdir.join(path)
            }
        })
        .collect()
}

fn read_files(location: &Location) -> Vec<ComposeFileDto> {
    let mut out = Vec::with_capacity(location.files.len());
    for (file, host) in location.files.iter().zip(&location.host_files) {
        let Ok(content) = std::fs::read_to_string(host) else {
            continue;
        };
        out.push(ComposeFileDto {
            name: host
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| file.clone()),
            path: file.clone(),
            content,
        });
    }
    out
}

/// Read a project's merged config, raw files and a content hash.
pub async fn project(workdir: &str, files: &[String]) -> AppResult<ComposeProjectDto> {
    let location = tokio::task::spawn_blocking({
        let workdir = workdir.to_string();
        let files = files.to_vec();
        move || Location::new(&workdir, &files)
    })
    .await
    .map_err(|err| AppError::Message(format!("Could not locate the compose project: {err}")))?;
    // Parse the *full* model, including services behind inactive profiles, so
    // the Dependencies graph and the "profile off" list have something to show.
    // `--profile '*'` needs Compose 2.20+; fall back to the active model.
    let config = match run_config(&location, true, true).await {
        Ok(config) => config,
        Err(_) => run_config(&location, true, false).await?,
    };
    let parsed: serde_json::Value = serde_json::from_str(&config)
        .map_err(|err| AppError::Message(format!("docker compose config was not JSON: {err}")))?;
    let resolved = run_config(&location, false, false).await?;

    let project_name = parsed
        .get("name")
        .and_then(|name| name.as_str())
        .unwrap_or_default()
        .to_string();

    let mut all_files = read_files(&location);
    // `.env` is loaded for ${VAR} interpolation and shown as its own tab.
    let env_path = location.host_workdir.join(".env");
    if env_path.is_file()
        && let Ok(content) = std::fs::read_to_string(&env_path)
    {
        all_files.push(ComposeFileDto {
            name: ".env".to_string(),
            path: location.display_path(".env"),
            content,
        });
    }

    let mut hasher = Sha256::new();
    for file in &all_files {
        hasher.update(file.name.as_bytes());
        hasher.update(file.content.as_bytes());
    }
    // Build the hex hash by hand over a plain byte slice. Both `hybrid-array`'s
    // inherent `iter` and rust-analyzer's inference of its `Item` are fiddly, so
    // bind a real `u8` and let `write!` format that.
    let digest = hasher.finalize();
    let mut hash = String::with_capacity(digest.len() * 2);
    for &byte in digest.as_slice() {
        let _ = write!(hash, "{byte:02x}");
    }
    let config_hash = hash[..12.min(hash.len())].to_string();

    Ok(ComposeProjectDto {
        project: project_name,
        workdir: location.workdir.clone(),
        files: all_files,
        config_hash,
        compose_version: compose_version(&location).await,
        config: parsed,
        resolved,
    })
}

async fn run_config(location: &Location, json: bool, all_profiles: bool) -> AppResult<String> {
    let mut cmd = location.command()?;
    // `--profile` is a global option: it must precede the subcommand.
    if all_profiles {
        cmd.args(["--profile", "*"]);
    }
    cmd.arg("config");
    if json {
        cmd.args(["--format", "json"]);
    }
    let output = tokio::time::timeout(CONFIG_TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::Message("docker compose config timed out".to_string()))?
        .map_err(|err| {
            AppError::Message(format!("Could not run `docker compose config`: {err}"))
        })?;
    if !output.status.success() {
        return Err(AppError::Message(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run a lifecycle action. Verbs are allow-listed and service/profile names
/// are validated, so a bad UI value can never turn into an unintended command.
pub async fn run_action(request: ComposeActionRequest) -> AppResult<ComposeRunDto> {
    let location = tokio::task::spawn_blocking({
        let workdir = request.workdir.clone();
        let files = request.files.clone();
        move || Location::new(&workdir, &files)
    })
    .await
    .map_err(|err| AppError::Message(format!("Could not locate the compose project: {err}")))?;
    let mut cmd = location.command()?;

    for profile in &request.profiles {
        validate_name(profile, "profile")?;
        cmd.args(["--profile", profile]);
    }

    let service = match request.service.as_deref() {
        Some(service) => {
            validate_name(service, "service")?;
            Some(service)
        }
        None => None,
    };

    match request.action.as_str() {
        "up" => {
            cmd.args(["up", "-d"]);
            if let Some(service) = service {
                cmd.arg(service);
            }
        }
        "recreate" => {
            cmd.args(["up", "-d"]);
            if let Some(service) = service {
                cmd.arg(service);
            }
        }
        "force-recreate" => {
            cmd.args(["up", "-d", "--force-recreate"]);
        }
        "remove-orphans" => {
            cmd.args(["up", "-d", "--remove-orphans"]);
        }
        "start" | "stop" | "restart" | "pull" | "build" => {
            cmd.arg(&request.action);
            if let Some(service) = service {
                cmd.arg(service);
            }
        }
        "rm" => {
            let mut names: Vec<String> = Vec::new();
            if let Some(service) = service {
                names.push(service.to_string());
            }
            for name in &request.services {
                validate_name(name, "service")?;
                names.push(name.clone());
            }
            if names.is_empty() {
                return Err(AppError::Message(
                    "rm needs at least one service".to_string(),
                ));
            }
            cmd.args(["rm", "-sf"]);
            cmd.args(&names);
        }
        "down" | "down-volumes" => {
            cmd.arg("down");
            if request.action == "down-volumes" {
                cmd.arg("-v");
            }
        }
        "scale" => {
            let service =
                service.ok_or_else(|| AppError::Message("scale needs a service".to_string()))?;
            let replicas = request
                .replicas
                .ok_or_else(|| AppError::Message("scale needs a replica count".to_string()))?;
            cmd.args(["up", "-d", "--no-recreate", "--scale"])
                .arg(format!("{service}={replicas}"));
        }
        other => {
            return Err(AppError::Message(format!(
                "Unknown compose action: {other}"
            )));
        }
    }

    let output = tokio::time::timeout(ACTION_TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::Message("docker compose action timed out".to_string()))?
        .map_err(|err| AppError::Message(format!("Could not run `docker compose`: {err}")))?;

    Ok(ComposeRunDto {
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Compose service and profile names: letters, digits, `_`, `.`, `-`.
fn validate_name(name: &str, what: &str) -> AppResult<()> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if ok {
        Ok(())
    } else {
        Err(AppError::Message(format!(
            "Invalid compose {what} name: {name}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_reject_shell_metacharacters() {
        assert!(validate_name("api", "service").is_ok());
        assert!(validate_name("my.svc-1_2", "service").is_ok());
        assert!(validate_name("api;rm -rf /", "service").is_err());
        assert!(validate_name("api$(whoami)", "service").is_err());
        assert!(validate_name("", "service").is_err());
    }

    #[test]
    fn relative_files_resolve_against_workdir() {
        let paths = resolve_paths(Path::new("/work"), &["a.yaml".to_string()]);
        assert_eq!(paths[0], PathBuf::from("/work/a.yaml"));
    }

    #[test]
    fn linux_paths_join_with_forward_slashes() {
        assert!(is_linux_path("/home/me/app"));
        assert!(!is_linux_path("//server/share"));
        assert!(!is_linux_path(r"C:\app"));
        assert_eq!(join_linux("/home/me/app/", "a.yaml"), "/home/me/app/a.yaml");
        assert_eq!(join_linux("/home/me/app", "/etc/b.yaml"), "/etc/b.yaml");
    }
}
