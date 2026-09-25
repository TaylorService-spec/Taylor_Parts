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
  EXPERIENCE_SURFACE_GAPS,
  experienceSurfaceGapViolations,
  surfaceCatalogCapabilityKeys,
} from "../lib/eosOps/experienceAuthority.js";
import { postgresPrincipalDimensionReader } from "../lib/eosOps/contextualAuthorization.js";
import { handleOperationsRequest } from "../lib/eosOps/eosOpsHttp.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// The CLIENT's real navigation module and real projection, imported across the package boundary the
// same way experienceAuthority.test.mjs does it: there is no shared package, and a hand-mirrored copy
// of the nav tree would be a second nav tree. Section 5 needs the real predicate, not a description.
//
// `pathToFileURL` rather than `new URL(...)` on purpose: this module binds a const named `URL` below
// (the database connection string), which shadows the global for the whole module scope.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientModule = (...segments) =>
  pathToFileURL(path.join(here, "..", "..", "field-ops-app-vite", "src", ...segments)).href;
const { NAV_DOMAINS, isDomainVisible, isNavItemVisible } =
  await import(clientModule("navigation", "navConfig.js"));
const { buildNavigationAuthority, EXPERIENCE_STATE } =
  await import(clientModule("access", "experienceContext.js"));

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

// ════════════════════ 1b. THE GATE, POINTED AT THE GAP REGISTER ════════════════════
//
// The anti-invention gate above asks whether a GRANTED surface names a real capability. Nothing
// asked the mirror question about a GAP -- and a gap is a claim about this same table.
//
// `commercial.agreements` stated "No salesAgreement.* capability is registered in
// eos_policy.capabilities". Four were, under Object `salesAgreement`, granted to six Roles including
// the `salesperson` Role held by the very persona the entry named. The register carried that
// sentence through the capability being registered, through the grants, and through a read service
// being built on it, because prose is not checkable and nothing here was checking.
//
// It is checkable now, in the one place it can be: against the real table.
//
//   VOCABULARY  the prefixes it says are absent must BE absent. A capability appearing under one of
//               them has falsified the reason, and this fails on the migration that registers it
//               rather than whenever somebody next reads the paragraph.
//   DESTINATION the capability it says already governs the work must be REGISTERED here.
//
// REGISTRATION IS WHAT THIS DATABASE CAN HONESTLY ANSWER, AND GRANTS ARE NOT. `reset()` re-migrates
// from clean and this suite makes its grants per-test on purpose -- the header above says so: which
// named Role holds which capability in a deployed tenant is the seed's job, not a migration's. So
// asserting "and somebody holds it" here would measure the absence of a seed, not the truth of the
// gap. The other half of the DESTINATION claim -- that the capability is actually HELD -- is checked
// in experienceAuthority.test.mjs against adminPolicy/seed/roleCapabilityAuthorityBaseline.json, the
// recorded nonprod measurement, which is the artifact in this repository where that IS measurable.
test("EVERY declared gap's claim about this database is TRUE", { skip: SKIP }, async () => {
  await reset();
  assert.deepEqual(experienceSurfaceGapViolations(), [], "the gap register is malformed before it is even measured");

  const { rows } = await query("SELECT key FROM eos_policy.capabilities");
  const registered = rows.map((r) => r.key);

  const falsified = [];
  for (const gap of EXPERIENCE_SURFACE_GAPS) {
    if (gap.kind === "VOCABULARY") {
      for (const prefix of gap.absentCapabilityPrefixes ?? []) {
        const found = registered.filter((k) => k.startsWith(prefix));
        if (found.length > 0) {
          falsified.push(`${gap.key}: claims nothing is registered under "${prefix}", but this database declares ${found.join(", ")}`);
        }
      }
    }
    if (gap.kind === "DESTINATION" && !registered.includes(gap.governedBy)) {
      falsified.push(`${gap.key}: claims ${gap.governedBy} already governs it, but eos_policy.capabilities does not declare it -- this is a VOCABULARY gap`);
    }
  }
  assert.deepEqual(falsified, [], `A declared gap states something this database contradicts:\n  ${falsified.join("\n  ")}`);
});

