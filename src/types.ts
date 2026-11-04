export interface Env {
  OURA_KV: KVNamespace;
  ASSETS: Fetcher;
  OURA_CLIENT_ID: string;
  OURA_CLIENT_SECRET: string;
  /** AUD tag of the Cloudflare Access application protecting this site. */
  CF_ACCESS_AUD: string;
  /** Access team domain, e.g. "myteam.cloudflareaccess.com". */
  CF_ACCESS_TEAM_DOMAIN: string;
  /** The ring owner's email; only this user may run /auth/* flows. */
  OWNER_EMAIL: string;
  /**
   * DEV ONLY — "1" skips Access JWT validation under `wrangler dev`.
   * Ignored whenever GIT_SHA is set, i.e. in every CI-deployed build.
   */
  ACCESS_DEV_BYPASS?: string;
  /**
   * "1" only on the public demo deployment ([env.demo] in wrangler.toml):
   * serves synthetic data with no Access check and no KV/secrets bound.
   * Never set on the real deployment.
   */
  DEMO_MODE?: string;
  /** Git commit SHA injected by CI (`--var GIT_SHA:...`); absent in dev. */
  GIT_SHA?: string;
}

/** Variables attached to the Hono context by the Access middleware. */
export interface AppVariables {
  email: string;
  isOwner: boolean;
}

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch milliseconds. */
  expires_at: number;
}
