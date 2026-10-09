//! The app's SQLite pool. `lib.rs` opens it once at startup and hands a
//! clone to each repository that needs storage. All tables share one
//! database file and one migrator, which lives in `migrations/`.

use std::path::Path;
use std::time::Duration;

use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};

/// Connections for the file database. WAL lets readers run alongside the
/// single writer; writers queue on `busy_timeout`.
const FILE_CONNECTIONS: u32 = 4;

/// Open (or create) the database at `path`. Falls back to an in-memory
/// database so a locked or corrupt file never stops the app.
pub async fn open_or_memory(path: &Path) -> SqlitePool {
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
    match open(file, FILE_CONNECTIONS).await {
        Ok(pool) => pool,
        Err(err) => {
            log::warn!(
                "[db] can't open {}: {err}; history won't persist",
                path.display()
            );
            memory().await
        }
    }
}

/// A fresh in-memory database with all migrations applied.
pub async fn memory() -> SqlitePool {
    // Capped at one connection: `in_memory(true)` gives each connection its
    // own private database (shared cache is off), so a second connection
    // would see empty tables.
    open(SqliteConnectOptions::new().in_memory(true), 1)
        .await
        .expect("in-memory SQLite")
}

/// Opens the pool and runs migrations. The connection count is chosen by the
/// caller because it depends on the database kind (see `memory`).
async fn open(
    options: SqliteConnectOptions,
    max_connections: u32,
) -> Result<SqlitePool, sqlx::Error> {
    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .min_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}
