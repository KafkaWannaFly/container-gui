//! Compose project reads and lifecycle actions, run through
//! [`IComposeRunner`].
//!
//! Callers pass the project working directory and its compose files (read from
//! the `com.docker.compose.project.*` labels) so the backend never has to
//! re-list containers just to find them.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::Path;
use std::process::Output;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::models::dto::{ComposeActionRequest, ComposeFileDto, ComposeProjectDto, ComposeRunDto};
use crate::models::engine::ComposeLocation;
use crate::services::infrastructure::IComposeRunner;
use crate::services::infrastructure::compose_runner::{is_linux_path, join_linux};

/// `docker compose config` reads files and env; it should never take long.
const CONFIG_TIMEOUT: Duration = Duration::from_secs(20);
/// `up`/`build`/`pull` can download images, so give actions more room.
const ACTION_TIMEOUT: Duration = Duration::from_secs(600);

#[async_trait]
pub trait IComposeService: Send + Sync {
    /// Merged config, raw files and metadata for one compose project.
    async fn project(&self, workdir: &str, files: &[String]) -> AppResult<ComposeProjectDto>;
    /// Run an allow-listed `docker compose` lifecycle action.
    async fn run_action(&self, request: ComposeActionRequest) -> AppResult<ComposeRunDto>;
}

#[derive(bon::Builder)]
pub struct ComposeService {
    runner: Arc<dyn IComposeRunner>,
    /// The `docker compose` version per place it runs (host or a WSL distro).
    #[builder(skip)]
    versions: Mutex<HashMap<Option<String>, String>>,
}

fn ensure_files(location: &ComposeLocation) -> AppResult<()> {
    if location.files.is_empty() {
        return Err(AppError::Message(
            "No compose files were provided for this project".to_string(),
        ));
    }
    Ok(())
}

fn display_path(location: &ComposeLocation, name: &str) -> String {
    if is_linux_path(&location.workdir) {
        join_linux(&location.workdir, name)
    } else {
        Path::new(&location.workdir)
            .join(name)
            .to_string_lossy()
            .into_owned()
    }
}

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|arg| arg.to_string()).collect()
}

impl ComposeService {
    /// Run with a timeout; `None` when it timed out.
    async fn run(
        &self,
        location: &ComposeLocation,
        args: &[String],
        timeout: Duration,
    ) -> Option<std::io::Result<Output>> {
        tokio::time::timeout(timeout, self.runner.run(location, args))
            .await
            .ok()
    }

