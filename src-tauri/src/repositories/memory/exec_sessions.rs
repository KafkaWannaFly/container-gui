//! Input side of live exec sessions, keyed by the caller's stream id.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::mpsc;

use crate::repositories::IExecSessionRepository;

struct ExecHandle {
    exec_id: String,
    input: mpsc::UnboundedSender<Vec<u8>>,
}

#[derive(Default, bon::Builder)]
pub struct InMemoryExecSessionRepository {
    #[builder(skip)]
    sessions: Mutex<HashMap<String, ExecHandle>>,
}

impl IExecSessionRepository for InMemoryExecSessionRepository {
    fn insert(&self, stream_id: String, exec_id: String, input: mpsc::UnboundedSender<Vec<u8>>) {
        self.sessions
            .lock()
            .unwrap()
            .insert(stream_id, ExecHandle { exec_id, input });
    }

    fn remove(&self, stream_id: &str, exec_id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        if sessions
            .get(stream_id)
            .is_some_and(|h| h.exec_id == exec_id)
        {
            sessions.remove(stream_id);
        }
    }

    fn input(&self, stream_id: &str) -> Option<mpsc::UnboundedSender<Vec<u8>>> {
        self.sessions
            .lock()
            .unwrap()
            .get(stream_id)
            .map(|h| h.input.clone())
    }

    fn exec_id(&self, stream_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .unwrap()
            .get(stream_id)
            .map(|h| h.exec_id.clone())
    }
}
