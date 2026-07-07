/**
 * Oura OAuth flow (spec §5). Owner-only: the partner never touches Oura auth.
 */
import { Hono } from "hono";
import type { Env, AppVariables } from "../types";
import {
  OURA_AUTHORIZE_URL,
  OURA_SCOPES,
  TOKENS_KV_KEY,
  exchangeAuthorizationCode,
} from "../oura";

const STATE_TTL_SECONDS = 600;

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function failurePage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Josh's Oura — connection failed</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1>Couldn't connect Oura</h1><p>${message}</p><p><a href="/">Back to dashboard</a></p></body>`;
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Every /auth/* route is owner-only (spec §4 "Owner-only routes").
authRoutes.use("*", async (c, next) => {
  if (!c.get("isOwner")) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
});

authRoutes.get("/connect", async (c) => {
  const state = randomState();
  await c.env.OURA_KV.put(`oauth_state:${state}`, "1", {
    expirationTtl: STATE_TTL_SECONDS,
  });

  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;
  const authorizeUrl = new URL(OURA_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", c.env.OURA_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", OURA_SCOPES);
  authorizeUrl.searchParams.set("state", state);
  return c.redirect(authorizeUrl.toString(), 302);
});

authRoutes.get("/callback", async (c) => {
  if (c.req.query("error")) {
    return c.html(
      failurePage("Oura reported the authorization was denied or cancelled."),
      400
    );
  }

  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!state || !code) {
    return c.html(failurePage("Missing state or code parameter."), 400);
  }

  // State must exist in KV and is single-use.
  const stateKey = `oauth_state:${state}`;
  const known = await c.env.OURA_KV.get(stateKey);
  if (!known) {
    return c.html(failurePage("Login attempt expired or invalid. Try again."), 400);
  }
  await c.env.OURA_KV.delete(stateKey);

  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;
  try {
    await exchangeAuthorizationCode(c.env, code, redirectUri);
  } catch {
    return c.html(
      failurePage("Token exchange with Oura failed. Try connecting again."),
      502
    );
  }
  return c.redirect("/", 302);
});

authRoutes.post("/disconnect", async (c) => {
  await c.env.OURA_KV.delete(TOKENS_KV_KEY);
  return c.json({ ok: true });
});
