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
const PASSWORDS_MUT = {};
const PASSWORDS = Object.freeze({ alice: "correct horse battery staple", alice2: "a different long passphrase 7", bob: "bob's long enough passphrase", olivia: "owner owns the long phrase" });

test("EOS native login: accounts, sessions, MFA, recovery and administration, in PostgreSQL through the EOS API", { skip: SKIP, concurrency: 1 }, async (t) => {
  delete process.env.SANDBOX_CREDENTIALS_FILE;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  let pool; let service; let inertService;
  const extraServices = [];
  t.after(async () => {
    for (const x of extraServices) await x.close().catch(() => {});
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
  const dana = await makePrincipal("dana", "technician", "fb-dana", "ACTIVE"); // becomes multi-tenant in S5
  const erin = await makePrincipal("erin", "generalEmployee", "fb-erin", "ACTIVE"); // the lockout burst in S9
  const owner2 = await makePrincipal("owner2", "owner", "fb-owner2", null); // a second Owner, administering
  const persona = await makePrincipal("persona-dispatcher", "dispatcher", "fb-persona-dispatcher", "ACTIVE");
  await bindPrincipalEosIdentity(repo, { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] },
    { principalId: persona, externalSubject: "nonprod-persona.dispatcher", reason: "persona fixture" });

  // AUTHORITY BASELINE: every row that says what anybody may do. Must be IDENTICAL at the end.
  // Scoped to THIS tenant: S5 deliberately stands up a second tenant (its own bootstrap grants and administrator), which is
  // a fixture, not an authority change in the tenant under proof.
  const authorityDigest = async () => (await q(`SELECT
      (SELECT md5(string_agg(id || principal_id || role_id || status::text || scope_type, ',' ORDER BY id)) FROM eos_policy.user_role_assignments WHERE tenant_id = $1) ura,
      (SELECT md5(coalesce(string_agg(role_id || capability_id, ',' ORDER BY role_id, capability_id), '')) FROM eos_policy.role_capabilities WHERE tenant_id = $1) rc,
      (SELECT count(*)::int FROM eos_policy.principal_capabilities WHERE tenant_id = $1) pc,
      (SELECT md5(string_agg(principal_id || status::text, ',' ORDER BY principal_id)) FROM eos_policy.tenant_memberships WHERE tenant_id = $1) members,
      (SELECT md5(string_agg(a.id || a.principal_id || a.role_id, ',' ORDER BY a.id)) FROM eos_policy.roles r JOIN eos_policy.user_role_assignments a ON a.role_id = r.id WHERE r.tenant_id = $1) roleheld,
      (SELECT count(*)::int FROM eos_workforce.employees WHERE tenant_id = $1) employees,
      (SELECT md5(string_agg(id || principal_id || employee_id, ',' ORDER BY id)) FROM eos_policy.employee_principal_links WHERE tenant_id = $1) links`, [tenantId])).rows[0];
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
    EOS_AUTH_COOKIE_SAMESITE: "Strict",
    EOS_AUTH_TRUSTED_PROXY_HOPS: "0",
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
  /** A second listener (same pool, same database) under different auth configuration. Closed at the end. */
  const startExtra = async (envOverrides) => {
    const cfg = readEosAuthConfig({ ...authEnv, ...envOverrides }, "nonprod");
    const svc = await startEosApi({ config: { port: 0, environment: "nonprod", allowedOrigins: [ORIGIN], identityProvider: "firebase", eosAuth: cfg },
      firebaseVerifyToken: fakeFirebase, loginServiceOverrides: { passwordHashParameters: { N: 2 ** 14, r: 8, p: 1 } },
      loginRateLimit: { credentialPerMinute: 10_000, routinePerMinute: 10_000 } });
    extraServices.push(svc);
    return `http://127.0.0.1:${svc.port}`;
  };
  // THE BROWSER PROTOCOL: every /auth/* call carries an allowed Origin and X-EOS-CSRF; the refresh token travels ONLY
  // as the __Host-eos_refresh cookie. For readability the proofs below still pass `{ refreshToken }` to /auth/refresh and
  // /auth/logout -- this helper moves it into the Cookie header and OUT of the body, and after every response that
  // carries a session it asserts the body has no refresh token and reads the token back from Set-Cookie.
  const rawPost = async (url, body, headers) => {
    const h = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== null && v !== undefined));
    const res = await fetch(url, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body ?? {}) });
    let json = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json, headers: res.headers, setCookie: res.headers.get("set-cookie") };
  };
  const post = async (path, body, headers = {}, at = base) => {
    const isAuth = path.startsWith("/auth/");
    let sendBody = body ?? {};
    const h = { "content-type": "application/json", ...(isAuth ? { origin: ORIGIN, "x-eos-csrf": "1" } : {}), ...headers };
    if (isAuth && sendBody && typeof sendBody === "object" && "refreshToken" in sendBody) {
      const { refreshToken, ...rest } = sendBody;
      sendBody = rest;
      if (typeof refreshToken === "string") h.cookie = `__Host-eos_refresh=${refreshToken}`;
    }
    const r = await rawPost(`${at}${path}`, sendBody, h);
    if (r.body?.session) {
      assert.equal(r.body.session.refreshToken, undefined, "a refresh token never travels in a response body");
      const m = /(?:^|,\s*)__Host-eos_refresh=([^;]*)/.exec(r.setCookie ?? "");
      assert.ok(m && m[1], "a session response sets the refresh cookie");
      r.body.session.refreshToken = m[1];
    }
    return r;
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
    const { EOS_HUMAN_LOGIN, EOS_AUTH_FACTOR_KEYS, EOS_AUTH_FACTOR_KEY_ID, EOS_AUTH_COOKIE_SAMESITE, EOS_AUTH_TRUSTED_PROXY_HOPS, ...rest } = authEnv;
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
    assert.throws(() => readEosAuthConfig({ ...rest, EOS_HUMAN_LOGIN: "enabled" }, "nonprod"), /EOS_AUTH_COOKIE_SAMESITE/);
    assert.throws(() => readEosAuthConfig({ ...rest, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_COOKIE_SAMESITE: "strict" }, "nonprod"), /EOS_AUTH_COOKIE_SAMESITE/);
    assert.throws(() => readEosAuthConfig({ ...rest, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_COOKIE_SAMESITE: "Strict" }, "nonprod"), /EOS_AUTH_TRUSTED_PROXY_HOPS/);
    assert.throws(() => readEosAuthConfig({ ...rest, EOS_HUMAN_LOGIN: "enabled", EOS_AUTH_COOKIE_SAMESITE: "Strict", EOS_AUTH_TRUSTED_PROXY_HOPS: "9" }, "nonprod"), /EOS_AUTH_TRUSTED_PROXY_HOPS/);
    const r1 = await fetch(`http://127.0.0.1:${inertService.port}/auth/refresh`, { method: "POST", headers: { origin: ORIGIN, "x-eos-csrf": "1", "content-type": "application/json" }, body: "{}" });
    assert.equal(r1.status, 404, "every human route is a 404 when the front door is off");
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
    // Within the grace window a spent token is a SIBLING TAB: refused, nothing revoked, cookie kept.
    const sibling = await post("/auth/refresh", { refreshToken: s0.refreshToken });
    assert.equal(sibling.status, 409);
    assert.equal(sibling.body.code, "REFRESH_SUPERSEDED");
    assert.equal(sibling.setCookie, null, "a superseded refresh does not clear the browser's (newer) cookie");
    assert.equal((await experience(s1.accessToken)).status, 200, "the session survives a sibling race");
    // Outside the window it is THEFT: the whole session is revoked.
    await q(`UPDATE eos_policy.login_refresh_tokens SET consumed_at = now() - interval '1 minute' WHERE consumed_at IS NOT NULL
               AND session_id = $1`, [s0.sessionId]);
    const reuse = await post("/auth/refresh", { refreshToken: s0.refreshToken });
    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.code, "REFRESH_REFUSED");
    assert.match(reuse.setCookie ?? "", /__Host-eos_refresh=; .*Max-Age=0/, "a refused refresh clears the cookie");
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
  let bobTotp; let bobCodes;
  const base32Decode = (s) => {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0; let value = 0; const out = [];
    for (const ch of s) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
    return Buffer.from(out);
  };
  await t.test("L11 TOTP enrollment: begin -> confirm with a real code -> 10 recovery codes; other sessions end", async () => {
    aliceSession = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    const other = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    // A stolen access token alone cannot start enrollment (second review finding 6): the current password is required.
    assert.equal((await post("/auth/mfa/totp/begin", {}, bearer(aliceSession.accessToken))).status, 401);
    const begin = await post("/auth/mfa/totp/begin", { password: PASSWORDS.alice }, bearer(aliceSession.accessToken));
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
    const b = await post("/auth/mfa/totp/begin", { password: PASSWORDS.bob }, bearer(s.accessToken));
    const secret = base32Decode(b.body.secret);
    const c = await post("/auth/mfa/totp/confirm", { factorId: b.body.factorId, code: totpCodeAt(secret, totpStepAt(Math.floor(Date.now() / 1000))) }, bearer(s.accessToken));
    assert.equal(c.status, 200);
    secretsSeen.push(b.body.secret, ...c.body.recoveryCodes);
    bobTotp = secret;
    bobCodes = c.body.recoveryCodes;
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

  await t.test("L19b an Administrator's login is administered only by an Owner; the last enabled administrating login is protected", async () => {
    // The Administrator may not provision (or reset, or disable) another Administrator's login: whoever holds the
    // setup code becomes that Administrator (security review finding 3).
    const byAdmin = await asAdmin("provisionLoginAccount", { principalId: adam, loginIdentifier: "adam@taylor.test", reason: "second administrator" });
    assert.equal(byAdmin.status, 403);
    assert.match(byAdmin.body.message, /PROTECTED_TARGET/);
    const asOwner2 = (operation, input) => asFirebase("fb-owner2", operation, input);
    const p = await asOwner2("provisionLoginAccount", { principalId: adam, loginIdentifier: "adam@taylor.test", reason: "second administrator" });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    secretsSeen.push(p.body.data.enrollmentTicket);
    assert.equal((await post("/auth/enrollment/complete", { ticket: p.body.data.enrollmentTicket, password: "administrators long phrase" })).status, 200);
    const refused = await asOwner2("setLoginAccountStatus", { principalId: adam, status: "disabled", reason: "test" });
    assert.equal(refused.status, 409);
    assert.match(refused.body.message, /LAST_ADMINISTRATOR_LOGIN/);
    assert.equal((await asOwner2("retireLoginAccount", { principalId: adam, reason: "test" })).status, 409);
    // With a second enabled administrating login, the first may be disabled.
    const ticket = await asOwner2("reissueLoginEnrollment", { principalId: olivia, reason: "re-issue for the test" });
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    secretsSeen.push(ticket.body.data.enrollmentTicket);
    assert.equal((await post("/auth/enrollment/complete", { ticket: ticket.body.data.enrollmentTicket, password: PASSWORDS.olivia })).status, 200);
    assert.equal((await asOwner2("setLoginAccountStatus", { principalId: adam, status: "disabled", reason: "test" })).status, 200);
    assert.equal((await asOwner2("setLoginAccountStatus", { principalId: adam, status: "active", reason: "test" })).status, 200);
    // WRITE SKEW (finding 9): two concurrent disables of the last two administrating logins -- exactly one may commit.
    const both = await Promise.all([
      asOwner2("setLoginAccountStatus", { principalId: adam, status: "disabled", reason: "concurrent" }),
      asOwner2("setLoginAccountStatus", { principalId: olivia, status: "disabled", reason: "concurrent" }),
    ]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], JSON.stringify(both.map((r) => r.body)));
    const enabled = (await q(`SELECT count(*)::int n FROM eos_policy.login_accounts WHERE principal_id = ANY($1) AND status = 'active'`, [[adam, olivia]])).rows[0].n;
    assert.equal(enabled, 1, "never zero administrating logins");
    for (const pid of [adam, olivia]) {
      if ((await accountOf(pid)).status === "disabled") assert.equal((await asOwner2("setLoginAccountStatus", { principalId: pid, status: "active", reason: "restore" })).status, 200);
    }
  });

  // ════════════════════ S1-S8: the Owner's security acceptance additions (2026-10-11) ════════════════════

  await t.test("S1 the refresh cookie: __Host-, HttpOnly, Secure, Path=/, SameSite as configured, bounded Max-Age; never in a body", async () => {
    const r = await login("alice@taylor.test", PASSWORDS.alice);
    assert.equal(r.status, 200);
    const c = r.setCookie;
    assert.match(c, /^__Host-eos_refresh=eosrt_[A-Za-z0-9_-]{43}; /);
    for (const attr of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict"]) assert.ok(c.split("; ").includes(attr), attr);
    assert.ok(!/Domain=/i.test(c), "a __Host- cookie has no Domain");
    const maxAge = Number(/Max-Age=(\d+)/.exec(c)[1]);
    assert.ok(maxAge > 12 * 3600 - 60 && maxAge <= 12 * 3600, "Max-Age is the idle window");
    assert.equal(r.headers.get("access-control-allow-credentials"), "true");
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    // A refresh token presented in a BODY (no cookie) is not a credential.
    const bodyOnly = await rawPost(`${base}/auth/refresh`, { refreshToken: r.body.session.refreshToken },
      { "content-type": "application/json", origin: ORIGIN, "x-eos-csrf": "1" });
    assert.equal(bodyOnly.status, 401);
    // Logout: revoked SERVER-SIDE (the token is dead even if a copy survives) and the cookie cleared.
    const out = await post("/auth/logout", { refreshToken: r.body.session.refreshToken });
    assert.match(out.setCookie, /^__Host-eos_refresh=; .*Max-Age=0/);
    const row = (await q(`SELECT revoked_at, revoke_reason FROM eos_policy.login_sessions WHERE id = $1`, [r.body.session.sessionId])).rows[0];
    assert.equal(row.revoke_reason, "LOGOUT");
    assert.equal((await post("/auth/refresh", { refreshToken: r.body.session.refreshToken })).status, 401);
  });

  await t.test("S2 Origin and CSRF: missing/foreign Origin, missing X-EOS-CSRF and non-JSON are refused before any work", async () => {
    const before = (await q(`SELECT count(*)::int n FROM eos_policy.authentication_events`)).rows[0].n;
    const creds = { identifier: "alice@taylor.test", password: PASSWORDS.alice };
    const noOrigin = await post("/auth/login", creds, { origin: null });
    assert.equal(noOrigin.status, 403); assert.equal(noOrigin.body.code, "ORIGIN_REFUSED");
    assert.equal((await post("/auth/login", creds, { origin: "https://evil.test" })).body.code, "ORIGIN_REFUSED");
    assert.equal((await post("/auth/login", creds, { origin: "null" })).body.code, "ORIGIN_REFUSED");
    const noCsrf = await post("/auth/login", creds, { "x-eos-csrf": null });
    assert.equal(noCsrf.status, 403); assert.equal(noCsrf.body.code, "CSRF_REFUSED");
    // The classic form-post CSRF shape: text/plain body, no custom header.
    assert.equal((await rawPost(`${base}/auth/refresh`, "{}", { "content-type": "text/plain", origin: ORIGIN, "x-eos-csrf": "1" })).status, 415);
    assert.equal((await rawPost(`${base}/auth/logout`, "{}", { "content-type": "application/json", origin: "https://evil.test", "x-eos-csrf": "1",
      cookie: "__Host-eos_refresh=eosrt_" + "A".repeat(43) })).status, 403);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.authentication_events`)).rows[0].n, before, "refused before any work was recorded");
    // The preflight grants credentials and the CSRF header to the allowed origin only.
    const ok = await fetch(`${base}/auth/refresh`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
    assert.match(ok.headers.get("access-control-allow-headers"), /x-eos-csrf/);
    const evil = await fetch(`${base}/auth/refresh`, { method: "OPTIONS", headers: { origin: "https://evil.test" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    assert.equal(evil.headers.get("access-control-allow-credentials"), null);
  });

  await t.test("S3 concurrent refresh of one cookie: exactly one rotates, the rest are SUPERSEDED, the session survives", async () => {
    const s0 = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    const results = await Promise.all(Array.from({ length: 5 }, () => post("/auth/refresh", { refreshToken: s0.refreshToken })));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409, 409, 409, 409], JSON.stringify(results.map((r) => r.body?.code)));
    const winner = results.find((r) => r.status === 200).body.session;
    assert.equal((await experience(winner.accessToken)).status, 200);
    assert.equal((await post("/auth/refresh", { refreshToken: winner.refreshToken })).status, 200, "the chain continues");
    const live = (await q(`SELECT count(*)::int n FROM eos_policy.login_refresh_tokens WHERE session_id = $1 AND consumed_at IS NULL`, [s0.sessionId])).rows[0].n;
    assert.equal(live, 1, "one current refresh token per session, always");
  });

  await t.test("S4 key rotation and missing-key refusal: fail closed, lazy re-seal, kid-bound recovery codes, census", async () => {
    // bob's factor was sealed and his recovery codes peppered under f1.
    const f2 = randomBytes(32).toString("base64url");
    const startWith = (keys, current) => startExtra({ EOS_AUTH_FACTOR_KEYS: JSON.stringify(keys), EOS_AUTH_FACTOR_KEY_ID: current });
    const f1 = JSON.parse(authEnv.EOS_AUTH_FACTOR_KEYS).f1;
    // (a) f1 GONE: bob's second factor cannot be checked -> 503, recorded, no session -- never a bypass.
    const lost = await startWith({ f2 }, "f2");
    const p = await post("/auth/login", { identifier: "bob@taylor.test", password: PASSWORDS.bob }, {}, lost);
    assert.equal(p.body.status, "MFA_REQUIRED");
    const step = totpStepAt(Math.floor(Date.now() / 1000));
    const refused = await post("/auth/login/mfa", { challenge: p.body.challenge, code: totpCodeAt(bobTotp, step + 1) }, {}, lost);
    assert.equal(refused.status, 503); assert.equal(refused.body.code, "MFA_KEY_UNAVAILABLE");
    assert.equal(refused.setCookie, null);
    const viaCode = await post("/auth/login/mfa", { challenge: p.body.challenge, recoveryCode: bobCodes[1] }, {}, lost);
    assert.equal(viaCode.status, 503, "a recovery code under an unheld key cannot verify -- refused as unavailable, not as wrong");
    const bobAcct = (await accountOf(bob)).id;
    assert.ok((await loginEvents(bobAcct)).some((e) => e.reason_code === "MFA_KEY_UNAVAILABLE"));
    // (b) ROTATE: {f1, f2}, current f2 -> the old factor verifies and is RE-SEALED under f2; f1 recovery codes still work.
    const rotated = await startWith({ f1, f2 }, "f2");
    const p2 = await post("/auth/login", { identifier: "bob@taylor.test", password: PASSWORDS.bob }, {}, rotated);
    const ok = await post("/auth/login/mfa", { challenge: p2.body.challenge, code: totpCodeAt(bobTotp, step + 1) }, {}, rotated);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const sealed = (await q(`SELECT secret_sealed FROM eos_policy.login_mfa_factors WHERE account_id = $1 AND status = 'active'`, [bobAcct])).rows[0].secret_sealed;
    assert.match(sealed, /^v1\.f2\./, "lazily re-sealed under the current key");
    const p3 = await post("/auth/login", { identifier: "bob@taylor.test", password: PASSWORDS.bob }, {}, rotated);
    assert.equal((await post("/auth/login/mfa", { challenge: p3.body.challenge, recoveryCode: bobCodes[2] }, {}, rotated)).status, 200);
    // (c) the census says which kids still guard live material: f1 may not be dropped while it counts.
    const { EosLoginService } = require("../lib/eosAuth/eosLoginService.js");
    const ring = readEosAuthConfig({ ...authEnv, EOS_AUTH_FACTOR_KEYS: JSON.stringify({ f2 }), EOS_AUTH_FACTOR_KEY_ID: "f2" }, "nonprod").humanLogin;
    const census = await new EosLoginService({ pool, repo, signer: ring.signer, issuer: ISS, audience: AUD, environment: "nonprod", factorKeyring: ring.factorKeyring }).factorKeyCensus();
    assert.equal(census.currentKid, "f2");
    assert.ok(census.recoveryCodes.f1 >= 1, "bob's remaining codes are still under f1");
    assert.deepEqual(census.unheld, ["f1"], "a service holding only f2 reports f1 as unheld -- dropping it would strand them");
    await asAdmin("unlockLoginAccount", { principalId: bob, reason: "test reset of the failure counter" });
  });

  await t.test("S5 tenant resolution and isolation: an EOS login is single-tenant; another tenant's administrator cannot touch it", async () => {
    const { tenant: t2 } = await bootstrapTenant(repo, { key: "login-proof-2", name: "second tenant", actorUid: "login-proof" });
    await bootstrapAdministrator(repo, { tenantId: t2.id, externalSubject: "fb-admin2-uid", performedBy: "login-proof" });
    const live = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    assert.equal((await experience(live.accessToken)).status, 200);
    // alice becomes ALSO a member of tenant 2 (finding 1: otherwise tenant 1's login would act in tenant 2).
    await repo.transact({ tenantId: t2.id, uid: "login-fixture" }, (tx) => tx.createTenantMembership(alice));
    assert.equal((await experience(live.accessToken)).status, 401, "the live session stops at once");
    assert.equal((await post("/admin/policy", { operation: "listRoles", input: {} }, { authorization: `Bearer ${live.accessToken}`, "x-eos-tenant": t2.id })).status, 401,
      "and can never be pointed at the second tenant");
    assert.equal((await login("alice@taylor.test", PASSWORDS.alice)).status, 401);
    assert.equal((await post("/auth/refresh", { refreshToken: live.refreshToken })).status, 401);
    assert.ok((await loginEvents(aliceAccount)).some((e) => e.reason_code === "PRINCIPAL_TENANT_NOT_A_MEMBERSHIP"));
    // Tenant 2's administrator cannot see or touch tenant 1's login, though alice is now its member.
    const asAdmin2 = (operation, input) => post("/admin/policy", { operation, input }, { authorization: "Bearer fb-token.fb-admin2-uid" });
    const read = await asAdmin2("readLoginAccount", { principalId: alice });
    assert.equal(read.status, 200);
    assert.equal(read.body.data.account, null);
    assert.deepEqual(read.body.data.eosIdentity, { kind: "other" }, "no foreign subject is disclosed");
    for (const op of ["issueLoginReset", "setLoginAccountStatus", "revokeLoginSessions", "resetLoginMfa", "retireLoginAccount", "unlockLoginAccount"]) {
      const r = await asAdmin2(op, { principalId: alice, reason: "cross-tenant attempt", status: "disabled" });
      // Refused either as TARGET_NOT_ADMINISTRABLE (alice can enter tenant 1, where admin2 holds nothing) or as NOT_FOUND
      // (the login is tenant 1's) -- never performed.
      assert.ok(r.status === 403 || r.status === 404, `${op}: ${r.status}`);
    }
    const p2 = await asAdmin2("provisionLoginAccount", { principalId: alice, loginIdentifier: "alice2@x.test", reason: "r" });
    assert.ok(p2.status === 403 || p2.status === 409, `${p2.status}`);
    assert.equal((await accountOf(alice)).status, "active");
    // Provisioning a Principal that already belongs to two tenants is refused outright.
    await repo.transact({ tenantId: t2.id, uid: "login-fixture" }, (tx) => tx.createTenantMembership(dana));
    const multi = await asAdmin("provisionLoginAccount", { principalId: dana, loginIdentifier: "dana@taylor.test", reason: "r" });
    // Refused: single-tenant mode (MULTI_TENANT_PRINCIPAL), and in any mode tenant 1's administrator holds nothing in
    // tenant 2 (TARGET_NOT_ADMINISTRABLE).
    assert.ok(multi.status === 403 || multi.status === 409, `${multi.status}`);
    assert.match(multi.body.message, /MULTI_TENANT_PRINCIPAL|TARGET_NOT_ADMINISTRABLE/);
    // Ending the second membership restores the login; resolution is then IDENTICAL to Firebase's across tenant statements.
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1 AND tenant_id = $2`, [alice, t2.id]);
    const s2 = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    assert.ok(s2?.accessToken);
    for (const headers of [{}, { "x-eos-tenant": tenantId }, { "x-eos-tenant": t2.id }, { "x-eos-tenant": "tenant-nope" }]) {
      const eos = await post("/admin/policy", { operation: "listRoles", input: {} }, { authorization: `Bearer ${s2.accessToken}`, ...headers });
      const fb = await post("/admin/policy", { operation: "listRoles", input: {} }, { authorization: "Bearer fb-token.fb-alice", ...headers });
      assert.equal(eos.status, fb.status, JSON.stringify(headers));
      assert.deepEqual(eos.body, fb.body, JSON.stringify(headers));
    }
    // Fixture cleanup: a SUSPENDED membership elsewhere still counts against administering this login (second review
    // finding 3), so the proof's second-tenant membership is removed rather than left suspended.
    await q(`DELETE FROM eos_policy.tenant_memberships WHERE principal_id = $1 AND tenant_id = $2`, [alice, t2.id]);
  });

  await t.test("S6 Owner protection on EVERY credential mutation; the Administrator is refused on the Owner's login", async () => {
    for (const op of ["reissueLoginEnrollment", "issueLoginReset", "setLoginAccountStatus", "unlockLoginAccount", "revokeLoginSessions",
      "resetLoginMfa", "setLoginMfaRequirement", "retireLoginAccount"]) {
      for (const target of [olivia, adam]) {
        const r = await asAdmin(op, { principalId: target, reason: "admin acting on a protected login", status: "disabled", required: true });
        assert.equal(r.status, 403, op);
        assert.match(r.body.message, /PROTECTED_TARGET/, op);
      }
    }
    assert.equal((await accountOf(olivia)).status, "active");
  });

  await t.test("S7 existing business authorization unchanged: EOS and Firebase answer identically across operations", async () => {
    const calls = [
      ["/operations/experience", { operation: "resolveMyExperienceContext" }],
      ["/admin/policy", { operation: "listRoles", input: {} }],
      ["/admin/policy", { operation: "listTenantPrincipals", input: {} }],
      ["/admin/policy", { operation: "readLoginAccount", input: { principalId: alice } }],
    ];
    let compared = 0;
    for (const [who, uid, ident, pw] of [["olivia", "fb-olivia", "olivia@taylor.test", PASSWORDS.olivia], ["carol", "fb-carol", "carol@taylor.test", null]]) {
      if (!pw) continue;
      const sess = (await login(ident, pw)).body.session;
      for (const [path, body] of calls) {
        const eos = await post(path, body, { authorization: `Bearer ${sess.accessToken}`, "x-eos-tenant": tenantId });
        const fb = await post(path, body, { authorization: `Bearer fb-token.${uid}`, "x-eos-tenant": tenantId });
        assert.equal(eos.status, fb.status, `${who} ${body.operation}`);
        assert.deepEqual(eos.body, fb.body, `${who} ${body.operation}`);
        compared += 1;
      }
    }
    // the technician (alice): a refused administration read is refused identically
    const aliceSess = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    for (const [path, body] of calls) {
      const eos = await post(path, body, { authorization: `Bearer ${aliceSess.accessToken}`, "x-eos-tenant": tenantId });
      const fb = await post(path, body, { authorization: "Bearer fb-token.fb-alice", "x-eos-tenant": tenantId });
      assert.equal(eos.status, fb.status, `alice ${body.operation}`);
      assert.deepEqual(eos.body, fb.body, `alice ${body.operation}`);
      compared += 1;
    }
    assert.equal(compared, 8);
  });

  await t.test("S8 audit persistence: every administrative act is one audit_events row naming the actor, the account and the reason", async () => {
    const rows = (await q(`SELECT action, actor_uid, reason, after FROM eos_policy.audit_events WHERE target_kind = 'loginAccount' ORDER BY occurred_at, id`)).rows;
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["provisionLoginAccount", "reissueLoginEnrollment", "issueLoginReset", "setLoginAccountStatus", "unlockLoginAccount",
      "revokeLoginSessions", "resetLoginMfa", "retireLoginAccount", "completeLoginEnrollment", "completeLoginReset", "changeLoginPassword", "enrollLoginMfa"]) {
      if (a === "revokeLoginSessions" && !actions.has(a)) {
        assert.equal((await asAdmin("revokeLoginSessions", { principalId: carol, reason: "suspected compromise drill" })).status, 200);
        continue;
      }
      assert.ok(actions.has(a), `audited: ${a}`);
    }
    assert.ok(rows.every((r) => r.actor_uid && r.reason), "every row names an actor and a reason");
    const fresh = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'revokeLoginSessions'`)).rows[0].n;
    assert.ok(fresh >= 1);
    await assert.rejects(q(`DELETE FROM eos_policy.audit_events WHERE target_kind = 'loginAccount'`), /append-only/);
  });

  // ════════════════════ S9-S12: the independent security review's findings, each proven closed ════════════════════

  await t.test("S9 lockout is ATOMIC (finding 2) and does not escalate (finding 4)", async () => {
    const prov = await asAdmin("provisionLoginAccount", { principalId: erin, loginIdentifier: "erin@taylor.test", reason: "lockout proof" });
    secretsSeen.push(prov.body.data.enrollmentTicket);
    assert.equal((await post("/auth/enrollment/complete", { ticket: prov.body.data.enrollmentTicket, password: "a quiet morning walk by the lake" })).status, 200);
    const acct = (await accountOf(erin)).id;
    // A burst of 20 concurrent wrong guesses and, in the middle, the RIGHT one.
    const attempts = Array.from({ length: 21 }, (_, i) => login("erin@taylor.test", i === 15 ? "a quiet morning walk by the lake" : `wrong guess number ${i}`));
    const results = await Promise.all(attempts);
    assert.ok(results.every((r) => r.status === 401 || r.status === 503 || r.status === 200), JSON.stringify(results.map((r) => r.status)));
    const ev = await loginEvents(acct);
    const evaluated = ev.filter((e) => e.reason_code === "BAD_PASSWORD").length + results.filter((r) => r.status === 200).length;
    assert.ok(evaluated <= 5, `at most lockThreshold attempts are ever evaluated (saw ${evaluated})`);
    const after = await accountOf(erin);
    if (results[15].status !== 200) {
      assert.ok(after.locked_until > new Date(), "the burst locked the account");
      assert.equal((await login("erin@taylor.test", "a quiet morning walk by the lake")).status, 401, "the right password is refused while locked");
      // No escalation: when the lock expires the count restarts, and one more failure does NOT re-lock.
      await q(`UPDATE eos_policy.login_accounts SET locked_until = now() - interval '1 second' WHERE id = $1`, [acct]);
      assert.equal((await login("erin@taylor.test", "one more wrong guess")).status, 401);
      const reopened = await accountOf(erin);
      assert.equal(reopened.failed_attempts, 1);
      assert.equal(reopened.locked_until, null);
    }
    assert.equal((await login("erin@taylor.test", "a quiet morning walk by the lake")).status, 200);
    assert.equal((await accountOf(erin)).failed_attempts, 0);
  });

  await t.test("S10 an MFA challenge does not survive a password reset (finding 8); a session cannot out-guess the lockout (finding 7)", async () => {
    const p = await login("bob@taylor.test", PASSWORDS.bob);
    assert.equal(p.body.status, "MFA_REQUIRED");
    const r = await asAdmin("issueLoginReset", { principalId: bob, reason: "challenge voiding proof" });
    secretsSeen.push(r.body.data.resetTicket);
    assert.equal((await post("/auth/password/reset/complete", { ticket: r.body.data.resetTicket, password: "bobs brand new passphrase" })).status, 200);
    PASSWORDS_MUT.bob = "bobs brand new passphrase";
    const step = totpStepAt(Math.floor(Date.now() / 1000));
    const late = await post("/auth/login/mfa", { challenge: p.body.challenge, code: totpCodeAt(bobTotp, step + 1) });
    assert.equal(late.status, 401);
    assert.equal(late.body.code, "MFA_CHALLENGE_INVALID");
    // A live session guessing the current password hits the SAME lockout as the login door.
    const s = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await post("/auth/password/change", { currentPassword: `nope nope ${i}`, newPassword: PASSWORDS.alice2 }, bearer(s.accessToken))).status, 401);
    }
    assert.equal((await post("/auth/password/change", { currentPassword: PASSWORDS.alice, newPassword: PASSWORDS.alice2 }, bearer(s.accessToken))).status, 401,
      "the right current password is refused once locked");
    assert.ok((await loginEvents(aliceAccount)).some((e) => e.event === "passwordChange" && e.reason_code === "ACCOUNT_LOCKED"));
    assert.equal((await asAdmin("unlockLoginAccount", { principalId: alice, reason: "after the lockout proof" })).status, 200);
  });

  await t.test("S11 logout by the access token alone (no cookie) revokes the session server-side (finding 11)", async () => {
    const s = (await login("alice@taylor.test", PASSWORDS.alice)).body.session;
    const out = await rawPost(`${base}/auth/logout`, {}, { "content-type": "application/json", origin: ORIGIN, "x-eos-csrf": "1", authorization: `Bearer ${s.accessToken}` });
    assert.equal(out.status, 200);
    assert.equal((await experience(s.accessToken)).status, 401);
    assert.equal((await q(`SELECT revoke_reason FROM eos_policy.login_sessions WHERE id = $1`, [s.sessionId])).rows[0].revoke_reason, "LOGOUT");
  });

  await t.test("S12 a spent refresh token from a DIFFERENT client inside the grace window is theft, not a sibling (finding 12)", async () => {
    const proxied = await startExtra({ EOS_AUTH_TRUSTED_PROXY_HOPS: "1" });
    const from = (ip) => ({ "x-forwarded-for": `198.51.100.250, ${ip}` });
    const s0 = (await post("/auth/login", { identifier: "alice@taylor.test", password: PASSWORDS.alice }, from("203.0.113.10"), proxied)).body.session;
    const s1 = await post("/auth/refresh", { refreshToken: s0.refreshToken }, from("203.0.113.10"), proxied);
    assert.equal(s1.status, 200);
    // Same client, inside the window: a sibling tab.
    assert.equal((await post("/auth/refresh", { refreshToken: s0.refreshToken }, from("203.0.113.10"), proxied)).body.code, "REFRESH_SUPERSEDED");
    // Another client, inside the window: theft -> the session is revoked.
    const thief = await post("/auth/refresh", { refreshToken: s0.refreshToken }, from("192.0.2.66"), proxied);
    assert.equal(thief.status, 401);
    assert.equal((await q(`SELECT revoke_reason FROM eos_policy.login_sessions WHERE id = $1`, [s0.sessionId])).rows[0].revoke_reason, "REFRESH_TOKEN_REUSE");
    assert.equal((await experience(s1.body.session.accessToken)).status, 401);
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
    const otherSession = (await q(`SELECT s.id FROM eos_policy.login_sessions s JOIN eos_policy.login_accounts a ON a.id = s.account_id WHERE a.principal_id = $1 AND s.revoked_at IS NULL LIMIT 1`, [erin])).rows[0].id;
    const stolenSid = signEosAccessToken(signer, { iss: ISS, aud: AUD, sub: aliceSubject, iat: now, exp: now + 60, jti: newTokenId(), env: "nonprod", sid: otherSession });
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
    const values = [...Object.values(PASSWORDS), ...Object.values(PASSWORDS_MUT), "the gardener sings at dawn", "administrators long phrase",
      "a quiet morning walk by the lake", ...secretsSeen];
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
