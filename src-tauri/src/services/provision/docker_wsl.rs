//! Real Docker Engine (moby) in WSL — backend-only, no Docker Desktop.
//! Targets three sources: an existing user distro, a popular distro to
//! register first via `wsl --install -d` (Ubuntu/Debian get docker-ce from
//! Docker's apt repo), or — when nothing is picked — a fresh minimal Alpine
//! import named after the machine. Exposes the daemon on loopback TCP
//! (127.0.0.1:2375), which WSL2 forwards to the Windows host. Autostart uses
//! a systemd drop-in when systemd runs in the distro, otherwise a
//! `[boot] command` entry in `/etc/wsl.conf` (merged, never clobbered, on
//! user distros). The endpoint is remembered as the installed preference so
//! it survives restarts.

use std::sync::Arc;
use std::time::Duration;

use super::provision_service::{InstallCtx, args, loopback_tcp_config};
use crate::error::{AppError, AppResult};
use crate::models::dto::{
    DockerTarget, DockerTargetKind, DownloadProgressDto, InstallEventDto, InstallRequest,
};
use crate::services::environment::is_managed_distro;
use crate::services::infrastructure::IEventSink;

const TOTAL: u32 = 4;
const ALPINE_RELEASES: &str =
    "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/";
const DOCKERD_HOSTS: &str = "-H unix:///var/run/docker.sock -H tcp://127.0.0.1:2375";

