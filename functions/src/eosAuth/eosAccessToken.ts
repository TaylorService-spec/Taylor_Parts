// THE EOS ACCESS TOKEN: sign and verify a short-lived compact JWS (alg EdDSA / Ed25519).
//
// docs/architecture/eos-identity-session-foundation.md, section 3(a)/(b). Controller ruling 2026-09-29
// ("EOS IDENTITY BOUNDARY", Option A refined).
//
// ════════════════════ WHAT THE TOKEN SAYS ════════════════════
//
// AUTHENTICATION ONLY: "subject S was authenticated by the EOS issuer for environment E, until T".
// It says NOTHING about Roles, capabilities, tenant, Principal or Employee -- those are IDENTITY
// RESOLUTION (a binding table) and AUTHORIZATION (the existing PostgreSQL system). A payload that tries
// to state authority is REFUSED, not ignored.
//
// ════════════════════ NO DEPENDENCY, NO FIREBASE ════════════════════
//
// Node's built-in `crypto` signs and verifies Ed25519 natively. Nothing here imports firebase,
// firebase-admin, google-auth-library, jose or jsonwebtoken (test/eosAuthNoFirebase.test.mjs).
//
// ════════════════════ KEY MATERIAL ════════════════════
//
// Keys arrive from the ENVIRONMENT (Render) or, in tests, from memory. This module never reads a file,
// never prints a key and never includes key material in an error message.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, KeyObject } from "node:crypto";

export const EOS_IDENTITY_PROVIDER = "eos";
export const EOS_TOKEN_ALGORITHMS = Object.freeze(["EdDSA"] as const);
/** Hard ceiling on exp - iat, enforced by the verifier as well as the issuer. */
export const EOS_TOKEN_MAX_LIFETIME_SECONDS = 900;
export const EOS_TOKEN_CLOCK_SKEW_SECONDS = 30;
export const EOS_TOKEN_MAX_LENGTH = 4096;
export const EOS_TOKEN_ENVIRONMENTS = Object.freeze(["nonprod", "production"] as const);
export type EosTokenEnvironment = (typeof EOS_TOKEN_ENVIRONMENTS)[number];

/** An EOS identity subject. Also enforced by the principal_identities CHECK constraint. */
export const EOS_SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const KID_PATTERN = /^(nonprod|production)-[A-Za-z0-9._-]{1,64}$/;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const ALLOWED_HEADER_KEYS = new Set(["alg", "typ", "kid"]);
const REQUIRED_CLAIMS = ["iss", "aud", "sub", "iat", "exp", "jti", "env"] as const;
const ALLOWED_CLAIMS = new Set<string>([...REQUIRED_CLAIMS, "nbf"]);
/** Claims that would state authority. Their presence refuses the token. */
export const AUTHORITY_BEARING_CLAIMS = Object.freeze([
  "roles", "role", "capabilities", "permissions", "scope", "scp", "tenantId", "principalId",
  "employeeId", "securityRole", "jobRole", "admin", "groups", "entitlements",
]);

export type EosTokenRefusal =
  | "MALFORMED"
  | "ALGORITHM_REFUSED"
  | "HEADER_REFUSED"
  | "UNKNOWN_KID"
  | "KID_ENVIRONMENT_MISMATCH"
  | "BAD_SIGNATURE"
  | "ISSUER_MISMATCH"
  | "AUDIENCE_MISMATCH"
  | "ENVIRONMENT_MISMATCH"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "LIFETIME_EXCEEDED"
  | "CLAIM_REFUSED"
  | "SUBJECT_MALFORMED";

/** One refusal type. The message is a code only -- never a token, a key or a claim value. */
export class EosTokenError extends Error {
  constructor(readonly refusal: EosTokenRefusal) {
    super(`EOS token refused: ${refusal}`);
    this.name = "EosTokenError";
  }
}

export class EosAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EosAuthConfigError";
  }
}

export interface EosTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly nbf?: number;
  readonly jti: string;
  readonly env: EosTokenEnvironment;
}

// ════════════════════ encoding ════════════════════

