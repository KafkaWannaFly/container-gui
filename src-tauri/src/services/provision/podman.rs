//! Podman machine install: winget the CLI, `machine init` a dedicated WSL
//! machine, start it (its Docker-API forwarding listens on the default named
//! pipe), then connect the session. Idempotent: an existing CLI/machine is
//! reused rather than recreated.

use super::provision_service::{InstallCtx, args, npipe_config};
use crate::error::{AppError, AppResult};
use crate::models::dto::{InstallRequest, PodmanMachineDto};
use crate::services::environment::parse_machines;

const TOTAL: u32 = 4;

pub(super) async fn install(ctx: &InstallCtx, req: &InstallRequest) -> AppResult<String> {
    // Phase 0 — CLI.
    ctx.phase(0, TOTAL, "Install Podman CLI");
    let podman = match find_podman(ctx).await {
        Some(program) => {
            ctx.line("stdout", "Podman CLI already installed — skipping winget");
            program
        }
        None => {
            let code = ctx
                .run_stream(
                    "winget",
                    &args(&[
                        "install",
                        "--id",
                        "RedHat.Podman",
                        "--silent",
                        "--accept-source-agreements",
                        "--accept-package-agreements",
                    ]),
                )
                .await?;
            if code != 0 {
                return Err(AppError::Message(format!(
                    "winget install exited with {code}"
                )));
            }
            find_podman(ctx).await.ok_or_else(|| {
                AppError::Message("Podman CLI was not found after install".to_string())
            })?
        }
    };

    // Phase 1 — machine init.
    ctx.phase(1, TOTAL, "Create machine (WSL)");
    let machines = podman_machines(ctx, &podman).await;
    if machines.iter().any(|machine| machine.name == req.unit_name) {
        ctx.line(
            "stdout",
            format!("Machine '{}' already exists — skipping init", req.unit_name),
        );
    } else {
        let code = ctx.run_stream(&podman, &init_args(req)).await?;
        if code != 0 {
            return Err(AppError::Message(format!(
                "podman machine init exited with {code}"
            )));
        }
    }

    // Phase 2 — start (brings up the Docker-API named pipe).
    ctx.phase(2, TOTAL, "Start machine");
    let code = ctx
        .run_stream(&podman, &args(&["machine", "start", &req.unit_name]))
        .await?;
    if code != 0 {
        return Err(AppError::Message(format!(
            "podman machine start exited with {code}"
        )));
    }

    // Phase 3 — verify by connecting the session to the default pipe.
    ctx.phase(3, TOTAL, "Verify Docker API");
    let status = ctx.connect(npipe_config(), None).await?;
    ctx.line(
        "stdout",
        format!(
            "Engine: {} · API {} · rootless",
            status.engine_version.unwrap_or_default(),
            status.api_version.unwrap_or_default(),
        ),
    );
    // Best-effort smoke container; a pull hiccup must not fail the install.
    let _ = ctx
        .run_stream(&podman, &args(&["run", "--rm", "quay.io/podman/hello"]))
        .await;
    Ok(req.unit_name.clone())
}

fn init_args(req: &InstallRequest) -> Vec<String> {
    let mut argv = args(&["machine", "init"]);
    argv.push(
        if req.rootless {
            "--rootless"
        } else {
            "--rootful"
        }
        .to_string(),
    );
    argv.push("--cpus".to_string());
    argv.push(req.cpus.to_string());
    argv.push("--memory".to_string());
    argv.push(req.memory_mib.to_string());
    argv.push("--disk-size".to_string());
    argv.push(req.disk_gib.to_string());
    argv.push(req.unit_name.clone());
    argv
}

async fn podman_machines(ctx: &InstallCtx, podman: &str) -> Vec<PodmanMachineDto> {
    ctx.output(podman, &args(&["machine", "list", "--format", "json"]))
        .await
        .ok()
        .filter(|probe| probe.success())
        .map(|probe| parse_machines(&probe.stdout))
        .unwrap_or_default()
}

/// Resolve a usable `podman` program: PATH first, then the installer's known
/// locations (winget does not refresh the current process's PATH).
async fn find_podman(ctx: &InstallCtx) -> Option<String> {
    if ctx
        .output("podman", &args(&["--version"]))
        .await
        .map(|probe| probe.success())
        .unwrap_or(false)
    {
        return Some("podman".to_string());
    }
    #[cfg(windows)]
    {
        for var in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
            let Some(base) = std::env::var_os(var) else {
                continue;
            };
            let candidate = std::path::Path::new(&base)
                .join("RedHat")
                .join("Podman")
                .join("podman.exe");
            let program = candidate.to_string_lossy().into_owned();
            if ctx
                .output(&program, &args(&["--version"]))
                .await
                .map(|probe| probe.success())
                .unwrap_or(false)
            {
                return Some(program);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_args_rootless_and_resources() {
        let req = InstallRequest {
            engine: crate::models::dto::InstallEngine::Podman,
            unit_name: "podman-machine-default".into(),
            target: None,
            rootless: true,
            cpus: 2,
            memory_mib: 2048,
            disk_gib: 100,
        };
        let argv = init_args(&req);
        assert_eq!(argv[0], "machine");
        assert_eq!(argv[1], "init");
        assert!(argv.contains(&"--rootless".to_string()));
        assert!(argv.contains(&"2048".to_string()));
        assert_eq!(argv.last().unwrap(), "podman-machine-default");
    }

    #[test]
    fn init_args_rootful() {
        let req = InstallRequest {
            engine: crate::models::dto::InstallEngine::Podman,
            unit_name: "m".into(),
            target: None,
            rootless: false,
            cpus: 4,
            memory_mib: 4096,
            disk_gib: 50,
        };
        let argv = init_args(&req);
        assert!(argv.contains(&"--rootful".to_string()));
        assert!(!argv.contains(&"--rootless".to_string()));
    }
}
