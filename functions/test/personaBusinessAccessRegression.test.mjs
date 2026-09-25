// DOES EACH CANONICAL PERSONA'S ROLE COMPOSITION YIELD THE SURFACES ITS BUSINESS NEEDS?
//
// ════════════════════ WHAT THIS FILE IS, AND WHAT IT REFUSES TO BE ════════════════════
//
// It is an EXECUTABLE persona access regression. For each of the 17 personas
// `scripts/fixtures/personaAuthorityDimensions.v1.json` declares, it resolves the Security Role
// composition through the SAME code the product runs -- `capabilitiesForRoleKeys` against a real
// PostgreSQL, then `grantedSurfaceKeys` / `authorizeObjectAction`, then the CLIENT's own
// `isNavItemVisible` -- and asserts the Object and application surfaces that come out.
//
// IT IS NOT A LOGIN TEST AND NEEDS NO PASSWORD. Identity ends at the token
// (`identityArchitecture.chain` in the manifest says so): a Firebase uid resolves to an
// eos_policy.principal and EVERYTHING after that point is the code below. So the whole
// authorization half is measurable with no emulator, no browser, no dev server and no credential
// -- and the half that is not measurable this way (does the password work) is not an authorization
// question at all.
//
// THERE IS NO HAND-ROLLED DOUBLE ANYWHERE IN HERE. Every decision is taken by a product module:
//   capabilitiesForRoleKeys        eosOps/capabilityAuthority.ts     Role -> capability, the SQL join
//   grantedSurfaceKeys            eosOps/experienceAuthority.ts     capability -> surface projection
//   authorizeObjectAction         eosOps/contextualAuthorization.ts  the predicate evaluator + reasons
//   effectiveCapabilities         adminPolicy/objectSecurityAuthority.ts  capability -> Object/action/kind
//   isNavItemVisible              field-ops-app-vite navConfig.js    surface -> navigable destination
//   decideWorkflowAction          adminPolicy/workflowEngine.ts      the workflow authority
//   setWorkflowRoleBinding        adminPolicy/workflowCommands.ts    the workflow binding write
// The only thing this file writes itself is the QUESTION.
//
// ════════════════════ THE DATABASE IT ASSERTS ON, AND WHY THAT IS HONEST ════════════════════
//
// A DISPOSABLE database, rebuilt by the product's own five-phase authority pipeline (the same phases
// roleCapabilityAuthorityBaselinePostgres.test.mjs uses) and then PROVED equal to the measured
// nonprod authority by `compareAuthority` -- 387 pairs, 0 missing declarations, 0 unexplained extras.
// Nothing is asserted about a population this file did not first prove it reproduced.
//
// VERIFIED AGAINST NONPROD, read-only, 2026-09-24 (eos-policy-nonprod dpg-dah48qht0dsc73egnml0-a):
//   capabilities 76 · role_capabilities 387 · principal_capabilities 0 · workflow_role_bindings 112
//   admin 66 · owner 47 · dispatcher 29 · technician 3 · partsAssociate 10 · partsManager 16
//   warehouseAssociate 8 · warehouseManager 12 · salesperson 17 · controller 17 · reportViewer 0
// The rebuilt database reproduces every one of those numbers exactly. nonprod carries 49 Roles to
// this catalog's 48 -- the extra is `zz_nonprod_acceptance`, an environment-only acceptance Role
// holding no grant -- and 31 of those 49 have ZERO holders in user_role_assignments.
//
// ════════════════════ EXPECTED_FAIL IS A RESULT, NOT A FAILURE ════════════════════
//
// Where current state does not meet the expectation, the test is named `EXPECTED_FAIL:` and it
// asserts the CURRENT state, with the gap and its classification written next to it. NOTHING here
// grants a capability, edits a fixture, or weakens an assertion to make a denial pass. A denial that
// is correct stays a denial. Pinning the defective state is deliberate: the day somebody closes the
// gap, the pin fails and points at the classification, instead of the gap closing unobserved.
//
// NO MUTATION OF ANYTHING SHARED. Every write below lands in a database this file creates and drops.
// No fixture is edited, no permission is granted, no nonprod or production row is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { capabilitiesForRoleKeys } from "../lib/eosOps/capabilityAuthority.js";
import {
  EXPERIENCE_SURFACES,
  EXPERIENCE_SURFACE_GAPS,
  EXPERIENCE_SURFACE_KEYS,
  grantedSurfaceKeys,
  surfaceCatalogViolations,
} from "../lib/eosOps/experienceAuthority.js";
import { authorizeObjectAction, snapshotContextualReader } from "../lib/eosOps/contextualAuthorization.js";
import { effectiveCapabilities, objectActionsForPrincipal } from "../lib/adminPolicy/objectSecurityAuthority.js";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { seedTenantPolicy } from "../lib/adminPolicy/seed/policySeed.js";
import { setWorkflowRoleBinding } from "../lib/adminPolicy/workflowCommands.js";
import { decideWorkflowAction, loadWorkflowVersionDefinition } from "../lib/adminPolicy/workflowEngine.js";
import {
  GLOBAL_CATALOG_ACTIVATED_GRANTS,
  NONPROD_ACTIVATED_CAPABILITY_GRANTS,
  SEED_BOUNDARY_MIGRATION,
  compareAuthority,
  nonprodAuthorityGrants,
} from "../lib/adminPolicy/roleCapabilityAuthorityBaseline.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(FUNCTIONS_DIR, "..");

// THE CLIENT'S OWN visibility code, imported by path exactly as reorderQueueNavigation.test.mjs does.
// A second copy of the nav rules in this file would be the defect the whole lane is measuring.
const clientModule = (...segments) =>
  new URL(`file://${path.join(REPO_ROOT, "field-ops-app-vite", "src", ...segments).replace(/\\/g, "/")}`).href;
const { NAV_DOMAINS, NAV_SURFACE_ACCESS, NAV_SURFACE_GAPS, isDomainVisible, isNavItemVisible,
  isEosNavigationSource } = await import(clientModule("navigation", "navConfig.js"));
const { buildNavigationAuthority, EXPERIENCE_STATE } =
  await import(clientModule("access", "experienceContext.js"));

