import { describe, it, expect } from "vitest";
import {
  filterReadinessDocs,
  filterScoreDocs,
  filterSleepPeriodDocs,
  mergeHistory,
  latestRecord,
  type SleepPeriodDoc,
} from "../src/filter";

describe("field allowlisting", () => {
  it("drops everything except day and score from daily documents", () => {
    const filtered = filterScoreDocs([
      {
        day: "2026-07-06",
        score: 82,
        // Fields that must NOT leak:
        contributors: { resting_heart_rate: 48, hrv_balance: 70 },
        steps: 9000,
        temperature_deviation: -0.2,
        id: "abc",
      },
    ]);
    expect(filtered).toEqual([{ day: "2026-07-06", score: 82 }]);
  });

  it("keeps only day/score/temperature_deviation from readiness documents", () => {
    const filtered = filterReadinessDocs([
      {
        day: "2026-07-06",
        score: 82,
        temperature_deviation: -0.2,
        // Fields that must NOT leak:
        contributors: { resting_heart_rate: 48, hrv_balance: 70 },
        temperature_trend_deviation: -0.1,
        id: "abc",
      },
    ]);
    expect(filtered).toEqual([
      { day: "2026-07-06", score: 82, temperature_deviation: -0.2 },
    ]);
  });

  it("tolerates missing scores and skips malformed documents", () => {
    expect(
      filterScoreDocs([{ day: "2026-07-06" }, { score: 12 }, null, "junk"])
    ).toEqual([{ day: "2026-07-06", score: null }]);
    expect(
      filterReadinessDocs([{ day: "2026-07-06" }, { score: 12 }, null, "junk"])
    ).toEqual([
      { day: "2026-07-06", score: null, temperature_deviation: null },
    ]);
  });

  it("keeps only day/type/duration/lowest HR/HRV from sleep periods", () => {
    const filtered = filterSleepPeriodDocs([
      {
        day: "2026-07-06",
        type: "long_sleep",
        total_sleep_duration: 27000,
        lowest_heart_rate: 44,
        average_hrv: 41,
        average_heart_rate: 52, // must not leak
        heart_rate: { items: [50, 51] }, // must not leak
        hrv: { items: [38, 44] }, // must not leak
        bedtime_start: "2026-07-05T23:04:00+02:00", // must not leak
      },
    ]);
    expect(filtered).toEqual([
      {
        day: "2026-07-06",
        type: "long_sleep",
        total_sleep_seconds: 27000,
        lowest_heart_rate: 44,
        average_hrv: 41,
      },
    ]);
  });
});

function sleepPeriod(overrides: Partial<SleepPeriodDoc> = {}) {
  return {
    day: "2026-07-05",
    type: "long_sleep",
    total_sleep_seconds: 25200,
    lowest_heart_rate: null,
    average_hrv: null,
    ...overrides,
  };
}

const emptyRow = (date: string) => ({
  date,
  readiness: null,
  sleep: null,
  activity: null,
  total_sleep_seconds: null,
  resting_heart_rate: null,
  average_hrv: null,
  temperature_deviation: null,
});

describe("mergeHistory", () => {
  it("produces one row per date with nulls for missing data", () => {
    const rows = mergeHistory(
      "2026-07-04",
      "2026-07-06",
      [{ day: "2026-07-05", score: 80, temperature_deviation: 0.2 }],
      [{ day: "2026-07-05", score: 75 }],
      [],
      [sleepPeriod({ lowest_heart_rate: 52, average_hrv: 41 })]
    );
    expect(rows).toEqual([
      emptyRow("2026-07-04"),
      {
        date: "2026-07-05",
        readiness: 80,
        sleep: 75,
        activity: null,
        total_sleep_seconds: 25200,
        resting_heart_rate: 52,
        average_hrv: 41,
        temperature_deviation: 0.2,
      },
      emptyRow("2026-07-06"),
    ]);
  });

  it("sums multiple long_sleep periods and ignores naps", () => {
    const rows = mergeHistory(
      "2026-07-05",
      "2026-07-05",
      [],
      [],
      [],
      [
        sleepPeriod({ total_sleep_seconds: 20000 }),
        sleepPeriod({ total_sleep_seconds: 3000 }),
        sleepPeriod({ type: "sleep", total_sleep_seconds: 1800 }), // nap
      ]
    );
    expect(rows[0].total_sleep_seconds).toBe(23000);
  });

  it("takes the lowest HR across periods and HRV from the longest, ignoring naps", () => {
    const rows = mergeHistory(
      "2026-07-05",
      "2026-07-05",
      [],
      [],
      [],
      [
        sleepPeriod({ total_sleep_seconds: 20000, lowest_heart_rate: 48, average_hrv: 41 }),
        sleepPeriod({ total_sleep_seconds: 3000, lowest_heart_rate: 44, average_hrv: 60 }),
        sleepPeriod({ type: "sleep", total_sleep_seconds: 1800, lowest_heart_rate: 40, average_hrv: 90 }), // nap
      ]
    );
    expect(rows[0].resting_heart_rate).toBe(44);
    expect(rows[0].average_hrv).toBe(41);
  });
});

describe("latestRecord", () => {
  it("returns the most recent row that has any data", () => {
    const rows = mergeHistory(
      "2026-07-04",
      "2026-07-06",
      [{ day: "2026-07-05", score: 80, temperature_deviation: null }],
      [],
      [],
      []
    );
    expect(latestRecord(rows)?.date).toBe("2026-07-05");
  });

  it("counts a lone vital as data", () => {
    const rows = mergeHistory(
      "2026-07-04",
      "2026-07-06",
      [{ day: "2026-07-05", score: null, temperature_deviation: -0.3 }],
      [],
      [],
      []
    );
    expect(latestRecord(rows)?.date).toBe("2026-07-05");
  });

  it("returns null when the range is empty", () => {
    expect(latestRecord(mergeHistory("2026-07-04", "2026-07-06", [], [], [], []))).toBeNull();
  });
});
