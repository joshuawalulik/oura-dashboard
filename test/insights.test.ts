/**
 * Baseline and pattern math: pure functions over DayRecord fixtures.
 * Every threshold is exercised from both sides — below it, silence.
 */
import { describe, it, expect } from "vitest";
import type { DayRecord } from "../src/filter";
import {
  computeBaselines,
  computePatterns,
  MIN_BASELINE_DAYS,
} from "../src/insights";

/** A DayRecord with nulls everywhere except the given fields. */
function day(date: string, fields: Partial<DayRecord> = {}): DayRecord {
  return {
    date,
    readiness: null,
    sleep: null,
    activity: null,
    total_sleep_seconds: null,
    resting_heart_rate: null,
    average_hrv: null,
    temperature_deviation: null,
    ...fields,
  };
}

/** `count` consecutive days ending the day before `endExclusive`. */
function datesEnding(endExclusive: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(`${endExclusive}T00:00:00Z`);
  for (let i = count; i >= 1; i--) {
    const c = new Date(d);
    c.setUTCDate(c.getUTCDate() - i);
    dates.push(c.toISOString().slice(0, 10));
  }
  return dates;
}

const LATEST = "2026-11-04";

describe("computeBaselines", () => {
  it("computes mean, sample σ, and z against fixtures", () => {
    // 14 days at 40 and 14 at 60: mean 50, sample σ = sqrt(2800/27) ≈ 10.18.
    const history = datesEnding(LATEST, 28).map((date, i) =>
      day(date, { readiness: i < 14 ? 40 : 60 })
    );
    const latest = day(LATEST, { readiness: 60 });

    const baselines = computeBaselines(history, latest);
    expect(baselines).not.toBeNull();
    const stat = baselines!.metrics.readiness!;
    expect(baselines!.window_days).toBe(28);
    expect(stat.mean).toBe(50);
    expect(stat.sd).toBe(10.2);
    expect(stat.n).toBe(28);
    // z uses the unrounded σ: 10 / 10.1835 = 0.98.
    expect(stat.z).toBe(0.98);
  });

  it("returns z = null when σ is zero, keeping the mean", () => {
    const history = datesEnding(LATEST, 28).map((date) =>
      day(date, { sleep: 75 })
    );
    const baselines = computeBaselines(history, day(LATEST, { sleep: 80 }));
    const stat = baselines!.metrics.sleep!;
    expect(stat.mean).toBe(75);
    expect(stat.sd).toBe(0);
    expect(stat.z).toBeNull();
  });

  it("returns z = null when the latest value is missing", () => {
    const history = datesEnding(LATEST, 28).map((date, i) =>
      day(date, { average_hrv: 40 + (i % 5) })
    );
    const baselines = computeBaselines(history, day(LATEST, { readiness: 80 }));
    expect(baselines!.metrics.average_hrv!.z).toBeNull();
  });

  it("omits metrics with fewer than the minimum days, null when none qualify", () => {
    const sparse = datesEnding(LATEST, MIN_BASELINE_DAYS - 1).map((date, i) =>
      day(date, { readiness: 60 + i })
    );
    expect(computeBaselines(sparse, day(LATEST, { readiness: 70 }))).toBeNull();

    // One metric qualifies, the other doesn't: only the qualifying one appears.
    const mixed = datesEnding(LATEST, 28).map((date, i) =>
      day(date, {
        readiness: 60 + (i % 7),
        average_hrv: i < 5 ? 40 : null,
      })
    );
    const baselines = computeBaselines(mixed, day(LATEST, { readiness: 64 }));
    expect(baselines!.metrics.readiness).toBeDefined();
    expect(baselines!.metrics.average_hrv).toBeUndefined();
  });

  it("uses only the 28 days before the latest day — older rows are ignored", () => {
    // 28 in-window days at 50, plus 30 older days at 90 that must not count.
    const older = datesEnding("2026-10-07", 30).map((date) =>
      day(date, { readiness: 90 })
    );
    const window = datesEnding(LATEST, 28).map((date, i) =>
      day(date, { readiness: i % 2 === 0 ? 45 : 55 })
    );
    const baselines = computeBaselines(
      [...older, ...window],
      day(LATEST, { readiness: 50 })
    );
    expect(baselines!.metrics.readiness!.mean).toBe(50);
    expect(baselines!.metrics.readiness!.n).toBe(28);
  });

  it("returns null without a latest record", () => {
    const history = datesEnding(LATEST, 28).map((d2) => day(d2, { readiness: 50 }));
    expect(computeBaselines(history, null)).toBeNull();
  });
});

