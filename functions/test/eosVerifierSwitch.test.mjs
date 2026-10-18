// FIREBASE EXIT B2 -- the verifier switch and the verifier-path metric, with no database and no network.
//
// Proves: (1) EOS_AUTH_FIREBASE_VERIFIER parses, defaults to enabled, and is refused without human login or in production;
// (2) with it disabled a Firebase bearer is refused WITHOUT the Firebase verifier ever being called, while EOS tokens verify
// as before; (3) the metric counts verifier TYPES and refusals, nothing else; (4) a persona subject carries `sid` only as an
// enrolled persona's password session, through the same gate as a human; (5) the persona/enrollment/display-name tooling
// refuses what it must before it loads any client library.
import "./support/firebaseOfflineGuard.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const T = require("../lib/eosAuth/eosAccessToken.js");
const H = require("../lib/eosAuth/eosAuthHttp.js");
const B = require("../lib/eosAuth/requestTenantBinding.js");
const M = require("../lib/eosAuth/verifierMetrics.js");
const P = require("../lib/eosAuth/nonprodPersonas.js");
const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");
const HERE = dirname(fileURLToPath(import.meta.url));

const ISS = "https://eos.test/auth";
const AUD = "https://eos.test";
const kp = generateKeyPairSync("ed25519");
const signer = { kid: "nonprod-s", privateKey: kp.privateKey };
const verify = T.createEosTokenVerifier({ environment: "nonprod", issuer: ISS, audience: AUD, keys: new Map([["nonprod-s", kp.publicKey]]) });
const now = () => Math.floor(Date.now() / 1000);
const mint = (claims) => T.signEosAccessToken(signer, { iss: ISS, aud: AUD, iat: now(), exp: now() + 60, jti: T.newTokenId(), env: "nonprod", ...claims });
const HUMAN = `user.${"ab".repeat(16)}`;
const SID = "s".repeat(32);

const base = { EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-s": kp.publicKey.export({ format: "jwk" }) }), EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD };
const signing = { EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(kp.privateKey.export({ format: "jwk" })), EOS_AUTH_SIGNING_KID: "nonprod-s" };
const login = { EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_COOKIE_SAMESITE: "None", EOS_AUTH_TRUSTED_PROXY_HOPS: "1" };

test("V1 configuration: the switch defaults to enabled, needs human login, and is refused in production", () => {
  assert.equal(readEosAuthConfig({ ...base, ...signing, ...login }, "nonprod").firebaseVerifier, "enabled");
  assert.equal(readEosAuthConfig({ ...base, ...signing, ...login, EOS_AUTH_FIREBASE_VERIFIER: "disabled" }, "nonprod").firebaseVerifier, "disabled");
  assert.equal(readEosAuthConfig({ ...base, ...signing, ...login, EOS_AUTH_FIREBASE_VERIFIER: " enabled " }, "nonprod").firebaseVerifier, "enabled");
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...login, EOS_AUTH_FIREBASE_VERIFIER: "off" }, "nonprod"), /must be 'enabled' or 'disabled'/);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, EOS_AUTH_FIREBASE_VERIFIER: "disabled" }, "nonprod"), /requires EOS_HUMAN_LOGIN=enabled/);
  assert.throws(() => readEosAuthConfig({ EOS_AUTH_FIREBASE_VERIFIER: "disabled" }, "nonprod"), /requires EOS token verification/);
  assert.throws(() => readEosAuthConfig({ ...base, ...signing, ...login, EOS_AUTH_FIREBASE_VERIFIER: "disabled" }, "production"), /EOS_ENVIRONMENT=nonprod/);
  // With nothing set the service is the Firebase-only service it always was.
  assert.equal(readEosAuthConfig({}, "nonprod").verify, null);
});

