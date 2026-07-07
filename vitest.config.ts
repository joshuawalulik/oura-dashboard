import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
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
          },
        },
      },
    },
  },
});
