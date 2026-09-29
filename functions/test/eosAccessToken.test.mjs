// THE EOS ACCESS TOKEN, VERIFIER, COMPOSITE SEAM AND ISSUER -- proved offline, with keys generated IN MEMORY
// for this run only. docs/architecture/eos-identity-session-foundation.md, proofs 1-7.
//
// The Firebase test-safety guard is loaded FIRST (offline mode): nothing in this file may reach a network,
// a Google project or ambient credentials, and the guard makes any attempt fail loudly.
import "./support/firebaseOfflineGuard.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const tok = require("../lib/eosAuth/eosAccessToken.js");
const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");
const { createCompositeTokenVerifier } = require("../lib/eosAuth/eosAuthHttp.js");
const { issueNonprodPersonaSession, PersonaIssuanceError } = require("../lib/eosAuth/eosSessionIssuer.js");
const { NONPROD_PERSONA_KEYS, nonprodPersonaSubject } = require("../lib/eosAuth/nonprodPersonas.js");
const { readServiceConfig, ServiceConfigError } = require("../lib/eosApi/server.js");
const { InMemoryPolicyRepository } = require("../lib/adminPolicy/inMemoryPolicyRepository.js");
const { resolvePrincipalContext, resolvePrincipalByVerifiedIdentity, PrincipalContextError } = require("../lib/adminPolicy/principalContext.js");

const ISS = "https://eos-api-nonprod.example/auth";
const AUD = "https://eos-api-nonprod.example";
const PROD_ISS = "https://eos-api.example/auth";
const PROD_AUD = "https://eos-api.example";
const NOW = 1_900_000_000;
const clock = () => NOW;

const keyPair = () => generateKeyPairSync("ed25519");
const k1 = keyPair();
const k2 = keyPair();
const signer = { kid: "nonprod-k1", privateKey: k1.privateKey };
const claims = (over = {}) => ({ iss: ISS, aud: AUD, sub: "nonprod-persona.dispatcher", iat: NOW, exp: NOW + 900, jti: tok.newTokenId(), env: "nonprod", ...over });
const nonprodVerifier = (over = {}) => tok.createEosTokenVerifier({
  environment: "nonprod", issuer: ISS, audience: AUD, keys: new Map([["nonprod-k1", k1.publicKey]]), nowSeconds: clock, ...over,
});
const refusedWith = (fn, refusal) => assert.throws(fn, (e) => e instanceof tok.EosTokenError && e.refusal === refusal, `expected ${refusal}`);

/** Hand-assemble a JWS so malformed shapes can be produced that the signer refuses to emit. */
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function rawToken(header, payload, key = k1.privateKey) {
  const input = `${b64(header)}.${b64(payload)}`;
  const { sign } = require("node:crypto");
  return `${input}.${sign(null, Buffer.from(input), key).toString("base64url")}`;
}

// ════════════════════ 1. accepted ════════════════════

test("1. a well-formed EOS token is accepted by the nonprod verifier and yields ONLY (eos, sub)", () => {
  const v = nonprodVerifier()(tok.signEosAccessToken(signer, claims()));
  assert.equal(v.externalSubject, "nonprod-persona.dispatcher");
  assert.equal(v.identityProvider, "eos");
  assert.deepEqual(Object.keys(v).sort(), ["claims", "externalSubject", "identityProvider"]);
  assert.deepEqual(Object.keys(v.claims).sort(), ["aud", "env", "exp", "iat", "iss", "jti", "sub"]);
});

test("1. rotation: a keyset of two kids verifies tokens from either", () => {
  const keys = new Map([["nonprod-k1", k1.publicKey], ["nonprod-k2", k2.publicKey]]);
  const verify = nonprodVerifier({ keys });
  assert.equal(verify(tok.signEosAccessToken(signer, claims())).identityProvider, "eos");
  assert.equal(verify(tok.signEosAccessToken({ kid: "nonprod-k2", privateKey: k2.privateKey }, claims())).identityProvider, "eos");
});

// ════════════════════ 2. Firebase unchanged through the composite seam ════════════════════

