// EOS NATIVE LOGIN -- the parts that need no database. docs/architecture/eos-native-identity.md, section 6 (U1-U10).
import "./support/firebaseOfflineGuard.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../lib/eosAuth/credentialCrypto.js");
const T = require("../lib/eosAuth/eosAccessToken.js");
const H = require("../lib/eosAuth/eosAuthHttp.js");
const L = require("../lib/eosAuth/eosLoginHttp.js");
const S = require("../lib/eosAuth/eosLoginService.js");
const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");

test("U1 password hashing: scrypt at OWASP parameters, self-describing, verified, upgradable", async () => {
  const h = await C.hashPassword("correct horse battery staple");
  assert.match(h, /^scrypt\$N=131072,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await C.verifyPassword("correct horse battery staple", h), { matches: true, needsRehash: false });
  assert.equal((await C.verifyPassword("correct horse battery stapl", h)).matches, false);
  assert.notEqual(await C.hashPassword("same"), await C.hashPassword("same"), "salted");
  const weak = await C.hashPassword("legacy password!", { N: 2 ** 14, r: 8, p: 1 });
  assert.deepEqual(await C.verifyPassword("legacy password!", weak), { matches: true, needsRehash: true });
  // NFKC: the full-width form of a password is the same password.
  assert.equal((await C.verifyPassword("ｃｏｒｒｅｃｔ horse battery staple", h)).matches, true);
  // Refused stored shapes never verify (and never throw): too-weak N, too-large N, garbage, null.
  for (const bad of ["scrypt$N=1024,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(43), "scrypt$N=4194304,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(43), "md5$x", null]) {
    assert.equal((await C.verifyPassword("x", bad)).matches, false);
  }
});

test("U2 password policy (NIST 800-63B): length, commonness, repetition, identifier", () => {
  assert.equal(C.passwordPolicyRefusal("short", null), "PASSWORD_TOO_SHORT");
  assert.equal(C.passwordPolicyRefusal("x".repeat(129) + "yz", null), "PASSWORD_TOO_LONG");
  assert.equal(C.passwordPolicyRefusal("Password1234", null), "PASSWORD_TOO_COMMON");
  assert.equal(C.passwordPolicyRefusal("Welcome123!!", null), "PASSWORD_TOO_COMMON");
  assert.equal(C.passwordPolicyRefusal("abababababab", null), "PASSWORD_REPETITIVE");
  assert.equal(C.passwordPolicyRefusal("my name is jdoe really", "jdoe@taylor.test"), "PASSWORD_CONTAINS_IDENTIFIER");
  assert.equal(C.passwordPolicyRefusal("correct horse battery staple", "jdoe@taylor.test"), null);
  assert.equal(C.passwordPolicyRefusal(42, null), "PASSWORD_TOO_SHORT");
});

