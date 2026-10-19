//! Cancellation handles for in-flight streams, so unmounting a view can
//! cancel the backend task. Log/stats/exec streams are keyed by a
//! caller-chosen stream id, so two views on the same container never cancel
//! each other; pulls are keyed by image name because one image only pulls
//! once at a time.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::oneshot;

use crate::repositories::{IStreamRegistry, StreamTicket};

#[derive(Default, bon::Builder)]
pub struct InMemoryStreamRegistry {
    #[builder(skip)]
    streams: Mutex<HashMap<String, (u64, oneshot::Sender<()>)>>,
    #[builder(skip)]
    next_token: AtomicU64,
    #[builder(skip)]
    pulls: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl IStreamRegistry for InMemoryStreamRegistry {
    fn register(&self, stream_id: String) -> StreamTicket {
        let (cancel_tx, cancelled) = oneshot::channel();
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        if let Some((_, old)) = self
            .streams
            .lock()
            .unwrap()
            .insert(stream_id, (token, cancel_tx))
        {
            let _ = old.send(());
        }
        StreamTicket { token, cancelled }
    }

    fn cancel(&self, stream_id: &str) {
        if let Some((_, cancel)) = self.streams.lock().unwrap().remove(stream_id) {
            let _ = cancel.send(());
        }
    }

    fn finish(&self, stream_id: &str, token: u64) {
        let mut streams = self.streams.lock().unwrap();
        if streams
            .get(stream_id)
            .is_some_and(|(owner, _)| *owner == token)
        {
            streams.remove(stream_id);
        }
    }

    fn register_pull(&self, image: String) -> oneshot::Receiver<()> {
        let (cancel_tx, cancelled) = oneshot::channel();
        self.pulls.lock().unwrap().insert(image, cancel_tx);
        cancelled
    }

    fn cancel_pull(&self, image: &str) {
        if let Some(cancel) = self.pulls.lock().unwrap().remove(image) {
            let _ = cancel.send(());
        }
    }

    fn finish_pull(&self, image: &str) {
        self.pulls.lock().unwrap().remove(image);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reregistering_cancels_the_previous_task_and_keeps_the_new_one() {
        let registry = InMemoryStreamRegistry::default();
        let mut first = registry.register("logs".into());
        let mut second = registry.register("logs".into());
        assert!(first.cancelled.try_recv().is_ok());

        // The first task finishing late must not drop the second's entry.
        registry.finish("logs", first.token);
        registry.cancel("logs");
        assert!(second.cancelled.try_recv().is_ok());
    }
}
