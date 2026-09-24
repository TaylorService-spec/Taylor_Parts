// THE EOS PRINCIPAL EXPERIENCE CONTEXT -- against a REAL PostgreSQL database.
//
// Set POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails. It resets every
// schema the migrations create and re-migrates from clean, so -- like eosOpsPostgres.test.mjs and
// adminPolicyPostgres.test.mjs -- it is registered in the SAME serialized `test:adminPolicyPostgres`
// command. Three files sharing one schema must never run concurrently.
//
// ════════════════════ WHAT ONLY A REAL DATABASE CAN PROVE ════════════════════
//
//   1. EVERY capability the surface catalog names EXISTS in eos_policy.capabilities. This is the
//      anti-invention gate: a surface cannot be conjured by naming a capability nobody registered,
//      and the offline suite cannot tell the difference between a real id and a plausible one.
//   2. The Work Eligibility and Operational Scope rows are read through their REAL tables, under
//      their real CHECK constraints and their real target-existence trigger -- so a scope naming a
//      warehouse or an operating-company key that does not exist cannot even be written, let alone
//      projected.
//   3. The whole path end to end, through the HTTP transport: bearer -> verifier -> principal ->
//      tenant membership -> Role assignments -> role_capabilities -> employee link -> eos_workforce
//      dimensions -> surfaces.
//
// The capability GRANTS here are made directly against role_capabilities, exactly as
// eosOpsPostgres.test.mjs does: which named Role holds which capability in a deployed tenant is the
// job of the seed and the grant migrations, and is covered by their own suites. What this file
// varies is the capability set, and what it proves is the projection.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import {
  EXPERIENCE_SURFACES,
  resolveExperienceContext,
  surfaceCatalogCapabilityKeys,
} from "../lib/eosOps/experienceAuthority.js";
import { postgresPrincipalDimensionReader } from "../lib/eosOps/contextualAuthorization.js";
import { handleOperationsRequest } from "../lib/eosOps/eosOpsHttp.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-lane-v";
const COMPANY_ID = "sample-co";
const COMPANY_KEY = "sample-co-synthetic";
const WAREHOUSE = "SC-WH-MAIN";
const ACTOR = "uid-lane-v";
const actorFor = (tenantId) => ({ tenantId, uid: ACTOR });

let pool = null;
let roleCounter = 0;
const repoPool = () => (pool ??= new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 4 })));
const repo = () => new PostgresPolicyRepository(repoPool());

function migrateFromClean() {
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

/**
 * Clean database -> migrate -> the fixed world every test below shares:
 * a tenant, an ACTIVE operating company and its ACTIVE governed KEY, and one warehouse. The scope
 * trigger validates against both of those, so the world has to be real before a scope row can exist.
 */
async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const schema of declaredSchemas()) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  migrateFromClean();

  await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [TENANT]);
  await query(
    `INSERT INTO eos_policy.tenant_operating_companies
       (tenant_id, operating_company_id, status, source, established_by, updated_by)
     VALUES ($1, $2, 'ACTIVE', 'lane-v-test', $3, $3) ON CONFLICT DO NOTHING`,
    [TENANT, COMPANY_ID, ACTOR]);
  await query(
    `INSERT INTO eos_policy.tenant_operating_company_keys
       (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
     VALUES ($1, $2, $3, 'ACTIVE', 'NATIVE', 'lane-v-test', $4, $4) ON CONFLICT DO NOTHING`,
    [TENANT, COMPANY_ID, COMPANY_KEY, ACTOR]);
  await query(
    `INSERT INTO eos_ops.warehouses
       (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, $3, 'Main', 'Synthetic', 'ACTIVE', 'NATIVE', $4, $4) ON CONFLICT DO NOTHING`,
    [WAREHOUSE, TENANT, COMPANY_KEY, ACTOR]);
}

/**
 * A governed persona: Principal + ACTIVE membership + one Role holding `capabilities` + an active
 * assignment + (optionally) a linked Employee carrying Work Eligibility and Operational Scope rows.
 */
