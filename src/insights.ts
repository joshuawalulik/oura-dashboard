/**
 * Insights computed from the D1 day history: 28-day rolling baselines
 * (mean/σ/z per metric) and the Patterns panel's sentences. Pure functions —
 * every number is computed from the rows passed in, nothing is fabricated,
 * and anything below its evidence threshold is simply omitted.
 */
import { READINESS_CONTRIBUTOR_LABELS, type DayRecord } from "./filter";
import { mulberry32 } from "./prng";

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

/* ---- Readiness inputs: which contributors sit low today ---- */

/** Below this a contributor counts as low, matching the dial's "Low" word. */
export const LOW_INPUT_SCORE = 70;
const MAX_LOW_INPUTS = 2;

export interface ReadinessInput {
  name: string;
  score: number;
}

/**
 * The lowest contributors under LOW_INPUT_SCORE, lowest first. This says which
 * inputs sit low, not how much each cost: Oura doesn't publish the weights.
 */
export function lowestReadinessInputs(
  contributors: Record<string, number> | undefined
): ReadinessInput[] {
  return Object.entries(contributors ?? {})
    .filter(([key, score]) => key in READINESS_CONTRIBUTOR_LABELS && score < LOW_INPUT_SCORE)
    .map(([key, score]) => ({ name: READINESS_CONTRIBUTOR_LABELS[key], score }))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_LOW_INPUTS);
}

/* ---- Patterns: a few computed, honest sentences ----
 *
 * A pattern has to clear two gates. Its effect must be big enough to matter
 * (the MIN_* thresholds), and it must beat chance: shuffling the outcome
 * across the same days has to almost never produce an effect that large. The
 * size gates alone aren't enough. A best-minus-worst weekday gap, for one, is
 * large on pure noise when each weekday only has a dozen samples.
 *
 * Every pattern with enough data to test reports its working, whether or not
 * it passed: a tested "no clear link" is a result too. Too little data to
 * test at all still means saying nothing.
 */

export type PatternStatus = "found" | "no_link";

export interface PatternResult {
  id: string;
  status: PatternStatus;
  sentence: string;
  /** Label/value rows behind the sentence, in reading order. */
  math: Array<{ label: string; value: string }>;
}

/** Minimum paired days before a correlation is worth a sentence. */
export const MIN_PATTERN_DAYS = 14;
/** |Pearson r| below this stays silent — no story in the noise. */
const MIN_CORRELATION = 0.3;
/** An HRV split under 2 ms isn't a pattern worth stating. */
const MIN_HRV_GAP_MS = 2;
/** Best-vs-worst weekday readiness gap worth mentioning. */
const MIN_WEEKDAY_GAP = 5;
/** Weekend-vs-weekday sleep difference worth mentioning (seconds). */
const MIN_SLEEP_GAP_SECONDS = 20 * 60;
/**
 * Shuffles per pattern. This runs inside the ingest, so it stays within the
 * Workers CPU budget; 499 still resolves p-values to 0.002.
 */
const SHUFFLES = 499;
/** Strict on purpose: several patterns get tried on every run. */
const MAX_P = 0.01;
/** Fixed so the same history always yields the same sentences. */
const SHUFFLE_SEED = 0x5ca1ab1e;

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

/** Minutes from local midnight as a clock time: -40 is "11:20 pm". */
function formatClock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = String(wrapped % 60).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