// THE CORRECTED ENTRY, MEASURED RATHER THAN DESCRIBED. Pinned separately from the loop above so the
// regression has a test carrying its name: the four ids the old reason said did not exist are here,
// registered under the `salesAgreement` Object, in a database built only by the migrations.
test("the salesAgreement vocabulary the old commercial.agreements reason denied is REGISTERED", { skip: SKIP }, async () => {
  await reset();
  const { rows } = await query(
    `SELECT key, object_key, action_kind FROM eos_policy.capabilities
      WHERE key LIKE 'salesAgreement.%' ORDER BY key`,
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    ["salesAgreement.accept", "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft"],
    "the four Sales Agreement capabilities are not registered here -- if they genuinely went away, the gap reverts to a VOCABULARY one",
  );
  for (const row of rows) {
    assert.equal(row.object_key, "salesAgreement", `${row.key} is not registered under the salesAgreement Object`);
  }
  assert.deepEqual(
    rows.map((r) => r.action_kind).sort(),
    ["BUSINESS_ACTION", "CREATE", "EDIT", "READ"],
    "the four kinds the old reason said the vocabulary could not express",
  );
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

// ════════════════════ 5. THE ADMINISTRATION PERSONA PROOFS (Owner ruling, Wave 9 / Lane AH) ════════════════════
//
// WHAT THIS SECTION PROVES, and it is the question a navigation cutover actually turns on:
//
//   admin           -> the Administration security surfaces are VISIBLE
//   owner           -> VISIBLE
//   dispatcher      -> ABSENT
//   technician      -> ABSENT
//   partsAssociate  -> ABSENT
//
// ...decided end to end, through the real path and nothing simulated:
//
//   role_capabilities (REAL rows, REAL migrated schema)
//        -> resolveExperienceContext        (the real resolver, real Principal, real membership)
//        -> buildNavigationAuthority        (the real client projection)
//        -> isNavItemVisible                (the real client predicate, on the real NAV_DOMAINS)
//
// THE NEGATIVES ARE NOT VACUOUS, which is the whole reason the capability sets below are the FULL
// measured ones rather than a convenient handful. `dispatcher` resolves 29 real capabilities and is
// still refused every Administration security destination -- so ABSENT means "holds a great deal of
// governed authority and none of it is this", not "holds nothing and therefore sees nothing". The
// four Administration reads are the only difference between the positives and the negatives.
//
// NO EMPLOYEE IS LINKED TO ANY OF THE FIVE, deliberately. The Administration surfaces carry no
// WORK_ELIGIBILITY and no OPERATIONAL_SCOPE predicate, so they must resolve for a Principal that is
// not an Employee at all -- which is exactly the shape a governed Owner persona has.

/**
 * eos-policy-nonprod (dpg-dah48qht0dsc73egnml0-a), read-only, 2026-09-24:
 *
 *   SELECT r.key, c.key FROM eos_policy.roles r
 *     JOIN eos_policy.role_capabilities rc ON rc.role_id = r.id
 *     JOIN eos_policy.capabilities c       ON c.id = rc.capability_id
 *    WHERE r.key IN ('admin','owner','dispatcher','technician','partsAssociate');
 *
 * Counts: admin 66, owner 47, dispatcher 29, partsAssociate 10, technician 3 -- asserted below, so a
 * transcription that dropped a row cannot pass unnoticed.
 *
 * WHY A PINNED FIXTURE AND NOT THE LOCAL DATABASE'S OWN GRANTS. This file migrates from clean, and
 * the grant migrations run BEFORE any tenant Role exists, so a locally-migrated database has these
 * four Administration reads registered and held by NOBODY (measured: 0 roles each). The population a
 * principal actually meets is nonprod's, and pinning it is what makes the proof about the real world
 * instead of about an empty one. The GRANTS are then made directly against role_capabilities, which
 * is this file's established pattern and stated posture: what it varies is the capability set, and
 * what it proves is the projection.
 */
const MEASURED_NONPROD_ROLE_CAPABILITIES = Object.freeze({
  admin: Object.freeze([
    "admin.accessRequest.decide", "admin.credentialReset.initiate", "admin.dataImport.execute",
    "admin.employeeJobRole.write", "admin.employeeOperationalScope.write", "admin.employeeProfile.write",
    "admin.employeeWorkEligibility.write", "admin.principalAccess.read", "admin.roleAssignment.write",
    "admin.securityPolicy.read", "admin.userStatus.write", "audit.event.read",
    "customer.governedField.write", "customer.record.create", "customer.record.read",
    "customer.record.update", "employee.record.read", "equipment.compatibility.view",
    "equipment.install", "equipment.model.manage", "finance.adjustment.record", "finance.invoice.issue",
    "finance.invoice.read", "finance.payment.apply", "finance.payment.read", "finance.refund.record",
    "fulfillment.coordinatedVisit.read", "inventory.action.read", "inventory.catalog.activate",
    "inventory.catalog.manage", "inventory.catalog.read", "inventory.cycleCount.cancel",
    "inventory.cycleCount.create", "inventory.cycleCount.reconcile", "inventory.cycleCount.submit",
    "inventory.manufacturer.read", "inventory.placement.record", "inventory.serializedAsset.read",
    "inventory.stock.receive", "inventory.stock.relocate", "inventory.transaction.read",
    "inventory.transfer.cancel", "inventory.transfer.create", "inventory.transfer.dispatch",
    "inventory.transfer.receive", "opportunity.createSalesOrder", "opportunity.read",
    "opportunity.write", "reorder.purchaseOrder.create", "reorder.purchaseOrder.read",
    "reorder.request.create.manual", "reorder.request.create.system", "reorder.request.read",
    "salesAgreement.accept", "salesAgreement.create", "salesAgreement.read",
    "salesAgreement.updateDraft", "salesOrder.read", "salesOrder.write", "warehouse.record.read",
    "warehouse.transferOrder.read", "workOrder.create", "workOrder.lifecycle.cancel",
    "workOrder.lifecycle.dispatch", "workOrder.transition", "workflowDefinition.read",
  ]),
  owner: Object.freeze([
    "admin.accessRequest.decide", "admin.credentialReset.initiate", "admin.employeeJobRole.write",
    "admin.employeeOperationalScope.write", "admin.employeeProfile.write",
    "admin.employeeWorkEligibility.write", "admin.principalAccess.read", "admin.roleAssignment.write",
    "admin.securityPolicy.read", "admin.userStatus.write", "audit.event.read",
    "customer.record.create", "customer.record.read", "customer.record.update", "employee.record.read",
    "equipment.compatibility.view", "finance.adjustment.record", "finance.invoice.issue",
    "finance.invoice.read", "finance.payment.apply", "finance.payment.read", "finance.refund.record",
    "fulfillment.coordinatedVisit.read", "inventory.action.read", "inventory.catalog.manage",
    "inventory.catalog.read", "inventory.manufacturer.read", "inventory.serializedAsset.read",
    "inventory.transaction.read", "inventory.transfer.create", "opportunity.read", "opportunity.write",
    "reorder.purchaseOrder.create", "reorder.purchaseOrder.read", "reorder.request.create.manual",
    "reorder.request.create.system", "reorder.request.read", "salesAgreement.create",
    "salesAgreement.read", "salesAgreement.updateDraft", "salesOrder.read", "salesOrder.write",
    "warehouse.record.read", "warehouse.transferOrder.read", "workOrder.create", "workOrder.transition",
    "workflowDefinition.read",
  ]),
  dispatcher: Object.freeze([
    "customer.record.create", "customer.record.read", "customer.record.update",
    "fulfillment.coordinatedVisit.read", "inventory.action.read", "inventory.catalog.read",
    "inventory.manufacturer.read", "inventory.stock.receive", "inventory.transaction.read",
    "opportunity.createSalesOrder", "opportunity.read", "opportunity.write",
    "reorder.purchaseOrder.create", "reorder.purchaseOrder.read", "reorder.request.create.manual",
    "reorder.request.create.system", "reorder.request.read", "salesAgreement.accept",
    "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft", "salesOrder.read",
    "salesOrder.write", "warehouse.record.read", "warehouse.transferOrder.read", "workOrder.create",
    "workOrder.lifecycle.cancel", "workOrder.lifecycle.dispatch", "workOrder.transition",
  ]),
  technician: Object.freeze([
    "reorder.request.read", "workOrder.lifecycle.complete", "workOrder.transition",
  ]),
  partsAssociate: Object.freeze([
    "customer.record.read", "finance.invoice.read", "finance.payment.read", "inventory.catalog.read",
    "inventory.manufacturer.read", "inventory.serializedAsset.read", "inventory.transaction.read",
    "salesOrder.read", "workOrder.create", "workOrder.transition",
  ]),
});

const MEASURED_COUNTS = Object.freeze({
  admin: 66, owner: 47, dispatcher: 29, partsAssociate: 10, technician: 3,
});

/** The five governed-configuration Administration destinations, keyed as navConfig keys them. */
const ADMINISTRATION_SECURITY_DESTINATIONS = Object.freeze([
  "overview", "rolesPermissions", "objects", "workflows", "permissionPreview",
]);

const administrationDomain = () => NAV_DOMAINS.find((d) => d.key === "administration");
const administrationItem = (key) => administrationDomain().subnav.find((i) => i.key === key);

/** The real client projection, built from a real resolved context. Nothing is hand-assembled. */
const navigationAuthorityFor = (context) =>
  buildNavigationAuthority({ state: EXPERIENCE_STATE.READY, context });

/** The EOS source, as the shell supplies it. `role` and `operationalRoles` are the legacy inputs. */
const eosSession = (authority, { role = "admin", operationalRoles = [], employmentStatus = "ACTIVE" } = {}) => ({
  role,
  context: { operationalRoles, employmentStatus, eosNavigationAuthority: authority },
});

async function resolveFivePersonas() {
  await reset();
  const resolved = {};
  for (const [roleKey, capabilities] of Object.entries(MEASURED_NONPROD_ROLE_CAPABILITIES)) {
    assert.equal(capabilities.length, MEASURED_COUNTS[roleKey],
      `the pinned ${roleKey} capability set no longer matches its measured count`);
    await makePersona({ subject: `ah-persona-${roleKey}`, capabilities });
    resolved[roleKey] = await contextFor(`ah-persona-${roleKey}`);
  }
  return resolved;
}

test("ADMIN and OWNER reach every Administration security surface; the other three reach none", { skip: SKIP }, async () => {
  const resolved = await resolveFivePersonas();

  const ADMINISTRATION_SECURITY_SURFACES = [
    "administration.overview", "administration.rolesPermissions", "administration.objects",
    "administration.workflows", "administration.permissionPreview",
  ];

  for (const roleKey of ["admin", "owner"]) {
    const surfaces = new Set(resolved[roleKey].surfaces);
    for (const key of ADMINISTRATION_SECURITY_SURFACES) {
      assert.equal(surfaces.has(key), true, `${roleKey} did not earn ${key}`);
    }
    // Neither persona is an Employee, and the surfaces resolved anyway -- the Administration reads
    // carry no workforce predicate, which is what makes a non-Employee Owner persona coherent.
    assert.equal(resolved[roleKey].employeeId, null);
  }

  for (const roleKey of ["dispatcher", "technician", "partsAssociate"]) {
    const surfaces = new Set(resolved[roleKey].surfaces);
    for (const key of ADMINISTRATION_SECURITY_SURFACES) {
      assert.equal(surfaces.has(key), false, `${roleKey} was offered ${key}`);
    }
    // NOT VACUOUS: each of the three earns real destinations from its real capabilities. A negative
    // that holds nothing proves nothing.
    assert.ok(surfaces.size > 0, `${roleKey} earned no surfaces at all -- the negative is vacuous`);
  }

  // The sharpest form of the contrast: the ONLY reason admin and owner differ from the three is the
  // Administration read set. dispatcher holds 29 capabilities and not one of them is one of these.
  const ADMINISTRATION_READS = [
    "admin.securityPolicy.read", "workflowDefinition.read", "admin.principalAccess.read",
    "audit.event.read",
  ];
  for (const roleKey of ["dispatcher", "technician", "partsAssociate"]) {
    for (const capabilityKey of ADMINISTRATION_READS) {
      assert.equal(MEASURED_NONPROD_ROLE_CAPABILITIES[roleKey].includes(capabilityKey), false);
    }
  }
});

test("projected onto the REAL client navigation, the five destinations follow exactly that split", { skip: SKIP }, async () => {
  const resolved = await resolveFivePersonas();

  for (const roleKey of ["admin", "owner"]) {
    const session = eosSession(navigationAuthorityFor(resolved[roleKey]));
    for (const key of ADMINISTRATION_SECURITY_DESTINATIONS) {
      const item = administrationItem(key);
      assert.ok(item, `Administration has no destination "${key}"`);
      assert.equal(isNavItemVisible(item, session.role, [], session.context), true,
        `${roleKey} cannot open Administration > ${key}`);
    }
    assert.equal(isDomainVisible(administrationDomain(), session.role, [], session.context), true);
  }

  for (const roleKey of ["dispatcher", "technician", "partsAssociate"]) {
    const session = eosSession(navigationAuthorityFor(resolved[roleKey]), { role: roleKey });
    for (const key of ADMINISTRATION_SECURITY_DESTINATIONS) {
      assert.equal(isNavItemVisible(administrationItem(key), session.role, [], session.context), false,
        `${roleKey} was offered Administration > ${key}`);
    }
  }

  // THE OVERVIEW IS NOT A DOOR OF ITS OWN, proved at the destination level: a principal holding only
  // Data Import authority reaches Data Import and is still refused the Administration index. This is
  // the case an `alwaysVisible` index would get wrong.
  await makePersona({ subject: "ah-persona-importer", capabilities: ["admin.dataImport.execute"] });
  const importer = eosSession(navigationAuthorityFor(await contextFor("ah-persona-importer")), { role: "technician" });
  assert.equal(isNavItemVisible(administrationItem("dataImport"), importer.role, [], importer.context), true);
  assert.equal(isNavItemVisible(administrationItem("overview"), importer.role, [], importer.context), false);
});

test("NO Firebase role and NO operationalRoles value changes ANY of those answers", { skip: SKIP }, async () => {
  const resolved = await resolveFivePersonas();

  // Every legacy input the old model decided from, swung through its whole range -- including the
  // two values that used to open these five destinations outright (PLACEHOLDER_DEFAULT_ROLES is
  // ["admin","dispatcher"]), a null, and a string nobody defined.
  const LEGACY_ROLES = ["admin", "dispatcher", "technician", null, "not-a-real-role-\u0000junk"];
  const LEGACY_OPERATIONAL_ROLES = [
    [],
    ["dispatcher", "technician", "admin"],
    ["warehouseManager", "partsManager", "salesperson", "generalManager", "owner"],
  ];
  const LEGACY_LEGACY_KEYS = [[], ["inventory", "technicians", "dispatch"]];

  for (const [roleKey, context] of Object.entries(resolved)) {
    const authority = navigationAuthorityFor(context);
    const expected = Object.fromEntries(ADMINISTRATION_SECURITY_DESTINATIONS.map((key) => [
      key,
      isNavItemVisible(administrationItem(key), "admin", [], eosSession(authority).context),
    ]));
    // The baseline itself must be the governed answer, not an accident: admin/owner true, rest false.
    const positive = roleKey === "admin" || roleKey === "owner";
    for (const key of ADMINISTRATION_SECURITY_DESTINATIONS) {
      assert.equal(expected[key], positive, `baseline wrong for ${roleKey} > ${key}`);
    }

    for (const role of LEGACY_ROLES) {
      for (const operationalRoles of LEGACY_OPERATIONAL_ROLES) {
        for (const allowedLegacyKeys of LEGACY_LEGACY_KEYS) {
          for (const employmentStatus of ["ACTIVE", "TERMINATED", "ON_LEAVE"]) {
            const session = eosSession(authority, { role, operationalRoles, employmentStatus });
            for (const key of ADMINISTRATION_SECURITY_DESTINATIONS) {
              assert.equal(
                isNavItemVisible(administrationItem(key), role, allowedLegacyKeys, session.context),
                expected[key],
                `${roleKey} > ${key} moved when users/{uid}.role became ${JSON.stringify(role)} `
                + `and operationalRoles became ${JSON.stringify(operationalRoles)}`,
              );
            }
          }
        }
      }
    }
  }
});

// ════════════════════ 6. PERMISSION PREVIEW IS A PRINCIPAL READ, NOT A POLICY-CONFIGURATION READ ════════════════════
//
// Owner ruling, Wave 10 (SUPERSEDES the Wave 9 ruling section 5 was written under). The surface
// `administration.permissionPreview` answers to `admin.principalAccess.read`, because it READS AND
// EVALUATES A PRINCIPAL'S EFFECTIVE ACCESS. `administration.rolesPermissions` and
// `administration.objects` expose the policy CONFIGURATION -- the Role x Object x action matrix --
// and keep `admin.securityPolicy.read`.
//
// WHY THIS SECTION EXISTS AT ALL, when section 5 already proves admin/owner/dispatcher. Because in
// every population that exists today the two capabilities are held by exactly the same two Roles, so
// section 5 passes IDENTICALLY under either ruling and can therefore prove nothing about which one
// is in force. "Current grant populations being coincidentally identical does not justify conflating
// the authorities" -- and the only way to tell two conflated authorities from two separate ones is to
// build the principals the real population does not contain and watch the answers cross.
//
// THE CROSSED PAIR, resolved through the real path and nothing simulated:
//
//   holds securityPolicy.read, NOT principalAccess.read   -> Roles & Permissions and Objects OPEN,
//                                                            Permission Preview REFUSED
//   holds principalAccess.read, NOT securityPolicy.read   -> Permission Preview OPEN,
//                                                            Roles & Permissions and Objects REFUSED
//
// Each one is refused something and granted something, so neither negative is the trivial "holds
// nothing, sees nothing". NO GRANT POPULATION IS MUTATED ANYWHERE REAL: these Roles exist only in
// this file's from-clean database, exactly as every other persona in it does.

const SECURITY_POLICY_READ = "admin.securityPolicy.read";
const PRINCIPAL_ACCESS_READ = "admin.principalAccess.read";

/** Did this resolved context earn the surface? Read off the REAL projection, never re-derived. */
const earned = (context, surfaceKey) => new Set(context.surfaces).has(surfaceKey);

/** Is this destination offered, through the REAL client predicate on the REAL nav tree? */
const offered = (context, destinationKey, role = "technician") => {
  const session = eosSession(navigationAuthorityFor(context), { role });
  return isNavItemVisible(administrationItem(destinationKey), session.role, [], session.context);
};

test("AP5: securityPolicy.read WITHOUT principalAccess.read reaches the CONFIGURATION surfaces and is REFUSED Permission Preview", { skip: SKIP }, async () => {
  await reset();
  await makePersona({ subject: "ap-configuration-only", capabilities: [SECURITY_POLICY_READ] });
  const context = await contextFor("ap-configuration-only");

  // The two configuration surfaces are earned -- so this principal is NOT refused for lack of
  // authority in general, which is what makes the Permission Preview refusal mean something.
  assert.equal(earned(context, "administration.rolesPermissions"), true);
  assert.equal(earned(context, "administration.objects"), true);
  assert.equal(earned(context, "administration.permissionPreview"), false,
    "securityPolicy.read alone still earns Permission Preview -- the two authorities are conflated");
  assert.equal(earned(context, "administration.users"), false);
  // The container follows its children honestly: there IS somewhere to go, so the index opens.
  assert.equal(earned(context, "administration.overview"), true);

  // ...and the same split at the DESTINATION level, through the real client predicate.
  assert.equal(offered(context, "rolesPermissions"), true);
  assert.equal(offered(context, "objects"), true);
  assert.equal(offered(context, "permissionPreview"), false,
    "Permission Preview was offered to a principal holding only the policy-configuration read");
  assert.equal(offered(context, "overview"), true);
  const session = eosSession(navigationAuthorityFor(context), { role: "technician" });
  assert.equal(isDomainVisible(administrationDomain(), session.role, [], session.context), true);
});

test("AP5: principalAccess.read WITHOUT securityPolicy.read reaches Permission Preview and is REFUSED the configuration surfaces", { skip: SKIP }, async () => {
  await reset();
  await makePersona({ subject: "ap-principal-only", capabilities: [PRINCIPAL_ACCESS_READ] });
  const context = await contextFor("ap-principal-only");

  assert.equal(earned(context, "administration.permissionPreview"), true,
    "principalAccess.read no longer earns Permission Preview -- the Wave 10 ruling has been reverted");
  assert.equal(earned(context, "administration.users"), true);
  assert.equal(earned(context, "administration.rolesPermissions"), false,
    "the principal read reached the security-policy configuration -- the separation runs one way only");
  assert.equal(earned(context, "administration.objects"), false);
  assert.equal(earned(context, "administration.overview"), true);

  assert.equal(offered(context, "permissionPreview"), true);
  assert.equal(offered(context, "users"), true);
  assert.equal(offered(context, "rolesPermissions"), false);
  assert.equal(offered(context, "objects"), false);
});

test("AP5: changing admin.securityPolicy.read ALONE does not change Permission Preview availability", { skip: SKIP }, async () => {
  // The claim as an EXPERIMENT over four real personas rather than as a property of a table: vary
  // exactly one of the two capabilities at a time and read which answers move. Permission Preview
  // tracks principalAccess.read in all four cells and securityPolicy.read in none of them.
  await reset();
  const CELLS = [
    { subject: "ap-cell-neither", capabilities: [] },
    { subject: "ap-cell-config", capabilities: [SECURITY_POLICY_READ] },
    { subject: "ap-cell-principal", capabilities: [PRINCIPAL_ACCESS_READ] },
    { subject: "ap-cell-both", capabilities: [SECURITY_POLICY_READ, PRINCIPAL_ACCESS_READ] },
  ];
  for (const cell of CELLS) await makePersona(cell);

  const observed = {};
  for (const cell of CELLS) {
    const context = await contextFor(cell.subject);
    observed[cell.subject] = {
      permissionPreview: earned(context, "administration.permissionPreview"),
      rolesPermissions: earned(context, "administration.rolesPermissions"),
      objects: earned(context, "administration.objects"),
    };
  }

  // Permission Preview is a function of principalAccess.read and of NOTHING else on this axis.
  assert.equal(observed["ap-cell-neither"].permissionPreview, false);
  assert.equal(observed["ap-cell-config"].permissionPreview, false);
  assert.equal(observed["ap-cell-principal"].permissionPreview, true);
  assert.equal(observed["ap-cell-both"].permissionPreview, true);
  // Adding securityPolicy.read to a principal who holds principalAccess.read changes it not at all,
  // and removing it changes it not at all -- which is the AP5 claim in its exact words.
  assert.equal(observed["ap-cell-principal"].permissionPreview, observed["ap-cell-both"].permissionPreview);
  assert.equal(observed["ap-cell-neither"].permissionPreview, observed["ap-cell-config"].permissionPreview);

  // ...and the mirror image: the configuration surfaces are a function of securityPolicy.read alone.
  for (const surface of ["rolesPermissions", "objects"]) {
    assert.equal(observed["ap-cell-neither"][surface], false);
    assert.equal(observed["ap-cell-principal"][surface], false);
    assert.equal(observed["ap-cell-config"][surface], true);
    assert.equal(observed["ap-cell-both"][surface], true);
    assert.equal(observed["ap-cell-config"][surface], observed["ap-cell-both"][surface]);
  }
});

test("AP4: dispatcher is REFUSED Permission Preview, and reaches it the moment it is INDEPENDENTLY granted", { skip: SKIP }, async () => {
  // The dispatcher half of AP4, and the half section 5 cannot state: the refusal must be caused by
  // the MISSING CAPABILITY and by nothing else. Two dispatchers, the full measured 29-capability set
  // each, one capability apart.
  await reset();
  const dispatcherCapabilities = MEASURED_NONPROD_ROLE_CAPABILITIES.dispatcher;
  assert.equal(dispatcherCapabilities.length, MEASURED_COUNTS.dispatcher);
  assert.equal(dispatcherCapabilities.includes(PRINCIPAL_ACCESS_READ), false,
    "the measured dispatcher set now contains the principal read -- re-measure before trusting this");
  assert.equal(dispatcherCapabilities.includes(SECURITY_POLICY_READ), false);

  await makePersona({ subject: "ap-dispatcher", capabilities: dispatcherCapabilities });
  await makePersona({
    subject: "ap-dispatcher-granted",
    capabilities: [...dispatcherCapabilities, PRINCIPAL_ACCESS_READ],
  });

  const plain = await contextFor("ap-dispatcher");
  const granted = await contextFor("ap-dispatcher-granted");

  // NOT VACUOUS: the plain dispatcher earns a great deal and none of it is this.
  assert.ok(plain.surfaces.length > 0);
  assert.equal(earned(plain, "administration.permissionPreview"), false);
  assert.equal(offered(plain, "permissionPreview", "dispatcher"), false,
    "dispatcher was offered Permission Preview");
  assert.equal(offered(plain, "overview", "dispatcher"), false);

  // ONE capability apart, and the door opens -- by the grant, never by the Role key "dispatcher".
  assert.equal(earned(granted, "administration.permissionPreview"), true);
  assert.equal(offered(granted, "permissionPreview", "dispatcher"), true);
  // And it opened ONLY that, plus the other surface the same principal read governs. The
  // configuration surfaces stay shut, which is the separation seen from the dispatcher's side.
  assert.equal(earned(granted, "administration.rolesPermissions"), false);
  assert.equal(earned(granted, "administration.objects"), false);
  assert.equal(earned(granted, "administration.users"), true);
  assert.equal(earned(granted, "administration.workflows"), false);

  // The delta between the two contexts is EXACTLY the surfaces that one read confers.
  const delta = granted.surfaces.filter((k) => !new Set(plain.surfaces).has(k)).sort();
  assert.deepEqual(delta,
    ["administration.overview", "administration.permissionPreview", "administration.users"]);
});

test("AP4: admin and owner reach Permission Preview through the PRINCIPAL read, with the configuration read removed", { skip: SKIP }, async () => {
  // The positive half of AP4 restated so it is not satisfied by the coincidence. admin and owner each
  // hold their full measured set MINUS `admin.securityPolicy.read` -- so if Permission Preview were
  // still gated on the configuration read, both would lose it here.
  await reset();
  for (const roleKey of ["admin", "owner"]) {
    const full = MEASURED_NONPROD_ROLE_CAPABILITIES[roleKey];
    assert.equal(full.includes(SECURITY_POLICY_READ), true);
    assert.equal(full.includes(PRINCIPAL_ACCESS_READ), true);
    await makePersona({
      subject: `ap-${roleKey}-no-config`,
      capabilities: full.filter((k) => k !== SECURITY_POLICY_READ),
    });
    const context = await contextFor(`ap-${roleKey}-no-config`);
    assert.equal(earned(context, "administration.permissionPreview"), true,
      `${roleKey} lost Permission Preview when only the CONFIGURATION read was removed`);
    assert.equal(offered(context, "permissionPreview", roleKey === "admin" ? "admin" : "technician"), true);
    // ...and it did lose the configuration surfaces, which is what says the removal took effect.
    assert.equal(earned(context, "administration.rolesPermissions"), false);
    assert.equal(earned(context, "administration.objects"), false);
    // No Employee is linked, exactly as section 5's personas are not.
    assert.equal(context.employeeId, null);
  }
});
