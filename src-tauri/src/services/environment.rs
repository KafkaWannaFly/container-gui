//! Host capability probes for the onboarding wizard: WSL, firmware
//! virtualization, winget, and any Podman/Docker already present. Every probe
//! degrades gracefully so a missing tool reports `None`/`false` instead of
//! failing the whole report.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::future::join_all;

use crate::error::AppError;
use crate::models::dto::{EnvironmentReportDto, PodmanMachineDto, WslDistroDto, WslReportDto};
use crate::services::infrastructure::{IProcessRunner, ProcessOutput};

/// Booting a stopped distro to probe it must not hang the report.
const WSL_DOCKER_PROBE_TIMEOUT: Duration = Duration::from_secs(20);

/// Distros to offer when `wsl -l -o` is unavailable (older wsl.exe builds).
const POPULAR_FALLBACK: &[&str] = &["Ubuntu-24.04", "Debian"];

/// Families the provisioner knows how to install into (apt/apk).
const SUPPORTED_FAMILIES: &[&str] = &["ubuntu", "debian", "alpine"];

/// Distros owned by other tools; installing into them would clash.
pub fn is_managed_distro(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("docker-desktop") || lower.starts_with("podman-machine")
}

#[async_trait]
pub trait IEnvironmentService: Send + Sync {
    async fn report(&self) -> EnvironmentReportDto;
}

#[derive(bon::Builder)]
pub struct EnvironmentService {
    runner: Arc<dyn IProcessRunner>,
}

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

#[async_trait]
impl IEnvironmentService for EnvironmentService {
    async fn report(&self) -> EnvironmentReportDto {
        let (wsl, virtualization, winget, podman, docker) = tokio::join!(
            self.wsl(),
            self.virtualization(),
            self.winget(),
            self.podman(),
            self.docker(),
        );
        let (podman_version, podman_machines) = podman;
        EnvironmentReportDto {
            wsl,
            virtualization,
            winget,
            podman_version,
            docker_version: docker,
            podman_machines,
        }
    }
}

impl EnvironmentService {
    async fn probe(&self, program: &str, argv: &[&str]) -> Option<ProcessOutput> {
        match self.runner.output(program, &args(argv)).await {
            Ok(out) => Some(out),
            Err(AppError::ProgramNotFound { .. }) => None,
            Err(_) => None,
        }
    }

