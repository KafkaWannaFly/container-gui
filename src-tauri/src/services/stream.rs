//! Cancelling in-flight log and exec streams.

use std::sync::Arc;

use crate::repositories::IStreamRegistry;

pub trait IStreamService: Send + Sync {
    /// Cancel any log or exec stream by the id its caller registered.
    fn cancel(&self, stream_id: &str);
}

#[derive(bon::Builder)]
pub struct StreamService {
    streams: Arc<dyn IStreamRegistry>,
}

impl IStreamService for StreamService {
    fn cancel(&self, stream_id: &str) {
        self.streams.cancel(stream_id);
    }
}
