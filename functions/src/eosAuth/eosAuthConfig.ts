// EOS AUTHENTICATION CONFIGURATION, read from the service environment (Render) -- never from a file.
//
// docs/architecture/eos-identity-session-foundation.md, section 3(b). Every variable is OPTIONAL: with none
// set, EOS token verification is off and the service is exactly the Firebase-only service it was. Setting
// them is an operator act on Render; this module only reads and validates them, and never prints a value.
//
//   EOS_AUTH_VERIFY_KEYS                  JSON { "<kid>": <Ed25519 public JWK> }   (public)
//   EOS_AUTH_ISSUER                       the issuer URL, e.g. https://eos-api-nonprod.onrender.com/auth
//   EOS_AUTH_AUDIENCE                     the API URL,    e.g. https://eos-api-nonprod.onrender.com
//   EOS_AUTH_SIGNING_KEY_NONPROD          Ed25519 private key, PKCS8 PEM or private JWK  (SECRET)
//   EOS_AUTH_SIGNING_KID                  the kid of that key; must be in EOS_AUTH_VERIFY_KEYS
//   EOS_PERSONA_ISSUER_CREDENTIAL_SHA256  64 hex: SHA-256 of the persona issuer credential (the raw
//                                         credential is NEVER in this environment)
//   EOS_HUMAN_LOGIN                       "enabled" mounts the human front door (eosLoginHttp.ts); anything else, or
//                                         unset, leaves it a 404. Requires the signing key.
//   EOS_AUTH_FACTOR_KEYS                  JSON { "<id>": "<base64url 32 bytes>" }: seals TOTP secrets and peppers
//                                         recovery codes (SECRET). Unset: MFA enrollment refuses MFA_NOT_CONFIGURED.
//   EOS_AUTH_FACTOR_KEY_ID                the id new secrets are sealed under; must be in EOS_AUTH_FACTOR_KEYS
//   EOS_AUTH_COOKIE_SAMESITE              REQUIRED with EOS_HUMAN_LOGIN: "Strict" | "Lax" (app and API on one site) or
//                                         "None" (cross-site; the cookie is then also Partitioned). No default: the
//                                         right value is a deployment fact, and a wrong guess silently breaks refresh.
//   EOS_AUTH_TRUSTED_PROXY_HOPS           REQUIRED with EOS_HUMAN_LOGIN: 0..3, how many proxies append X-Forwarded-For
//                                         in front of the service (Render: 1). 0 = use the socket address. The client
//                                         address keys the rate limiter, so a wrong value makes it per-proxy, not
//                                         per-client.
//   EOS_AUTH_CLIENT_IP_HEADER             optional, "true-client-ip" | "cf-connecting-ip": read the client address from
//                                         that header, which an edge proxy SETS (overwriting any client value), in
//                                         preference to X-Forwarded-For hop counting. Render fronts services with
//                                         Cloudflare and APPENDS to a client-supplied X-Forwarded-For (§9); confirm by
//                                         measurement before relying on either.
//   EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256  optional, 64 hex, nonprod only: mounts the one-time client-address measurement
//                                         (clientIpDiagnostic.ts). Independent of EOS_HUMAN_LOGIN; unset after use.
//   EOS_AUTH_MULTI_TENANT_SESSIONS        optional, "enabled" | "disabled" (default disabled). Disabled: a human login is
//                                         single-tenant (a Principal with a membership elsewhere is refused). Enabled:
//                                         Owner ruling D-12 -- a Principal may belong to several tenants and each session
//                                         is bound to ONE, chosen and validated at login, changed only by an explicit
//                                         switch that issues a new session.
//
// There is deliberately NO production signing variable. The only issuer in this foundation is the nonprod
// persona issuer, and it cannot be configured anywhere EOS_ENVIRONMENT is not exactly "nonprod".
import { createPublicKey, KeyObject } from "node:crypto";
import { parseFactorKeyring, type FactorKeyring } from "./credentialCrypto";
import {
  createEosTokenVerifier,
  EosAuthConfigError,
  parseEosSigningKey,
  parseEosVerifyKeyset,
  type EosSigner,
  type VerifiedEosToken,
} from "./eosAccessToken";

