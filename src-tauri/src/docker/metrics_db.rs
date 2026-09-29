//! SQLite copy of the metrics history so charts survive an app restart.
//! The in-memory `MetricsStore` stays the read path; every tick's samples
//! are written through here and loaded back on startup or when switching
//! back to an endpoint. Rows are keyed by endpoint so histories of
//! different daemons never mix.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, params};

use crate::models::dto::MetricSampleDto;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS samples (
    endpoint         TEXT    NOT NULL,
    container_id     TEXT    NOT NULL,
    ts               INTEGER NOT NULL,
    cpu_percent      REAL,
    online_cpus      INTEGER NOT NULL,
    memory_usage     INTEGER NOT NULL,
    memory_limit     INTEGER NOT NULL,
    net_rx           INTEGER NOT NULL,
    net_tx           INTEGER NOT NULL,
    block_read       INTEGER NOT NULL,
    block_write      INTEGER NOT NULL,
    pids             INTEGER NOT NULL,
    net_rx_rate      REAL,
    net_tx_rate      REAL,
    block_read_rate  REAL,
    block_write_rate REAL,
    PRIMARY KEY (endpoint, container_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS samples_ts ON samples (ts);
";

pub struct MetricsDb {
    conn: Mutex<Connection>,
}

impl MetricsDb {
    /// Open (or create) the database at `path`. Falls back to an
    /// in-memory database so a locked or corrupt file never stops metrics.
    pub fn open_or_memory(path: &Path) -> Self {
        let conn = Self::open_file(path).unwrap_or_else(|err| {
            log::warn!(
                "[metrics] can't open {}: {err}; history won't persist",
                path.display()
            );
            Self::open_memory().expect("in-memory SQLite")
        });
        Self {
            conn: Mutex::new(conn),
        }
    }

    fn open_file(path: &Path) -> rusqlite::Result<Connection> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        // WAL keeps a second app instance (dev + release) from blocking us.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        conn.execute_batch(SCHEMA)?;
        Ok(conn)
    }

    fn open_memory() -> rusqlite::Result<Connection> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(conn)
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self {
            conn: Mutex::new(Self::open_memory().unwrap()),
        }
    }

    pub fn insert(
        &self,
        endpoint: &str,
        samples: &[(String, MetricSampleDto)],
    ) -> rusqlite::Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO samples VALUES
                 (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            )?;
            for (id, s) in samples {
                stmt.execute(params![
                    endpoint,
                    id,
                    s.ts,
                    s.cpu_percent,
                    s.online_cpus,
                    s.memory_usage,
                    s.memory_limit,
                    s.net_rx as i64,
                    s.net_tx as i64,
                    s.block_read as i64,
                    s.block_write as i64,
                    s.pids as i64,
                    s.net_rx_rate,
                    s.net_tx_rate,
                    s.block_read_rate,
                    s.block_write_rate,
                ])?;
            }
        }
        tx.commit()
    }

    /// Samples for `endpoint` at or after `since`, oldest first, per container.
    pub fn load(
        &self,
        endpoint: &str,
        since: i64,
    ) -> rusqlite::Result<HashMap<String, Vec<MetricSampleDto>>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare_cached(
            "SELECT container_id, ts, cpu_percent, online_cpus, memory_usage, memory_limit,
                    net_rx, net_tx, block_read, block_write, pids,
                    net_rx_rate, net_tx_rate, block_read_rate, block_write_rate
             FROM samples WHERE endpoint = ?1 AND ts >= ?2
             ORDER BY container_id, ts",
        )?;
        let rows = stmt.query_map(params![endpoint, since], |row| {
            Ok((
                row.get::<_, String>(0)?,
                MetricSampleDto {
                    ts: row.get(1)?,
                    cpu_percent: row.get(2)?,
                    online_cpus: row.get(3)?,
                    memory_usage: row.get(4)?,
                    memory_limit: row.get(5)?,
                    net_rx: row.get::<_, i64>(6)? as u64,
                    net_tx: row.get::<_, i64>(7)? as u64,
                    block_read: row.get::<_, i64>(8)? as u64,
                    block_write: row.get::<_, i64>(9)? as u64,
                    pids: row.get::<_, i64>(10)? as u64,
                    net_rx_rate: row.get(11)?,
                    net_tx_rate: row.get(12)?,
                    block_read_rate: row.get(13)?,
                    block_write_rate: row.get(14)?,
                },
            ))
        })?;
        let mut out: HashMap<String, Vec<MetricSampleDto>> = HashMap::new();
        for row in rows {
            let (id, sample) = row?;
            out.entry(id).or_default().push(sample);
        }
        Ok(out)
    }

    /// Delete every row older than `cutoff`, across all endpoints.
    pub fn prune(&self, cutoff: i64) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM samples WHERE ts < ?1", params![cutoff])
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

    #[test]
    fn round_trips_per_endpoint_and_prunes() {
        let db = MetricsDb::memory();
        db.insert(
            "one",
            &[("a".into(), sample(1_000)), ("a".into(), sample(3_000))],
        )
        .unwrap();
        db.insert("two", &[("b".into(), sample(2_000))]).unwrap();

        let one = db.load("one", 0).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one["a"], vec![sample(1_000), sample(3_000)]);
        assert_eq!(db.load("one", 2_000).unwrap()["a"], vec![sample(3_000)]);

        assert_eq!(db.prune(2_500).unwrap(), 2);
        assert!(db.load("two", 0).unwrap().is_empty());
        assert_eq!(db.load("one", 0).unwrap()["a"].len(), 1);
    }

    #[test]
    fn rewriting_a_tick_is_idempotent() {
        let db = MetricsDb::memory();
        db.insert("one", &[("a".into(), sample(1_000))]).unwrap();
        db.insert("one", &[("a".into(), sample(1_000))]).unwrap();
        assert_eq!(db.load("one", 0).unwrap()["a"].len(), 1);
    }

    #[test]
    fn file_database_survives_reopen() {
        let dir = std::env::temp_dir().join(format!("cgui-metrics-{}", std::process::id()));
        let path = dir.join("metrics.sqlite3");
        {
            let db = MetricsDb::open_or_memory(&path);
            db.insert("one", &[("a".into(), sample(1_000))]).unwrap();
        }
        let db = MetricsDb::open_or_memory(&path);
        assert_eq!(db.load("one", 0).unwrap()["a"], vec![sample(1_000)]);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
