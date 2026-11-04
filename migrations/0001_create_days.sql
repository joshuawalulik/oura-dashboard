-- Longitudinal day store: one row per calendar day, mirroring the DayRecord
-- shape in src/filter.ts. D1 is history only — KV keeps tokens and the 3h
-- response cache. Rows are upserted by the nightly ingest (idempotent, so a
-- late ring sync just rewrites the same days with fuller data).
CREATE TABLE days (
  date TEXT PRIMARY KEY, -- ISO date, e.g. "2026-11-04"
  readiness INTEGER,
  sleep INTEGER,
  activity INTEGER,
  total_sleep_seconds INTEGER,
  resting_heart_rate INTEGER,
  average_hrv REAL,
  temperature_deviation REAL
);
