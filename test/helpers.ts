/** Shared test helpers: a real RSA keypair + Access-style JWT signing. */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonToBase64Url(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export interface TestKeys {
  jwks: { keys: JsonWebKey[] };
  sign: (
    payload: Record<string, unknown>,
    options?: { kid?: string }
  ) => Promise<string>;
  kid: string;
}

// Random kid per keypair: the Worker caches JWKS per certs URL in module
// state, so a fresh kid forces a refetch and keeps tests independent.
export async function makeTestKeys(kid = crypto.randomUUID()): Promise<TestKeys> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey
  )) as JsonWebKey & { kid?: string };
  publicJwk.kid = kid;

  const sign = async (
    payload: Record<string, unknown>,
    options: { kid?: string } = {}
  ) => {
    const header = { alg: "RS256", kid: options.kid ?? kid };
    const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
  };

  return { jwks: { keys: [publicJwk] }, sign, kid };
}

export function accessPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: ["test-aud-tag"],
    iss: "https://testteam.cloudflareaccess.com",
    email: "owner@example.com",
    exp: now + 3600,
    iat: now,
    ...overrides,
  };
}