async function makePersona({ subject, capabilities = [], employeeId = null, eligibility = [], scopes = [] }) {
  const r = repo();
  const principalId = await r.transact(actorFor(TENANT), async (tx) => {
    const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(principal.id);
    return principal.id;
  });
  // The Role key deliberately does NOT contain the subject. `securityRoleKeys` is part of the
  // response, and a fixture that embedded the Firebase subject in a Role name would make the
  // "no external subject is disclosed" assertion below unfalsifiable.
  roleCounter += 1;
  const role = await r.transact(actorFor(TENANT), (tx) =>
    tx.createRole({ key: `laneVRole${roleCounter}`, name: `Lane V role ${roleCounter}`, description: null, origin: "CUSTOM", protected: false }));
  for (const key of capabilities) {
    const { rowCount } = await query(
      `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT $1, $2, $3, c.id, $4, $4, $4 FROM eos_policy.capabilities c WHERE c.key = $5`,
      [`rc_${role.id}_${key}`, TENANT, role.id, ACTOR, key]);
    // A grant that silently inserted nothing would make every later assertion vacuous.
    assert.equal(rowCount, 1, `no capability named "${key}" exists to grant`);
  }
  await r.transact(actorFor(TENANT), async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalId);
    return tx.createAssignment({
      principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: ACTOR, grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
    });
  });

  if (employeeId) {
    await query(
      `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id)
       VALUES ($1, $2, 'ACTIVE', $3) ON CONFLICT DO NOTHING`,
      [employeeId, TENANT, COMPANY_ID]);
    // OPERATOR_ASSERTED demands an author AND a reason -- the database enforces it, because the
    // caller that would forget is exactly the caller that is guessing.
    await query(
      `INSERT INTO eos_policy.employee_principal_links
         (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
       VALUES ($1, $2, $3, $4, $5, 'OPERATOR_ASSERTED', 'active', $6, 'Lane V persona fixture')`,
      [`epl_${subject}`, TENANT, principalId, employeeId, COMPANY_ID, ACTOR]);
    for (const code of eligibility) {
      await query(
        `INSERT INTO eos_workforce.employee_work_eligibility
           (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
         VALUES ($1, $2, $3, $4, now(), $5)`,
        [`we_${subject}_${code}`, TENANT, employeeId, code, ACTOR]);
    }
    for (const { scopeType, scopeId } of scopes) {
      await query(
        `INSERT INTO eos_workforce.employee_operational_scopes
           (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
         VALUES ($1, $2, $3, $4, $5, now(), $6)`,
        [`os_${subject}_${scopeType}_${scopeId}`, TENANT, employeeId, scopeType, scopeId, ACTOR]);
    }
  }
  return { principalId, subject };
}

const contextFor = (subject) =>
  resolveExperienceContext(repo(), repoPool(), {
    identityProvider: "firebase",
    externalSubject: subject,
    requestedTenantId: TENANT,
  });

// ════════════════════ 1. the anti-invention gate ════════════════════

test("EVERY capability the surface catalog names is a registered capability in this database", { skip: SKIP }, async () => {
  await reset();
  const declared = surfaceCatalogCapabilityKeys();
  const { rows } = await query("SELECT key FROM eos_policy.capabilities WHERE key = ANY($1::text[])", [declared]);
  const present = new Set(rows.map((r) => r.key));
  const missing = declared.filter((k) => !present.has(k));
  assert.deepEqual(
    missing,
    [],
    `The surface catalog names capabilities eos_policy.capabilities does not declare. A surface must be\nearned by a real, registered id -- never by a plausible-looking string:\n  ${missing.join("\n  ")}`,
  );
  assert.ok(declared.length >= 20, "the catalog should not have quietly shrunk to nothing");
  assert.ok(EXPERIENCE_SURFACES.length >= 20);
});

// ════════════════════ 2. the projection, over the real tables ════════════════════

test("a Principal with no qualifying Role resolves successfully with NO surfaces", { skip: SKIP }, async () => {
  await reset();
  await makePersona({ subject: "sbx-nobody" });
  const context = await contextFor("sbx-nobody");
  assert.equal(context.tenantId, TENANT);
  assert.deepEqual(context.surfaces, []);
  assert.equal(context.employeeId, null);
  // Authenticated, resolved, and holding nothing is an ANSWER -- not an error and not a fallback.
  assert.deepEqual(context.workEligibility, []);
  assert.deepEqual(context.operationalScopes, []);
});

