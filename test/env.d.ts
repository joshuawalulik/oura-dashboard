declare module "cloudflare:test" {
  // ProvidedEnv is the env available in tests (bindings from wrangler.toml
  // plus vitest.config.ts miniflare bindings).
  interface ProvidedEnv {
    OURA_KV: KVNamespace;
    OURA_CLIENT_ID: string;
    OURA_CLIENT_SECRET: string;
    CF_ACCESS_AUD: string;
    CF_ACCESS_TEAM_DOMAIN: string;
    OWNER_EMAIL: string;
  }
}
