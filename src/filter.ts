/**
 * Explicit field allowlists (spec §7). Only fields copied here ever reach the
 * browser — anything Oura adds (or new scopes grant) is dropped by default.
 *
 * Owner decision (2026-07-07): steps and resting heart rate are EXCLUDED from
 * the dashboard entirely. Do not add them back without asking the owner.
 */

/** Filtered per-endpoint shapes stored in the KV cache. */
export interface ScoreDoc {
  day: string;
  score: number | null;
}

export interface SleepPeriodDoc {
  day: string;
  type: string;
  total_sleep_seconds: number | null;
}

/** One merged row served to the client for charting. */
export interface DayRecord {
  date: string;
  readiness: number | null;
  sleep: number | null;
  activity: number | null;
  total_sleep_seconds: number | null;
}

function asRecord(doc: unknown): Record<string, unknown> {
  return typeof doc === "object" && doc !== null
    ? (doc as Record<string, unknown>)
    : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** For daily_readiness, daily_sleep, daily_activity documents. */
export function filterScoreDocs(docs: unknown[]): ScoreDoc[] {
  return docs
    .map(asRecord)
    .filter((d) => typeof d.day === "string")
    .map((d) => ({ day: d.day as string, score: numberOrNull(d.score) }));
}

/** For detailed /usercollection/sleep period documents. */
export function filterSleepPeriodDocs(docs: unknown[]): SleepPeriodDoc[] {
  return docs
    .map(asRecord)
    .filter((d) => typeof d.day === "string")
    .map((d) => ({
      day: d.day as string,
      type: typeof d.type === "string" ? d.type : "unknown",
      total_sleep_seconds: numberOrNull(d.total_sleep_duration),
    }));
}

function eachDate(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Merges the filtered per-endpoint documents into one ascending array of
 * DayRecords covering every date in the range (nulls where data is missing).
 * Total sleep counts main ("long_sleep") periods only, matching the app's
 * headline sleep time; naps are ignored.
 */
export function mergeHistory(
  startDate: string,
  endDate: string,
  readiness: ScoreDoc[],
  sleep: ScoreDoc[],
  activity: ScoreDoc[],
  sleepPeriods: SleepPeriodDoc[]
): DayRecord[] {
  const byDay = (docs: ScoreDoc[]) =>
    new Map(docs.map((d) => [d.day, d.score]));
  const readinessByDay = byDay(readiness);
  const sleepByDay = byDay(sleep);
  const activityByDay = byDay(activity);

  const sleepSecondsByDay = new Map<string, number>();
  for (const period of sleepPeriods) {
    if (period.type !== "long_sleep" || period.total_sleep_seconds === null) {
      continue;
    }
    sleepSecondsByDay.set(
      period.day,
      (sleepSecondsByDay.get(period.day) ?? 0) + period.total_sleep_seconds
    );
  }

  return eachDate(startDate, endDate).map((date) => ({
    date,
    readiness: readinessByDay.get(date) ?? null,
    sleep: sleepByDay.get(date) ?? null,
    activity: activityByDay.get(date) ?? null,
    total_sleep_seconds: sleepSecondsByDay.get(date) ?? null,
  }));
}

/** Latest record with any data — the "today (or latest available)" summary. */
export function latestRecord(history: DayRecord[]): DayRecord | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (
      r.readiness !== null ||
      r.sleep !== null ||
      r.activity !== null ||
      r.total_sleep_seconds !== null
    ) {
      return r;
    }
  }
  return null;
}