test("2. the composite verifier sends a non-EOS bearer to the (fake) Firebase verifier unchanged, with no network", async () => {
  const seen = [];
  const fakeFirebase = async (t) => { seen.push(t); if (t !== "firebase-token-abc") throw new Error("bad"); return { externalSubject: "fb-uid-1", identityProvider: "firebase" }; };
  const runtime = { verify: nonprodVerifier(), issuer: ISS, audience: AUD, personaIssuer: null };
  const composite = createCompositeTokenVerifier({ eos: runtime, firebase: fakeFirebase });
  assert.deepEqual(await composite("firebase-token-abc"), { externalSubject: "fb-uid-1", identityProvider: "firebase" });
  // An RS256-shaped JWT (what Firebase issues) is Firebase's to judge.
  const rs = `${b64({ alg: "RS256", kid: "g1", typ: "JWT" })}.${b64({ iss: "https://securetoken.google.com/x", sub: "u" })}.sig`;
  await assert.rejects(composite(rs));
  assert.equal(seen.at(-1), rs);
  // An EOS token goes to EOS ONLY, and never falls back to Firebase.
  const before = seen.length;
  assert.deepEqual(await composite(tok.signEosAccessToken(signer, claims())), { externalSubject: "nonprod-persona.dispatcher", identityProvider: "eos" });
  await assert.rejects(composite(tok.signEosAccessToken({ kid: "nonprod-k1", privateKey: k2.privateKey }, claims())), tok.EosTokenError);
  assert.equal(seen.length, before, "an EOS-shaped bearer reached the Firebase verifier");
});

test("2. with EOS verification NOT configured the composite is Firebase-only and refuses EdDSA bearers", async () => {
  const composite = createCompositeTokenVerifier({
    eos: { verify: null, issuer: null, audience: null, personaIssuer: null },
    firebase: async () => ({ externalSubject: "fb", identityProvider: "firebase" }),
  });
  assert.equal((await composite("opaque")).identityProvider, "firebase");
  await assert.rejects(composite(tok.signEosAccessToken(signer, claims())), tok.EosTokenError);
});

// ════════════════════ 3-6. refused ════════════════════

test("3. invalid issuer is refused", () => {
  refusedWith(() => nonprodVerifier()(tok.signEosAccessToken(signer, claims({ iss: "https://evil.example/auth" }))), "ISSUER_MISMATCH");
});

test("4. invalid audience is refused", () => {
  refusedWith(() => nonprodVerifier()(tok.signEosAccessToken(signer, claims({ aud: "https://other-api.example" }))), "AUDIENCE_MISMATCH");
});

test("5. expired (beyond the 30 s skew) is refused; inside the skew is accepted; not-yet-valid is refused", () => {
  const verify = nonprodVerifier();
  refusedWith(() => verify(tok.signEosAccessToken(signer, claims({ iat: NOW - 1000, exp: NOW - 100 }))), "EXPIRED");
  assert.equal(verify(tok.signEosAccessToken(signer, claims({ iat: NOW - 900, exp: NOW - 10 }))).identityProvider, "eos");
  refusedWith(() => verify(tok.signEosAccessToken(signer, claims({ iat: NOW + 120, exp: NOW + 600 }))), "NOT_YET_VALID");
  refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1" }, { ...claims(), nbf: NOW + 300 })), "NOT_YET_VALID");
});