const b64url = (buf: Buffer) => buf.toString("base64url");
const jsonSegment = (value: unknown) => b64url(Buffer.from(JSON.stringify(value), "utf8"));

function decodeJsonSegment(segment: string): Record<string, unknown> {
  if (!BASE64URL_SEGMENT.test(segment)) throw new EosTokenError("MALFORMED");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new EosTokenError("MALFORMED");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new EosTokenError("MALFORMED");
  return parsed as Record<string, unknown>;
}

// ════════════════════ keys ════════════════════

const kidEnvironment = (kid: string): EosTokenEnvironment | null => {
  const m = KID_PATTERN.exec(kid);
  return m ? (m[1] as EosTokenEnvironment) : null;
};

function assertEd25519(key: KeyObject, what: string): KeyObject {
  if (key.asymmetricKeyType !== "ed25519") throw new EosAuthConfigError(`${what} is not an Ed25519 key`);
  return key;
}

/** A private key from PKCS8 PEM or a private JWK (JSON string or object). Never echoed on failure. */
export function parseEosSigningKey(material: string | object): KeyObject {
  try {
    if (typeof material === "string" && material.trim().startsWith("-----BEGIN")) {
      return assertEd25519(createPrivateKey({ key: material.trim(), format: "pem" }), "the signing key");
    }
    const jwk = typeof material === "string" ? JSON.parse(material) : material;
    return assertEd25519(createPrivateKey({ key: jwk as never, format: "jwk" }), "the signing key");
  } catch (err) {
    if (err instanceof EosAuthConfigError) throw err;
    throw new EosAuthConfigError("the signing key could not be parsed (expected Ed25519 PKCS8 PEM or private JWK)");
  }
}

/** A public key from a JWK object/string, SPKI PEM, or a KeyObject. */
export function parseEosVerifyKey(material: string | object | KeyObject): KeyObject {
  if (material instanceof KeyObject) {
    return assertEd25519(material.type === "private" ? createPublicKey(material) : material, "a verify key");
  }
  try {
    if (typeof material === "string" && material.trim().startsWith("-----BEGIN")) {
      return assertEd25519(createPublicKey({ key: material.trim(), format: "pem" }), "a verify key");
    }
    const jwk = (typeof material === "string" ? JSON.parse(material) : material) as Record<string, unknown>;
    // A verify keyset must hold PUBLIC keys. A private member here means the private key was pasted
    // somewhere it will be read by everything that reads the verify set.
    if (jwk && typeof jwk === "object" && "d" in jwk) {
      throw new EosAuthConfigError("a verify key carries private material ('d'); only public keys belong in the verify keyset");
    }
    return assertEd25519(createPublicKey({ key: jwk as never, format: "jwk" }), "a verify key");
  } catch (err) {
    if (err instanceof EosAuthConfigError) throw err;
    throw new EosAuthConfigError("a verify key could not be parsed (expected Ed25519 public JWK or SPKI PEM)");
  }
}

/** Parse EOS_AUTH_VERIFY_KEYS: a JSON object { kid: publicKey }. */
export function parseEosVerifyKeyset(raw: string | Record<string, unknown>): ReadonlyMap<string, KeyObject> {
  let obj: Record<string, unknown>;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new EosAuthConfigError("EOS_AUTH_VERIFY_KEYS is not JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new EosAuthConfigError("EOS_AUTH_VERIFY_KEYS must be a JSON object of kid -> public key");
  }
  const entries = Object.entries(obj);
  if (entries.length === 0 || entries.length > 4) {
    throw new EosAuthConfigError("EOS_AUTH_VERIFY_KEYS must hold between 1 and 4 keys");
  }
  const out = new Map<string, KeyObject>();
  for (const [kid, value] of entries) {
    if (!kidEnvironment(kid)) throw new EosAuthConfigError("every kid must be 'nonprod-<label>' or 'production-<label>'");
    out.set(kid, parseEosVerifyKey(value as object));
  }
  return out;
}

// ════════════════════ signing ════════════════════

export interface EosSigner {
  readonly kid: string;
  readonly privateKey: KeyObject;
}

