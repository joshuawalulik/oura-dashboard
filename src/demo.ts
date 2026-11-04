/**
 * Public demo mode: a separate deployment ([env.demo] in wrangler.toml)
 * serves this instead of real data. No Access in front — and nothing private
 * behind: no KV namespace, no Oura tokens, no secrets are bound to the demo
 * Worker at all. Every number is synthesized here.
 */
import { Hono } from "hono";
import type { Env, AppVariables } from "./types";
import { latestRecord, type DayRecord } from "./filter";
import { computeBaselines, computePatterns } from "./insights";

/**
 * How much synthetic history feeds the demo's baselines and patterns —
 * matching the real dashboard's 90-day D1 window (inclusive of today).
 * The demo Worker has no D1 (and must never touch one); the same insight
 * math simply runs over generated days instead of stored ones.
 */
const DEMO_INSIGHT_DAYS = 91;

export function isDemoMode(env: Env): boolean {
  return env.DEMO_MODE === "1";
}

/** xmur3 string hash — turns a date string into a 32-bit PRNG seed. */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — tiny deterministic PRNG; plenty for plausible vitals. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * One synthetic day, a pure function of the date string alone — so the
 * 7/30-day windows always agree and a sliding window never rewrites
 * history: yesterday reads the same tomorrow.
 *
 * The shape is modeled, not random: weekends sleep longer, sleep drives
 * readiness, a rough night (~1 in 10) drags readiness down and pushes
 * resting HR and temperature up, and HRV moves inversely to resting HR.
 */
function demoDay(date: string): DayRecord {
  const rand = mulberry32(hashSeed(`oura-demo:${date}`));
  const noise = () => rand() * 2 - 1;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const roughNight = rand() < 0.1;

  const sleepHours = roughNight
    ? 5.1 + rand() * 0.9
    : 7.1 + (weekend ? 0.5 : 0) + noise() * 0.8;
  const sleep = clamp(Math.round(34 + sleepHours * 7 + noise() * 5), 40, 97);
  const readiness = clamp(
    Math.round(0.65 * sleep + 0.35 * 80 + noise() * 6 - (roughNight ? 7 : 0)),
    38,
    96
  );
  const activity = clamp(
    Math.round(68 + (weekend ? 9 : 0) + noise() * 14),
    45,
    98
  );
  const restingHr = clamp(
    Math.round(53 + (roughNight ? 4 : 0) + noise() * 3),
    44,
    66
  );
  const hrv = clamp(Math.round(46 - (restingHr - 53) * 2.2 + noise() * 8), 18, 90);
  const temperature = (roughNight ? 0.3 : 0) + noise() * 0.25;

  return {
    date,
    readiness,
    sleep,
    activity,
    total_sleep_seconds: Math.round((sleepHours * 3600) / 60) * 60,
    resting_heart_rate: restingHr,
    average_hrv: hrv,
    temperature_deviation: Math.round(temperature * 100) / 100,
  };
}

/** Ascending DayRecords for the `days` ending UTC-today. */
export function demoHistory(days: number, now = new Date()): DayRecord[] {
  const records: DayRecord[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    records.push(demoDay(d.toISOString().slice(0, 10)));
  }
  return records;
}

/**
 * Reads like a ring that synced recently; floored to 15 minutes so responses
 * within the same window are byte-identical (and trivially cacheable).
 */
function demoLastSync(now = new Date()): string {
  const quarter = 15 * 60 * 1000;
  return new Date(Math.floor(now.getTime() / quarter) * quarter).toISOString();
}

/**
 * Mounted at /api AHEAD of the real API routes. Outside demo mode every
 * handler defers (next()) to the real route behind it, so the production
 * deployment is untouched by this module.
 */
export const demoRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

demoRoutes.get("/dashboard", async (c, next) => {
  if (!isDemoMode(c.env)) return next();
  const days = c.req.query("days") === "30" ? 30 : 7;
  const history = demoHistory(days);
  const insightHistory = demoHistory(DEMO_INSIGHT_DAYS);
  const latest = latestRecord(insightHistory);
  return c.json({
    connected: true,
    demo: true,
    viewer_is_owner: false,
    last_sync: demoLastSync(),
    version: (c.env.GIT_SHA ?? "dev").slice(0, 7),
    summary: latestRecord(history) ?? { date: null },
    history: { days, data: history },
    baselines: computeBaselines(insightHistory, latest),
    patterns: computePatterns(insightHistory),
  });
});

demoRoutes.get("/history", async (c, next) => {
  if (!isDemoMode(c.env)) return next();
  const days = c.req.query("days") === "30" ? 30 : 7;
  return c.json({ days, data: demoHistory(days) });
});

demoRoutes.get("/summary", async (c, next) => {
  if (!isDemoMode(c.env)) return next();
  const latest = latestRecord(demoHistory(7));
  if (!latest) return c.json({ date: null, last_sync: demoLastSync() });
  return c.json({ ...latest, date: latest.date, last_sync: demoLastSync() });
});

demoRoutes.get("/status", async (c, next) => {
  if (!isDemoMode(c.env)) return next();
  return c.json({
    connected: true,
    demo: true,
    viewer_is_owner: false,
    last_sync: demoLastSync(),
  });
});
