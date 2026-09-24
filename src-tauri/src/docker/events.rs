//! Background Docker event consumer. Streams `docker://event` payloads
//! to the frontend and auto-recovers from daemon restarts with
//! exponential backoff plus jitter.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bollard::query_parameters::EventsOptionsBuilder;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

use bollard::models::EventMessage;

use crate::docker::state::DockerSessionManager;
use crate::models::dto::DockerEventDto;

const MAX_BACKOFF: Duration = Duration::from_secs(30);

pub fn spawn(app: AppHandle, manager: Arc<DockerSessionManager>) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = Duration::from_secs(1);

        loop {
            let Some(client) = manager.client().await else {
                match manager.reconnect().await {
                    Ok(_) => backoff = Duration::from_secs(1),
                    Err(_) => {
                        sleep_backoff(backoff).await;
                        backoff = next_backoff(backoff);
                    }
                }
                continue;
            };

            let mut generation = manager.subscribe();
            let filters = HashMap::from([(
                "type".to_string(),
                vec![
                    "container".to_string(),
                    "image".to_string(),
                    "volume".to_string(),
                ],
            )]);
            let options = EventsOptionsBuilder::new().filters(&filters).build();
            let mut stream = client.events(Some(options)).boxed();
            let disconnected;

            loop {
                tokio::select! {
                    changed = generation.changed() => {
                        // Endpoint switched: drop this stream and resubscribe.
                        disconnected = changed.is_err();
                        break;
                    }
                    item = stream.next() => {
                        match item {
                            Some(Ok(message)) => {
                                backoff = Duration::from_secs(1);
                                let event = map_event(message);
                                // Exec sessions (the Files and Exec tabs run many)
                                // don't change container state; forwarding them
                                // would refetch every container query per command.
                                if !event.action.starts_with("exec_") {
                                    let _ = app.emit("docker://event", event);
                                }
                            }
                            Some(Err(_)) | None => {
                                disconnected = true;
                                break;
                            }
                        }
                    }
                }
            }

            if disconnected {
                manager
                    .mark_standby("Docker event stream disconnected. Retrying…")
                    .await;
                sleep_backoff(backoff).await;
                backoff = next_backoff(backoff);
                if manager.reconnect().await.is_ok() {
                    backoff = Duration::from_secs(1);
                }
            }
        }
    });
}

/// Map a raw engine event into the frontend DTO.
fn map_event(message: EventMessage) -> DockerEventDto {
    DockerEventDto {
        resource_type: message.typ.map(|kind| kind.to_string()).unwrap_or_default(),
        action: message.action.unwrap_or_default(),
        actor_id: message.actor.and_then(|actor| actor.id).unwrap_or_default(),
        time: message.time.unwrap_or_else(now_secs),
    }
}

fn next_backoff(current: Duration) -> Duration {
    (current * 2).min(MAX_BACKOFF)
}

/// Sleep `base` plus up to 500 ms of jitter without pulling in an RNG.
async fn sleep_backoff(base: Duration) {
    let jitter = Duration::from_millis(
        (SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.subsec_nanos() as u64)
            .unwrap_or(0))
            % 500,
    );
    tokio::time::sleep(base + jitter).await;
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::models::{EventActor, EventMessageTypeEnum};

    #[test]
    fn maps_engine_events_to_dto() {
        let message = EventMessage {
            typ: Some(EventMessageTypeEnum::CONTAINER),
            action: Some("start".to_string()),
            actor: Some(EventActor {
                id: Some("abc123".to_string()),
                attributes: None,
            }),
            time: Some(1_700_000_000),
            ..Default::default()
        };

        let event = map_event(message);
        assert_eq!(event.resource_type, "container");
        assert_eq!(event.action, "start");
        assert_eq!(event.actor_id, "abc123");
        assert_eq!(event.time, 1_700_000_000);
    }

    #[test]
    fn backoff_doubles_and_caps() {
        assert_eq!(next_backoff(Duration::from_secs(1)), Duration::from_secs(2));
        assert_eq!(
            next_backoff(Duration::from_secs(16)),
            Duration::from_secs(30)
        );
        assert_eq!(
            next_backoff(Duration::from_secs(30)),
            Duration::from_secs(30)
        );
    }
}
