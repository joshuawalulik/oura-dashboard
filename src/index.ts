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

// Security headers (spec §11) on every response.
app.use("*", async (c, next) => {
  await next();
  // Chart.js is self-hosted (public/vendor), so no third-party origins at all.
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; " +
      "style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'"
  );
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
});

// Access JWT validation on every request (defense in depth, spec §4 layer 2).
app.use("*", async (c, next) => {
  // Local development only: `wrangler dev` has no Access in front of it.
  if (c.env.ACCESS_DEV_BYPASS === "1") {
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
  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  const response = new Response(assetResponse.body, assetResponse);
  // JS/CSS can be cached briefly; HTML stays revalidated so UI changes land
  // immediately. (Asset filenames aren't content-hashed, hence the short TTL.)
  if (/\.(js|css)$/.test(new URL(c.req.url).pathname)) {
    response.headers.set("Cache-Control", "public, max-age=3600");
  }
  return response;
});

export default app;
