import { describe, it, expect } from "vitest";
import {
  filterScoreDocs,
  filterSleepPeriodDocs,
  mergeHistory,
  latestRecord,
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

  it("tolerates missing scores and skips malformed documents", () => {
    expect(
      filterScoreDocs([{ day: "2026-07-06" }, { score: 12 }, null, "junk"])
    ).toEqual([{ day: "2026-07-06", score: null }]);
  });

  it("keeps only day/type/duration from sleep periods", () => {
    const filtered = filterSleepPeriodDocs([
      {
        day: "2026-07-06",
        type: "long_sleep",
        total_sleep_duration: 27000,
        average_heart_rate: 52, // must not leak
        heart_rate: { items: [50, 51] }, // must not leak
      },
    ]);
    expect(filtered).toEqual([
      { day: "2026-07-06", type: "long_sleep", total_sleep_seconds: 27000 },
    ]);
  });
});

describe("mergeHistory", () => {
  it("produces one row per date with nulls for missing data", () => {
    const rows = mergeHistory(
      "2026-07-04",
      "2026-07-06",
      [{ day: "2026-07-05", score: 80 }],
      [{ day: "2026-07-05", score: 75 }],
      [],
      [{ day: "2026-07-05", type: "long_sleep", total_sleep_seconds: 25200 }]
    );
    expect(rows).toEqual([
      { date: "2026-07-04", readiness: null, sleep: null, activity: null, total_sleep_seconds: null },
      { date: "2026-07-05", readiness: 80, sleep: 75, activity: null, total_sleep_seconds: 25200 },
      { date: "2026-07-06", readiness: null, sleep: null, activity: null, total_sleep_seconds: null },
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
        { day: "2026-07-05", type: "long_sleep", total_sleep_seconds: 20000 },
        { day: "2026-07-05", type: "long_sleep", total_sleep_seconds: 3000 },
        { day: "2026-07-05", type: "sleep", total_sleep_seconds: 1800 }, // nap
      ]
    );
    expect(rows[0].total_sleep_seconds).toBe(23000);
  });
});

describe("latestRecord", () => {
  it("returns the most recent row that has any data", () => {
    const rows = mergeHistory(
      "2026-07-04",
      "2026-07-06",
      [{ day: "2026-07-05", score: 80 }],
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
