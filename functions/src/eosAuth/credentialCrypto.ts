// THE EOS CREDENTIAL PRIMITIVES: password hashing, TOTP, factor-secret encryption, opaque one-time tokens.
//
// docs/architecture/eos-native-identity.md, section 4. Everything here is Node's built-in `crypto` -- no
// argon2/bcrypt/otplib/jose dependency and nothing from firebase or google (test/eosAuthNoFirebase.test.mjs).
//
// ════════════════════ WHAT IS STORED, AND WHAT NEVER IS ════════════════════
//
//   password          scrypt (N=2^17, r=8, p=1, 16-byte salt, 32-byte key) in a self-describing string, so the
//                     parameters can rise later and an old hash is upgraded at the next successful login
//   opaque tokens     refresh, enrollment, reset and MFA-challenge tokens: 32 random bytes, stored as SHA-256 only
//   TOTP secret       must be recoverable to verify a code, so it is ENCRYPTED (AES-256-GCM) under a factor key
//                     from the environment, bound to its factor id by the GCM additional data
//   recovery codes    HMAC-SHA-256 under the same factor key (a pepper): a stolen table alone cannot brute-force them
//
// Nothing here logs, and no error message carries a password, a token, a secret or a key.
import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual,
} from "node:crypto";

// ════════════════════ passwords ════════════════════

export interface ScryptParameters { readonly N: number; readonly r: number; readonly p: number }
/** OWASP Password Storage Cheat Sheet (2024): scrypt N=2^17, r=8, p=1. */
export const PASSWORD_HASH_PARAMETERS: ScryptParameters = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
/** A stored hash below this is still VERIFIED (so nobody is locked out) but is re-hashed at the next login. */
const MINIMUM_ACCEPTED_N = 2 ** 14;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const HASH_PREFIX = "scrypt";

/**
 * At most this many scrypt computations at once. Each takes 128 * N * r bytes (128 MiB at the default), so an
 * unbounded burst of logins is a memory exhaustion attack. Excess callers queue.
 */
const MAX_CONCURRENT_HASHES = 2;
let running = 0;
const waiting: Array<() => void> = [];
async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_HASHES) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function scrypt(password: Buffer, salt: Buffer, params: ScryptParameters): Promise<Buffer> {
  return withHashSlot(() => new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, KEY_LENGTH, { ...params, maxmem: 256 * params.N * params.r + 1024 * 1024 },
      (err, key) => (err ? reject(new Error("password hashing failed")) : resolve(key)));
  }));
}

/** NFKC, so the same visible password typed on two keyboards is the same password (NIST SP 800-63B 5.1.1.2). */
export const normalizePassword = (password: string): string => password.normalize("NFKC");

