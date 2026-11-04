/**
 * Data API (spec §7): shaped, allowlisted, KV-cached responses.
 * Raw Oura payloads never reach the browser.
 */
import { Hono } from "hono";
import type { Env, AppVariables } from "../types";
import { NotConnectedError, TOKENS_KV_KEY, fetchOuraCollection } from "../oura";
import {
  filterReadinessDocs,
  filterScoreDocs,
  filterSleepPeriodDocs,
  hasAnyData,
  latestRecord,
  mergeHistory,
  type DayRecord,
  type ReadinessDoc,
  type ScoreDoc,
  type SleepPeriodDoc,
} from "../filter";
import { ingestDays, INGEST_WINDOW_DAYS, MAX_BACKFILL_DAYS } from "../ingest";
import { readDays } from "../store";
import { computeBaselines, computePatterns, type Baselines } from "../insights";

const CACHE_TTL_SECONDS = 3 * 60 * 60;
// Bump whenever the filtered shapes change: cached entries written by an
// older build would otherwise serve without the new fields for up to 3h.
const CACHE_VERSION = "v2";
const LAST_SYNC_KV_KEY = "last_sync";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateRange(days: number): { start: string; end: string } {
  const now = new Date();
  // End one day ahead of UTC-today so time zones ahead of UTC still get
  // "today" (daily endpoints treat end_date as inclusive; extra day is empty).
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: isoDate(start), end: isoDate(end) };
}

/**
 * Returns the filtered documents for one endpoint, from the KV cache when
 * fresh, otherwise from Oura (storing the *filtered* result, 3h TTL).
 */
