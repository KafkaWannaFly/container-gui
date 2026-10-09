-- Last measured size per named volume, keyed by Docker endpoint. Written by
-- the slow disk-usage pass; the volume list reads it so the page never waits.
CREATE TABLE IF NOT EXISTS volume_sizes (
    endpoint    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    size_bytes  INTEGER NOT NULL,
    measured_at INTEGER NOT NULL,
    PRIMARY KEY (endpoint, name)
) WITHOUT ROWID;
