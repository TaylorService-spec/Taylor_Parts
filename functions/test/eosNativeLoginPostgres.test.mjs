// EOS NATIVE LOGIN, END TO END, against a real postgres:16 and the REAL in-process EOS API.
// docs/architecture/eos-native-identity.md, section 6 (proofs L1-L24).
//
// Its OWN disposable database (migrated by the normal runner, dropped afterwards). Signing keys and the factor key are
// generated IN MEMORY for this run. The Firebase verifier is a FAKE injected through the existing seam; nothing here
// contacts Firebase, Google or any network other than the loopback database and the loopback API.
//
//   tenant + bootstrap administrator (firebase) + an Owner + three human Principals (Employees, one Role each)
//   + one persona Principal holding its persona EOS binding
//   -> Administration provisions logins -> holders enroll -> log in -> MFA -> refresh -> recover -> are administered.
import "./support/firebaseOfflineGuard.cjs";
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
const DB_NAME = `eos_login_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const ISS = "https://eos-api-nonprod.test/auth";
const AUD = "https://eos-api-nonprod.test";
const ORIGIN = "https://verenwardeos.test";
const PASSWORDS = Object.freeze({ alice: "correct horse battery staple", alice2: "a different long passphrase 7", bob: "bob's long enough passphrase", olivia: "owner owns the long phrase" });

test("EOS native login: accounts, sessions, MFA, recovery and administration, in PostgreSQL through the EOS API", { skip: SKIP, concurrency: 1 }, async (t) => {
  delete process.env.SANDBOX_CREDENTIALS_FILE;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  let pool; let service; let inertService;
  t.after(async () => {
    if (service) await service.close().catch(() => {});
    if (inertService) await inertService.close().catch(() => {});
    if (pool) await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const up = spawnSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(up.error, undefined, String(up.error));
  assert.equal(up.status, 0, up.stderr);

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { bindPrincipalEosIdentity } = require("../lib/adminPolicy/policyCommands.js");
  const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");
  const { signEosAccessToken, newTokenId } = require("../lib/eosAuth/eosAccessToken.js");
  const { totpCodeAt, totpStepAt } = require("../lib/eosAuth/credentialCrypto.js");
  const { startEosApi } = require("../lib/eosApi/server.js");

  pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // ════════════════════ fixture ════════════════════
  const { tenant } = await bootstrapTenant(repo, { key: "login-proof", name: "EOS login proof tenant", actorUid: "login-proof" });
  const tenantId = tenant.id;
  const admin = await bootstrapAdministrator(repo, { tenantId, externalSubject: "fb-admin-uid", performedBy: "login-proof" });
  const adminPrincipalId = admin.principal.id;
  const makePrincipal = async (key, roleKey, firebaseUid, employmentStatus) => {
    const role = await repo.getRoleByKey(tenantId, roleKey);
    assert.ok(role, `seed defines ${roleKey}`);
    const principalId = await repo.transact({ tenantId, uid: "login-fixture" }, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: firebaseUid, identityProvider: "firebase", displayName: key });
      await tx.createTenantMembership(p.id);
      const v = await tx.bumpAccessVersion(p.id);
      await tx.createAssignment({ principalId: p.id, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "login-fixture", grantedAt: new Date(Date.now() - 60_000).toISOString(), accessVersionAtGrant: v });
      return p.id;
    });
    if (employmentStatus) {
      await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,$2,$3,'taylor','2020-01-01T00:00:00Z')`,
        [`emp-${key}`, tenantId, employmentStatus]);
      await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
               VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','login-fixture','EOS login proof fixture')`, [`epl-${key}`, tenantId, principalId, `emp-${key}`]);
    }
    return principalId;
  };
  // THE GOVERNED ROLE -> CAPABILITY MATRIX (the committed authority baseline): admin and owner hold
  // admin.credentialReset.initiate and admin.userStatus.write exactly as they do in nonprod.
  {
    const baseline = require("../lib/adminPolicy/seed/roleCapabilityAuthorityBaseline.json");
    const [caps, roles, existing] = await Promise.all([repo.listCapabilities(), repo.listRoles(tenantId), repo.listRoleCapabilities(tenantId)]);
    const capId = new Map(caps.map((c) => [c.key, c.id]));
    const roleId = new Map(roles.map((r) => [r.key, r.id]));
    const have = new Set(existing.map((e) => `${e.roleId}|${e.capabilityId}`));
    await repo.transact({ tenantId, uid: "login-fixture" }, async (tx) => {
      for (const g of baseline.grants) {
        const r = roleId.get(g.roleKey); const c = capId.get(g.capabilityKey);
        if (!r || !c || have.has(`${r}|${c}`)) continue;
        have.add(`${r}|${c}`);
        await tx.grantRoleCapability({ roleId: r, capabilityId: c, grantedBy: "login-fixture", grantedAt: new Date(Date.now() - 120_000).toISOString() });
      }
    });
  }
  const alice = await makePrincipal("alice", "technician", "fb-alice", "ACTIVE");
  const bob = await makePrincipal("bob", "dispatcher", "fb-bob", "ACTIVE");
  const carol = await makePrincipal("carol", "generalEmployee", "fb-carol", "ACTIVE");
  const olivia = await makePrincipal("olivia", "owner", "fb-olivia", "ACTIVE");
  const adam = await makePrincipal("adam", "admin", "fb-adam", "ACTIVE");
  const svc = await makePrincipal("service-principal", "generalEmployee", "fb-svc", null); // no Employee
  const owner2 = await makePrincipal("owner2", "owner", "fb-owner2", null); // a second Owner, administering
  const persona = await makePrincipal("persona-dispatcher", "dispatcher", "fb-persona-dispatcher", "ACTIVE");
  await bindPrincipalEosIdentity(repo, { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] },
    { principalId: persona, externalSubject: "nonprod-persona.dispatcher", reason: "persona fixture" });

  // AUTHORITY BASELINE: every row that says what anybody may do. Must be IDENTICAL at the end.
  const authorityDigest = async () => (await q(`SELECT
      (SELECT md5(string_agg(id || principal_id || role_id || status::text || scope_type, ',' ORDER BY id)) FROM eos_policy.user_role_assignments) ura,
      (SELECT md5(coalesce(string_agg(role_id || capability_id, ',' ORDER BY role_id, capability_id), '')) FROM eos_policy.role_capabilities) rc,
      (SELECT count(*)::int FROM eos_policy.principal_capabilities) pc,
      (SELECT count(*)::int FROM eos_policy.principals) principals,
      (SELECT count(*)::int FROM eos_workforce.employees) employees,
      (SELECT md5(string_agg(id || principal_id || employee_id, ',' ORDER BY id)) FROM eos_policy.employee_principal_links) links`)).rows[0];
  const authorityBefore = await authorityDigest();

  // ════════════════════ the service ════════════════════
  const signing = generateKeyPairSync("ed25519");
  const authEnv = {
    EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-login": signing.publicKey.export({ format: "jwk" }) }),
    EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD,
    EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(signing.privateKey.export({ format: "jwk" })),
    EOS_AUTH_SIGNING_KID: "nonprod-login",
    EOS_HUMAN_LOGIN: "enabled",
    EOS_AUTH_FACTOR_KEYS: JSON.stringify({ f1: randomBytes(32).toString("base64url") }),
    EOS_AUTH_FACTOR_KEY_ID: "f1",
  };
  const eosAuth = readEosAuthConfig(authEnv, "nonprod");
  assert.ok(eosAuth.humanLogin && eosAuth.humanLogin.factorKeyring);
  const fakeFirebase = async (token) => {
    const m = /^fb-token\.(.+)$/.exec(token);
    if (!m) throw new Error("not a fake firebase token");
    return { externalSubject: m[1], identityProvider: "firebase" };
  };
  process.env.DATABASE_URL = dbUrl();
  const captured = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ["log", "error", "warn"]) console[k] = (...a) => { captured.push(a.map(String).join(" ")); };
  t.after(() => Object.assign(console, orig));
  service = await startEosApi({
    config: { port: 0, environment: "nonprod", allowedOrigins: [ORIGIN], identityProvider: "firebase", eosAuth },
    firebaseVerifyToken: fakeFirebase,
    // Cheaper scrypt for the proof; production parameters are proven by the unit suite.
    loginServiceOverrides: { passwordHashParameters: { N: 2 ** 14, r: 8, p: 1 } },
    loginRateLimit: { credentialPerMinute: 10_000, routinePerMinute: 10_000 },
  });
  const base = `http://127.0.0.1:${service.port}`;
  const post = async (path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body ?? {}) });
    let json = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json, headers: res.headers };
  };
  const asAdmin = (operation, input) => post("/admin/policy", { operation, input }, { authorization: "Bearer fb-token.fb-admin-uid" });
  const asFirebase = (uid, operation, input) => post("/admin/policy", { operation, input }, { authorization: `Bearer fb-token.${uid}` });
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const experience = (token) => post("/operations/experience", { operation: "resolveMyExperienceContext" }, bearer(token));
  const login = (identifier, password) => post("/auth/login", { identifier, password });
  const loginEvents = async (accountId) => (await q(`SELECT event, outcome, reason_code FROM eos_policy.authentication_events WHERE account_id = $1 ORDER BY occurred_at, id`, [accountId])).rows;
  const accountOf = async (principalId) => (await q(`SELECT * FROM eos_policy.login_accounts WHERE principal_id = $1 AND status <> 'retired'`, [principalId])).rows[0];
  const secretsSeen = []; // every secret value this run handled, for the at-rest and log scans

  // ════════════════════ L1: inert unless enabled ════════════════════
  await t.test("L1 inert: without EOS_HUMAN_LOGIN the front door is a 404, and a human-subject token is refused", async () => {
    const { EOS_HUMAN_LOGIN, EOS_AUTH_FACTOR_KEYS, EOS_AUTH_FACTOR_KEY_ID, ...rest } = authEnv;
    const off = readEosAuthConfig(rest, "nonprod");
    assert.equal(off.humanLogin, null);
    inertService = await startEosApi({ config: { port: 0, environment: "nonprod", allowedOrigins: [], identityProvider: "firebase", eosAuth: off }, firebaseVerifyToken: fakeFirebase });
    const r = await fetch(`http://127.0.0.1:${inertService.port}/auth/login`, { method: "POST", body: "{}" });
    assert.equal(r.status, 404);
    const forged = signEosAccessToken({ kid: "nonprod-login", privateKey: eosAuth.humanLogin.signer.privateKey }, {
      iss: ISS, aud: AUD, sub: `user.${"a".repeat(32)}`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60,
      jti: newTokenId(), env: "nonprod", sid: "s".repeat(32) });
    const r2 = await fetch(`http://127.0.0.1:${inertService.port}/operations/experience`, { method: "POST", headers: bearer(forged), body: JSON.stringify({ operation: "resolveMyExperienceContext" }) });
    assert.equal(r2.status, 401);
    // Config refuses the half-configured states.
    assert.throws(() => readEosAuthConfig({ EOS_HUMAN_LOGIN: "enabled" }, "nonprod"), /requires EOS token verification/);
    assert.throws(() => readEosAuthConfig({ ...rest, EOS_HUMAN_LOGIN: "yes" }, "nonprod"), /must be 'enabled' or 'disabled'/);
    assert.throws(() => readEosAuthConfig({ ...rest, EOS_AUTH_FACTOR_KEYS: authEnv.EOS_AUTH_FACTOR_KEYS, EOS_AUTH_FACTOR_KEY_ID: "f1" }, "nonprod"), /EOS_HUMAN_LOGIN is not enabled/);
  });

  // ════════════════════ L2-L6: provisioning through Administration ════════════════════
  let aliceTicket; let aliceAccount;
  await t.test("L2 provisioning: Administration gives an EXISTING Principal a login; ticket shown once; audited; no authority moves", async () => {
    const r = await asAdmin("provisionLoginAccount", { principalId: alice, loginIdentifier: "Alice@Taylor.Test", reason: "new hire login" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.data;
    assert.equal(d.loginIdentifier, "alice@taylor.test");
    assert.equal(d.status, "pending_enrollment");
    assert.match(d.subject, /^user\.[0-9a-f]{32}$/);
    assert.match(d.enrollmentTicket, /^eoset_[A-Za-z0-9_-]{43}$/);
    aliceTicket = d.enrollmentTicket; aliceAccount = d.accountId;
    secretsSeen.push(aliceTicket);
    const binding = (await q(`SELECT * FROM eos_policy.principal_identities WHERE principal_id = $1 AND status = 'active'`, [alice])).rows;
    assert.equal(binding.length, 1);
    assert.equal(binding[0].external_subject, d.subject);
    const audit = (await q(`SELECT * FROM eos_policy.audit_events WHERE action = 'provisionLoginAccount' AND target_id = $1`, [aliceAccount])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_uid, adminPrincipalId);
    assert.ok(!JSON.stringify(audit[0]).includes(aliceTicket), "the audit event never carries the ticket");
    const read = await asAdmin("readLoginAccount", { principalId: alice });
    assert.equal(read.body.data.account.status, "pending_enrollment");
    assert.equal(read.body.data.account.mfaEnrolled, false);
  });

  await t.test("L3 provisioning refusals: self, Owner by non-Owner, persona, no reason, duplicate identifier, non-administrator", async () => {
    assert.equal((await asAdmin("provisionLoginAccount", { principalId: adminPrincipalId, loginIdentifier: "me@x.test", reason: "r" })).status, 403);
    const owner = await asAdmin("provisionLoginAccount", { principalId: olivia, loginIdentifier: "olivia@x.test", reason: "r" });
    assert.equal(owner.status, 403);
    assert.match(owner.body.message, /PROTECTED_TARGET/);
    const pers = await asAdmin("provisionLoginAccount", { principalId: persona, loginIdentifier: "persona@x.test", reason: "r" });
    assert.equal(pers.status, 409);
    assert.match(pers.body.message, /already has an active EOS identity/);
    assert.equal((await asAdmin("provisionLoginAccount", { principalId: bob, loginIdentifier: "bob@x.test" })).status, 400);
    assert.equal((await asAdmin("provisionLoginAccount", { principalId: bob, loginIdentifier: "alice@taylor.test", reason: "r" })).status, 409);
    assert.equal((await asFirebase("fb-carol", "provisionLoginAccount", { principalId: bob, loginIdentifier: "bob@x.test", reason: "r" })).status, 403);
    assert.equal((await asFirebase("fb-carol", "readLoginAccount", { principalId: alice })).status, 403);
    // A Principal with no Employee gets no password (DECISIONS #56: missing Employee linkage is denied).
    const noEmp = await asAdmin("provisionLoginAccount", { principalId: svc, loginIdentifier: "svc@x.test", reason: "r" });
    assert.equal(noEmp.status, 409);
    assert.match(noEmp.body.message, /EMPLOYEE_LINK_REQUIRED/);
    // Each operation needs ITS governed key: the dispatcher holds none of them.
    for (const op of ["issueLoginReset", "setLoginAccountStatus", "revokeLoginSessions", "resetLoginMfa", "unlockLoginAccount"]) {
      const r = await asFirebase("fb-bob", op, { principalId: alice, reason: "r", status: "disabled" });
      assert.equal(r.status, 403, op);
    }
    // The persona's EOS binding is untouched by the refusal.
    const pb = (await q(`SELECT external_subject, status FROM eos_policy.principal_identities WHERE principal_id = $1`, [persona])).rows;
    assert.deepEqual(pb, [{ external_subject: "nonprod-persona.dispatcher", status: "active" }]);
  });

  await t.test("L4 an Owner may administer an Owner's login (and the protected-target rule names who may)", async () => {
    // olivia's Owner Role holds admin.roleAssignment.write in the seed; another Owner principal administers her login.
    const r = await asFirebase("fb-owner2", "provisionLoginAccount", { principalId: olivia, loginIdentifier: "olivia@taylor.test", reason: "owner login" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    secretsSeen.push(r.body.data.enrollmentTicket);
    assert.ok(owner2);
  });

  // ════════════════════ L5-L6: enrollment ════════════════════
  await t.test("L5 before enrollment the account cannot log in; the refusal is uniform", async () => {
    const r = await login("alice@taylor.test", PASSWORDS.alice);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "LOGIN_REFUSED");
    const unknown = await login("nobody@taylor.test", PASSWORDS.alice);
    assert.deepEqual(unknown.body, r.body, "unknown identifier and pending account are indistinguishable");
  });

  await t.test("L6 enrollment: password policy, single-use ticket, account becomes active", async () => {
    for (const [pw, rule] of [["short", "PASSWORD_TOO_SHORT"], ["password1234", "PASSWORD_TOO_COMMON"], ["aaaaaaaaaaaaaaaa", "PASSWORD_REPETITIVE"], ["xx-alice-yy-123", "PASSWORD_CONTAINS_IDENTIFIER"]]) {
      const r = await post("/auth/enrollment/complete", { ticket: aliceTicket, password: pw });
      assert.equal(r.status, 400, pw);
      assert.equal(r.body.detail, rule);
    }
    const ok = await post("/auth/enrollment/complete", { ticket: aliceTicket, password: PASSWORDS.alice });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.loginIdentifier, "alice@taylor.test");
    assert.equal((await post("/auth/enrollment/complete", { ticket: aliceTicket, password: PASSWORDS.alice })).status, 410);
    assert.equal((await accountOf(alice)).status, "active");
    assert.equal((await post("/auth/enrollment/complete", { ticket: `eoset_${"A".repeat(43)}`, password: PASSWORDS.alice })).status, 410);
  });

  // ════════════════════ L7: login resolves to the SAME Principal and context as Firebase ════════════════════
  let aliceSession;
  await t.test("L7 login: EOS session -> same Principal, Employee and experience as the Firebase path", async () => {
    const r = await login("  ALICE@taylor.test ", PASSWORDS.alice);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, "AUTHENTICATED");
    aliceSession = r.body.session;
    secretsSeen.push(aliceSession.refreshToken);
    assert.match(aliceSession.refreshToken, /^eosrt_/);
    assert.ok(Date.parse(aliceSession.accessTokenExpiresAt) - Date.now() <= 300_000 + 5_000);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const viaEos = await experience(aliceSession.accessToken);
    const viaFirebase = await post("/operations/experience", { operation: "resolveMyExperienceContext" }, bearer("fb-token.fb-alice"));
    assert.equal(viaEos.status, 200, JSON.stringify(viaEos.body));
    assert.deepEqual(viaEos.body, viaFirebase.body, "EOS login and Firebase resolve identically");
    // The token states no authority.
    const payload = JSON.parse(Buffer.from(aliceSession.accessToken.split(".")[1], "base64url").toString());
    assert.deepEqual(Object.keys(payload).sort(), ["aud", "env", "exp", "iat", "iss", "jti", "sid", "sub"]);
    // CORS for the configured origin only.
    const pre = await fetch(`${base}/auth/login`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
    const evil = await fetch(`${base}/auth/login`, { method: "OPTIONS", headers: { origin: "https://evil.test" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  });

  // ════════════════════ L8: lockout ════════════════════
  await t.test("L8 lockout: 5 failures lock the account; even the right password is refused; Administration unlocks", async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await login("alice@taylor.test", "wrong wrong wrong")).status, 401);
    const acct = await accountOf(alice);
    assert.equal(acct.failed_attempts, 5);
    assert.ok(acct.locked_until > new Date());
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice)).status, 401);
    const ev = await loginEvents(aliceAccount);
    assert.equal(ev.filter((e) => e.reason_code === "BAD_PASSWORD").length, 5);
    assert.equal(ev.at(-1).reason_code, "ACCOUNT_LOCKED");
    assert.equal((await asAdmin("unlockLoginAccount", { principalId: alice, reason: "verified by phone" })).status, 200);
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice)).status, 200);
    assert.equal((await accountOf(alice)).failed_attempts, 0);
  });

  // ════════════════════ L9-L10: refresh rotation, reuse detection, logout ════════════════════
  await t.test("L9 refresh rotates; presenting a spent refresh token revokes the session and its access token IMMEDIATELY", async () => {
    const s0 = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    const r1 = await post("/auth/refresh", { refreshToken: s0.refreshToken });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    const s1 = r1.body.session;
    secretsSeen.push(s0.refreshToken, s1.refreshToken);
    assert.equal(s1.sessionId, s0.sessionId);
    assert.notEqual(s1.refreshToken, s0.refreshToken);
    assert.equal((await experience(s1.accessToken)).status, 200);
    const reuse = await post("/auth/refresh", { refreshToken: s0.refreshToken });
    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.code, "REFRESH_REFUSED");
    assert.equal((await post("/auth/refresh", { refreshToken: s1.refreshToken })).status, 401, "the whole session is gone");
    assert.equal((await experience(s1.accessToken)).status, 401, "the unexpired access token is refused at once");
    const rev = (await q(`SELECT revoke_reason FROM eos_policy.login_sessions WHERE id = $1`, [s0.sessionId])).rows[0];
    assert.equal(rev.revoke_reason, "REFRESH_TOKEN_REUSE");
  });

  await t.test("L10 logout ends the session; idle and absolute expiry are enforced", async () => {
    const s = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    assert.equal((await post("/auth/logout", { refreshToken: s.refreshToken })).status, 200);
    assert.equal((await experience(s.accessToken)).status, 401);
    assert.equal((await post("/auth/refresh", { refreshToken: s.refreshToken })).status, 401);
    assert.equal((await post("/auth/logout", { refreshToken: "garbage" })).status, 200, "logout reveals nothing");
    const idle = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    await q(`UPDATE eos_policy.login_sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1`, [idle.sessionId]);
    assert.equal((await post("/auth/refresh", { refreshToken: idle.refreshToken })).status, 401);
    assert.equal((await experience(idle.accessToken)).status, 401);
    // The absolute lifetime can only shrink.
    await assert.rejects(q(`UPDATE eos_policy.login_sessions SET absolute_expires_at = absolute_expires_at + interval '1 day' WHERE id = $1`, [idle.sessionId]), /LOGIN_SESSION_IMMUTABLE|revoked session is final/);
  });

  // ════════════════════ L11-L14: TOTP ════════════════════
  let totpSecret; let recoveryCodes; let lastStep;
  const base32Decode = (s) => {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0; let value = 0; const out = [];
    for (const ch of s) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
    return Buffer.from(out);
  };
  await t.test("L11 TOTP enrollment: begin -> confirm with a real code -> 10 recovery codes; other sessions end", async () => {
    aliceSession = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    const other = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    const begin = await post("/auth/mfa/totp/begin", {}, bearer(aliceSession.accessToken));
    assert.equal(begin.status, 200, JSON.stringify(begin.body));
    assert.match(begin.body.otpauthUri, /^otpauth:\/\/totp\/Verenward%20EOS%3Aalice%40taylor\.test\?secret=/);
    totpSecret = base32Decode(begin.body.secret);
    secretsSeen.push(begin.body.secret);
    assert.equal((await post("/auth/mfa/totp/confirm", { factorId: begin.body.factorId, code: "000000" }, bearer(aliceSession.accessToken))).status, 401);
    const step = totpStepAt(Math.floor(Date.now() / 1000));
    const confirm = await post("/auth/mfa/totp/confirm", { factorId: begin.body.factorId, code: totpCodeAt(totpSecret, step) }, bearer(aliceSession.accessToken));
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    recoveryCodes = confirm.body.recoveryCodes;
    assert.equal(recoveryCodes.length, 10);
    secretsSeen.push(...recoveryCodes);
    lastStep = step;
    assert.equal((await experience(other.accessToken)).status, 401, "a password-only session ends when a factor is enrolled");
    assert.equal((await experience(aliceSession.accessToken)).status, 200, "the enrolling session continues");
    const acct = await post("/auth/account", {}, bearer(aliceSession.accessToken));
    assert.equal(acct.body.account.factors.length, 1);
    assert.equal(acct.body.account.recoveryCodesRemaining, 10);
  });

  await t.test("L12 MFA login: password -> challenge -> code; a code works ONCE; bad codes are counted", async () => {
    const p1 = await login("alice@taylor.test", PASSWORDS.alice);
    assert.equal(p1.body.status, "MFA_REQUIRED");
    assert.ok(!p1.body.session);
    assert.equal((await post("/auth/login/mfa", { challenge: p1.body.challenge, code: "123456" })).status, 401);
    const next = totpCodeAt(totpSecret, lastStep + 1);
    const ok = await post("/auth/login/mfa", { challenge: p1.body.challenge, code: next });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.session.mfaEnrollmentRequired, false);
    assert.equal((await post("/auth/login/mfa", { challenge: p1.body.challenge, code: next })).status, 401, "a challenge is single-use");
    const p2 = await login("alice@taylor.test", PASSWORDS.alice);
    assert.equal((await post("/auth/login/mfa", { challenge: p2.body.challenge, code: next })).status, 401, "a TOTP code replays never");
    assert.equal((await post("/auth/login/mfa", { challenge: p2.body.challenge, code: totpCodeAt(totpSecret, lastStep) })).status, 401, "an older step never");
    // Recovery code: works once, case and dashes ignored.
    const rc = recoveryCodes[0].toLowerCase().replace(/-/g, " ");
    const viaRc = await post("/auth/login/mfa", { challenge: p2.body.challenge, recoveryCode: rc });
    assert.equal(viaRc.status, 200, JSON.stringify(viaRc.body));
    const p3 = await login("alice@taylor.test", PASSWORDS.alice);
    assert.equal((await post("/auth/login/mfa", { challenge: p3.body.challenge, recoveryCode: recoveryCodes[0] })).status, 401);
    await asAdmin("unlockLoginAccount", { principalId: alice, reason: "test reset of the failure counter" });
    aliceSession = viaRc.body.session;
  });

  await t.test("L13 an MFA-required account without a factor: session reaches /auth/* only, until it enrolls", async () => {
    const prov = await asAdmin("provisionLoginAccount", { principalId: bob, loginIdentifier: "bob@taylor.test", reason: "dispatcher login", mfaRequired: true });
    assert.equal(prov.status, 200);
    secretsSeen.push(prov.body.data.enrollmentTicket);
    assert.equal((await post("/auth/enrollment/complete", { ticket: prov.body.data.enrollmentTicket, password: PASSWORDS.bob })).status, 200);
    const s = (await login("bob@taylor.test", PASSWORDS.bob)).body.session;
    assert.equal(s.mfaEnrollmentRequired, true);
    assert.equal((await experience(s.accessToken)).status, 401, "the API refuses a session that owes a factor");
    assert.equal((await post("/auth/account", {}, bearer(s.accessToken))).status, 200);
    const b = await post("/auth/mfa/totp/begin", {}, bearer(s.accessToken));
    const secret = base32Decode(b.body.secret);
    const c = await post("/auth/mfa/totp/confirm", { factorId: b.body.factorId, code: totpCodeAt(secret, totpStepAt(Math.floor(Date.now() / 1000))) }, bearer(s.accessToken));
    assert.equal(c.status, 200);
    secretsSeen.push(b.body.secret, ...c.body.recoveryCodes);
    assert.equal((await experience(s.accessToken)).status, 200, "enrolling satisfies the policy for this session");
    // A required factor cannot be removed by its holder.
    const rm = await post("/auth/mfa/totp/remove", { password: PASSWORDS.bob, recoveryCode: c.body.recoveryCodes[0] }, bearer(s.accessToken));
    assert.equal(rm.status, 409);
    assert.equal(rm.body.code, "MFA_REQUIRED_BY_POLICY");
  });

  await t.test("L14 Administration resets a lost authenticator: factors and codes removed, sessions end", async () => {
    const r = await asAdmin("resetLoginMfa", { principalId: alice, reason: "lost phone, identity verified in person" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.factorsRemoved, 1);
    assert.equal((await experience(aliceSession.accessToken)).status, 401);
    const l = await login("alice@taylor.test", PASSWORDS.alice);
    assert.equal(l.body.status, "AUTHENTICATED", "no factor -> password login");
    aliceSession = l.body.session;
  });

  // ════════════════════ L15-L16: password change and admin-assisted reset ════════════════════
  await t.test("L15 password change: current password required; every session ends; a fresh one is returned", async () => {
    const other = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    assert.equal((await post("/auth/password/change", { currentPassword: "nope nope nope", newPassword: PASSWORDS.alice2 }, bearer(aliceSession.accessToken))).status, 401);
    assert.equal((await post("/auth/password/change", { currentPassword: PASSWORDS.alice, newPassword: PASSWORDS.alice }, bearer(aliceSession.accessToken))).body.detail, "PASSWORD_UNCHANGED");
    const r = await post("/auth/password/change", { currentPassword: PASSWORDS.alice, newPassword: PASSWORDS.alice2 }, bearer(aliceSession.accessToken));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await experience(other.accessToken)).status, 401);
    assert.equal((await experience(aliceSession.accessToken)).status, 401);
    assert.equal((await experience(r.body.session.accessToken)).status, 200);
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice)).status, 401);
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice2)).status, 200);
    await asAdmin("unlockLoginAccount", { principalId: alice, reason: "test reset of the failure counter" });
  });

  await t.test("L16 admin-assisted reset: one-time ticket, single use, ends every session, audited", async () => {
    const live = (await login("alice@taylor.test", PASSWORDS.alice2)).body.session;
    const r = await asAdmin("issueLoginReset", { principalId: alice, reason: "forgot password, verified by manager" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ticket = r.body.data.resetTicket;
    secretsSeen.push(ticket);
    assert.match(ticket, /^eospr_/);
    // DECISIONS #56 D-ROUTINE-REVOKE: issuing a reset revokes nothing; the live session keeps working.
    assert.equal(r.body.data.sessionsRevoked, undefined);
    assert.equal((await experience(live.accessToken)).status, 200);
    assert.equal((await asAdmin("issueLoginReset", { principalId: alice, reason: "r", revokeSessions: true })).body.data.sessionsRevoked, undefined, "no revocation option exists");
    // Reissuing revokes the first ticket.
    const r2 = await asAdmin("issueLoginReset", { principalId: alice, reason: "reissued" });
    secretsSeen.push(r2.body.data.resetTicket);
    assert.equal((await post("/auth/password/reset/complete", { ticket, password: PASSWORDS.alice })).status, 410);
    assert.equal((await post("/auth/enrollment/complete", { ticket: r2.body.data.resetTicket, password: PASSWORDS.alice })).status, 410, "a reset ticket is not an enrollment ticket");
    const done = await post("/auth/password/reset/complete", { ticket: r2.body.data.resetTicket, password: PASSWORDS.alice });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal((await experience(live.accessToken)).status, 401);
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice)).status, 200);
    const audits = (await q(`SELECT action, actor_uid FROM eos_policy.audit_events WHERE target_id = $1 ORDER BY occurred_at, id`, [aliceAccount])).rows.map((a) => a.action);
    for (const a of ["provisionLoginAccount", "completeLoginEnrollment", "unlockLoginAccount", "enrollLoginMfa", "resetLoginMfa", "changeLoginPassword", "issueLoginReset", "completeLoginReset"]) {
      assert.ok(audits.includes(a), `audited: ${a}`);
    }
  });

  // ════════════════════ L17-L19: disable, the employment gate, retirement ════════════════════
  await t.test("L17 disable stops a live token IMMEDIATELY and refuses login; enable restores", async () => {
    const s = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    assert.equal((await experience(s.accessToken)).status, 200);
    const d = await asAdmin("setLoginAccountStatus", { principalId: alice, status: "disabled", reason: "leave of absence" });
    assert.equal(d.status, 200);
    assert.ok(d.body.data.sessionsRevoked >= 1);
    assert.equal((await experience(s.accessToken)).status, 401);
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice)).status, 401);
    assert.equal((await asAdmin("setLoginAccountStatus", { principalId: alice, status: "active", reason: "returned" })).status, 200);
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice)).status, 200);
  });

  await t.test("L18 the DQ-007 employment gate governs login exactly as it governs requests", async () => {
    const prov = await asAdmin("provisionLoginAccount", { principalId: carol, loginIdentifier: "carol@taylor.test", reason: "login" });
    secretsSeen.push(prov.body.data.enrollmentTicket);
    await post("/auth/enrollment/complete", { ticket: prov.body.data.enrollmentTicket, password: "the gardener sings at dawn" });
    const s = (await login("carol@taylor.test", "the gardener sings at dawn")).body.session;
    assert.equal((await experience(s.accessToken)).status, 200);
    await q(`UPDATE eos_workforce.employees SET employment_status = 'TERMINATED' WHERE id = 'emp-carol'`);
    assert.equal((await experience(s.accessToken)).status, 403, "resolution refuses, as for every transport");
    assert.equal((await login("carol@taylor.test", "the gardener sings at dawn")).status, 401);
    assert.equal((await post("/auth/refresh", { refreshToken: s.refreshToken })).status, 401);
    const ev = await loginEvents((await accountOf(carol)).id);
    assert.ok(ev.some((e) => e.reason_code === "PRINCIPAL_EMPLOYEE_NOT_ACCESS_ELIGIBLE"));
    await q(`UPDATE eos_workforce.employees SET employment_status = 'ACTIVE' WHERE id = 'emp-carol'`);
    assert.equal((await login("carol@taylor.test", "the gardener sings at dawn")).status, 200, "restoring eligibility restores login");
  });

  await t.test("L19 retire: binding revoked, login gone, subject never reused; re-provisioning mints a new subject", async () => {
    const before = (await accountOf(carol));
    const oldSubject = (await q(`SELECT external_subject FROM eos_policy.principal_identities WHERE id = $1`, [before.binding_id])).rows[0].external_subject;
    const s = (await login("carol@taylor.test", "the gardener sings at dawn")).body.session;
    assert.equal((await asAdmin("retireLoginAccount", { principalId: carol, reason: "left the company" })).status, 200);
    assert.equal((await experience(s.accessToken)).status, 401);
    assert.equal((await login("carol@taylor.test", "the gardener sings at dawn")).status, 401);
    const b = (await q(`SELECT status FROM eos_policy.principal_identities WHERE id = $1`, [before.binding_id])).rows[0];
    assert.equal(b.status, "revoked");
    await assert.rejects(q(`UPDATE eos_policy.login_accounts SET status = 'active' WHERE id = $1`, [before.id]), /LOGIN_ACCOUNT_RETIRED/);
    const again = await asAdmin("provisionLoginAccount", { principalId: carol, loginIdentifier: "carol@taylor.test", reason: "rehired" });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    secretsSeen.push(again.body.data.enrollmentTicket);
    assert.notEqual(again.body.data.subject, oldSubject);
  });

  await t.test("L19b the last enabled EOS sign-in held by an Owner or Administrator is not disabled or removed", async () => {
    const p = await asAdmin("provisionLoginAccount", { principalId: adam, loginIdentifier: "adam@taylor.test", reason: "second administrator" });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    secretsSeen.push(p.body.data.enrollmentTicket);
    assert.equal((await post("/auth/enrollment/complete", { ticket: p.body.data.enrollmentTicket, password: "administrators long phrase" })).status, 200);
    const refused = await asAdmin("setLoginAccountStatus", { principalId: adam, status: "disabled", reason: "test" });
    assert.equal(refused.status, 409);
    assert.match(refused.body.message, /LAST_ADMINISTRATOR_LOGIN/);
    assert.equal((await asAdmin("retireLoginAccount", { principalId: adam, reason: "test" })).status, 409);
    // With a second enabled administrating login, the first may be disabled.
    const owner = await accountOf(olivia);
    const ticket = await asFirebase("fb-owner2", "reissueLoginEnrollment", { principalId: olivia, reason: "re-issue for the test" });
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    secretsSeen.push(ticket.body.data.enrollmentTicket);
    assert.equal((await post("/auth/enrollment/complete", { ticket: ticket.body.data.enrollmentTicket, password: PASSWORDS.olivia })).status, 200);
    assert.ok(owner);
    assert.equal((await asAdmin("setLoginAccountStatus", { principalId: adam, status: "disabled", reason: "test" })).status, 200);
    assert.equal((await asAdmin("setLoginAccountStatus", { principalId: adam, status: "active", reason: "test" })).status, 200);
  });

  // ════════════════════ L20-L21: the persona model is untouched; forged tokens refused ════════════════════
  await t.test("L20 the persona Principal still has exactly its persona binding; persona tokens cannot use self-service", async () => {
    const pb = (await q(`SELECT external_subject, status FROM eos_policy.principal_identities WHERE principal_id = $1`, [persona])).rows;
    assert.deepEqual(pb, [{ external_subject: "nonprod-persona.dispatcher", status: "active" }]);
    const now = Math.floor(Date.now() / 1000);
    const signer = eosAuth.humanLogin.signer;
    const personaToken = signEosAccessToken(signer, { iss: ISS, aud: AUD, sub: "nonprod-persona.dispatcher", iat: now, exp: now + 60, jti: newTokenId(), env: "nonprod" });
    assert.equal((await experience(personaToken)).status, 200, "persona tokens resolve as before");
    const self = await post("/auth/account", {}, bearer(personaToken));
    assert.equal(self.status, 403);
    assert.equal(self.body.code, "NOT_A_LOGIN_SESSION");
    // A persona token carrying a sid, and a human token without one, are not tokens any issuer here mints.
    const personaWithSid = signEosAccessToken(signer, { iss: ISS, aud: AUD, sub: "nonprod-persona.dispatcher", iat: now, exp: now + 60, jti: newTokenId(), env: "nonprod", sid: "x".repeat(32) });
    assert.equal((await experience(personaWithSid)).status, 401);
    const aliceSubject = (await q(`SELECT pi.external_subject FROM eos_policy.login_accounts a JOIN eos_policy.principal_identities pi ON pi.id = a.binding_id WHERE a.id = $1`, [aliceAccount])).rows[0].external_subject;
    const humanNoSid = signEosAccessToken(signer, { iss: ISS, aud: AUD, sub: aliceSubject, iat: now, exp: now + 60, jti: newTokenId(), env: "nonprod" });
    assert.equal((await experience(humanNoSid)).status, 401);
    // Another live session's sid does not transfer to another subject.
    const bobSession = (await q(`SELECT s.id FROM eos_policy.login_sessions s JOIN eos_policy.login_accounts a ON a.id = s.account_id WHERE a.principal_id = $1 AND s.revoked_at IS NULL LIMIT 1`, [bob])).rows[0].id;
    const stolenSid = signEosAccessToken(signer, { iss: ISS, aud: AUD, sub: aliceSubject, iat: now, exp: now + 60, jti: newTokenId(), env: "nonprod", sid: bobSession });
    assert.equal((await experience(stolenSid)).status, 401);
  });

  // ════════════════════ L22-L24: nothing secret at rest or in logs; append-only; authority unchanged ════════════════════
  await t.test("L22 no password, ticket, refresh token, recovery code or TOTP secret is stored or logged", async () => {
    const dump = (await q(`SELECT
        (SELECT coalesce(json_agg(a), '[]') FROM eos_policy.login_accounts a)::text ||
        (SELECT coalesce(json_agg(t), '[]') FROM eos_policy.login_tickets t)::text ||
        (SELECT coalesce(json_agg(s), '[]') FROM eos_policy.login_sessions s)::text ||
        (SELECT coalesce(json_agg(r), '[]') FROM eos_policy.login_refresh_tokens r)::text ||
        (SELECT coalesce(json_agg(f), '[]') FROM eos_policy.login_mfa_factors f)::text ||
        (SELECT coalesce(json_agg(c), '[]') FROM eos_policy.login_recovery_codes c)::text ||
        (SELECT coalesce(json_agg(c), '[]') FROM eos_policy.login_mfa_challenges c)::text ||
        (SELECT coalesce(json_agg(e), '[]') FROM eos_policy.authentication_events e)::text ||
        (SELECT coalesce(json_agg(e), '[]') FROM eos_policy.audit_events e)::text AS everything`)).rows[0].everything;
    const values = [...Object.values(PASSWORDS), "the gardener sings at dawn", "administrators long phrase", ...secretsSeen];
    for (const v of values) {
      assert.ok(!dump.includes(v), "a secret value was found at rest");
      assert.ok(!captured.join("\n").includes(v), "a secret value was found in the logs");
    }
    assert.ok(values.length > 30);
  });

  await t.test("L23 the security record is append-only; credential tables refuse deletion", async () => {
    await assert.rejects(q(`DELETE FROM eos_policy.authentication_events`), /append-only/);
    await assert.rejects(q(`UPDATE eos_policy.authentication_events SET outcome = 'success'`), /append-only/);
    await assert.rejects(q(`TRUNCATE eos_policy.authentication_events`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_policy.login_accounts`), /LOGIN_ACCOUNT_APPEND_ONLY/);
    await assert.rejects(q(`DELETE FROM eos_policy.login_sessions`), /LOGIN_SESSION_APPEND_ONLY/);
    await assert.rejects(q(`UPDATE eos_policy.login_accounts SET principal_id = $1 WHERE principal_id = $2`, [bob, alice]), /LOGIN_ACCOUNT_IDENTITY_IMMUTABLE/);
  });

  await t.test("L24 AUTHORITY UNCHANGED: Roles, grants, Principals, Employees and links are exactly as before", async () => {
    // EXACT equality: every Principal, assignment, grant, Employee and link was created before the baseline was taken.
    assert.deepEqual(await authorityDigest(), authorityBefore);
  });
});
