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
  /** DEV ONLY — "1" skips Access JWT validation under `wrangler dev`. */
  ACCESS_DEV_BYPASS?: string;
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