test("V2 disabled: a Firebase bearer is refused and the Firebase verifier is NEVER called; EOS tokens still verify", async () => {
  let firebaseCalls = 0;
  const firebase = async () => { firebaseCalls += 1; return { externalSubject: "fb-uid", identityProvider: "firebase" }; };
  const metrics = M.createVerifierMetrics();
  const eos = { verify, issuer: ISS, audience: AUD, personaIssuer: null, humanLogin: null, firebaseVerifier: "disabled" };
  const gate = async () => ({ tenantId: "tenant-A" });
  const v = H.createCompositeTokenVerifier({ eos, firebase, humanSessionGate: gate, metrics });
  await assert.rejects(v("not-an-eos-token"), /FIREBASE_VERIFIER_DISABLED/);
  await assert.rejects(v(`${Buffer.from(JSON.stringify({ alg: "RS256", kid: "x" })).toString("base64url")}.${Buffer.from("{}").toString("base64url")}.sig`), /FIREBASE_VERIFIER_DISABLED/);
  assert.equal(firebaseCalls, 0, "firebase-admin is never reached");
  assert.equal((await v(mint({ sub: "nonprod-persona.dispatcher" }))).externalSubject, "nonprod-persona.dispatcher");
  await B.runWithRequestScope(async () => assert.equal((await v(mint({ sub: HUMAN, sid: SID }))).externalSubject, HUMAN));
  const snap = metrics.snapshot();
  assert.deepEqual(snap.verified, { eos_human: 1, eos_persona: 1, firebase: 0 });
  assert.deepEqual(snap.refused, { eos_invalid: 0, firebase_invalid: 0, firebase_disabled: 2 });
});

test("V3 enabled (the default): the Firebase fallback is exactly as before, and counted as firebase", async () => {
  const metrics = M.createVerifierMetrics();
  const firebase = async (t) => { if (t === "bad") throw new Error("nope"); return { externalSubject: "fb-uid", identityProvider: "firebase" }; };
  const v = H.createCompositeTokenVerifier({ eos: { verify, issuer: ISS, audience: AUD, personaIssuer: null, humanLogin: null }, firebase, metrics });
  assert.equal((await v("good")).externalSubject, "fb-uid");
  await assert.rejects(v("bad"), /nope/);
  await assert.rejects(v(mint({ sub: HUMAN })), /CLAIM_REFUSED/, "an EOS-shaped bearer that fails is never retried as Firebase");
  assert.deepEqual(metrics.snapshot().verified, { eos_human: 0, eos_persona: 0, firebase: 1 });
  assert.deepEqual(metrics.snapshot().refused, { eos_invalid: 1, firebase_invalid: 1, firebase_disabled: 0 });
});

test("V4 the metric holds counts and a start time only -- no subject, token, tenant or address", () => {
  const metrics = M.createVerifierMetrics(() => new Date("2026-10-17T00:00:00Z"));
  metrics.verified("firebase");
  metrics.refused("eos_invalid");
  const snap = metrics.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), ["refused", "since", "verified"]);
  assert.equal(snap.since, "2026-10-17T00:00:00.000Z");
  assert.ok(Object.values(snap.verified).every(Number.isInteger) && Object.values(snap.refused).every(Number.isInteger));
  assert.ok(Object.isFrozen(snap));
  assert.deepEqual([...M.VERIFIED_PATHS], ["eos_human", "eos_persona", "firebase"]);
  assert.deepEqual([...M.REFUSED_PATHS], ["eos_invalid", "firebase_invalid", "firebase_disabled"]);
});

