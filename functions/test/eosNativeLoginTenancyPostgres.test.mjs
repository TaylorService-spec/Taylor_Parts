// EOS NATIVE LOGIN -- MULTI-TENANT SESSIONS (Owner ruling D-12) and SECURITY-EVENT GOVERNANCE (D-13), end to end against
// a real postgres:16 and the REAL in-process EOS API, with EOS_AUTH_MULTI_TENANT_SESSIONS=enabled.
// docs/architecture/eos-native-identity.md §3(f), §8, proofs M1-M16.
//
//   "One Principal may belong to multiple tenants, but each authenticated session belongs to exactly one tenant."
//
// Its OWN disposable database. Keys generated in memory. Fake Firebase verifier. No network beyond loopback.
import "./support/firebaseOfflineGuard.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const DB_NAME = `eos_tenancy_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const ISS = "https://eos-api-nonprod.test/auth";
const AUD = "https://eos-api-nonprod.test";
const ORIGIN = "https://verenwardeos.test";
const PAT_PW = "pat walks the long road home";

test("EOS native login: one Principal, many tenants, one tenant per session; security-event governance", { skip: SKIP, concurrency: 1 }, async (t) => {
  delete process.env.SANDBOX_CREDENTIALS_FILE;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  let pool; let service;
  const extra = [];
  t.after(async () => {
    for (const x of extra) await x.close().catch(() => {});
    if (service) await service.close().catch(() => {});
    if (pool) await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const up = spawnSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(up.error, undefined, String(up.error));
  assert.equal(up.status, 0, up.stderr);

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");
  const { totpCodeAt, totpStepAt } = require("../lib/eosAuth/credentialCrypto.js");
  const { canonicalEventLine } = require("../lib/eosAuth/eosLoginService.js");
  const { startEosApi } = require("../lib/eosApi/server.js");

  pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // ════════════════════ fixture: tenants A and B (and C), administrators, people ════════════════════
  const tenantOf = async (key) => (await bootstrapTenant(repo, { key, name: `tenant ${key}`, actorUid: "tenancy-proof" })).tenant.id;
  const A = await tenantOf("tenancy-a");
  const B = await tenantOf("tenancy-b");
  const C = await tenantOf("tenancy-c");
  await bootstrapAdministrator(repo, { tenantId: A, externalSubject: "fb-admin-a", performedBy: "tenancy-proof" });
  await bootstrapAdministrator(repo, { tenantId: B, externalSubject: "fb-admin-b", performedBy: "tenancy-proof" });
  {
    const baseline = require("../lib/adminPolicy/seed/roleCapabilityAuthorityBaseline.json");
    for (const tenantId of [A, B]) {
      const [caps, roles, existing] = await Promise.all([repo.listCapabilities(), repo.listRoles(tenantId), repo.listRoleCapabilities(tenantId)]);
      const capId = new Map(caps.map((c) => [c.key, c.id]));
      const roleId = new Map(roles.map((r) => [r.key, r.id]));
      const have = new Set(existing.map((e) => `${e.roleId}|${e.capabilityId}`));
      await repo.transact({ tenantId, uid: "tenancy-fixture" }, async (tx) => {
        for (const g of baseline.grants) {
          const r = roleId.get(g.roleKey); const c = capId.get(g.capabilityKey);
          if (!r || !c || have.has(`${r}|${c}`)) continue;
          have.add(`${r}|${c}`);
          await tx.grantRoleCapability({ roleId: r, capabilityId: c, grantedBy: "tenancy-fixture", grantedAt: new Date(Date.now() - 120_000).toISOString() });
        }
      });
    }
  }
  const principal = async (firebaseUid, name) => {
    const p = await repo.transact({ tenantId: A, uid: "tenancy-fixture" }, (tx) => tx.createPrincipal({ externalSubject: firebaseUid, identityProvider: "firebase", displayName: name }));
    return p.id;
  };
  /** Membership + one global Role + (optionally) an Employee link in `tenantId`. */
  const enrol = async (principalId, tenantId, roleKey, employment) => {
    const role = await repo.getRoleByKey(tenantId, roleKey);
    assert.ok(role, roleKey);
    await repo.transact({ tenantId, uid: "tenancy-fixture" }, async (tx) => {
      await tx.createTenantMembership(principalId);
      const v = await tx.bumpAccessVersion(principalId);
      await tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "tenancy-fixture", grantedAt: new Date(Date.now() - 60_000).toISOString(), accessVersionAtGrant: v });
    });
    if (employment) {
      const emp = `emp-${randomUUID()}`;
      await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,$2,$3,'taylor','2020-01-01T00:00:00Z')`, [emp, tenantId, employment]);
      await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
               VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','tenancy-fixture','tenancy proof fixture')`, [`epl-${emp}`, tenantId, principalId, emp]);
      return emp;
    }
    return null;
  };
  // pat: a technician in A and a dispatcher in B -- an Employee in BOTH, TERMINATED in B to begin with.
  const pat = await principal("fb-pat", "pat");
  await enrol(pat, A, "technician", "ACTIVE");
  const patEmpB = await enrol(pat, B, "dispatcher", "TERMINATED");
  // quinn: an Employee in A only, MFA-required later.
  const quinn = await principal("fb-quinn", "quinn");
  await enrol(quinn, A, "generalEmployee", "ACTIVE");
  await enrol(quinn, B, "generalEmployee", "ACTIVE");
  // ownerAB: Owner in BOTH tenants -- the only actor with authority over a two-tenant person's credential.
  const ownerAB = await principal("fb-owner-ab", "owner of both");
  await enrol(ownerAB, A, "owner", null);
  await enrol(ownerAB, B, "owner", null);

  const authorityDigest = async (tenantId) => (await q(`SELECT
      (SELECT md5(string_agg(id || principal_id || role_id || status::text, ',' ORDER BY id)) FROM eos_policy.user_role_assignments WHERE tenant_id = $1) ura,
      (SELECT md5(coalesce(string_agg(role_id || capability_id, ',' ORDER BY role_id, capability_id), '')) FROM eos_policy.role_capabilities WHERE tenant_id = $1) rc,
      (SELECT count(*)::int FROM eos_policy.principal_capabilities WHERE tenant_id = $1) pc`, [tenantId])).rows[0];
  const authorityBefore = { A: await authorityDigest(A), B: await authorityDigest(B) };

  // ════════════════════ the service: multi-tenant sessions ENABLED ════════════════════
  const signing = generateKeyPairSync("ed25519");
  const authEnv = {
    EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-tenancy": signing.publicKey.export({ format: "jwk" }) }),
    EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD,
    EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(signing.privateKey.export({ format: "jwk" })),
    EOS_AUTH_SIGNING_KID: "nonprod-tenancy",
    EOS_HUMAN_LOGIN: "enabled",
    EOS_AUTH_FACTOR_KEYS: JSON.stringify({ f1: randomBytes(32).toString("base64url") }),
    EOS_AUTH_FACTOR_KEY_ID: "f1",
    EOS_AUTH_COOKIE_SAMESITE: "Strict",
    EOS_AUTH_TRUSTED_PROXY_HOPS: "0",
    EOS_AUTH_MULTI_TENANT_SESSIONS: "enabled",
  };
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
  const start = async (env) => {
    const svc = await startEosApi({
      config: { port: 0, environment: "nonprod", allowedOrigins: [ORIGIN], identityProvider: "firebase", eosAuth: readEosAuthConfig(env, "nonprod") },
      firebaseVerifyToken: fakeFirebase,
      loginServiceOverrides: { passwordHashParameters: { N: 2 ** 14, r: 8, p: 1 } },
      loginRateLimit: { credentialPerMinute: 10_000, routinePerMinute: 10_000 },
    });
    return svc;
  };
  service = await start(authEnv);
  const base = `http://127.0.0.1:${service.port}`;
  const rawPost = async (url, body, headers) => {
    const h = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== null && v !== undefined));
    const res = await fetch(url, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body ?? {}) });
    let json = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json, setCookie: res.headers.get("set-cookie") };
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
      assert.equal(r.body.session.refreshToken, undefined);
      const m = /__Host-eos_refresh=([^;]*)/.exec(r.setCookie ?? "");
      if (m && m[1]) r.body.session.refreshToken = m[1];
    }
    return r;
  };
  const asFb = (uid, operation, input, headers = {}) => post("/admin/policy", { operation, input }, { authorization: `Bearer fb-token.${uid}`, ...headers });
  const bearer = (token, extraHeaders = {}) => ({ authorization: `Bearer ${token}`, ...extraHeaders });
  const experience = (token, extraHeaders = {}) => post("/operations/experience", { operation: "resolveMyExperienceContext" }, bearer(token, extraHeaders));
  const login = (identifier, password, tenantId) => post("/auth/login", { identifier, password, ...(tenantId ? { tenantId } : {}) });
  const events = async (where, values) => (await q(`SELECT * FROM eos_policy.authentication_events WHERE ${where} ORDER BY occurred_at, id`, values)).rows;
  const secrets = [PAT_PW];

  // ════════════════════ M1: who may create a two-tenant person's login ════════════════════
  let patAccount;
  await t.test("M1 a login for a person who can enter two tenants needs authority in BOTH (CROSS_TENANT_AUTHORITY)", async () => {
    const byAdminA = await asFb("fb-admin-a", "provisionLoginAccount", { principalId: pat, loginIdentifier: "pat@tenancy.test", reason: "pat login" });
    assert.equal(byAdminA.status, 403);
    assert.match(byAdminA.body.message, /CROSS_TENANT_AUTHORITY/);
    const r = await asFb("fb-owner-ab", "provisionLoginAccount", { principalId: pat, loginIdentifier: "pat@tenancy.test", reason: "pat login" }, { "x-eos-tenant": A });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    secrets.push(r.body.data.enrollmentTicket);
    patAccount = r.body.data.accountId;
    assert.equal((await post("/auth/enrollment/complete", { ticket: r.body.data.enrollmentTicket, password: PAT_PW })).status, 200);
    // Tenant B's administrator cannot administer it either (the login is tenant A's, and pat is in A).
    const byAdminB = await asFb("fb-admin-b", "issueLoginReset", { principalId: pat, reason: "cross-tenant attempt" });
    assert.ok(byAdminB.status === 403 || byAdminB.status === 404, `${byAdminB.status}`);
  });

  // ════════════════════ M2-M3: selection and binding ════════════════════
  let sessA;
  await t.test("M2 login without a stated tenant -> the HOME tenant; the session is bound to it; another tenant's header is refused and recorded", async () => {
    const r = await login("pat@tenancy.test", PAT_PW);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    sessA = r.body.session;
    secrets.push(sessA.refreshToken);
    assert.equal(sessA.tenantId, A);
    const exp = await experience(sessA.accessToken);
    assert.equal(exp.status, 200);
    assert.equal(exp.body.result.tenantId ?? A, A);
    // Stating its own tenant is fine; stating B (a REAL membership) is refused -- the session belongs to A.
    assert.equal((await experience(sessA.accessToken, { "x-eos-tenant": A })).status, 200);
    const forged = await experience(sessA.accessToken, { "x-eos-tenant": B });
    assert.equal(forged.status, 403);
    assert.equal(forged.body.code, "FORBIDDEN");
    for (const other of [C, "tenant-that-does-not-exist"]) {
      assert.equal((await experience(sessA.accessToken, { "x-eos-tenant": other })).status, 403, other);
    }
    // Every transport resolves through the same binding: Administration too.
    assert.equal((await post("/admin/policy", { operation: "listRoles", input: {} }, bearer(sessA.accessToken, { "x-eos-tenant": B }))).status, 403);
    const refused = await events("event = 'tenantRefused' AND session_id = $1", [sessA.sessionId]);
    assert.ok(refused.length >= 4, `recorded ${refused.length}`);
    assert.ok(refused.every((e) => e.tenant_id === A && e.outcome === "refused" && e.reason_code === "TENANT_NOT_SESSION_TENANT"));
    // Authorization in A is EXACTLY Firebase's in A.
    const fb = await post("/operations/experience", { operation: "resolveMyExperienceContext" }, { authorization: "Bearer fb-token.fb-pat", "x-eos-tenant": A });
    assert.deepEqual(exp.body, fb.body);
  });

  await t.test("M3 tenant selection never overrides Employee eligibility: B is refused while pat's B Employee is TERMINATED", async () => {
    const r = await login("pat@tenancy.test", PAT_PW, B);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "LOGIN_REFUSED");
    assert.ok((await events("account_id = $1 AND reason_code = 'PRINCIPAL_EMPLOYEE_NOT_ACCESS_ELIGIBLE'", [patAccount])).length >= 1);
    // A tenant pat is not a member of is refused the same way.
    assert.equal((await login("pat@tenancy.test", PAT_PW, C)).status, 401);
    assert.equal((await login("pat@tenancy.test", PAT_PW, "not a tenant!")).status, 401);
    // The switch is refused for the same reason.
    const sw = await post("/auth/session/switch-tenant", { tenantId: B }, bearer(sessA.accessToken));
    assert.equal(sw.status, 403);
    assert.equal((await experience(sessA.accessToken)).status, 200, "a refused switch leaves the current session intact");
    await q(`UPDATE eos_workforce.employees SET employment_status = 'ACTIVE' WHERE id = $1`, [patEmpB]);
  });

  // ════════════════════ M4-M5: switching ════════════════════
  await t.test("M4 explicit switch: a NEW session bound to B; the A session ends at once; audited in BOTH tenants", async () => {
    const before = sessA;
    const sw = await post("/auth/session/switch-tenant", { tenantId: B }, bearer(before.accessToken));
    assert.equal(sw.status, 200, JSON.stringify(sw.body));
    const sessB = sw.body.session;
    secrets.push(sessB.refreshToken);
    assert.equal(sessB.tenantId, B);
    assert.notEqual(sessB.sessionId, before.sessionId);
    assert.match(sw.setCookie, /^__Host-eos_refresh=eosrt_/);
    assert.equal((await experience(before.accessToken)).status, 401, "the old A session is gone");
    assert.equal((await post("/auth/refresh", { refreshToken: before.refreshToken })).status, 401);
    const expB = await experience(sessB.accessToken);
    assert.equal(expB.status, 200);
    const fbB = await post("/operations/experience", { operation: "resolveMyExperienceContext" }, { authorization: "Bearer fb-token.fb-pat", "x-eos-tenant": B });
    assert.deepEqual(expB.body, fbB.body, "in B the session resolves exactly as Firebase does in B");
    assert.equal((await experience(sessB.accessToken, { "x-eos-tenant": A })).status, 403, "and is now refused A");
    const audits = (await q(`SELECT tenant_id FROM eos_policy.audit_events WHERE action = 'switchLoginTenant' AND target_id = $1`, [patAccount])).rows.map((r) => r.tenant_id).sort();
    assert.deepEqual(audits, [A, B].sort());
    const refreshed = await post("/auth/refresh", { refreshToken: sessB.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.session.tenantId, B, "refresh keeps the tenant");
    sessA = null;
  });

  await t.test("M5 concurrent switches of ONE session: exactly one succeeds; one live session results", async () => {
    const s0 = (await login("pat@tenancy.test", PAT_PW, A)).body.session;
    const both = await Promise.all([1, 2, 3].map(() => post("/auth/session/switch-tenant", { tenantId: B }, bearer(s0.accessToken))));
    const statuses = both.map((r) => r.status).sort();
    assert.equal(statuses.filter((x) => x === 200).length, 1, JSON.stringify(statuses));
    assert.ok(statuses.filter((x) => x !== 200).every((x) => x === 401));
    const fromS0 = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'switchLoginTenant' AND after->>'fromSessionId' = $1`, [s0.sessionId])).rows[0].n;
    assert.equal(fromS0, 2, "one switch, audited once in each tenant");
  });

  // ════════════════════ M6: revoked membership ════════════════════
  await t.test("M6 revoking the session tenant's membership refuses the next request immediately; other tenants unaffected", async () => {
    const sB = (await login("pat@tenancy.test", PAT_PW, B)).body.session;
    const sA = (await login("pat@tenancy.test", PAT_PW, A)).body.session;
    assert.equal((await experience(sB.accessToken)).status, 200);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1 AND tenant_id = $2`, [pat, B]);
    assert.equal((await experience(sB.accessToken)).status, 401, "immediately");
    assert.equal((await post("/auth/refresh", { refreshToken: sB.refreshToken })).status, 401);
    assert.equal((await login("pat@tenancy.test", PAT_PW, B)).status, 401);
    assert.equal((await experience(sA.accessToken)).status, 200, "the A session is unaffected");
    assert.equal((await post("/auth/session/switch-tenant", { tenantId: B }, bearer(sA.accessToken))).status, 403);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1 AND tenant_id = $2`, [pat, B]);
  });

  // ════════════════════ M7: single-tenant mode is preserved where multi-tenant is not enabled ════════════════════
  await t.test("M7 with EOS_AUTH_MULTI_TENANT_SESSIONS off, a two-tenant person cannot sign in and switching is disabled", async () => {
    const { EOS_AUTH_MULTI_TENANT_SESSIONS, ...single } = authEnv;
    const svc = await start(single);
    extra.push(svc);
    const at = `http://127.0.0.1:${svc.port}`;
    assert.equal((await post("/auth/login", { identifier: "pat@tenancy.test", password: PAT_PW }, {}, at)).status, 401);
    const sA = (await login("pat@tenancy.test", PAT_PW, A)).body.session; // via the multi-tenant service
    const sw = await post("/auth/session/switch-tenant", { tenantId: B }, bearer(sA.accessToken), at);
    assert.ok(sw.status === 401 || sw.status === 409, `${sw.status}`);
  });

  // ════════════════════ M8: MFA cannot be bypassed by switching ════════════════════
  await t.test("M8 a session that owes a second factor cannot switch; a verified one keeps its verification across the switch", async () => {
    const prov = await asFb("fb-owner-ab", "provisionLoginAccount", { principalId: quinn, loginIdentifier: "quinn@tenancy.test", reason: "quinn", mfaRequired: true }, { "x-eos-tenant": A });
    assert.equal(prov.status, 200, JSON.stringify(prov.body));
    secrets.push(prov.body.data.enrollmentTicket);
    await post("/auth/enrollment/complete", { ticket: prov.body.data.enrollmentTicket, password: "a silver kite over the bay" });
    secrets.push("a silver kite over the bay");
    const owed = (await login("quinn@tenancy.test", "a silver kite over the bay", A)).body.session;
    assert.equal(owed.mfaEnrollmentRequired, true);
    assert.equal((await post("/auth/session/switch-tenant", { tenantId: B }, bearer(owed.accessToken))).status, 403, "MFA_ENROLLMENT_REQUIRED");
    const b = await post("/auth/mfa/totp/begin", {}, bearer(owed.accessToken));
    const A32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0; let value = 0; const out = [];
    for (const ch of b.body.secret) { value = (value << 5) | A32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
    const secret = Buffer.from(out);
    secrets.push(b.body.secret);
    const c = await post("/auth/mfa/totp/confirm", { factorId: b.body.factorId, code: totpCodeAt(secret, totpStepAt(Math.floor(Date.now() / 1000))) }, bearer(owed.accessToken));
    assert.equal(c.status, 200);
    secrets.push(...c.body.recoveryCodes);
    const sw = await post("/auth/session/switch-tenant", { tenantId: B }, bearer(owed.accessToken));
    assert.equal(sw.status, 200, JSON.stringify(sw.body));
    assert.equal((await experience(sw.body.session.accessToken)).status, 200, "verified in A -> verified in B");
    // A fresh login into B with only the password stops at the second factor, as everywhere.
    assert.equal((await login("quinn@tenancy.test", "a silver kite over the bay", B)).body.status, "MFA_REQUIRED");
  });

  // ════════════════════ M9: password-reset abuse ════════════════════
  await t.test("M9 reset abuse: wrong ticket kind, expired, reused, for a disabled account -- all refused; completion ends sessions in EVERY tenant", async () => {
    const sA = (await login("pat@tenancy.test", PAT_PW, A)).body.session;
    const sB = (await login("pat@tenancy.test", PAT_PW, B)).body.session;
    const r = await asFb("fb-owner-ab", "issueLoginReset", { principalId: pat, reason: "reset proof" }, { "x-eos-tenant": A });
    assert.equal(r.status, 200);
    const ticket = r.body.data.resetTicket;
    secrets.push(ticket);
    assert.equal((await post("/auth/enrollment/complete", { ticket, password: "a brand new passphrase" })).status, 410, "a reset ticket is not an enrollment ticket");
    await q(`UPDATE eos_policy.login_tickets SET issued_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE account_id = $1 AND purpose = 'reset' AND consumed_at IS NULL AND revoked_at IS NULL`, [patAccount]);
    assert.equal((await post("/auth/password/reset/complete", { ticket, password: "a brand new passphrase" })).status, 410, "expired");
    const r2 = await asFb("fb-owner-ab", "issueLoginReset", { principalId: pat, reason: "reset proof 2" }, { "x-eos-tenant": A });
    secrets.push(r2.body.data.resetTicket);
    assert.equal((await asFb("fb-owner-ab", "setLoginAccountStatus", { principalId: pat, status: "disabled", reason: "disabled before use" }, { "x-eos-tenant": A })).status, 200);
    assert.equal((await post("/auth/password/reset/complete", { ticket: r2.body.data.resetTicket, password: "a brand new passphrase" })).status, 410, "disabling revoked the open ticket");
    assert.equal((await asFb("fb-owner-ab", "setLoginAccountStatus", { principalId: pat, status: "active", reason: "re-enabled" }, { "x-eos-tenant": A })).status, 200);
    const r3 = await asFb("fb-owner-ab", "issueLoginReset", { principalId: pat, reason: "reset proof 3" }, { "x-eos-tenant": A });
    secrets.push(r3.body.data.resetTicket);
    const live = (await login("pat@tenancy.test", PAT_PW, B)).body.session;
    assert.equal((await post("/auth/password/reset/complete", { ticket: r3.body.data.resetTicket, password: "a brand new passphrase" })).status, 200);
    secrets.push("a brand new passphrase");
    assert.equal((await post("/auth/password/reset/complete", { ticket: r3.body.data.resetTicket, password: "yet another passphrase" })).status, 410, "single use");
    for (const s of [sA, sB, live]) assert.equal((await experience(s.accessToken)).status, 401, "sessions in every tenant end");
  });

  // ════════════════════ M10: session fixation ════════════════════
  await t.test("M10 session fixation: a planted refresh cookie is never adopted -- login always mints a NEW session for the authenticated person", async () => {
    const attacker = (await login("quinn@tenancy.test", "a silver kite over the bay", A)).body; // MFA_REQUIRED for quinn
    assert.equal(attacker.status, "MFA_REQUIRED");
    const planted = `eosrt_${"P".repeat(43)}`;
    const r = await post("/auth/login", { identifier: "pat@tenancy.test", password: "a brand new passphrase", tenantId: A }, { cookie: `__Host-eos_refresh=${planted}` });
    assert.equal(r.status, 200);
    assert.notEqual(r.body.session.refreshToken, planted);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.login_refresh_tokens WHERE token_sha256 = encode(sha256($1::bytea), 'hex')`, [planted])).rows[0].n, 0);
    // The request carries no field that names a session or a subject the server would adopt.
    const extraFields = await post("/auth/login", { identifier: "pat@tenancy.test", password: "a brand new passphrase", sessionId: "x".repeat(32), subject: "user.abc" });
    assert.equal(extraFields.status, 200);
    assert.notEqual(extraFields.body.session.sessionId, "x".repeat(32));
  });

  // ════════════════════ M11: audit failure behaviour ════════════════════
  await t.test("M11 if the security record cannot be written, NO access is granted and NO credential is issued", async () => {
    const sessionsBefore = (await q(`SELECT count(*)::int n FROM eos_policy.login_sessions`)).rows[0].n;
    const ticketsBefore = (await q(`SELECT count(*)::int n FROM eos_policy.login_tickets`)).rows[0].n;
    await q(`CREATE FUNCTION eos_policy.tenancy_proof_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated audit store failure'; END $$`);
    await q(`CREATE TRIGGER tenancy_proof_fail BEFORE INSERT ON eos_policy.authentication_events FOR EACH ROW EXECUTE FUNCTION eos_policy.tenancy_proof_fail()`);
    try {
      const ok = await login("pat@tenancy.test", "a brand new passphrase", A);
      assert.notEqual(ok.status, 200, "a correct login without its event is refused");
      assert.equal(ok.setCookie, null);
      const bad = await login("pat@tenancy.test", "the wrong password here", A);
      assert.notEqual(bad.status, 200);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.login_sessions`)).rows[0].n, sessionsBefore);
    } finally {
      await q(`DROP TRIGGER tenancy_proof_fail ON eos_policy.authentication_events`);
    }
    await q(`CREATE TRIGGER tenancy_proof_fail BEFORE INSERT ON eos_policy.audit_events FOR EACH ROW WHEN (NEW.target_kind = 'loginAccount') EXECUTE FUNCTION eos_policy.tenancy_proof_fail()`);
    try {
      const r = await asFb("fb-owner-ab", "issueLoginReset", { principalId: pat, reason: "must not be issued" }, { "x-eos-tenant": A });
      assert.notEqual(r.status, 200);
      assert.equal(r.body?.data?.resetTicket, undefined);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.login_tickets`)).rows[0].n, ticketsBefore, "no ticket without its audit row");
    } finally {
      await q(`DROP TRIGGER tenancy_proof_fail ON eos_policy.audit_events`);
      await q(`DROP FUNCTION eos_policy.tenancy_proof_fail()`);
    }
    await asFb("fb-owner-ab", "unlockLoginAccount", { principalId: pat, reason: "after the audit-failure proof" }, { "x-eos-tenant": A });
    assert.equal((await login("pat@tenancy.test", "a brand new passphrase", A)).status, 200, "service resumes when the store does");
  });

  // ════════════════════ M12-M15: security-event governance (D-13) ════════════════════
  await t.test("M12 security events are tenant-isolated and readable only by admin/owner", async () => {
    const a = await asFb("fb-admin-a", "readAuthenticationEvents", { limit: 200 });
    const b = await asFb("fb-admin-b", "readAuthenticationEvents", { limit: 200 });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const idsA = new Set(a.body.data.events.map((e) => e.id));
    const idsB = new Set(b.body.data.events.map((e) => e.id));
    assert.ok(idsA.size > 0 && idsB.size > 0);
    assert.equal([...idsA].filter((x) => idsB.has(x)).length, 0, "no event is visible to both tenants");
    const rowsA = (await q(`SELECT tenant_id FROM eos_policy.authentication_events WHERE id = ANY($1)`, [[...idsA]])).rows;
    assert.ok(rowsA.every((r) => r.tenant_id === A));
    // Account-less attempts (tenant NULL) are never shown to a tenant.
    await login("nobody@tenancy.test", "whatever whatever");
    const nulls = (await q(`SELECT id FROM eos_policy.authentication_events WHERE tenant_id IS NULL`)).rows.map((r) => r.id);
    assert.ok(nulls.length >= 1);
    const again = await asFb("fb-admin-a", "readAuthenticationEvents", { limit: 200 });
    assert.ok(!again.body.data.events.some((e) => nulls.includes(e.id)));
    // A technician (pat via Firebase in A) may not read the security record.
    assert.equal((await asFb("fb-pat", "readAuthenticationEvents", {}, { "x-eos-tenant": A })).status, 403);
  });

  await t.test("M13 retention is governed: bounded, audited, history-only, admin.securityPolicy.write", async () => {
    assert.equal((await asFb("fb-admin-a", "setAuthenticationEventRetention", { activeRetentionDays: 100, archiveRetentionDays: 400, reason: "too short" })).status, 400);
    assert.equal((await asFb("fb-admin-a", "setAuthenticationEventRetention", { activeRetentionDays: 400, archiveRetentionDays: 4000, reason: "too long" })).status, 400);
    assert.equal((await asFb("fb-admin-a", "setAuthenticationEventRetention", { activeRetentionDays: 400, archiveRetentionDays: 2555 })).status, 400, "reason required");
    assert.equal((await asFb("fb-owner-ab", "setAuthenticationEventRetention", { activeRetentionDays: 400, archiveRetentionDays: 2555, reason: "owner" }, { "x-eos-tenant": A })).status, 403,
      "only admin.securityPolicy.write -- the Owner does not hold it");
    const ok = await asFb("fb-admin-a", "setAuthenticationEventRetention", { activeRetentionDays: 400, archiveRetentionDays: 2555, reason: "policy v1" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const audit = (await q(`SELECT tenant_id, actor_uid, reason FROM eos_policy.audit_events WHERE action = 'setAuthenticationEventRetention'`)).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].tenant_id, A);
    await assert.rejects(q(`UPDATE eos_policy.authentication_event_retention_policies SET active_retention_days = 365`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_policy.authentication_event_retention_policies`), /append-only/);
    await assert.rejects(q(`INSERT INTO eos_policy.authentication_event_retention_policies (id, tenant_id, active_retention_days, archive_retention_days, set_by, reason) VALUES ('x', $1, 30, 400, 'x', 'x')`, [A]), /retention_bounds/);
  });

  await t.test("M14 the archive plan is READ-ONLY and its digest is the canonical export's", async () => {
    // One old event for A (inserting is the only write the active history admits).
    const oldId = randomUUID();
    await q(`INSERT INTO eos_policy.authentication_events (id, occurred_at, tenant_id, event, outcome, reason_code, account_id)
             VALUES ($1, now() - interval '500 days', $2, 'login', 'refused', 'BAD_PASSWORD', $3)`, [oldId, A, patAccount]);
    const counts = async () => (await q(`SELECT (SELECT count(*)::int FROM eos_policy.authentication_events) e, (SELECT count(*)::int FROM eos_policy.authentication_event_archive_manifests) m`)).rows[0];
    const before = await counts();
    const plan = await asFb("fb-admin-a", "planAuthenticationEventArchive", {});
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    assert.equal(plan.body.data.eligible.rowCount, 1);
    const rows = (await q(`SELECT * FROM eos_policy.authentication_events WHERE tenant_id = $1 AND occurred_at < now() - interval '400 days' ORDER BY occurred_at, id`, [A])).rows;
    const digest = createHash("sha256").update(rows.map((r) => `${canonicalEventLine(r)}\n`).join("")).digest("hex");
    assert.equal(plan.body.data.eligible.exportSha256, digest);
    assert.deepEqual(await counts(), before, "the plan wrote nothing");
    // B has no policy: nothing is ever eligible.
    const planB = await asFb("fb-admin-b", "planAuthenticationEventArchive", {});
    assert.equal(planB.body.data.eligible, null);
    // The active history and the manifest refuse rewrite.
    await assert.rejects(q(`DELETE FROM eos_policy.authentication_events WHERE id = $1`, [oldId]), /append-only/);
    await q(`INSERT INTO eos_policy.authentication_event_archive_manifests (id, tenant_id, window_start, window_end, row_count, export_sha256, storage_location, recorded_by, reason)
             VALUES ('m1', $1, '1970-01-01', now() - interval '400 days', 1, $2, 'operator://proof', 'proof', 'manifest append-only proof')`, [A, digest]);
    await assert.rejects(q(`UPDATE eos_policy.authentication_event_archive_manifests SET row_count = 0`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_policy.authentication_event_archive_manifests`), /append-only/);
    // After a recorded archive the next plan starts where it ended.
    const next = await asFb("fb-admin-a", "planAuthenticationEventArchive", {});
    assert.equal(next.body.data.eligible.rowCount, 0);
  });

  await t.test("M15 nothing secret at rest or in logs; authority in BOTH tenants unchanged", async () => {
    const dump = (await q(`SELECT
        (SELECT coalesce(json_agg(x), '[]') FROM eos_policy.login_sessions x)::text || (SELECT coalesce(json_agg(x), '[]') FROM eos_policy.login_tickets x)::text ||
        (SELECT coalesce(json_agg(x), '[]') FROM eos_policy.login_refresh_tokens x)::text || (SELECT coalesce(json_agg(x), '[]') FROM eos_policy.authentication_events x)::text ||
        (SELECT coalesce(json_agg(x), '[]') FROM eos_policy.audit_events x)::text || (SELECT coalesce(json_agg(x), '[]') FROM eos_policy.login_accounts x)::text AS all`)).rows[0].all;
    for (const v of secrets) {
      assert.ok(!dump.includes(v), "a secret value was found at rest");
      assert.ok(!captured.join("\n").includes(v), "a secret value was found in the logs");
    }
    assert.deepEqual(await authorityDigest(A), authorityBefore.A);
    assert.deepEqual(await authorityDigest(B), authorityBefore.B);
  });
});
