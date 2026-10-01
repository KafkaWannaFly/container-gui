//! SQLite copy of the metrics history so charts survive an app restart.
//! The in-memory `MetricsStore` stays the read path; every tick's samples
//! are written through here and loaded back on startup or when switching
//! back to an endpoint. Rows are keyed by endpoint so histories of
//! different daemons never mix. The schema lives in `migrations/`.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use sqlx::{FromRow, QueryBuilder, Sqlite};

use crate::models::dto::MetricSampleDto;

/// Every column except `endpoint`, in the order `SampleRow` and `insert`
/// use them. A macro so `concat!` can build `&'static str` queries.
macro_rules! columns {
    () => {
        "container_id, ts, cpu_percent, online_cpus, memory_usage, memory_limit, \
         net_rx, net_tx, block_read, block_write, pids, \
         net_rx_rate, net_tx_rate, block_read_rate, block_write_rate"
    };
}

/// SQLite caps bound parameters per statement (32766); 16 per row keeps
/// each chunk well under it.
const ROWS_PER_INSERT: usize = 1_000;

/// SQLite stores integers as i64, so counters round-trip through this.
#[derive(FromRow)]
struct SampleRow {
    container_id: String,
    ts: i64,
    cpu_percent: Option<f64>,
    online_cpus: i64,
    memory_usage: i64,
    memory_limit: i64,
    net_rx: i64,
    net_tx: i64,
    block_read: i64,
    block_write: i64,
    pids: i64,
    net_rx_rate: Option<f64>,
    net_tx_rate: Option<f64>,
    block_read_rate: Option<f64>,
    block_write_rate: Option<f64>,
}

impl SampleRow {
    fn into_sample(self) -> (String, MetricSampleDto) {
        let sample = MetricSampleDto {
            ts: self.ts,
            cpu_percent: self.cpu_percent,
            online_cpus: self.online_cpus as u32,
            memory_usage: self.memory_usage,
            memory_limit: self.memory_limit,
            net_rx: self.net_rx as u64,
            net_tx: self.net_tx as u64,
            block_read: self.block_read as u64,
            block_write: self.block_write as u64,
            pids: self.pids as u64,
            net_rx_rate: self.net_rx_rate,
            net_tx_rate: self.net_tx_rate,
            block_read_rate: self.block_read_rate,
            block_write_rate: self.block_write_rate,
        };
        (self.container_id, sample)
    }
}

pub struct MetricsDb {
    pool: SqlitePool,
}

