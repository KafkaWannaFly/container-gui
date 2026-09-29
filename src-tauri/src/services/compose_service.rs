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

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::models::dto::{ComposeActionRequest, ComposeFileDto, ComposeProjectDto, ComposeRunDto};

/// `docker compose config` reads files and env; it should never take long.
const CONFIG_TIMEOUT: Duration = Duration::from_secs(20);
/// `up`/`build`/`pull` can download images, so give actions more room.
const ACTION_TIMEOUT: Duration = Duration::from_secs(600);

/// The `docker compose` version never changes while the app runs.
fn compose_version() -> &'static str {
    static VERSION: OnceLock<String> = OnceLock::new();
    VERSION.get_or_init(|| {
        let output = std::process::Command::new("docker")
            .args(["compose", "version", "--short"])
            .output();
        match output {
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            }
            _ => "unknown".to_string(),
        }
    })
}

fn base_command(workdir: &Path, files: &[String]) -> AppResult<Command> {
    if files.is_empty() {
        return Err(AppError::Message(
            "No compose files were provided for this project".to_string(),
        ));
    }
    let mut cmd = Command::new("docker");
    cmd.arg("compose");
    for file in files {
        cmd.arg("-f").arg(file);
    }
    cmd.current_dir(workdir);
    cmd.stdin(Stdio::null());
    cmd.kill_on_drop(true);
    Ok(cmd)
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

fn read_files(files: &[String]) -> Vec<ComposeFileDto> {
    let mut out = Vec::with_capacity(files.len());
    for file in files {
        let path = PathBuf::from(file);
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        out.push(ComposeFileDto {
            name: path
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
    let workdir = PathBuf::from(workdir);
    let resolved_files = resolve_paths(&workdir, files)
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    // Parse the *full* model, including services behind inactive profiles, so
    // the Dependencies graph and the "profile off" list have something to show.
    // `--profile '*'` needs Compose 2.20+; fall back to the active model.
    let config = match run_config(&workdir, &resolved_files, true, true).await {
        Ok(config) => config,
        Err(_) => run_config(&workdir, &resolved_files, true, false).await?,
    };
    let parsed: serde_json::Value = serde_json::from_str(&config)
        .map_err(|err| AppError::Message(format!("docker compose config was not JSON: {err}")))?;
    let resolved = run_config(&workdir, &resolved_files, false, false).await?;

    let project_name = parsed
        .get("name")
        .and_then(|name| name.as_str())
        .unwrap_or_default()
        .to_string();

    let mut all_files = read_files(&resolved_files);
    // `.env` is loaded for ${VAR} interpolation and shown as its own tab.
    let env_path = workdir.join(".env");
    if env_path.exists()
        && let Ok(content) = std::fs::read_to_string(&env_path)
    {
        all_files.push(ComposeFileDto {
            name: ".env".to_string(),
            path: env_path.to_string_lossy().into_owned(),
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
        workdir: workdir.to_string_lossy().into_owned(),
        files: all_files,
        config_hash,
        compose_version: compose_version().to_string(),
        config: parsed,
        resolved,
    })
}

async fn run_config(
    workdir: &Path,
    files: &[String],
    json: bool,
    all_profiles: bool,
) -> AppResult<String> {
    let mut cmd = base_command(workdir, files)?;
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
    let workdir = PathBuf::from(&request.workdir);
    let mut cmd = base_command(&workdir, &request.files)?;

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
                return Err(AppError::Message("rm needs at least one service".to_string()));
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
        Err(AppError::Message(format!("Invalid compose {what} name: {name}")))
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
}