    async fn compose_version(&self, location: &ComposeLocation) -> String {
        if let Some(version) = self
            .versions
            .lock()
            .ok()
            .and_then(|map| map.get(&location.distro).cloned())
        {
            return version;
        }
        if ensure_files(location).is_err() {
            return "unknown".to_string();
        }
        let version = match self
            .run(location, &args(&["version", "--short"]), CONFIG_TIMEOUT)
            .await
        {
            Some(Ok(out)) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            }
            _ => return "unknown".to_string(),
        };
        if let Ok(mut map) = self.versions.lock() {
            map.insert(location.distro.clone(), version.clone());
        }
        version
    }

    async fn run_config(
        &self,
        location: &ComposeLocation,
        json: bool,
        all_profiles: bool,
    ) -> AppResult<String> {
        ensure_files(location)?;
        let mut list = Vec::new();
        // `--profile` is a global option: it must precede the subcommand.
        if all_profiles {
            list.extend(["--profile", "*"]);
        }
        list.push("config");
        if json {
            list.extend(["--format", "json"]);
        }
        let output = self
            .run(location, &args(&list), CONFIG_TIMEOUT)
            .await
            .ok_or_else(|| AppError::Message("docker compose config timed out".to_string()))?
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

    async fn read_files(&self, location: &ComposeLocation) -> Vec<ComposeFileDto> {
        let mut out = Vec::with_capacity(location.files.len());
        for (file, host) in location.files.iter().zip(&location.host_files) {
            let Some(content) = self.runner.read_file(host).await else {
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
}

#[async_trait]
impl IComposeService for ComposeService {
    async fn project(&self, workdir: &str, files: &[String]) -> AppResult<ComposeProjectDto> {
        let location = self.runner.locate(workdir, files).await?;
        // Parse the *full* model, including services behind inactive profiles, so
        // the Dependencies graph and the "profile off" list have something to show.
        // `--profile '*'` needs Compose 2.20+; fall back to the active model.
        let config = match self.run_config(&location, true, true).await {
            Ok(config) => config,
            Err(_) => self.run_config(&location, true, false).await?,
        };
        let parsed: serde_json::Value = serde_json::from_str(&config).map_err(|err| {
            AppError::Message(format!("docker compose config was not JSON: {err}"))
        })?;
        let resolved = self.run_config(&location, false, false).await?;

        let project_name = parsed
            .get("name")
            .and_then(|name| name.as_str())
            .unwrap_or_default()
            .to_string();

        let mut all_files = self.read_files(&location).await;
        // `.env` is loaded for ${VAR} interpolation and shown as its own tab.
        if let Some(content) = self
            .runner
            .read_file(&location.host_workdir.join(".env"))
            .await
        {
            all_files.push(ComposeFileDto {
                name: ".env".to_string(),
                path: display_path(&location, ".env"),
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
            compose_version: self.compose_version(&location).await,
            config: parsed,
            resolved,
        })
    }

    /// Verbs are allow-listed and service/profile names are validated, so a
    /// bad UI value can never turn into an unintended command.
    async fn run_action(&self, request: ComposeActionRequest) -> AppResult<ComposeRunDto> {
        let location = self.runner.locate(&request.workdir, &request.files).await?;
        ensure_files(&location)?;
        let args = action_args(&request)?;

        let output = self
            .run(&location, &args, ACTION_TIMEOUT)
            .await
            .ok_or_else(|| AppError::Message("docker compose action timed out".to_string()))?
            .map_err(|err| AppError::Message(format!("Could not run `docker compose`: {err}")))?;

        Ok(ComposeRunDto {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Arguments after `docker compose -f …` for one lifecycle action.
fn action_args(request: &ComposeActionRequest) -> AppResult<Vec<String>> {
    let mut cmd: Vec<String> = Vec::new();
    for profile in &request.profiles {
        validate_name(profile, "profile")?;
        cmd.extend(["--profile".to_string(), profile.clone()]);
    }

    let service = match request.service.as_deref() {
        Some(service) => {
            validate_name(service, "service")?;
            Some(service)
        }
        None => None,
    };
    let mut push = |list: &[&str]| cmd.extend(list.iter().map(|arg| arg.to_string()));

    match request.action.as_str() {
        "up" | "recreate" => {
            push(&["up", "-d"]);
            if let Some(service) = service {
                push(&[service]);
            }
        }
        "force-recreate" => push(&["up", "-d", "--force-recreate"]),
        "remove-orphans" => push(&["up", "-d", "--remove-orphans"]),
        "start" | "stop" | "restart" | "pull" | "build" => {
            push(&[request.action.as_str()]);
            if let Some(service) = service {
                push(&[service]);
            }
        }
        "rm" => {
            let mut names: Vec<&str> = Vec::new();
            if let Some(service) = service {
                names.push(service);
            }
            for name in &request.services {
                validate_name(name, "service")?;
                names.push(name);
            }
            if names.is_empty() {
                return Err(AppError::Message(
                    "rm needs at least one service".to_string(),
                ));
            }
            push(&["rm", "-sf"]);
            push(&names);
        }
        "down" | "down-volumes" => {
            push(&["down"]);
            if request.action == "down-volumes" {
                push(&["-v"]);
            }
        }
        "scale" => {
            let service =
                service.ok_or_else(|| AppError::Message("scale needs a service".to_string()))?;
            let replicas = request
                .replicas
                .ok_or_else(|| AppError::Message("scale needs a replica count".to_string()))?;
            push(&["up", "-d", "--no-recreate", "--scale"]);
            push(&[format!("{service}={replicas}").as_str()]);
        }
        other => {
            return Err(AppError::Message(format!(
                "Unknown compose action: {other}"
            )));
        }
    }
    Ok(cmd)
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

    fn request(action: &str) -> ComposeActionRequest {
        ComposeActionRequest {
            workdir: "/work".into(),
            files: vec!["compose.yaml".into()],
            action: action.into(),
            service: None,
            replicas: None,
            profiles: Vec::new(),
            services: Vec::new(),
        }
    }

    #[test]
    fn names_reject_shell_metacharacters() {
        assert!(validate_name("api", "service").is_ok());
        assert!(validate_name("my.svc-1_2", "service").is_ok());
        assert!(validate_name("api;rm -rf /", "service").is_err());
        assert!(validate_name("api$(whoami)", "service").is_err());
        assert!(validate_name("", "service").is_err());
    }

    #[test]
    fn profiles_precede_the_verb() {
        let mut req = request("up");
        req.profiles = vec!["debug".into()];
        req.service = Some("api".into());
        assert_eq!(
            action_args(&req).unwrap(),
            vec!["--profile", "debug", "up", "-d", "api"]
        );
    }

    #[test]
    fn scale_and_rm_need_targets() {
        let mut scale = request("scale");
        assert!(action_args(&scale).is_err());
        scale.service = Some("web".into());
        scale.replicas = Some(3);
        assert_eq!(
            action_args(&scale).unwrap(),
            vec!["up", "-d", "--no-recreate", "--scale", "web=3"]
        );
        assert!(action_args(&request("rm")).is_err());
        assert!(action_args(&request("explode")).is_err());
    }
}