impl MetricsDb {
    /// Open (or create) the database at `path`. Falls back to an
    /// in-memory database so a locked or corrupt file never stops metrics.
    pub async fn open_or_memory(path: &Path) -> Self {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let file = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            // WAL keeps a second app instance (dev + release) from blocking us.
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(2));
        match Self::open(file).await {
            Ok(db) => db,
            Err(err) => {
                log::warn!(
                    "[metrics] can't open {}: {err}; history won't persist",
                    path.display()
                );
                Self::memory().await
            }
        }
    }

    pub async fn memory() -> Self {
        Self::open(SqliteConnectOptions::new().in_memory(true))
            .await
            .expect("in-memory SQLite")
    }

    /// Only the sampler uses the database, one query at a time, so a
    /// single connection is enough. It's kept open for the app's lifetime,
    /// which an in-memory database needs: closing it would drop the data.
    async fn open(options: SqliteConnectOptions) -> Result<Self, sqlx::Error> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .min_connections(1)
            .idle_timeout(None)
            .max_lifetime(None)
            .connect_with(options)
            .await?;
        sqlx::migrate!().run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn insert(
        &self,
        endpoint: &str,
        samples: &[(String, MetricSampleDto)],
    ) -> Result<(), sqlx::Error> {
        if samples.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await?;
        for chunk in samples.chunks(ROWS_PER_INSERT) {
            let mut query = QueryBuilder::<Sqlite>::new(concat!(
                "INSERT OR REPLACE INTO samples (endpoint, ",
                columns!(),
                ") "
            ));
            query.push_values(chunk, |mut row, (id, s)| {
                row.push_bind(endpoint.to_owned())
                    .push_bind(id.clone())
                    .push_bind(s.ts)
                    .push_bind(s.cpu_percent)
                    .push_bind(i64::from(s.online_cpus))
                    .push_bind(s.memory_usage)
                    .push_bind(s.memory_limit)
                    .push_bind(s.net_rx as i64)
                    .push_bind(s.net_tx as i64)
                    .push_bind(s.block_read as i64)
                    .push_bind(s.block_write as i64)
                    .push_bind(s.pids as i64)
                    .push_bind(s.net_rx_rate)
                    .push_bind(s.net_tx_rate)
                    .push_bind(s.block_read_rate)
                    .push_bind(s.block_write_rate);
            });
            query.build().execute(&mut *tx).await?;
        }
        tx.commit().await
    }

    /// Samples for `endpoint` at or after `since`, oldest first, per container.
    pub async fn load(
        &self,
        endpoint: &str,
        since: i64,
    ) -> Result<HashMap<String, Vec<MetricSampleDto>>, sqlx::Error> {
        let rows: Vec<SampleRow> = sqlx::query_as(concat!(
            "SELECT ",
            columns!(),
            " FROM samples WHERE endpoint = ? AND ts >= ? ORDER BY container_id, ts"
        ))
        .bind(endpoint)
        .bind(since)
        .fetch_all(&self.pool)
        .await?;

        let mut out: HashMap<String, Vec<MetricSampleDto>> = HashMap::new();
        for row in rows {
            let (id, sample) = row.into_sample();
            out.entry(id).or_default().push(sample);
        }
        Ok(out)
    }

    /// Delete every row older than `cutoff`, across all endpoints.
    pub async fn prune(&self, cutoff: i64) -> Result<u64, sqlx::Error> {
        let done = sqlx::query("DELETE FROM samples WHERE ts < ?")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected())
    }

    #[cfg(test)]
    async fn close(self) {
        self.pool.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(ts: i64) -> MetricSampleDto {
        MetricSampleDto {
            ts,
            cpu_percent: Some(1.5),
            online_cpus: 4,
            memory_usage: 1_000,
            memory_limit: 2_000,
            net_rx: 10,
            net_tx: 20,
            block_read: 30,
            block_write: 40,
            pids: 3,
            net_rx_rate: None,
            net_tx_rate: Some(2.0),
            block_read_rate: None,
            block_write_rate: Some(0.0),
        }
    }

    #[tokio::test]
    async fn round_trips_per_endpoint_and_prunes() {
        let db = MetricsDb::memory().await;
        db.insert(
            "one",
            &[("a".into(), sample(1_000)), ("a".into(), sample(3_000))],
        )
        .await
        .unwrap();
        db.insert("two", &[("b".into(), sample(2_000))])
            .await
            .unwrap();

        let one = db.load("one", 0).await.unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one["a"], vec![sample(1_000), sample(3_000)]);
        assert_eq!(
            db.load("one", 2_000).await.unwrap()["a"],
            vec![sample(3_000)]
        );

        assert_eq!(db.prune(2_500).await.unwrap(), 2);
        assert!(db.load("two", 0).await.unwrap().is_empty());
        assert_eq!(db.load("one", 0).await.unwrap()["a"].len(), 1);
    }

    #[tokio::test]
    async fn rewriting_a_tick_is_idempotent() {
        let db = MetricsDb::memory().await;
        db.insert("one", &[("a".into(), sample(1_000))])
            .await
            .unwrap();
        db.insert("one", &[("a".into(), sample(1_000))])
            .await
            .unwrap();
        assert_eq!(db.load("one", 0).await.unwrap()["a"].len(), 1);
    }

    #[tokio::test]
    async fn inserts_more_rows_than_one_statement_allows() {
        let db = MetricsDb::memory().await;
        let many: Vec<_> = (0..2_500)
            .map(|i| (format!("c{i}"), sample(1_000)))
            .collect();
        db.insert("one", &many).await.unwrap();
        assert_eq!(db.load("one", 0).await.unwrap().len(), 2_500);
    }

    #[tokio::test]
    async fn file_database_survives_reopen() {
        let dir = std::env::temp_dir().join(format!("cgui-metrics-{}", std::process::id()));
        let path = dir.join("app.db");
        let db = MetricsDb::open_or_memory(&path).await;
        db.insert("one", &[("a".into(), sample(1_000))])
            .await
            .unwrap();
        db.close().await;

        let db = MetricsDb::open_or_memory(&path).await;
        assert_eq!(db.load("one", 0).await.unwrap()["a"], vec![sample(1_000)]);
        db.close().await;
        let _ = std::fs::remove_dir_all(dir);
    }
}
