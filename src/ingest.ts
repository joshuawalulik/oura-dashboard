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
import { computePatterns, type PatternResult } from "./insights";
import { readDays, upsertDays } from "./store";
import type { Env } from "./types";

/** The nightly window: wide enough that a ring synced days late self-heals. */
export const INGEST_WINDOW_DAYS = 7;
export const MAX_BACKFILL_DAYS = 730;
/** How much D1 history feeds the Patterns panel. */
export const PATTERN_WINDOW_DAYS = 365;
/** Where the latest computed sentences wait for the dashboard to read them. */
export const PATTERNS_KV_KEY = "patterns";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Recomputes the Patterns sentences over the stored history and saves them.
 * The shuffle tests are too heavy to repeat on every dashboard request now
 * that they cover a year of days, so they run once per ingest, where running
 * out of CPU would only leave yesterday's sentences in place.
 */
async function refreshPatterns(env: Env, end: string, now: Date): Promise<void> {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - PATTERN_WINDOW_DAYS);
  const rows = await readDays(env.OURA_DB, isoDate(start), end);
  await env.OURA_KV.put(PATTERNS_KV_KEY, JSON.stringify(computePatterns(rows)));
}

/**
 * The results from the last ingest; empty until one has run. Entries saved
 * as plain sentences by an older build are skipped until the next ingest
 * replaces them.
 */
export async function readStoredPatterns(env: Env): Promise<PatternResult[]> {
  const raw = await env.OURA_KV.get(PATTERNS_KV_KEY);
  if (!raw) return [];
  const stored = JSON.parse(raw) as unknown[];
  return stored.filter(
    (entry): entry is PatternResult => typeof entry === "object" && entry !== null
  );
}

/**
 * Fetches the last `days` days from Oura (ending UTC-today + 1, matching the
 * dashboard's lookahead for time zones ahead of UTC) and upserts every day
 * that has data into D1, then refreshes the Patterns sentences. Idempotent:
 * running it twice writes the same rows.
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
  try {
    await refreshPatterns(env, endDate, now);
  } catch (err) {
    // The rows are saved; stale sentences beat failing the whole ingest.
    console.error(
      JSON.stringify({
        event: "patterns_refresh",
        outcome: "error",
        message: err instanceof Error ? err.message : "unknown",
      })
    );
  }
  return { start: startDate, end: endDate, written };
}
