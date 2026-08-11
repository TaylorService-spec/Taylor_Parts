import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, importJWK, SignJWT } from "jose";
import { JwtAccessTokenVerifier } from "../src/auth.mjs";

test("JWT verifier enforces issuer, audience, signature, expiry, and exposes scopes", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey); jwk.kid = "test"; jwk.alg = "RS256";
  const verifier = new JwtAccessTokenVerifier({ issuer: new URL("https://id.example/"), audience: "https://eos.example/mcp", jwksUri: new URL("https://unused.example/jwks"), jwks: async () => importJWK(jwk, "RS256") });
  const token = await new SignJWT({ scope: "eos.intake.read eos.intake.submit", client_id: "chatgpt" }).setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://id.example").setAudience("https://eos.example/mcp").setSubject("owner").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const auth = await verifier.verifyAccessToken(token);
  assert.deepEqual(auth.scopes, ["eos.intake.read", "eos.intake.submit"]);
  assert.equal(auth.subject, "owner");
  await assert.rejects(() => verifier.verifyAccessToken(`${token}x`));
});
