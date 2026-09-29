-- One row per container per sampler tick, keyed by Docker endpoint so
-- histories of different daemons never mix.
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
