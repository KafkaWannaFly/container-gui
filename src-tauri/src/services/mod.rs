//! Business layer. Every service is a trait (`I…`) plus one implementation,
//! built once in `app::bootstrap` and injected through `bon` builders.
//! Services may depend on other services, including the engine gateway
//! (`engine`) and infrastructure services, but only through their traits.

pub mod compose;
pub mod connection;
pub mod container;
pub mod engine;
pub mod exec;
pub mod files;
pub mod image;
pub mod infrastructure;
pub mod metrics;
pub mod session;
pub mod stream;
pub mod system;
pub mod volume;
pub mod workers;

#[cfg(test)]
pub mod testing;

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
