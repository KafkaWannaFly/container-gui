//! SQLite cache of volume sizes, one row per volume per Docker endpoint.
//! Sizes come from Docker's disk-usage walk, which can take tens of seconds,
//! so the volume list reads this cache and a background refresh overwrites
//! it. Uses the app-wide pool from `crate::db`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use sqlx::sqlite::SqlitePool;

pub struct VolumeSizeCache {
    pool: SqlitePool,
    refreshing: AtomicBool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CachedSize {
    pub size_bytes: i64,
    pub measured_at: i64,
}

/// Held while a refresh runs; releases the flag on drop, even on error.
pub struct RefreshGuard<'a>(&'a AtomicBool);

impl Drop for RefreshGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl VolumeSizeCache {
    /// Cheap to build: `pool` is a shared handle, so every repository holds
    /// the same underlying connection.
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool,
            refreshing: AtomicBool::new(false),
        }
    }

    /// Cached sizes for `endpoint`, keyed by volume name.
    pub async fn load(&self, endpoint: &str) -> Result<HashMap<String, CachedSize>, sqlx::Error> {
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

    /// Replace every size stored for `endpoint`, so volumes removed from the
    /// daemon drop out of the cache too.
    pub async fn replace(
        &self,
        endpoint: &str,
        sizes: &[(String, i64)],
        measured_at: i64,
    ) -> Result<(), sqlx::Error> {
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
        tx.commit().await
    }

    /// `None` when a refresh is already running, so overlapping callers skip
    /// instead of stacking slow disk-usage walks.
    pub fn try_begin_refresh(&self) -> Option<RefreshGuard<'_>> {
        self.refreshing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| RefreshGuard(&self.refreshing))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[tokio::test]
    async fn replace_overwrites_only_one_endpoint() {
        let cache = VolumeSizeCache::new(db::memory().await);
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

    #[tokio::test]
    async fn refresh_guard_rejects_overlap_and_releases_on_drop() {
        let cache = VolumeSizeCache::new(db::memory().await);
        let guard = cache.try_begin_refresh().expect("first refresh starts");
        assert!(cache.try_begin_refresh().is_none());
        drop(guard);
        assert!(cache.try_begin_refresh().is_some());
    }
}