function formatHours(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

interface ShuffleResult {
  passed: boolean;
  /** Shuffles that tied or beat the real ordering, when all of them ran. */
  matched: number | null;
}

/**
 * Permutation test: does `statistic` on the real ordering of `values` beat
 * what shuffled orderings produce? `statistic` must be non-negative, with
 * larger meaning a stronger effect. Stops as soon as the shuffles have tied
 * or beaten it too often to pass, so weak candidates cost almost nothing.
 */
function shuffleTest(
  values: number[],
  statistic: (ordering: Float64Array) => number
): ShuffleResult {
  const ordering = Float64Array.from(values);
  const observed = statistic(ordering) - 1e-9; // ties count against the pattern
  const allowed = Math.floor(MAX_P * (SHUFFLES + 1)) - 1;
  const rand = mulberry32(SHUFFLE_SEED);
  let asExtreme = 0;
  for (let i = 0; i < SHUFFLES; i++) {
    for (let j = ordering.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      const swapped = ordering[j];
      ordering[j] = ordering[k];
      ordering[k] = swapped;
    }
    if (statistic(ordering) >= observed && ++asExtreme > allowed) {
      return { passed: false, matched: null };
    }
  }
  return { passed: true, matched: asExtreme };
}

/** The shuffle row: `null` means the effect never reached the test. */
function shuffleRow(shuffle: ShuffleResult | null): { label: string; value: string } {
  const label = "Shuffle test";
  if (!shuffle) return { label, value: "Not run: the effect was under the minimum" };
  if (!shuffle.passed) {
    return { label, value: `Too many shuffles matched it, so p is above ${MAX_P}` };
  }
  const matched = shuffle.matched as number;
  const p = (matched + 1) / (SHUFFLES + 1);
  return {
    label,
    value: `${matched} of ${SHUFFLES} shuffles matched it (p = ${p.toFixed(3)}, needs ${MAX_P} or less)`,
  };
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

/** [cause, HRV] pairs measured, then tested once the effect is big enough. */
interface HrvSplit {
  pairs: number;
  r: number;
  cut: number;
  /** Mean outcome on days above the cut, then at or below it. */
  above: number;
  below: number;
  shuffle: ShuffleResult | null;
}

/**
 * Tests [cause, HRV] pairs: a large enough correlation, a median split that
 * tells the same story by at least MIN_HRV_GAP_MS, and a shuffle test. Returns
 * null only when there's too little data to test at all.
 */
function hrvSplit(pairs: Array<[number, number]>): HrvSplit | null {
  if (pairs.length < MIN_PATTERN_DAYS) return null;

  const r = pearson(pairs);
  const cut = median(pairs.map((p) => p[0]));
  const aboveCut = pairs.filter((p) => p[0] > cut).map((p) => p[1]);
  const belowCut = pairs.filter((p) => p[0] <= cut).map((p) => p[1]);
  if (aboveCut.length < 5 || belowCut.length < 5) return null;
  const above = meanOf(aboveCut);
  const below = meanOf(belowCut);
  const gap = above - below;
  const split = { pairs: pairs.length, r, cut, above, below };

  // The split must tell the same story as the correlation, or say nothing.
  if (
    Math.abs(r) < MIN_CORRELATION ||
    Math.abs(gap) < MIN_HRV_GAP_MS ||
    Math.sign(gap) !== Math.sign(r)
  ) {
    return { ...split, shuffle: null };
  }

  // Shuffling HRV keeps its mean and spread, so of Pearson's r only the
  // covariance term changes: this sum ranks orderings exactly as |r| would.
  const causeMean = meanOf(pairs.map((p) => p[0]));
  const weights = pairs.map((p) => p[0] - causeMean);
  const covariance = (hrv: Float64Array) => {
    let sum = 0;
    for (let i = 0; i < hrv.length; i++) sum += weights[i] * hrv[i];
    return Math.abs(sum);
  };
  return { ...split, shuffle: shuffleTest(pairs.map((p) => p[1]), covariance) };
}

function hrvSplitMath(effect: HrvSplit, cutLabel: string): PatternResult["math"] {
  const gap = Math.abs(effect.above - effect.below).toFixed(1);
  return [
    { label: "Compared", value: `${effect.pairs} nights, split at ${cutLabel}` },
    { label: "Effect", value: `${gap} ms gap, correlation ${effect.r.toFixed(2)}` },
    {
      label: "Minimum",
      value: `${MIN_HRV_GAP_MS} ms gap and correlation ${MIN_CORRELATION.toFixed(2)}`,
    },
    shuffleRow(effect.shuffle),
  ];
}

/**
 * Sleep length vs the following night's HRV.
 * Not vs readiness: Oura builds readiness partly from the night's sleep, so
 * that correlation is largely baked in. HRV is measured, and the one-day lag
 * keeps the night being judged out of the outcome. Pairs must be consecutive
 * calendar days, so a gap in the history can't pair unrelated nights.
 */
function sleepRecoveryPattern(history: DayRecord[]): PatternResult | null {
  const byDate = new Map(history.map((r) => [r.date, r]));
  const pairs: Array<[number, number]> = [];
  for (const r of history) {
    const nextHrv = byDate.get(addDays(r.date, 1))?.average_hrv ?? null;
    if (r.total_sleep_seconds !== null && nextHrv !== null) {
      pairs.push([r.total_sleep_seconds, nextHrv]);
    }
  }
  const effect = hrvSplit(pairs);
  if (!effect) return null;

  const math = hrvSplitMath(effect, formatHours(effect.cut));
  const id = "sleep_next_hrv";
  if (!effect.shuffle?.passed) {
    return {
      id,
      status: "no_link",
      sentence: `No clear link between sleep length and the next night's HRV (${effect.pairs} nights).`,
      math,
    };
  }
  const direction = effect.above > effect.below ? "higher" : "lower";
  return {
    id,
    status: "found",
    sentence:
      `After nights longer than ${formatHours(effect.cut)}, the next night's HRV ran ${direction} — ` +
      `averaging ${Math.round(effect.above)} vs ${Math.round(effect.below)} ms ` +
      `after shorter nights (${effect.pairs} nights).`,
    math,
  };
}

/** Bedtime vs HRV across that same night, which bedtime comes before. */
function bedtimeRecoveryPattern(history: DayRecord[]): PatternResult | null {
  const pairs = history
    .filter((r) => r.bedtime_minutes !== null && r.average_hrv !== null)
    .map((r) => [r.bedtime_minutes, r.average_hrv] as [number, number]);
  const effect = hrvSplit(pairs);
  if (!effect) return null;

  const math = hrvSplitMath(effect, formatClock(effect.cut));
  const id = "bedtime_hrv";
  if (!effect.shuffle?.passed) {
    return {
      id,
      status: "no_link",
      sentence: `No clear link between bedtime and that night's HRV (${effect.pairs} nights).`,
      math,
    };
  }
  const direction = effect.above > effect.below ? "higher" : "lower";
  return {
    id,
    status: "found",
    sentence:
      `Nights starting after ${formatClock(effect.cut)} ran ${direction} HRV — ` +
      `averaging ${Math.round(effect.above)} vs ${Math.round(effect.below)} ms ` +
      `on earlier nights (${effect.pairs} nights).`,
    math,
  };
}

/** Best/worst weekday for readiness, if the spread beats chance. */
function weekdayReadinessPattern(history: DayRecord[]): PatternResult | null {
  const days: number[] = [];
  const scores: number[] = [];
  const byDay = new Map<number, number[]>();
  for (const r of history) {
    if (r.readiness === null) continue;
    const dow = dayOfWeek(r.date);
    days.push(dow);
    scores.push(r.readiness);
    byDay.set(dow, [...(byDay.get(dow) ?? []), r.readiness]);
  }
  const qualified = [...byDay.entries()].filter(([, v]) => v.length >= 3);
  if (qualified.length < 5) return null;

  const means = qualified.map(([dow, v]) => ({ dow, mean: meanOf(v) }));
  means.sort((a, b) => a.mean - b.mean);
  const worst = means[0];
  const best = means[means.length - 1];
  const gap = best.mean - worst.mean;

  const counted = qualified.map(([dow]) => dow);
  const counts = new Float64Array(7);
  for (const dow of days) counts[dow]++;
  const sums = new Float64Array(7);
  const spread = (ordering: Float64Array) => {
    sums.fill(0);
    for (let i = 0; i < ordering.length; i++) sums[days[i]] += ordering[i];
    let low = Infinity;
    let high = -Infinity;
    for (const dow of counted) {
      const mean = sums[dow] / counts[dow];
      if (mean < low) low = mean;
      if (mean > high) high = mean;
    }
    return high - low;
  };
  const shuffle = gap < MIN_WEEKDAY_GAP ? null : shuffleTest(scores, spread);

  const math = [
    { label: "Compared", value: `${scores.length} days across ${counted.length} weekdays` },
    {
      label: "Effect",
      value: `${gap.toFixed(1)} points, ${DAY_NAMES[best.dow]}s over ${DAY_NAMES[worst.dow]}s`,
    },
    { label: "Minimum", value: `${MIN_WEEKDAY_GAP} points` },
    shuffleRow(shuffle),
  ];
  const id = "weekday_readiness";
  if (!shuffle?.passed) {
    return {
      id,
      status: "no_link",
      sentence: `No clear weekday pattern in readiness (${scores.length} days).`,
      math,
    };
  }
  return {
    id,
    status: "found",
    sentence:
      `Readiness runs lowest on ${DAY_NAMES[worst.dow]}s (avg ${Math.round(worst.mean)}) ` +
      `and highest on ${DAY_NAMES[best.dow]}s (avg ${Math.round(best.mean)}).`,
    math,
  };
}

/**
 * Weekend vs weekday sleep length, if the gap is at least ~20 minutes.
 * Worded without "you": both people read this, and it's only one's sleep.
 */
function weekendSleepPattern(history: DayRecord[]): PatternResult | null {
  const flags: boolean[] = [];
  const seconds: number[] = [];
  for (const r of history) {
    if (r.total_sleep_seconds === null) continue;
    const dow = dayOfWeek(r.date);
    flags.push(dow === 0 || dow === 6);
    seconds.push(r.total_sleep_seconds);
  }
  const weekend = seconds.filter((_, i) => flags[i]);
  const weekday = seconds.filter((_, i) => !flags[i]);
  if (weekend.length < 8 || weekday.length < 16) return null;

  const gap = meanOf(weekend) - meanOf(weekday);
  const meanGap = (ordering: Float64Array) => {
    let weekendSum = 0;
    let weekdaySum = 0;
    for (let i = 0; i < ordering.length; i++) {
      if (flags[i]) weekendSum += ordering[i];
      else weekdaySum += ordering[i];
    }
    return Math.abs(weekendSum / weekend.length - weekdaySum / weekday.length);
  };
  const shuffle =
    Math.abs(gap) < MIN_SLEEP_GAP_SECONDS ? null : shuffleTest(seconds, meanGap);

  const math = [
    {
      label: "Compared",
      value: `${weekend.length} weekend and ${weekday.length} weekday nights`,
    },
    { label: "Effect", value: `${Math.round(Math.abs(gap) / 60)} minutes` },
    { label: "Minimum", value: `${MIN_SLEEP_GAP_SECONDS / 60} minutes` },
    shuffleRow(shuffle),
  ];
  const id = "weekend_sleep";
  if (!shuffle?.passed) {
    return {
      id,
      status: "no_link",
      sentence: `No clear weekend difference in sleep length (${seconds.length} nights).`,
      math,
    };
  }
  const minutes = Math.round(Math.abs(gap) / 60 / 5) * 5;
  const direction = gap > 0 ? "longer" : "shorter";
  return {
    id,
    status: "found",
    sentence:
      `Weekend nights run about ${minutes} minutes ${direction} than weeknights ` +
      `(${formatHours(meanOf(weekend))} vs ${formatHours(meanOf(weekday))}).`,
    math,
  };
}

/**
 * One result per pattern that had enough data to test, found or not. An empty
 * array means nothing could be tested, so the panel is hidden: never filler.
 */
export function computePatterns(history: DayRecord[]): PatternResult[] {
  return [
    sleepRecoveryPattern(history),
    bedtimeRecoveryPattern(history),
    weekdayReadinessPattern(history),
    weekendSleepPattern(history),
  ].filter((p): p is PatternResult => p !== null);
}
