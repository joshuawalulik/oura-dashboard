/**
 * D1 ingest: upsert idempotency and self-healing, the nightly scheduled
 * handler, the owner-only backfill route, and insights on /api/dashboard.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  SELF,
  env,
  fetchMock,
  createExecutionContext,
} from "cloudflare:test";
import { makeTestKeys, accessPayload, type TestKeys } from "./helpers";
import { TOKENS_KV_KEY } from "../src/oura";
import { upsertDays, readDays } from "../src/store";
import worker from "../src/index";
import type { DayRecord } from "../src/filter";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;

let keys: TestKeys;
let ownerJwt: string;
let partnerJwt: string;

beforeAll(async () => {
  keys = await makeTestKeys();
  ownerJwt = await keys.sign(accessPayload({ email: "owner@example.com" }));
  partnerJwt = await keys.sign(accessPayload({ email: "partner@example.com" }));

  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get("https://testteam.cloudflareaccess.com")
    .intercept({ path: "/cdn-cgi/access/certs" })
    .reply(200, keys.jwks)
    .persist();
  await fetch("https://testteam.cloudflareaccess.com/cdn-cgi/access/certs");
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

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

async function connectTokens() {
  await testEnv.OURA_KV.put(
    TOKENS_KV_KEY,
    JSON.stringify({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_at: Date.now() + 12 * 3600 * 1000,
    })
  );
}

/** Mocks the four Oura collections the ingest fetches, once each. */
function mockOuraDay(dateIso: string, readiness: number) {
  const docs = (body: object) => ({ data: [body], next_token: null });
  const get = (prefix: string, body: object) =>
    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: (p: string) => p.startsWith(prefix) })
      .reply(200, docs(body))
      .times(1);
  get("/v2/usercollection/daily_readiness", {
    day: dateIso,
    score: readiness,
    temperature_deviation: 0.1,
  });
  get("/v2/usercollection/daily_sleep", { day: dateIso, score: 80 });
  get("/v2/usercollection/daily_activity", { day: dateIso, score: 70 });
  get("/v2/usercollection/sleep", {
    day: dateIso,
    type: "long_sleep",
    total_sleep_duration: 26400,
    lowest_heart_rate: 50,
    average_hrv: 40,
    bedtime_start: `${dateIso}T00:30:00-05:00`,
  });
}

describe("upsertDays", () => {
  it("is idempotent: the same rows twice leave one identical row set", async () => {
    const rows = [
      day("2026-10-01", { readiness: 80, sleep: 75, total_sleep_seconds: 25200 }),
      day("2026-10-02", { readiness: 70, average_hrv: 42.5 }),
    ];
    expect(await upsertDays(testEnv.OURA_DB, rows)).toBe(2);
    expect(await upsertDays(testEnv.OURA_DB, rows)).toBe(2);

    const stored = await readDays(testEnv.OURA_DB, "2026-10-01", "2026-10-02");
    expect(stored).toEqual(rows);
  });

  it("self-heals: a later fetch fills fields a late ring sync was missing", async () => {
    await upsertDays(testEnv.OURA_DB, [day("2026-10-03", { activity: 60 })]);
    await upsertDays(testEnv.OURA_DB, [
      day("2026-10-03", { readiness: 85, sleep: 78 }),
    ]);

    const [stored] = await readDays(testEnv.OURA_DB, "2026-10-03", "2026-10-03");
    expect(stored).toEqual(
      day("2026-10-03", { readiness: 85, sleep: 78, activity: 60 })
    );
  });

  it("never erases: an incoming null keeps the stored value", async () => {
    await upsertDays(testEnv.OURA_DB, [day("2026-10-04", { readiness: 88 })]);
    // A partial fetch that saw sleep but not readiness must not null readiness.
    await upsertDays(testEnv.OURA_DB, [day("2026-10-04", { sleep: 72 })]);

    const [stored] = await readDays(testEnv.OURA_DB, "2026-10-04", "2026-10-04");
    expect(stored.readiness).toBe(88);
    expect(stored.sleep).toBe(72);
  });

  it("skips all-null rows (the merge's empty lookahead day)", async () => {
    const written = await upsertDays(testEnv.OURA_DB, [
      day("2026-10-05", { readiness: 77 }),
      day("2026-10-06"), // no data at all
    ]);
    expect(written).toBe(1);
    expect(await readDays(testEnv.OURA_DB, "2026-10-05", "2026-10-07")).toHaveLength(1);
  });
});