test("V5 persona subjects: closed on the 16 keys; a persona SESSION goes through the gate, the issuer's token never does", async () => {
  assert.ok(P.isNonprodPersonaSubject("nonprod-persona.dispatcher"));
  assert.ok(!P.isNonprodPersonaSubject("nonprod-persona.notAPersona"));
  assert.ok(!P.isNonprodPersonaSubject("nonprod-persona."));
  assert.ok(!P.isNonprodPersonaSubject(HUMAN));
  assert.ok(!P.isNonprodPersonaSubject(undefined));
  assert.equal(P.NONPROD_PERSONA_KEYS.length, 16);
  const gated = [];
  const gate = async (subject, sid) => { gated.push(subject); if (sid !== SID) throw new Error("SESSION_INVALID"); return { tenantId: "tenant-A" }; };
  const v = H.createCompositeTokenVerifier({
    eos: { verify, issuer: ISS, audience: AUD, personaIssuer: null, humanLogin: null },
    firebase: async () => { throw new Error("no firebase"); }, humanSessionGate: gate,
  });
  const persona = "nonprod-persona.serviceTechnician";
  await B.runWithRequestScope(async () => assert.equal((await v(mint({ sub: persona, sid: SID }))).externalSubject, persona));
  await B.runWithRequestScope(() => assert.rejects(v(mint({ sub: persona, sid: "r".repeat(32) })), /SESSION_INVALID/));
  assert.equal((await v(mint({ sub: persona }))).externalSubject, persona);
  assert.equal(gated.length, 2, "only the two session tokens met the gate");
  await B.runWithRequestScope(() => assert.rejects(v(mint({ sub: "nonprod-persona.imposter", sid: SID })), /CLAIM_REFUSED/));
});

test("V6 the tooling refuses before it can contact anything (invocation fences, no database)", () => {
  const enroll = require("../scripts/enrollPersonaLogins.js");
  const names = require("../scripts/populatePrincipalDisplayNames.js");
  const env = { EOS_ENVIRONMENT: "nonprod", DATABASE_URL: "postgres://unused" };
  const good = ["--environment", "platform-sandbox", "--databaseUrlEnv", "DATABASE_URL", "--tenantKey", "taylor"];
  const parse = (argv) => require("../scripts/measureEmployeeReferenceIntegrity.js").parseArgs(argv);
  const reason = "enroll the sixteen synthetic personas for the EOS login proof";
  // enrollment (every enrollment invocation names its --operator)
  const eparse = (argv) => parse([...argv, "--operator", "Test Operator"]);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason, "--password", "x"]), env), /CREDENTIAL_ARGUMENT_REFUSED/);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", "short"]), env), /REASON_NOT_SPECIFIC/);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "notAPersona", "--reason", reason]), env), /UNKNOWN_PERSONA/);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason]), { ...env, EOS_ENVIRONMENT: "production" }), /EOS_ENVIRONMENT must read exactly 'nonprod'/);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason, "--apply"]), env), /--credentialsOut is required/);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason, "--apply", "--credentialsOut", "relative.json"]), env), /absolute path/);
  // --operator is required, well-formed, and part of the bounded composed reason
  assert.throws(() => enroll.assertInvocation(parse([...good, "--personas", "all", "--reason", reason]), env), /--operator is required/);
  assert.throws(() => enroll.assertInvocation(parse([...good, "--personas", "all", "--reason", reason, "--operator", "x;rm"]), env), /OPERATOR_REFUSED/);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", "r".repeat(450)]), env), /REASON_TOO_LONG/);
  assert.doesNotThrow(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", "r".repeat(400)]), env));
  const insideRepo = join(HERE, "..", "creds.json");
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason, "--apply", "--credentialsOut", insideRepo]), env), /inside this repository/);
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason, "--apply", "--credentialsOut", join(HERE, "..", "no-such-dir", "creds.json")]), env), /parent directory/);
  const outside = join(tmpdir(), "b2-outside-the-repo-creds.json");
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason, "--apply", "--credentialsOut", outside]), env), /FACTOR_KEY_MISSING|factor/);
  const dry = enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason]), env);
  assert.equal(dry.apply, false);
  assert.equal(dry.personas.length, 16);
  assert.equal(dry.operator, "Test Operator");
  assert.throws(() => enroll.assertInvocation(eparse([...good, "--personas", "all", "--reason", reason, "--credentialsOut", outside]), env), /only with --apply/);
  // display names
  const nameArgs = [...good, "--adminPrincipalId", "p-admin", "--reason", "populate principal display names from verified identity data"];
  assert.throws(() => names.assertInvocation(parse([...nameArgs, "--source", "inferFromEmail"]), env), /SOURCE_REFUSED/);
  assert.throws(() => names.assertInvocation(parse([...nameArgs, "--source", "enteredNames"]), env), /--namesFile is required/);
  assert.throws(() => names.assertInvocation(parse([...nameArgs, "--source", "firebaseProfile", "--role", "admin"]), env), /AUTHORITY_ARGUMENT_REFUSED/);
  assert.equal(names.assertInvocation(parse([...nameArgs, "--source", "firebaseProfile"]), env).apply, false);
});