export interface EosAuthRuntime {
  /** null when EOS token verification is not configured -- the service is then Firebase-only. */
  readonly verify: ((token: string) => VerifiedEosToken) | null;
  readonly issuer: string | null;
  readonly audience: string | null;
  /** null unless the nonprod persona issuer is fully configured AND the environment is nonprod. */
  readonly personaIssuer: {
    readonly signer: EosSigner;
    readonly credentialSha256: string;
  } | null;
  /**
   * null unless EOS_HUMAN_LOGIN=enabled with a signing key. `factorKeyring` null = password-only (MFA enrollment
   * refuses; an account can then never acquire a factor, so none ever needs one to sign in).
   */
  /** The client-address measurement (clientIpDiagnostic.ts): the SHA-256 of its operator credential, or null (unmounted). */
  readonly clientIpDiagnosticSha256?: string | null;
  readonly humanLogin: {
    readonly signer: EosSigner;
    readonly factorKeyring: FactorKeyring | null;
    readonly cookieSameSite: EosCookieSameSite;
    readonly trustedProxyHops: number;
    readonly multiTenantSessions: boolean;
    readonly clientIpHeader: "true-client-ip" | "cf-connecting-ip" | null;
  } | null;
}

export const EOS_COOKIE_SAMESITE_VALUES = Object.freeze(["Strict", "Lax", "None"] as const);
export type EosCookieSameSite = (typeof EOS_COOKIE_SAMESITE_VALUES)[number];

export const EOS_AUTH_DISABLED: EosAuthRuntime = Object.freeze({
  verify: null, issuer: null, audience: null, personaIssuer: null, humanLogin: null,
});

const present = (v: string | undefined): v is string => typeof v === "string" && v.trim().length > 0;

const samePublicKey = (a: KeyObject, b: KeyObject) =>
  a.export({ format: "der", type: "spki" }).equals(b.export({ format: "der", type: "spki" }));

/**
 * Read and validate. Throws EosAuthConfigError (the service refuses to start) on a PARTIAL or INCONSISTENT
 * configuration -- half a verifier is worse than none, because it looks configured.
 */
export function readEosAuthConfig(env: NodeJS.ProcessEnv, serviceEnvironment: string): EosAuthRuntime {
  const base = readEosAuthConfigCore(env, serviceEnvironment);
  const diag = (env.EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256 ?? "").trim().toLowerCase();
  if (!diag) return base;
  if (!/^[0-9a-f]{64}$/.test(diag)) throw new EosAuthConfigError("EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256 must be 64 hex characters");
  if (serviceEnvironment !== "nonprod") throw new EosAuthConfigError("the client-address measurement is nonprod only");
  return Object.freeze({ ...base, clientIpDiagnosticSha256: diag });
}