test("5. a lifetime over 15 minutes is refused by the verifier even when validly signed", () => {
  refusedWith(() => nonprodVerifier()(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1" }, claims({ exp: NOW + 901 }))), "LIFETIME_EXCEEDED");
  assert.throws(() => tok.signEosAccessToken(signer, claims({ exp: NOW + 3600 })), tok.EosAuthConfigError);
});

test("6. malformed, bad signature, alg none/HS256/RS256, unknown kid, foreign header params and authority claims are refused", () => {
  const verify = nonprodVerifier();
  const good = tok.signEosAccessToken(signer, claims());
  for (const bad of ["", "abc", "a.b", "a.b.c.d", `${good}x!`, "x".repeat(5000), `${good.split(".")[0]}..${good.split(".")[2]}`]) {
    refusedWith(() => verify(bad), "MALFORMED");
  }
  // Tampered payload -> signature no longer matches.
  const [h, , s] = good.split(".");
  refusedWith(() => verify(`${h}.${b64(claims({ sub: "nonprod-persona.ownerExecutive" }))}.${s}`), "BAD_SIGNATURE");
  // Signed by a key the verifier does not hold for that kid.
  refusedWith(() => verify(tok.signEosAccessToken({ kid: "nonprod-k1", privateKey: k2.privateKey }, claims())), "BAD_SIGNATURE");
  // alg none / HS256 / RS256.
  refusedWith(() => verify(`${b64({ alg: "none", typ: "JWT", kid: "nonprod-k1" })}.${b64(claims())}.`), "MALFORMED");
  refusedWith(() => verify(`${b64({ alg: "none", typ: "JWT", kid: "nonprod-k1" })}.${b64(claims())}.${"A".repeat(86)}`), "ALGORITHM_REFUSED");
  refusedWith(() => verify(`${b64({ alg: "HS256", typ: "JWT", kid: "nonprod-k1" })}.${b64(claims())}.${"A".repeat(43)}`), "ALGORITHM_REFUSED");
  refusedWith(() => verify(`${b64({ alg: "RS256", typ: "JWT", kid: "nonprod-k1" })}.${b64(claims())}.${"A".repeat(342)}`), "ALGORITHM_REFUSED");
  // Unknown kid, and a kid of the other environment.
  refusedWith(() => verify(tok.signEosAccessToken({ kid: "nonprod-k9", privateKey: k1.privateKey }, claims())), "UNKNOWN_KID");
  refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT" }, claims())), "UNKNOWN_KID");
  refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT", kid: "production-k1" }, claims())), "KID_ENVIRONMENT_MISMATCH");
  // A header that names its own key is refused.
  refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1", jku: "https://evil/keys" }, claims())), "HEADER_REFUSED");
  refusedWith(() => verify(rawToken({ alg: "EdDSA", kid: "nonprod-k1" }, claims())), "HEADER_REFUSED");
  // Authority-bearing or unknown claims, missing claims, wrong types.
  for (const extra of [{ roles: ["admin"] }, { capabilities: ["x"] }, { tenantId: "t" }, { principalId: "p" }, { scope: "all" }, { foo: 1 }]) {
    refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1" }, { ...claims(), ...extra })), "CLAIM_REFUSED");
  }
  const { jti, ...noJti } = claims();
  refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1" }, noJti)), "CLAIM_REFUSED");
  refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1" }, claims({ exp: String(NOW + 60) }))), "CLAIM_REFUSED");
  refusedWith(() => verify(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1" }, claims({ sub: "has space" }))), "SUBJECT_MALFORMED");
  // No refusal message carries a token, key or claim value.
  try { verify(good.slice(0, -2) + "AA"); } catch (e) { assert.doesNotMatch(e.message, /nonprod-persona|eyJ/); }
});

// ════════════════════ 7. production isolation ════════════════════

test("7. a PRODUCTION verifier refuses a nonprod token EVEN when it trusts the key that signed it", () => {
  const nonprodToken = tok.signEosAccessToken(signer, claims());
  // It cannot even be CONSTRUCTED around a nonprod kid, issuer or audience.
  assert.throws(() => tok.createEosTokenVerifier({ environment: "production", issuer: PROD_ISS, audience: PROD_AUD, keys: new Map([["nonprod-k1", k1.publicKey]]) }), tok.EosAuthConfigError);
  assert.throws(() => tok.createEosTokenVerifier({ environment: "production", issuer: ISS, audience: PROD_AUD, keys: new Map([["production-k1", k1.publicKey]]) }), tok.EosAuthConfigError);
  assert.throws(() => tok.createEosTokenVerifier({ environment: "production", issuer: PROD_ISS, audience: AUD, keys: new Map([["production-k1", k1.publicKey]]) }), tok.EosAuthConfigError);
  // THE SAME KEY MATERIAL, trusted under a production kid.
  const prod = tok.createEosTokenVerifier({ environment: "production", issuer: PROD_ISS, audience: PROD_AUD, keys: new Map([["production-k1", k1.publicKey]]), nowSeconds: clock });
  refusedWith(() => prod(nonprodToken), "KID_ENVIRONMENT_MISMATCH");
  // Re-labelled under the production kid but still env=nonprod: refused.
  refusedWith(() => prod(rawToken({ alg: "EdDSA", typ: "JWT", kid: "production-k1" }, claims({ iss: PROD_ISS, aud: PROD_AUD }))), "ENVIRONMENT_MISMATCH");
  // env=production but nonprod issuer/audience: refused.
  refusedWith(() => prod(rawToken({ alg: "EdDSA", typ: "JWT", kid: "production-k1" }, claims({ env: "production" }))), "ISSUER_MISMATCH");
  // The signer refuses to mint a nonprod-env token under a production kid, and vice versa.
  assert.throws(() => tok.signEosAccessToken({ kid: "production-k1", privateKey: k1.privateKey }, claims()), tok.EosAuthConfigError);
  // A well-formed production token IS accepted by the production verifier -- the refusals above are about nonprod.
  assert.equal(prod(tok.signEosAccessToken({ kid: "production-k1", privateKey: k1.privateKey }, claims({ iss: PROD_ISS, aud: PROD_AUD, env: "production" }))).identityProvider, "eos");
  // And the nonprod verifier refuses production tokens symmetrically.
  refusedWith(() => nonprodVerifier()(rawToken({ alg: "EdDSA", typ: "JWT", kid: "nonprod-k1" }, claims({ env: "production" }))), "ENVIRONMENT_MISMATCH");
});

test("7. persona issuance refuses outside nonprod, with a non-nonprod key, and for any key outside the 16", async () => {
  const repo = new InMemoryPolicyRepository();
  const base = { repo, signer, issuer: ISS, audience: AUD, nowSeconds: clock };
  for (const environment of ["production", "prod", "local", "", "NONPROD"]) {
    await assert.rejects(issueNonprodPersonaSession({ ...base, environment }, "dispatcher"),
      (e) => e instanceof PersonaIssuanceError && e.refusal === "ISSUER_DISABLED_OUTSIDE_NONPROD");
  }
  await assert.rejects(issueNonprodPersonaSession({ ...base, environment: "nonprod", signer: { kid: "production-k1", privateKey: k1.privateKey } }, "dispatcher"),
    (e) => e.refusal === "ISSUER_KEY_NOT_NONPROD");
  for (const key of ["admin", "root", "nonprod-persona.dispatcher", "", null, { personaKey: "dispatcher" }, "__proto__"]) {
    await assert.rejects(issueNonprodPersonaSession({ ...base, environment: "nonprod" }, key), (e) => e.refusal === "UNKNOWN_PERSONA");
  }
  // A governed key with no binding: no session.
  await assert.rejects(issueNonprodPersonaSession({ ...base, environment: "nonprod" }, "dispatcher"),
    (e) => e.refusal === "PERSONA_NOT_ELIGIBLE" && e.detail === "UNKNOWN_PRINCIPAL");
});

// ════════════════════ configuration (Render environment) ════════════════════

const jwk = (k) => k.export({ format: "jwk" });
function envFor(over = {}) {
  return {
    EOS_ENVIRONMENT: "nonprod",
    EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-k1": jwk(k1.publicKey) }),
    EOS_AUTH_ISSUER: ISS,
    EOS_AUTH_AUDIENCE: AUD,
    EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(jwk(k1.privateKey)),
    EOS_AUTH_SIGNING_KID: "nonprod-k1",
    EOS_PERSONA_ISSUER_CREDENTIAL_SHA256: createHash("sha256").update("c".repeat(43)).digest("hex"),
    ...over,
  };
}

test("config: no EOS variables -> disabled (Firebase-only service exactly as before)", () => {
  const cfg = readServiceConfig({ EOS_ENVIRONMENT: "nonprod" });
  assert.equal(cfg.eosAuth.verify, null);
  assert.equal(cfg.eosAuth.personaIssuer, null);
  assert.equal(cfg.identityProvider, "firebase");
});

test("config: a full nonprod configuration enables the verifier and the persona issuer; PEM works too", () => {
  const cfg = readServiceConfig(envFor());
  assert.equal(typeof cfg.eosAuth.verify, "function");
  assert.equal(cfg.eosAuth.personaIssuer.signer.kid, "nonprod-k1");
  const pem = k1.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  assert.equal(readServiceConfig(envFor({ EOS_AUTH_SIGNING_KEY_NONPROD: pem })).eosAuth.personaIssuer.signer.kid, "nonprod-k1");
  // Verify-only (no credential hash yet): verification on, issuer unmounted.
  const verifyOnly = readServiceConfig(envFor({ EOS_PERSONA_ISSUER_CREDENTIAL_SHA256: "" }));
  assert.equal(typeof verifyOnly.eosAuth.verify, "function");
  assert.equal(verifyOnly.eosAuth.personaIssuer, null);
});

test("config: partial, inconsistent or unsafe configurations refuse to start -- without echoing a value", () => {
  const secret = JSON.stringify(jwk(k1.privateKey));
  const cases = [
    envFor({ EOS_ENVIRONMENT: "local" }),
    envFor({ EOS_AUTH_ISSUER: "" }),
    envFor({ EOS_AUTH_SIGNING_KID: "" }),
    envFor({ EOS_AUTH_SIGNING_KID: "nonprod-k2" }),
    envFor({ EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(jwk(k2.privateKey)) }), // does not match the published key
    envFor({ EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-k1": jwk(k1.privateKey) }) }), // private material in the verify set
    envFor({ EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "production-k1": jwk(k1.publicKey) }) }),
    envFor({ EOS_AUTH_VERIFY_KEYS: JSON.stringify({ k1: jwk(k1.publicKey) }) }),
    envFor({ EOS_AUTH_VERIFY_KEYS: "not json" }),
    envFor({ EOS_PERSONA_ISSUER_CREDENTIAL_SHA256: "abc" }),
    { EOS_ENVIRONMENT: "nonprod", EOS_AUTH_SIGNING_KEY_NONPROD: secret, EOS_AUTH_SIGNING_KID: "nonprod-k1" },
    { EOS_ENVIRONMENT: "nonprod", EOS_IDENTITY_PROVIDER: "eos" },
  ];
  for (const env of cases) {
    assert.throws(() => readServiceConfig(env), (e) => {
      assert.ok(e instanceof ServiceConfigError, e.message);
      assert.doesNotMatch(e.message, /"d"|BEGIN|[A-Za-z0-9_-]{43}/, "a config error echoed key material");
      return true;
    });
  }
  // The service still refuses production outright, EOS variables or not.
  assert.throws(() => readServiceConfig(envFor({ EOS_ENVIRONMENT: "production" })), ServiceConfigError);
});

// ════════════════════ resolution + binding, in memory ════════════════════

test("the ONE resolution function: primary first, then an ACTIVE eos binding; disagreement fails closed; firebase never reads bindings", async () => {
  const repo = new InMemoryPolicyRepository();
  const tenantId = "t1";
  const ids = await repo.transact({ tenantId, uid: "setup" }, async (tx) => {
    await tx.createTenant({ key: "t1", name: "t1" });
    const a = await tx.createPrincipal({ externalSubject: "fb-a", identityProvider: "firebase" });
    await tx.createTenantMembership(a.id);
    const b = await tx.createPrincipal({ externalSubject: "fb-b", identityProvider: "firebase" });
    await tx.createTenantMembership(b.id);
    await tx.createPrincipalIdentityBinding({ principalId: a.id, identityProvider: "eos", externalSubject: "nonprod-persona.dispatcher", createdBy: "setup", reason: "test binding" });
    return { a: a.id, b: b.id };
  });
  assert.equal((await resolvePrincipalByVerifiedIdentity(repo, "eos", "nonprod-persona.dispatcher")).id, ids.a);
  assert.equal((await resolvePrincipalByVerifiedIdentity(repo, "firebase", "fb-a")).id, ids.a);
  // A Firebase-verified identity can never reach a binding row, even with the same subject string.
  assert.equal(await resolvePrincipalByVerifiedIdentity(repo, "firebase", "nonprod-persona.dispatcher"), null);
  const ctx = await resolvePrincipalContext(repo, { identityProvider: "eos", externalSubject: "nonprod-persona.dispatcher" });
  assert.equal(ctx.uid, ids.a);
  // Revoked -> nobody.
  await repo.transact({ tenantId, uid: "setup" }, (tx) => tx.revokePrincipalIdentityBinding(ids.a, "eos", "setup", "revoked in test"));
  await assert.rejects(resolvePrincipalContext(repo, { identityProvider: "eos", externalSubject: "nonprod-persona.dispatcher" }),
    (e) => e instanceof PrincipalContextError && e.refusal === "UNKNOWN_PRINCIPAL");
  // A reader that disagrees (primary says one Principal, binding another) resolves to NOBODY.
  const split = {
    getPrincipalBySubject: async () => ({ id: "p1", status: "active" }),
    getPrincipalByIdentityBinding: async () => ({ id: "p2", status: "active" }),
  };
  assert.equal(await resolvePrincipalByVerifiedIdentity(split, "eos", "s-x"), null);
});

test("the 16 persona keys are EXACTLY the registry's canonical role keys, and subjects are the pure derivation", () => {
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, "config", "sandboxRoleIdentityRegistry.json"), "utf8"));
  assert.deepEqual([...NONPROD_PERSONA_KEYS].sort(), registry.roles.map((r) => r.key).sort());
  assert.equal(NONPROD_PERSONA_KEYS.length, 16);
  for (const key of NONPROD_PERSONA_KEYS) assert.match(nonprodPersonaSubject(key), tok.EOS_SUBJECT_PATTERN);
  assert.throws(() => nonprodPersonaSubject("root"));
});