test("WORK ELIGIBILITY read from eos_workforce decides the field workspace, not the Security Role", { skip: SKIP }, async () => {
  await reset();
  await makePersona({ subject: "sbx-tech-a", capabilities: ["workOrder.transition"], employeeId: "emp-tech-a", eligibility: ["SERVICE_TECHNICIAN"] });
  await makePersona({ subject: "sbx-tech-b", capabilities: ["workOrder.transition"], employeeId: "emp-tech-b" });

  const a = await contextFor("sbx-tech-a");
  const b = await contextFor("sbx-tech-b");
  // Same capability, same Role shape, same employment status. ONE governed workforce row apart.
  assert.deepEqual(a.workEligibility, ["SERVICE_TECHNICIAN"]);
  assert.deepEqual(b.workEligibility, []);
  assert.equal(a.surfaces.includes("field.myWorkOrders"), true);
  assert.equal(b.surfaces.includes("field.myWorkOrders"), false);
  assert.equal(b.surfaces.includes("service.workOrders"), true, "the unpredicated surface is unaffected");
});

test("OPERATIONAL SCOPE read from eos_workforce opens the Reorder queue, and its absence closes it", { skip: SKIP }, async () => {
  await reset();
  await makePersona({
    subject: "sbx-parts-manager", capabilities: ["reorder.request.read"], employeeId: "emp-parts-manager",
    eligibility: ["PARTS_OPERATIONS"], scopes: [{ scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }],
  });
  await makePersona({ subject: "sbx-tech-q", capabilities: ["reorder.request.read"], employeeId: "emp-tech-q", eligibility: ["SERVICE_TECHNICIAN"] });

  const manager = await contextFor("sbx-parts-manager");
  const technician = await contextFor("sbx-tech-q");
  assert.deepEqual(manager.operationalScopes, [{ scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }]);
  assert.equal(manager.surfaces.includes("inventory.reorderQueue"), true);
  // CX-04: the technician HOLDS reorder.request.read. The scope predicate alone refuses the queue,
  // which is exactly what stops the unscoped capability becoming queue visibility.
  assert.equal(technician.surfaces.includes("inventory.reorderQueue"), false);
});

test("a WAREHOUSE scope and the WAREHOUSE_OPERATIONS qualification are BOTH required for cycle counting", { skip: SKIP }, async () => {
  await reset();
  await makePersona({
    subject: "sbx-wh-associate", capabilities: ["inventory.cycleCount.create"], employeeId: "emp-wh-associate",
    eligibility: ["WAREHOUSE_OPERATIONS"], scopes: [{ scopeType: "WAREHOUSE", scopeId: WAREHOUSE }],
  });
  await makePersona({
    subject: "sbx-wh-noscope", capabilities: ["inventory.cycleCount.create"], employeeId: "emp-wh-noscope",
    eligibility: ["WAREHOUSE_OPERATIONS"],
  });
  await makePersona({
    subject: "sbx-wh-noqual", capabilities: ["inventory.cycleCount.create"], employeeId: "emp-wh-noqual",
    scopes: [{ scopeType: "WAREHOUSE", scopeId: WAREHOUSE }],
  });

  assert.equal((await contextFor("sbx-wh-associate")).surfaces.includes("inventory.cycleCount.count"), true);
  assert.equal((await contextFor("sbx-wh-noscope")).surfaces.includes("inventory.cycleCount.count"), false);
  assert.equal((await contextFor("sbx-wh-noqual")).surfaces.includes("inventory.cycleCount.count"), false);
});

test("an ENDED dimension row is not a current authority", { skip: SKIP }, async () => {
  await reset();
  await makePersona({ subject: "sbx-left", capabilities: ["workOrder.transition"], employeeId: "emp-left", eligibility: ["SERVICE_TECHNICIAN"] });
  assert.equal((await contextFor("sbx-left")).surfaces.includes("field.myWorkOrders"), true);

  await query(
    `UPDATE eos_workforce.employee_work_eligibility SET effective_to = now(), ended_by = $1, ended_at = now()
      WHERE tenant_id = $2 AND employee_id = 'emp-left'`, [ACTOR, TENANT]);

  const after = await contextFor("sbx-left");
  assert.deepEqual(after.workEligibility, [], "history is not authority");
  assert.equal(after.surfaces.includes("field.myWorkOrders"), false);
  assert.equal(after.surfaces.includes("service.workOrders"), true);
});