test("U3 TOTP: RFC 6238 SHA-1 vector, window of one step, base32, provisioning URI", () => {
  const secret = Buffer.from("12345678901234567890", "ascii");
  // RFC 6238 Appendix B, T=59 -> 94287082 (8 digits); the 6-digit code is its last six.
  assert.equal(C.totpCodeAt(secret, C.totpStepAt(59)), "287082");
  assert.equal(C.totpCodeAt(secret, C.totpStepAt(1111111109)), "081804");
  assert.equal(C.totpCodeAt(secret, C.totpStepAt(2000000000)), "279037");
  const now = 1111111109;
  const step = C.totpStepAt(now);
  assert.equal(C.matchTotpStep(secret, C.totpCodeAt(secret, step), now), step);
  assert.equal(C.matchTotpStep(secret, C.totpCodeAt(secret, step - 1), now), step - 1);
  assert.equal(C.matchTotpStep(secret, C.totpCodeAt(secret, step + 1), now), step + 1);
  assert.equal(C.matchTotpStep(secret, C.totpCodeAt(secret, step + 2), now), null);
  assert.equal(C.matchTotpStep(secret, "12345", now), null);
  assert.equal(C.matchTotpStep(secret, 287082, now), null);
  assert.equal(C.base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.match(C.totpProvisioningUri({ issuerLabel: "Verenward EOS", accountLabel: "a@b.test", secret }),
    /^otpauth:\/\/totp\/Verenward%20EOS%3Aa%40b\.test\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Verenward\+EOS&algorithm=SHA1&digits=6&period=30$/);
});

test("U4 factor secrets: AES-256-GCM, bound to the factor id, rotatable keyring", () => {
  const k1 = randomBytes(32).toString("base64url");
  const k2 = randomBytes(32).toString("base64url");
  const ring1 = C.parseFactorKeyring(JSON.stringify({ k1 }), "k1");
  const secret = randomBytes(20);
  const sealed = C.encryptFactorSecret(ring1, secret, "factor-A");
  assert.match(sealed, /^v1\.k1\./);
  assert.ok(!sealed.includes(secret.toString("base64url")));
  assert.deepEqual(C.decryptFactorSecret(ring1, sealed, "factor-A"), secret);
  assert.throws(() => C.decryptFactorSecret(ring1, sealed, "factor-B"), /did not authenticate/, "a sealed secret moved to another factor fails");
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
  assert.throws(() => C.decryptFactorSecret(ring1, tampered, "factor-A"), /did not authenticate/);
  const ring2 = C.parseFactorKeyring({ k1, k2 }, "k2");
  assert.deepEqual(C.decryptFactorSecret(ring2, sealed, "factor-A"), secret, "an old key stays readable after rotation");
  assert.match(C.encryptFactorSecret(ring2, secret, "factor-A"), /^v1\.k2\./);
  assert.throws(() => C.parseFactorKeyring({ k1: "short" }, "k1"), /32 bytes/);
  assert.throws(() => C.parseFactorKeyring({ k1, k3: k1 }, "k1"), /same key material/, "a re-labelled key is not a rotation");
  assert.throws(() => C.parseFactorKeyring({ z: Buffer.alloc(32).toString("base64url") }, "z"), /all zero/);
  // KEY SEPARATION: the root key is never used directly; each purpose has its own HKDF subkey.
  const seal = C.factorSubkey(ring1, "k1", "seal");
  const rec = C.factorSubkey(ring1, "k1", "recovery");
  const cli = C.factorSubkey(ring1, "k1", "client");
  const root = Buffer.from(k1, "base64url");
  assert.equal(new Set([seal, rec, cli, root].map((b) => b.toString("hex"))).size, 4);
  assert.equal(C.sealedFactorKid(sealed), "k1");
  // MISSING KEY: a ring without k1 cannot open k1 material, and says which kid it lacks.
  const ring3 = C.parseFactorKeyring({ k2 }, "k2");
  assert.throws(() => C.decryptFactorSecret(ring3, sealed, "factor-A"), (e) => e instanceof C.FactorKeyError && e.kid === "k1");
  assert.throws(() => C.parseFactorKeyring({ k1 }, "k9"), /not in EOS_AUTH_FACTOR_KEYS/);
});

test("U5 recovery codes and opaque tokens: shape, normalisation, keyed digests", () => {
  const codes = C.newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(C.normalizeRecoveryCode(` ${codes[0].toLowerCase()} `), codes[0].replace(/-/g, ""));
  assert.equal(C.normalizeRecoveryCode("IIII-LLLL-OOOO"), null);
  const ring = C.parseFactorKeyring({ k: randomBytes(32).toString("base64url") }, "k");
  const n = C.normalizeRecoveryCode(codes[0]);
  assert.notEqual(C.recoveryCodeDigest(ring, "k", "acct-1", n), C.recoveryCodeDigest(ring, "k", "acct-2", n), "per-account");
  assert.throws(() => C.recoveryCodeDigest(ring, "gone", "acct-1", n), (e) => e instanceof C.FactorKeyError && e.kid === "gone");
  const tok = C.newOpaqueToken("refresh");
  assert.ok(C.isOpaqueTokenOf("refresh", tok));
  assert.ok(!C.isOpaqueTokenOf("reset", tok), "kinds do not cross");
  assert.match(C.opaqueTokenDigest(tok), /^[0-9a-f]{64}$/);
});

const ISS = "https://eos.test/auth";
const AUD = "https://eos.test";
const keys = generateKeyPairSync("ed25519");
const signer = { kid: "nonprod-u", privateKey: keys.privateKey };
const verify = T.createEosTokenVerifier({ environment: "nonprod", issuer: ISS, audience: AUD, keys: new Map([["nonprod-u", keys.publicKey]]) });
const now = () => Math.floor(Date.now() / 1000);
const mint = (claims) => T.signEosAccessToken(signer, { iss: ISS, aud: AUD, iat: now(), exp: now() + 60, jti: T.newTokenId(), env: "nonprod", ...claims });
const HUMAN = `user.${"ab".repeat(16)}`;

test("U6 the sid claim: optional, shaped, returned; nothing else joins the claim set", () => {
  assert.equal(verify(mint({ sub: "nonprod-persona.dispatcher" })).sessionId, null);
  assert.equal(verify(mint({ sub: HUMAN, sid: "s".repeat(32) })).sessionId, "s".repeat(32));
  assert.throws(() => mint({ sub: HUMAN, sid: "bad sid!" }), /session id is malformed/);
  assert.throws(() => mint({ sub: HUMAN, sid: "s".repeat(32), roles: ["admin"] }), /not part of the EOS token/);
  assert.ok(T.AUTHORITY_BEARING_CLAIMS.includes("roles"));
  assert.ok(!T.AUTHORITY_BEARING_CLAIMS.includes("sid"));
});

test("U7 the composite verifier: human tokens need a sid, a passing gate AND a request scope to bind; persona tokens carry none", async () => {
  const B = require("../lib/eosAuth/requestTenantBinding.js");
  const eos = { verify, issuer: ISS, audience: AUD, personaIssuer: null, humanLogin: null };
  const firebase = async () => ({ externalSubject: "fb", identityProvider: "firebase" });
  const gateCalls = [];
  const gate = async (subject, sid) => {
    gateCalls.push([subject, sid]);
    if (sid === "r".repeat(32)) throw new S.LoginRefusal("SESSION_INVALID");
    return { tenantId: "tenant-A" };
  };
  const withGate = H.createCompositeTokenVerifier({ eos, firebase, humanSessionGate: gate });
  const without = H.createCompositeTokenVerifier({ eos, firebase });
  const inScope = (fn) => B.runWithRequestScope(fn);
  // Inside a request scope: verified AND bound to the session's tenant.
  await inScope(async () => {
    assert.deepEqual(await withGate(mint({ sub: HUMAN, sid: "s".repeat(32) })), { externalSubject: HUMAN, identityProvider: "eos" });
    assert.equal(B.sessionTenantBindingFor("eos", HUMAN).tenantId, "tenant-A");
    assert.equal(B.sessionTenantBindingFor("eos", "user.other"), null, "the binding is for that identity only");
  });
  // FAIL CLOSED: outside any request scope a human token cannot be bound, so it is refused.
  await assert.rejects(withGate(mint({ sub: HUMAN, sid: "s".repeat(32) })), /CLAIM_REFUSED/);
  // Scopes never leak into each other.
  await inScope(async () => assert.equal(B.sessionTenantBindingFor("eos", HUMAN), null));
  await inScope(() => assert.rejects(withGate(mint({ sub: HUMAN, sid: "r".repeat(32) })), /SESSION_INVALID/));
  await inScope(() => assert.rejects(withGate(mint({ sub: HUMAN })), /CLAIM_REFUSED/));
  await inScope(() => assert.rejects(without(mint({ sub: HUMAN, sid: "s".repeat(32) })), /CLAIM_REFUSED/, "front door off: human tokens refused"));
  assert.equal((await without(mint({ sub: "nonprod-persona.dispatcher" }))).externalSubject, "nonprod-persona.dispatcher");
  await inScope(() => assert.rejects(withGate(mint({ sub: "nonprod-persona.dispatcher", sid: "s".repeat(32) })), /CLAIM_REFUSED/));
  assert.equal(gateCalls.filter(([sub]) => sub !== HUMAN).length, 0, "the gate never runs for persona tokens");
});

test("U8 human subjects and login identifiers", () => {
  assert.ok(S.isHumanSubject(S.newHumanSubject()));
  assert.ok(!S.isHumanSubject("nonprod-persona.dispatcher"));
  assert.ok(!S.isHumanSubject("user.ABC"));
  assert.equal(S.normalizeLoginIdentifier("  Jane.Doe+eos@Taylor.TEST "), "jane.doe+eos@taylor.test");
  assert.equal(S.normalizeLoginIdentifier("a b@c"), null);
  assert.equal(S.normalizeLoginIdentifier("ab"), null);
});

test("U9 rate limiter: per address and budget, fixed one-minute window, Retry-After", () => {
  let t = 1_000_000;
  const allow = L.createRateLimiter({ credentialPerMinute: 3, routinePerMinute: 5 }, () => t);
  for (let i = 0; i < 3; i += 1) assert.ok(allow("1.1.1.1", "credential").ok);
  const v = allow("1.1.1.1", "credential");
  assert.equal(v.ok, false);
  assert.equal(v.retryAfterSeconds, 60);
  assert.ok(allow("2.2.2.2", "credential").ok, "another address is independent");
  assert.ok(allow("1.1.1.1", "routine").ok, "another budget is independent");
  t += 60_000;
  assert.ok(allow("1.1.1.1", "credential").ok, "the window resets");
});

test("U10 the pure handler: 404 off-route, POST only, 429 before any work, X-Forwarded-For rightmost hop", async () => {
  const calls = [];
  const service = { login: async (input, facts) => { calls.push(facts); return { status: "AUTHENTICATED", session: {} }; } };
  const limiterSeen = [];
  const rateLimit = (address) => { limiterSeen.push(address); return limiterSeen.length > 1 ? { ok: false, retryAfterSeconds: 7 } : { ok: true, retryAfterSeconds: 0 }; };
  const opts = { service, verify, allowedOrigins: ["https://app.test"], rateLimit, trustedProxyHops: 1, cookieSameSite: "None" };
  const browser = { origin: "https://app.test", "x-eos-csrf": "1", "content-type": "application/json" };
  assert.equal((await L.handleLoginRequest(opts, { method: "POST", url: "/auth/nope" })).status, 404);
  assert.equal((await L.handleLoginRequest(opts, { method: "GET", url: "/auth/login" })).status, 405);
  const ok = await L.handleLoginRequest(opts, { method: "POST", url: "/auth/login", body: "{}", remoteAddress: "10.0.0.1",
    headers: { ...browser, "x-forwarded-for": "6.6.6.6, 203.0.113.9", "user-agent": "UA" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(ok.headers["access-control-allow-origin"], "https://app.test");
  assert.deepEqual(calls[0], { address: "203.0.113.9", label: "UA" }, "the proxy-appended hop, never the client's claim");
  const limited = await L.handleLoginRequest(opts, { method: "POST", url: "/auth/login", body: "{}", remoteAddress: "10.0.0.1", headers: browser });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "7");
  assert.equal(calls.length, 1, "a limited request spends no password work");
  // Self-service needs a human login session.
  const persona = await L.handleLoginRequest({ ...opts, rateLimit: undefined }, { method: "POST", url: "/auth/account", body: "{}",
    headers: { ...browser, authorization: `Bearer ${mint({ sub: "nonprod-persona.dispatcher" })}` } });
  assert.equal(persona.status, 403);
});

test("U11 configuration: the front door needs a verifier and signing key; factor keys need the front door", () => {
  const kp = generateKeyPairSync("ed25519");
  const base = {
    EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-c": kp.publicKey.export({ format: "jwk" }) }),
    EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD,
  };
  const signing = { EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(kp.privateKey.export({ format: "jwk" })), EOS_AUTH_SIGNING_KID: "nonprod-c" };
  const factor = { EOS_AUTH_FACTOR_KEYS: JSON.stringify({ f: randomBytes(32).toString("base64url") }), EOS_AUTH_FACTOR_KEY_ID: "f" };
  assert.equal(readEosAuthConfig({ ...base, ...signing }, "nonprod").humanLogin, null, "off by default");
  assert.throws(() => readEosAuthConfig({ ...base, EOS_HUMAN_LOGIN: "enabled" }, "nonprod"), /requires EOS_AUTH_SIGNING_KEY_NONPROD/);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...factor }, "nonprod"), /EOS_HUMAN_LOGIN is not enabled/);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_FACTOR_KEYS: factor.EOS_AUTH_FACTOR_KEYS }, "nonprod"), /must be set together/);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, EOS_HUMAN_LOGIN: "enabled" }, "nonprod"), /EOS_AUTH_COOKIE_SAMESITE/);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_COOKIE_SAMESITE: "Strict" }, "nonprod"), /EOS_AUTH_TRUSTED_PROXY_HOPS/);
  const cookie = { EOS_AUTH_COOKIE_SAMESITE: "Strict", EOS_AUTH_TRUSTED_PROXY_HOPS: "1" };
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...cookie, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_MULTI_TENANT_SESSIONS: "yes" }, "nonprod"), /EOS_AUTH_MULTI_TENANT_SESSIONS/);
  assert.equal(readEosAuthConfig({ ...base, ...signing, ...cookie, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_MULTI_TENANT_SESSIONS: "enabled" }, "nonprod").humanLogin.multiTenantSessions, true);
  const on = readEosAuthConfig({ ...base, ...signing, ...cookie, EOS_HUMAN_LOGIN: "enabled" }, "nonprod");
  assert.equal(on.humanLogin.cookieSameSite, "Strict");
  assert.equal(on.humanLogin.trustedProxyHops, 1);
  assert.equal(on.humanLogin.multiTenantSessions, false, "multi-tenant sessions are OFF unless enabled");
  assert.equal(on.humanLogin.clientIpHeader, null);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...cookie, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_CLIENT_IP_HEADER: "x-real-ip" }, "nonprod"), /EOS_AUTH_CLIENT_IP_HEADER/);
  assert.equal(on.humanLogin.factorKeyring, null, "password-only is a valid configuration");
  assert.ok(readEosAuthConfig({ ...base, ...signing, ...factor, ...cookie, EOS_HUMAN_LOGIN: "enabled" }, "nonprod").humanLogin.factorKeyring);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...cookie }, "nonprod"), /EOS_HUMAN_LOGIN is not enabled/);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...cookie, EOS_HUMAN_LOGIN: "enabled",
    EOS_AUTH_FACTOR_KEYS: JSON.stringify({ f: "short" }), EOS_AUTH_FACTOR_KEY_ID: "f" }, "nonprod"), /32 bytes/, "a malformed factor key refuses startup");
  // Production stays refused at the service level, front door or not.
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...cookie, EOS_HUMAN_LOGIN: "enabled" }, "production"), /EOS_ENVIRONMENT=nonprod/);
});

