//! SQLite cache of volume sizes, one row per volume per Docker endpoint.
//! Sizes come from the engine's disk-usage walk, which can take tens of
//! seconds, so the volume list reads this cache and a background refresh
//! overwrites it. Uses the app-wide pool from [`super::pool`].

use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;

use crate::error::AppResult;
use crate::repositories::{CachedSize, IVolumeSizeRepository};

/// Cheap to build: `pool` is a shared handle, so every repository holds the
/// same underlying connection.
#[derive(bon::Builder)]
pub struct SqliteVolumeSizeRepository {
    pool: SqlitePool,
}

#[async_trait]
impl IVolumeSizeRepository for SqliteVolumeSizeRepository {
    async fn load(&self, endpoint: &str) -> AppResult<HashMap<String, CachedSize>> {
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(
            "SELECT name, size_bytes, measured_at FROM volume_sizes WHERE endpoint = ?",
        )
        .bind(endpoint)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(name, size_bytes, measured_at)| {
                (
                    name,
                    CachedSize {
                        size_bytes,
                        measured_at,
                    },
                )
            })
            .collect())
    }

    async fn replace(
        &self,
        endpoint: &str,
        sizes: &[(String, i64)],
        measured_at: i64,
    ) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM volume_sizes WHERE endpoint = ?")
            .bind(endpoint)
            .execute(&mut *tx)
            .await?;
        for (name, size_bytes) in sizes {
            sqlx::query(
                "INSERT INTO volume_sizes (endpoint, name, size_bytes, measured_at) VALUES (?, ?, ?, ?)",
            )
            .bind(endpoint)
            .bind(name)
            .bind(size_bytes)
            .bind(measured_at)
            .execute(&mut *tx)
            .await?;
        }
        Ok(tx.commit().await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::sqlite::pool;

    #[tokio::test]
    async fn replace_overwrites_only_one_endpoint() {
        let cache = SqliteVolumeSizeRepository::builder()
            .pool(pool::memory().await)
            .build();
        cache
            .replace("one", &[("data".into(), 10), ("old".into(), 5)], 1_000)
            .await
            .unwrap();
        cache
            .replace("two", &[("data".into(), 99)], 1_000)
            .await
            .unwrap();
        cache
            .replace("one", &[("data".into(), 20)], 2_000)
            .await
            .unwrap();

        let one = cache.load("one").await.unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(
            one["data"],
            CachedSize {
                size_bytes: 20,
                measured_at: 2_000
            }
        );
        assert_eq!(cache.load("two").await.unwrap()["data"].size_bytes, 99);
        assert!(cache.load("three").await.unwrap().is_empty());
    }
}
