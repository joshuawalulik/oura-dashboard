/**
 * Demo mode: the public deployment serves synthetic data with no Access
 * check — and demo mode must be inert everywhere else.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";
import { demoHistory } from "../src/demo";
import { computeBaselines, computePatterns } from "../src/insights";
import { latestRecord } from "../src/filter";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;
// GIT_SHA set: demo mode must work on a deployed build (unlike the dev
// bypass, which GIT_SHA deliberately disables).
const demoEnv: Env = { ...testEnv, DEMO_MODE: "1", GIT_SHA: "deadbeefcafe" };

function demoFetch(path: string, init?: RequestInit) {
  return app.fetch(new Request(`https://demo.test${path}`, init), demoEnv);
}

describe("demo API", () => {
  it("serves the dashboard without any Access JWT", async () => {
    const res = await demoFetch("/api/dashboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.connected).toBe(true);
    expect(body.demo).toBe(true);
    expect(body.viewer_is_owner).toBe(false);
    expect(body.version).toBe("deadbee");
    expect(body.history.days).toBe(7);
    expect(body.history.data).toHaveLength(7);
    expect(body.summary.date).toBe(body.history.data[6].date);
  });

  it("serves the same baselines + patterns payload shape as the real API", async () => {
    const res = await demoFetch("/api/dashboard");
    const body = (await res.json()) as Record<string, any>;

    // Synthetic history is dense, so baselines always qualify.
    expect(body.baselines.window_days).toBe(28);
    for (const metric of ["readiness", "sleep", "activity"]) {
      const stat = body.baselines.metrics[metric];
      expect(stat.n).toBeGreaterThanOrEqual(14);
      expect(typeof stat.mean).toBe("number");
      expect(typeof stat.sd).toBe("number");
      expect(typeof stat.z).toBe("number");
    }
    expect(Array.isArray(body.patterns)).toBe(true);
    for (const sentence of body.patterns) expect(typeof sentence).toBe("string");
  });

  it("serves 30-day history with plausible, in-range values", async () => {
    const res = await demoFetch("/api/history?days=30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.data).toHaveLength(30);
    for (const day of body.data) {
      expect(day.readiness).toBeGreaterThanOrEqual(0);
      expect(day.readiness).toBeLessThanOrEqual(100);
      expect(day.sleep).toBeGreaterThanOrEqual(0);
      expect(day.sleep).toBeLessThanOrEqual(100);
      expect(day.activity).toBeGreaterThanOrEqual(0);
      expect(day.activity).toBeLessThanOrEqual(100);
      expect(day.total_sleep_seconds).toBeGreaterThan(3 * 3600);
      expect(day.total_sleep_seconds).toBeLessThan(11 * 3600);
      expect(day.resting_heart_rate).toBeGreaterThanOrEqual(40);
      expect(day.resting_heart_rate).toBeLessThanOrEqual(70);
      expect(day.average_hrv).toBeGreaterThan(10);
      expect(day.temperature_deviation).toBeGreaterThan(-1);
      expect(day.temperature_deviation).toBeLessThan(1);
    }
  });

  it("answers /api/status and /api/summary without auth", async () => {
    const status = await demoFetch("/api/status");
    expect(status.status).toBe(200);
    expect(((await status.json()) as any).demo).toBe(true);

    const summary = await demoFetch("/api/summary");
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as Record<string, any>;
    expect(typeof body.readiness).toBe("number");
    expect(typeof body.last_sync).toBe("string");
  });

  it("is deterministic: repeated requests return identical data", async () => {
    const first = await (await demoFetch("/api/history?days=30")).text();
    const second = await (await demoFetch("/api/history?days=30")).text();
    expect(second).toBe(first);
  });

  it("never touches KV, D1, or upstream Oura", async () => {
    // The demo deployment has no KV and no D1 binding at all; prove the
    // handlers survive without either (an accidental touch would throw here).
    const bindingLess = {
      ...demoEnv,
      OURA_KV: undefined,
      OURA_DB: undefined,
    } as unknown as Env;
    for (const path of ["/api/dashboard", "/api/history", "/api/summary", "/api/status"]) {
      const res = await app.fetch(new Request(`https://demo.test${path}`), bindingLess);
      expect(res.status).toBe(200);
    }
    // The ingest route must refuse the anonymous demo viewer before it could
    // ever reach a binding.
    const ingest = await app.fetch(
      new Request("https://demo.test/api/ingest?backfill=365"),
      bindingLess
    );
    expect(ingest.status).toBe(403);
  });

  it("has no OAuth routes: /auth/* is 404, not 403", async () => {
    expect((await demoFetch("/auth/connect")).status).toBe(404);
    expect((await demoFetch("/auth/disconnect", { method: "POST" })).status).toBe(404);
    expect((await demoFetch("/auth/callback?code=x&state=y")).status).toBe(404);
  });

  it("stays locked when DEMO_MODE is unset or not exactly \"1\"", async () => {
    for (const value of [undefined, "", "0", "true"]) {
      const res = await app.fetch(new Request("https://demo.test/api/status"), {
        ...testEnv,
        DEMO_MODE: value,
      } as Env);
      expect(res.status).toBe(403);
    }
  });
});

describe("demo data generator", () => {
  it("is a pure function of the date: windows of different sizes agree", async () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const week = demoHistory(7, now);
    const month = demoHistory(30, now);
    expect(week).toEqual(month.slice(23));
  });

  it("slides without rewriting history", async () => {
    const today = demoHistory(7, new Date("2026-11-04T12:00:00Z"));
    const tomorrow = demoHistory(7, new Date("2026-11-05T12:00:00Z"));
    // Yesterday's values read the same after the window moves.
    expect(tomorrow.slice(0, 6)).toEqual(today.slice(1));
  });

  it("varies: a month is not a flat line", async () => {
    const month = demoHistory(30, new Date("2026-11-04T12:00:00Z"));
    const readiness = new Set(month.map((d) => d.readiness));
    expect(readiness.size).toBeGreaterThan(5);
  });

  it("feeds the same insight math the real dashboard uses, and it has a story", async () => {
    // Fixed date for determinism. The generator models sleep driving
    // readiness and longer weekends, so the public demo always has real
    // baselines and at least one honest pattern sentence to show.
    const history = demoHistory(91, new Date("2026-11-04T12:00:00Z"));
    const baselines = computeBaselines(history, latestRecord(history));
    expect(baselines).not.toBeNull();
    expect(baselines!.metrics.readiness!.n).toBe(28);
    expect(baselines!.metrics.readiness!.sd).toBeGreaterThan(0);

    const patterns = computePatterns(history);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns.length).toBeLessThanOrEqual(3);
  });
});