function readEosAuthConfigCore(env: NodeJS.ProcessEnv, serviceEnvironment: string): EosAuthRuntime {
  const keysRaw = env.EOS_AUTH_VERIFY_KEYS;
  const signingRaw = env.EOS_AUTH_SIGNING_KEY_NONPROD;
  const kid = env.EOS_AUTH_SIGNING_KID;
  const credentialHash = env.EOS_PERSONA_ISSUER_CREDENTIAL_SHA256;

  const humanLoginFlag = env.EOS_HUMAN_LOGIN;
  if (present(humanLoginFlag) && humanLoginFlag.trim() !== "enabled" && humanLoginFlag.trim() !== "disabled") {
    throw new EosAuthConfigError("EOS_HUMAN_LOGIN must be 'enabled' or 'disabled'");
  }
  const humanLoginEnabled = present(humanLoginFlag) && humanLoginFlag.trim() === "enabled";
  if (!present(keysRaw)) {
    if (humanLoginEnabled) throw new EosAuthConfigError("EOS_HUMAN_LOGIN=enabled requires EOS token verification to be configured");
    if (present(signingRaw) || present(kid) || present(credentialHash)) {
      throw new EosAuthConfigError("EOS signing/issuer variables are set but EOS_AUTH_VERIFY_KEYS is not");
    }
    return EOS_AUTH_DISABLED;
  }
  // The token env claim is "nonprod" or "production"; this service refuses production outright, so the only
  // environment a verifier can be built for here is nonprod.
  if (serviceEnvironment !== "nonprod") {
    throw new EosAuthConfigError("EOS token verification requires EOS_ENVIRONMENT=nonprod");
  }
  if (!present(env.EOS_AUTH_ISSUER) || !present(env.EOS_AUTH_AUDIENCE)) {
    throw new EosAuthConfigError("EOS_AUTH_VERIFY_KEYS requires EOS_AUTH_ISSUER and EOS_AUTH_AUDIENCE");
  }
  const issuer = env.EOS_AUTH_ISSUER.trim();
  const audience = env.EOS_AUTH_AUDIENCE.trim();
  const keys = parseEosVerifyKeyset(keysRaw);
  const verify = createEosTokenVerifier({ environment: "nonprod", issuer, audience, keys });

  if (present(signingRaw) !== present(kid)) {
    throw new EosAuthConfigError("EOS_AUTH_SIGNING_KEY_NONPROD and EOS_AUTH_SIGNING_KID must be set together");
  }
  let personaIssuer: EosAuthRuntime["personaIssuer"] = null;
  let signerForLogin: EosSigner | null = null;
  if (present(signingRaw) && present(kid)) {
    const signer: EosSigner = { kid: kid.trim(), privateKey: parseEosSigningKey(signingRaw) };
    if (!signer.kid.startsWith("nonprod-")) throw new EosAuthConfigError("EOS_AUTH_SIGNING_KID must be a nonprod- kid");
    const published = keys.get(signer.kid);
    if (!published) throw new EosAuthConfigError("EOS_AUTH_SIGNING_KID is not in EOS_AUTH_VERIFY_KEYS");
    if (!samePublicKey(published, createPublicKey(signer.privateKey))) {
      throw new EosAuthConfigError("EOS_AUTH_SIGNING_KEY_NONPROD does not match the public key published for its kid");
    }
    signerForLogin = signer;
    if (present(credentialHash)) {
      const h = credentialHash.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(h)) throw new EosAuthConfigError("EOS_PERSONA_ISSUER_CREDENTIAL_SHA256 must be 64 hex characters");
      personaIssuer = { signer, credentialSha256: h };
    }
    // Signing key without the credential hash: the issuer stays UNMOUNTED. Verification still works.
  } else if (present(credentialHash)) {
    throw new EosAuthConfigError("EOS_PERSONA_ISSUER_CREDENTIAL_SHA256 is set but no signing key is");
  }
  let humanLogin: EosAuthRuntime["humanLogin"] = null;
  const factorKeysRaw = env.EOS_AUTH_FACTOR_KEYS;
  const factorKid = env.EOS_AUTH_FACTOR_KEY_ID;
  if (present(factorKeysRaw) !== present(factorKid)) {
    throw new EosAuthConfigError("EOS_AUTH_FACTOR_KEYS and EOS_AUTH_FACTOR_KEY_ID must be set together");
  }
  if (humanLoginEnabled) {
    if (!signerForLogin) throw new EosAuthConfigError("EOS_HUMAN_LOGIN=enabled requires EOS_AUTH_SIGNING_KEY_NONPROD");
    let factorKeyring: FactorKeyring | null = null;
    if (present(factorKeysRaw) && present(factorKid)) {
      try {
        factorKeyring = parseFactorKeyring(factorKeysRaw, factorKid.trim());
      } catch (err) {
        throw new EosAuthConfigError((err as Error).message);
      }
    }
    const sameSite = (env.EOS_AUTH_COOKIE_SAMESITE ?? "").trim();
    if (!(EOS_COOKIE_SAMESITE_VALUES as readonly string[]).includes(sameSite)) {
      throw new EosAuthConfigError("EOS_HUMAN_LOGIN=enabled requires EOS_AUTH_COOKIE_SAMESITE = Strict | Lax | None");
    }
    const hopsRaw = (env.EOS_AUTH_TRUSTED_PROXY_HOPS ?? "").trim();
    if (!/^[0-3]$/.test(hopsRaw)) throw new EosAuthConfigError("EOS_HUMAN_LOGIN=enabled requires EOS_AUTH_TRUSTED_PROXY_HOPS = 0..3");
    const multi = (env.EOS_AUTH_MULTI_TENANT_SESSIONS ?? "disabled").trim();
    if (multi !== "enabled" && multi !== "disabled") throw new EosAuthConfigError("EOS_AUTH_MULTI_TENANT_SESSIONS must be 'enabled' or 'disabled'");
    const ipHeader = (env.EOS_AUTH_CLIENT_IP_HEADER ?? "").trim().toLowerCase();
    if (ipHeader && ipHeader !== "true-client-ip" && ipHeader !== "cf-connecting-ip") {
      throw new EosAuthConfigError("EOS_AUTH_CLIENT_IP_HEADER must be 'true-client-ip' or 'cf-connecting-ip'");
    }
    humanLogin = Object.freeze({ signer: signerForLogin, factorKeyring, cookieSameSite: sameSite as EosCookieSameSite,
      trustedProxyHops: Number(hopsRaw), multiTenantSessions: multi === "enabled",
      clientIpHeader: (ipHeader || null) as "true-client-ip" | "cf-connecting-ip" | null });
  } else if (present(factorKeysRaw)) {
    throw new EosAuthConfigError("EOS_AUTH_FACTOR_KEYS is set but EOS_HUMAN_LOGIN is not enabled");
  } else if (present(env.EOS_AUTH_COOKIE_SAMESITE) || present(env.EOS_AUTH_TRUSTED_PROXY_HOPS)) {
    throw new EosAuthConfigError("EOS_AUTH_COOKIE_SAMESITE / EOS_AUTH_TRUSTED_PROXY_HOPS are set but EOS_HUMAN_LOGIN is not enabled");
  }
  return Object.freeze({ verify, issuer, audience, personaIssuer, humanLogin });
}