/**
 * Sign claims. The CALLER is the issuer; this function only refuses what no issuer may produce --
 * an authority claim, a lifetime over the ceiling, a kid whose environment disagrees with `env`.
 */
export function signEosAccessToken(signer: EosSigner, claims: EosTokenClaims): string {
  const kidEnv = kidEnvironment(signer.kid);
  if (!kidEnv) throw new EosAuthConfigError("the signing kid must be 'nonprod-<label>' or 'production-<label>'");
  if (kidEnv !== claims.env) throw new EosAuthConfigError("the signing kid's environment does not match the token env");
  const lifetime = claims.exp - claims.iat;
  if (!(lifetime > 0 && lifetime <= EOS_TOKEN_MAX_LIFETIME_SECONDS)) {
    throw new EosAuthConfigError(`token lifetime must be in (0, ${EOS_TOKEN_MAX_LIFETIME_SECONDS}] seconds`);
  }
  for (const k of Object.keys(claims)) {
    if (!ALLOWED_CLAIMS.has(k)) throw new EosAuthConfigError(`claim '${k}' is not part of the EOS token`);
  }
  if (!EOS_SUBJECT_PATTERN.test(claims.sub)) throw new EosAuthConfigError("the subject is malformed");
  const header = { alg: "EdDSA", typ: "JWT", kid: signer.kid };
  const input = `${jsonSegment(header)}.${jsonSegment(claims)}`;
  const signature = sign(null, Buffer.from(input, "ascii"), signer.privateKey);
  return `${input}.${b64url(signature)}`;
}

export const newTokenId = (): string => b64url(randomBytes(16));

// ════════════════════ verification ════════════════════

export interface EosVerifierConfig {
  readonly environment: EosTokenEnvironment;
  readonly issuer: string;
  readonly audience: string;
  readonly keys: ReadonlyMap<string, KeyObject>;
  /** Injectable clock, seconds. */
  readonly nowSeconds?: () => number;
}