test("V7 the display-name plan: provider or administration names only; never email-shaped, never overwritten, unresolved listed", () => {
  const { planNames } = require("../scripts/populatePrincipalDisplayNames.js");
  const { principalDisplayNameRefusal } = require("../lib/adminPolicy/policyCommands.js");
  const principals = [
    { id: "p1", identityProvider: "firebase", externalSubject: "u1", displayName: null },
    { id: "p2", identityProvider: "firebase", externalSubject: "u2", displayName: "Already Named" },
    { id: "p3", identityProvider: "firebase", externalSubject: "u3", displayName: null },
    { id: "p4", identityProvider: "firebase", externalSubject: "u4", displayName: null },
    { id: "p5", identityProvider: "eos", externalSubject: "svc.x", displayName: null },
  ];
  const names = new Map([["u1", "Jane Verified"], ["u3", "jane@example.test"]]);
  const plan = planNames(principals, (p) => (p.identityProvider !== "firebase" ? { unresolvedReason: "NOT_A_PROVIDER_ACCOUNT" }
    : names.has(p.externalSubject) ? { name: names.get(p.externalSubject) } : { unresolvedReason: "PROVIDER_ACCOUNT_HAS_NO_PROFILE_NAME" }), principalDisplayNameRefusal);
  assert.deepEqual(plan.planned, [{ principalId: "p1", displayName: "Jane Verified" }]);
  assert.deepEqual(plan.alreadyNamed, [{ principalId: "p2" }]);
  assert.deepEqual(plan.unresolved.map((u) => [u.principalId, u.reason]), [["p3", "NAME_REJECTED"], ["p4", "PROVIDER_ACCOUNT_HAS_NO_PROFILE_NAME"], ["p5", "NOT_A_PROVIDER_ACCOUNT"]]);
  assert.ok(plan.unresolved.every((u) => !("email" in u)), "an unresolved row never carries an email or an Employee name");
  // A provider profile name is editable by its holder: a duplicate (any case, tenant-wide) is never applied, and every collider is listed.
  const dup = planNames([
    { id: "d1", identityProvider: "firebase", externalSubject: "ud1", displayName: null },
    { id: "d2", identityProvider: "firebase", externalSubject: "ud2", displayName: null },
    { id: "d3", identityProvider: "firebase", externalSubject: "ud3", displayName: null },
    { id: "d4", identityProvider: "firebase", externalSubject: "ud4", displayName: "Existing Person" },
    { id: "d5", identityProvider: "firebase", externalSubject: "ud5", displayName: null },
  ], (p) => ({ name: { ud1: "Pat Lee", ud2: "PAT LEE", ud3: "Unique Name", ud5: "existing person" }[p.externalSubject] }), principalDisplayNameRefusal);
  assert.deepEqual(dup.planned, [{ principalId: "d3", displayName: "Unique Name" }]);
  assert.deepEqual(dup.unresolved.map((u) => [u.principalId, u.reason]).sort(), [["d1", "NAME_DUPLICATE"], ["d2", "NAME_DUPLICATE"], ["d5", "NAME_DUPLICATE"]]);
  for (const bad of ["a", " padded ", "x@y.test", "<b>bold</b>", "line\nbreak", "x".repeat(121), 42]) assert.ok(principalDisplayNameRefusal(bad), String(bad));
  assert.equal(principalDisplayNameRefusal("Marguerite O’Neil-Lopez"), null);
});

