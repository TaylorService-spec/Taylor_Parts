// FIREBASE EXIT B2, AGAINST A REAL postgres:16 AND THE REAL IN-PROCESS EOS API:
//   (P1-P3) synthetic persona enrollment -- a password login and an authenticator on the persona's OWN EOS binding;
//   (P4-P6) the persona password session, its isolation, and the machine path beside it;
//   (P7)    the verifier switch: Firebase bearers refused without the Firebase verifier being called, and the /health counters;
//   (P8)    ACTOR-NAME-1: governed principal display names.
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

  await t.test("P7 the verifier switch: a Firebase bearer is refused WITHOUT the Firebase verifier running; /health reports the counters", async () => {
    const before = await health();
    assert.equal(before.auth.firebaseVerifier, "disabled");
    const calls = firebaseCalls;
    const res = await post("/admin/policy", { operation: "listTenantPrincipals", input: {} }, { authorization: "Bearer fb-token.fb-admin-uid" });
    assert.equal(res.status, 401);
    const op = await post("/operations/experience", { operation: "resolveMyExperienceContext" }, { authorization: "Bearer fb-token.fb-admin-uid" });
    assert.equal(op.status, 401);
    assert.equal(firebaseCalls, calls, "the Firebase verifier was never called");
    const after = await health();
    assert.equal(after.auth.refused.firebase_disabled - before.auth.refused.firebase_disabled, 2);
    assert.equal(after.auth.verified.firebase, 0);
    assert.ok(after.auth.verified.eos_persona >= 2 && after.auth.verified.eos_human >= 1, JSON.stringify(after.auth));
    assert.deepEqual(Object.keys(after.auth).sort(), ["firebaseVerifier", "refused", "since", "verified"], "counts and a start time only");
    assert.ok(!JSON.stringify(after).includes("fb-admin-uid") && !JSON.stringify(after).includes(tech), "no subject or principal in /health");
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
    await assert.rejects(setPrincipalDisplayName(repo, { tenantId, uid: disp, heldRoleKeys: ["dispatcher"] }, { principalId: real, displayName: "Valid Name", source: "ADMINISTRATION_ENTERED", reason: "not an administrator" }), /not authorized|required/i);
    await assert.rejects(setPrincipalDisplayName(repo, bindAs, { principalId: "no-such-principal", displayName: "Valid Name", source: "ADMINISTRATION_ENTERED", reason: "unknown principal" }), /principal not found/);
    assert.equal(await accessVersions(), versionsBefore, "a name is a label: no access version moved");
    const afterDigest = await authorityDigest();
    assert.deepEqual({ ...afterDigest, principals: null }, { ...authorityBefore, principals: null }, "no authority row moved");
    assert.equal(afterDigest.principals, authorityBefore.principals, "the principal's id, provider, subject and status are unchanged (display_name is not in the digest)");
  });
});
