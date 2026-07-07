import { describe, it, expect } from "vitest";
import { verifyAccessJwt, AccessJwtError } from "../src/access";
import { makeTestKeys, accessPayload } from "./helpers";

const teamDomain = "testteam.cloudflareaccess.com";
const aud = "test-aud-tag";

describe("verifyAccessJwt", () => {
  it("accepts a valid token and returns the email", async () => {
    const keys = await makeTestKeys();
    const token = await keys.sign(accessPayload());
    const result = await verifyAccessJwt(token, {
      teamDomain,
      aud,
      fetchJwks: async () => keys.jwks,
    });
    expect(result.email).toBe("owner@example.com");
  });

  it("normalizes a team domain given with scheme/trailing slash", async () => {
    const keys = await makeTestKeys();
    const token = await keys.sign(accessPayload());
    const result = await verifyAccessJwt(token, {
      teamDomain: "https://testteam.cloudflareaccess.com/",
      aud,
      fetchJwks: async () => keys.jwks,
    });
    expect(result.email).toBe("owner@example.com");
  });

  it("rejects a token signed by a different key", async () => {
    const realKeys = await makeTestKeys();
    const attackerKeys = await makeTestKeys(realKeys.kid); // same kid, wrong key
    const token = await attackerKeys.sign(accessPayload());
    await expect(
      verifyAccessJwt(token, {
        teamDomain,
        aud,
        fetchJwks: async () => realKeys.jwks,
      })
    ).rejects.toThrow(AccessJwtError);
  });

  it("rejects a wrong audience", async () => {
    const keys = await makeTestKeys();
    const token = await keys.sign(accessPayload({ aud: ["some-other-app"] }));
    await expect(
      verifyAccessJwt(token, { teamDomain, aud, fetchJwks: async () => keys.jwks })
    ).rejects.toThrow("Bad audience");
  });

  it("rejects a wrong issuer", async () => {
    const keys = await makeTestKeys();
    const token = await keys.sign(
      accessPayload({ iss: "https://evil.cloudflareaccess.com" })
    );
    await expect(
      verifyAccessJwt(token, { teamDomain, aud, fetchJwks: async () => keys.jwks })
    ).rejects.toThrow("Bad issuer");
  });

  it("rejects an expired token", async () => {
    const keys = await makeTestKeys();
    const now = Math.floor(Date.now() / 1000);
    const token = await keys.sign(accessPayload({ exp: now - 10 }));
    await expect(
      verifyAccessJwt(token, { teamDomain, aud, fetchJwks: async () => keys.jwks })
    ).rejects.toThrow("Token expired");
  });

  it("rejects garbage tokens without calling the JWKS endpoint", async () => {
    await expect(
      verifyAccessJwt("not-a-jwt", {
        teamDomain,
        aud,
        fetchJwks: async () => {
          throw new Error("should not be called");
        },
      })
    ).rejects.toThrow(AccessJwtError);
  });

  it("rejects tokens with no matching kid", async () => {
    const keys = await makeTestKeys();
    const token = await keys.sign(accessPayload(), { kid: "unknown-kid" });
    await expect(
      verifyAccessJwt(token, { teamDomain, aud, fetchJwks: async () => keys.jwks })
    ).rejects.toThrow("No matching JWKS key");
  });
});