test("U12 the refresh cookie and the CSRF gate, at the pure handler", async () => {
  const issued = { tokenType: "Bearer", accessToken: "a.b.c", accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    refreshToken: `eosrt_${"R".repeat(43)}`, refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(), sessionId: "s".repeat(32), mfaEnrollmentRequired: false };
  const seen = [];
  const service = {
    login: async () => ({ status: "AUTHENTICATED", session: issued }),
    refresh: async ({ refreshToken }) => { seen.push(refreshToken); if (refreshToken !== issued.refreshToken) throw new S.LoginRefusal("REFRESH_REFUSED"); return issued; },
    logout: async ({ refreshToken }) => { seen.push(`logout:${refreshToken}`); },
  };
  const browser = { origin: "https://app.test", "x-eos-csrf": "1", "content-type": "application/json" };
  for (const sameSite of ["Strict", "Lax", "None"]) {
    const opts = { service, verify, allowedOrigins: ["https://app.test"], cookieSameSite: sameSite, trustedProxyHops: 0 };
    const r = await L.handleLoginRequest(opts, { method: "POST", url: "/auth/login", body: "{}", headers: browser });
    const body = JSON.parse(r.body);
    assert.equal(body.session.refreshToken, undefined, "never in the body");
    assert.equal(body.session.accessToken, "a.b.c");
    const c = r.headers["set-cookie"];
    assert.match(c, new RegExp(`^__Host-eos_refresh=eosrt_R{43}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=(359[0-9]|3600)`));
    assert.equal(c.includes("Partitioned"), sameSite === "None", "Partitioned exactly when SameSite=None");
  }
  const opts = { service, verify, allowedOrigins: ["https://app.test"], cookieSameSite: "Strict", trustedProxyHops: 0 };
  // The cookie is the ONLY refresh credential: a body token is ignored.
  seen.length = 0;
  await L.handleLoginRequest(opts, { method: "POST", url: "/auth/refresh", body: JSON.stringify({ refreshToken: issued.refreshToken }), headers: browser });
  assert.deepEqual(seen, [null]);
  const good = await L.handleLoginRequest(opts, { method: "POST", url: "/auth/refresh", body: "{}", headers: { ...browser, cookie: `a=1; __Host-eos_refresh=${issued.refreshToken}; b=2` } });
  assert.equal(good.status, 200);
  const bad = await L.handleLoginRequest(opts, { method: "POST", url: "/auth/refresh", body: "{}", headers: { ...browser, cookie: "__Host-eos_refresh=eosrt_x" } });
  assert.equal(bad.status, 401);
  assert.match(bad.headers["set-cookie"], /Max-Age=0/);
  const out = await L.handleLoginRequest(opts, { method: "POST", url: "/auth/logout", body: "{}", headers: { ...browser, cookie: `__Host-eos_refresh=${issued.refreshToken}` } });
  assert.match(out.headers["set-cookie"], /^__Host-eos_refresh=; .*Max-Age=0/);
  // The gate, route by route: every human route refuses without Origin, with a foreign Origin, without the header, non-JSON.
  for (const route of Object.values(L.LOGIN_ROUTES)) {
    const at = (headers) => L.handleLoginRequest(opts, { method: "POST", url: route, body: "{}", headers });
    assert.equal((await at({ ...browser, origin: undefined })).status, 403, route);
    assert.equal((await at({ ...browser, origin: "https://evil.test" })).status, 403, route);
    assert.equal((await at({ ...browser, "x-eos-csrf": undefined })).status, 403, route);
    assert.equal((await at({ ...browser, "content-type": "text/plain" })).status, 415, route);
  }
  assert.equal(L.readRefreshCookie(undefined), null);
  assert.equal(L.readRefreshCookie("__Host-eos_refresh="), null);
  assert.equal(L.readRefreshCookie(["x=1", "__Host-eos_refresh=eosrt_a"]), "eosrt_a");
});

