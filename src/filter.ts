/**
 * Explicit field allowlists (spec §7). Only fields copied here ever reach the
 * browser — anything Oura adds (or new scopes grant) is dropped by default.
 *
 * Owner decision (2026-07-07): steps are EXCLUDED from the dashboard
 * entirely. Do not add them back without asking the owner.
 * Owner decision (2026-11-03, vitals roadmap): resting heart rate, nightly
 * HRV, and temperature deviation are IN — this supersedes the 2026-07-07
 * exclusion of resting heart rate.
 */

/** Filtered per-endpoint shapes stored in the KV cache. */
export interface ScoreDoc {
  day: string;
  score: number | null;
}

/** daily_readiness additionally carries the body-temperature vital. */
export interface ReadinessDoc extends ScoreDoc {
  temperature_deviation: number | null;
  /** 0–100 per contributor, allowlisted below; absent ones are left out. */
  contributors: Record<string, number>;
}

/** The readiness contributors that may reach the browser, with their labels. */
export const READINESS_CONTRIBUTOR_LABELS: Record<string, string> = {
  activity_balance: "Activity balance",
  body_temperature: "Body temperature",
  hrv_balance: "HRV balance",
  previous_day_activity: "Previous day activity",
  previous_night: "Previous night",
  recovery_index: "Recovery index",
  resting_heart_rate: "Resting heart rate",
  sleep_balance: "Sleep balance",
};

export interface SleepPeriodDoc {
  day: string;
  type: string;
  total_sleep_seconds: number | null;
  lowest_heart_rate: number | null;
  average_hrv: number | null;
  bedtime_minutes: number | null;
}

/** One merged row served to the client for charting. */
export interface DayRecord {
  date: string;
  readiness: number | null;
  sleep: number | null;
  activity: number | null;
  total_sleep_seconds: number | null;
  resting_heart_rate: number | null;
  average_hrv: number | null;
  temperature_deviation: number | null;
  /** Minutes from local midnight: 23:30 is -30, 00:45 is 45. */
  bedtime_minutes: number | null;
}

function asRecord(doc: unknown): Record<string, unknown> {
  return typeof doc === "object" && doc !== null
    ? (doc as Record<string, unknown>)
    : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads the local clock time straight from Oura's timestamp, which carries
 * its own offset: going through Date would convert it to the Worker's UTC.
 * Times from noon on count back from midnight, so 23:30 becomes -30.
 */
function bedtimeMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 12 * 60 ? minutes - 24 * 60 : minutes;
}

function filterContributors(value: unknown): Record<string, number> {
  const source = asRecord(value);
  const kept: Record<string, number> = {};
  for (const key of Object.keys(READINESS_CONTRIBUTOR_LABELS)) {
    const score = numberOrNull(source[key]);
    if (score !== null) kept[key] = score;
  }
  return kept;
}

/** For daily_sleep and daily_activity documents. */
export function filterScoreDocs(docs: unknown[]): ScoreDoc[] {
  return docs
    .map(asRecord)
    .filter((d) => typeof d.day === "string")
    .map((d) => ({ day: d.day as string, score: numberOrNull(d.score) }));
}

/** For daily_readiness documents: score, temperature (°C), and contributors. */
export function filterReadinessDocs(docs: unknown[]): ReadinessDoc[] {
  return docs
    .map(asRecord)
    .filter((d) => typeof d.day === "string")
    .map((d) => ({
      day: d.day as string,
      score: numberOrNull(d.score),
      temperature_deviation: numberOrNull(d.temperature_deviation),
      contributors: filterContributors(d.contributors),
    }));
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
      lowest_heart_rate: numberOrNull(d.lowest_heart_rate),
      average_hrv: numberOrNull(d.average_hrv),
      bedtime_minutes: bedtimeMinutes(d.bedtime_start),
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
  readiness: Omit<ReadinessDoc, "contributors">[],
  sleep: ScoreDoc[],
  activity: ScoreDoc[],
  sleepPeriods: SleepPeriodDoc[]
): DayRecord[] {
  const byDay = (docs: ScoreDoc[]) =>
    new Map(docs.map((d) => [d.day, d.score]));
  const readinessByDay = byDay(readiness);
  const sleepByDay = byDay(sleep);
  const activityByDay = byDay(activity);
  const temperatureByDay = new Map(
    readiness.map((d) => [d.day, d.temperature_deviation])
  );

  const sleepSecondsByDay = new Map<string, number>();
  const restingHrByDay = new Map<string, number>();
  const hrvByDay = new Map<string, { seconds: number; value: number }>();
  const bedtimeByDay = new Map<string, { seconds: number; value: number }>();
  for (const period of sleepPeriods) {
    if (period.type !== "long_sleep") continue;
    const seconds = period.total_sleep_seconds;
    if (seconds !== null) {
      sleepSecondsByDay.set(
        period.day,
        (sleepSecondsByDay.get(period.day) ?? 0) + seconds
      );
    }
    // Resting HR is the lowest heart rate across the night's main periods.
    if (period.lowest_heart_rate !== null) {
      const prev = restingHrByDay.get(period.day);
      restingHrByDay.set(
        period.day,
        prev === undefined
          ? period.lowest_heart_rate
          : Math.min(prev, period.lowest_heart_rate)
      );
    }
    // HRV comes from the night's longest period — averaging in a short
    // second period would skew the headline number.
    if (period.average_hrv !== null) {
      const prev = hrvByDay.get(period.day);
      if (!prev || (seconds ?? 0) > prev.seconds) {
        hrvByDay.set(period.day, { seconds: seconds ?? 0, value: period.average_hrv });
      }
    }
    // Bedtime too: a brief second period isn't when the night began.
    if (period.bedtime_minutes !== null) {
      const prev = bedtimeByDay.get(period.day);
      if (!prev || (seconds ?? 0) > prev.seconds) {
        bedtimeByDay.set(period.day, {
          seconds: seconds ?? 0,
          value: period.bedtime_minutes,
        });
      }
    }
  }

  return eachDate(startDate, endDate).map((date) => ({
    date,
    readiness: readinessByDay.get(date) ?? null,
    sleep: sleepByDay.get(date) ?? null,
    activity: activityByDay.get(date) ?? null,
    total_sleep_seconds: sleepSecondsByDay.get(date) ?? null,
    resting_heart_rate: restingHrByDay.get(date) ?? null,
    average_hrv: hrvByDay.get(date)?.value ?? null,
    temperature_deviation: temperatureByDay.get(date) ?? null,
    bedtime_minutes: bedtimeByDay.get(date)?.value ?? null,
  }));
}

/** True when any non-date field on the row has data. */
export function hasAnyData(record: DayRecord): boolean {
  return Object.entries(record).some(
    ([key, value]) => key !== "date" && value !== null
  );
}

/** Latest record with any data — the "today (or latest available)" summary. */
export function latestRecord(history: DayRecord[]): DayRecord | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (hasAnyData(history[i])) return history[i];
  }
  return null;
}
