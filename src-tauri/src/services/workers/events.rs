//! Engine event consumer. Streams `docker://event` payloads to the frontend
//! and auto-recovers from daemon restarts with exponential backoff plus
//! jitter.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;

use crate::services::infrastructure::IEventPublisher;
use crate::services::session::IEngineSession;

const MAX_BACKOFF: Duration = Duration::from_secs(30);

pub fn spawn(session: Arc<dyn IEngineSession>, publisher: Arc<dyn IEventPublisher>) {
    tokio::spawn(async move {
        let mut backoff = Duration::from_secs(1);

        loop {
            let Some(engine) = session.current().await else {
                match session.reconnect().await {
                    Ok(_) => backoff = Duration::from_secs(1),
                    Err(_) => {
                        sleep_backoff(backoff).await;
                        backoff = next_backoff(backoff);
                    }
                }
                continue;
            };

            let mut generation = session.subscribe();
            let mut stream = engine.events().subscribe();
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
                            Some(Ok(event)) => {
                                backoff = Duration::from_secs(1);
                                // Exec sessions (the Files and Exec tabs run many)
                                // don't change container state; forwarding them
                                // would refetch every container query per command.
                                if !event.action.starts_with("exec_") {
                                    publisher.engine_event(&event);
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
                session
                    .mark_standby("Docker event stream disconnected. Retrying…".to_string())
                    .await;
                sleep_backoff(backoff).await;
                backoff = next_backoff(backoff);
                if session.reconnect().await.is_ok() {
                    backoff = Duration::from_secs(1);
                }
            }
        }
    });
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

#[cfg(test)]
mod tests {
    use super::*;

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
