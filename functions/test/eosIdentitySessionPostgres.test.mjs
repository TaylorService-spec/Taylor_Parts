// THE EOS IDENTITY/SESSION FOUNDATION, END TO END, against a real postgres:16 and the REAL in-process EOS API.
// docs/architecture/eos-identity-session-foundation.md, proofs 1, 2, 7-12, 14, 15, 16 and the migration.
//
// Its OWN disposable database (migrated by the normal runner, dropped afterwards). Signing keys and the issuer
// credential are generated IN MEMORY for this run and never written anywhere. The Firebase verifier is a FAKE
// injected through the existing seam -- nothing here contacts Firebase, Google or any network other than the
// loopback database and the loopback API (the offline guard, loaded first, refuses anything else).
//
//   the 16 governed personas (config/sandboxRoleIdentityRegistry.json) -> a Principal each, holding the registry
//   uid as its PRIMARY (firebase) binding, one Role, and a link to the registry's expectedEmployeeId
//   -> the governed CLI binds each an EOS identity -> the persona issuer mints -> the API resolves.
import "./support/firebaseOfflineGuard.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const require = createRequire(import.meta.url);

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const DB_NAME = `idn_session_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
};
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const REGISTRY = JSON.parse(readFileSync(join(REPO_ROOT, "config", "sandboxRoleIdentityRegistry.json"), "utf8"));
/** Persona -> the ONE seeded Security Role its fixture Principal holds. retailSales ALSO gets a SCOPED Role. */
const ROLE_BY_PERSONA = Object.freeze({
  ownerExecutive: "owner", generalManager: "generalManager", officeManager: "officeManager", administrator: "admin",
  serviceManager: "fieldManager", dispatcher: "dispatcher", serviceTechnician: "technician", partsAssociate: "partsAssociate",
  partsManager: "partsManager", warehouseAssociate: "warehouseAssociate", warehouseManager: "warehouseManager",
  retailSales: "generalEmployee", nationalAccountsSales: "salesManager", financeAccounting: "controller",
  reportingAnalyst: "reportViewer", generalEmployee: "generalEmployee",
});
const ISS = "https://eos-api-nonprod.test/auth";
const AUD = "https://eos-api-nonprod.test";
const TENANT_KEY = "idn-proof";

test("EOS identity/session foundation, in PostgreSQL and through the in-process EOS API", { skip: SKIP, concurrency: 1 }, async (t) => {
  // NO PASSWORD FILE, anywhere in this process.
  delete process.env.SANDBOX_CREDENTIALS_FILE;
  assert.equal(process.env.SANDBOX_CREDENTIALS_FILE, undefined);

  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  let pool;
  let service;
  let localService;
  t.after(async () => {
    if (service) await service.close().catch(() => {});
    if (localService) await localService.close().catch(() => {});
    if (pool) await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const migrate = (dir) => spawnSync(process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", dir, ...(dir === "down" ? ["1"] : []), "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8" });
  const up = migrate("up");
  assert.equal(up.status, 0, up.stderr);

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { bindPrincipalEosIdentity, revokePrincipalEosIdentity, PolicyValidationError } = require("../lib/adminPolicy/policyCommands.js");
  const { hasAdministrationAuthority } = require("../lib/adminPolicy/administrationAuthority.js");
  const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
  const { readEosAuthConfig } = require("../lib/eosAuth/eosAuthConfig.js");
  const { startEosApi } = require("../lib/eosApi/server.js");
  const cli = require("../scripts/bindPrincipalEosIdentity.js");
  const harness = await import(pathToFileURL(join(REPO_ROOT, "scripts", "eosPersonaSession.mjs")).href);

  pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // ════════════════════ fixture: tenant, administering Principal, the 16 personas ════════════════════
  const { tenant } = await bootstrapTenant(repo, { key: TENANT_KEY, name: "EOS identity proof tenant", actorUid: "idn-proof" });
  const tenantId = tenant.id;
  const admin = await bootstrapAdministrator(repo, { tenantId, externalSubject: "idn-bootstrap-admin-uid", performedBy: "idn-proof" });
  const adminPrincipalId = admin.principal.id;
  // THE GOVERNED ROLE -> CAPABILITY MATRIX (the committed authority baseline), so every persona's decisions are
  // the real ones and the EOS-vs-Firebase comparison below compares a populated matrix, not an empty one.
  const baseline = require("../lib/adminPolicy/seed/roleCapabilityAuthorityBaseline.json");
  {
    const [caps, roles, existing] = await Promise.all([repo.listCapabilities(), repo.listRoles(tenantId), repo.listRoleCapabilities(tenantId)]);
    const capId = new Map(caps.map((c) => [c.key, c.id]));
    const roleId = new Map(roles.map((r) => [r.key, r.id]));
    const have = new Set(existing.map((e) => `${e.roleId}|${e.capabilityId}`));
    await repo.transact({ tenantId, uid: "idn-fixture" }, async (tx) => {
      for (const g of baseline.grants) {
        const r = roleId.get(g.roleKey); const c = capId.get(g.capabilityKey);
        if (!r || !c || have.has(`${r}|${c}`)) continue;
        have.add(`${r}|${c}`);
        await tx.grantRoleCapability({ roleId: r, capabilityId: c, grantedBy: "idn-fixture", grantedAt: new Date(Date.now() - 120_000).toISOString() });
      }
    });
    assert.ok((await q("SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1", [tenantId])).rows[0].n > 300);
  }

  const personas = new Map(); // key -> { principalId, employeeId, uid }
  for (const role of REGISTRY.roles) {
    const roleRecord = await repo.getRoleByKey(tenantId, ROLE_BY_PERSONA[role.key]);
    assert.ok(roleRecord, `seed defines ${ROLE_BY_PERSONA[role.key]}`);
    const principalId = await repo.transact({ tenantId, uid: "idn-fixture" }, async (tx) => {
      // Every persona -- reportingAnalyst included since D1 was corrected -- is keyed by its REGISTRY uid.
      assert.ok(role.uid, `${role.key}: the registry must record a uid`);
      const p = await tx.createPrincipal({ externalSubject: role.uid, identityProvider: "firebase", displayName: role.key });
      await tx.createTenantMembership(p.id);
      const v = await tx.bumpAccessVersion(p.id);
      await tx.createAssignment({ principalId: p.id, roleId: roleRecord.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "idn-fixture", grantedAt: new Date(Date.now() - 60_000).toISOString(), accessVersionAtGrant: v });
      return p.id;
    });
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
             VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [role.expectedEmployeeId, tenantId]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
             VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', 'idn-fixture', 'EOS identity proof fixture')`,
    [`epl-${role.key}`, tenantId, principalId, role.expectedEmployeeId]);
    personas.set(role.key, { principalId, employeeId: role.expectedEmployeeId, uid: role.uid });
  }
  assert.equal(personas.size, 16);
  // A SCOPED assignment, so "scope enforcement unchanged" compares something non-empty.
  await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by)
           VALUES ($1, 'RETAIL', 'ACTIVE', 'fixture', 'idn-fixture', 'idn-fixture')`, [tenantId]);
  const salesperson = await repo.getRoleByKey(tenantId, "salesperson");
  await repo.transact({ tenantId, uid: "idn-fixture" }, async (tx) => {
    const pid = personas.get("retailSales").principalId;
    const v = await tx.bumpAccessVersion(pid);
    await tx.createAssignment({ principalId: pid, roleId: salesperson.id, scopeType: "salesChannel", scopeValue: "RETAIL", status: "active",
      grantedBy: "idn-fixture", grantedAt: new Date(Date.now() - 60_000).toISOString(), accessVersionAtGrant: v });
  });

  // ════════════════════ the governed binding, through the operator CLI ════════════════════
  const cliOptions = (persona, apply) => ({
    environmentId: "platform-sandbox", connectionString: "never-read", tenantKey: TENANT_KEY, adminPrincipalId,
    persona, principalId: null, externalSubject: `nonprod-persona.${persona}`,
    reason: `Provision the EOS persona identity for ${persona} (EOS identity/session foundation proof)`, apply,
  });
  const cliDeps = { PostgresPolicyRepository, bindPrincipalEosIdentity, hasAdministrationAuthority };

  await t.test("all 16 canonical personas are addressable from the registry alone (every one records a uid)", () => {
    assert.equal(REGISTRY.roles.length, 16);
    for (const r of REGISTRY.roles) {
      assert.ok(typeof r.uid === "string" && r.uid.length > 0, `${r.key}: no registry uid`);
      assert.equal(r.accountExists, true, `${r.key}: account not recorded as existing`);
    }
    assert.equal(REGISTRY.roles.find((r) => r.key === "reportingAnalyst").uid, "Wv5msonPZyXtiy8ZOdJPxlnAboK2");
  });

  await t.test("the CLI: dry run writes nothing; apply binds all 16 with ONE audit event each; a re-run is NO_CHANGE; authority preserved", async () => {
    const before = await q("SELECT count(*)::int n FROM eos_policy.principal_identities");
    const dry = await cli.bindPrincipalEosIdentityRun(pool, cliOptions("dispatcher", false), cliDeps);
    assert.equal(dry.outcome, "PLANNED");
    assert.equal(dry.auditEvents.appended, 0);
    assert.equal((await q("SELECT count(*)::int n FROM eos_policy.principal_identities")).rows[0].n, before.rows[0].n);
    for (const key of personas.keys()) {
      const report = await cli.bindPrincipalEosIdentityRun(pool, cliOptions(key, true), cliDeps);
      assert.equal(report.outcome, "BOUND", key);
      assert.equal(report.principalId, personas.get(key).principalId, key);
      assert.equal(report.auditEvents.appended, 1, key);
      assert.deepEqual(cli.violations(report), [], key);
      assert.ok(Object.values(report.preserved).every(Boolean), `${key}: a preserved dimension moved`);
    }
    const again = await cli.bindPrincipalEosIdentityRun(pool, cliOptions("dispatcher", true), cliDeps);
    assert.equal(again.outcome, "NO_CHANGE");
    assert.equal(again.auditEvents.appended, 0);
    assert.equal((await q("SELECT count(*)::int n FROM eos_policy.principal_identities WHERE status='active'")).rows[0].n, 16);
    // Primary Firebase bindings untouched: every persona still resolves by its registry uid.
    for (const [key, p] of personas) {
      assert.equal((await repo.getPrincipalBySubject("firebase", p.uid)).id, p.principalId, key);
    }
  });

  await t.test("the CLI refuses before loading a driver: production, not-nonprod runtime, authority/credential flags, self-bind", () => {
    const base = ["--environment", "platform-sandbox", "--databaseUrlEnv", "X_DB", "--tenantKey", TENANT_KEY,
      "--adminPrincipalId", adminPrincipalId, "--persona", "dispatcher", "--reason", "Provision EOS identity for dispatcher persona in this proof run"];
    const env = { EOS_ENVIRONMENT: "nonprod", X_DB: "postgres://never:never@127.0.0.1:1/never" };
    const parse = (argv) => require("../scripts/measureEmployeeReferenceIntegrity.js").parseArgs(argv);
    assert.doesNotThrow(() => cli.assertInvocation(parse(base), env));
    assert.throws(() => cli.assertInvocation(parse(base.map((a) => (a === "platform-sandbox" ? "taylor-parts-production" : a))), env), /production/);
    assert.throws(() => cli.assertInvocation(parse(base), { ...env, EOS_ENVIRONMENT: "production" }), /nonprod/);
    assert.throws(() => cli.assertInvocation(parse(base.map((a) => (a === "platform-sandbox" ? "platform-certification" : a))), env), /frozen|ENVIRONMENT_FROZEN/);
    assert.throws(() => cli.assertInvocation(parse([...base, "--roles", "admin"]), env), /AUTHORITY_ARGUMENT_REFUSED/);
    assert.throws(() => cli.assertInvocation(parse([...base, "--signingKey", "x"]), env), /CREDENTIAL_ARGUMENT_REFUSED/);
    assert.throws(() => cli.assertInvocation(parse(base.map((a) => (a === "dispatcher" ? "root" : a))), env), /UNKNOWN_PERSONA/);
    // --persona derives the Principal from the registry alone: an operator-supplied Principal is refused.
    assert.throws(() => cli.assertInvocation(parse([...base, "--principalId", "p-anyone"]), env), /MODE_REQUIRED/);
    assert.throws(() => cli.assertInvocation(parse(["--environment", "platform-sandbox", "--databaseUrlEnv", "X_DB", "--tenantKey", TENANT_KEY,
      "--adminPrincipalId", adminPrincipalId, "--principalId", "p1", "--externalSubject", "nonprod-persona.owner",
      "--reason", "a long enough reason that names p1 as the target principal here"]), env), /PERSONA_SUBJECT_REFUSED/);
  });

  await t.test("the governed command: self-bind, second binding, a primary subject, a taken subject and an unauthorized actor are refused", async () => {
    const adminActor = { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] };
    await assert.rejects(bindPrincipalEosIdentity(repo, adminActor, { principalId: adminPrincipalId, externalSubject: "eos-self-0001", reason: "self" }), PolicyValidationError);
    await assert.rejects(bindPrincipalEosIdentity(repo, adminActor, { principalId: personas.get("dispatcher").principalId, externalSubject: "eos-other-0001", reason: "second" }), /already has an active EOS identity/);
    await assert.rejects(bindPrincipalEosIdentity(repo, adminActor, { principalId: adminPrincipalId === personas.get("dispatcher").principalId ? "x" : personas.get("dispatcher").principalId, externalSubject: "nonprod-persona.partsManager", reason: "taken" }), PolicyValidationError);
    const techActor = { tenantId, uid: personas.get("serviceTechnician").principalId, heldRoleKeys: ["technician"] };
    await assert.rejects(bindPrincipalEosIdentity(repo, techActor, { principalId: adminPrincipalId, externalSubject: "eos-sub-by-tech-1", reason: "not allowed" }));
    // DB-level fences, independent of the command.
    const pid = personas.get("generalEmployee").principalId;
    await assert.rejects(q(`INSERT INTO eos_policy.principal_identities (id, principal_id, identity_provider, external_subject, created_by, reason)
                            VALUES ('pi-x1', $1, 'firebase', 'fb-anything', 't', 'r')`, [pid]), /principal_identities_provider_is_eos/);
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider) VALUES ('p-eos-primary', 'eos-primary-subject', 'eos')`);
    await assert.rejects(q(`INSERT INTO eos_policy.principal_identities (id, principal_id, identity_provider, external_subject, created_by, reason)
                            VALUES ('pi-x2', 'p-eos-primary', 'eos', 'eos-primary-subject', 't', 'r')`), /PRINCIPAL_IDENTITY_IS_A_PRIMARY/);
    await assert.rejects(q("DELETE FROM eos_policy.principal_identities"), /APPEND_ONLY/);
    await assert.rejects(q("UPDATE eos_policy.principal_identities SET external_subject = 'eos-moved-0001'"), /APPEND_ONLY/);
  });

  await t.test("the migration's down step REFUSES while bindings exist, and the table survives", () => {
    const down = migrate("down");
    assert.notEqual(down.status, 0);
    assert.match(`${down.stdout}${down.stderr}`, /refusing to drop principal_identities/);
  });

  // ════════════════════ the real EOS API, in process ════════════════════
  const signing = generateKeyPairSync("ed25519");
  const credential = randomBytes(32).toString("base64url");
  const authEnv = {
    EOS_AUTH_VERIFY_KEYS: JSON.stringify({ "nonprod-idn": signing.publicKey.export({ format: "jwk" }) }),
    EOS_AUTH_ISSUER: ISS, EOS_AUTH_AUDIENCE: AUD,
    EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(signing.privateKey.export({ format: "jwk" })),
    EOS_AUTH_SIGNING_KID: "nonprod-idn",
    EOS_PERSONA_ISSUER_CREDENTIAL_SHA256: createHash("sha256").update(credential).digest("hex"),
  };
  const eosAuth = readEosAuthConfig(authEnv, "nonprod");
  // THE FAKE FIREBASE VERIFIER: "fb-token.<uid>" -> (firebase, uid). No network, no SDK.
  const firebaseCalls = [];
  const fakeFirebase = async (token) => {
    firebaseCalls.push(token);
    const m = /^fb-token\.(.+)$/.exec(token);
    if (!m) throw new Error("not a fake firebase token");
    return { externalSubject: m[1], identityProvider: "firebase" };
  };
  process.env.DATABASE_URL = dbUrl();
  const captured = [];
  const origLog = console.log; const origErr = console.error; const origWarn = console.warn;
  console.log = (...a) => { captured.push(a.join(" ")); }; console.error = (...a) => { captured.push(a.join(" ")); }; console.warn = (...a) => { captured.push(a.join(" ")); };
  t.after(() => { console.log = origLog; console.error = origErr; console.warn = origWarn; });
  service = await startEosApi({
    config: { port: 0, environment: "nonprod", allowedOrigins: [], identityProvider: "firebase", eosAuth },
    firebaseVerifyToken: fakeFirebase,
  });
  const base = `http://127.0.0.1:${service.port}`;
  const post = async (path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  };
  const issued = new Map(); // key -> token
  const session = (key) => harness.issueEosPersonaSession(key, { baseUrl: base, credential, env: {} });
  const asEos = (key, path, body) => post(path, body, { authorization: `Bearer ${issued.get(key)}` });
  const asFirebase = (key, path, body) => post(path, body, { authorization: `Bearer fb-token.${personas.get(key).uid}` });

  await t.test("12. the harness client obtains sessions WITHOUT SANDBOX_CREDENTIALS_FILE (credential passed explicitly)", async () => {
    await assert.rejects(harness.issueEosPersonaSession("dispatcher", { baseUrl: base, env: {} }), /NO_ISSUER_CREDENTIAL/);
    for (const key of personas.keys()) {
      const s = await session(key);
      assert.equal(s.personaKey, key);
      assert.equal(s.principalId, personas.get(key).principalId);
      assert.ok(Date.parse(s.expiresAt) - Date.now() <= 900_000 + 5_000);
      issued.set(key, s.token);
    }
    assert.equal(issued.size, 16);
  });

  await t.test("the persona route: credential required and compared, closed body, closed persona list, POST only", async () => {
    assert.equal((await post("/auth/nonprod/persona-session", { personaKey: "dispatcher" })).status, 401);
    assert.equal((await post("/auth/nonprod/persona-session", { personaKey: "dispatcher" }, { "x-eos-persona-issuer-credential": `${credential.slice(0, -1)}A` })).status, 401);
    assert.equal((await post("/auth/nonprod/persona-session", { personaKey: "dispatcher" }, { "x-eos-persona-issuer-credential": "short" })).status, 401);
    const auth = { "x-eos-persona-issuer-credential": credential };
    assert.equal((await post("/auth/nonprod/persona-session", { personaKey: "root" }, auth)).body.code, "UNKNOWN_PERSONA");
    assert.equal((await post("/auth/nonprod/persona-session", { personaKey: "dispatcher", subject: "anyone" }, auth)).status, 400);
    assert.equal((await post("/auth/nonprod/persona-session", { subject: "nonprod-persona.dispatcher" }, auth)).status, 400);
    assert.equal((await fetch(`${base}/auth/nonprod/persona-session`, { headers: auth })).status, 405);
    assert.equal((await post("/auth/anything-else", {}, auth)).status, 404);
    // No CORS answer: a browser page cannot drive the issuer.
    const pre = await fetch(`${base}/auth/nonprod/persona-session`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    assert.equal(pre.headers.get("access-control-allow-origin"), null);
  });

  await t.test("7. the persona route does not exist when the service environment is not nonprod", async () => {
    localService = await startEosApi({
      config: { port: 0, environment: "local", allowedOrigins: [], identityProvider: "firebase", eosAuth },
      firebaseVerifyToken: fakeFirebase,
    });
    // startEosApi shares the process-wide pool; this second listener proves only the route decision.
    const res = await fetch(`http://127.0.0.1:${localService.port}/auth/nonprod/persona-session`, {
      method: "POST", headers: { "content-type": "application/json", "x-eos-persona-issuer-credential": credential }, body: JSON.stringify({ personaKey: "dispatcher" }),
    });
    assert.equal(res.status, 404);
    // It stays open until teardown: its close() ends the process-wide pool the main service still uses.
  });

  await t.test("1 + 8 + 9. every persona's EOS token is accepted and resolves to ITS Principal and ITS existing Employee", async () => {
    for (const [key, p] of personas) {
      const r = await asEos(key, "/operations/experience", { operation: "resolveMyExperienceContext" });
      assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.result.principalId, p.principalId, key);
      assert.equal(r.body.result.employeeId, p.employeeId, key);
      assert.equal(r.body.result.tenantId, tenantId, key);
    }
    // No second Principal and no duplicate Employee exist.
    assert.equal((await q("SELECT count(*)::int n FROM eos_policy.principals WHERE identity_provider = 'eos'")).rows[0].n, 1, "only the deliberate DB-fence fixture");
    assert.equal((await q("SELECT count(*)::int n FROM eos_workforce.employees")).rows[0].n, 16);
  });

  await t.test("2 + 10. the Firebase path still works, and EOS and Firebase give IDENTICAL decisions for the same Principal", async () => {
    const PROBES = [
      ["/operations/experience", { operation: "resolveMyExperienceContext" }],
      ["/operations/inventory", { operation: "resolveMyCapabilities" }],
      ["/workforce/employees", { operation: "readMyWorkforceCapabilities" }],
      ["/workforce/employees", { operation: "readMyEmployeeProfile" }],
      ["/commercial/sales", { operation: "readMyCommercialCapabilities" }],
      ["/admin/policy", { operation: "listRoles", input: {} }],
      ["/operations/inventory", { operation: "readReorderQueue", input: {} }],
    ];
    let allowed = 0; let refused = 0;
    const gated = { allowed: 0, refused: 0 };
    for (const key of personas.keys()) {
      for (const [path, body] of PROBES) {
        const viaEos = await asEos(key, path, body);
        const viaFirebase = await asFirebase(key, path, body);
        assert.equal(viaEos.status, viaFirebase.status, `${key} ${body.operation}: status differs`);
        assert.deepEqual(viaEos.body, viaFirebase.body, `${key} ${body.operation}: body differs`);
        if (viaEos.status === 200) allowed += 1; else refused += 1;
        if (["listRoles", "readReorderQueue"].includes(body.operation)) gated[viaEos.status === 200 ? "allowed" : "refused"] += 1;
      }
      // The resolved operational context -- capabilities, held Roles, scope-qualified holdings -- is identical.
      const e = await resolveOperationalContext(repo, pool, { identityProvider: "eos", externalSubject: `nonprod-persona.${key}` });
      const f = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: personas.get(key).uid });
      assert.equal(e.principalContext.uid, f.principalContext.uid);
      assert.deepEqual([...e.capabilities].sort(), [...f.capabilities].sort(), `${key}: capabilities`);
      assert.deepEqual(e.principalContext.heldRoleKeys, f.principalContext.heldRoleKeys, `${key}: roles`);
      assert.deepEqual(JSON.parse(JSON.stringify(e.scopedHeld ?? null)), JSON.parse(JSON.stringify(f.scopedHeld ?? null)), `${key}: scoped`);
    }
    assert.ok(allowed > 0 && refused > 0, `the matrix must contain both outcomes (allowed=${allowed}, refused=${refused})`);
    // Capability-GATED operations are both allowed and refused across the personas -- a non-vacuous comparison.
    assert.ok(gated.allowed > 0 && gated.refused > 0, `gated outcomes: ${JSON.stringify(gated)}`);
    t.diagnostic(`EOS-vs-Firebase matrix: ${personas.size} personas x ${PROBES.length} probes; allowed=${allowed} refused=${refused}; gated=${JSON.stringify(gated)}`);
    const surfaces = await asEos("administrator", "/operations/experience", { operation: "resolveMyExperienceContext" });
    assert.ok(surfaces.body.result.surfaces.length > 0, "the administrator persona is offered surfaces through the EOS path");
    const retail = await resolveOperationalContext(repo, pool, { identityProvider: "eos", externalSubject: "nonprod-persona.retailSales" });
    assert.ok(retail.principalContext.scopedAssignments.length > 0, "the scoped assignment is visible through the EOS path");
    assert.ok(firebaseCalls.length > 0, "the Firebase half of the composite was exercised");
    assert.ok(firebaseCalls.every((tok) => tok.startsWith("fb-token.")), "an EOS token reached the Firebase verifier");
  });

  await t.test("3-6 at the API: a forged, foreign-issuer or garbage bearer is 401 on every transport", async () => {
    const CRM_OP = "listAccounts";
    const CYCLE_OP = Object.keys(require("../lib/eosOps/cycleCountOperations.js").EOS_CYCLE_COUNT_OPERATIONS)[0];
    const other = generateKeyPairSync("ed25519");
    const tok = require("../lib/eosAuth/eosAccessToken.js");
    const now = Math.floor(Date.now() / 1000);
    const forged = tok.signEosAccessToken({ kid: "nonprod-idn", privateKey: other.privateKey },
      { iss: ISS, aud: AUD, sub: "nonprod-persona.administrator", iat: now, exp: now + 600, jti: tok.newTokenId(), env: "nonprod" });
    const wrongIss = tok.signEosAccessToken({ kid: "nonprod-idn", privateKey: signing.privateKey },
      { iss: "https://elsewhere/auth", aud: AUD, sub: "nonprod-persona.administrator", iat: now, exp: now + 600, jti: tok.newTokenId(), env: "nonprod" });
    const expired = tok.signEosAccessToken({ kid: "nonprod-idn", privateKey: signing.privateKey },
      { iss: ISS, aud: AUD, sub: "nonprod-persona.administrator", iat: now - 2000, exp: now - 1200, jti: tok.newTokenId(), env: "nonprod" });
    for (const bearer of [forged, wrongIss, expired, "a.b.c"]) {
      for (const [path, body] of [["/operations/experience", { operation: "resolveMyExperienceContext" }], ["/admin/policy", { operation: "listRoles", input: {} }],
        ["/workforce/employees", { operation: "readMyWorkforceCapabilities" }], ["/commercial/sales", { operation: "readMyCommercialCapabilities" }],
        ["/crm/customer", { operation: CRM_OP, input: {} }], ["/operations/catalog", { operation: "searchParts", input: {} }],
        ["/operations/cycle-count", { operation: CYCLE_OP, input: {} }]]) {
        const r = await post(path, body, { authorization: `Bearer ${bearer}` });
        assert.equal(r.status, 401, `${path} ${body.operation}: ${r.status} ${JSON.stringify(r.body)}`);
      }
    }
  });

  await t.test("11. ON_LEAVE and TERMINATED Employees are refused through the EOS path (DQ-007), and restored by ACTIVE", async () => {
    const emp = personas.get("dispatcher").employeeId;
    for (const status of ["ON_LEAVE", "TERMINATED"]) {
      await q("UPDATE eos_workforce.employees SET employment_status = $1 WHERE id = $2", [status, emp]);
      const viaEos = await asEos("dispatcher", "/operations/experience", { operation: "resolveMyExperienceContext" });
      const viaFirebase = await asFirebase("dispatcher", "/operations/experience", { operation: "resolveMyExperienceContext" });
      assert.equal(viaEos.status, 403, status);
      assert.match(JSON.stringify(viaEos.body), /EMPLOYEE_NOT_ACCESS_ELIGIBLE/, status);
      assert.deepEqual(viaEos.body, viaFirebase.body, status);
      // And no NEW session can be issued for an ineligible persona.
      const denied = await post("/auth/nonprod/persona-session", { personaKey: "dispatcher" }, { "x-eos-persona-issuer-credential": credential });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, "PERSONA_NOT_ELIGIBLE");
    }
    await q("UPDATE eos_workforce.employees SET employment_status = 'ACTIVE' WHERE id = $1", [emp]);
    assert.equal((await asEos("dispatcher", "/operations/experience", { operation: "resolveMyExperienceContext" })).status, 200);
  });

  await t.test("revocation: a revoked EOS identity resolves to nobody, while the Firebase path is untouched", async () => {
    const pid = personas.get("warehouseAssociate").principalId;
    await revokePrincipalEosIdentity(repo, { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] }, { principalId: pid, reason: "proof: revoke warehouseAssociate EOS identity" });
    assert.equal((await asEos("warehouseAssociate", "/operations/experience", { operation: "resolveMyExperienceContext" })).status, 403);
    assert.equal((await asFirebase("warehouseAssociate", "/operations/experience", { operation: "resolveMyExperienceContext" })).status, 200);
    // A revoked subject is never re-issued, even to the same Principal.
    await assert.rejects(bindPrincipalEosIdentity(repo, { tenantId, uid: adminPrincipalId, heldRoleKeys: ["admin"] },
      { principalId: pid, externalSubject: "nonprod-persona.warehouseAssociate", reason: "rebind" }));
  });

  await t.test("14. audit rows name the right Principal: binding (admin actor), issuance (persona actor), and a mutation made with an EOS token", async () => {
    const binds = (await q("SELECT actor_uid, target_id, after FROM eos_policy.audit_events WHERE action = 'bindPrincipalEosIdentity'")).rows;
    assert.equal(binds.length, 16);
    for (const r of binds) assert.equal(r.actor_uid, adminPrincipalId);
    assert.deepEqual(new Set(binds.map((r) => r.target_id)), new Set([...personas.values()].map((p) => p.principalId)));
    const issues = (await q("SELECT actor_uid, target_kind, after FROM eos_policy.audit_events WHERE action = 'issueNonprodPersonaSession'")).rows;
    assert.ok(issues.length >= 16);
    for (const r of issues) {
      assert.equal(r.target_kind, "eosSession");
      assert.equal(r.actor_uid, personas.get(r.after.personaKey).principalId, r.after.personaKey);
    }
    // A governed mutation, authenticated ONLY by the administrator persona's EOS token.
    const role = await repo.getRoleByKey(tenantId, "reportViewer");
    const mut = await asEos("administrator", "/admin/policy", { operation: "updateRole", input: { roleId: role.id, description: `EOS-session proof ${Date.now()}`, reason: "EOS identity proof: administrator persona edits a Role description" } });
    assert.equal(mut.status, 200, JSON.stringify(mut.body));
    const row = (await q("SELECT actor_uid FROM eos_policy.audit_events WHERE action = 'updateRole' AND target_id = $1 ORDER BY occurred_at DESC LIMIT 1", [role.id])).rows[0];
    assert.equal(row.actor_uid, personas.get("administrator").principalId);
    // The same mutation by a non-administrator persona's EOS token is refused -- authority is PG's, not the token's.
    const denied = await asEos("generalEmployee", "/admin/policy", { operation: "updateRole", input: { roleId: role.id, description: "nope", reason: "should be refused for a general employee" } });
    assert.equal(denied.status, 403);
  });

  await t.test("15. runtime probe: the whole EOS path ran without loading any Firebase or Google module", () => {
    const loaded = Object.keys(require.cache).filter((p) => /node_modules[\\/](firebase-admin|firebase|@google-cloud|google-auth-library|gcp-metadata)[\\/]/.test(p));
    assert.deepEqual(loaded, [], `Firebase/Google modules were loaded: ${loaded.slice(0, 3).join(", ")}`);
  });

  await t.test("16. no token, credential or key material in any log line or audit row", async () => {
    const secrets = [credential, ...issued.values(), JSON.stringify(signing.privateKey.export({ format: "jwk" }).d)];
    const text = captured.join("\n");
    for (const s of secrets) assert.equal(text.includes(s), false, "a secret reached a log line");
    const audit = JSON.stringify((await q("SELECT * FROM eos_policy.audit_events")).rows);
    for (const s of secrets) assert.equal(audit.includes(s), false, "a secret reached the audit trail");
    assert.equal(audit.includes("eyJ"), false, "something token-shaped is in the audit trail");
  });
});