async function cachedCollection<T>(
  env: Env,
  endpoint: string,
  start: string,
  end: string,
  filter: (docs: unknown[]) => T[],
  bypassCache: boolean
): Promise<T[]> {
  const cacheKey = `cache:${CACHE_VERSION}:${endpoint}:${start}:${end}`;
  if (!bypassCache) {
    const hit = await env.OURA_KV.get(cacheKey);
    if (hit) return JSON.parse(hit) as T[];
  }
  const fetchStart = Date.now();
  const filtered = filter(await fetchOuraCollection(env, endpoint, start, end));
  // Cache misses are the only upstream calls — logging them makes the cache
  // hit rate and Oura latency visible in Workers Logs. Counts/timings only.
  console.log(
    JSON.stringify({
      event: "oura_fetch",
      endpoint,
      ms: Date.now() - fetchStart,
      documents: filtered.length,
    })
  );
  await env.OURA_KV.put(cacheKey, JSON.stringify(filtered), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
  await env.OURA_KV.put(LAST_SYNC_KV_KEY, new Date().toISOString());
  return filtered;
}

async function loadHistory(
  env: Env,
  days: number,
  bypassCache: boolean
): Promise<DayRecord[]> {
  const { start, end } = dateRange(days);
  const [readiness, sleep, activity, sleepPeriods] = await Promise.all([
    cachedCollection<ReadinessDoc>(env, "daily_readiness", start, end, filterReadinessDocs, bypassCache),
    cachedCollection<ScoreDoc>(env, "daily_sleep", start, end, filterScoreDocs, bypassCache),
    cachedCollection<ScoreDoc>(env, "daily_activity", start, end, filterScoreDocs, bypassCache),
    cachedCollection<SleepPeriodDoc>(env, "sleep", start, end, filterSleepPeriodDocs, bypassCache),
  ]);
  // Trim the lookahead day off the displayed range unless it has data.
  const merged = mergeHistory(start, end, readiness, sleep, activity, sleepPeriods);
  const last = merged[merged.length - 1];
  const hasData = last && hasAnyData(last);
  return hasData ? merged.slice(merged.length - days) : merged.slice(0, -1).slice(-days);
}

/** How much D1 history feeds the Patterns panel. */
const PATTERN_WINDOW_DAYS = 90;

/**
 * Baselines + patterns from the D1 day history. The latest day itself comes
 * from the live (KV-cached) load, so its z-score is fresh even before
 * tonight's ingest lands. Insights are strictly additive: any D1 failure —
 * database missing, not yet created, not yet backfilled — degrades to
 * "no insights" and never breaks the dashboard.
 */
async function loadInsights(
  env: Env,
  latest: DayRecord | null
): Promise<{ baselines: Baselines | null; patterns: string[] }> {
  const none = { baselines: null, patterns: [] as string[] };
  if (!latest || !env.OURA_DB) return none;
  try {
    const start = new Date(`${latest.date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - PATTERN_WINDOW_DAYS);
    const rows = await readDays(env.OURA_DB, isoDate(start), latest.date);
    return {
      baselines: computeBaselines(rows, latest),
      patterns: computePatterns(rows),
    };
  } catch (err) {
    console.error("insights_error", err instanceof Error ? err.message : "unknown");
    return none;
  }
}

export const apiRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// `?refresh=1` bypasses the cache — owner only.
function wantsRefresh(query: string | undefined, isOwner: boolean): boolean {
  return query === "1" && isOwner;
}

function handleUpstreamError(err: unknown): Response {
  if (err instanceof NotConnectedError) {
    return Response.json({ error: "not_connected" }, { status: 409 });
  }
  // No health data or tokens in logs — log the message only.
  console.error("upstream_error", err instanceof Error ? err.message : "unknown");
  return Response.json({ error: "upstream_error" }, { status: 502 });
}

// Everything the page needs in one request: status + summary + history.
// One loadHistory() call serves both summary and charts (4 KV reads total,
// versus 8 across the separate /summary + /history endpoints).
apiRoutes.get("/dashboard", async (c) => {
  const days = c.req.query("days") === "30" ? 30 : 7;
  const isOwner = c.get("isOwner");
  const bypass = wantsRefresh(c.req.query("refresh"), isOwner);

  const version = (c.env.GIT_SHA ?? "dev").slice(0, 7);
  const notConnected = async () =>
    c.json({
      connected: false,
      viewer_is_owner: isOwner,
      last_sync: await c.env.OURA_KV.get(LAST_SYNC_KV_KEY),
      version,
    });

  if ((await c.env.OURA_KV.get(TOKENS_KV_KEY)) === null) {
    return notConnected();
  }
  try {
    const history = await loadHistory(c.env, days, bypass);
    const latest = latestRecord(history);
    const [lastSync, insights] = await Promise.all([
      c.env.OURA_KV.get(LAST_SYNC_KV_KEY),
      loadInsights(c.env, latest),
    ]);
    return c.json({
      connected: true,
      viewer_is_owner: isOwner,
      last_sync: lastSync,
      version,
      summary: latest ?? { date: null },
      history: { days, data: history },
      baselines: insights.baselines,
      patterns: insights.patterns,
    });
  } catch (err) {
    if (err instanceof NotConnectedError) return notConnected();
    return handleUpstreamError(err);
  }
});

apiRoutes.get("/summary", async (c) => {
  const bypass = wantsRefresh(c.req.query("refresh"), c.get("isOwner"));
  try {
    const history = await loadHistory(c.env, 7, bypass);
    const latest = latestRecord(history);
    const lastSync = await c.env.OURA_KV.get(LAST_SYNC_KV_KEY);
    if (!latest) {
      return c.json({ date: null, last_sync: lastSync });
    }
    return c.json({
      date: latest.date,
      readiness: latest.readiness,
      sleep: latest.sleep,
      activity: latest.activity,
      total_sleep_seconds: latest.total_sleep_seconds,
      resting_heart_rate: latest.resting_heart_rate,
      average_hrv: latest.average_hrv,
      temperature_deviation: latest.temperature_deviation,
      last_sync: lastSync,
    });
  } catch (err) {
    return handleUpstreamError(err);
  }
});

apiRoutes.get("/history", async (c) => {
  const days = c.req.query("days") === "30" ? 30 : 7;
  const bypass = wantsRefresh(c.req.query("refresh"), c.get("isOwner"));
  try {
    return c.json({ days, data: await loadHistory(c.env, days, bypass) });
  } catch (err) {
    return handleUpstreamError(err);
  }
});

// Owner-only, on-demand ingest. `/api/ingest` writes the nightly window;
// `/api/ingest?backfill=365` is the one-time history seed after the D1
// database is created. Rows are upserted, so re-running is always safe.
apiRoutes.get("/ingest", async (c) => {
  if (!c.get("isOwner")) {
    return c.json({ error: "forbidden" }, 403);
  }
  // A GET with a side effect (D1 writes, Oura calls) gets the same CSRF
  // defense as /auth/*: a request carrying another site's Origin is refused.
  // Typing the URL into the address bar sends no Origin, so the documented
  // one-time backfill visit still works.
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: "forbidden" }, 403);
  }
  const raw = c.req.query("backfill");
  let days = INGEST_WINDOW_DAYS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BACKFILL_DAYS) {
      return c.json({ error: "bad_backfill" }, 400);
    }
    days = parsed;
  }
  try {
    const { start, end, written } = await ingestDays(c.env, days);
    return c.json({ ok: true, start, end, written });
  } catch (err) {
    return handleUpstreamError(err);
  }
});

apiRoutes.get("/status", async (c) => {
  const [tokens, lastSync] = await Promise.all([
    c.env.OURA_KV.get(TOKENS_KV_KEY),
    c.env.OURA_KV.get(LAST_SYNC_KV_KEY),
  ]);
  return c.json({
    connected: tokens !== null,
    viewer_is_owner: c.get("isOwner"),
    last_sync: lastSync,
  });
});