describe("scheduled ingest", () => {
  const controller = {
    scheduledTime: Date.now(),
    cron: "0 13 * * *",
    noRetry() {},
  } as ScheduledController;

  it("writes the recent window into D1", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);
    mockOuraDay(today, 91);

    await worker.scheduled(controller, testEnv, createExecutionContext());

    const stored = await readDays(testEnv.OURA_DB, today, today);
    expect(stored).toEqual([
      day(today, {
        readiness: 91,
        sleep: 80,
        activity: 70,
        total_sleep_seconds: 26400,
        resting_heart_rate: 50,
        average_hrv: 40,
        temperature_deviation: 0.1,
        bedtime_minutes: 30,
      }),
    ]);
  });

  it("is a no-op (not a crash) when Oura isn't connected", async () => {
    await expect(
      worker.scheduled(controller, testEnv, createExecutionContext())
    ).resolves.toBeUndefined();
    const { results } = await testEnv.OURA_DB.prepare(
      "SELECT COUNT(*) AS n FROM days"
    ).all<{ n: number }>();
    expect(results[0].n).toBe(0);
  });

  it("skips entirely in demo mode and without a D1 binding", async () => {
    const demoEnv = { ...testEnv, DEMO_MODE: "1" } as Env;
    await expect(
      worker.scheduled(controller, demoEnv, createExecutionContext())
    ).resolves.toBeUndefined();

    const dbLess = { ...testEnv, OURA_DB: undefined } as unknown as Env;
    await expect(
      worker.scheduled(controller, dbLess, createExecutionContext())
    ).resolves.toBeUndefined();
  });
});