test("a scope naming a target that does not exist cannot be written, so it can never be projected", { skip: SKIP }, async () => {
  await reset();
  await makePersona({ subject: "sbx-scope-guard", capabilities: [], employeeId: "emp-scope-guard" });
  await assert.rejects(
    () => query(
      `INSERT INTO eos_workforce.employee_operational_scopes
         (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
       VALUES ('os-bad', $1, 'emp-scope-guard', 'WAREHOUSE', 'NO-SUCH-WAREHOUSE', now(), $2)`,
      [TENANT, ACTOR]),
    /does not exist in this tenant/,
  );
  await assert.rejects(
    () => query(
      `INSERT INTO eos_workforce.employee_operational_scopes
         (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
       VALUES ('os-bad-2', $1, 'emp-scope-guard', 'REORDER_QUEUE', 'no-such-company', now(), $2)`,
      [TENANT, ACTOR]),
    /is not ACTIVE in this tenant/,
  );
});

test("the dimension reader reads CURRENT rows only, ordered, and never a Firebase subject", { skip: SKIP }, async () => {
  await reset();
  await makePersona({
    subject: "sbx-dimensions", capabilities: [], employeeId: "emp-dimensions",
    eligibility: ["WAREHOUSE_OPERATIONS", "SERVICE_TECHNICIAN"],
    scopes: [{ scopeType: "WAREHOUSE", scopeId: WAREHOUSE }, { scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }],
  });
  const reader = postgresPrincipalDimensionReader(repoPool());
  const { rows } = await query(
    "SELECT principal_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = 'emp-dimensions'", [TENANT]);
  const principalId = rows[0].principal_id;
  assert.equal(await reader.linkedEmployeeId(TENANT, principalId), "emp-dimensions");
  assert.deepEqual(await reader.listWorkEligibility(TENANT, "emp-dimensions"), ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]);
  assert.deepEqual(await reader.listOperationalScopes(TENANT, "emp-dimensions"), [
    { scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY },
    { scopeType: "WAREHOUSE", scopeId: WAREHOUSE },
  ]);
});

// ════════════════════ 3. the whole path, through the transport ════════════════════

test("POST /operations/experience answers the CALLER'S OWN context and nothing about anyone else", { skip: SKIP }, async () => {
  await reset();
  await makePersona({
    subject: "sbx-http", capabilities: ["inventory.stock.receive", "inventory.catalog.read"],
    employeeId: "emp-http", eligibility: ["PARTS_OPERATIONS"],
    scopes: [{ scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }],
  });

  const options = {
    reader: repo(),
    pool: repoPool(),
    // The verifier returns a SUBJECT and nothing else -- no claim is read as authority anywhere on
    // this path, which is the property the whole architecture rests on.
    verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }),
  };
  const response = await handleOperationsRequest(options, {
    method: "POST",
    url: "/operations/experience",
    headers: { authorization: "Bearer sbx-http", "x-eos-tenant": TENANT },
    body: JSON.stringify({ operation: "resolveMyExperienceContext" }),
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.operation, "resolveMyExperienceContext");
  assert.deepEqual(body.result.surfaces, ["inventory.catalog", "receiving.checkIn"]);
  assert.equal(body.result.employeeId, "emp-http");
  assert.deepEqual(body.result.workEligibility, ["PARTS_OPERATIONS"]);
  assert.equal(body.result.tenantId, TENANT);
  // It takes no selector, so it cannot describe anybody else, and it discloses no Firebase subject.
  assert.equal(JSON.stringify(body).includes("sbx-http"), false);
});

test("an unknown subject is FORBIDDEN, not an empty experience", { skip: SKIP }, async () => {
  await reset();
  const response = await handleOperationsRequest(
    { reader: repo(), pool: repoPool(), verifyToken: async (t) => ({ externalSubject: t, identityProvider: "firebase" }) },
    {
      method: "POST", url: "/operations/experience",
      headers: { authorization: "Bearer nobody-at-all", "x-eos-tenant": TENANT },
      body: JSON.stringify({ operation: "resolveMyExperienceContext" }),
    },
  );
  // A refusal and "you hold nothing" must never look the same: the client renders one as a failure
  // it can retry and the other as an answer.
  assert.equal(response.status, 403);
  assert.match(response.body, /UNKNOWN_PRINCIPAL/);
});

test("no bearer token reaches no database at all", { skip: SKIP }, async () => {
  const response = await handleOperationsRequest(
    { reader: null, pool: null, verifyToken: async () => { throw new Error("must not be called"); } },
    { method: "POST", url: "/operations/experience", headers: {}, body: JSON.stringify({ operation: "resolveMyExperienceContext" }) },
  );
  assert.equal(response.status, 401);
});

test.after(async () => { if (pool) await pool.end(); });
