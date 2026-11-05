/**
 * D1 day store: the longitudinal history behind baselines and patterns.
 * KV keeps its existing roles (tokens + 3h response cache); D1 holds one
 * row per day, written by the nightly ingest and the backfill route.
 */
import { hasAnyData, type DayRecord } from "./filter";

/** D1 rows come back with the exact DayRecord column names. */
type DayRow = DayRecord;

/**
 * Upserts day rows, newest data winning but never erasing: each column takes
 * the incoming value unless it is NULL, in which case the stored value stays
 * (COALESCE). That makes the ingest idempotent AND self-healing — a late ring
 * sync re-writes the same days with fuller data, while a partial fetch can
 * never null-out history it didn't see. Rows with no data at all are skipped.
 */
export async function upsertDays(
  db: D1Database,
  records: DayRecord[]
): Promise<number> {
  const rows = records.filter(hasAnyData);
  if (rows.length === 0) return 0;

  const stmt = db.prepare(
    `INSERT INTO days (date, readiness, sleep, activity, total_sleep_seconds,
       resting_heart_rate, average_hrv, temperature_deviation, bedtime_minutes)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(date) DO UPDATE SET
       readiness = COALESCE(excluded.readiness, readiness),
       sleep = COALESCE(excluded.sleep, sleep),
       activity = COALESCE(excluded.activity, activity),
       total_sleep_seconds = COALESCE(excluded.total_sleep_seconds, total_sleep_seconds),
       resting_heart_rate = COALESCE(excluded.resting_heart_rate, resting_heart_rate),
       average_hrv = COALESCE(excluded.average_hrv, average_hrv),
       temperature_deviation = COALESCE(excluded.temperature_deviation, temperature_deviation),
       bedtime_minutes = COALESCE(excluded.bedtime_minutes, bedtime_minutes)`
  );

  // Chunked batches: a 365-day backfill stays well inside D1's per-batch
  // statement limits, and each chunk commits atomically.
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batch(
      rows.slice(i, i + CHUNK).map((r) =>
        stmt.bind(
          r.date,
          r.readiness,
          r.sleep,
          r.activity,
          r.total_sleep_seconds,
          r.resting_heart_rate,
          r.average_hrv,
          r.temperature_deviation,
          r.bedtime_minutes
        )
      )
    );
  }
  return rows.length;
}

/** Ascending day rows in [startDate, endDate], only days that exist. */
export async function readDays(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<DayRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT date, readiness, sleep, activity, total_sleep_seconds,
         resting_heart_rate, average_hrv, temperature_deviation, bedtime_minutes
       FROM days WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC`
    )
    .bind(startDate, endDate)
    .all<DayRow>();
  return results;
}
