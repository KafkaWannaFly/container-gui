//! The endpoint the onboarding wizard installed, persisted as one row in the
//! app-wide SQLite database. Read by the connector when resolving the default
//! target, so it must never fail loudly: errors are logged and swallowed, and
//! callers fall through to the platform default. Uses the app-wide pool from
//! [`super::pool`].

use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;

use crate::repositories::IEnginePreferenceRepository;

/// Cheap to build: `pool` is a shared handle, so every repository holds the
/// same underlying connection.
#[derive(bon::Builder)]
pub struct SqliteEnginePreferenceRepository {
    pool: SqlitePool,
}

#[async_trait]
impl IEnginePreferenceRepository for SqliteEnginePreferenceRepository {
    async fn endpoint(&self) -> Option<String> {
        let result =
            sqlx::query_scalar::<_, String>("SELECT endpoint FROM engine_preference WHERE id = 1")
                .fetch_optional(&self.pool)
                .await;
        match result {
            Ok(endpoint) => endpoint.filter(|value| !value.is_empty()),
            Err(err) => {
                log::warn!("[engine-preference] could not read endpoint: {err}");
                None
            }
        }
    }

    async fn set_endpoint(&self, endpoint: Option<String>) {
        let result = match endpoint {
            Some(endpoint) => {
                sqlx::query("INSERT OR REPLACE INTO engine_preference (id, endpoint) VALUES (1, ?)")
                    .bind(endpoint)
                    .execute(&self.pool)
                    .await
            }
            None => {
                sqlx::query("DELETE FROM engine_preference WHERE id = 1")
                    .execute(&self.pool)
                    .await
            }
        };
        if let Err(err) = result {
            log::warn!("[engine-preference] could not persist endpoint: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::sqlite::pool;

    #[tokio::test]
    async fn round_trips_and_clears_endpoint() {
        let repo = SqliteEnginePreferenceRepository::builder()
            .pool(pool::memory().await)
            .build();
        assert_eq!(repo.endpoint().await, None);
        repo.set_endpoint(Some("tcp://127.0.0.1:2375".into())).await;
        assert_eq!(
            repo.endpoint().await.as_deref(),
            Some("tcp://127.0.0.1:2375")
        );
        repo.set_endpoint(None).await;
        assert_eq!(repo.endpoint().await, None);
    }
}
