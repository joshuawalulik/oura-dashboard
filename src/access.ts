/**
 * Cloudflare Access JWT validation (defense-in-depth layer 2).
 *
 * Every request must carry a valid `Cf-Access-Jwt-Assertion` header signed by
 * the Access team's keys, with the expected `aud` and `iss`. See spec §4.
 */

interface Jwk extends JsonWebKey {
  kid?: string;
}

interface JwksResponse {
  keys: Jwk[];
}

export interface AccessConfig {
  /** e.g. "myteam.cloudflareaccess.com" (scheme optional, normalized away). */
  teamDomain: string;
  /** The Access application AUD tag. */
  aud: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchJwks?: (certsUrl: string) => Promise<JwksResponse>;
  /** Injectable clock for tests; epoch seconds. */
  nowSeconds?: number;
}

export class AccessJwtError extends Error {}

interface AccessJwtPayload {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
}

/** In-memory JWKS cache (per-isolate), keyed by certs URL. */
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

function normalizeTeamDomain(teamDomain: string): string {
  return teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

async function defaultFetchJwks(certsUrl: string): Promise<JwksResponse> {
  const res = await fetch(certsUrl);
  if (!res.ok) throw new AccessJwtError(`JWKS fetch failed: ${res.status}`);
  return (await res.json()) as JwksResponse;
}

async function getJwks(
  certsUrl: string,
  fetchJwks: (url: string) => Promise<JwksResponse>,
  forceRefresh: boolean
): Promise<Jwk[]> {
  const cached = jwksCache.get(certsUrl);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const jwks = await fetchJwks(certsUrl);
  if (!Array.isArray(jwks.keys)) throw new AccessJwtError("Malformed JWKS");
  jwksCache.set(certsUrl, { keys: jwks.keys, fetchedAt: Date.now() });
  return jwks.keys;
}

/**
 * Validates the JWT signature, `aud`, `iss`, and time claims.
 * Returns the authenticated email. Throws AccessJwtError on any failure.
 */
export async function verifyAccessJwt(
  token: string,
  config: AccessConfig
): Promise<{ email: string }> {
  const teamDomain = normalizeTeamDomain(config.teamDomain);
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const expectedIssuer = `https://${teamDomain}`;
  const fetchJwks = config.fetchJwks ?? defaultFetchJwks;

  const segments = token.split(".");
  if (segments.length !== 3) throw new AccessJwtError("Malformed token");
  const [headerB64, payloadB64, signatureB64] = segments;

  let header: { alg?: string; kid?: string };
  let payload: AccessJwtPayload;
  try {
    header = decodeJson(headerB64);
    payload = decodeJson(payloadB64);
  } catch {
    throw new AccessJwtError("Undecodable token");
  }
  if (header.alg !== "RS256") throw new AccessJwtError("Unexpected algorithm");

  // Find the signing key by kid, refetching once to handle key rotation.
  let keys = await getJwks(certsUrl, fetchJwks, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getJwks(certsUrl, fetchJwks, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new AccessJwtError("No matching JWKS key");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToBytes(signatureB64);
  } catch {
    throw new AccessJwtError("Undecodable signature");
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signatureBytes,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) throw new AccessJwtError("Bad signature");

  const now = config.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new AccessJwtError("Token expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) {
    throw new AccessJwtError("Token not yet valid");
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.aud)) throw new AccessJwtError("Bad audience");
  if (payload.iss !== expectedIssuer) throw new AccessJwtError("Bad issuer");
  if (!payload.email) throw new AccessJwtError("No email claim");

  return { email: payload.email };
}
