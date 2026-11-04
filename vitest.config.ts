import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  // Checked-in D1 migrations, applied per test run by test/apply-migrations.ts
  // so the suite exercises the exact schema production gets. (Relative path:
  // vitest always runs from the project root; @types/node isn't installed.)
  const migrations = await readD1Migrations("./migrations");

  return {
    test: {
      // Session worktrees under .claude/ carry their own stale copies of this
      // suite; never collect them.
      exclude: ["**/node_modules/**", ".claude/**"],
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: {
              OURA_CLIENT_ID: "test-client-id",
              OURA_CLIENT_SECRET: "test-client-secret",
              CF_ACCESS_AUD: "test-aud-tag",
              CF_ACCESS_TEAM_DOMAIN: "testteam.cloudflareaccess.com",
              OWNER_EMAIL: "owner@example.com",
              // .dev.vars is auto-loaded and would leak the local-dev auth
              // bypass into tests; force it off so tests exercise real auth.
              ACCESS_DEV_BYPASS: "",
              // Same for demo mode: tests opt in per-request, never globally.
              DEMO_MODE: "",
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