test("U13 review findings 5, 6, 13: IPv6 /64 buckets, explicit proxy hops, LRU eviction, bounded hash queue, capped stored parameters", async () => {
  assert.equal(L.rateLimitBucket("203.0.113.9"), "203.0.113.9");
  assert.equal(L.rateLimitBucket("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(L.rateLimitBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(L.rateLimitBucket("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(L.rateLimitBucket("2001:db8::1"), "2001:db8:0:0::/64");
  // One attacker rotating through a /64 shares one budget.
  let t = 0;
  const allow = L.createRateLimiter({ credentialPerMinute: 2, routinePerMinute: 2 }, () => t);
  assert.ok(allow("2001:db8:1:2::1", "credential").ok);
  assert.ok(allow("2001:db8:1:2::2", "credential").ok);
  assert.equal(allow("2001:db8:1:2::3", "credential").ok, false);
  // Eviction is oldest-first, never "everyone": an early, still-limited client keeps its count while new ones arrive.
  const many = L.createRateLimiter({ credentialPerMinute: 1, routinePerMinute: 1 }, () => t);
  assert.ok(many("10.0.0.1", "credential").ok);
  assert.equal(many("10.0.0.1", "credential").ok, false);
  for (let i = 0; i < 100; i += 1) many(`10.1.${i >> 8}.${i & 255}`, "credential");
  assert.equal(many("10.0.0.1", "credential").ok, false, "a flood of new addresses does not reset an existing budget");

  // Proxy hops: the client is the hops-th entry from the right; too few entries -> the socket address.
  const facts = [];
  const service = { login: async (_i, f) => { facts.push(f.address); return { status: "MFA_REQUIRED", challenge: "eosmc_x", methods: [] }; } };
  const browser = { origin: "https://app.test", "x-eos-csrf": "1", "content-type": "application/json" };
  const at = (hops, xff) => L.handleLoginRequest({ service, verify, allowedOrigins: ["https://app.test"], cookieSameSite: "Strict", trustedProxyHops: hops },
    { method: "POST", url: "/auth/login", body: "{}", remoteAddress: "10.9.9.9", headers: { ...browser, ...(xff ? { "x-forwarded-for": xff } : {}) } });
  await at(0, "6.6.6.6, 203.0.113.1");
  await at(1, "6.6.6.6, 203.0.113.1");
  await at(2, "6.6.6.6, 203.0.113.1, 198.51.100.7");
  await at(2, "203.0.113.1");
  assert.deepEqual(facts, ["10.9.9.9", "203.0.113.1", "203.0.113.1", "10.9.9.9"]);
  // An edge-SET header (EOS_AUTH_CLIENT_IP_HEADER) wins over hop counting; a non-address value is ignored, never trusted.
  const viaHeader = (value) => L.handleLoginRequest({ service, verify, allowedOrigins: ["https://app.test"], cookieSameSite: "Strict",
    trustedProxyHops: 1, clientIpHeader: "true-client-ip" }, { method: "POST", url: "/auth/login", body: "{}", remoteAddress: "10.9.9.9",
    headers: { ...browser, "x-forwarded-for": "6.6.6.6, 198.51.100.7", ...(value === undefined ? {} : { "true-client-ip": value }) } });
  await viaHeader("203.0.113.44");
  await viaHeader("<script>");
  await viaHeader(undefined);
  assert.deepEqual(facts.slice(4), ["203.0.113.44", "198.51.100.7", "198.51.100.7"]);

  // Stored parameters above N=2^18 / r=8 are refused (never evaluated).
  const big = "scrypt$N=524288,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(43);
  assert.equal((await C.verifyPassword("x", big)).matches, false);
  const wide = "scrypt$N=131072,r=16,p=1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(43);
  assert.equal((await C.verifyPassword("x", wide)).matches, false);

  // The hash queue is bounded: past MAX_QUEUED_HASHES waiters, work is refused at once -- and the handler says 503.
  const burst = await Promise.allSettled(Array.from({ length: C.MAX_QUEUED_HASHES + 8 }, () => C.burnPasswordWork("x")));
  const refused = burst.filter((r) => r.status === "rejected");
  assert.ok(refused.length >= 1 && refused.every((r) => r.reason instanceof C.PasswordWorkSaturated), `refused ${refused.length}`);
  assert.ok(burst.filter((r) => r.status === "fulfilled").length >= C.MAX_QUEUED_HASHES);
  const busy = await L.handleLoginRequest({ service: { login: async () => { throw new C.PasswordWorkSaturated(); } }, verify,
    allowedOrigins: ["https://app.test"], cookieSameSite: "Strict", trustedProxyHops: 0 }, { method: "POST", url: "/auth/login", body: "{}", headers: browser });
  assert.equal(busy.status, 503);
  assert.equal(JSON.parse(busy.body).code, "TRY_LATER");
});

test("U14 the client-address measurement: unmounted by default, credential-gated, nonprod only, echoes address facts only", async () => {
  const { createServer } = await import("node:http");
  const { createHash } = await import("node:crypto");
  const D = require("../lib/eosAuth/clientIpDiagnostic.js");
  const kp = generateKeyPairSync("ed25519");
  const base = { EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-d": kp.publicKey.export({ format: "jwk" }) }), EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD };
  const credential = randomBytes(32).toString("base64url");
  const sha = createHash("sha256").update(credential).digest("hex");
  assert.equal(readEosAuthConfig(base, "nonprod").clientIpDiagnosticSha256, undefined, "off by default");
  assert.throws(() => readEosAuthConfig({ ...base, EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256: "abc" }, "nonprod"), /64 hex/);
  assert.throws(() => readEosAuthConfig({ ...base, EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256: sha }, "production"), /EOS_ENVIRONMENT=nonprod|nonprod only/);
  assert.equal(readEosAuthConfig({ ...base, EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256: sha }, "nonprod").clientIpDiagnosticSha256, sha);
  // Pure candidates: the Nth-from-right hop, the edge headers, the socket fallback.
  const c = D.clientAddressCandidates({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.1.1", "true-client-ip": "203.0.113.9", cookie: "secret" }, "10.9.9.9");
  assert.equal(c.delivered.xForwardedForEntries, 3);
  assert.equal(c.wouldResolve["EOS_AUTH_TRUSTED_PROXY_HOPS=2"], "203.0.113.9");
  assert.equal(c.wouldResolve["EOS_AUTH_CLIENT_IP_HEADER=true-client-ip"], "203.0.113.9");
  assert.equal(c.wouldResolve["EOS_AUTH_CLIENT_IP_HEADER=cf-connecting-ip"], "10.9.9.9");
  assert.ok(!JSON.stringify(c).includes("secret"), "no other header is echoed");
  // Mounted through the real /auth/* handler only when configured.
  const serve = async (auth) => {
    const handler = H.createEosAuthHttpHandler({ repo: {}, auth, environment: "nonprod" });
    const srv = createServer((req, res) => { handler(req, res); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    return { srv, url: `http://127.0.0.1:${srv.address().port}${D.CLIENT_IP_DIAGNOSTIC_ROUTE}` };
  };
  const off = await serve({ verify: null, issuer: null, audience: null, personaIssuer: null, humanLogin: null });
  assert.equal((await fetch(off.url, { method: "POST" })).status, 404);
  off.srv.close();
  const on = await serve({ verify: null, issuer: null, audience: null, personaIssuer: null, humanLogin: null, clientIpDiagnosticSha256: sha });
  assert.equal((await fetch(on.url, { method: "POST" })).status, 401);
  assert.equal((await fetch(on.url, { method: "POST", headers: { [D.CLIENT_IP_DIAGNOSTIC_HEADER]: "x".repeat(43) } })).status, 401);
  const r = await fetch(on.url, { method: "POST", headers: { [D.CLIENT_IP_DIAGNOSTIC_HEADER]: credential, "x-forwarded-for": "198.51.100.1", cookie: "__Host-eos_refresh=eosrt_x" } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.delivered.xForwardedFor, "198.51.100.1");
  assert.ok(!JSON.stringify(body).includes("eosrt_"), "the cookie is never echoed");
  assert.equal(r.headers.get("cache-control"), "no-store");
  on.srv.close();
});