describe("computePatterns: sleep length vs readiness", () => {
  /** Perfectly correlated: long nights score high, short nights low. */
  function correlated(count: number, gaps: Set<number> = new Set()): DayRecord[] {
    return datesEnding(LATEST, count).map((date, i) => {
      if (gaps.has(i)) return day(date); // a missing day: ring never synced
      const long = i % 2 === 0;
      return day(date, {
        total_sleep_seconds: (long ? 8 : 6) * 3600 + i * 60,
        readiness: (long ? 85 : 65) + (i % 3),
      });
    });
  }

  it("states the correlation via a median split with the night count", () => {
    const sentences = computePatterns(correlated(40));
    const sleepSentence = sentences.find((s) => s.includes("Nights longer than"));
    expect(sleepSentence).toBeDefined();
    expect(sleepSentence).toContain("higher readiness");
    expect(sleepSentence).toContain("(40 nights)");
  });

  it("counts only paired days when the window has missing days", () => {
    // 10 of 40 days have no data at all: n must say 30, not 40.
    const gaps = new Set([0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
    const sentences = computePatterns(correlated(40, gaps));
    const sleepSentence = sentences.find((s) => s.includes("Nights longer than"));
    expect(sleepSentence).toContain("(30 nights)");
  });

  it("stays silent below the minimum paired days", () => {
    // 40-day window but only 13 days carry data — under the 14-pair floor.
    const gaps = new Set(Array.from({ length: 27 }, (_, i) => i));
    const sentences = computePatterns(correlated(40, gaps));
    expect(sentences.find((s) => s.includes("Nights longer than"))).toBeUndefined();
  });

  it("stays silent when sleep and readiness are uncorrelated", () => {
    const history = datesEnding(LATEST, 40).map((date, i) =>
      day(date, {
        // Sleep length cycles independently of readiness.
        total_sleep_seconds: (6 + (i % 5)) * 3600,
        readiness: 60 + ((i * 11) % 7),
      })
    );
    const sentences = computePatterns(history);
    expect(sentences.find((s) => s.includes("Nights longer than"))).toBeUndefined();
  });
});

describe("computePatterns: day-of-week and weekend effects", () => {
  it("names the lowest and highest readiness weekdays when the gap is real", () => {
    // 8 full weeks: Mondays at 62, every other day at 80.
    const history = datesEnding(LATEST, 56).map((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day(date, { readiness: dow === 1 ? 62 : 80 });
    });
    const sentences = computePatterns(history);
    const weekday = sentences.find((s) => s.includes("Readiness runs lowest"));
    expect(weekday).toBeDefined();
    expect(weekday).toContain("Mondays");
    expect(weekday).toContain("avg 62");
  });

  it("reports the weekend sleep gap when it clears ~20 minutes", () => {
    // Weekends sleep exactly 45 minutes longer than weekdays.
    const history = datesEnding(LATEST, 56).map((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      return day(date, { total_sleep_seconds: 7 * 3600 + (weekend ? 45 * 60 : 0) });
    });
    const sentences = computePatterns(history);
    const weekendSentence = sentences.find((s) => s.includes("weekend nights"));
    expect(weekendSentence).toBeDefined();
    expect(weekendSentence).toContain("45 minutes longer");
  });

  it("returns an empty list for an empty or hopelessly sparse history", () => {
    expect(computePatterns([])).toEqual([]);
    const sparse = datesEnding(LATEST, 6).map((date, i) =>
      day(date, { readiness: 70 + i, total_sleep_seconds: 7 * 3600 })
    );
    expect(computePatterns(sparse)).toEqual([]);
  });
});
