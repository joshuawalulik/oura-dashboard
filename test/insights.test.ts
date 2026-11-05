/**
 * Baseline and pattern math: pure functions over DayRecord fixtures.
 * Every threshold is exercised from both sides — below it, silence.
 */
import { describe, it, expect } from "vitest";
import type { DayRecord } from "../src/filter";
import {
  computeBaselines,
  computePatterns,
  lowestReadinessInputs,
  MIN_BASELINE_DAYS,
} from "../src/insights";
import { mulberry32 } from "../src/prng";

/** Just the sentences that passed, which is what most of these tests check. */
function claims(history: DayRecord[]): string[] {
  return computePatterns(history)
    .filter((p) => p.status === "found")
    .map((p) => p.sentence);
}

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
    bedtime_minutes: null,
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

/** Seeded standard normal noise, so "random" fixtures are repeatable. */
function gaussian(seed: number): () => number {
  const rand = mulberry32(seed);
  return () =>
    Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

describe("computePatterns: sleep length vs next-night HRV", () => {
  /** Long nights are followed by high HRV, short nights by low HRV. */
  function correlated(count: number, gaps: Set<number> = new Set()): DayRecord[] {
    const longAt = (i: number) => i % 2 === 0 || i % 5 === 0;
    return datesEnding(LATEST, count).map((date, i) => {
      if (gaps.has(i)) return day(date); // a missing day: ring never synced
      return day(date, {
        total_sleep_seconds: (longAt(i) ? 8 : 6) * 3600 + i * 60,
        average_hrv: i === 0 ? null : (longAt(i - 1) ? 50 : 38) + (i % 3),
      });
    });
  }

  it("states the lagged correlation via a median split with the night count", () => {
    const sentences = claims(correlated(40));
    const sleepSentence = sentences.find((s) => s.includes("After nights longer than"));
    expect(sleepSentence).toBeDefined();
    expect(sleepSentence).toContain("next night's HRV ran higher");
    expect(sleepSentence).toContain(" ms ");
    // 40 days give 39 consecutive pairs.
    expect(sleepSentence).toContain("(39 nights)");
  });

  it("only pairs consecutive calendar days across a gap in the history", () => {
    // Every third day missing: a pair needs days i and i+1 both present.
    const gaps = new Set(Array.from({ length: 14 }, (_, n) => n * 3));
    const present = correlated(42, gaps).filter((r) => r.total_sleep_seconds !== null);
    const sentences = claims(present);
    const sleepSentence = sentences.find((s) => s.includes("After nights longer than"));
    // 28 days remain in 14 runs of two: one pair per run, not 27.
    expect(sleepSentence).toContain("(14 nights)");
  });

  it("stays silent below the minimum paired days", () => {
    // 40-day window but only 13 days carry data — under the 14-pair floor.
    const gaps = new Set(Array.from({ length: 27 }, (_, i) => i));
    const sentences = claims(correlated(40, gaps));
    expect(sentences.find((s) => s.includes("After nights longer than"))).toBeUndefined();
  });

  it("stays silent when sleep and the next night's HRV are unrelated", () => {
    const noise = gaussian(7);
    const history = datesEnding(LATEST, 60).map((date) =>
      day(date, {
        total_sleep_seconds: Math.round(7 * 3600 + 2400 * noise()),
        average_hrv: Math.round(45 + 8 * noise()),
      })
    );
    const sentences = claims(history);
    expect(sentences.find((s) => s.includes("After nights longer than"))).toBeUndefined();
  });

  it("makes no claim from same-morning readiness, which contains the sleep", () => {
    // Readiness tracks sleep perfectly, but nothing lagged or measured does.
    const history = datesEnding(LATEST, 60).map((date, i) => {
      const long = i % 2 === 0;
      return day(date, {
        total_sleep_seconds: (long ? 8 : 6) * 3600,
        readiness: long ? 85 : 65,
      });
    });
    const joined = claims(history).join(" ");
    expect(joined).not.toContain("nights longer than");
  });
});

describe("computePatterns: bedtime vs that night's HRV", () => {
  const find = (history: DayRecord[]) =>
    claims(history).find((s) => s.includes("Nights starting after"));

  it("names the median bedtime as a clock time, either side of midnight", () => {
    const history = datesEnding(LATEST, 60).map((date, i) => {
      const late = i % 2 === 0 || i % 7 === 0;
      return day(date, {
        bedtime_minutes: (late ? 40 : -80) + (i % 5),
        average_hrv: (late ? 38 : 50) + (i % 3),
      });
    });
    const sentence = find(history);
    expect(sentence).toMatch(/after \d{1,2}:\d{2} (am|pm) ran lower HRV/);
    expect(sentence).toContain("on earlier nights (60 nights)");
  });

  it("stays silent on unrelated bedtimes and without enough nights", () => {
    const noise = gaussian(11);
    const unrelated = datesEnding(LATEST, 60).map((date) =>
      day(date, {
        bedtime_minutes: Math.round(-30 + 45 * noise()),
        average_hrv: Math.round(45 + 8 * noise()),
      })
    );
    expect(find(unrelated)).toBeUndefined();

    const sparse = datesEnding(LATEST, 13).map((date, i) =>
      day(date, { bedtime_minutes: i % 2 ? 40 : -80, average_hrv: i % 2 ? 38 : 50 })
    );
    expect(find(sparse)).toBeUndefined();
  });
});

describe("computePatterns: showing the math", () => {
  const unrelated = (seed: number) => {
    const noise = gaussian(seed);
    return datesEnding(LATEST, 90).map((date) =>
      day(date, {
        total_sleep_seconds: Math.round(7 * 3600 + 2400 * noise()),
        average_hrv: Math.round(45 + 8 * noise()),
        readiness: Math.round(75 + 7 * noise()),
        bedtime_minutes: Math.round(-30 + 45 * noise()),
      })
    );
  };
  const find = (history: DayRecord[], id: string) =>
    computePatterns(history).find((p) => p.id === id);
  const row = (id: string, history: DayRecord[], label: string) =>
    find(history, id)?.math.find((m) => m.label === label)?.value;

  it("reports a tested idea as no clear link, in neutral words, with its count", () => {
    const result = find(unrelated(5), "bedtime_hrv");
    expect(result?.status).toBe("no_link");
    expect(result?.sentence).toBe(
      "No clear link between bedtime and that night's HRV (90 nights)."
    );
    expect(result?.math.map((m) => m.label)).toEqual([
      "Compared",
      "Effect",
      "Minimum",
      "Shuffle test",
    ]);
  });

  it("says the shuffle test wasn't run when the effect is under the minimum", () => {
    const flat = datesEnding(LATEST, 56).map((date) =>
      day(date, { total_sleep_seconds: 7 * 3600 })
    );
    expect(row("weekend_sleep", flat, "Effect")).toBe("0 minutes");
    expect(row("weekend_sleep", flat, "Shuffle test")).toContain("Not run");
  });

  it("gives the real count and p-value for a pattern that passed", () => {
    const history = datesEnding(LATEST, 56).map((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day(date, { readiness: dow === 1 ? 62 : 80 });
    });
    const result = find(history, "weekday_readiness");
    expect(result?.status).toBe("found");
    expect(row("weekday_readiness", history, "Effect")).toContain("18.0 points");
    expect(row("weekday_readiness", history, "Shuffle test")).toMatch(
      /^0 of 499 shuffles matched it \(p = 0\.002, needs 0\.01 or less\)$/
    );
  });

  it("says too many shuffles matched when a big-enough effect fails the test", () => {
    // Real noise, with readiness spread enough to clear the 5-point gate.
    const history = datesEnding(LATEST, 21).map((date, i) =>
      day(date, { readiness: 60 + ((i * 7) % 11) * 3 })
    );
    expect(find(history, "weekday_readiness")?.status).toBe("no_link");
    expect(row("weekday_readiness", history, "Shuffle test")).toContain(
      "Too many shuffles matched"
    );
  });

  it("stays silent on anything without enough data to test", () => {
    const sparse = datesEnding(LATEST, 6).map((date) => day(date, { readiness: 70 }));
    expect(computePatterns(sparse)).toEqual([]);
  });

  it("uses no second person in any no-link sentence", () => {
    const sentences = computePatterns(unrelated(9)).map((p) => p.sentence);
    expect(sentences.length).toBe(4);
    for (const sentence of sentences) expect(sentence).not.toMatch(/\b(you|your)\b/i);
  });
});

describe("lowestReadinessInputs", () => {
  it("returns the two lowest under 70, lowest first, labelled", () => {
    expect(
      lowestReadinessInputs({
        hrv_balance: 58,
        sleep_balance: 64,
        recovery_index: 41,
        previous_night: 90,
      })
    ).toEqual([
      { name: "Recovery index", score: 41 },
      { name: "HRV balance", score: 58 },
    ]);
  });

  it("is empty when nothing sits low, or nothing was sent", () => {
    expect(lowestReadinessInputs({ hrv_balance: 70, sleep_balance: 95 })).toEqual([]);
    expect(lowestReadinessInputs({})).toEqual([]);
    expect(lowestReadinessInputs(undefined)).toEqual([]);
  });

  it("ignores keys outside the allowlist", () => {
    expect(lowestReadinessInputs({ made_up: 5 })).toEqual([]);
  });
});

describe("computePatterns: must beat chance", () => {
  it("rarely states a pattern from history with no real effect in it", () => {
    // The weekday rule alone used to fire on about half of histories like these.
    const runs = 200;
    let fired = 0;
    for (let seed = 1; seed <= runs; seed++) {
      const noise = gaussian(seed);
      const history = datesEnding(LATEST, 90).map((date) =>
        day(date, {
          readiness: Math.round(75 + 7 * noise()),
          total_sleep_seconds: Math.round(7 * 3600 + 2400 * noise()),
          average_hrv: Math.round(45 + 8 * noise()),
          bedtime_minutes: Math.round(-30 + 45 * noise()),
        })
      );
      if (claims(history).length > 0) fired++;
    }
    // Four tests at p < 0.01 predicts ~4%; 7% leaves room for sampling error.
    expect(fired / runs).toBeLessThan(0.07);
  });

  it("is repeatable: the same history always gives the same sentences", () => {
    const noise = gaussian(42);
    const history = datesEnding(LATEST, 90).map((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day(date, { readiness: Math.round((dow === 1 ? 62 : 78) + 6 * noise()) });
    });
    expect(computePatterns(history)).toEqual(computePatterns(history));
    expect(claims(history).join(" ")).toContain("Mondays");
  });
});

describe("computePatterns: day-of-week and weekend effects", () => {
  it("names the lowest and highest readiness weekdays when the gap is real", () => {
    // 8 full weeks: Mondays at 62, every other day at 80.
    const history = datesEnding(LATEST, 56).map((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day(date, { readiness: dow === 1 ? 62 : 80 });
    });
    const sentences = claims(history);
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
    const sentences = claims(history);
    const weekendSentence = sentences.find((s) => s.includes("Weekend nights"));
    expect(weekendSentence).toBeDefined();
    expect(weekendSentence).toContain("45 minutes longer");
  });

  it("addresses nobody: both viewers read the same sentences", () => {
    // Everything fires here, so every sentence template gets checked.
    const history = datesEnding(LATEST, 56).map((date, i) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const longAt = (n: number) => n % 2 === 0;
      return day(date, {
        readiness: dow === 1 ? 62 : 80,
        total_sleep_seconds:
          (longAt(i) ? 7.5 : 6.5) * 3600 + (dow === 0 || dow === 6 ? 2700 : 0),
        average_hrv: longAt(i - 1) ? 50 : 38,
        bedtime_minutes: longAt(i - 1) ? -80 : 40,
      });
    });
    const sentences = claims(history);
    expect(sentences).toHaveLength(4);
    for (const sentence of sentences) expect(sentence).not.toMatch(/\b(you|your)\b/i);
  });

  it("rolls 59.5+ minutes into the next hour instead of printing 60m", () => {
    const history = datesEnding(LATEST, 56).map((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      return day(date, { total_sleep_seconds: weekend ? 8 * 3600 - 10 : 7 * 3600 });
    });
    const sentence = claims(history).find((s) => s.includes("Weekend nights"));
    expect(sentence).toContain("8h 00m");
  });

  it("returns an empty list for an empty or hopelessly sparse history", () => {
    expect(claims([])).toEqual([]);
    const sparse = datesEnding(LATEST, 6).map((date, i) =>
      day(date, { readiness: 70 + i, total_sleep_seconds: 7 * 3600 })
    );
    expect(claims(sparse)).toEqual([]);
  });
});
