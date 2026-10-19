//! Per-call output streams (logs, exec, pulls). Commands pass their Tauri
//! `Channel` in as an `Arc<dyn IEventSink<T>>`.

use tauri::ipc::{Channel, IpcResponse};

pub trait IEventSink<T>: Send + Sync {
    /// Deliver one event; `false` once the receiver is gone.
    fn send(&self, event: T) -> bool;
}

impl<T: IpcResponse + Send + Sync + 'static> IEventSink<T> for Channel<T> {
    fn send(&self, event: T) -> bool {
        Channel::send(self, event).is_ok()
    }
}
