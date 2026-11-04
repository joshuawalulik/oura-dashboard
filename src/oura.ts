/**
 * Oura API v2 client: token storage/refresh (spec §6) and data fetching (§3).
 * Never log tokens or health payloads.
 */
import type { Env, StoredTokens } from "./types";

export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_API_BASE = "https://api.ouraring.com/v2";
/** daily + personal per spec; workout added per owner decision (2026-07-07). */
export const OURA_SCOPES = "personal daily workout";

export const TOKENS_KV_KEY = "oura_tokens";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Thrown when no usable Oura connection exists; API maps this to 409. */
export class NotConnectedError extends Error {
  constructor() {
    super("not_connected");
  }
}

type FetchLike = typeof fetch;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export function tokensFromResponse(
  body: TokenResponse,
  previousRefreshToken?: string
): StoredTokens {
  return {
    access_token: body.access_token,
    // Oura may rotate the refresh token; always keep the newest one returned.
    refresh_token: body.refresh_token ?? previousRefreshToken ?? "",
    expires_at: Date.now() + body.expires_in * 1000,
  };
}

/**
 * Returns a valid access token, refreshing (and persisting the rotated
 * refresh token) when within 5 minutes of expiry. Throws NotConnectedError
 * if there is no token record or the refresh token was revoked.
 */
export async function getAccessToken(
  env: Env,
  fetchFn: FetchLike = fetch
): Promise<string> {
  const raw = await env.OURA_KV.get(TOKENS_KV_KEY);
  if (!raw) throw new NotConnectedError();
  let tokens: StoredTokens;
  try {
    tokens = JSON.parse(raw) as StoredTokens;
  } catch {
    // Corrupt record: drop it and degrade to "not connected". Never let the
    // JSON.parse error propagate — V8 quotes the parsed input in its message,
    // which would put token material into logs.
    await env.OURA_KV.delete(TOKENS_KV_KEY);
    throw new NotConnectedError();
  }

  if (tokens.expires_at - Date.now() > REFRESH_MARGIN_MS) {
    return tokens.access_token;
  }

  const res = await fetchFn(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: env.OURA_CLIENT_ID,
      client_secret: env.OURA_CLIENT_SECRET,
    }),
  });

  if (res.status === 401) {
    // Refresh token revoked — drop the record so the UI shows "not connected".
    console.warn(JSON.stringify({ event: "oura_token_refresh", outcome: "revoked" }));
    await env.OURA_KV.delete(TOKENS_KV_KEY);
    throw new NotConnectedError();
  }
  if (!res.ok) {
    console.error(
      JSON.stringify({ event: "oura_token_refresh", outcome: "error", status: res.status })
    );
    throw new Error(`Oura token refresh failed (${res.status})`);
  }

  const updated = tokensFromResponse(
    (await res.json()) as TokenResponse,
    tokens.refresh_token
  );
  await env.OURA_KV.put(TOKENS_KV_KEY, JSON.stringify(updated));
  console.log(JSON.stringify({ event: "oura_token_refresh", outcome: "ok" }));
  return updated.access_token;
}

/** Exchanges an authorization code for tokens and persists them. */
export async function exchangeAuthorizationCode(
  env: Env,
  code: string,
  redirectUri: string,
  fetchFn: FetchLike = fetch
): Promise<void> {
  const res = await fetchFn(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.OURA_CLIENT_ID,
      client_secret: env.OURA_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Oura code exchange failed (${res.status})`);
  const tokens = tokensFromResponse((await res.json()) as TokenResponse);
  await env.OURA_KV.put(TOKENS_KV_KEY, JSON.stringify(tokens));
}

/**
 * Fetches all documents from a /usercollection/* endpoint for a date range,
 * following `next_token` pagination.
 */
export async function fetchOuraCollection(
  env: Env,
  endpoint: string,
  startDate: string,
  endDate: string,
  fetchFn: FetchLike = fetch
): Promise<unknown[]> {
  const accessToken = await getAccessToken(env, fetchFn);
  const documents: unknown[] = [];
  let nextToken: string | undefined;

  do {
    const url = new URL(`${OURA_API_BASE}/usercollection/${endpoint}`);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    if (nextToken) url.searchParams.set("next_token", nextToken);

    const res = await fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new NotConnectedError();
    if (!res.ok) throw new Error(`Oura ${endpoint} fetch failed (${res.status})`);

    const body = (await res.json()) as {
      data?: unknown[];
      next_token?: string | null;
    };
    documents.push(...(body.data ?? []));
    nextToken = body.next_token ?? undefined;
  } while (nextToken);

  return documents;
}
