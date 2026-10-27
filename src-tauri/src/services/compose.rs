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
        interpolate: bool,
    ) -> AppResult<String> {
        ensure_files(location)?;
        let mut list = Vec::new();
        // `--profile` is a global option: it must precede the subcommand.
        if all_profiles {
            list.extend(["--profile", "*"]);
        }
        list.push("config");
        if !interpolate {
            list.extend([
                "--no-interpolate",
                "--no-env-resolution",
                "--no-path-resolution",
            ]);
        }
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

    /// Run `docker compose config`, falling back to `--no-interpolate` when
    /// caller-only `${VAR:?}` variables or dynamic `env_file` paths are unset.
    async fn resolve_config(
        &self,
        location: &ComposeLocation,
        json: bool,
        all_profiles: bool,
    ) -> AppResult<String> {
        match self.run_config(location, json, all_profiles, true).await {
            Ok(config) => Ok(config),
            Err(first_err) => self
                .run_config(location, json, all_profiles, false)
                .await
                .or(Err(first_err)),
        }
    }

    async fn read_files(&self, location: &ComposeLocation) -> Vec<ComposeFileDto> {
        let mut items: Vec<(String, String, std::path::PathBuf)> = location
            .files
            .iter()
            .zip(&location.host_files)
            .map(|(file, host)| {
                let name = host
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| file.clone());
                (name, file.clone(), host.clone())
            })
            .collect();
        // `.env` is loaded for ${VAR} interpolation and shown as its own tab.
        items.push((
            ".env".to_string(),
            display_path(location, ".env"),
            location.host_workdir.join(".env"),
        ));

        let reads = items.into_iter().map(|(name, path, host)| async move {
            self.runner
                .read_file(&host)
                .await
                .map(|content| ComposeFileDto {
                    name,
                    path,
                    content,
                })
        });
        futures_util::future::join_all(reads)
            .await
            .into_iter()
            .flatten()
            .collect()
    }
}

#[async_trait]
impl IComposeService for ComposeService {
    async fn project(&self, workdir: &str, files: &[String]) -> AppResult<ComposeProjectDto> {
        let location = self.runner.locate(workdir, files).await?;
        // Parse the *full* model, including services behind inactive profiles, so
        // the Dependencies graph and the "profile off" list have something to show.
        // `--profile '*'` needs Compose 2.20+; fall back to the active model.
        let full_config = async {
            match self.resolve_config(&location, true, true).await {
                Ok(config) => Ok(config),
                Err(_) => self.resolve_config(&location, true, false).await,
            }
        };
        let (config, resolved, all_files, compose_version) = tokio::join!(
            full_config,
            self.resolve_config(&location, false, false),
            self.read_files(&location),
            self.compose_version(&location),
        );
        let config = config?;
        let resolved = resolved?;
        let parsed: serde_json::Value = serde_json::from_str(&config).map_err(|err| {
            AppError::Message(format!("docker compose config was not JSON: {err}"))
        })?;

        let project_name = parsed
            .get("name")
            .and_then(|name| name.as_str())
            .unwrap_or_default()
            .to_string();

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
            compose_version,
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

    struct FakeComposeRunner;

    #[async_trait]
    impl IComposeRunner for FakeComposeRunner {
        async fn locate(&self, workdir: &str, files: &[String]) -> AppResult<ComposeLocation> {
            Ok(ComposeLocation {
                workdir: workdir.to_string(),
                files: files.to_vec(),
                host_workdir: std::path::PathBuf::from(workdir),
                host_files: files.iter().map(std::path::PathBuf::from).collect(),
                distro: None,
            })
        }

        async fn run(
            &self,
            _location: &ComposeLocation,
            args: &[String],
        ) -> std::io::Result<Output> {
            if args.iter().any(|arg| arg == "version") {
                return Ok(output(0, "2.40.3\n", ""));
            }
            if !args.iter().any(|arg| arg == "--no-interpolate") {
                return Ok(output(
                    1,
                    "",
                    "error while interpolating: required variable FOO is missing a value",
                ));
            }
            if args.iter().any(|arg| arg == "json") {
                Ok(output(
                    0,
                    r#"{"name":"demo","services":{"api":{"environment":{"FOO":"${FOO:?req}"}}}}"#,
                    "",
                ))
            } else {
                Ok(output(0, "name: demo\nservices:\n  api: {}\n", ""))
            }
        }

        async fn read_file(&self, _path: &Path) -> Option<String> {
            Some("services:\n  api: {}\n".to_string())
        }
    }

    fn output(code: i32, stdout: &str, stderr: &str) -> Output {
        #[cfg(windows)]
        let status = std::os::windows::process::ExitStatusExt::from_raw(code as u32);
        #[cfg(unix)]
        let status = std::os::unix::process::ExitStatusExt::from_raw(code << 8);
        Output {
            status,
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    #[tokio::test]
    async fn project_falls_back_to_no_interpolate_when_required_vars_missing() {
        let svc = ComposeService::builder()
            .runner(Arc::new(FakeComposeRunner))
            .build();
        let dto = svc
            .project("/work", &["compose.yaml".to_string()])
            .await
            .expect("fallback should succeed");
        assert_eq!(dto.project, "demo");
        assert_eq!(dto.compose_version, "2.40.3");
        assert!(dto.resolved.contains("name: demo"));
    }
}
