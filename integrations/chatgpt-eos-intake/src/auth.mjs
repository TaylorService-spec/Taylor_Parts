import { createRemoteJWKSet, jwtVerify } from "jose";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

export const SCOPES = Object.freeze({ read: "eos.intake.read", submit: "eos.intake.submit" });

export class JwtAccessTokenVerifier {
  constructor({ issuer, audience, jwksUri, jwks = createRemoteJWKSet(jwksUri) }) {
    this.issuer = issuer.href.replace(/\/$/, "");
    this.audience = audience;
    this.jwks = jwks;
  }

  async verifyAccessToken(token) {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256", "ES256"],
      });
      const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
      if (!payload.sub || !payload.exp) throw new Error("access token requires sub and exp claims");
      return { token, clientId: String(payload.client_id || payload.azp || "unknown"), scopes, expiresAt: payload.exp, resource: this.audience, subject: payload.sub };
    } catch {
      throw new InvalidTokenError("Access token validation failed");
    }
  }
}

export function requireScope(extra, scope) {
  const auth = extra?.authInfo;
  if (!auth?.scopes?.includes(scope)) throw new Error(`forbidden: required OAuth scope ${scope}`);
  return auth;
}
