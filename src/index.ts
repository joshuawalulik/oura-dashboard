/**
 * Oura Partner Dashboard Worker.
 *
 * Request path: Cloudflare Access (email OTP, 2-person allowlist) →
 * this Worker (validates the Access JWT on EVERY request) → static dashboard
 * or /api/* (filtered Oura data) or /auth/* (owner-only Oura OAuth).
 */
import { Hono } from "hono";
import { verifyAccessJwt, AccessJwtError } from "./access";
import { authRoutes } from "./routes/auth";
import { apiRoutes } from "./routes/api";
import type { Env, AppVariables } from "./types";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Structured request logs for Workers Logs. Metadata only — never emails,
// tokens, query strings (OAuth codes/state live there), or health data.
app.use("*", async (c, next) => {
  const start = Date.now();
  try {
    await next();
  } finally {
    console.log(
      JSON.stringify({
        event: "request",
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res?.status ?? 500,
        ms: Date.now() - start,
        viewer: c.get("email") ? (c.get("isOwner") ? "owner" : "partner") : "unauthenticated",
      })
    );
  }
});

// Last-resort handler: log the failure shape, return an opaque 500.
app.onError((err, c) => {
  console.error(
    JSON.stringify({
      event: "unhandled_error",
      path: new URL(c.req.url).pathname,
      message: err instanceof Error ? err.message : String(err),
    })
  );
  return c.json({ error: "internal_error" }, 500);
});

// Security headers (spec §11) on every response.
app.use("*", async (c, next) => {
  await next();
  // Chart.js is self-hosted (public/vendor), so no third-party origins at all.
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; " +
      "style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
      "manifest-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  c.res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
});

// Access JWT validation on every request (defense in depth, spec §4 layer 2).
app.use("*", async (c, next) => {
  // Local development only: `wrangler dev` has no Access in front of it.
  // CI always deploys with GIT_SHA set, so the bypass is structurally inert
  // in production even if the var were ever set there by mistake.
  if (c.env.ACCESS_DEV_BYPASS === "1" && !c.env.GIT_SHA) {
    c.set("email", c.env.OWNER_EMAIL.toLowerCase());
    c.set("isOwner", true);
    return next();
  }

  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) {
    return c.json({ error: "unauthorized" }, 403);
  }
  try {
    const { email } = await verifyAccessJwt(token, {
      teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
      aud: c.env.CF_ACCESS_AUD,
    });
    c.set("email", email.toLowerCase());
    c.set("isOwner", email.toLowerCase() === c.env.OWNER_EMAIL.toLowerCase());
  } catch (err) {
    if (err instanceof AccessJwtError) {
      return c.json({ error: "unauthorized" }, 403);
    }
    throw err;
  }
  return next();
});

app.route("/auth", authRoutes);
app.route("/api", apiRoutes);

// Everything else is the static dashboard, served through the Worker so the
// two middlewares above apply (run_worker_first = true in wrangler.toml).
app.all("*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const isHtml = !/\.[a-z0-9]+$/i.test(pathname) || pathname.endsWith(".html");

  // HTML must always be fetched fresh (no conditional 304s), because we
  // rewrite it per build below; a stale cached page would keep pointing at
  // stale ?v= asset URLs.
  let request = c.req.raw;
  if (isHtml) {
    request = new Request(c.req.raw);
    request.headers.delete("If-None-Match");
    request.headers.delete("If-Modified-Since");
  }
  const assetResponse = await c.env.ASSETS.fetch(request);

  // Cache-bust JS/CSS per deploy: stamp asset URLs in HTML with the build
  // SHA. The hour-long asset cache below then can never serve a stale build
  // — a new deploy means new URLs.
  if (isHtml && assetResponse.ok) {
    const build = (c.env.GIT_SHA ?? "dev").slice(0, 7);
    const html = (await assetResponse.text()).replace(
      /(href|src)="(\/[^"]+\.(?:js|css))"/g,
      `$1="$2?v=${build}"`
    );
    const headers = new Headers(assetResponse.headers);
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.set("Cache-Control", "no-store");
    return new Response(html, { status: assetResponse.status, headers });
  }

  const response = new Response(assetResponse.body, assetResponse);
  if (/\.(js|css)$/.test(pathname)) {
    response.headers.set("Cache-Control", "public, max-age=3600");
  }
  // X-Content-Type-Options: nosniff means the manifest must declare its type
  // itself; don't trust the assets binding to know the .webmanifest extension.
  if (pathname.endsWith(".webmanifest") && response.ok) {
    response.headers.set("Content-Type", "application/manifest+json");
  }
  return response;
});

export default app;
