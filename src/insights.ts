/**
 * Insights computed from the D1 day history: 28-day rolling baselines
 * (mean/σ/z per metric) and the Patterns panel's sentences. Pure functions —
 * every number is computed from the rows passed in, nothing is fabricated,
 * and anything below its evidence threshold is simply omitted.
 */
import type { DayRecord } from "./filter";

/** Metrics that get a rolling baseline. */
export const BASELINE_METRICS = [
  "readiness",
  "sleep",
  "activity",
  "total_sleep_seconds",
  "resting_heart_rate",
  "average_hrv",
  "temperature_deviation",
] as const;
export type BaselineMetric = (typeof BASELINE_METRICS)[number];

export interface BaselineStat {
  /** Mean over the window's days that have this metric. */
  mean: number;
  /** Sample standard deviation over the same days. */
  sd: number;
  /** How many of the window's days had this metric. */
  n: number;
  /** (latest - mean) / sd; null when latest is missing or sd ~ 0. */
  z: number | null;
}

export interface Baselines {
  window_days: number;
  metrics: Partial<Record<BaselineMetric, BaselineStat>>;
}

export const BASELINE_WINDOW_DAYS = 28;
/** A baseline needs at least half the window to mean anything. */
export const MIN_BASELINE_DAYS = 14;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n - 1). */
function sdOf(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const ss = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

/**
 * 28-day rolling baseline per metric: mean and σ over the window of days
 * strictly before `latest`, plus the z-score of the latest value against it.
 * Metrics with fewer than MIN_BASELINE_DAYS days of data are omitted; returns
 * null when nothing qualifies.
 */
export function computeBaselines(
  history: DayRecord[],
  latest: DayRecord | null,
  windowDays = BASELINE_WINDOW_DAYS
): Baselines | null {
  if (!latest) return null;
  const windowStart = addDays(latest.date, -windowDays);
  const window = history.filter(
    (r) => r.date >= windowStart && r.date < latest.date
  );

  const metrics: Baselines["metrics"] = {};
  for (const metric of BASELINE_METRICS) {
    const values = window
      .map((r) => r[metric])
      .filter((v): v is number => v !== null);
    if (values.length < MIN_BASELINE_DAYS) continue;
    const mean = meanOf(values);
    const sd = sdOf(values, mean);
    const latestValue = latest[metric];
    const z =
      latestValue !== null && sd > 1e-9 ? round((latestValue - mean) / sd, 2) : null;
    metrics[metric] = { mean: round(mean, 1), sd: round(sd, 1), n: values.length, z };
  }

  return Object.keys(metrics).length > 0 ? { window_days: windowDays, metrics } : null;
}

/* ---- Patterns: 2–3 computed, honest sentences ---- */

/** Minimum paired days before a correlation is worth a sentence. */
export const MIN_PATTERN_DAYS = 14;
/** |Pearson r| below this stays silent — no story in the noise. */
const MIN_CORRELATION = 0.3;
/** A readiness split under 2 points isn't a pattern worth stating. */
const MIN_READINESS_GAP = 2;
/** Best-vs-worst weekday readiness gap worth mentioning. */
const MIN_WEEKDAY_GAP = 5;
/** Weekend-vs-weekday sleep difference worth mentioning (seconds). */
const MIN_SLEEP_GAP_SECONDS = 20 * 60;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function pearson(pairs: Array<[number, number]>): number {
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = meanOf(xs);
  const my = meanOf(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den > 1e-9 ? num / den : 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sleep length vs that morning's readiness, phrased via a median split. */
function sleepReadinessPattern(history: DayRecord[]): string | null {
  const pairs = history
    .filter((r) => r.total_sleep_seconds !== null && r.readiness !== null)
    .map((r) => [r.total_sleep_seconds as number, r.readiness as number] as [number, number]);
  if (pairs.length < MIN_PATTERN_DAYS) return null;

  const r = pearson(pairs);
  if (Math.abs(r) < MIN_CORRELATION) return null;

  const cut = median(pairs.map((p) => p[0]));
  const longer = pairs.filter((p) => p[0] > cut).map((p) => p[1]);
  const shorter = pairs.filter((p) => p[0] <= cut).map((p) => p[1]);
  if (longer.length < 5 || shorter.length < 5) return null;
  const gap = meanOf(longer) - meanOf(shorter);
  // The split must tell the same story as the correlation, or say nothing.
  if (Math.abs(gap) < MIN_READINESS_GAP || Math.sign(gap) !== Math.sign(r)) {
    return null;
  }

  const a = Math.round(meanOf(longer));
  const b = Math.round(meanOf(shorter));
  const direction = gap > 0 ? "higher" : "lower";
  return (
    `Nights longer than ${formatHours(cut)} were followed by ${direction} readiness — ` +
    `averaging ${a} vs ${b} after shorter nights (${pairs.length} nights).`
  );
}

/** Best/worst weekday for readiness, if the spread is real. */
function weekdayReadinessPattern(history: DayRecord[]): string | null {
  const byDay = new Map<number, number[]>();
  for (const r of history) {
    if (r.readiness === null) continue;
    const dow = dayOfWeek(r.date);
    byDay.set(dow, [...(byDay.get(dow) ?? []), r.readiness]);
  }
  const qualified = [...byDay.entries()].filter(([, v]) => v.length >= 3);
  if (qualified.length < 5) return null;

  const means = qualified.map(([dow, v]) => ({ dow, mean: meanOf(v) }));
  means.sort((a, b) => a.mean - b.mean);
  const worst = means[0];
  const best = means[means.length - 1];
  if (best.mean - worst.mean < MIN_WEEKDAY_GAP) return null;

  return (
    `Readiness runs lowest on ${DAY_NAMES[worst.dow]}s (avg ${Math.round(worst.mean)}) ` +
    `and highest on ${DAY_NAMES[best.dow]}s (avg ${Math.round(best.mean)}).`
  );
}

/** Weekend vs weekday sleep length, if the gap is at least ~20 minutes. */
function weekendSleepPattern(history: DayRecord[]): string | null {
  const weekend: number[] = [];
  const weekday: number[] = [];
  for (const r of history) {
    if (r.total_sleep_seconds === null) continue;
    const dow = dayOfWeek(r.date);
    (dow === 0 || dow === 6 ? weekend : weekday).push(r.total_sleep_seconds);
  }
  if (weekend.length < 8 || weekday.length < 16) return null;

  const gap = meanOf(weekend) - meanOf(weekday);
  if (Math.abs(gap) < MIN_SLEEP_GAP_SECONDS) return null;

  const minutes = Math.round(Math.abs(gap) / 60 / 5) * 5;
  const direction = gap > 0 ? "longer" : "shorter";
  return (
    `You sleep about ${minutes} minutes ${direction} on weekend nights ` +
    `(${formatHours(meanOf(weekend))} vs ${formatHours(meanOf(weekday))}).`
  );
}

/**
 * Up to three sentences, each earned by its own evidence threshold. An empty
 * array means the panel is hidden entirely — never filler, never guesses.
 */
export function computePatterns(history: DayRecord[]): string[] {
  return [
    sleepReadinessPattern(history),
    weekdayReadinessPattern(history),
    weekendSleepPattern(history),
  ].filter((s): s is string => s !== null);
}