export async function hashPassword(password: string, params: ScryptParameters = PASSWORD_HASH_PARAMETERS): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(Buffer.from(normalizePassword(password), "utf8"), salt, params);
  return `${HASH_PREFIX}$N=${params.N},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

interface ParsedHash { readonly params: ScryptParameters; readonly salt: Buffer; readonly key: Buffer }
function parsePasswordHash(stored: string): ParsedHash | null {
  const m = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored);
  if (!m) return null;
  const params = { N: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  // A stored hash is data; refuse parameters that would let one row exhaust memory or that are not a power of two.
  if (!(params.N >= MINIMUM_ACCEPTED_N && params.N <= 2 ** 20 && (params.N & (params.N - 1)) === 0)) return null;
  if (!(params.r >= 1 && params.r <= 16 && params.p >= 1 && params.p <= 4)) return null;
  const salt = Buffer.from(m[4], "base64url");
  const key = Buffer.from(m[5], "base64url");
  if (salt.length < 16 || key.length !== KEY_LENGTH) return null;
  return { params, salt, key };
}

export interface PasswordCheck {
  readonly matches: boolean;
  /** True when the hash matched but was made with weaker parameters than today's: re-hash and store it. */
  readonly needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string | null): Promise<PasswordCheck> {
  const parsed = stored ? parsePasswordHash(stored) : null;
  if (!parsed) {
    // NO STORED HASH (unknown account, never enrolled, corrupt row): spend the same work anyway, so the response
    // time does not say which of those it was.
    await burnPasswordWork(password);
    return { matches: false, needsRehash: false };
  }
  const key = await scrypt(Buffer.from(normalizePassword(password), "utf8"), parsed.salt, parsed.params);
  const matches = key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  const p = PASSWORD_HASH_PARAMETERS;
  const needsRehash = matches && (parsed.params.N < p.N || parsed.params.r < p.r || parsed.params.p < p.p);
  return { matches, needsRehash };
}

const DUMMY_SALT = randomBytes(SALT_LENGTH);
/** The cost of one password verification, with nothing to compare against. */
export async function burnPasswordWork(password: string): Promise<void> {
  await scrypt(Buffer.from(normalizePassword(typeof password === "string" ? password : ""), "utf8"), DUMMY_SALT, PASSWORD_HASH_PARAMETERS);
}

// ════════════════════ password policy (NIST SP 800-63B, 5.1.1) ════════════════════

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * The commonest passwords and keyboard walks. NOT a breach corpus -- a breached-password service is an external
 * dependency awaiting an Owner decision (docs/architecture/eos-native-identity.md, D-6). This catches the passwords
 * that would fall to the first minute of any guessing attack.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
  "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "123123123", "111111111111",
  "qwerty", "qwertyuiop", "qwerty123", "qwerty123456", "1q2w3e4r5t6y", "1qaz2wsx3edc", "zaq12wsxcde3",
  "asdfghjkl", "asdfghjkl123", "zxcvbnm", "iloveyou", "letmein", "letmein123", "welcome", "welcome1",
  "welcome123", "welcome1234", "changeme", "changeme123", "admin", "admin123", "administrator", "monkey",
  "dragon", "football", "baseball", "sunshine", "princess", "trustno1", "abc123", "abcd1234", "abcdefghijkl",
  "starwars", "superman", "batman", "master", "michael", "shadow", "whatever", "freedom", "computer",
  "taylor", "taylorparts", "taylor123", "verenward", "verenwardeos", "eos", "eosadmin", "summer2026",
  "winter2026", "spring2026", "autumn2026", "fall2026", "summer2025", "winter2025", "january2026",
]);

export type PasswordPolicyRefusal =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_TOO_COMMON"
  | "PASSWORD_CONTAINS_IDENTIFIER"
  | "PASSWORD_REPETITIVE";

/** null when acceptable. No composition rules (NIST: they do not help); length, commonness, context. */
export function passwordPolicyRefusal(password: unknown, loginIdentifier: string | null): PasswordPolicyRefusal | null {
  if (typeof password !== "string") return "PASSWORD_TOO_SHORT";
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return "PASSWORD_TOO_SHORT";
  if (length > PASSWORD_MAX_LENGTH) return "PASSWORD_TOO_LONG";
  const folded = normalized.toLowerCase();
  const stripped = folded.replace(/[^a-z0-9@]/g, "");
  if (COMMON_PASSWORDS.has(folded) || COMMON_PASSWORDS.has(stripped) || COMMON_PASSWORDS.has(stripped.replace(/\d+$/, ""))) {
    return "PASSWORD_TOO_COMMON";
  }
  if (new Set([...folded]).size <= 3) return "PASSWORD_REPETITIVE";
  if (loginIdentifier) {
    const local = loginIdentifier.toLowerCase().split("@")[0];
    if (local.length >= 4 && folded.includes(local)) return "PASSWORD_CONTAINS_IDENTIFIER";
  }
  return null;
}

// ════════════════════ opaque one-time tokens ════════════════════

/** Every opaque credential EOS hands out. The prefix lets a leaked token be recognised by a secret scanner. */
export const OPAQUE_TOKEN_PREFIX = Object.freeze({
  refresh: "eosrt_",
  enrollment: "eoset_",
  reset: "eospr_",
  mfaChallenge: "eosmc_",
} as const);
export type OpaqueTokenKind = keyof typeof OPAQUE_TOKEN_PREFIX;

export function newOpaqueToken(kind: OpaqueTokenKind): string {
  return `${OPAQUE_TOKEN_PREFIX[kind]}${randomBytes(32).toString("base64url")}`;
}

/** The ONLY form an opaque token is stored in. */
export const opaqueTokenDigest = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** Does this string look like a token of this kind? Shape only -- the digest lookup is the check. */
export function isOpaqueTokenOf(kind: OpaqueTokenKind, value: unknown): value is string {
  return typeof value === "string" && value.startsWith(OPAQUE_TOKEN_PREFIX[kind])
    && /^[A-Za-z0-9_-]{43}$/.test(value.slice(OPAQUE_TOKEN_PREFIX[kind].length));
}

// ════════════════════ factor-secret encryption ════════════════════

/**
 * The factor key: 32 bytes, from EOS_AUTH_FACTOR_KEYS (JSON { "<kid>": "<base64url 32 bytes>" }) with
 * EOS_AUTH_FACTOR_KEY_ID naming the one new secrets are written under. Older kids stay readable for rotation.
 */
export interface FactorKeyring {
  readonly currentKid: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

export class FactorKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactorKeyError";
  }
}

const FACTOR_KID = /^[A-Za-z0-9-]{1,32}$/;

export function parseFactorKeyring(rawKeys: string | Record<string, string>, currentKid: string): FactorKeyring {
  let obj: Record<string, unknown>;
  try {
    obj = typeof rawKeys === "string" ? JSON.parse(rawKeys) : rawKeys;
  } catch {
    throw new FactorKeyError("EOS_AUTH_FACTOR_KEYS is not JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new FactorKeyError("EOS_AUTH_FACTOR_KEYS must be a JSON object");
  const keys = new Map<string, Buffer>();
  for (const [kid, value] of Object.entries(obj)) {
    if (!FACTOR_KID.test(kid)) throw new FactorKeyError("a factor key id must be 1-32 of [A-Za-z0-9-]");
    const key = typeof value === "string" ? Buffer.from(value, "base64url") : Buffer.alloc(0);
    if (key.length !== 32) throw new FactorKeyError("every factor key must be 32 bytes, base64url");
    keys.set(kid, key);
  }
  if (keys.size === 0 || keys.size > 4) throw new FactorKeyError("EOS_AUTH_FACTOR_KEYS must hold between 1 and 4 keys");
  if (!keys.has(currentKid)) throw new FactorKeyError("EOS_AUTH_FACTOR_KEY_ID is not in EOS_AUTH_FACTOR_KEYS");
  return Object.freeze({ currentKid, keys });
}

/** v1.<kid>.<iv>.<ciphertext>.<tag>, AES-256-GCM, with `binding` (the factor id) as additional data. */
export function encryptFactorSecret(keyring: FactorKeyring, secret: Buffer, binding: string): string {
  const key = keyring.keys.get(keyring.currentKid) as Buffer;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding, "utf8"));
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", keyring.currentKid, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptFactorSecret(keyring: FactorKeyring, sealed: string, binding: string): Buffer {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") throw new FactorKeyError("a sealed factor secret is malformed");
  const key = keyring.keys.get(parts[1]);
  if (!key) throw new FactorKeyError("a sealed factor secret names a factor key this service does not hold");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2], "base64url"));
    decipher.setAAD(Buffer.from(binding, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]);
  } catch {
    throw new FactorKeyError("a sealed factor secret did not authenticate");
  }
}

// ════════════════════ TOTP (RFC 6238 / RFC 4226) ════════════════════

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step as well: phone clocks drift. */
export const TOTP_WINDOW_STEPS = 1;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const newTotpSecret = (): Buffer => randomBytes(20);

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function totpCodeAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export const totpStepAt = (unixSeconds: number): number => Math.floor(unixSeconds / TOTP_PERIOD_SECONDS);

/**
 * The step a code matches, or null. The caller REFUSES a step at or below the factor's last accepted step, so a
 * code -- even an observed one -- works once.
 */
export function matchTotpStep(secret: Buffer, code: unknown, unixSeconds: number): number | null {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const now = totpStepAt(unixSeconds);
  let matched: number | null = null;
  for (let d = -TOTP_WINDOW_STEPS; d <= TOTP_WINDOW_STEPS; d += 1) {
    const candidate = Buffer.from(totpCodeAt(secret, now + d), "ascii");
    // Every step is compared, matched or not, so the time does not say which one matched.
    if (timingSafeEqual(candidate, Buffer.from(code, "ascii")) && matched === null) matched = now + d;
  }
  return matched;
}

export function totpProvisioningUri(input: { issuerLabel: string; accountLabel: string; secret: Buffer }): string {
  const label = encodeURIComponent(`${input.issuerLabel}:${input.accountLabel}`);
  const params = new URLSearchParams({
    secret: base32Encode(input.secret), issuer: input.issuerLabel, algorithm: "SHA1",
    digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ════════════════════ recovery codes ════════════════════

export const RECOVERY_CODE_COUNT = 10;
/** Crockford-style alphabet without I, L, O, U: nothing a person can misread. 12 symbols = 60 bits. */
const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let s = "";
    for (let i = 0; i < 12; i += 1) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  });
}

/** Case, spacing and dashes are not part of the code. */
export function normalizeRecoveryCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const s = code.toUpperCase().replace(/[\s-]/g, "");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
}

export function recoveryCodeDigest(keyring: FactorKeyring, accountId: string, normalized: string): string {
  const key = keyring.keys.get(keyring.currentKid) as Buffer;
  return createHmac("sha256", key).update(`eos-recovery-code\u0000${accountId}\u0000${normalized}`, "utf8").digest("hex");
}