test("V9 MET-1: the counters are a restricted Administration read, and /health carries no authentication detail", () => {
  const S = require("../lib/eosAuth/eosLoginService.js");
  assert.deepEqual({ ...S.LOGIN_ADMINISTRATION_OPERATIONS.readAuthVerifierDiagnostics }, { mutation: false, capability: "admin.securityPolicy.read" });
  assert.ok(S.isLoginAdministrationOperation("readAuthVerifierDiagnostics"));
  // The handler wiring: no source composed -> refused; a source -> the governance read gets it (the gate lives in the governance class).
  const seen = [];
  const governance = { readAuthVerifierDiagnostics: (actor, source) => { seen.push(source()); return { ok: true }; } };
  const handlerOff = S.createLoginAdministration({}, governance, null);
  assert.throws(() => handlerOff("readAuthVerifierDiagnostics", {}, {}), /not composed/);
  const handlerOn = S.createLoginAdministration({}, governance, () => ({ firebaseVerifier: "disabled", verified: { eos_human: 1 } }));
  assert.deepEqual(handlerOn("readAuthVerifierDiagnostics", {}, {}), { ok: true });
  assert.deepEqual(seen, [{ firebaseVerifier: "disabled", verified: { eos_human: 1 } }]);
  // The gate is in the governance read itself, on the security-policy read key.
  const service = readFileSync(join(HERE, "..", "src/eosAuth/eosLoginService.ts"), "utf8");
  assert.match(service, /async readAuthVerifierDiagnostics\(actor: AdminActor, source: AuthVerifierDiagnosticsSource\) \{\s*const held = await actorCapabilities\(this\.repo, actor\);\s*if \(!held\.has\("admin\.securityPolicy\.read"\)\) throw new LoginRefusal\("FORBIDDEN"/);
  // /health: the health callback in server.ts builds its object with no `auth` key and no verifier metric.
  const server = readFileSync(join(HERE, "..", "src/eosApi/server.ts"), "utf8");
  const block = /health: async \(\) => \{[\s\S]*?\n    \},/.exec(server)?.[0] ?? "";
  assert.ok(block.length > 0 && block.includes("migrations:"), "found the health callback");
  assert.doesNotMatch(block, /\bauth\s*:|verifierMetrics|firebaseVerifier/);
});

test("V8 no Firebase, Google or JWT package and no key literal on the new EOS-side modules and the enrollment tool", () => {
  const files = ["src/eosAuth/verifierMetrics.ts", "scripts/enrollPersonaLogins.js"];
  for (const f of files) {
    const text = readFileSync(join(HERE, "..", f), "utf8");
    assert.doesNotMatch(text, /from ["'](firebase|firebase-admin|@google-cloud|google-auth-library)/, f);
    assert.doesNotMatch(text, /require\(["'](firebase|firebase-admin|@google-cloud)/, f);
    assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, f);
  }
  // The enrollment tool has no flag through which a credential could enter or be printed.
  const enroll = require("../scripts/enrollPersonaLogins.js");
  assert.ok(!enroll.KNOWN_FLAGS.filter((f) => f !== "tenantKey").some((f) => /password|secret|token|key/i.test(f)));
});

test("V10 B2-x employee mode: the invocation fences refuse before anything is loaded; the id and status rules equal the service's", () => {
  const enroll = require("../scripts/enrollPersonaLogins.js");
  const S = require("../lib/eosAuth/eosLoginService.js");
  assert.deepEqual([...enroll.EMPLOYEE_ID_PREFIXES], [...S.ENROLLABLE_EMPLOYEE_ID_PREFIXES]);
  assert.deepEqual([...enroll.ENROLLABLE_STATUSES], [...S.ENROLLABLE_EMPLOYMENT_STATUSES]);
  assert.ok(!enroll.ENROLLABLE_STATUSES.some((s) => ["INACTIVE", "TERMINATED", "RETIRED"].includes(s)), "separated and inactive Employees are never enrollable");
  const env = { EOS_ENVIRONMENT: "nonprod", DATABASE_URL: "postgres://unused" };
  const parse = (argv) => require("../scripts/measureEmployeeReferenceIntegrity.js").parseArgs(argv);
  const reason = "give the nonprod sample employees an EOS sign-in for acceptance";
  const good = ["--environment", "platform-sandbox", "--databaseUrlEnv", "DATABASE_URL", "--tenantKey", "taylor", "--reason", reason, "--operator", "Test Operator"];
  const emp = (...more) => parse([...good, "--adminPrincipalId", "p-admin", ...more]);
  const ok = enroll.assertInvocation(emp("--employees", "all-missing"), env);
  assert.deepEqual([ok.employees, ok.personas, ok.apply, ok.adminPrincipalId], ["all-missing", [], false, "p-admin"]);
  assert.deepEqual(enroll.assertInvocation(emp("--employees", "np-taylor-tech-04,synthetic-np-emp-records-clerk"), env).employees, ["np-taylor-tech-04", "synthetic-np-emp-records-clerk"]);
  // WHO: only the two prefixes; a persona employee, a real-looking id and a malformed id are refused before any connection.
  for (const id of ["emp-persona-dispatcher", "syn-g9-np-tech-moving", "np-taylor-", "NP-TAYLOR-TECH-04", "np-taylor-x/y", "someone@example.com"]) {
    assert.throws(() => enroll.assertInvocation(emp("--employees", id), env), /EMPLOYEE_ID_REFUSED/, id);
  }
  assert.throws(() => enroll.assertInvocation(emp("--employees", "np-taylor-tech-04,np-taylor-tech-04"), env), /DUPLICATE_EMPLOYEE/);
  // MODE: exactly one target set; the administering Principal belongs to employee mode only.
  assert.throws(() => enroll.assertInvocation(parse([...good, "--adminPrincipalId", "p-admin"]), env), /MODE_REQUIRED/);
  assert.throws(() => enroll.assertInvocation(emp("--employees", "all-missing", "--personas", "all"), env), /MODE_REQUIRED/);
  assert.throws(() => enroll.assertInvocation(parse([...good, "--employees", "all-missing"]), env), /--adminPrincipalId is required/);
  assert.throws(() => enroll.assertInvocation(parse([...good, "--personas", "all", "--adminPrincipalId", "p-admin"]), env), /ARGUMENT_REFUSED/);
  // The inherited fences still hold in this mode.
  assert.throws(() => enroll.assertInvocation(emp("--employees", "all-missing", "--password", "x"), env), /CREDENTIAL_ARGUMENT_REFUSED/);
  assert.throws(() => enroll.assertInvocation(emp("--employees", "all-missing", "--role", "admin"), env), /UNKNOWN_FLAG_REFUSED/);
  assert.throws(() => enroll.assertInvocation(emp("--employees", "all-missing"), { ...env, EOS_ENVIRONMENT: "production" }), /EOS_ENVIRONMENT must read exactly 'nonprod'/);
  assert.throws(() => enroll.assertInvocation(emp("--employees", "all-missing", "--apply"), env), /--credentialsOut is required/);
  assert.throws(() => enroll.assertInvocation(emp("--employees", "all-missing", "--apply", "--credentialsOut", join(HERE, "..", "creds.json")), env), /inside this repository/);
  assert.throws(() => enroll.assertInvocation(emp("--employees", "all-missing", "--credentialsOut", join(tmpdir(), "b2x.json")), env), /only with --apply/);
  // The composed reason (`<reason> [<employee id>] by <operator>`) must fit the audit limit for the longest id.
  const long = parse(["--environment", "platform-sandbox", "--databaseUrlEnv", "DATABASE_URL", "--tenantKey", "taylor", "--reason", "r".repeat(400),
    "--operator", "Test Operator", "--adminPrincipalId", "p-admin", "--employees", "all-missing"]);
  assert.throws(() => enroll.assertInvocation(long, env), /REASON_TOO_LONG/);
});
