import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  getAccessToken,
  NotConnectedError,
  TOKENS_KV_KEY,
  fetchOuraCollection,
} from "../src/oura";
import type { Env, StoredTokens } from "../src/types";

const testEnv = env as unknown as Env;

function tokenRecord(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    access_token: "current-access",
    refresh_token: "current-refresh",
    expires_at: Date.now() + 12 * 3600 * 1000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getAccessToken", () => {
  beforeEach(async () => {
    await testEnv.OURA_KV.delete(TOKENS_KV_KEY);
  });

  it("throws NotConnectedError when no tokens are stored", async () => {
    await expect(
      getAccessToken(testEnv, async () => {
        throw new Error("no fetch expected");
      })
    ).rejects.toThrow(NotConnectedError);
  });

  it("returns the stored token when far from expiry, without refreshing", async () => {
    await testEnv.OURA_KV.put(TOKENS_KV_KEY, JSON.stringify(tokenRecord()));
    const token = await getAccessToken(testEnv, async () => {
      throw new Error("no fetch expected");
    });
    expect(token).toBe("current-access");
  });

  it("refreshes near expiry and persists the rotated refresh token", async () => {
    await testEnv.OURA_KV.put(
      TOKENS_KV_KEY,
      JSON.stringify(tokenRecord({ expires_at: Date.now() + 60 * 1000 }))
    );

    let refreshBody: URLSearchParams | undefined;
    const token = await getAccessToken(testEnv, (async (
      _url: RequestInfo | URL,
      init?: RequestInit
    ) => {
      refreshBody = new URLSearchParams(String(init?.body));
      return jsonResponse({
        access_token: "new-access",
        refresh_token: "rotated-refresh",
        expires_in: 86400,
      });
    }) as typeof fetch);

    expect(token).toBe("new-access");
    expect(refreshBody?.get("grant_type")).toBe("refresh_token");
    expect(refreshBody?.get("refresh_token")).toBe("current-refresh");
    expect(refreshBody?.get("client_id")).toBe("test-client-id");

    const stored = JSON.parse(
      (await testEnv.OURA_KV.get(TOKENS_KV_KEY)) ?? "{}"
    ) as StoredTokens;
    expect(stored.access_token).toBe("new-access");
    expect(stored.refresh_token).toBe("rotated-refresh");
    expect(stored.expires_at).toBeGreaterThan(Date.now() + 80000 * 1000);
  });

  it("keeps the old refresh token if the response does not rotate it", async () => {
    await testEnv.OURA_KV.put(
      TOKENS_KV_KEY,
      JSON.stringify(tokenRecord({ expires_at: 0 }))
    );
    await getAccessToken(testEnv, (async () =>
      jsonResponse({ access_token: "new-access", expires_in: 86400 })) as typeof fetch);
    const stored = JSON.parse(
      (await testEnv.OURA_KV.get(TOKENS_KV_KEY)) ?? "{}"
    ) as StoredTokens;
    expect(stored.refresh_token).toBe("current-refresh");
  });

  it("deletes tokens and reports not_connected when refresh returns 401", async () => {
    await testEnv.OURA_KV.put(
      TOKENS_KV_KEY,
      JSON.stringify(tokenRecord({ expires_at: 0 }))
    );
    await expect(
      getAccessToken(testEnv, (async () =>
        new Response("unauthorized", { status: 401 })) as typeof fetch)
    ).rejects.toThrow(NotConnectedError);
    expect(await testEnv.OURA_KV.get(TOKENS_KV_KEY)).toBeNull();
  });
});

describe("fetchOuraCollection", () => {
  beforeEach(async () => {
    await testEnv.OURA_KV.put(TOKENS_KV_KEY, JSON.stringify(tokenRecord()));
  });

  it("follows next_token pagination and concatenates documents", async () => {
    const pages: Record<string, unknown> = {
      first: { data: [{ day: "2026-07-01" }], next_token: "page2" },
      page2: { data: [{ day: "2026-07-02" }], next_token: null },
    };
    const requested: string[] = [];

    const docs = await fetchOuraCollection(
      testEnv,
      "daily_readiness",
      "2026-07-01",
      "2026-07-02",
      (async (url: RequestInfo | URL, init?: RequestInit) => {
        const parsed = new URL(String(url));
        requested.push(String(url));
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer current-access"
        );
        const page = parsed.searchParams.get("next_token") ?? "first";
        return jsonResponse(pages[page]);
      }) as typeof fetch
    );

    expect(docs).toEqual([{ day: "2026-07-01" }, { day: "2026-07-02" }]);
    expect(requested).toHaveLength(2);
    expect(requested[0]).toContain("/v2/usercollection/daily_readiness");
    expect(requested[0]).toContain("start_date=2026-07-01");
  });
});