export interface VerifiedEosToken {
  readonly externalSubject: string;
  readonly identityProvider: typeof EOS_IDENTITY_PROVIDER;
  readonly claims: EosTokenClaims;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Build a verifier. The configuration is checked HERE, once, so a production verifier can never be
 * constructed around a nonprod key, issuer or audience.
 */
export function createEosTokenVerifier(config: EosVerifierConfig): (token: string) => VerifiedEosToken {
  const environment = config.environment;
  if (!EOS_TOKEN_ENVIRONMENTS.includes(environment)) {
    throw new EosAuthConfigError("the verifier environment must be 'nonprod' or 'production'");
  }
  if (!nonEmptyString(config.issuer) || !nonEmptyString(config.audience)) {
    throw new EosAuthConfigError("the verifier needs an issuer and an audience");
  }
  if (config.keys.size === 0) throw new EosAuthConfigError("the verifier needs at least one key");
  for (const kid of config.keys.keys()) {
    if (kidEnvironment(kid) !== environment) {
      throw new EosAuthConfigError(`the ${environment} verifier refuses a keyset kid of another environment`);
    }
  }
  // STRUCTURAL PRODUCTION FENCE: a production verifier is not constructible around nonprod naming.
  if (environment === "production" && (/nonprod/i.test(config.issuer) || /nonprod/i.test(config.audience))) {
    throw new EosAuthConfigError("a production verifier refuses a nonprod issuer or audience");
  }
  const now = config.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const skew = EOS_TOKEN_CLOCK_SKEW_SECONDS;

  return function verifyEosAccessToken(token: string): VerifiedEosToken {
    if (typeof token !== "string" || token.length === 0 || token.length > EOS_TOKEN_MAX_LENGTH) {
      throw new EosTokenError("MALFORMED");
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => p.length === 0 || !BASE64URL_SEGMENT.test(p))) {
      throw new EosTokenError("MALFORMED");
    }
    const [h, p, s] = parts;
    const header = decodeJsonSegment(h);

    // ── header ──
    if (typeof header.alg !== "string" || !(EOS_TOKEN_ALGORITHMS as readonly string[]).includes(header.alg)) {
      throw new EosTokenError("ALGORITHM_REFUSED");
    }
    for (const k of Object.keys(header)) if (!ALLOWED_HEADER_KEYS.has(k)) throw new EosTokenError("HEADER_REFUSED");
    if (header.typ !== "JWT") throw new EosTokenError("HEADER_REFUSED");
    if (!nonEmptyString(header.kid)) throw new EosTokenError("UNKNOWN_KID");
    const kidEnv = kidEnvironment(header.kid);
    if (kidEnv !== environment) throw new EosTokenError("KID_ENVIRONMENT_MISMATCH");
    const key = config.keys.get(header.kid);
    if (!key) throw new EosTokenError("UNKNOWN_KID");

    // ── signature, before any claim is believed ──
    const signature = Buffer.from(s, "base64url");
    if (signature.length !== 64) throw new EosTokenError("BAD_SIGNATURE");
    let good = false;
    try {
      good = verify(null, Buffer.from(`${h}.${p}`, "ascii"), key, signature);
    } catch {
      good = false;
    }
    if (!good) throw new EosTokenError("BAD_SIGNATURE");

    // ── claims ──
    const claims = decodeJsonSegment(p);
    for (const k of Object.keys(claims)) {
      if (AUTHORITY_BEARING_CLAIMS.includes(k) || !ALLOWED_CLAIMS.has(k)) throw new EosTokenError("CLAIM_REFUSED");
    }
    for (const k of REQUIRED_CLAIMS) if (!(k in claims)) throw new EosTokenError("CLAIM_REFUSED");
    if (!nonEmptyString(claims.iss) || !nonEmptyString(claims.aud) || !nonEmptyString(claims.env)
      || !nonEmptyString(claims.sub) || !nonEmptyString(claims.jti)
      || !isInt(claims.iat) || !isInt(claims.exp) || (claims.nbf !== undefined && !isInt(claims.nbf))) {
      throw new EosTokenError("CLAIM_REFUSED");
    }
    if (claims.iss !== config.issuer) throw new EosTokenError("ISSUER_MISMATCH");
    if (claims.aud !== config.audience) throw new EosTokenError("AUDIENCE_MISMATCH");
    if (claims.env !== environment) throw new EosTokenError("ENVIRONMENT_MISMATCH");
    // Belt and braces for production: nonprod naming never passes, whatever key signed it.
    if (environment === "production" && (/nonprod/i.test(claims.iss) || /nonprod/i.test(claims.aud))) {
      throw new EosTokenError("ENVIRONMENT_MISMATCH");
    }
    const t = now();
    const iat = claims.iat as number;
    const exp = claims.exp as number;
    if (exp - iat <= 0 || exp - iat > EOS_TOKEN_MAX_LIFETIME_SECONDS) throw new EosTokenError("LIFETIME_EXCEEDED");
    if (exp <= t - skew) throw new EosTokenError("EXPIRED");
    if (iat > t + skew) throw new EosTokenError("NOT_YET_VALID");
    if (claims.nbf !== undefined && (claims.nbf as number) > t + skew) throw new EosTokenError("NOT_YET_VALID");
    if (!EOS_SUBJECT_PATTERN.test(claims.sub as string)) throw new EosTokenError("SUBJECT_MALFORMED");
    const jti = claims.jti as string;
    if (jti.length < 16 || jti.length > 128) throw new EosTokenError("CLAIM_REFUSED");

    return Object.freeze({
      externalSubject: claims.sub as string,
      identityProvider: EOS_IDENTITY_PROVIDER,
      claims: Object.freeze({ ...(claims as unknown as EosTokenClaims) }),
    });
  };
}

/**
 * Read the header and payload WITHOUT verifying anything. Used ONLY to route a bearer to the right
 * verifier -- the result is never trusted and never returned to a caller.
 */
export function peekUnverifiedJws(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  if (typeof token !== "string" || token.length > 16384) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return { header: decodeJsonSegment(parts[0]), payload: decodeJsonSegment(parts[1]) };
  } catch {
    return null;
  }
}

/** SHA-256 hex. Used to hold only a HASH of the issuer credential in the service environment. */
export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
