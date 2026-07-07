import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SELF, env, fetchMock } from "cloudflare:test";
import { makeTestKeys, accessPayload, type TestKeys } from "./helpers";
import { TOKENS_KV_KEY } from "../src/oura";
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

  // The Worker caches JWKS in module state, so one persistent interceptor
  // covers every test. Prime it with one call so it never counts as pending.
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

function ouraGet(pathPrefix: string, body: unknown, times = 1) {
  fetchMock
    .get("https://api.ouraring.com")
    .intercept({ path: (p: string) => p.startsWith(pathPrefix) })
    .reply(200, body as object)
    .times(times);
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

describe("Access enforcement", () => {
  it.each(["/api/status", "/api/summary", "/auth/connect", "/"])(
    "rejects %s without a JWT",
    async (path) => {
      const res = await SELF.fetch(`https://dashboard.test${path}`);
      expect(res.status).toBe(403);
    }
  );

  it("rejects a tampered JWT", async () => {
    const res = await SELF.fetch("https://dashboard.test/api/status", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt.slice(0, -4) + "AAAA" },
    });
    expect(res.status).toBe(403);
  });

  it("serves the dashboard with security headers for a valid user", async () => {
    const res = await SELF.fetch("https://dashboard.test/", {
      headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await res.text()).toContain("Josh's Oura");
  });
});

describe("/api/status", () => {
  it("identifies the owner and reports not connected", async () => {
    const res = await SELF.fetch("https://dashboard.test/api/status", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      viewer_is_owner: true,
      last_sync: null,
    });
  });

  it("identifies the partner as non-owner", async () => {
    await connectTokens();
    const res = await SELF.fetch("https://dashboard.test/api/status", {
      headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
    });
    const body = (await res.json()) as { connected: boolean; viewer_is_owner: boolean };
    expect(body.connected).toBe(true);
    expect(body.viewer_is_owner).toBe(false);
  });
});

describe("owner-only auth routes", () => {
  it("blocks the partner from /auth/connect and /auth/disconnect", async () => {
    for (const [path, method] of [
      ["/auth/connect", "GET"],
      ["/auth/disconnect", "POST"],
    ] as const) {
      const res = await SELF.fetch(`https://dashboard.test${path}`, {
        method,
        headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
      });
      expect(res.status).toBe(403);
    }
  });

  it("redirects the owner to Oura with a stored single-use state", async () => {
    const res = await SELF.fetch("https://dashboard.test/auth/connect", {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.origin).toBe("https://cloud.ouraring.com");
    expect(location.pathname).toBe("/oauth/authorize");
    expect(location.searchParams.get("scope")).toBe("personal daily workout");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://dashboard.test/auth/callback"
    );

    const state = location.searchParams.get("state") ?? "";
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(await testEnv.OURA_KV.get(`oauth_state:${state}`)).toBe("1");
  });

  it("exchanges the code on callback and rejects state reuse", async () => {
    await testEnv.OURA_KV.put("oauth_state:goodstate", "1");
    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ method: "POST", path: "/oauth/token" })
      .reply(200, {
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 86400,
      });

    const url =
      "https://dashboard.test/auth/callback?code=authcode&state=goodstate";
    const res = await SELF.fetch(url, {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");

    const stored = JSON.parse((await testEnv.OURA_KV.get(TOKENS_KV_KEY)) ?? "{}");
    expect(stored.access_token).toBe("fresh-access");
    expect(stored.refresh_token).toBe("fresh-refresh");

    // Same state again → rejected (single use).
    const replay = await SELF.fetch(url, {
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
      redirect: "manual",
    });
    expect(replay.status).toBe(400);
  });

  it("disconnect deletes the token record", async () => {
    await connectTokens();
    const res = await SELF.fetch("https://dashboard.test/auth/disconnect", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": ownerJwt },
    });
    expect(res.status).toBe(200);
    expect(await testEnv.OURA_KV.get(TOKENS_KV_KEY)).toBeNull();
  });
});

describe("/api data routes", () => {
  it("returns 409 not_connected when Oura is not linked", async () => {
    const res = await SELF.fetch("https://dashboard.test/api/summary", {
      headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_connected" });
  });

  it("serves only allowlisted fields and caches upstream responses", async () => {
    await connectTokens();
    const today = new Date().toISOString().slice(0, 10);

    // Each endpoint may be called at most once — the second request below
    // must be served from the KV cache or fetchMock will fail it.
    ouraGet("/v2/usercollection/daily_readiness", {
      data: [
        {
          day: today,
          score: 88,
          contributors: { resting_heart_rate: 47 },
          temperature_deviation: 0.1,
        },
      ],
      next_token: null,
    });
    ouraGet("/v2/usercollection/daily_sleep", {
      data: [{ day: today, score: 79, contributors: { efficiency: 90 } }],
      next_token: null,
    });
    ouraGet("/v2/usercollection/daily_activity", {
      data: [{ day: today, score: 65, steps: 12345, active_calories: 500 }],
      next_token: null,
    });
    ouraGet("/v2/usercollection/sleep", {
      data: [
        {
          day: today,
          type: "long_sleep",
          total_sleep_duration: 26460,
          average_heart_rate: 51,
          lowest_heart_rate: 44,
        },
      ],
      next_token: null,
    });

    const res = await SELF.fetch("https://dashboard.test/api/summary", {
      headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
    });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as Record<string, unknown>;
    expect(summary.date).toBe(today);
    expect(summary.readiness).toBe(88);
    expect(summary.sleep).toBe(79);
    expect(summary.activity).toBe(65);
    expect(summary.total_sleep_seconds).toBe(26460);
    expect(typeof summary.last_sync).toBe("string");

    // Owner-excluded and non-allowlisted fields must never appear.
    const raw = JSON.stringify(summary);
    expect(raw).not.toContain("steps");
    expect(raw).not.toContain("heart_rate");
    expect(raw).not.toContain("contributors");
    expect(raw).not.toContain("calories");

    // Second request: served from cache (no interceptors left).
    const history = await SELF.fetch("https://dashboard.test/api/history?days=7", {
      headers: { "Cf-Access-Jwt-Assertion": partnerJwt },
    });
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      days: number;
      data: Array<Record<string, unknown>>;
    };
    expect(historyBody.days).toBe(7);
    expect(historyBody.data).toHaveLength(7);
    const todayRow = historyBody.data.find((r) => r.date === today);
    expect(todayRow).toMatchObject({ readiness: 88, sleep: 79, activity: 65 });
    expect(JSON.stringify(historyBody)).not.toContain("steps");
  });
});
