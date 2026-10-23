//! Runs the `docker compose` v2 CLI. Bollard has no Compose support, and
//! there is no maintained Rust crate that covers the command surface we need;
//! the crates that do execute only wrap this same binary.
//!
//! Projects started from a WSL distro carry Linux paths in their compose
//! labels. Their files are reachable from Windows through the `\\wsl$` share,
//! but `docker compose` itself must run inside the distro: run from Windows it
//! rewrites relative bind mounts to UNC paths and recreates containers with
//! broken mounts, and it misses the distro's environment.

use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};

use async_trait::async_trait;
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::models::engine::ComposeLocation;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[async_trait]
pub trait IComposeRunner: Send + Sync {
    /// Where the project lives: the host, or the WSL distro that owns it.
    async fn locate(&self, workdir: &str, files: &[String]) -> AppResult<ComposeLocation>;
    /// Run `docker compose -f <files…> <args…>` for `location`. Dropping the
    /// future kills the process.
    async fn run(&self, location: &ComposeLocation, args: &[String]) -> std::io::Result<Output>;
    /// Read a project file through its host path.
    async fn read_file(&self, path: &Path) -> Option<String>;
}

#[derive(Default, bon::Builder)]
pub struct DockerComposeCli {
    #[builder(skip)]
    distros: std::sync::Mutex<std::collections::HashMap<String, Option<String>>>,
}

#[async_trait]
impl IComposeRunner for DockerComposeCli {
    async fn locate(&self, workdir: &str, files: &[String]) -> AppResult<ComposeLocation> {
        let cached = self
            .distros
            .lock()
            .ok()
            .and_then(|map| map.get(workdir).cloned());
        let workdir_owned = workdir.to_string();
        let files_owned = files.to_vec();
        let location =
            tokio::task::spawn_blocking(move || locate(&workdir_owned, &files_owned, cached))
                .await
                .map_err(|err| {
                    AppError::Message(format!("Could not locate the compose project: {err}"))
                })?;
        if is_linux_path(workdir)
            && let Ok(mut map) = self.distros.lock()
        {
            map.insert(workdir.to_string(), location.distro.clone());
        }
        Ok(location)
    }

    async fn run(&self, location: &ComposeLocation, args: &[String]) -> std::io::Result<Output> {
        command(location).args(args).output().await
    }

    async fn read_file(&self, path: &Path) -> Option<String> {
        tokio::fs::read_to_string(path).await.ok()
    }
}

/// Release builds use the GUI subsystem; keep child consoles from flashing.
fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = cmd;
}

pub fn is_linux_path(path: &str) -> bool {
    path.starts_with('/') && !path.starts_with("//")
}

pub fn join_linux(workdir: &str, file: &str) -> String {
    if file.starts_with('/') {
        file.to_string()
    } else {
        format!("{}/{file}", workdir.trim_end_matches('/'))
    }
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

fn locate(
    workdir: &str,
    files: &[String],
    cached_distro: Option<Option<String>>,
) -> ComposeLocation {
    #[cfg(windows)]
    if is_linux_path(workdir)
        && let Some(distro) = cached_distro.unwrap_or_else(|| wsl::distro_for(workdir))
    {
        let files: Vec<String> = files.iter().map(|file| join_linux(workdir, file)).collect();
        return ComposeLocation {
            host_workdir: wsl::unc(&distro, workdir),
            host_files: files.iter().map(|file| wsl::unc(&distro, file)).collect(),
            workdir: workdir.to_string(),
            files,
            distro: Some(distro),
        };
    }
    #[cfg(not(windows))]
    let _ = cached_distro;
    let host_workdir = PathBuf::from(workdir);
    let host_files = resolve_paths(&host_workdir, files);
    ComposeLocation {
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
fn command(location: &ComposeLocation) -> Command {
    let mut cmd = match &location.distro {
        Some(distro) => {
            let mut cmd = Command::new("wsl.exe");
            // A login shell puts the distro's docker on PATH; "$@" passes
            // every argument verbatim, so `--profile *` is never globbed.
            cmd.args(["-d", distro, "--cd", &location.workdir, "-e", "sh", "-lc"])
                .arg("exec docker compose \"$@\"")
                .arg("sh");
            cmd
        }
        None => {
            let mut cmd = Command::new("docker");
            cmd.arg("compose");
            cmd.current_dir(&location.host_workdir);
            cmd
        }
    };
    for file in &location.files {
        cmd.arg("-f").arg(file);
    }
    cmd.stdin(Stdio::null());
    cmd.kill_on_drop(true);
    hide_window(&mut cmd);
    cmd
}

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

#[cfg(test)]
mod tests {
    use super::*;

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