const MANIFEST = JSON.parse(
  readFileSync(path.join(FUNCTIONS_DIR, "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"),
);
const PERSONAS = MANIFEST.personas;

// THE DEPLOYMENT BLOCK OF THE AUTHORITY BASELINE. It is what distinguishes "what this repository
// rebuilds to" from "what nonprod currently holds", and the foundation test below asserts BOTH
// rather than quietly picking whichever one happens to match.
const baselineDeployment = JSON.parse(readFileSync(
  path.join(FUNCTIONS_DIR, "src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json"), "utf8",
)).deployment;

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to resolve against";

const TENANT = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
const TENANT_KEY = "taylor-nonprod";
const ACTOR = "persona-access-regression";

/** The persona's governed dimensions, in the shape the contextual reader takes. */
const dimensionsOf = (personaKey) => {
  const persona = PERSONAS[personaKey];
  assert.ok(persona, `the manifest declares no persona "${personaKey}"`);
  return {
    employeeId: persona.employee,
    workEligibility: persona.workEligibility ?? [],
    operationalScopes: (persona.operationalScopes ?? []).map((s) => {
      const [scopeType, scopeId] = s.split(":");
      return { scopeType, scopeId };
    }),
  };
};

/** The destinations a set of server-issued surfaces opens, through the CLIENT's real predicates. */
function destinationsFor(surfaces, role = null) {
  const authority = buildNavigationAuthority({
    state: surfaces.length > 0 ? EXPERIENCE_STATE.READY : EXPERIENCE_STATE.REFUSED,
    context: { surfaces },
  });
  const operationalContext = { operationalRoles: [], employmentStatus: null, eosNavigationAuthority: authority };
  const out = [];
  for (const domain of NAV_DOMAINS) {
    if (!isDomainVisible(domain, role, [], operationalContext)) continue;
    for (const item of domain.subnav ?? []) {
      // A container is DERIVED from the list being built, so it is not an access decision of its own.
      if (item.containerScope) continue;
      if (isNavItemVisible(item, role, [], operationalContext)) out.push(`${domain.key}/${item.key}`);
    }
  }
  return out.sort();
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// PART 1 -- WHAT NEEDS NO DATABASE. These run on every machine, so the file is never fully dark.
// ════════════════════════════════════════════════════════════════════════════════════════════

test("the persona catalog under measurement is the 21 the manifest declares", () => {
  // 21, not the 17 this lane measured alone. Lane BI completed the canonical test workforce and
  // separated Owner from Administrator, which added four personas -- including the `owner` holder
  // whose absence this file recorded as a TEST_FIXTURE_DEFECT below.
  assert.equal(Object.keys(PERSONAS).length, 21);
  // Every persona must name a Security Role composition -- even an EMPTY one, which is the two
  // restricted personas' whole point. An ABSENT list would be an unanswered question.
  for (const [key, persona] of Object.entries(PERSONAS)) {
    assert.ok(Array.isArray(persona.securityRoles), `${key} declares no securityRoles list`);
    assert.ok(Array.isArray(persona.workEligibility), `${key} declares no workEligibility list`);
    assert.ok(Array.isArray(persona.operationalScopes), `${key} declares no operationalScopes list`);
  }
  const withNoRole = Object.entries(PERSONAS).filter(([, p]) => p.securityRoles.length === 0).map(([k]) => k);
  // THREE, not two. `report-analyst` joins the two restricted personas in holding no Security Role,
  // and for a DIFFERENT reason: the restricted pair hold none by design, while the Reporting persona
  // holds none because the domain is still BLOCKED_DOMAIN. Both are asserted, and the reasons are
  // kept apart, so "no Role" never reads as one fact when it is two.
  assert.deepEqual(withNoRole.sort(), ["records-clerk", "report-analyst", "technician-on-leave"]);
  assert.equal(PERSONAS["report-analyst"].acceptance, "BLOCKED_DOMAIN");
  for (const key of ["records-clerk", "technician-on-leave"]) {
    assert.notEqual(PERSONAS[key].acceptance, "BLOCKED_DOMAIN", `${key} is restricted by design, not blocked`);
  }
});

test("the experience surface catalog satisfies its own invariants", () => {
  // The product's own guard, not a re-statement of it. A container of containers, a duplicate key, a
  // surface declared both granted and a gap, or a RECORD_ASSIGNMENT predicate on navigation all fail
  // here -- and every persona assertion below would be meaningless over a catalog that failed it.
  assert.deepEqual(surfaceCatalogViolations(), []);
  // 30, not 29: lanes BL and BQ DECLARED `commercial.agreements` -- the surface this file recorded
  // below as a gap whose stated reason was measurably false -- and built its destination.
  assert.equal(EXPERIENCE_SURFACE_KEYS.length, 30);
  assert.equal(EXPERIENCE_SURFACE_KEYS.includes("commercial.agreements"), true);
});

test("PARTS_OPERATIONS is named by NO surface grant path -- it cannot be reached BY ROLE or otherwise", () => {
  // The Work Eligibility vocabulary is SERVICE_TECHNICIAN, WAREHOUSE_OPERATIONS, PARTS_OPERATIONS.
  // Two of the three narrow a surface. PARTS_OPERATIONS narrows NONE, by design: navConfig.js states
  // that it answers "may this Employee be ASSIGNED reorder work" (eosOps/reorderAssignmentAuthority.ts),
  // which is a different authority from "which operational queue is visible". So no Role, no
  // capability and no predicate in the navigation projection can confer or consult it.
  const codes = new Set();
  for (const surface of EXPERIENCE_SURFACES) {
    for (const grant of surface.grants) {
      for (const predicate of grant.predicates ?? []) {
        if (predicate.qualificationCode) codes.add(predicate.qualificationCode);
      }
    }
  }
  assert.deepEqual([...codes].sort(), ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]);
  assert.equal(codes.has("PARTS_OPERATIONS"), false);
  // And it is not a capability key either, so `capabilitiesForRoleKeys` can never return it.
  assert.equal(EXPERIENCE_SURFACES.some((s) => s.grants.some((g) => /PARTS_OPERATIONS/.test(g.capabilityKey))), false);
});

test("every destination a persona's surfaces could open is REGISTERED -- mapped or declared a gap", () => {
  // A surface that no destination is mapped to is earnable and unreachable, which looks like a denial.
  const mapped = new Set(Object.values(NAV_SURFACE_ACCESS).flat());
  const unmapped = EXPERIENCE_SURFACE_KEYS.filter((k) => !mapped.has(k));
  assert.deepEqual(unmapped, [], "an earnable surface reaches no destination");
  // The reporting destinations, which the Reporting persona's North Star names, are DECLARED GAPS.
  assert.ok(NAV_SURFACE_GAPS["reporting/*"], "the reporting domain gap is no longer declared");
  assert.ok(NAV_SURFACE_GAPS["reporting/builder"]);
  assert.ok(NAV_SURFACE_GAPS["reporting/savedReports"]);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// PART 2 -- THE MEASURED RESOLUTION, against a real PostgreSQL.
// ════════════════════════════════════════════════════════════════════════════════════════════

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
const migrate = (dbUrl, count) => execFileSync(process.execPath,
  ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
    "--no-check-order", ...(count === undefined ? [] : [String(count)])],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });

test("persona business access, resolved by the product", { skip: SKIP, concurrency: 1 }, async (t) => {
  // A DATABASE OF THIS FILE'S OWN. The group runs with one shared POLICY_TEST_DATABASE_URL, and a
  // suite that dropped its schemas would be rebuilding the ground the next suite stands on.
  const name = `bhpersona_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  const dbUrl = dbUrlFor(name);
  const pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });

  const repo = new PostgresPolicyRepository(pool);

  // ── THE REBUILD, by the product's own phases. Chain to the seed boundary, tenant, seed, rest of
  //    the chain, the canonical catalog declarations, then the nonprod activation. A grant INSERT
  //    that ran against an empty `roles` table wrote nothing, which is exactly why the order matters.
  const files = readdirSync(path.join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const beforeSeed = files.filter((f) => f < SEED_BOUNDARY_MIGRATION).length;
  // 51: the 50 this lane measured alone, plus the AUTHORITY ACTIVATION VEHICLE (1762300800000)
  // integrated from lane BO. The tripwire is kept, and kept exact: it fired on that very change and
  // everything below WAS re-measured against the integrated chain before this number was moved.
  assert.equal(files.length, 51, "the migration chain moved; re-measure before trusting anything below");
  assert.equal(beforeSeed, 41);
  migrate(dbUrl, beforeSeed);
  await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $2)", [TENANT, TENANT_KEY]);
  await seedTenantPolicy(repo, TENANT, ACTOR);
  migrate(dbUrl);
  for (const [pairs, grantedBy] of [
    [GLOBAL_CATALOG_ACTIVATED_GRANTS, `canonical-catalog:${ACTOR}`],
    [NONPROD_ACTIVATED_CAPABILITY_GRANTS, `nonprod-activation:${ACTOR}`],
  ]) {
    for (const { roleKey, capabilityKey } of pairs) {
      await pool.query(
        `INSERT INTO eos_policy.role_capabilities
               (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
         SELECT 'rc_bh_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
           FROM eos_policy.roles r, eos_policy.capabilities c
          WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
         ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`,
        [TENANT, roleKey, capabilityKey, grantedBy]);
    }
  }

  const capabilityCatalog = await repo.listCapabilities();
  const capabilityIdByKey = new Map(capabilityCatalog.map((c) => [c.key, c.id]));

  /** Every Role holding a capability key, in the rebuilt population. */
  const holdersOf = async (capabilityKey) => {
    const { rows } = await pool.query(
      `SELECT r.key FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
         JOIN eos_policy.roles r        ON r.id = rc.role_id
        WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY r.key`, [TENANT, capabilityKey]);
    return rows.map((r) => r.key);
  };

  /** The whole product path for one Role composition: Roles -> capabilities -> surfaces. */
  const resolve = async (roleKeys, dimensions) => {
    const capabilities = await capabilitiesForRoleKeys(pool, TENANT, roleKeys);
    const surfaces = await grantedSurfaceKeys(
      { tenantId: TENANT, principalId: `prn-${roleKeys.join("+") || "none"}`, capabilities }, dimensions);
    return { capabilities, surfaces, destinations: destinationsFor([...surfaces]) };
  };
  const resolvePersona = (personaKey) => resolve(PERSONAS[personaKey].securityRoles, dimensionsOf(personaKey));

  /** Object -> actions, and the action KINDS, through the real Administration projection. */
  const objectAccessOf = (capabilities) => {
    const effective = effectiveCapabilities({
      tenantId: TENANT, principalId: "prn-projection",
      roleDerivedCapabilityIds: [...capabilities].map((k) => capabilityIdByKey.get(k)).filter(Boolean),
      directCapabilityIds: [], capabilities: capabilityCatalog,
    });
    const kinds = {};
    for (const c of effective) kinds[c.actionKind] = (kinds[c.actionKind] ?? 0) + 1;
    return { effective, kinds, objects: objectActionsForPrincipal(effective) };
  };

  const NO_DIMENSIONS = { employeeId: null, workEligibility: [], operationalScopes: [] };

  // ── 0. THE FOUNDATION. Nothing below means anything if this population is not the measured one.

  await t.test("the rebuilt authority IS the measured nonprod authority -- 0 missing, 0 extra", async () => {
    const { rows } = await pool.query(
      `SELECT r.key AS role_key, c.key AS capability_key
         FROM eos_policy.role_capabilities rc
         JOIN eos_policy.roles r ON r.id = rc.role_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE rc.tenant_id = $1`, [TENANT]);
    const rebuilt = rows.map((r) => ({ roleKey: r.role_key, capabilityKey: r.capability_key }));
    const { missingDeclaration, unexplainedExtra } = compareAuthority(nonprodAuthorityGrants(), rebuilt);
    assert.deepEqual(missingDeclaration, []);
    assert.deepEqual(unexplainedExtra, []);

    // 413, NOT 387, AND THE DIFFERENCE IS NAMED. The repository now carries the authority activation
    // vehicle (migration 1762300800000, lane BO), so a deterministic rebuild of THIS TREE produces 26
    // grants more than the nonprod row count measured on 2026-09-24. That is not drift: drift is a row
    // in the database nothing in the repository explains, and this is the inverse -- a row in the
    // repository the database has not run yet, attributable to exactly one migration. `compareAuthority`
    // above is the proof that it is the inverse: ZERO unexplained extras and ZERO missing declarations.
    // The baseline records both numbers for the same reason, and they are asserted together here so
    // neither can move without the other being re-read.
    assert.equal(rebuilt.length, 413, "the repository rebuild total");
    assert.equal(baselineDeployment.rebuildTotal, 413);
    assert.equal(baselineDeployment.measuredInNonprodTotal, 387, "what nonprod held when last measured");
    assert.deepEqual(baselineDeployment.notYetAppliedToNonprod, ["migration:1762300800000"]);
    assert.equal(rebuilt.length - baselineDeployment.measuredInNonprodTotal, 26);
    const stamped = (await pool.query(
      `SELECT count(*)::int n FROM eos_policy.role_capabilities
        WHERE tenant_id = $1 AND granted_by = 'migration:1762300800000'`, [TENANT])).rows[0].n;
    assert.equal(stamped, 26, "the whole 413-vs-387 difference must carry the pending migration's provenance");

    const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0].n;
    // `capabilities` is the GLOBAL catalog and carries no tenant_id; roles and the direct grants do.
    // 79, not the 76 nonprod holds: the same migration registers receivingOrder.record.read,
    // workOrder.record.read and reportDefinition.read (Reporting Slice 1).
    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.capabilities"), 79);
    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.roles WHERE tenant_id=$1", [TENANT]), 48);
    // ZERO direct Principal grants and ZERO conditions: every answer below is Role-derived, so
    // "yields the expected surfaces" is a statement about the ROLE COMPOSITION and nothing else.
    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.principal_capabilities WHERE tenant_id=$1", [TENANT]), 0);
  });

  // ── 0b. THE ADMINISTRATION READ GATE IS SERVER-SIDE, AND IT COUNTS DIRECT PRINCIPAL GRANTS

  await t.test("the Administration READ gate is SERVER-SIDE and totally applied, not a navigation rule", async () => {
    // WHY THIS BELONGS IN A PERSONA FILE. Everything else here measures what a persona is OFFERED --
    // surfaces and destinations, which are drawn by a browser. If the server answered those same
    // reads to anyone in the tenant, every surface assertion above would be a statement about
    // decoration rather than about access. So the gate is asserted here too, from the product's own
    // read-authority map rather than from the navigation catalog.
    //
    // TOTAL: every Administration READ operation resolves to a required capability. An operation
    // that resolved to null would be one the gate cannot govern, which is how a hole gets in.
    const { ADMIN_READ_OPERATIONS, ADMIN_MUTATION_OPERATIONS, capabilityForAdminRead } =
      await import("../lib/adminPolicy/adminPolicyApi.js");
    assert.ok(ADMIN_READ_OPERATIONS.length >= 10, "the read operation list has stopped matching");
    for (const operation of ADMIN_READ_OPERATIONS) {
      const required = capabilityForAdminRead(operation);
      assert.ok(required, `${operation} is an Administration READ that requires no capability`);
      // AND IT IS A READ THAT GATES IT, never a write: gating a read on a write would make a reader
      // indistinguishable from a writer, which is the defect the Administration read authority exists
      // to remove.
      assert.equal(/\.(write|create|edit|publish|version|bindRole|assign|decide|execute|stage)$/.test(required),
        false, `${operation} is gated by "${required}", which names a mutation`);
      // Every key the gate can require must be REGISTERED, or it names a surface nobody could open.
      assert.ok(capabilityCatalog.some((c) => c.key === required),
        `the gate requires "${required}", which the governed vocabulary does not carry`);
    }
    // A MUTATION NEVER ACQUIRES A READ GATE: mutations are authorized by their own commands, and a
    // second gate here would be a second authorization model for the same act.
    for (const mutation of ADMIN_MUTATION_OPERATIONS) {
      assert.equal(capabilityForAdminRead(mutation), null, `${mutation} acquired a read authority`);
    }
    // THE GATE IS IN THE DISPATCHER, BEFORE THE READ RUNS -- asserted of the source, because "the
    // server enforces it" is a claim about where the check sits and not about what it returns.
    const apiSource = readFileSync(path.join(FUNCTIONS_DIR, "src/adminPolicy/adminPolicyApi.ts"), "utf8");
    assert.match(apiSource, /if \(!isMutation\(operation\)\) await requireAdminReadAuthority\(/);

    // DIRECT PRINCIPAL GRANTS COUNT. The gate resolves EFFECTIVE access, which is the union of Role
    // grants and `principal_capabilities` -- so an administrator's direct grant on the Users screen
    // is sufficient on its own, with no Role carrying the key. Asserted here from the enforcement
    // point's own source; the executable end-to-end proof, including withdrawal, is section F of
    // test/administrationReadEnforcement.test.mjs, which is registered in BOTH suite groups.
    const gateStart = apiSource.indexOf("async function requireAdminReadAuthority");
    assert.ok(gateStart > 0, "the read gate has been renamed or removed");
    const gateBody = apiSource.slice(gateStart, apiSource.indexOf("\nasync function dispatch"));
    assert.match(gateBody, /resolvePrincipalEffectiveAccess\(repo, actor\.tenantId, actor\.uid\)/);
    assert.match(gateBody, /access\.effective\.some\(/);
    for (const roleOnly of ["role_capabilities", "listRoleCapabilities", "heldRoleKeys"]) {
      assert.equal(gateBody.includes(roleOnly), false,
        `the read gate consults "${roleOnly}", which would ignore a direct principal grant`);
    }
    // AND THIS FILE'S OWN ANSWERS ARE ROLE-DERIVED, which is only meaningful because direct grants
    // WOULD have counted: the rebuilt tenant holds zero of them, asserted in the foundation above.
  });

  // ── 1. ADMIN / OWNER ADMINISTRATION SEPARATION

  await t.test("ADMIN and OWNER hold the Administration READS as ONE authority, two Roles", async () => {
    for (const key of ["admin.securityPolicy.read", "admin.principalAccess.read", "workflowDefinition.read"]) {
      assert.deepEqual(await holdersOf(key), ["admin", "owner"], `${key} holders moved`);
    }
    assert.equal((await holdersOf("audit.event.read")).length, 12);
    const admin = await resolve(["admin"], NO_DIMENSIONS);
    const owner = await resolve(["owner"], NO_DIMENSIONS);
    // All six governed Administration surfaces plus the derived container, for BOTH -- the Wave 9/10
    // rulings' intent. Identical READS here is deliberate and is not the separation being measured.
    const administrationOf = (r) => r.surfaces.filter((s) => s.startsWith("administration.") && s !== "administration.dataImport").sort();
    assert.deepEqual(administrationOf(admin), [
      "administration.auditLogs", "administration.objects", "administration.overview",
      "administration.permissionPreview", "administration.rolesPermissions", "administration.users",
      "administration.workflows",
    ]);
    assert.deepEqual(administrationOf(owner), administrationOf(admin));
  });

  await t.test("the ONLY Administration separation that exists is Data Import", async () => {
    assert.deepEqual(await holdersOf("admin.dataImport.execute"), ["admin"]);
    const admin = await resolve(["admin"], NO_DIMENSIONS);
    const owner = await resolve(["owner"], NO_DIMENSIONS);
    assert.equal(admin.surfaces.includes("administration.dataImport"), true);
    assert.equal(owner.surfaces.includes("administration.dataImport"), false,
      "owner must not silently acquire the import authority");
    // And the Data Import destination follows the surface, not a Role literal.
    assert.equal(admin.destinations.includes("administration/dataImport"), true);
    assert.equal(owner.destinations.includes("administration/dataImport"), false);
  });

  await t.test("OWNER IS NOT ADMIN -- and is still a strict SUBSET of it, which is a different claim", async () => {
    // OWNER != ADMIN: PROVED. The two Roles resolve to different authority, different surface sets
    // and, since lane BI, different personas. That is the ruling's requirement and it is met below.
    //
    // OWNER NESTS INSIDE ADMIN: STILL TRUE, AND STILL RECORDED AS A DEFECT CANDIDATE.
    // CLASSIFICATION: SECURITY_ROLE_DEFECT (candidate -- no ruling states a direction).
    //
    // RE-MEASURED ON THE INTEGRATED TREE. owner holds 50 capabilities, admin 69. Lane BN narrowed the
    // compiled Owner Role to a DECLARED capability contract, and what that narrowing did was make
    // Owner SMALLER and its 19 exclusions EXPLICIT -- it did not give Owner anything Admin lacks. So
    // the direction of the nesting is unchanged: 19 capabilities admin holds and owner does not, and
    // ZERO the other way round. The pair still cannot express a segregation-of-duty control, and
    // saying so remains the honest answer even though the two Roles are now plainly distinguishable.
    //
    // THE 19 ARE NOW A DECLARED CONTRACT, NOT AN ACCIDENT. They are asserted BY NAME against BN's
    // owner-capability contract, so a silent widening of Owner fails here rather than passing as a
    // smaller count.
    const admin = await resolve(["admin"], NO_DIMENSIONS);
    const owner = await resolve(["owner"], NO_DIMENSIONS);
    assert.equal(admin.capabilities.size, 69);
    assert.equal(owner.capabilities.size, 50);
    const ownerOnly = [...owner.capabilities].filter((k) => !admin.capabilities.has(k)).sort();
    const adminOnly = [...admin.capabilities].filter((k) => !owner.capabilities.has(k)).sort();
    assert.deepEqual(ownerOnly, [], "owner has gained an authority admin lacks -- re-read the gap report");
    assert.deepEqual(adminOnly, [
      "admin.dataImport.execute", "customer.governedField.write", "equipment.install",
      "equipment.model.manage", "inventory.catalog.activate", "inventory.cycleCount.cancel",
      "inventory.cycleCount.create", "inventory.cycleCount.reconcile", "inventory.cycleCount.submit",
      "inventory.placement.record", "inventory.stock.receive", "inventory.stock.relocate",
      "inventory.transfer.cancel", "inventory.transfer.dispatch", "inventory.transfer.receive",
      "opportunity.createSalesOrder", "salesAgreement.accept", "workOrder.lifecycle.cancel",
      "workOrder.lifecycle.dispatch",
    ], "the ADMIN_ONLY set is lane BN's declared Owner exclusion contract; it may not drift silently");
    // The surface consequence: three surfaces admin reaches and owner cannot, none the other way.
    assert.deepEqual(admin.surfaces.filter((s) => !owner.surfaces.includes(s)).sort(),
      ["administration.dataImport", "receiving.checkIn", "service.dispatch"]);
    assert.deepEqual(owner.surfaces.filter((s) => !admin.surfaces.includes(s)), []);
    assert.equal(admin.surfaces.length, 24);
    assert.equal(owner.surfaces.length, 21);
    // NOT THE SAME ROLE, stated as an assertion rather than left implicit in the counts above.
    assert.notEqual(admin.capabilities.size, owner.capabilities.size);
    assert.notDeepEqual(admin.surfaces, owner.surfaces);
  });

  await t.test("A PERSONA NOW HOLDS `owner`, AND A DIFFERENT ONE HOLDS `admin` -- the separation is live", async () => {
    // THE FIXTURE DEFECT THIS FILE RECORDED IS CLOSED. It read: the catalog had merged the separate
    // Administrator persona INTO owner-executive, owner-executive held `admin`, and so the `owner`
    // Role had no persona at all -- every owner statement above was CONTRACT-LEVEL, resolved from the
    // Role catalog and never exercised. Lane BI separated them. The assertions are therefore promoted
    // to live, exactly as the pin instructed, rather than deleted.
    assert.deepEqual(PERSONAS["owner-executive"].securityRoles, ["owner"]);
    assert.deepEqual(PERSONAS["administrator"].securityRoles, ["admin"]);
    const ownerHolders = Object.entries(PERSONAS).filter(([, p]) => p.securityRoles.includes("owner")).map(([k]) => k);
    const adminHolders = Object.entries(PERSONAS).filter(([, p]) => p.securityRoles.includes("admin")).map(([k]) => k);
    assert.deepEqual(ownerHolders, ["owner-executive"]);
    assert.deepEqual(adminHolders, ["administrator"]);
    // TWO PERSONAS, NOT ONE WEARING TWO HATS. No persona holds both, which is what makes the pair
    // capable of being exercised from either side.
    assert.deepEqual(Object.entries(PERSONAS)
      .filter(([, p]) => p.securityRoles.includes("owner") && p.securityRoles.includes("admin")), []);
    // AND THE LIVE RESOLUTION DIFFERS, measured through the product path rather than asserted of the
    // catalog: the Owner persona does not reach Data Import, the Administrator persona does.
    const ownerPersona = await resolvePersona("owner-executive");
    const adminPersona = await resolvePersona("administrator");
    assert.equal(adminPersona.surfaces.includes("administration.dataImport"), true);
    assert.equal(ownerPersona.surfaces.includes("administration.dataImport"), false);
    assert.equal(adminPersona.destinations.includes("administration/dataImport"), true);
    assert.equal(ownerPersona.destinations.includes("administration/dataImport"), false);
  });

  // ── 2. DISPATCHER

  await t.test("DISPATCHER receives NO Security Administration", async () => {
    const dispatcher = await resolvePersona("dispatcher");
    // 31, not 29: the activation vehicle grants dispatcher receivingOrder.record.read and
    // workOrder.record.read -- two READS on Objects it already held a write on. Neither is an
    // ADMIN_ACTION, which is exactly what the rest of this test goes on to prove.
    assert.equal(dispatcher.capabilities.size, 31);
    assert.ok(dispatcher.capabilities.has("receivingOrder.record.read"));
    assert.ok(dispatcher.capabilities.has("workOrder.record.read"));
    // Not "holds no key called admin.*" -- holds no capability whose ACTION KIND is an admin action,
    // which is the Object model's own answer and cannot be dodged by renaming a key.
    const { kinds, objects } = objectAccessOf(dispatcher.capabilities);
    assert.equal(kinds.ADMIN_ACTION ?? 0, 0);
    for (const governed of ["rolesPermissions", "principal", "workflowDefinition", "dataImport", "employee", "auditLog"]) {
      assert.equal(Object.hasOwn(objects, governed), false,
        `dispatcher reaches the ${governed} Object; Security Administration has leaked into Dispatch`);
    }
    assert.deepEqual(dispatcher.surfaces.filter((s) => s.startsWith("administration.")), []);
    assert.deepEqual(dispatcher.destinations.filter((d) => d.startsWith("administration/")), []);
    // NON-VACUOUS: the same projection DOES hand admin 8 admin actions and 8 Administration surfaces.
    const admin = await resolve(["admin"], NO_DIMENSIONS);
    assert.equal(objectAccessOf(admin.capabilities).kinds.ADMIN_ACTION, 8);
    assert.equal(admin.surfaces.filter((s) => s.startsWith("administration.")).length, 8);
    // What the dispatcher IS for, so the denial is not mistaken for having no authority: Dispatch.
    assert.equal(dispatcher.surfaces.includes("service.dispatch"), true);
    // THREE HOLDERS, not two: activation slice S6 grants fieldManager dispatch and cancel as the
    // service manager's SCHEDULING authority -- and never `complete`, which stays the technician's.
    assert.deepEqual(await holdersOf("workOrder.lifecycle.dispatch"), ["admin", "dispatcher", "fieldManager"]);
    assert.deepEqual(await holdersOf("workOrder.lifecycle.cancel"), ["admin", "dispatcher", "fieldManager"]);
  });

  // ── 3. TECHNICIAN AND PARTS_OPERATIONS

  await t.test("TECHNICIAN cannot gain PARTS_OPERATIONS by Role, and the eligibility grants nothing", async () => {
    const technician = await resolvePersona("service-technician-a");
    // 4, not 3: ruling B gave technician workOrder.record.read, closing an edit-without-read row --
    // it held workOrder.transition and could not read the work order it was transitioning. The READ
    // confers no dispatch, cancel or completion, and the surface set is unchanged by it.
    assert.equal(technician.capabilities.size, 4);
    assert.deepEqual([...technician.capabilities].sort(),
      ["reorder.request.read", "workOrder.lifecycle.complete", "workOrder.record.read", "workOrder.transition"]);
    assert.deepEqual([...technician.surfaces], ["field.myWorkOrders", "service.workOrders"]);
    for (const withheld of ["workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel"]) {
      assert.equal(technician.capabilities.has(withheld), false, `the record READ widened technician to ${withheld}`);
    }

    // ASSIGNED vs UNASSIGNED. `field.myWorkOrders` is the technician's own queue and it is reached
    // through the SAME resolution for both technician personas, while the Object authority stays
    // record-scoped: holding the surface is not holding every work order. Measured by resolving the
    // second technician persona, which is a different employee with the same Role.
    const other = await resolvePersona("service-technician-b");
    assert.deepEqual([...other.surfaces], [...technician.surfaces]);
    assert.notEqual(dimensionsOf("service-technician-a").employeeId, dimensionsOf("service-technician-b").employeeId);
    // AND THE ASSIGNED QUEUE IS EARNED BY THE IDENTITY, NOT BY THE ROLE. A technician with the same
    // Role, the same eligibility and NO employee identity loses `field.myWorkOrders` and keeps only
    // `service.workOrders` -- so "my work orders" is genuinely narrowed by who the actor is, and an
    // unassigned technician is not silently handed the assigned surface.
    const unidentified = await resolve(["technician"],
      { employeeId: null, workEligibility: ["SERVICE_TECHNICIAN"], operationalScopes: [] });
    assert.deepEqual([...unidentified.surfaces], ["service.workOrders"]);
    assert.equal(unidentified.surfaces.includes("field.myWorkOrders"), false);
    assert.equal(technician.surfaces.includes("field.myWorkOrders"), true);

    // (a) THE ELIGIBILITY IS NOT A GRANT. Injecting BOTH other qualification codes into the SAME
    //     resolution changes nothing at all -- the manifest's `eligibilityGrantsNothing` ruling,
    //     executed rather than quoted.
    const widened = await resolve(["technician"], {
      ...dimensionsOf("service-technician-a"),
      workEligibility: ["SERVICE_TECHNICIAN", "PARTS_OPERATIONS", "WAREHOUSE_OPERATIONS"],
    });
    assert.deepEqual([...widened.surfaces], [...technician.surfaces]);

    // (b) NON-VACUITY, and it is the sharp point of this lane. The technician DOES hold
    //     `reorder.request.read` -- one of its 7 holders -- so the Reorder Queue is withheld from them
    //     by the OPERATIONAL SCOPE alone. Grant the scope the manifest deliberately withholds and the
    //     queue opens. The qualification could never have done that; the scope does.
    assert.ok((await holdersOf("reorder.request.read")).includes("technician"));
    const scoped = await resolve(["technician"], {
      ...dimensionsOf("service-technician-a"),
      operationalScopes: [{ scopeType: "REORDER_QUEUE", scopeId: "sample-co-synthetic" }],
    });
    assert.equal(scoped.surfaces.includes("inventory.reorderQueue"), true);
    assert.equal(technician.surfaces.includes("inventory.reorderQueue"), false);
    // And the withholding is DECLARED, so this is the fixture's intent rather than an omission.
    assert.ok(MANIFEST.operationalScopesWithheld.some(
      (w) => w.employee === "service-technician-a" && w.wouldBe.startsWith("REORDER_QUEUE")));
  });

  // ── 4. PARTS ASSOCIATE vs PARTS MANAGER

  await t.test("PARTS ASSOCIATE vs PARTS MANAGER: the Reorder distinction is CAPABILITY-first", async () => {
    const manager = await resolvePersona("parts-manager");
    const associate = await resolvePersona("parts-associate");
    // 22 and 13, not 20 and 11: ruling B gave workOrder.record.read to both partsManager and
    // partsAssociate, and the parts-associate persona also carries inventoryReceivingClerk, which
    // gained receivingOrder.record.read. Reads only -- the Reorder distinction below is untouched.
    assert.equal(manager.capabilities.size, 22);
    assert.equal(associate.capabilities.size, 13);
    assert.equal(manager.surfaces.includes("inventory.reorderQueue"), true);
    assert.equal(associate.surfaces.includes("inventory.reorderQueue"), false);
    assert.equal(manager.destinations.includes("inventory/reorderQueue"), true);
    assert.equal(associate.destinations.includes("inventory/reorderQueue"), false);

    // THE ASSIGNMENT AUTHORITY IS THE MANAGER'S, AND IT EXISTS. `reorder.request.assign` is held by
    // partsManager and by nobody else, so "who may assign reorder work" is a real, singular answer
    // rather than an unheld key -- and the associate's queue denial above is not the same fact.
    assert.deepEqual(await holdersOf("reorder.request.assign"), ["partsManager"]);
    assert.ok(manager.capabilities.has("reorder.request.assign"));
    assert.equal(associate.capabilities.has("reorder.request.assign"), false);

    // WHICH AUTHORITY REFUSES, asked of the evaluator itself rather than inferred from the absence.
    // Both personas hold PARTS_OPERATIONS and BOTH hold REORDER_QUEUE:sample-co-synthetic in this
    // manifest, so the qualification and the scope are IDENTICAL and cannot be the difference. The
    // difference is `reorder.request.read`, which partsManager holds and partsAssociate does not --
    // so the refusal is CAPABILITY_MISSING, capability-first, exactly as the manifest's ruling says.
    const ask = async (personaKey) => authorizeObjectAction(
      snapshotContextualReader(dimensionsOf(personaKey)),
      {
        actor: {
          tenantId: TENANT, principalId: `prn-${personaKey}`,
          capabilities: await capabilitiesForRoleKeys(pool, TENANT, PERSONAS[personaKey].securityRoles),
        },
        capabilityKey: "reorder.request.read",
        predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE" }],
      });
    assert.deepEqual(await ask("parts-manager"), { allowed: true, reason: "ALLOWED" });
    const refused = await ask("parts-associate");
    assert.equal(refused.allowed, false);
    assert.equal(refused.reason, "CAPABILITY_MISSING");
    assert.equal(refused.detail, "reorder.request.read");
    assert.deepEqual(PERSONAS["parts-associate"].operationalScopes, ["REORDER_QUEUE:sample-co-synthetic"]);
    assert.deepEqual(PERSONAS["parts-manager"].operationalScopes, ["REORDER_QUEUE:sample-co-synthetic"]);

    // THE SAME PERSONA AS NONPROD ACTUALLY HOLDS IT. Migration 1761696000000 preserved a queue scope
    // for six Roles' ACTIVE linked Employees and partsAssociate is not one of them, so in nonprod the
    // associate holds NO queue scope. The answer must be the same refusal either way, and it is:
    // capability-first means the scope is never even reached.
    const asNonprod = await authorizeObjectAction(
      snapshotContextualReader({
        employeeId: "synthetic-np-emp-parts-associate",
        workEligibility: ["PARTS_OPERATIONS"], operationalScopes: [],
      }),
      {
        actor: { tenantId: TENANT, principalId: "prn-pa-nonprod", capabilities: associate.capabilities },
        capabilityKey: "reorder.request.read",
        predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE" }],
      });
    assert.equal(asNonprod.reason, "CAPABILITY_MISSING");

    // AND NOBODY REACHES THE QUEUE BY THE DEDICATED KEY. `reorder.request.read.queue` is registered
    // and held by ZERO Roles, so the scope path is the only live path to the queue today.
    assert.ok(capabilityCatalog.some((c) => c.key === "reorder.request.read.queue"));
    assert.deepEqual(await holdersOf("reorder.request.read.queue"), []);
  });

  // ── 5. WAREHOUSE

  await t.test("WAREHOUSE counter and reconciler are separate authorities, and the personas separate too", async () => {
    assert.deepEqual(await holdersOf("inventory.cycleCount.create"), ["admin", "inventoryCycleCountCounter"]);
    assert.deepEqual(await holdersOf("inventory.cycleCount.submit"), ["admin", "inventoryCycleCountCounter"]);
    assert.deepEqual(await holdersOf("inventory.cycleCount.reconcile"), ["admin", "inventoryCycleCountReconciler"]);
    const counter = await resolvePersona("warehouse-associate");
    const reconciler = await resolvePersona("warehouse-manager");
    assert.equal(counter.surfaces.includes("inventory.cycleCount.count"), true);
    assert.equal(counter.surfaces.includes("inventory.cycleCount.review"), false);
    assert.equal(reconciler.surfaces.includes("inventory.cycleCount.review"), true);
    assert.equal(reconciler.surfaces.includes("inventory.cycleCount.count"), false);
    // The counter's own scope is load-bearing: the SAME Roles outside the warehouse reach neither.
    const unscoped = await resolve(PERSONAS["warehouse-associate"].securityRoles,
      { employeeId: "synthetic-np-emp-warehouse-associate", workEligibility: ["WAREHOUSE_OPERATIONS"], operationalScopes: [] });
    assert.equal(unscoped.surfaces.includes("inventory.cycleCount.count"), false);
    const unqualified = await resolve(PERSONAS["warehouse-associate"].securityRoles,
      { ...dimensionsOf("warehouse-associate"), workEligibility: [] });
    assert.equal(unqualified.surfaces.includes("inventory.cycleCount.count"), false);
  });

  await t.test("WAREHOUSE MANAGEMENT is now reached; PICKING is STILL BLOCKED, and for a different reason", async () => {
    // HALF OF THIS LANE'S GAP IS CLOSED, AND THE REMAINING HALF IS NOT FAKED.
    //
    // It was recorded as: `warehouse.record.read` reached admin, dispatcher, operationsManager and
    // owner -- no warehouse Role at all -- so BOTH warehouse North Stars were unreachable even though
    // both personas hold WAREHOUSE_OPERATIONS and a WAREHOUSE scope, i.e. the predicates would have
    // passed and only the grant was missing.
    //
    // CLOSED: warehouseAssociate and warehouseManager now hold `warehouse.record.read`, so
    // `warehouse.management` resolves for both and warehouse-manager's North Star is met in full.
    assert.deepEqual(await holdersOf("warehouse.record.read"),
      ["admin", "dispatcher", "operationsManager", "owner", "warehouseAssociate", "warehouseManager"]);
    const manager = await resolvePersona("warehouse-manager");
    const associate = await resolvePersona("warehouse-associate");
    assert.equal(manager.surfaces.includes("warehouse.management"), true);
    assert.equal(associate.surfaces.includes("warehouse.management"), true);
    assert.match(PERSONAS["warehouse-manager"].northStar, /warehouse\.management/);
    assert.equal(manager.surfaces.includes("inventory.cycleCount.review"), true,
      "warehouse-manager's North Star is warehouse.management AND the reconcile review; both must resolve");

    // STILL BLOCKED, ASSERTED AS BLOCKED, WITH ITS REASON. `warehouse.picking` is governed by
    // `inventory.placement.record` or `inventory.stock.relocate`, and both belong to DEDICATED
    // operator Roles (inventoryPutAwayOperator, inventoryStockRelocationOperator) that neither
    // warehouse persona holds. That is a narrower and more accurate statement than the original
    // "admin only": the authority now exists as a job-shaped Role, and the open question is whether
    // warehouse-associate should be ASSIGNED it -- an Owner decision, not a grant to invent here.
    // CLASSIFICATION: SECURITY_ROLE_ASSIGNMENT_GAP (was SECURITY_ROLE_DEFECT).
    assert.deepEqual(await holdersOf("inventory.placement.record"), ["admin", "inventoryPutAwayOperator"]);
    assert.deepEqual(await holdersOf("inventory.stock.relocate"), ["admin", "inventoryStockRelocationOperator"]);
    for (const role of ["inventoryPutAwayOperator", "inventoryStockRelocationOperator"]) {
      assert.equal(PERSONAS["warehouse-associate"].securityRoles.includes(role), false);
      assert.equal(PERSONAS["warehouse-manager"].securityRoles.includes(role), false);
    }
    assert.equal(associate.surfaces.includes("warehouse.picking"), false);
    assert.equal(associate.destinations.includes("inventory/warehouseWorkspace"), false);
    // The North Star that names it is still declared, so this is a gap and not a retirement.
    assert.match(PERSONAS["warehouse-associate"].northStar, /warehouse\.picking/);
  });

  // ── 6. RETAIL / NATIONAL ACCOUNTS

  await t.test("RETAIL and NATIONAL ACCOUNTS may SHARE a Security Role -- permitted, not a defect", async () => {
    const personaKeys = ["retail-sales-a", "retail-sales-b", "national-accounts-sales"];
    for (const key of personaKeys) assert.deepEqual(PERSONAS[key].securityRoles, ["salesperson"]);
    const resolved = await Promise.all(personaKeys.map(resolvePersona));
    for (const r of resolved) {
      assert.equal(r.capabilities.size, 17);
      // 8, not 7: `commercial.agreements` is a declared surface now (lanes BL + BQ) and salesperson
      // already held salesAgreement.read, so it resolves for all three without any new grant.
      assert.equal(r.surfaces.length, 8);
      assert.deepEqual([...r.surfaces], [...resolved[0].surfaces]);
      assert.deepEqual(r.destinations, resolved[0].destinations);
    }
    // NON-VACUOUS: the shared answer is a real, non-empty business surface set, not "nothing".
    assert.deepEqual([...resolved[0].surfaces], [
      "commercial.agreements", "commercial.opportunities", "commercial.salesOrders", "crm.accounts",
      "financials.invoices", "financials.payments", "inventory.balances", "inventory.catalog",
    ]);
    // SAME SECURITY ROLE, DIFFERENT JOB ROLE. Retail and National Accounts resolve IDENTICAL access
    // because access is decided by the Security Role, and they are kept apart by a Job Role the
    // authority model deliberately does not consult. Both halves are asserted so neither reads as
    // the other: identical access above, and a declared, different business identity here.
    assert.notEqual(PERSONAS["retail-sales-a"].employee, PERSONAS["national-accounts-sales"].employee);
    // Sharing a Role is NOT sharing a persona: the manifest keeps national accounts separate and
    // says why, so the identity of the access answer is a measured fact rather than a merge.
    assert.ok(PERSONAS["national-accounts-sales"].keptSeparateReason);
  });

  await t.test("the agreements gap is CLOSED: the false reason is corrected and the surface has a door", async () => {
    // THIS LANE'S FINDING, AND WHAT WAS DONE WITH IT.
    //
    // Recorded here as: `commercial.agreements` -- national-accounts-sales' North Star -- was declared
    // an EXPERIENCE_SURFACE_GAP whose reason read "No salesAgreement.* capability is registered in
    // eos_policy.capabilities", and FOUR were registered, held by the very Role the gap text named.
    // The authority half had always resolved; what was missing was a DESTINATION.
    //
    // Lane BL corrected the false reason and lane BQ built the destination, so the gap is GONE from
    // the register rather than suppressed, and the surface is DECLARED WITH A DOOR. The measurement
    // that proved the reason false is kept below -- it is the evidence the closure was correct.
    assert.equal(EXPERIENCE_SURFACE_GAPS.some((g) => g.key === "commercial.agreements"), false,
      "commercial.agreements has returned to the gap register");
    assert.equal(EXPERIENCE_SURFACE_KEYS.includes("commercial.agreements"), true);

    const registered = capabilityCatalog.filter((c) => c.key.startsWith("salesAgreement."));
    assert.deepEqual(registered.map((c) => c.key).sort(),
      ["salesAgreement.accept", "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft"]);
    for (const c of registered) assert.equal(c.objectKey, "salesAgreement");
    assert.deepEqual(await holdersOf("salesAgreement.read"),
      ["admin", "dispatcher", "generalManager", "owner", "salesManager", "salesperson"]);

    // THE DOOR IS GOVERNED, not open. The surface is earned by salesAgreement.read and by nothing
    // else, so declaring it granted no authority to anybody -- which is the property that made it
    // safe to declare at all.
    const surface = EXPERIENCE_SURFACES.find((s) => s.key === "commercial.agreements");
    assert.deepEqual(surface.grants.map((g) => g.capabilityKey), ["salesAgreement.read"]);
    assert.deepEqual(surface.grants.flatMap((g) => g.predicates ?? []), []);

    // AND IT NOW RESOLVES, end to end, for the persona whose North Star named it.
    const sales = await resolvePersona("national-accounts-sales");
    assert.ok(sales.capabilities.has("salesAgreement.read"));
    assert.equal(sales.surfaces.includes("commercial.agreements"), true);
    assert.ok(sales.destinations.includes("customers/salesAgreements"),
      "the surface resolves but reaches no destination -- the gap has reopened as a different shape");
    // A Role WITHOUT the read still cannot reach it, so the door is a door and not a hole.
    const technician = await resolvePersona("service-technician-a");
    assert.equal(technician.capabilities.has("salesAgreement.read"), false);
    assert.equal(technician.surfaces.includes("commercial.agreements"), false);
    assert.equal(technician.destinations.includes("customers/salesAgreements"), false);
  });

  // ── 7. FINANCE

  await t.test("FINANCE execution authority is strictly NARROWER than finance read", async () => {
    const pairs = [
      ["finance.invoice.read", "finance.invoice.issue"],
      ["finance.payment.read", "finance.payment.apply"],
      ["finance.payment.read", "finance.refund.record"],
      ["finance.invoice.read", "finance.adjustment.record"],
    ];
    for (const [readKey, executeKey] of pairs) {
      const readers = await holdersOf(readKey);
      const executors = await holdersOf(executeKey);
      for (const role of executors) {
        assert.ok(readers.includes(role),
          `${role} may ${executeKey} without ${readKey} -- an execution authority without the read it acts on`);
      }
      assert.ok(executors.length < readers.length,
        `${executeKey} is not narrower than ${readKey} (${executors.length} vs ${readers.length})`);
    }
    assert.equal((await holdersOf("finance.invoice.read")).length, 14);
    assert.equal((await holdersOf("finance.invoice.issue")).length, 7);
    assert.equal((await holdersOf("finance.payment.read")).length, 14);
    assert.equal((await holdersOf("finance.payment.apply")).length, 6);
    // NON-VACUOUS at the persona grain: parts-associate and the sales personas READ the finance
    // surfaces and hold NO finance execution at all.
    for (const personaKey of ["parts-associate", "retail-sales-a", "national-accounts-sales"]) {
      const r = await resolvePersona(personaKey);
      assert.equal(r.surfaces.includes("financials.invoices"), true);
      assert.equal(r.surfaces.includes("financials.payments"), true);
      for (const executeKey of ["finance.invoice.issue", "finance.payment.apply", "finance.refund.record",
        "finance.adjustment.record"]) {
        assert.equal(r.capabilities.has(executeKey), false, `${personaKey} holds ${executeKey}`);
      }
    }
  });

  await t.test("EXPECTED_FAIL: finance EXECUTION reaches an operational Role, and no finance persona exists", async () => {
    // CLASSIFICATION (a): SECURITY_ROLE_DEFECT (candidate). `partsManager` -- an inventory/purchasing
    // operational Role, and the Role the parts-manager persona holds -- carries TWO finance execution
    // authorities: `finance.invoice.issue` and `finance.adjustment.record`. It holds neither
    // `finance.payment.apply` nor `finance.refund.record`, so this is not a finance bundle; it is two
    // rows. The subset property above still holds, so no guard catches it. Whether a Parts Manager
    // should be able to ISSUE AN INVOICE and RECORD A FINANCIAL ADJUSTMENT is an Owner question.
    assert.ok((await holdersOf("finance.invoice.issue")).includes("partsManager"));
    assert.ok((await holdersOf("finance.adjustment.record")).includes("partsManager"));
    assert.equal((await holdersOf("finance.payment.apply")).includes("partsManager"), false);
    assert.equal((await holdersOf("finance.refund.record")).includes("partsManager"), false);
    const partsManager = await resolvePersona("parts-manager");
    assert.ok(partsManager.capabilities.has("finance.invoice.issue"));

    // (b) THE FIXTURE DEFECT IS CLOSED. It read: no persona held a finance Role, so every statement
    // about controller / accountingManager / financeManager was CONTRACT-LEVEL and never exercised.
    // Lane BI added `finance-controller`, so the assertions are PROMOTED TO LIVE as the pin required.
    const financeRoles = ["controller", "accountingManager", "financeManager"];
    const holders = Object.entries(PERSONAS)
      .filter(([, p]) => p.securityRoles.some((r) => financeRoles.includes(r))).map(([k]) => k);
    assert.deepEqual(holders, ["finance-controller"]);
    assert.deepEqual(PERSONAS["finance-controller"].securityRoles, ["controller"]);
    // The three finance Roles are REAL and identically granted -- 17 capabilities each.
    for (const role of financeRoles) {
      assert.equal((await capabilitiesForRoleKeys(pool, TENANT, [role])).size, 17);
    }
    // LIVE, through the product path: the finance persona holds the finance READS and the four named
    // finance EXECUTION acts, and reaches the two Financials surfaces.
    const finance = await resolvePersona("finance-controller");
    assert.equal(finance.capabilities.size, 17);
    for (const key of ["finance.invoice.read", "finance.payment.read", "finance.invoice.issue",
      "finance.payment.apply", "finance.refund.record", "finance.adjustment.record"]) {
      assert.ok(finance.capabilities.has(key), `the finance persona does not hold ${key}`);
    }
    assert.equal(finance.surfaces.includes("financials.invoices"), true);
    assert.equal(finance.surfaces.includes("financials.payments"), true);
    // AND IT IS NOT AN ADMINISTRATOR. Finance authority is finance-shaped: no ADMIN_ACTION at all.
    assert.equal(objectAccessOf(finance.capabilities).kinds.ADMIN_ACTION ?? 0, 0);
    assert.equal(finance.surfaces.includes("administration.dataImport"), false);
    assert.equal(finance.surfaces.includes("administration.rolesPermissions"), false);
  });

  // ── 8. REPORTING

  await t.test("REPORTING BASELINE IS ONE READ AND ONLY A READ -- the vacuity is over, the block is not", async () => {
    // THE VACUITY THIS LANE REFUSED TO CALL A PASS HAS ENDED, exactly as the pin demanded: it said
    // "reportViewer now holds capabilities -- the vacuity is over, write the real assertion". Slice 1
    // of the Reporting activation (migration 1762300800000) registered reportDefinition.read, so the
    // real assertion is written here.
    //
    // ONE READ. reportViewer holds exactly reportDefinition.read and nothing else, so "the Reporting
    // baseline is read-only" is now a statement with content: there is a read, and there is no write
    // to exclude because none is registered.
    const viewer = await capabilitiesForRoleKeys(pool, TENANT, ["reportViewer"]);
    assert.deepEqual([...viewer].sort(), ["reportDefinition.read"]);
    const viewerAccess = objectAccessOf(viewer);
    for (const mutating of ["CREATE", "EDIT", "BUSINESS_ACTION", "ADMIN_ACTION"]) {
      assert.equal(viewerAccess.kinds[mutating] ?? 0, 0, `the reporting baseline acquired a ${mutating}`);
    }
    // NOT GRANTABLE THE OTHER WAY EITHER: the delete is UNREGISTERED, so it is ungrantable rather
    // than merely ungranted, and the field-level report ids are deliberately outside the vocabulary.
    assert.equal(capabilityCatalog.some((c) => c.key === "reportDefinition.delete"), false);
    assert.deepEqual(capabilityCatalog.filter((c) => c.key.startsWith("report")).map((c) => c.key).sort(),
      ["reportDefinition.read"]);
    // Granted to the three Roles the ruling names and to no job-title Role.
    assert.deepEqual(await holdersOf("reportDefinition.read"), ["admin", "owner", "reportViewer"]);

    // STILL ZERO for the other two reporting Roles -- Slice 1 is a slice, not the domain.
    for (const role of ["reportFinanceViewer", "reportAuthor"]) {
      const caps = await capabilitiesForRoleKeys(pool, TENANT, [role]);
      assert.equal(caps.size, 0, `${role} gained authority outside Reporting Slice 1`);
      const r = await resolve([role], NO_DIMENSIONS);
      assert.deepEqual([...r.surfaces], []);
      assert.deepEqual(r.destinations, []);
    }

    // AND THE PERSONA IS STILL BLOCKED, ASSERTED AS BLOCKED. Lane BI added `report-analyst`, but it
    // holds NO Security Role, so it resolves to zero authority and zero surfaces. Slice 1 registered
    // a capability; it did not assign anybody to the Reporting domain, and pretending otherwise here
    // would be inventing an Owner decision.
    const analyst = await resolvePersona("report-analyst");
    assert.deepEqual(PERSONAS["report-analyst"].securityRoles, []);
    assert.equal(PERSONAS["report-analyst"].acceptance, "BLOCKED_DOMAIN");
    assert.equal(analyst.capabilities.size, 0);
    assert.deepEqual([...analyst.surfaces], []);
    assert.deepEqual(analyst.destinations, []);
    // And the destinations it would need are declared gaps governed by the Firebase capability feed,
    // not by eos_policy -- which is why Slice 1 could not open them and did not try.
    assert.match(NAV_SURFACE_GAPS["reporting/builder"], /Firebase capability feed/);
  });

  // ── 9. RESTRICTED PERSONAS

  await t.test("RESTRICTED personas cannot accidentally reach a business write", async () => {
    // THREE ZERO-AUTHORITY PERSONAS, AND THEY ARE NOT ALL ZERO FOR THE SAME REASON.
    //   records-clerk / technician-on-leave  hold NO Security Role at all -- authority withheld.
    //   restricted-user                      holds generalEmployee, a Role that grants NOTHING, so
    //                                        it is SIGNED IN and still reaches nothing, which is the
    //                                        harder and more useful negative control.
    for (const personaKey of ["records-clerk", "technician-on-leave", "restricted-user"]) {
      const r = await resolvePersona(personaKey);
      assert.equal(r.capabilities.size, 0);
      assert.deepEqual([...r.surfaces], []);
      assert.deepEqual(r.destinations, [], `${personaKey} was offered a destination`);
      const { effective, kinds } = objectAccessOf(r.capabilities);
      assert.equal(effective.length, 0);
      for (const mutating of ["CREATE", "EDIT", "BUSINESS_ACTION", "ADMIN_ACTION"]) {
        assert.equal(kinds[mutating] ?? 0, 0);
      }
    }
    // restricted-user's zero is a ROLE that grants nothing, not an absent Role -- asserted so the
    // two kinds of zero never collapse into one.
    assert.deepEqual(PERSONAS["restricted-user"].securityRoles, ["generalEmployee"]);
    assert.equal((await capabilitiesForRoleKeys(pool, TENANT, ["generalEmployee"])).size, 0);
    for (const key of ["records-clerk", "technician-on-leave"]) {
      assert.deepEqual(PERSONAS[key].securityRoles, []);
    }
    // NON-VACUITY, which is the only thing that makes a zero meaningful. The SAME resolution path,
    // the SAME evaluator and the SAME client predicates hand owner-executive a large answer -- so an
    // empty answer is a refusal, not a broken harness. 21, not 23: owner-executive now holds `owner`
    // rather than `admin` (lane BI), and lane BN's contract withholds Data Import, receiving check-in
    // and dispatch from Owner.
    const ownerExecutive = await resolvePersona("owner-executive");
    assert.equal(ownerExecutive.surfaces.length, 21);
    assert.ok(ownerExecutive.destinations.length >= 20,
      `owner-executive reached only ${ownerExecutive.destinations.length} destinations`);
    // technician-on-leave is the same PERSON as a technician minus the authority: the Employee, the
    // profile and the reporting line remain, and the eligibility is withheld by declaration.
    assert.ok(MANIFEST.workEligibilityWithheld.some(
      (w) => w.employee === "technician-on-leave" && w.wouldBe === "SERVICE_TECHNICIAN"));
  });

  // ── 10. WORKFLOW BINDINGS NEVER WIDEN

  await t.test("WORKFLOW BINDINGS NEVER CREATE ABSENT OBJECT CAPABILITY -- the seeded proof", async () => {
    // THE CLEANEST CASE IN THE SEEDED WORLD. `partsAssociate` is bound to FOUR actions of the
    // partsPurchasing workflow, whose Object is `reorderRequest` -- and holds ZERO of the five
    // reorderRequest capabilities. The binding lets it be NAMED by a transition; it confers no read,
    // no create and no queue, and the persona is offered no Reorder destination.
    const workflows = await repo.listWorkflows(TENANT);
    const partsPurchasing = workflows.find((w) => w.key === "partsPurchasing");
    assert.equal(partsPurchasing.objectKey, "reorderRequest");
    const version = (await repo.listWorkflowVersions(TENANT, partsPurchasing.id))[0];
    const definition = await loadWorkflowVersionDefinition(repo, TENANT, version.id);
    const roles = await repo.listRoles(TENANT);
    const partsAssociateRole = roles.find((r) => r.key === "partsAssociate");
    const boundActions = definition.bindings
      .filter((b) => b.roleId === partsAssociateRole.id).map((b) => b.actionKey).sort();
    assert.deepEqual(boundActions, ["markReceived", "postPurchasingUpdate", "recordPurchaseOrder", "startPurchasing"]);

    const reorderObjectKeys = capabilityCatalog
      .filter((c) => c.objectKey === "reorderRequest").map((c) => c.key).sort();
    assert.deepEqual(reorderObjectKeys, ["reorder.request.assign", "reorder.request.create.manual",
      "reorder.request.create.system", "reorder.request.read", "reorder.request.read.queue"]);
    const associate = await resolvePersona("parts-associate");
    assert.deepEqual(reorderObjectKeys.filter((k) => associate.capabilities.has(k)), [],
      "a workflow binding has produced an Object capability");
    assert.equal(Object.hasOwn(objectAccessOf(associate.capabilities).objects, "reorderRequest"), false);

    // AND THE AUTHORITY OVER WORKFLOWS THEMSELVES IS NOT WIDENED BY HOLDING A BINDING. Five of the
    // six workflowDefinition.* capabilities are held by NOBODY; the read is admin and owner.
    for (const key of ["workflowDefinition.bindRole", "workflowDefinition.create", "workflowDefinition.edit",
      "workflowDefinition.publish", "workflowDefinition.version"]) {
      assert.deepEqual(await holdersOf(key), [], `${key} has acquired a holder`);
    }
    assert.deepEqual(await holdersOf("workflowDefinition.read"), ["admin", "owner"]);
  });

  await t.test("WORKFLOW BINDINGS NEVER CREATE ABSENT OBJECT CAPABILITY -- the LIVE binding proof", async () => {
    // The seeded case could in principle be a coincidence of what the seed happened to write. This
    // one is not: it BINDS a Role that holds nothing, through the real `setWorkflowRoleBinding`
    // command, and then asks the two questions again.
    const roles = await repo.listRoles(TENANT);
    const reportViewer = roles.find((r) => r.key === "reportViewer");
    const workOrderWorkflow = (await repo.listWorkflows(TENANT)).find((w) => w.key === "workOrder");
    const version = (await repo.listWorkflowVersions(TENANT, workOrderWorkflow.id))[0];
    const before = await loadWorkflowVersionDefinition(repo, TENANT, version.id);
    const action = before.actions.find((a) => a.key === "MarkReady");
    const instance = { id: "wfi-bh", workflowVersionId: version.id, currentStepKey: action.fromStepKey };
    const attempt = { roleIds: [reportViewer.id], actorUid: "prn-reportViewer", assigneeUid: null };

    assert.deepEqual(decideWorkflowAction(before, instance, "MarkReady", attempt),
      { allowed: false, refusal: "notBoundToRole" });
    // ONE, not zero: Reporting Slice 1 gave reportViewer reportDefinition.read. That makes this proof
    // STRONGER, not weaker -- the Role now has a real, non-empty authority, so "the binding did not
    // change it" is a comparison between two populated sets rather than between two emptinesses.
    const capsBefore = await capabilitiesForRoleKeys(pool, TENANT, ["reportViewer"]);
    assert.deepEqual([...capsBefore].sort(), ["reportDefinition.read"]);

    await setWorkflowRoleBinding(repo, { tenantId: TENANT, uid: ACTOR, heldRoleKeys: ["admin"] },
      { versionId: version.id, actionKey: "MarkReady", roleId: reportViewer.id, reason: "never-widens proof" });

    // THE BINDING IS LIVE -- so this test is not vacuous, and the widening it fails to cause is real.
    const after = await loadWorkflowVersionDefinition(repo, TENANT, version.id);
    assert.equal(decideWorkflowAction(after, instance, "MarkReady", attempt).allowed, true);

    // AND THE OBJECT AUTHORITY HAS NOT MOVED. Identical capability set before and after -- asserted
    // as SET EQUALITY rather than as a count, so it stays a statement about what changed rather than
    // about how much there happened to be. The binding narrows who may attempt a transition; it
    // grants nothing, and it takes nothing away either.
    const capsAfter = await capabilitiesForRoleKeys(pool, TENANT, ["reportViewer"]);
    assert.deepEqual([...capsAfter].sort(), [...capsBefore].sort(),
      "a workflow role binding changed the Role's Object authority");
    const resolved = await resolve(["reportViewer"], NO_DIMENSIONS);
    assert.deepEqual([...resolved.surfaces], []);
    assert.deepEqual(resolved.destinations, []);
    // The workOrder Object capabilities exist and reportViewer holds none of them.
    const workOrderKeys = capabilityCatalog.filter((c) => c.objectKey === "workOrder").map((c) => c.key);
    assert.ok(workOrderKeys.length > 0);
    assert.deepEqual(workOrderKeys.filter((k) => capsAfter.has(k)), []);
  });

  // ── 11. THE WHOLE CATALOG, SERVER AND CLIENT TOGETHER

  await t.test("every persona's projection is stable, and the client agrees with the server", async () => {
    // The census, pinned. A grant, a Role composition or a surface-catalog edit that moves any
    // persona's answer fails HERE, next to the numbers it moved, rather than in a persona sweep.
    // RE-MEASURED ON THE INTEGRATED TREE, and now covering all 21 personas rather than 17. What moved
    // and why: `commercial.agreements` became a declared surface (BL+BQ), so every salesperson and
    // every Role holding salesAgreement.read gained one; `warehouse.record.read` reached the two
    // warehouse Roles (BO), so both warehouse personas gained `warehouse.management`;
    // owner-executive moved from `admin` to `owner` (BI) and so lost the three Owner-excluded
    // surfaces; and `administrator`, `finance-controller` and `report-analyst` are new personas.
    const EXPECTED_SURFACE_COUNTS = {
      "owner-executive": 21, "administrator": 24, "general-manager": 15, "office-manager": 2,
      "service-manager": 12, "dispatcher": 13, "service-technician-a": 2, "service-technician-b": 2,
      "contract-technician": 2, "technician-on-leave": 0, "retail-sales-a": 8, "retail-sales-b": 8,
      "national-accounts-sales": 8, "parts-manager": 13, "parts-associate": 8,
      "warehouse-manager": 11, "warehouse-associate": 7, "records-clerk": 0,
      "finance-controller": 11, "report-analyst": 0, "restricted-user": 0,
    };
    // EVERY persona is covered. A persona added to the manifest without a measured expectation here
    // would otherwise slip through this census unmeasured, which is the failure mode this guards.
    assert.deepEqual(Object.keys(EXPECTED_SURFACE_COUNTS).sort(), Object.keys(PERSONAS).sort());
    const granted = new Set();
    for (const [personaKey, expected] of Object.entries(EXPECTED_SURFACE_COUNTS)) {
      const r = await resolvePersona(personaKey);
      assert.equal(r.surfaces.length, expected, `${personaKey} now resolves ${r.surfaces.length} surfaces`);
      r.surfaces.forEach((s) => granted.add(s));
      // THE CLIENT CANNOT WIDEN THE SERVER. Under the EOS authority every visible destination must be
      // mapped to a surface the server issued -- that is the whole content of the cutover claim.
      for (const destination of r.destinations) {
        const surfaces = NAV_SURFACE_ACCESS[destination];
        assert.ok(surfaces, `${personaKey} was offered ${destination}, which maps to no surface`);
        assert.ok(surfaces.some((s) => r.surfaces.includes(s)),
          `${personaKey} was offered ${destination} without holding any of ${surfaces.join("/")}`);
      }
      // A persona with no surface is offered no destination. No default, no placeholder, no fall-through.
      if (r.surfaces.length === 0) assert.deepEqual(r.destinations, []);
    }
    // ONE SURFACE IS EARNABLE BY NOBODY IN THE CATALOG, down from two: `warehouse.management` is now
    // reached by both warehouse personas, and `warehouse.picking` is the one that remains -- see the
    // warehouse block above for why, and whose decision closing it is. Pinned here as a census so
    // another cannot join it unnoticed.
    assert.deepEqual(EXPERIENCE_SURFACE_KEYS.filter((k) => !granted.has(k)).sort(),
      ["warehouse.picking"]);

    // ── THE EOS NAVIGATION SOURCE HAS NO FIREBASE FALLBACK ──
    // When the EOS authority is answering, the LEGACY path must not run at all. Measured through the
    // client's own predicates: a principal with a governed EOS authority but an operational role list
    // that the legacy rules WOULD have honoured is offered nothing the EOS authority did not issue.
    // A fall-through to Firebase would show up here as a destination with no backing surface.
    const legacyRoles = ["admin", "dispatcher", "technician", "partsManager", "warehouseManager"];
    for (const personaKey of ["records-clerk", "restricted-user", "service-technician-a"]) {
      const r = await resolvePersona(personaKey);
      const authority = buildNavigationAuthority({
        state: r.surfaces.length > 0 ? EXPERIENCE_STATE.READY : EXPERIENCE_STATE.REFUSED,
        context: { surfaces: [...r.surfaces] },
      });
      assert.equal(isEosNavigationSource({ eosNavigationAuthority: authority }), true,
        "the EOS authority is not recognised as the navigation source");
      for (const legacyRole of legacyRoles) {
        const offered = [];
        for (const domain of NAV_DOMAINS) {
          const oc = { operationalRoles: legacyRoles, employmentStatus: "ACTIVE", eosNavigationAuthority: authority };
          if (!isDomainVisible(domain, legacyRole, legacyRoles, oc)) continue;
          for (const item of domain.subnav ?? []) {
            if (item.containerScope) continue;
            if (isNavItemVisible(item, legacyRole, legacyRoles, oc)) offered.push(`${domain.key}/${item.key}`);
          }
        }
        for (const destination of offered) {
          const surfaces = NAV_SURFACE_ACCESS[destination];
          assert.ok(surfaces && surfaces.some((s) => r.surfaces.includes(s)),
            `${personaKey}: legacy role ${legacyRole} opened ${destination} under the EOS authority -- a Firebase fallback ran`);
        }
        if (r.surfaces.length === 0) {
          assert.deepEqual(offered, [],
            `${personaKey}: a zero-surface principal was offered destinations by the legacy role ${legacyRole}`);
        }
      }
    }
  });

  await t.test("`service.workOrders` is NOT the operations-team surface -- `service.dispatch` is", async () => {
    // A distinction worth pinning because it is easy to read the wrong way round. service.workOrders
    // is earned by workOrder.create OR workOrder.transition, both of which reach 11 Roles including
    // partsAssociate and technician -- so its presence says nothing about being on the service
    // operations team. service.dispatch is the narrow one: two Roles, and it is what the dispatcher
    // persona is for.
    assert.equal((await holdersOf("workOrder.create")).length, 11);
    assert.equal((await holdersOf("workOrder.transition")).length, 11);
    for (const personaKey of ["parts-associate", "service-technician-a", "office-manager"]) {
      const r = await resolvePersona(personaKey);
      assert.equal(r.surfaces.includes("service.workOrders"), true);
      assert.equal(r.surfaces.includes("service.dispatch"), false);
    }
    const dispatcher = await resolvePersona("dispatcher");
    assert.equal(dispatcher.surfaces.includes("service.dispatch"), true);
    // THREE HOLDERS, not two: activation slice S6 grants fieldManager dispatch and cancel as the
    // service manager's SCHEDULING authority -- and never `complete`, which stays the technician's.
    assert.deepEqual(await holdersOf("workOrder.lifecycle.dispatch"), ["admin", "dispatcher", "fieldManager"]);
    assert.deepEqual(await holdersOf("workOrder.lifecycle.cancel"), ["admin", "dispatcher", "fieldManager"]);
    assert.deepEqual(await holdersOf("workOrder.lifecycle.complete"), ["technician"]);
    // THREE, not two: `service.dispatch` is earned by workOrder.lifecycle.dispatch OR by the
    // coordinated-visit read, and fieldManager holds the latter. Still narrow, and still not
    // something service.workOrders implies -- which is the whole point of this test.
    const dispatchHolders = [];
    for (const personaKey of Object.keys(PERSONAS)) {
      const r = await resolvePersona(personaKey);
      if (r.surfaces.includes("service.dispatch")) dispatchHolders.push(personaKey);
    }
    assert.deepEqual(dispatchHolders.sort(), ["administrator", "dispatcher", "service-manager"]);
  });
});
