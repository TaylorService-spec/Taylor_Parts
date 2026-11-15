// A13 / D5: MAKE A PERSON LOGIN-READY, against a real postgres:16. docs/architecture/eos-login-ready-person.md, section 8.
//
// Its OWN disposable database (migrated by the normal runner, dropped afterwards). Keys are generated in memory. The service is driven
// directly (the Administration transport is proven elsewhere); the Firebase verifier is not involved and nothing here touches any network
// other than the loopback database.
//
//   tenant + bootstrap administrator + Employees in every state the note refuses
//   -> INACTIVE: the key is ungranted, so the protected Administrator and the Owner are FORBIDDEN
//   -> a TEST-ONLY grant to the admin and owner Roles (the migration grants nothing)
//   -> double gate, refusals (zero rows each), the happy path and what it must NOT create, rollback at every write, concurrency, first sign-in.
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
const DB_NAME = `eos_lrp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const ISS = "https://eos-api-nonprod.test/auth";
const AUD = "https://eos-api-nonprod.test";
const FAST_HASH = { N: 2 ** 14, r: 8, p: 1 };
const KEY = "admin.loginReadyPerson.provision";
const ASSIGN = "admin.roleAssignment.write";

test("A13 make a person login-ready: gate, refusals, rows, rollback, concurrency and first sign-in, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  delete process.env.SANDBOX_CREDENTIALS_FILE;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  let pool;
  t.after(async () => {
    if (pool) await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const up = spawnSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(up.error, undefined, String(up.error));
  assert.equal(up.status, 0, up.stderr);

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { capabilityKeysFor } = require("../lib/adminPolicy/administrationCapabilityGate.js");
  const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");
  const { EosLoginService, LoginRefusal } = require("../lib/eosAuth/eosLoginService.js");
  const { opaqueTokenDigest } = require("../lib/eosAuth/credentialCrypto.js");

  pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // ════════════════════ fixture ════════════════════
  const { tenant } = await bootstrapTenant(repo, { key: "lrp-proof", name: "Login-ready proof tenant", actorUid: "lrp-proof" });
  const tenantId = tenant.id;
  const admin = await bootstrapAdministrator(repo, { tenantId, externalSubject: "fb-admin-uid", performedBy: "lrp-proof" });
  const adminPrincipalId = admin.principal.id;
  const { tenant: other } = await bootstrapTenant(repo, { key: "lrp-other", name: "Another tenant", actorUid: "lrp-proof" });
  {
    const baseline = require("../lib/adminPolicy/seed/roleCapabilityAuthorityBaseline.json");
    const [caps, roles, existing] = await Promise.all([repo.listCapabilities(), repo.listRoles(tenantId), repo.listRoleCapabilities(tenantId)]);
    const capId = new Map(caps.map((c) => [c.key, c.id]));
    const roleId = new Map(roles.map((r) => [r.key, r.id]));
    const have = new Set(existing.map((e) => `${e.roleId}|${e.capabilityId}`));
    await repo.transact({ tenantId, uid: "lrp-fixture" }, async (tx) => {
      for (const g of baseline.grants) {
        const r = roleId.get(g.roleKey); const c = capId.get(g.capabilityKey);
        if (!r || !c || have.has(`${r}|${c}`)) continue;
        have.add(`${r}|${c}`);
        await tx.grantRoleCapability({ roleId: r, capabilityId: c, grantedBy: "lrp-fixture", grantedAt: new Date(Date.now() - 120_000).toISOString() });
      }
    });
    assert.ok(capId.has(KEY), "the registering migration ran");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = $1`, [KEY])).rows[0].n, 0,
      "the migration and the baseline grant the key to NOBODY");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = $1`, [KEY])).rows[0].n, 0);
  }
  const employee = async (id, over = {}) => {
    const o = { status: "ACTIVE", workEmail: null, separation: null, tenant: tenantId, ...over };
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, work_email, separation_date, updated_at)
             VALUES ($1,$2,$3,'taylor',$4,$5,'2020-01-01T00:00:00Z')`, [id, o.tenant, o.status, o.workEmail, o.separation]);
    return id;
  };
  const adminActor = { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] };
  const ownerActor = { tenantId, uid: adminPrincipalId, heldRoleKeys: ["owner"] };

  const signing = generateKeyPairSync("ed25519");
  const eosAuth = readEosAuthConfig({
    EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-lrp": signing.publicKey.export({ format: "jwk" }) }),
    EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD,
    EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(signing.privateKey.export({ format: "jwk" })), EOS_AUTH_SIGNING_KID: "nonprod-lrp",
    EOS_HUMAN_LOGIN: "enabled",
    EOS_AUTH_FACTOR_KEYS: JSON.stringify({ f1: randomBytes(32).toString("base64url") }), EOS_AUTH_FACTOR_KEY_ID: "f1",
    EOS_AUTH_COOKIE_SAMESITE: "Strict", EOS_AUTH_TRUSTED_PROXY_HOPS: "0",
    EOS_AUTH_FIREBASE_VERIFIER: "disabled",
  }, "nonprod");
  const service = new EosLoginService({ pool, repo, signer: eosAuth.humanLogin.signer, issuer: ISS, audience: AUD, environment: "nonprod",
    factorKeyring: eosAuth.humanLogin.factorKeyring, passwordHashParameters: FAST_HASH });

  // Every table the operation writes, plus the audit and event rows it must not leave behind on a refusal.
  const rowCounts = async () => (await q(`SELECT
      (SELECT count(*)::int FROM eos_policy.principals) principals,
      (SELECT count(*)::int FROM eos_policy.tenant_memberships) memberships,
      (SELECT count(*)::int FROM eos_policy.employee_principal_links) links,
      (SELECT count(*)::int FROM eos_policy.principal_identities) bindings,
      (SELECT count(*)::int FROM eos_policy.login_accounts) accounts,
      (SELECT count(*)::int FROM eos_policy.login_tickets) tickets,
      (SELECT count(*)::int FROM eos_policy.audit_events WHERE action IN ('makePersonLoginReady','tenant.addPrincipal','provisionLoginAccount')) audits`)).rows[0];
  const refused = async (actor, input, code, label) => {
    const before = await rowCounts();
    await assert.rejects(() => service.makePersonLoginReady(actor, input),
      (e) => e instanceof LoginRefusal && e.code === code, `${label}: expected ${code}`);
    assert.deepEqual(await rowCounts(), before, `${label}: a refusal leaves ZERO rows`);
  };
  const base = (employeeId, over = {}) => ({ employeeId, loginIdentifier: `${employeeId}@example.test`, reason: "new hire onboarding proof", ...over });

  const eActive = await employee("emp-active");
  const eActive2 = await employee("emp-active-2");

  await t.test("INACTIVE: the key is granted to nobody, so the protected Administrator and the Owner are FORBIDDEN, with zero rows", async () => {
    for (const [who, actor] of [["administrator", adminActor], ["owner", ownerActor]]) {
      const before = await rowCounts();
      await assert.rejects(() => service.makePersonLoginReady(actor, base(eActive)),
        (e) => e instanceof LoginRefusal && e.code === "FORBIDDEN" && e.message.includes(KEY), `${who} without the key`);
      assert.deepEqual(await rowCounts(), before);
    }
    const adminKeys = await capabilityKeysFor(repo, tenantId, ["admin"], adminPrincipalId);
    assert.ok(adminKeys.has(ASSIGN) && !adminKeys.has(KEY), "the administrator holds roleAssignment.write but not the new key");
  });

  // TEST-ONLY grant: the migration grants nothing, and neither does any shipped code.
  {
    const [caps, roles] = await Promise.all([repo.listCapabilities(), repo.listRoles(tenantId)]);
    const cap = caps.find((c) => c.key === KEY);
    await repo.transact({ tenantId, uid: "lrp-fixture" }, async (tx) => {
      for (const key of ["admin", "owner"]) {
        await tx.grantRoleCapability({ roleId: roles.find((r) => r.key === key).id, capabilityId: cap.id, grantedBy: "lrp-fixture", grantedAt: new Date(Date.now() - 60_000).toISOString() });
      }
    });
  }

  await t.test("double gate: the key alone, and roleAssignment.write alone, are both FORBIDDEN; allowed once both are held", async () => {
    const before = await rowCounts();
    await assert.rejects(() => service.makePersonLoginReady({ tenantId, uid: adminPrincipalId, capabilities: new Set([KEY]) }, base(eActive)),
      (e) => e.message.includes(ASSIGN), "the key without roleAssignment.write");
    await assert.rejects(() => service.makePersonLoginReady({ tenantId, uid: adminPrincipalId, capabilities: new Set([ASSIGN]) }, base(eActive)),
      (e) => e instanceof LoginRefusal && e.code === "FORBIDDEN" && e.message.includes(KEY), "roleAssignment.write without the key");
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("refusals by name, each leaving ZERO rows", async () => {
    await refused(adminActor, base("emp-does-not-exist"), "NOT_FOUND", "unknown Employee");
    const foreign = await employee("emp-foreign", { tenant: other.id });
    await refused(adminActor, base(foreign), "NOT_FOUND", "foreign-tenant Employee");
    for (const status of ["INACTIVE", "TERMINATED", "ON_LEAVE", "RETIRED"]) {
      await refused(adminActor, base(await employee(`emp-${status.toLowerCase()}`, { status })), "EMPLOYEE_NOT_ELIGIBLE", status);
    }
    await refused(adminActor, base(await employee("emp-separated", { separation: "2020-06-30" })), "EMPLOYEE_SEPARATED", "separation date");
    // An Employee that already has an active link (here: a fixture Principal) is the business of provisionLoginAccount.
    const linked = await employee("emp-linked");
    const linkedPrincipal = await repo.transact({ tenantId, uid: "lrp-fixture" }, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: "fb-linked", identityProvider: "firebase", displayName: null });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
             VALUES ('epl-linked',$1,$2,$3,'taylor','OPERATOR_ASSERTED','lrp-fixture','fixture')`, [tenantId, linkedPrincipal, linked]);
    await refused(adminActor, base(linked), "ALREADY_LINKED", "already linked");
    const withMail = await employee("emp-mail", { workEmail: "assigned.mail@example.test" });
    await refused(adminActor, base(withMail, { loginIdentifier: "someone.else@example.test" }), "INVALID_INPUT", "login name must equal the work email");
    await refused(adminActor, base(eActive, { mfaRequired: false }), "INVALID_INPUT", "mfaRequired:false");
    await refused(adminActor, base(eActive, { principalId: linkedPrincipal }), "INVALID_INPUT", "principalId in the body");
    await refused(adminActor, base(eActive, { reason: "" }), "REASON_REQUIRED", "missing reason");
    await refused(adminActor, base(eActive, { reason: "x".repeat(501) }), "INVALID_INPUT", "over-long reason");
    await refused(adminActor, base(eActive, { loginIdentifier: "no" }), "INVALID_INPUT", "malformed login name");
  });

  let made;
  await t.test("the happy path: Principal, membership, link, binding, pending account, one ticket, audit and event; nothing secret anywhere", async () => {
    const roleGrantsBefore = (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [tenantId])).rows[0].n;
    made = await service.makePersonLoginReady(adminActor, base(eActive, { loginIdentifier: "  Active.Person@Example.test " }));
    assert.equal(made.status, "pending_enrollment");
    assert.equal(made.mfaRequired, true);
    assert.equal(made.employeeId, eActive);
    assert.equal(made.loginIdentifier, "active.person@example.test", "normalized");
    assert.match(made.subject, /^user\.[0-9a-f]{32}$/);
    assert.ok(typeof made.enrollmentTicket === "string" && made.enrollmentTicket.length > 20);

    const principal = (await q(`SELECT * FROM eos_policy.principals WHERE id = $1`, [made.principalId])).rows[0];
    assert.equal(principal.identity_provider, "eos-provisioned");
    assert.match(principal.external_subject, /^principal\.[0-9a-f-]{36}$/);
    assert.equal(principal.display_name, null);
    assert.equal(principal.status, "active");
    const member = (await q(`SELECT status FROM eos_policy.tenant_memberships WHERE principal_id = $1 AND tenant_id = $2`, [made.principalId, tenantId])).rows;
    assert.deepEqual(member.map((m) => m.status), ["active"]);
    const link = (await q(`SELECT * FROM eos_policy.employee_principal_links WHERE principal_id = $1`, [made.principalId])).rows;
    assert.equal(link.length, 1);
    assert.deepEqual([link[0].employee_id, link[0].status, link[0].link_source, link[0].asserted_by, link[0].assertion_reason, link[0].operating_company_id],
      [eActive, "active", "OPERATOR_ASSERTED", adminPrincipalId, "new hire onboarding proof", "taylor"]);
    const binding = (await q(`SELECT * FROM eos_policy.principal_identities WHERE principal_id = $1`, [made.principalId])).rows;
    assert.equal(binding.length, 1);
    assert.deepEqual([binding[0].identity_provider, binding[0].external_subject, binding[0].status], ["eos", made.subject, "active"]);
    const account = (await q(`SELECT * FROM eos_policy.login_accounts WHERE id = $1`, [made.accountId])).rows[0];
    assert.deepEqual([account.status, account.mfa_required, account.principal_id, account.binding_id, account.login_identifier, account.password_hash],
      ["pending_enrollment", true, made.principalId, binding[0].id, "active.person@example.test", null]);
    const tickets = (await q(`SELECT * FROM eos_policy.login_tickets WHERE account_id = $1`, [made.accountId])).rows;
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].purpose, "enrollment");
    assert.equal(tickets[0].token_sha256, opaqueTokenDigest(made.enrollmentTicket), "only the digest is stored");

    const audits = (await q(`SELECT * FROM eos_policy.audit_events WHERE target_id = ANY($1)`, [[made.accountId, made.principalId]])).rows;
    assert.deepEqual(audits.map((a) => a.action).sort(), ["makePersonLoginReady", "tenant.addPrincipal"]);
    const ready = audits.find((a) => a.action === "makePersonLoginReady");
    assert.equal(ready.actor_uid, adminPrincipalId);
    assert.equal(ready.reason, "new hire onboarding proof");
    const after = typeof ready.after === "string" ? JSON.parse(ready.after) : ready.after;
    assert.deepEqual([after.employeeId, after.principalId, after.membershipCreated, after.linkId, after.linkSource, after.bindingId, after.subject, after.mfaRequired, after.enrollmentTicketId],
      [eActive, made.principalId, true, link[0].id, "OPERATOR_ASSERTED", binding[0].id, made.subject, true, tickets[0].id]);
    const events = (await q(`SELECT * FROM eos_policy.authentication_events WHERE event = 'makePersonLoginReady' AND outcome = 'success' AND account_id = $1`, [made.accountId])).rows;
    assert.equal(events.length, 1);

    // NO SECRET: the setup code is in no audit, event, ticket, account or binding row.
    const everything = JSON.stringify([audits, events, tickets, account, binding, principal]);
    assert.ok(!everything.includes(made.enrollmentTicket), "the setup code is in no row");

    // AUTHORITY: made login-ready is NOT given access. No Role, no scope, no direct grant; the gate's own resolver yields nothing.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE principal_id = $1`, [made.principalId])).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.principal_capabilities WHERE principal_id = $1`, [made.principalId])).rows[0].n, 0);
    assert.equal((await capabilityKeysFor(repo, tenantId, [], made.principalId)).size, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [tenantId])).rows[0].n, roleGrantsBefore, "no Role was widened");
  });

  await t.test("not idempotent: a repeat refuses ALREADY_LINKED and changes nothing", async () => {
    await refused(adminActor, base(eActive, { loginIdentifier: "active.again@example.test" }), "ALREADY_LINKED", "repeat call");
  });

  await t.test("the login name must equal the work email when there is one (any case), and a taken name is a CONFLICT", async () => {
    const mailed = await service.makePersonLoginReady(adminActor, base("emp-mail", { loginIdentifier: "Assigned.Mail@Example.test" }));
    assert.equal(mailed.loginIdentifier, "assigned.mail@example.test");
    await refused(adminActor, base(eActive2, { loginIdentifier: "active.person@example.test" }), "CONFLICT", "identifier in use");
  });

  await t.test("a retired login name is never silently re-created (LOGIN_RETIRED), with zero rows", async () => {
    await service.retireLoginAccount(adminActor, { principalId: made.principalId, reason: "proof: retire the sign-in" });
    await refused(adminActor, base(eActive2, { loginIdentifier: "active.person@example.test" }), "LOGIN_RETIRED", "retired login");
  });

  await t.test("ATOMICITY: a failure at each write rolls back every row", async () => {
    await q(`CREATE TABLE public.lrp_fail (tbl text PRIMARY KEY)`);
    await q(`CREATE FUNCTION public.lrp_fail_fn() RETURNS trigger LANGUAGE plpgsql AS $$
             BEGIN IF EXISTS (SELECT 1 FROM public.lrp_fail WHERE tbl = TG_TABLE_NAME) THEN RAISE EXCEPTION 'lrp_injected_failure'; END IF; RETURN NEW; END $$`);
    const injectOn = ["tenant_memberships", "employee_principal_links", "principal_identities", "login_accounts", "login_tickets", "audit_events"];
    for (const tbl of injectOn) await q(`CREATE TRIGGER lrp_fail BEFORE INSERT ON eos_policy.${tbl} FOR EACH ROW EXECUTE FUNCTION public.lrp_fail_fn()`);
    const victim = await employee("emp-rollback");
    try {
      for (const tbl of injectOn) {
        await q(`INSERT INTO public.lrp_fail VALUES ($1)`, [tbl]);
        try {
          const before = await rowCounts();
          await assert.rejects(() => service.makePersonLoginReady(adminActor, base(victim)), /lrp_injected_failure/, `failure at ${tbl}`);
          assert.deepEqual(await rowCounts(), before, `a failure at ${tbl} leaves no Principal, link, binding, account, ticket or audit row`);
        } finally {
          await q(`DELETE FROM public.lrp_fail WHERE tbl = $1`, [tbl]);
        }
      }
    } finally {
      for (const tbl of injectOn) await q(`DROP TRIGGER IF EXISTS lrp_fail ON eos_policy.${tbl}`);
    }
    // After the injections are gone the same Employee can still be made login-ready: nothing half-linked was left behind.
    const ok = await service.makePersonLoginReady(adminActor, base(victim));
    assert.equal(ok.status, "pending_enrollment");
  });

  await t.test("CONCURRENCY: two calls for one Employee give one success and one refusal", async () => {
    const e = await employee("emp-race-one");
    const results = await Promise.allSettled([
      service.makePersonLoginReady(adminActor, base(e, { loginIdentifier: "race.one.a@example.test" })),
      service.makePersonLoginReady(adminActor, base(e, { loginIdentifier: "race.one.b@example.test" })),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    const loser = results.find((r) => r.status === "rejected").reason;
    assert.ok(loser instanceof LoginRefusal && loser.code === "ALREADY_LINKED", `the loser is refused by name, got ${loser?.code ?? loser?.message}`);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.employee_principal_links WHERE employee_id = $1 AND status = 'active'`, [e])).rows[0].n, 1);
  });

  await t.test("CONCURRENCY: two Employees racing one login name give one success and one CONFLICT", async () => {
    const [a, b] = [await employee("emp-race-a"), await employee("emp-race-b")];
    const results = await Promise.allSettled([
      service.makePersonLoginReady(adminActor, base(a, { loginIdentifier: "shared.name@example.test" })),
      service.makePersonLoginReady(adminActor, base(b, { loginIdentifier: "shared.name@example.test" })),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    const loser = results.find((r) => r.status === "rejected").reason;
    assert.ok(loser instanceof LoginRefusal && loser.code === "CONFLICT", `got ${loser?.code ?? loser?.message}`);
    const loserEmployee = results[0].status === "rejected" ? a : b;
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.employee_principal_links WHERE employee_id = $1`, [loserEmployee])).rows[0].n, 0, "the loser left no link");
  });

  // The ordinary link path (linkEmployeePrincipal), driven as the administrator exactly as the transport resolves them.
  const linkCmd = require("../lib/eosWorkforce/commands/employeePrincipalLinkCommands.js");
  const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
  const linkActor = await (async () => {
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: "fb-admin-uid", requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, entitlements: ctx.entitlements };
  })();
  const memberPrincipal = (subject) => repo.transact({ tenantId, uid: "lrp-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase", displayName: null });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const activeLinks = async (employeeId) => (await q(`SELECT principal_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`, [tenantId, employeeId])).rows;

  await t.test("CONCURRENCY: makePersonLoginReady racing linkEmployeePrincipal on one Employee -> exactly one wins, one active link, and a losing makePersonLoginReady creates nothing", async () => {
    const wins = { loginReady: 0, link: 0 };
    for (let i = 0; i < 8; i++) {
      const e = await employee(`emp-race-link-${i}`);
      const fixturePrincipal = await memberPrincipal(`fb-race-link-${i}`);
      const before = await rowCounts();
      // The link command reaches its lock sooner than makePersonLoginReady (which resolves capabilities first), so stagger its start
      // (0..7 ms) to give the race both outcomes across the iterations; every outcome is asserted, none is assumed.
      const delay = i;
      const [mplr, lnk] = await Promise.allSettled([
        service.makePersonLoginReady(adminActor, base(e, { loginIdentifier: `race.link.${i}@example.test` })),
        new Promise((r) => setTimeout(r, delay)).then(() => linkCmd.linkEmployeePrincipal({ pool }, linkActor, { employeeId: e, linkedPrincipalId: fixturePrincipal, reason: "race against make login-ready" })),
      ]);
      const settled = [mplr, lnk];
      assert.deepEqual(settled.map((r) => r.status).sort(), ["fulfilled", "rejected"], `iteration ${i}: exactly one wins`);
      const active = await activeLinks(e);
      assert.equal(active.length, 1, `iteration ${i}: exactly one active link`);
      const after = await rowCounts();
      const audit = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'makePersonLoginReady' AND after::text LIKE $1`, [`%"employeeId": "${e}"%`])).rows[0].n;
      if (mplr.status === "fulfilled") {
        wins.loginReady++;
        assert.ok(lnk.reason?.code === "EMPLOYEE_ALREADY_LINKED" || lnk.reason?.code === "CONFLICT" || /already/i.test(lnk.reason?.message ?? ""), `iteration ${i}: the link path is refused by name, got ${lnk.reason?.code ?? lnk.reason?.message}`);
        assert.equal(active[0].principal_id, mplr.value.principalId, `iteration ${i}: the surviving link is the new Principal's`);
        assert.equal(audit, 1);
      } else {
        wins.link++;
        assert.ok(mplr.reason instanceof LoginRefusal && ["ALREADY_LINKED", "CONFLICT"].includes(mplr.reason.code), `iteration ${i}: loser refused by name, got ${mplr.reason?.code ?? mplr.reason?.message}`);
        assert.equal(active[0].principal_id, fixturePrincipal, `iteration ${i}: the surviving link is the ordinary path's`);
        // The loser created ZERO rows: the only change since the snapshot is the winner's one link row.
        assert.deepEqual(after, { ...before, links: before.links + 1 }, `iteration ${i}: the losing makePersonLoginReady left no Principal, membership, binding, account, ticket or audit row`);
        assert.equal(audit, 0);
      }
    }
    assert.equal(wins.loginReady + wins.link, 8);
  });

  await t.test("LOGIN REMOVED THEN READY AGAIN: retiring the login does not unlink (ALREADY_LINKED); after unlinkEmployeePrincipal the old name is LOGIN_RETIRED and a new name makes a NEW Principal and login", async () => {
    const e = await employee("emp-reready");
    const first = await service.makePersonLoginReady(adminActor, base(e, { loginIdentifier: "re.ready.one@example.test" }));
    await service.retireLoginAccount(adminActor, { principalId: first.principalId, reason: "proof: remove the sign-in" });
    // (1) The login is gone but the Employee is still linked: the operation refuses by name and writes nothing. Removing a login is not unlinking a person.
    assert.equal((await activeLinks(e))[0]?.principal_id, first.principalId, "retiring the login leaves the link in force");
    await refused(adminActor, base(e, { loginIdentifier: "re.ready.two@example.test" }), "ALREADY_LINKED", "login retired but Employee still linked");
    // (2) The product's way to free the Employee is the governed unlink (it needs the Principal to be named).
    const unlinked = await linkCmd.unlinkEmployeePrincipal({ pool }, linkActor, { employeeId: e, expectedCurrentPrincipalId: first.principalId, reason: "proof: free the Employee" });
    assert.equal(unlinked.outcome, "REVOKED");
    assert.equal((await activeLinks(e)).length, 0);
    // (3) The retired name is never silently re-created, even for the same person.
    await refused(adminActor, base(e, { loginIdentifier: "re.ready.one@example.test" }), "LOGIN_RETIRED", "the retired name is refused");
    // (4) A new name succeeds and yields a NEW Principal, binding, account and ticket; the old ones stay as history.
    const second = await service.makePersonLoginReady(adminActor, base(e, { loginIdentifier: "re.ready.two@example.test" }));
    assert.equal(second.status, "pending_enrollment");
    assert.notEqual(second.principalId, first.principalId);
    assert.notEqual(second.accountId, first.accountId);
    assert.notEqual(second.subject, first.subject);
    const links = (await q(`SELECT principal_id, status FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2 ORDER BY created_at`, [tenantId, e])).rows;
    assert.deepEqual(links.map((l) => [l.principal_id, l.status]), [[first.principalId, "revoked"], [second.principalId, "active"]], "history kept; one active link");
    assert.equal((await q(`SELECT status FROM eos_policy.login_accounts WHERE id = $1`, [first.accountId])).rows[0].status, "retired", "the old login stays retired");
  });

  await t.test("SESSION: the setup code is redeemable once; the first sign-in then reaches the existing two-step enrollment, with no access", async () => {
    const e = await employee("emp-signin");
    const out = await service.makePersonLoginReady(adminActor, base(e, { loginIdentifier: "first.signin@example.test" }));
    const password = "Tidy river lantern 8841 maple";
    const done = await service.completeEnrollment({ ticket: out.enrollmentTicket, password }, null);
    assert.equal(done.loginIdentifier, "first.signin@example.test");
    await assert.rejects(() => service.completeEnrollment({ ticket: out.enrollmentTicket, password }, null), (err) => err instanceof LoginRefusal && err.code === "TICKET_INVALID", "redeemable once");
    const login = await service.login({ identifier: "first.signin@example.test", password }, null);
    assert.equal(login.status, "AUTHENTICATED");
    assert.equal(login.session.mfaEnrollmentRequired, true, "D7: two-step verification is required, so only the self routes work until it is set up");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE principal_id = $1`, [out.principalId])).rows[0].n, 0, "still no Role");
  });
});
