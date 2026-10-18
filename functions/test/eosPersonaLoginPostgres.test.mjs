// FIREBASE EXIT B2, AGAINST A REAL postgres:16 AND THE REAL IN-PROCESS EOS API:
//   (P1-P3) synthetic persona enrollment -- a password login and an authenticator on the persona's OWN EOS binding;
//   (P4-P6) the persona password session, its isolation, and the machine path beside it;
//   (P7)    the verifier switch: Firebase bearers refused without the Firebase verifier being called, and the /health counters;
//   (P8)    ACTOR-NAME-1: governed principal display names;
//   (P9)    B2-x: employee mode -- sample and synthetic Employees get a login on a human identity, a missing Principal is created
//           through the governed path, and the fences hold.
//
// Its OWN disposable database. Keys are generated in memory; the Firebase verifier is a FAKE that counts its calls. Nothing
// contacts Firebase, Google or any network other than the loopback database and the loopback API.
import "./support/firebaseOfflineGuard.cjs";
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const DB_NAME = `eos_persona_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const ISS = "https://eos-api-nonprod.test/auth";
const AUD = "https://eos-api-nonprod.test";
const ORIGIN = "https://verenwardeos.test";
const FAST_HASH = { N: 2 ** 14, r: 8, p: 1 };

test("B2: persona enrollment, the persona password session, the verifier switch and principal display names", { skip: SKIP, concurrency: 1 }, async (t) => {
  delete process.env.SANDBOX_CREDENTIALS_FILE;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  let pool; let api;
  t.after(async () => {
    if (api) await api.close().catch(() => {});
    if (pool) await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const up = spawnSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(up.error, undefined, String(up.error));
  assert.equal(up.status, 0, up.stderr);

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { bindPrincipalEosIdentity, setPrincipalDisplayName } = require("../lib/adminPolicy/policyCommands.js");
  const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");
  const { EosLoginService } = require("../lib/eosAuth/eosLoginService.js");
  const { signEosAccessToken, newTokenId } = require("../lib/eosAuth/eosAccessToken.js");
  const C = require("../lib/eosAuth/credentialCrypto.js");
  const { startEosApi } = require("../lib/eosApi/server.js");

  pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // ════════════════════ fixture ════════════════════
  const { tenant } = await bootstrapTenant(repo, { key: "persona-proof", name: "EOS persona login proof tenant", actorUid: "persona-proof" });
  const tenantId = tenant.id;
  const admin = await bootstrapAdministrator(repo, { tenantId, externalSubject: "fb-admin-uid", performedBy: "persona-proof" });
  const adminPrincipalId = admin.principal.id;
  const makePrincipal = async (key, roleKey, firebaseUid) => {
    const role = await repo.getRoleByKey(tenantId, roleKey);
    assert.ok(role, `seed defines ${roleKey}`);
    const principalId = await repo.transact({ tenantId, uid: "persona-fixture" }, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: firebaseUid, identityProvider: "firebase", displayName: null });
      await tx.createTenantMembership(p.id);
      const v = await tx.bumpAccessVersion(p.id);
      await tx.createAssignment({ principalId: p.id, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "persona-fixture", grantedAt: new Date(Date.now() - 60_000).toISOString(), accessVersionAtGrant: v });
      return p.id;
    });
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,$2,'ACTIVE','taylor','2020-01-01T00:00:00Z')`, [`emp-${key}`, tenantId]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
             VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','persona-fixture','EOS persona proof fixture')`, [`epl-${key}`, tenantId, principalId, `emp-${key}`]);
    return principalId;
  };
  {
    const baseline = require("../lib/adminPolicy/seed/roleCapabilityAuthorityBaseline.json");
    const [caps, roles, existing] = await Promise.all([repo.listCapabilities(), repo.listRoles(tenantId), repo.listRoleCapabilities(tenantId)]);
    const capId = new Map(caps.map((c) => [c.key, c.id]));
    const roleId = new Map(roles.map((r) => [r.key, r.id]));
    const have = new Set(existing.map((e) => `${e.roleId}|${e.capabilityId}`));
    await repo.transact({ tenantId, uid: "persona-fixture" }, async (tx) => {
      for (const g of baseline.grants) {
        const r = roleId.get(g.roleKey); const c = capId.get(g.capabilityKey);
        if (!r || !c || have.has(`${r}|${c}`)) continue;
        have.add(`${r}|${c}`);
        await tx.grantRoleCapability({ roleId: r, capabilityId: c, grantedBy: "persona-fixture", grantedAt: new Date(Date.now() - 120_000).toISOString() });
      }
    });
  }
  const tech = await makePrincipal("persona-technician", "technician", "fb-persona-tech");
  const disp = await makePrincipal("persona-dispatcher", "dispatcher", "fb-persona-disp");
  const real = await makePrincipal("real-person", "generalEmployee", "fb-real"); // a REAL person: no persona binding
  const bindAs = { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] };
  await bindPrincipalEosIdentity(repo, bindAs, { principalId: tech, externalSubject: "nonprod-persona.serviceTechnician", reason: "persona fixture" });
  await bindPrincipalEosIdentity(repo, bindAs, { principalId: disp, externalSubject: "nonprod-persona.dispatcher", reason: "persona fixture" });
  // An administrator persona: the EOS bearer that reads the restricted verifier diagnostics (MET-1).
  const adm = await makePrincipal("persona-administrator", "admin", "fb-persona-admin");
  await bindPrincipalEosIdentity(repo, bindAs, { principalId: adm, externalSubject: "nonprod-persona.administrator", reason: "persona fixture" });

  const authorityDigest = async () => (await q(`SELECT
      (SELECT md5(string_agg(id || principal_id || role_id || status::text || scope_type, ',' ORDER BY id)) FROM eos_policy.user_role_assignments WHERE tenant_id = $1) ura,
      (SELECT md5(coalesce(string_agg(role_id || capability_id, ',' ORDER BY role_id, capability_id), '')) FROM eos_policy.role_capabilities WHERE tenant_id = $1) rc,
      (SELECT md5(string_agg(principal_id || status::text, ',' ORDER BY principal_id)) FROM eos_policy.tenant_memberships WHERE tenant_id = $1) members,
      (SELECT md5(string_agg(id || principal_id || employee_id, ',' ORDER BY id)) FROM eos_policy.employee_principal_links WHERE tenant_id = $1) links,
      (SELECT md5(string_agg(principal_id || identity_provider || external_subject || status::text, ',' ORDER BY principal_id, external_subject)) FROM eos_policy.principal_identities) bindings,
      (SELECT md5(string_agg(id || identity_provider || external_subject || status::text, ',' ORDER BY id)) FROM eos_policy.principals) principals`, [tenantId])).rows[0];
  const authorityBefore = await authorityDigest();
  const accessVersions = async () => JSON.stringify((await q(`SELECT principal_id, tenant_id, access_version FROM eos_policy.principal_access_versions ORDER BY principal_id, tenant_id`)).rows);

  // ════════════════════ the service: Firebase verifier DISABLED ════════════════════
  const signing = generateKeyPairSync("ed25519");
  const authEnv = {
    EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-p": signing.publicKey.export({ format: "jwk" }) }),
    EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD,
    EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(signing.privateKey.export({ format: "jwk" })), EOS_AUTH_SIGNING_KID: "nonprod-p",
    EOS_HUMAN_LOGIN: "enabled",
    EOS_AUTH_FACTOR_KEYS: JSON.stringify({ f1: randomBytes(32).toString("base64url") }), EOS_AUTH_FACTOR_KEY_ID: "f1",
    EOS_AUTH_COOKIE_SAMESITE: "Strict", EOS_AUTH_TRUSTED_PROXY_HOPS: "0",
    EOS_AUTH_FIREBASE_VERIFIER: "disabled",
  };
  const eosAuth = readEosAuthConfig(authEnv, "nonprod");
  assert.equal(eosAuth.firebaseVerifier, "disabled");
  let firebaseCalls = 0;
  const fakeFirebase = async (token) => {
    firebaseCalls += 1;
    const m = /^fb-token\.(.+)$/.exec(token);
    if (!m) throw new Error("not a fake firebase token");
    return { externalSubject: m[1], identityProvider: "firebase" };
  };
  process.env.DATABASE_URL = dbUrl();
  api = await startEosApi({
    config: { port: 0, environment: "nonprod", allowedOrigins: [ORIGIN], identityProvider: "firebase", eosAuth },
    firebaseVerifyToken: fakeFirebase,
    loginServiceOverrides: { passwordHashParameters: FAST_HASH },
    loginRateLimit: { credentialPerMinute: 10_000, routinePerMinute: 10_000 },
  });
  const base = `http://127.0.0.1:${api.port}`;
  const post = async (path, body, headers = {}) => {
    const isAuth = path.startsWith("/auth/");
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(isAuth ? { origin: ORIGIN, "x-eos-csrf": "1" } : {}), ...headers }, body: JSON.stringify(body ?? {}) });
    let json = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  };
  const health = async () => (await (await fetch(`${base}/health`)).json());
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const experience = (token) => post("/operations/experience", { operation: "resolveMyExperienceContext" }, bearer(token));
  const machineToken = (subject) => signEosAccessToken({ kid: "nonprod-p", privateKey: eosAuth.humanLogin.signer.privateKey },
    { iss: ISS, aud: AUD, sub: subject, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, jti: newTokenId(), env: "nonprod" });
  const service = new EosLoginService({ pool, repo, signer: eosAuth.humanLogin.signer, issuer: ISS, audience: AUD, environment: "nonprod",
    factorKeyring: eosAuth.humanLogin.factorKeyring, passwordHashParameters: FAST_HASH });

  const enrollInput = (over = {}) => ({
    tenantId, personaKey: "serviceTechnician", principalId: tech, loginIdentifier: "technician@sandbox.invalid",
    password: randomBytes(24).toString("base64url"), totpSecret: C.newTotpSecret(), recoveryCodes: C.newRecoveryCodes(),
    reason: "B2 persona enrollment proof for serviceTechnician", ...over,
  });
  const creds = enrollInput();

  await t.test("P1 enrollment: a login account on the persona's OWN binding, password, active authenticator, ten recovery codes, one audit event; no authority moves", async () => {
    const versionsBefore = await accessVersions();
    const out = await service.enrollPersonaLogin(creds);
    assert.equal(out.subject, "nonprod-persona.serviceTechnician");
    const account = (await q(`SELECT a.*, pi.external_subject, pi.status AS binding_status FROM eos_policy.login_accounts a JOIN eos_policy.principal_identities pi ON pi.id = a.binding_id WHERE a.principal_id = $1`, [tech])).rows[0];
    assert.equal(account.status, "active");
    assert.equal(account.mfa_required, true);
    assert.equal(account.external_subject, "nonprod-persona.serviceTechnician");
    assert.equal(account.binding_status, "active", "the persona binding is untouched");
    assert.equal(account.login_identifier, "technician@sandbox.invalid");
    assert.match(account.password_hash, /^scrypt\$/);
    assert.ok(!account.password_hash.includes(creds.password), "only a hash is stored");
    const factor = (await q(`SELECT status, secret_sealed FROM eos_policy.login_mfa_factors WHERE account_id = $1`, [account.id])).rows;
    assert.equal(factor.length, 1);
    assert.equal(factor[0].status, "active");
    assert.ok(!factor[0].secret_sealed.includes(C.base32Encode(creds.totpSecret)), "the authenticator secret is sealed");
    const codes = (await q(`SELECT code_digest FROM eos_policy.login_recovery_codes WHERE account_id = $1 AND used_at IS NULL AND superseded_at IS NULL`, [account.id])).rows;
    assert.equal(codes.length, 10);
    for (const code of creds.recoveryCodes) assert.ok(!codes.some((c) => c.code_digest.includes(code.replace(/-/g, ""))), "digests only");
    const audit = (await q(`SELECT * FROM eos_policy.audit_events WHERE action = 'enrollPersonaLogin' AND target_id = $1`, [account.id])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_uid, tech, "the persona principal is the actor");
    const dump = JSON.stringify(audit[0]);
    assert.ok(!dump.includes(creds.password) && !dump.includes(C.base32Encode(creds.totpSecret)) && creds.recoveryCodes.every((c) => !dump.includes(c)), "the audit event carries no secret");
    assert.equal(await accessVersions(), versionsBefore, "no access version moved");
    assert.deepEqual(await authorityDigest(), authorityBefore, "no Role, grant, membership, link, binding or Principal changed");
  });

  await t.test("P2 refusals: never resets, never a real person, never a mismatched persona, never outside nonprod, never a weak password", async () => {
    const hashBefore = (await q(`SELECT password_hash FROM eos_policy.login_accounts WHERE principal_id = $1`, [tech])).rows[0].password_hash;
    await assert.rejects(service.enrollPersonaLogin(enrollInput()), /already has a login account/);
    assert.equal((await q(`SELECT password_hash FROM eos_policy.login_accounts WHERE principal_id = $1`, [tech])).rows[0].password_hash, hashBefore, "an existing credential is never replaced");
    await assert.rejects(service.enrollPersonaLogin(enrollInput({ personaKey: "dispatcher", principalId: real, loginIdentifier: "real@sandbox.invalid" })), /does not hold the persona's own EOS binding/);
    await assert.rejects(service.enrollPersonaLogin(enrollInput({ personaKey: "serviceTechnician", principalId: disp, loginIdentifier: "mismatch@sandbox.invalid" })), /does not hold the persona's own EOS binding/);
    await assert.rejects(service.enrollPersonaLogin(enrollInput({ personaKey: "notAPersona", principalId: disp, loginIdentifier: "x@sandbox.invalid" })), /not one of the governed persona keys/);
    await assert.rejects(service.enrollPersonaLogin(enrollInput({ personaKey: "dispatcher", principalId: disp, loginIdentifier: "d@sandbox.invalid", password: "short" })), /PASSWORD_POLICY|PASSWORD_TOO_SHORT/);
    await assert.rejects(service.enrollPersonaLogin(enrollInput({ personaKey: "dispatcher", principalId: disp, loginIdentifier: "d@sandbox.invalid", recoveryCodes: C.newRecoveryCodes().slice(0, 9) })), /ten distinct recovery codes/);
    await assert.rejects(service.enrollPersonaLogin(enrollInput({ personaKey: "dispatcher", principalId: disp, loginIdentifier: "technician@sandbox.invalid" })), /login identifier is in use/);
    const outsideNonprod = new EosLoginService({ pool, repo, signer: eosAuth.humanLogin.signer, issuer: ISS, audience: AUD, environment: "local",
      factorKeyring: eosAuth.humanLogin.factorKeyring, passwordHashParameters: FAST_HASH });
    await assert.rejects(outsideNonprod.enrollPersonaLogin(enrollInput({ personaKey: "dispatcher", principalId: disp, loginIdentifier: "d@sandbox.invalid" })), /nonprod only/);
    const noKeys = new EosLoginService({ pool, repo, signer: eosAuth.humanLogin.signer, issuer: ISS, audience: AUD, environment: "nonprod", factorKeyring: null, passwordHashParameters: FAST_HASH });
    await assert.rejects(noKeys.enrollPersonaLogin(enrollInput({ personaKey: "dispatcher", principalId: disp, loginIdentifier: "d@sandbox.invalid" })), /MFA_NOT_CONFIGURED/);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.login_accounts`)).rows[0].n, 1, "every refusal left the single enrolled account alone");
    // The Administration operation still refuses a persona (D-11): provisioning never gives a persona a login by itself.
    const res = await post("/admin/policy", { operation: "provisionLoginAccount", input: { principalId: disp, loginIdentifier: "viaadmin@sandbox.invalid", reason: "r" } }, bearer(machineToken("nonprod-persona.dispatcher")));
    assert.notEqual(res.status, 200);
  });

  let session;
  await t.test("P3 sign-in as the persona: password, then the authenticator; the token carries the persona subject and a session", async () => {
    const first = await post("/auth/login", { identifier: "technician@sandbox.invalid", password: creds.password });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, "MFA_REQUIRED", "the persona account requires its second factor");
    const wrong = await post("/auth/login/mfa", { challenge: first.body.challenge, code: "000000" });
    assert.equal(wrong.status, 401);
    const again = await post("/auth/login", { identifier: "technician@sandbox.invalid", password: creds.password });
    const code = C.totpCodeAt(creds.totpSecret, C.totpStepAt(Math.floor(Date.now() / 1000)));
    const done = await post("/auth/login/mfa", { challenge: again.body.challenge, code });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    session = done.body.session;
    const payload = JSON.parse(Buffer.from(session.accessToken.split(".")[1], "base64url").toString());
    assert.equal(payload.sub, "nonprod-persona.serviceTechnician");
    assert.ok(typeof payload.sid === "string" && payload.sid.length >= 16);
    for (const forbidden of ["roles", "role", "capabilities", "tenantId", "principalId"]) assert.ok(!(forbidden in payload), `no ${forbidden} claim`);
    const exp = await experience(session.accessToken);
    assert.equal(exp.status, 200, JSON.stringify(exp.body));
    assert.equal(exp.body.result?.principalId ?? exp.body.data?.principalId, tech, "the SAME Principal id the persona always had");
    const self = await post("/auth/account", {}, bearer(session.accessToken));
    assert.equal(self.status, 200, "an enrolled persona can use account self-service");
  });

  await t.test("P4 the machine path beside it: the persona ISSUER's token (no session) still resolves; a forged persona session does not", async () => {
    assert.equal((await experience(machineToken("nonprod-persona.serviceTechnician"))).status, 200);
    const forged = signEosAccessToken({ kid: "nonprod-p", privateKey: eosAuth.humanLogin.signer.privateKey },
      { iss: ISS, aud: AUD, sub: "nonprod-persona.serviceTechnician", sid: "x".repeat(32), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, jti: newTokenId(), env: "nonprod" });
    assert.equal((await experience(forged)).status, 401, "a persona token naming a session that does not exist is refused by the gate");
    // A persona WITHOUT a login account cannot carry a session at all.
    const other = signEosAccessToken({ kid: "nonprod-p", privateKey: eosAuth.humanLogin.signer.privateKey },
      { iss: ISS, aud: AUD, sub: "nonprod-persona.dispatcher", sid: session.sessionId ?? "y".repeat(32), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, jti: newTokenId(), env: "nonprod" });
    assert.equal((await experience(other)).status, 401, "another persona's subject cannot borrow this session");
  });

  await t.test("P5 administration: the persona login is disabled (immediately ends the session) but never removed", async () => {
    // The Firebase verifier is OFF here, so administration is driven through the service methods the HTTP operations route to.
    const actor = { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] };
    const status = await service.setLoginAccountStatus(actor, { principalId: tech, status: "disabled", reason: "B2 proof: disable the persona login" });
    assert.equal(status.status, "disabled");
    assert.ok(status.sessionsRevoked >= 1);
    assert.equal((await experience(session.accessToken)).status, 401, "the session ended at once, not at expiry");
    assert.equal((await experience(machineToken("nonprod-persona.serviceTechnician"))).status, 200, "the machine path is not the login");
    await assert.rejects(service.retireLoginAccount(actor, { principalId: tech, reason: "B2 proof: retire the persona login" }), /persona login is disabled, not removed/);
    assert.equal((await q(`SELECT status FROM eos_policy.principal_identities WHERE principal_id = $1`, [tech])).rows[0].status, "active", "the persona binding was not revoked");
  });

  await t.test("P6 a disabled persona login refuses sign-in uniformly", async () => {
    const refused = await post("/auth/login", { identifier: "technician@sandbox.invalid", password: creds.password });
    assert.equal(refused.status, 401, "a disabled persona login refuses sign-in uniformly");
  });

  await t.test("P7 the verifier switch: a Firebase bearer is refused WITHOUT the Firebase verifier running; the counters are a RESTRICTED administrator read, never /health", async () => {
    // MET-1 (Owner ruling): no authentication counter on the unauthenticated /health; an administrator reads them over EOS.
    const diag = (token) => post("/admin/policy", { operation: "readAuthVerifierDiagnostics", input: {} }, bearer(token));
    const adminToken = machineToken("nonprod-persona.administrator");
    const readBefore = await diag(adminToken);
    assert.equal(readBefore.status, 200, JSON.stringify(readBefore.body));
    const before = { auth: readBefore.body.data };
    assert.equal(before.auth.firebaseVerifier, "disabled", "the EOS bearer path reaches the read while the Firebase verifier is disabled");
    const denied = await diag(machineToken("nonprod-persona.dispatcher"));
    assert.equal(denied.status, 403, "a principal without admin.securityPolicy.read is refused");
    assert.equal(JSON.stringify(denied.body).includes("verified"), false, "and learns no count");
    assert.equal((await diag("not-a-token")).status, 401, "no bearer, no read");
    const healthBody = await health();
    assert.equal("auth" in healthBody, false, "/health carries no auth block");
    assert.doesNotMatch(JSON.stringify(healthBody), /verified|refused|firebaseVerifier|eos_human|eos_persona/);
    const calls = firebaseCalls;
    const res = await post("/admin/policy", { operation: "listTenantPrincipals", input: {} }, { authorization: "Bearer fb-token.fb-admin-uid" });
    assert.equal(res.status, 401);
    const op = await post("/operations/experience", { operation: "resolveMyExperienceContext" }, { authorization: "Bearer fb-token.fb-admin-uid" });
    assert.equal(op.status, 401);
    assert.equal(firebaseCalls, calls, "the Firebase verifier was never called");
    const readAfter = await diag(adminToken);
    assert.equal(readAfter.status, 200);
    const after = { auth: readAfter.body.data };
    // Three non-EOS bearers were refused without the Firebase verifier: the two Firebase probes and the malformed "not-a-token" above.
    assert.equal(after.auth.refused.firebase_disabled - before.auth.refused.firebase_disabled, 3);
    assert.equal(after.auth.verified.firebase, 0);
    assert.ok(after.auth.verified.eos_persona >= 2 && after.auth.verified.eos_human >= 1, JSON.stringify(after.auth));
    assert.deepEqual(Object.keys(after.auth).sort(), ["firebaseVerifier", "refused", "since", "verified"], "counts, the mode and a start time only");
    assert.ok(!JSON.stringify(after).includes("fb-admin-uid") && !JSON.stringify(after).includes(tech), "no subject or principal in the diagnostics");
  });

  await t.test("P8 ACTOR-NAME-1: a governed display name from a stated source; no inference, no authority change, no-op silent", async () => {
    const versionsBefore = await accessVersions();
    const named = await setPrincipalDisplayName(repo, bindAs, { principalId: tech, displayName: "Service Technician (synthetic)", source: "ADMINISTRATION_ENTERED", reason: "ACTOR-NAME-1 proof: administration-entered persona name" });
    assert.equal(named.displayName, "Service Technician (synthetic)");
    const audit = (await q(`SELECT * FROM eos_policy.audit_events WHERE action = 'setPrincipalDisplayName' AND target_id = $1`, [tech])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_uid, adminPrincipalId);
    assert.equal(audit[0].after.source, "ADMINISTRATION_ENTERED");
    assert.equal(audit[0].before.displayName, null);
    await setPrincipalDisplayName(repo, bindAs, { principalId: tech, displayName: "Service Technician (synthetic)", source: "ADMINISTRATION_ENTERED", reason: "restated: nothing changes" });
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'setPrincipalDisplayName' AND target_id = $1`, [tech])).rows[0].n, 1, "a restated name writes no audit event");
    await assert.rejects(setPrincipalDisplayName(repo, bindAs, { principalId: disp, displayName: "someone@example.test", source: "IDENTITY_PROVIDER_PROFILE", reason: "an email-shaped name" }), /looks like an email address/);
    await assert.rejects(setPrincipalDisplayName(repo, bindAs, { principalId: disp, displayName: "Valid Name", source: "INFERRED", reason: "bad source" }), /source must be/);
    await assert.rejects(setPrincipalDisplayName(repo, bindAs, { principalId: disp, displayName: "SERVICE TECHNICIAN (SYNTHETIC)", source: "IDENTITY_PROVIDER_PROFILE", reason: "a case-different duplicate of another principal's name" }),
      /already has that display name/);
    await assert.rejects(setPrincipalDisplayName(repo, { tenantId, uid: disp, heldRoleKeys: ["dispatcher"] }, { principalId: real, displayName: "Valid Name", source: "ADMINISTRATION_ENTERED", reason: "not an administrator" }), /not authorized|required/i);
    await assert.rejects(setPrincipalDisplayName(repo, bindAs, { principalId: "no-such-principal", displayName: "Valid Name", source: "ADMINISTRATION_ENTERED", reason: "unknown principal" }), /principal not found/);
    assert.equal(await accessVersions(), versionsBefore, "a name is a label: no access version moved");
    const afterDigest = await authorityDigest();
    assert.deepEqual({ ...afterDigest, principals: null }, { ...authorityBefore, principals: null }, "no authority row moved");
    assert.equal(afterDigest.principals, authorityBefore.principals, "the principal's id, provider, subject and status are unchanged (display_name is not in the digest)");
  });

  await t.test("P9 B2-x employee mode: sample and synthetic Employees get a login; a missing Principal is created through the governed path; fences hold", async () => {
    const { mkdtempSync, readFileSync, rmSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { enrollPersonaLoginsRun } = require("../scripts/enrollPersonaLogins.js");
    const { ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
    const authority = require("../lib/adminPolicy/administrationAuthority.js");
    const principalContext = require("../lib/adminPolicy/principalContext.js");
    const links = require("../lib/employeeIdentity/employeePrincipalLinkRepository.js");
    const { normalizeLoginIdentifier } = require("../lib/eosAuth/eosLoginService.js");
    const deps = { PostgresPolicyRepository, EosLoginService, credentialCrypto: C, ensureTenantPrincipal, links, normalizeLoginIdentifier,
      nonprodPersonaSubject: require("../lib/eosAuth/nonprodPersonas.js").nonprodPersonaSubject,
      hasSecurityAdministrationCapability: authority.hasSecurityAdministrationCapability,
      protectedRoleKeys: [authority.PROTECTED_OWNER_ROLE_KEY, authority.ADMIN_ROLE_KEY],
      capabilityKeysFor: require("../lib/adminPolicy/administrationCapabilityGate.js").capabilityKeysFor,
      resolvePrincipalContextById: principalContext.resolvePrincipalContextById, PrincipalContextError: principalContext.PrincipalContextError,
      runWithRequestScope: require("../lib/eosAuth/requestTenantBinding.js").runWithRequestScope };
    const base = { tenantKey: "persona-proof", adminPrincipalId: adminPrincipalId, reason: "B2-x proof: give the nonprod employees an EOS sign-in", operator: "Proof Operator", environmentId: "platform-sandbox" };

    const employee = (id, status, email) => q(
      `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, work_email, updated_at) VALUES ($1,$2,$3,'taylor',$4,'2020-01-01T00:00:00Z')`, [id, tenantId, status, email]);
    const sample = async (employeeId, subject, binding = null) => {
      const role = await repo.getRoleByKey(tenantId, "generalEmployee");
      const principalId = await repo.transact({ tenantId, uid: "employee-fixture" }, async (tx) => {
        const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "eos", displayName: null });
        await tx.createTenantMembership(p.id);
        const v = await tx.bumpAccessVersion(p.id);
        await tx.createAssignment({ principalId: p.id, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
          grantedBy: "employee-fixture", grantedAt: new Date(Date.now() - 60_000).toISOString(), accessVersionAtGrant: v });
        return p.id;
      });
      await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
               VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','employee-fixture','B2-x proof fixture')`, [`epl-${employeeId}`, tenantId, principalId, employeeId]);
      if (binding) await bindPrincipalEosIdentity(repo, bindAs, { principalId, externalSubject: binding, reason: "B2-x proof: a persona-bound sample principal" });
      return principalId;
    };
    await employee("np-taylor-tech-04", "ACTIVE", "np-taylor-tech-04@taylor.invalid");
    const techPrincipal = await sample("np-taylor-tech-04", "nonprod-sample.tech-04");
    await employee("synthetic-np-emp-records-clerk", "ACTIVE", "synthetic-np-emp-records-clerk@taylor.invalid"); // NO Principal
    await employee("synthetic-np-emp-technician-on-leave", "ON_LEAVE", "synthetic-np-emp-technician-on-leave@taylor.invalid"); // NO Principal
    await employee("np-taylor-gone", "INACTIVE", "np-taylor-gone@taylor.invalid");
    const gonePrincipal = await sample("np-taylor-gone", "nonprod-sample.gone");
    await employee("synthetic-np-emp-persona-bound", "ACTIVE", "synthetic-np-emp-persona-bound@taylor.invalid");
    await sample("synthetic-np-emp-persona-bound", "nonprod-sample.persona-bound", "nonprod-persona.officeManager");
    await employee("emp-real-person-2", "ACTIVE", "real.person@taylor.invalid"); // not a sample/synthetic id: never selected

    const counts = async () => JSON.stringify((await q(`SELECT
      (SELECT count(*)::int FROM eos_policy.principals) p, (SELECT count(*)::int FROM eos_policy.employee_principal_links) l,
      (SELECT count(*)::int FROM eos_policy.principal_identities) i, (SELECT count(*)::int FROM eos_policy.login_accounts) a,
      (SELECT count(*)::int FROM eos_policy.audit_events) e`)).rows[0]);
    const outcomes = (report) => Object.fromEntries(report.personas.map((x) => [x.employeeId, x.reason ? `${x.outcome}:${x.reason}` : x.outcome]));

    // ---- a dry run plans and writes nothing; the excluded and the persona-bound are not targets under all-missing.
    const before = await counts();
    const dry = await enrollPersonaLoginsRun(pool, { ...base, employees: "all-missing", apply: false }, deps);
    assert.equal(dry.outcome, "PLANNED", JSON.stringify(dry));
    assert.deepEqual(outcomes(dry), {
      "np-taylor-gone": "SKIPPED_EXCLUDED:EMPLOYEE_STATUS_EXCLUDED",
      "np-taylor-tech-04": "PLANNED",
      "synthetic-np-emp-persona-bound": "SKIPPED_EXCLUDED:PRINCIPAL_HOLDS_EOS_IDENTITY",
      "synthetic-np-emp-records-clerk": "PLANNED",
      "synthetic-np-emp-technician-on-leave": "PLANNED",
    });
    assert.equal(dry.personas.find((x) => x.employeeId === "synthetic-np-emp-records-clerk").createPrincipal, true);
    assert.match(dry.personas.find((x) => x.employeeId === "synthetic-np-emp-technician-on-leave").signInNote, /ACTIVE or CONTRACTOR/);
    assert.equal(await counts(), before, "a dry run writes nothing");

    // ---- named, the same Employees are REFUSED (and so is a missing one); a refusal blocks an apply wholesale.
    const refused = await enrollPersonaLoginsRun(pool, { ...base, employees: ["np-taylor-gone", "synthetic-np-emp-persona-bound", "np-taylor-nobody"], apply: false }, deps);
    assert.equal(refused.outcome, "REFUSED");
    assert.deepEqual(outcomes(refused), {
      "np-taylor-gone": "REFUSED:EMPLOYEE_STATUS_EXCLUDED", "synthetic-np-emp-persona-bound": "REFUSED:PRINCIPAL_HOLDS_EOS_IDENTITY", "np-taylor-nobody": "REFUSED:EMPLOYEE_NOT_FOUND",
    });
    await assert.rejects(enrollPersonaLoginsRun(pool, { ...base, adminPrincipalId: tech, employees: "all-missing", apply: false }, deps), /ADMINISTRATOR_UNAUTHORIZED/);
    // A General Manager passes the role-NAME test but not the capability gate ensureTenantPrincipal applies: refused at PLAN time.
    const gm = await makePrincipal("gm-proof", "generalManager", "fb-gm-proof");
    assert.ok(authority.hasAdministrationAuthority(["generalManager"], "assignRole"), "the role-name test would have admitted it");
    await assert.rejects(enrollPersonaLoginsRun(pool, { ...base, adminPrincipalId: gm, employees: "all-missing", apply: false }, deps), /ADMINISTRATOR_UNAUTHORIZED/);

    // ---- apply: credentials to a file outside the repository, nothing secret in the report.
    const dir = mkdtempSync(join(tmpdir(), "b2x-creds-"));
    const credentialsOut = join(dir, "credentials.json");
    process.env.EOS_AUTH_FACTOR_KEYS = authEnv.EOS_AUTH_FACTOR_KEYS;
    process.env.EOS_AUTH_FACTOR_KEY_ID = authEnv.EOS_AUTH_FACTOR_KEY_ID;
    try {
      const applied = await enrollPersonaLoginsRun(pool, { ...base, employees: "all-missing", apply: true, credentialsOut }, deps);
      assert.equal(applied.outcome, "ENROLLED", JSON.stringify(applied));
      const file = JSON.parse(readFileSync(credentialsOut, "utf8"));
      assert.equal(file.schema, "eos.persona-login-credentials/1");
      assert.deepEqual(file.entries.map((e) => [e.personaKey, e.state]), [["np-taylor-tech-04", "enrolled"], ["synthetic-np-emp-records-clerk", "enrolled"], ["synthetic-np-emp-technician-on-leave", "enrolled"]]);
      if (process.platform !== "win32") assert.equal(statSync(credentialsOut).mode & 0o777, 0o600);
      const reportText = JSON.stringify(applied);
      for (const e of file.entries) assert.ok(!reportText.includes(e.password) && !reportText.includes(e.totpSecretBase32) && e.recoveryCodes.every((c) => !reportText.includes(c)), "the report carries no credential");
      const entry = (key) => file.entries.find((e) => e.personaKey === key);

      // The sample Principal kept its primary identity and gained ONE human EOS identity; the clerk's Principal was created governed.
      const sampleIds = (await q(`SELECT identity_provider, external_subject FROM eos_policy.principals WHERE id = $1`, [techPrincipal])).rows[0];
      assert.deepEqual(sampleIds, { identity_provider: "eos", external_subject: "nonprod-sample.tech-04" });
      const binding = (await q(`SELECT external_subject FROM eos_policy.principal_identities WHERE principal_id = $1 AND status = 'active'`, [techPrincipal])).rows;
      assert.equal(binding.length, 1);
      assert.match(binding[0].external_subject, /^user\.[0-9a-f]{32}$/);
      const clerk = (await q(`SELECT p.id, p.identity_provider, p.external_subject, p.display_name, m.status AS membership FROM eos_policy.principals p JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id
                              WHERE p.external_subject = 'synthetic-np-principal-records-clerk'`)).rows;
      assert.equal(clerk.length, 1);
      assert.deepEqual({ ...clerk[0], id: null }, { id: null, identity_provider: "eos-synthetic-nonprod", external_subject: "synthetic-np-principal-records-clerk", display_name: null, membership: "active" });
      const link = (await q(`SELECT link_source, asserted_by, assertion_reason, status FROM eos_policy.employee_principal_links WHERE employee_id = 'synthetic-np-emp-records-clerk'`)).rows;
      assert.equal(link.length, 1);
      assert.equal(link[0].link_source, "OPERATOR_ASSERTED");
      assert.equal(link[0].asserted_by, adminPrincipalId);
      assert.match(link[0].assertion_reason, /by Proof Operator$/);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE principal_id = $1`, [clerk[0].id])).rows[0].n, 0, "a created Principal holds no Security Role");
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'tenant.addPrincipal' AND target_id = $1`, [clerk[0].id])).rows[0].n, 1);
      const audits = (await q(`SELECT action, actor_uid, after FROM eos_policy.audit_events WHERE action = 'enrollEmployeeLogin' ORDER BY occurred_at`)).rows;
      assert.equal(audits.length, 3, "one audit event per enrollment");
      assert.ok(!JSON.stringify(audits).includes(entry("np-taylor-tech-04").password), "no secret in the audit");
      assert.ok(audits.every((a) => a.after.assertedBy === adminPrincipalId), "every enrollment audit records the asserting administrator");
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.login_accounts WHERE status = 'active' AND mfa_required`)).rows[0].n, 3, "three new active accounts (the persona account was disabled in P5)");

      // The sample Employee signs in (password, authenticator) with a HUMAN token that resolves to the Principal it always had.
      const secretOf = (b32) => { // RFC 4648 base32, unpadded
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0; let value = 0; const out = [];
        for (const ch of b32) { value = (value << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
        return Buffer.from(out);
      };
      const first = await post("/auth/login", { identifier: entry("np-taylor-tech-04").loginIdentifier, password: entry("np-taylor-tech-04").password });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.status, "MFA_REQUIRED");
      const done = await post("/auth/login/mfa", { challenge: first.body.challenge, code: C.totpCodeAt(secretOf(entry("np-taylor-tech-04").totpSecretBase32), C.totpStepAt(Math.floor(Date.now() / 1000))) });
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.match(JSON.parse(Buffer.from(done.body.session.accessToken.split(".")[1], "base64url").toString()).sub, /^user\.[0-9a-f]{32}$/);
      const exp = await experience(done.body.session.accessToken);
      assert.equal(exp.status, 200, JSON.stringify(exp.body));
      assert.equal(exp.body.result?.principalId ?? exp.body.data?.principalId, techPrincipal);
      // ON_LEAVE enrolls but the DQ-007 gate still refuses the sign-in.
      const leave = await post("/auth/login", { identifier: entry("synthetic-np-emp-technician-on-leave").loginIdentifier, password: entry("synthetic-np-emp-technician-on-leave").password });
      assert.equal(leave.status, 401, "an ON_LEAVE Employee cannot sign in until ACTIVE");

      // ---- idempotent: a re-run skips every enrolled Employee and writes nothing.
      const afterApply = await counts();
      const again = await enrollPersonaLoginsRun(pool, { ...base, employees: "all-missing", apply: false }, deps);
      assert.deepEqual(outcomes(again), {
        "np-taylor-gone": "SKIPPED_EXCLUDED:EMPLOYEE_STATUS_EXCLUDED", "np-taylor-tech-04": "SKIPPED_EXISTS:login account is active; never reset or replaced",
        "synthetic-np-emp-persona-bound": "SKIPPED_EXCLUDED:PRINCIPAL_HOLDS_EOS_IDENTITY", "synthetic-np-emp-records-clerk": "SKIPPED_EXISTS:login account is active; never reset or replaced",
        "synthetic-np-emp-technician-on-leave": "SKIPPED_EXISTS:login account is active; never reset or replaced",
      });
      assert.equal(await counts(), afterApply);
      // A credentials file is never overwritten.
      await assert.rejects(enrollPersonaLoginsRun(pool, { ...base, employees: "all-missing", apply: true, credentialsOut }, deps), /never overwrites/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // ---- data that breaks a rule is REFUSED when named: a non-reserved address; a sample Employee with no Principal (the seed owns it).
    await employee("np-taylor-bad-email", "ACTIVE", "someone@example.com");
    await sample("np-taylor-bad-email", "nonprod-sample.bad-email");
    await employee("np-taylor-no-principal", "ACTIVE", "np-taylor-no-principal@taylor.invalid");
    const bad = await enrollPersonaLoginsRun(pool, { ...base, employees: ["np-taylor-bad-email", "np-taylor-no-principal"], apply: false }, deps);
    assert.deepEqual(outcomes(bad), { "np-taylor-bad-email": "REFUSED:EMPLOYEE_EMAIL_NOT_RESERVED_INVALID", "np-taylor-no-principal": "REFUSED:SAMPLE_EMPLOYEE_HAS_NO_PRINCIPAL" });

    // ---- the service's own fences, beneath the tool.
    const enrollEmployee = (over) => service.enrollEmployeeLogin({
      tenantId, employeeId: "np-taylor-gone", principalId: gonePrincipal, loginIdentifier: "np-taylor-gone@taylor.invalid",
      password: randomBytes(24).toString("base64url"), totpSecret: C.newTotpSecret(), recoveryCodes: C.newRecoveryCodes(),
      reason: "B2-x proof: service fence", assertedBy: adminPrincipalId, ...over,
    });
    await assert.rejects(enrollEmployee({}), /status does not allow a sign-in/);
    await assert.rejects(enrollEmployee({ employeeId: "emp-real-person-2" }), /not a nonprod sample or synthetic Employee/);
    await assert.rejects(enrollEmployee({ employeeId: "np-taylor-tech-04" }), /not linked to exactly that Employee/);
    await assert.rejects(enrollEmployee({ loginIdentifier: "someone@example.com" }), /reserved \.invalid address/);
    await assert.rejects(new EosLoginService({ pool, repo, signer: eosAuth.humanLogin.signer, issuer: ISS, audience: AUD, environment: "local",
      factorKeyring: eosAuth.humanLogin.factorKeyring, passwordHashParameters: FAST_HASH }).enrollEmployeeLogin({
      tenantId, employeeId: "np-taylor-gone", principalId: gonePrincipal, loginIdentifier: "x@taylor.invalid", password: "irrelevant-password-1", totpSecret: C.newTotpSecret(), recoveryCodes: C.newRecoveryCodes(), reason: "B2-x proof: outside nonprod" }), /nonprod only/);
    // The administering Principal (a real person's) is never enrolled by this tool, even when linked to a prefixed Employee.
    await employee("np-taylor-admin-linked", "ACTIVE", "np-taylor-admin-linked@taylor.invalid");
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
             VALUES ('epl-admin-linked',$1,$2,'np-taylor-admin-linked','taylor','OPERATOR_ASSERTED','employee-fixture','B2-x proof fixture')`, [tenantId, adminPrincipalId]);
    await assert.rejects(enrollEmployee({ employeeId: "np-taylor-admin-linked", principalId: adminPrincipalId, loginIdentifier: "np-taylor-admin-linked@taylor.invalid" }), /Owner or Administrator is not enrolled/);
    await assert.rejects(enrollEmployee({ assertedBy: " " }), /assertedBy/);

    // ---- the login name IS the Employee's work_email; a separation date refuses whatever the status says.
    await employee("np-taylor-mismatch", "ACTIVE", "np-taylor-mismatch@taylor.invalid");
    const mismatchPrincipal = await sample("np-taylor-mismatch", "nonprod-sample.mismatch");
    await assert.rejects(enrollEmployee({ employeeId: "np-taylor-mismatch", principalId: mismatchPrincipal, loginIdentifier: "another-name@taylor.invalid" }), /Employee's own work_email/);
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, work_email, separation_date, updated_at)
             VALUES ('np-taylor-separated',$1,'ACTIVE','taylor','np-taylor-separated@taylor.invalid','2026-01-01','2020-01-01T00:00:00Z')`, [tenantId]);
    const separatedPrincipal = await sample("np-taylor-separated", "nonprod-sample.separated");
    await assert.rejects(enrollEmployee({ employeeId: "np-taylor-separated", principalId: separatedPrincipal, loginIdentifier: "np-taylor-separated@taylor.invalid" }), /separation date/);

    // ---- a login somebody RETIRED is never silently re-created (service and plan); the Owner/Administrator Principal is shown up front.
    await employee("np-taylor-retired", "ACTIVE", "np-taylor-retired@taylor.invalid");
    const retiredPrincipal = await sample("np-taylor-retired", "nonprod-sample.retired");
    await enrollEmployee({ employeeId: "np-taylor-retired", principalId: retiredPrincipal, loginIdentifier: "np-taylor-retired@taylor.invalid" });
    await service.retireLoginAccount({ tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] }, { principalId: retiredPrincipal, reason: "B2-x proof: retire the sample login on purpose" });
    await assert.rejects(enrollEmployee({ employeeId: "np-taylor-retired", principalId: retiredPrincipal, loginIdentifier: "np-taylor-retired@taylor.invalid" }), /LOGIN_RETIRED/);
    const named = await enrollPersonaLoginsRun(pool, { ...base, employees: ["np-taylor-retired", "np-taylor-admin-linked", "np-taylor-mismatch", "np-taylor-separated"], apply: false }, deps);
    assert.deepEqual(outcomes(named), {
      "np-taylor-retired": "REFUSED:LOGIN_RETIRED", "np-taylor-admin-linked": "REFUSED:PRINCIPAL_IS_OWNER_OR_ADMINISTRATOR",
      "np-taylor-mismatch": "PLANNED", "np-taylor-separated": "REFUSED:EMPLOYEE_STATUS_EXCLUDED",
    });
    const sweep = await enrollPersonaLoginsRun(pool, { ...base, employees: "all-missing", apply: false }, deps);
    const sweepOutcomes = outcomes(sweep);
    assert.equal(sweepOutcomes["np-taylor-retired"], "SKIPPED_EXCLUDED:LOGIN_RETIRED");
    assert.equal(sweepOutcomes["np-taylor-admin-linked"], "SKIPPED_EXCLUDED:PRINCIPAL_IS_OWNER_OR_ADMINISTRATOR");
    assert.equal(sweepOutcomes["np-taylor-separated"], "SKIPPED_EXCLUDED:EMPLOYEE_STATUS_EXCLUDED");
    assert.equal(sweepOutcomes["np-taylor-mismatch"], "PLANNED");
  });
});
