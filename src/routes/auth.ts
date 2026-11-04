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
  // The CSP (style-src 'self') blocks inline style attributes, so this page
  // reuses the site stylesheet and the privacy/terms document classes.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Josh's Oura — connection failed</title><link rel="stylesheet" href="/styles.css"></head>
<body class="doc"><header class="site-header"><h1>Couldn't connect Oura</h1></header>
<main><p>${message}</p><p><a class="back-link" href="/">← Back to dashboard</a></p></main></body></html>`;
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Every /auth/* route is owner-only (spec §4 "Owner-only routes"), and must
// originate from our own pages: a request carrying another site's Origin is
// rejected (CSRF defense independent of the Access cookie's SameSite mode).
authRoutes.use("*", async (c, next) => {
  if (!c.get("isOwner")) {
    return c.json({ error: "forbidden" }, 403);
  }
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) {
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
