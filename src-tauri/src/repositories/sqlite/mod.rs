//! SQLite repositories. They share the single pool from [`pool`].

pub mod engine_preference;
pub mod metrics_history;
pub mod pool;
pub mod volume_sizes;

pub use engine_preference::SqliteEnginePreferenceRepository;
pub use metrics_history::SqliteMetricsHistoryRepository;
pub use volume_sizes::SqliteVolumeSizeRepository;

use crate::error::AppError;

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        AppError::Message(value.to_string())
    }
}