describe("/api/ingest", () => {
  it("is owner-only", async () => {
    const res = await SELF.fetch("https://dashboard.test/api/ingest", {
      headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a cross-origin request (CSRF), even from the owner", async () => {
    // No Oura mocks registered: a rejected request must touch nothing.
    const res = await SELF.fetch("https://dashboard.test/api/ingest?backfill=365", {
      headers: {
        "Cf-Access-Jwt-Assertion": ownerJwt,
        Origin: "https://evil.example",
      },
    });
    expect(res.status).toBe(403);
  });

  it("accepts a same-origin Origin header", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);
    mockOuraDay(today, 76);
    const res = await SELF.fetch("https://dashboard.test/api/ingest", {
      headers: {
        "Cf-Access-Jwt-Assertion": ownerJwt,
        Origin: "https://dashboard.test",
      },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a malformed or oversized backfill", async () => {
    for (const bad of ["0", "-3", "1.5", "banana", "9001"]) {
      const res = await SELF.fetch(
        `https://dashboard.test/api/ingest?backfill=${bad}`,
        { headers: { "Cf-Access-Jwt-Assertion": ownerJwt } }
      );
      expect(res.status).toBe(400);
    }
  });

  it("backfills the requested range into D1 and reports what it wrote", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);
    mockOuraDay(today, 84);

    const res = await SELF.fetch(
      "https://dashboard.test/api/ingest?backfill=365",
      { headers: { "Cf-Access-Jwt-Assertion": ownerJwt } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.written).toBe(1); // only the mocked day had data

    const stored = await readDays(testEnv.OURA_DB, today, today);
    expect(stored[0].readiness).toBe(84);
  });

  it("returns 409 when Oura isn't connected", async () => {
    const res = await SELF.fetch("https://dashboard.test/api/ingest", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_connected" });
  });
});

/** Days ending at `end` (inclusive), oldest first. */
function daysEnding(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (count - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

describe("patterns refresh during ingest", () => {
  const today = new Date().toISOString().slice(0, 10);

  /** Weekends run long in the older days; the latest 90 are perfectly flat. */
  async function seedOldWeekendGap() {
    await upsertDays(
      testEnv.OURA_DB,
      daysEnding(today, 200).map((date, i) => {
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        const weekend = dow === 0 || dow === 6;
        return day(date, {
          total_sleep_seconds: 7 * 3600 + (i < 110 && weekend ? 5400 : 0),
        });
      })
    );
  }

  it("the nightly run saves sentences, drawing on history past 90 days", async () => {
    await connectTokens();
    await seedOldWeekendGap();
    mockOuraDay(today, 88);

    await worker.scheduled(
      { scheduledTime: Date.now(), cron: "0 13 * * *" } as ScheduledController,
      testEnv,
      createExecutionContext()
    );

    expect(await testEnv.OURA_KV.get("patterns")).toContain("Weekend nights");
  });

  it("the owner's manual ingest refreshes them too", async () => {
    await connectTokens();
    await seedOldWeekendGap();
    mockOuraDay(today, 88);

    const res = await SELF.fetch("https://dashboard.test/api/ingest", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    expect(res.status).toBe(200);
    expect(await testEnv.OURA_KV.get("patterns")).toContain("Weekend nights");
  });

  it("overwrites old sentences when the history no longer earns them", async () => {
    await connectTokens();
    await testEnv.OURA_KV.put("patterns", JSON.stringify(["A stale sentence."]));
    mockOuraDay(today, 88);

    await worker.scheduled(
      { scheduledTime: Date.now(), cron: "0 13 * * *" } as ScheduledController,
      testEnv,
      createExecutionContext()
    );

    expect(await testEnv.OURA_KV.get("patterns")).toBe("[]");
  });
});

describe("/api/dashboard insights", () => {
  it("serves baselines from D1 and the patterns the last ingest saved", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);

    // Seed 56 days of history before today: readiness alternating around 70,
    // Mondays dragged low, weekends sleeping long, and each night's HRV set by
    // how long the night before it ran.
    const seed: DayRecord[] = [];
    for (let i = 56; i >= 1; i--) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const long = i % 2 === 0;
      seed.push(
        day(date, {
          readiness: dow === 1 ? 58 : long ? 84 : 66,
          sleep: 75,
          total_sleep_seconds: (long ? 8.2 : 6.3) * 3600 + (weekend ? 2700 : 0),
          resting_heart_rate: 52,
          average_hrv: (i + 1) % 2 === 0 ? 52 : 38,
        })
      );
    }
    await upsertDays(testEnv.OURA_DB, seed);
    mockOuraDay(today, 91);
    const ingested = await SELF.fetch("https://dashboard.test/api/ingest", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    expect(ingested.status).toBe(200);

    mockOuraDay(today, 91);
    const res = await SELF.fetch("https://dashboard.test/api/dashboard", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.baselines.window_days).toBe(28);
    const readiness = body.baselines.metrics.readiness;
    expect(readiness.n).toBeGreaterThanOrEqual(14);
    expect(typeof readiness.mean).toBe("number");
    expect(typeof readiness.sd).toBe("number");
    expect(typeof readiness.z).toBe("number");
    // Today's 91 sits well above the seeded ~70 mean.
    expect(readiness.z).toBeGreaterThan(1);

    const found = body.patterns.filter((p: any) => p.status === "found");
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.map((p: any) => p.sentence).join(" ")).toContain(
      "After nights longer than"
    );
    expect(found[0].math.length).toBeGreaterThan(0);
  });

  it("shows no sentences until an ingest has computed them", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);
    await upsertDays(
      testEnv.OURA_DB,
      daysEnding(today, 56).map((date) => {
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        return day(date, { readiness: dow === 1 ? 58 : 80 });
      })
    );
    mockOuraDay(today, 88);

    const res = await SELF.fetch("https://dashboard.test/api/dashboard", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    const body = (await res.json()) as Record<string, any>;
    expect(body.baselines).not.toBeNull();
    expect(body.patterns).toEqual([]);
  });

  it("skips plain sentences saved by an older build until the next ingest", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);
    await testEnv.OURA_KV.put("patterns", JSON.stringify(["An older sentence."]));
    mockOuraDay(today, 88);

    const res = await SELF.fetch("https://dashboard.test/api/dashboard", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    const body = (await res.json()) as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.patterns).toEqual([]);
  });

  it("degrades to no insights when D1 is empty", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);
    mockOuraDay(today, 88);

    const res = await SELF.fetch("https://dashboard.test/api/dashboard", {
      headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.connected).toBe(true);
    expect(body.baselines).toBeNull();
    expect(body.patterns).toEqual([]);
  });
});