    async fn wsl(&self) -> WslReportDto {
        let Some(status) = self.probe("wsl.exe", &["--status"]).await else {
            return WslReportDto {
                installed: false,
                default_version: None,
                distros: Vec::new(),
                installables: Vec::new(),
            };
        };
        let default_version = status.stdout.lines().find_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix("Default Version:")?.trim();
            rest.parse::<u32>().ok()
        });
        let mut distros = self
            .probe("wsl.exe", &["-l", "-v"])
            .await
            .map(|out| parse_distros(&out.stdout))
            .unwrap_or_default();
        let installables = self
            .probe("wsl.exe", &["-l", "-o"])
            .await
            .map(|out| parse_installables(&out.stdout))
            .filter(|names| !names.is_empty())
            .unwrap_or_else(|| {
                POPULAR_FALLBACK
                    .iter()
                    .map(|name| name.to_string())
                    .collect()
            });
        let docker_flags = join_all(distros.iter().map(|distro| self.has_docker(distro))).await;
        for (distro, has_docker) in distros.iter_mut().zip(docker_flags) {
            distro.has_docker = has_docker;
        }
        WslReportDto {
            installed: true,
            default_version,
            distros,
            installables,
        }
    }

    /// Boot the WSL2 distro just long enough to look for `dockerd`.
    async fn has_docker(&self, distro: &WslDistroDto) -> bool {
        if distro.version != 2 || is_managed_distro(&distro.name) {
            return false;
        }
        let argv = args(&[
            "-d",
            &distro.name,
            "-u",
            "root",
            "--",
            "sh",
            "-c",
            "command -v dockerd",
        ]);
        match tokio::time::timeout(
            WSL_DOCKER_PROBE_TIMEOUT,
            self.runner.output("wsl.exe", &argv),
        )
        .await
        {
            Ok(Ok(out)) => out.success() && !out.stdout.trim().is_empty(),
            _ => false,
        }
    }

    async fn virtualization(&self) -> Option<bool> {
        #[cfg(windows)]
        {
            let out = self
                .probe(
                    "powershell.exe",
                    &[
                        "-NoProfile",
                        "-Command",
                        "(Get-CimInstance -ClassName Win32_ComputerSystem).HypervisorPresent",
                    ],
                )
                .await?;
            let text = out.stdout.trim().to_ascii_lowercase();
            if text.contains("true") {
                Some(true)
            } else if text.contains("false") {
                Some(false)
            } else {
                None
            }
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    async fn winget(&self) -> Option<String> {
        let out = self.probe("winget", &["--version"]).await?;
        out.success().then(|| out.stdout.trim().to_string())
    }

    async fn podman(&self) -> (Option<String>, Vec<PodmanMachineDto>) {
        let Some(version) = self.probe("podman", &["--version"]).await else {
            return (None, Vec::new());
        };
        if !version.success() {
            return (None, Vec::new());
        }
        let version_text = version.stdout.trim().to_string();
        let machines = self
            .probe("podman", &["machine", "list", "--format", "json"])
            .await
            .filter(ProcessOutput::success)
            .map(|out| parse_machines(&out.stdout))
            .unwrap_or_default();
        (Some(version_text), machines)
    }

    async fn docker(&self) -> Option<String> {
        let out = self.probe("docker", &["--version"]).await?;
        out.success().then(|| out.stdout.trim().to_string())
    }
}

/// Parse `wsl -l -v`: a header row, then `[*] NAME STATE VERSION`. The name
/// may contain spaces, so state and version are read from the right.
pub fn parse_distros(text: &str) -> Vec<WslDistroDto> {
    let mut distros = Vec::new();
    for line in text.lines() {
        let line = line.trim().trim_matches('\0');
        if line.is_empty() {
            continue;
        }
        let upper = line.to_ascii_uppercase();
        if upper.contains("NAME") && upper.contains("VERSION") {
            continue;
        }
        let line = line.strip_prefix('*').unwrap_or(line).trim();
        let mut parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 3 {
            continue;
        }
        let version = parts.pop().and_then(|part| part.parse::<u32>().ok());
        let state = parts.pop().unwrap_or_default().to_string();
        let name = parts.join(" ");
        let Some(version) = version else { continue };
        if name.is_empty() {
            continue;
        }
        distros.push(WslDistroDto {
            name,
            state,
            version,
            has_docker: false,
        });
    }
    distros
}

/// Parse `wsl -l -o`: a header row (`NAME  FRIENDLY NAME`), then installable
/// distro names, `*` marking the default. Keep the Docker-supported families,
/// prefer LTS releases (Ubuntu ships LTS every April, so every
/// `Ubuntu-<yy>.04` qualifies while interim `.10` releases and the
/// version-less `Ubuntu` alias drop out), and sort newest first.
pub fn parse_installables(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in text.lines() {
        let line = line
            .trim()
            .trim_matches('\0')
            .trim_start_matches('*')
            .trim();
        let Some(name) = line.split_whitespace().next() else {
            continue;
        };
        let upper = line.to_ascii_uppercase();
        if upper.contains("NAME") && upper.contains("FRIENDLY") {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        let supported = SUPPORTED_FAMILIES
            .iter()
            .any(|family| lower.starts_with(family));
        let lts_preferred = !lower.starts_with("ubuntu") || lower.ends_with(".04");
        if supported && lts_preferred {
            names.push(name.to_string());
        }
    }
    names.sort();
    names.dedup();
    names.reverse();
    names
}

/// Parse `podman machine list --format json` leniently: only name/running/
/// rootless are needed, and field casing varies across Podman versions.
pub fn parse_machines(text: &str) -> Vec<PodmanMachineDto> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(text)
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("Name")?.as_str()?.to_string();
            let running = item
                .get("Running")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let rootless = item
                .get("Rootless")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            Some(PodmanMachineDto {
                name,
                running,
                rootless,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wsl_distros_with_default_marker() {
        let text = "  NAME                   STATE           VERSION\n\
                    * Ubuntu                 Running         2\n  \
                      docker-desktop         Stopped         2\n";
        let distros = parse_distros(text);
        assert_eq!(distros.len(), 2);
        assert_eq!(distros[0].name, "Ubuntu");
        assert_eq!(distros[0].state, "Running");
        assert_eq!(distros[0].version, 2);
        assert!(!distros[0].has_docker);
        assert_eq!(distros[1].name, "docker-desktop");
    }

    #[test]
    fn installables_keep_supported_lts_families_sorted_newest_first() {
        let text = "  NAME                   FRIENDLY NAME\n\
                    * Ubuntu                 Ubuntu\n  \
                      Ubuntu-26.04           Ubuntu 26.04 LTS\n  \
                      Ubuntu-24.04           Ubuntu 24.04 LTS\n  \
                      Ubuntu-25.10           Ubuntu 25.10\n  \
                      Debian                 Debian GNU/Linux\n  \
                      openSUSE-15.6          openSUSE Leap 15.6\n  \
                      FedoraLinux-41         Fedora\n  \
                      Alpine                 Alpine\n";
        assert_eq!(
            parse_installables(text),
            vec!["Ubuntu-26.04", "Ubuntu-24.04", "Debian", "Alpine"]
        );
    }

    #[test]
    fn managed_distros_are_recognized() {
        assert!(is_managed_distro("docker-desktop"));
        assert!(is_managed_distro("Docker-Desktop-data"));
        assert!(is_managed_distro("podman-machine-default"));
        assert!(!is_managed_distro("Ubuntu-26.04"));
    }

    #[test]
    fn parses_podman_machines() {
        let text = r#"[{"Name":"podman-machine-default","Running":true,"Rootless":true}]"#;
        let machines = parse_machines(text);
        assert_eq!(machines.len(), 1);
        assert_eq!(machines[0].name, "podman-machine-default");
        assert!(machines[0].running);
        assert!(machines[0].rootless);
    }

    #[test]
    fn malformed_machine_json_is_empty() {
        assert!(parse_machines("not json").is_empty());
        assert!(parse_machines("{}").is_empty());
    }
}
