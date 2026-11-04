/**
 * Ingest: pulls filtered Oura data straight from the API (never through the
 * KV response cache — history wants fresh data) and upserts it into D1.
 * Runs nightly via the cron trigger for the last ~7 days, and once via the
 * owner-only /api/ingest?backfill=N route to seed history.
 */
import { fetchOuraCollection } from "./oura";
import {
  filterReadinessDocs,
  filterScoreDocs,
  filterSleepPeriodDocs,
  mergeHistory,
} from "./filter";
import { upsertDays } from "./store";
import type { Env } from "./types";

/** The nightly window: wide enough that a ring synced days late self-heals. */
export const INGEST_WINDOW_DAYS = 7;
export const MAX_BACKFILL_DAYS = 730;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetches the last `days` days from Oura (ending UTC-today + 1, matching the
 * dashboard's lookahead for time zones ahead of UTC) and upserts every day
 * that has data into D1. Idempotent: running it twice writes the same rows.
 */
export async function ingestDays(
  env: Env,
  days: number,
  now = new Date()
): Promise<{ start: string; end: string; written: number }> {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startDate = isoDate(start);
  const endDate = isoDate(end);

  const [readiness, sleep, activity, sleepPeriods] = await Promise.all([
    fetchOuraCollection(env, "daily_readiness", startDate, endDate).then(filterReadinessDocs),
    fetchOuraCollection(env, "daily_sleep", startDate, endDate).then(filterScoreDocs),
    fetchOuraCollection(env, "daily_activity", startDate, endDate).then(filterScoreDocs),
    fetchOuraCollection(env, "sleep", startDate, endDate).then(filterSleepPeriodDocs),
  ]);

  const merged = mergeHistory(startDate, endDate, readiness, sleep, activity, sleepPeriods);
  const written = await upsertDays(env.OURA_DB, merged);
  return { start: startDate, end: endDate, written };
}
