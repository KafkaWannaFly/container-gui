//! App-wide events pushed to the frontend.

use tauri::{AppHandle, Emitter};

use crate::models::dto::{DockerEventDto, DockerStatusDto};

pub trait IEventPublisher: Send + Sync {
    /// `docker://status`: the connection state changed.
    fn status(&self, status: &DockerStatusDto);
    /// `docker://event`: an engine resource changed.
    fn engine_event(&self, event: &DockerEventDto);
}

#[derive(bon::Builder)]
pub struct TauriEventPublisher {
    app: AppHandle,
}

impl IEventPublisher for TauriEventPublisher {
    fn status(&self, status: &DockerStatusDto) {
        let _ = self.app.emit("docker://status", status);
    }

    fn engine_event(&self, event: &DockerEventDto) {
        let _ = self.app.emit("docker://event", event);
    }
}
