-- The endpoint the onboarding wizard installed, used by the connector when
-- resolving the default target. Single-row settings table; clearing the
-- preference deletes the row.
CREATE TABLE IF NOT EXISTS engine_preference (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    endpoint TEXT    NOT NULL
);
