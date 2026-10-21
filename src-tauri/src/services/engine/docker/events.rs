use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use bollard::models::EventMessage;
use bollard::query_parameters::EventsOptionsBuilder;
use futures_util::StreamExt;
use futures_util::stream::BoxStream;

use super::DockerEngine;
use crate::error::AppResult;
use crate::models::dto::DockerEventDto;
use crate::services::engine::IEventSource;

impl IEventSource for DockerEngine {
    fn subscribe(&self) -> BoxStream<'static, AppResult<DockerEventDto>> {
        let filters = HashMap::from([(
            "type".to_string(),
            vec![
                "container".to_string(),
                "image".to_string(),
                "volume".to_string(),
            ],
        )]);
        let options = EventsOptionsBuilder::new().filters(&filters).build();
        self.client
            .events(Some(options))
            .map(|item| Ok(map_event(item?)))
            .boxed()
    }
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

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use bollard::models::{EventActor, EventMessageTypeEnum};

    use super::*;

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
}