pub(super) async fn install(ctx: &InstallCtx, req: &InstallRequest) -> AppResult<String> {
    // Which distro, and where it comes from.
    let target = req.target.as_ref().map(|t| DockerTarget {
        kind: t.kind,
        name: t.name.trim().to_string(),
    });
    if let Some(target) = &target
        && is_managed_distro(&target.name)
    {
        return Err(AppError::Message(format!(
            "'{name}' is managed by another tool — pick a different distribution or create a new one",
            name = target.name
        )));
    }
    // The dedicated import resolves its name from the tarball version
    // (`Alpine-3.22`), so it starts unknown.
    let mut distro = match &target {
        Some(t) => t.name.clone(),
        None => String::new(),
    };
    // `Install` degrades to `Existing` when the distro is already registered.
    let mut mode = target.as_ref().map(|t| t.kind);
    if mode == Some(DockerTargetKind::Install) && distro_exists(ctx, &distro).await {
        mode = Some(DockerTargetKind::Existing);
    }
    let is_import = mode.is_none();

    // Phase 0 — prepare the WSL distro.
    ctx.phase(0, TOTAL, "Prepare WSL distro");
    if is_import {
        if let Some(existing) = find_existing_alpine(ctx).await {
            distro = existing;
            ctx.line(
                "stdout",
                format!("Alpine distribution '{distro}' already registered — skipping import"),
            );
        } else {
            let url = alpine_rootfs_url(ctx).await?;
            let filename = url
                .rsplit('/')
                .next()
                .unwrap_or("rootfs.tar.gz")
                .to_string();
            distro = derive_alpine_name(&filename).ok_or_else(|| {
                AppError::Message(format!(
                    "Could not derive an Alpine version from '{filename}'"
                ))
            })?;
            ctx.line("stdout", format!("Registering distribution '{distro}'"));
            let downloads = ctx.data_dir.join("downloads");
            let tarball = downloads.join(&filename);
            ctx.line("stdout", format!("Downloading {url}"));
            let adapter = Arc::new(DownloadAdapter {
                sink: ctx.sink.clone(),
            });
            ctx.downloader.download(&url, &tarball, adapter).await?;

            let install_dir = ctx.data_dir.join("wsl").join(&distro);
            let code = ctx
                .run_stream(
                    "wsl.exe",
                    &args(&[
                        "--import",
                        &distro,
                        &install_dir.to_string_lossy(),
                        &tarball.to_string_lossy(),
                        "--version",
                        "2",
                    ]),
                )
                .await?;
            if code != 0 {
                return Err(AppError::Message(format!(
                    "wsl --import exited with {code}"
                )));
            }
        }
    } else if mode == Some(DockerTargetKind::Install) {
        ctx.line(
            "stdout",
            format!("Registering '{distro}' — wsl --install -d {distro}"),
        );
        let code = ctx
            .run_stream(
                "wsl.exe",
                &args(&["--install", "-d", &distro, "--no-launch"]),
            )
            .await?;
        if code != 0 || !distro_exists(ctx, &distro).await {
            return Err(AppError::Message(format!(
                "wsl --install -d {distro} failed (exit {code}) — is the name in 'wsl -l -o'?"
            )));
        }
    } else if !distro_exists(ctx, &distro).await {
        return Err(AppError::Message(format!(
            "Distribution '{distro}' was not found on this machine"
        )));
    } else {
        ctx.line("stdout", format!("Using existing distribution '{distro}'"));
    }

    let (pkg, os_label) = detect_pkg(ctx, &distro).await?;
    ctx.line("stdout", format!("Target: {os_label}"));
    let systemd = has_systemd(ctx, &distro).await;

    // Phase 1 — install the Docker daemon inside the distro.
    ctx.phase(1, TOTAL, "Install Docker Engine");
    if has_dockerd(ctx, &distro).await {
        ctx.line(
            "stdout",
            "Docker is already installed — skipping package install",
        );
    } else {
        let script = match pkg {
            Pkg::Apt => APT_INSTALL,
            Pkg::Apk => APK_INSTALL,
        };
        let code = ctx
            .run_stream("wsl.exe", &wsl_shell(&distro, script))
            .await?;
        if !has_dockerd(ctx, &distro).await {
            return Err(AppError::Message(format!(
                "Docker install failed (exit {code}) — dockerd is not present in '{distro}'"
            )));
        }
    }

    // Phase 2 — configure the loopback API and autostart.
    ctx.phase(2, TOTAL, "Configure API");
    let script = if systemd {
        &systemd_configure(DOCKERD_HOSTS)
    } else if is_import {
        &write_wsl_conf(DOCKERD_HOSTS)
    } else {
        &merge_wsl_conf(DOCKERD_HOSTS)
    };
    let code = ctx
        .run_stream("wsl.exe", &wsl_shell(&distro, script))
        .await?;
    if code != 0 {
        return Err(AppError::Message(format!(
            "configuring the Docker service exited with {code}"
        )));
    }

    // Phase 3 — start dockerd and connect.
    ctx.phase(3, TOTAL, "Start & verify");
    let script = if systemd {
        SYSTEMD_START
    } else {
        &start_dockerd(DOCKERD_HOSTS)
    };
    let code = ctx
        .run_stream("wsl.exe", &wsl_shell(&distro, script))
        .await?;
    if code != 0 {
        return Err(AppError::Message(format!(
            "starting dockerd exited with {code}"
        )));
    }
    let status = connect_tcp(ctx).await?;
    ctx.line(
        "stdout",
        format!(
            "Engine: {} · API {} · loopback TCP",
            status.engine_version.unwrap_or_default(),
            status.api_version.unwrap_or_default(),
        ),
    );
    // Best-effort smoke container inside the distro.
    let _ = ctx
        .run_stream(
            "wsl.exe",
            &wsl_shell(&distro, "docker run --rm hello-world || true"),
        )
        .await;
    Ok(distro)
}

/// `wsl -d <distro> -u root -- sh -c <script>`.
fn wsl_shell(distro: &str, script: &str) -> Vec<String> {
    args(&["-d", distro, "-u", "root", "--", "sh", "-c", script])
}

/// `alpine-minirootfs-3.22.1-x86_64.tar.gz` → `Alpine-3.22`, following the
/// `Ubuntu-26.04` name convention (major.minor, no patch).
pub(super) fn derive_alpine_name(filename: &str) -> Option<String> {
    let rest = filename.strip_prefix("alpine-minirootfs-")?;
    let version = rest.split('-').next().filter(|v| !v.is_empty())?;
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    Some(format!("Alpine-{major}.{minor}"))
}

