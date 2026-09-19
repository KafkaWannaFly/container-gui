//! Container listing, inspection, lifecycle actions and log streams.

use bollard::Docker;
use bollard::container::LogOutput;
use bollard::query_parameters::{
    KillContainerOptionsBuilder, ListContainersOptionsBuilder, LogsOptionsBuilder,
    RemoveContainerOptionsBuilder, RestartContainerOptionsBuilder, StopContainerOptionsBuilder,
};
use futures_util::StreamExt;
use serde_json::Value;
use tauri::ipc::Channel;
use tokio::sync::oneshot;

use crate::docker::state::StreamRegistry;
use crate::error::{AppError, AppResult};
use crate::models::dto::{ContainerSummaryDto, LogChunkDto, PortMappingDto};

/// Server-side filter for the container list. Built with `bon` so the
/// command layer can grow optional filters without positional churn.
#[derive(Debug, Clone, bon::Builder)]
pub struct ContainerListFilter {
    pub all: bool,
    pub status: Option<String>,
}

pub async fn list_containers(
    client: &Docker,
    filter: &ContainerListFilter,
) -> AppResult<Vec<ContainerSummaryDto>> {
    let mut options = ListContainersOptionsBuilder::new().all(filter.all);

    if let Some(status) = filter.status.as_deref() {
        let filters = std::collections::HashMap::from([(
            "status".to_string(),
            vec![status.to_string()],
        )]);
        options = options.filters(&filters);
    }

    let containers = client.list_containers(Some(options.build())).await?;
    Ok(containers
        .into_iter()
        .map(|container| ContainerSummaryDto {
            id: container.id.unwrap_or_default(),
            names: container
                .names
                .unwrap_or_default()
                .into_iter()
                .map(|name| name.trim_start_matches('/').to_string())
                .collect(),
            image: container.image.unwrap_or_default(),
            state: container
                .state
                .map(|state| state.to_string())
                .unwrap_or_default(),
            status: container.status.unwrap_or_default(),
            created: container.created.unwrap_or_default(),
            ports: container
                .ports
                .unwrap_or_default()
                .into_iter()
                .map(|port| PortMappingDto {
                    private_port: port.private_port,
                    public_port: port.public_port,
                    ip: port.ip,
                    typ: port.typ.map(|kind| kind.to_string()).unwrap_or_default(),
                })
                .collect(),
        })
        .collect())
}

/// Raw inspect payload, passed through as JSON so the UI can read any
/// engine-version-specific field.
pub async fn inspect_container(client: &Docker, id: &str) -> AppResult<Value> {
    let response = client.inspect_container(id, None).await?;
    Ok(serde_json::to_value(response)?)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Kill,
    Remove,
}

impl ContainerAction {
    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "start" => Ok(ContainerAction::Start),
            "stop" => Ok(ContainerAction::Stop),
            "restart" => Ok(ContainerAction::Restart),
            "kill" => Ok(ContainerAction::Kill),
            "remove" => Ok(ContainerAction::Remove),
            other => Err(AppError::Message(format!("Unknown container action: {other}"))),
        }
    }
}

pub async fn execute_action(client: &Docker, id: &str, action: ContainerAction) -> AppResult<()> {
    match action {
        ContainerAction::Start => client.start_container(id, None).await?,
        ContainerAction::Stop => {
            client
                .stop_container(id, Some(StopContainerOptionsBuilder::new().t(10).build()))
                .await?
        }
        ContainerAction::Restart => {
            client
                .restart_container(id, Some(RestartContainerOptionsBuilder::new().t(10).build()))
                .await?
        }
        ContainerAction::Kill => {
            client
                .kill_container(id, Some(KillContainerOptionsBuilder::new().signal("SIGKILL").build()))
                .await?
        }
        ContainerAction::Remove => {
            client
                .remove_container(id, Some(RemoveContainerOptionsBuilder::new().force(true).build()))
                .await?
        }
    }
    Ok(())
}

/// Spawn a follow-logs task that pushes chunks into `channel` until the
/// container stops, the stream errors, or the registry cancels it.
pub fn spawn_log_stream(
    client: Docker,
    registry: std::sync::Arc<StreamRegistry>,
    id: String,
    tail: u64,
    channel: Channel<LogChunkDto>,
) {
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    registry.register_logs(id.clone(), cancel_tx);

    tauri::async_runtime::spawn(async move {
        let options = LogsOptionsBuilder::new()
            .follow(true)
            .stdout(true)
            .stderr(true)
            .tail(&tail.to_string())
            .build();
        let mut stream = client.logs(&id, Some(options)).boxed();

        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                item = stream.next() => {
                    match item {
                        Some(Ok(output)) => {
                            let chunk = match output {
                                LogOutput::StdOut { message } => Some(("stdout", message)),
                                LogOutput::StdErr { message } => Some(("stderr", message)),
                                LogOutput::Console { message } => Some(("stdout", message)),
                                LogOutput::StdIn { .. } => None,
                            };
                            if let Some((stream, message)) = chunk {
                                let text = String::from_utf8_lossy(&message).to_string();
                                if channel
                                    .send(LogChunkDto { stream: stream.to_string(), message: text })
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                        Some(Err(_)) | None => break,
                    }
                }
            }
        }

        registry.finish_logs(&id);
    });
}