/// All registered distro names.
async fn distro_names(ctx: &InstallCtx) -> Vec<String> {
    ctx.output("wsl.exe", &args(&["-l", "-q"]))
        .await
        .map(|probe| {
            probe
                .stdout
                .lines()
                .map(|line| line.trim().trim_matches('\0').to_string())
                .filter(|line| !line.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Reuse an already-imported/installed Alpine instead of re-downloading:
/// the highest `Alpine-<version>` match, plain `Alpine` as a last resort.
async fn find_existing_alpine(ctx: &InstallCtx) -> Option<String> {
    distro_names(ctx)
        .await
        .into_iter()
        .filter(|name| name.to_ascii_lowercase().starts_with("alpine"))
        .max_by_key(|name| alpine_version_key(name))
}

/// Sort key from the name's leading version, e.g. `Alpine-3.22` → `(3, 22)`.
fn alpine_version_key(name: &str) -> (u32, u32) {
    let rest = name.to_ascii_lowercase();
    let rest = rest.trim_start_matches("alpine").trim_start_matches('-');
    let mut parts = rest.split('.');
    let major = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    (major, minor)
}

const APT_INSTALL: &str = concat!(
    "command -v curl >/dev/null 2>&1 || ",
    "(apt-get update && apt-get install -y curl ca-certificates); ",
    "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh",
);

const APK_INSTALL: &str = concat!(
    "printf '%s\\n' ",
    "'http://dl-cdn.alpinelinux.org/alpine/latest-stable/main' ",
    "'http://dl-cdn.alpinelinux.org/alpine/latest-stable/community' ",
    "> /etc/apk/repositories && ",
    "apk update && apk add --no-cache docker docker-cli containerd",
);

/// Drop-in that rewrites `docker.service`'s ExecStart so the daemon listens
/// on the loopback endpoint as well, under systemd management.
fn systemd_configure(hosts: &str) -> String {
    format!(
        "mkdir -p /etc/systemd/system/docker.service.d && \
         printf '[Service]\\nExecStart=\\nExecStart=/usr/bin/dockerd {hosts}\\n' \
         > /etc/systemd/system/docker.service.d/container-gui.conf && systemctl daemon-reload"
    )
}

const SYSTEMD_START: &str = "systemctl enable docker >/dev/null 2>&1; systemctl restart docker";

fn start_dockerd(hosts: &str) -> String {
    format!(
        "pidof dockerd >/dev/null 2>&1 || \
         (nohup dockerd {hosts} >/var/log/dockerd.log 2>&1 &)"
    )
}

fn boot_command(hosts: &str) -> String {
    format!("nohup dockerd {hosts} >/var/log/dockerd.log 2>&1 &")
}

/// New dedicated distro: write a plain `[boot]` autostart entry.
fn write_wsl_conf(hosts: &str) -> String {
    format!(
        "printf '[boot]\\ncommand = \"{}\"\\n' > /etc/wsl.conf",
        boot_command(hosts)
    )
}

/// Existing user distro: add our boot command only when wsl.conf has none.
fn merge_wsl_conf(hosts: &str) -> String {
    format!(
        "if [ -f /etc/wsl.conf ] && grep -q '^\\[boot\\]' /etc/wsl.conf; then \
             if grep -qE '^[[:space:]]*command[[:space:]]*=' /etc/wsl.conf; then \
             echo 'wsl.conf already has a boot command - leaving it unchanged; dockerd must be started manually after Windows restarts'; \
         else sed -i '/^\\[boot\\]/a command = \"{cmd}\"' /etc/wsl.conf; fi; \
         else printf '[boot]\\ncommand = \"{cmd}\"\\n' >> /etc/wsl.conf; fi",
        cmd = boot_command(hosts)
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pkg {
    Apt,
    Apk,
}

/// Read the distro's `os-release` to choose the install method, and report
/// the resolved release (the picker's catalog names may omit versions, e.g.
/// plain `Debian`).
async fn detect_pkg(ctx: &InstallCtx, distro: &str) -> AppResult<(Pkg, String)> {
    let probe = ctx
        .output(
            "wsl.exe",
            &wsl_shell(
                distro,
                r#". /etc/os-release; echo "$ID $ID_LIKE|$NAME|$VERSION_ID|$VERSION_CODENAME""#,
            ),
        )
        .await
        .map_err(|_| AppError::Message(format!("Could not start the distribution '{distro}'")))?;
    classify_os_probe(&probe.stdout).ok_or_else(|| {
        AppError::Message(format!(
            "Distribution '{distro}' is not supported — pick an Ubuntu, Debian or Alpine distro, or create a new one"
        ))
    })
}

/// Classify from `ID`/`ID_LIKE` tokens and build a human label like
/// `Debian 13 (trixie)`; derivatives (mint, pop) match via their `ID_LIKE`.
fn classify_os_probe(stdout: &str) -> Option<(Pkg, String)> {
    let line = stdout.lines().map(str::trim).find(|l| l.contains('|'))?;
    let (ids, rest) = line.split_once('|')?;
    let pkg = pkg_from_os_release(ids)?;
    let mut fields = rest.split('|').map(str::trim);
    let name = fields.next().unwrap_or_default();
    let version = fields.next().unwrap_or_default();
    let codename = fields.next().unwrap_or_default();
    let fallback = ids.split_whitespace().next().unwrap_or_default();
    let mut pretty = if name.is_empty() {
        fallback.to_string()
    } else {
        name.to_string()
    };
    if !version.is_empty() {
        pretty.push(' ');
        pretty.push_str(version);
    }
    if !codename.is_empty() {
        pretty.push_str(&format!(" ({codename})"));
    }
    Some((pkg, pretty))
}

/// Classify from `ID`/`ID_LIKE` tokens.
fn pkg_from_os_release(text: &str) -> Option<Pkg> {
    let lower = text.to_ascii_lowercase();
    let tokens: Vec<&str> = lower.split_whitespace().collect();
    if tokens.contains(&"alpine") {
        return Some(Pkg::Apk);
    }
    if tokens
        .iter()
        .any(|token| *token == "ubuntu" || *token == "debian")
    {
        return Some(Pkg::Apt);
    }
    None
}

async fn has_dockerd(ctx: &InstallCtx, distro: &str) -> bool {
    ctx.output("wsl.exe", &wsl_shell(distro, "command -v dockerd"))
        .await
        .map(|probe| probe.success())
        .unwrap_or(false)
}

async fn has_systemd(ctx: &InstallCtx, distro: &str) -> bool {
    ctx.output("wsl.exe", &wsl_shell(distro, "[ -d /run/systemd/system ]"))
        .await
        .map(|probe| probe.success())
        .unwrap_or(false)
}

async fn distro_exists(ctx: &InstallCtx, name: &str) -> bool {
    distro_names(ctx)
        .await
        .iter()
        .any(|distro| distro.eq_ignore_ascii_case(name))
}

/// Discover the current Alpine minirootfs tarball from the release listing.
async fn alpine_rootfs_url(ctx: &InstallCtx) -> AppResult<String> {
    let listing = ctx.downloader.text(ALPINE_RELEASES).await?;
    let filename = extract_minirootfs(&listing).ok_or_else(|| {
        AppError::Message("Could not locate an Alpine minirootfs image".to_string())
    })?;
    Ok(format!("{ALPINE_RELEASES}{filename}"))
}

pub(super) fn extract_minirootfs(listing: &str) -> Option<String> {
    let start = listing.find("alpine-minirootfs-")?;
    let rest = &listing[start..];
    let end = rest.find(".tar.gz")? + ".tar.gz".len();
    let name = &rest[..end];
    if name.contains('"') || name.contains(char::is_whitespace) {
        return None;
    }
    Some(name.to_string())
}

/// dockerd takes a moment to bind; retry the connection briefly.
async fn connect_tcp(ctx: &InstallCtx) -> AppResult<crate::models::dto::DockerStatusDto> {
    let mut last = None;
    for _ in 0..12 {
        match ctx
            .connect(
                loopback_tcp_config(),
                Some("tcp://127.0.0.1:2375".to_string()),
            )
            .await
        {
            Ok(status) => return Ok(status),
            Err(err) => {
                last = Some(err);
                tokio::time::sleep(Duration::from_millis(700)).await;
            }
        }
    }
    Err(last.unwrap_or_else(|| AppError::Message("dockerd did not become reachable".to_string())))
}

/// Forwards download progress into the install event sink.
struct DownloadAdapter {
    sink: Arc<dyn IEventSink<InstallEventDto>>,
}

impl IEventSink<DownloadProgressDto> for DownloadAdapter {
    fn send(&self, progress: DownloadProgressDto) -> bool {
        self.sink.send(InstallEventDto::Download {
            bytes: progress.bytes,
            total_bytes: progress.total_bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_minirootfs_from_listing() {
        let html = r#"<a href="alpine-minirootfs-3.20.3-x86_64.tar.gz">alpine-minirootfs-3.20.3-x86_64.tar.gz</a>"#;
        assert_eq!(
            extract_minirootfs(html).as_deref(),
            Some("alpine-minirootfs-3.20.3-x86_64.tar.gz")
        );
    }

    #[test]
    fn missing_minirootfs_is_none() {
        assert!(extract_minirootfs("<html>nothing here</html>").is_none());
    }

    #[test]
    fn alpine_name_follows_ubuntu_convention() {
        assert_eq!(
            derive_alpine_name("alpine-minirootfs-3.22.1-x86_64.tar.gz").as_deref(),
            Some("Alpine-3.22")
        );
        assert_eq!(
            derive_alpine_name("alpine-minirootfs-3.23.0-x86_64.tar.gz").as_deref(),
            Some("Alpine-3.23")
        );
        assert_eq!(
            derive_alpine_name("ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz"),
            None
        );
        assert_eq!(derive_alpine_name("alpine-minirootfs-x86_64.tar.gz"), None);
    }

    #[test]
    fn alpine_version_key_orders_names() {
        assert!(alpine_version_key("Alpine-3.22") > alpine_version_key("Alpine-3.21"));
        assert!(alpine_version_key("Alpine-3.21") > alpine_version_key("Alpine-3.9"));
        assert!(alpine_version_key("Alpine-3.22") > alpine_version_key("Alpine"));
    }

    #[test]
    fn wsl_shell_targets_root() {
        let argv = wsl_shell("container-gui-engine", "echo hi");
        assert_eq!(argv[0], "-d");
        assert_eq!(argv[1], "container-gui-engine");
        assert_eq!(argv[2], "-u");
        assert_eq!(argv[3], "root");
        assert_eq!(argv.last().unwrap(), "echo hi");
    }

    #[test]
    fn classifies_distro_families() {
        assert_eq!(pkg_from_os_release("ubuntu debian"), Some(Pkg::Apt));
        assert_eq!(pkg_from_os_release("debian"), Some(Pkg::Apt));
        assert_eq!(pkg_from_os_release("alpine"), Some(Pkg::Apk));
        // Derivatives classify through ID_LIKE.
        assert_eq!(
            pkg_from_os_release("linuxmint ubuntu debian"),
            Some(Pkg::Apt)
        );
        assert_eq!(pkg_from_os_release("pop ubuntu debian"), Some(Pkg::Apt));
        assert_eq!(pkg_from_os_release("fedora"), None);
        assert_eq!(pkg_from_os_release(""), None);
    }

    #[test]
    fn builds_os_release_labels() {
        let (pkg, pretty) = classify_os_probe("ubuntu debian|Ubuntu|24.04|noble").expect("ubuntu");
        assert_eq!(pkg, Pkg::Apt);
        assert_eq!(pretty, "Ubuntu 24.04 (noble)");

        let (_, pretty) = classify_os_probe("debian|Debian|13|trixie").expect("debian");
        assert_eq!(pretty, "Debian 13 (trixie)");

        // Missing codename or version degrades gracefully.
        let (pkg, pretty) = classify_os_probe("alpine|Alpine Linux|3.22.1|").expect("alpine");
        assert_eq!(pkg, Pkg::Apk);
        assert_eq!(pretty, "Alpine Linux 3.22.1");

        assert!(classify_os_probe("fedora|Fedora Linux|41|").is_none());
        assert!(classify_os_probe("garbage").is_none());
    }

    #[test]
    fn merge_wsl_conf_keeps_existing_boot_command() {
        let script = merge_wsl_conf(DOCKERD_HOSTS);
        assert!(script.contains("leaving it unchanged"));
        assert!(script.contains("sed -i"));
        assert!(script.contains("nohup dockerd -H unix:///var/run/docker.sock"));
    }

    #[test]
    fn systemd_configures_drop_in() {
        let script = systemd_configure(DOCKERD_HOSTS);
        assert!(script.contains("/etc/systemd/system/docker.service.d/container-gui.conf"));
        assert!(script.contains("ExecStart="));
        assert!(script.contains("systemctl daemon-reload"));
    }
}
