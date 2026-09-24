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
const { NAV_DOMAINS, NAV_SURFACE_ACCESS, NAV_SURFACE_GAPS, isDomainVisible, isNavItemVisible } =
  await import(clientModule("navigation", "navConfig.js"));
const { buildNavigationAuthority, EXPERIENCE_STATE } =
  await import(clientModule("access", "experienceContext.js"));

const MANIFEST = JSON.parse(
  readFileSync(path.join(FUNCTIONS_DIR, "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"),
);
const PERSONAS = MANIFEST.personas;

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

test("the persona catalog under measurement is the 17 the manifest declares", () => {
  assert.equal(Object.keys(PERSONAS).length, 17);
  // Every persona must name a Security Role composition -- even an EMPTY one, which is the two
  // restricted personas' whole point. An ABSENT list would be an unanswered question.
  for (const [key, persona] of Object.entries(PERSONAS)) {
    assert.ok(Array.isArray(persona.securityRoles), `${key} declares no securityRoles list`);
    assert.ok(Array.isArray(persona.workEligibility), `${key} declares no workEligibility list`);
    assert.ok(Array.isArray(persona.operationalScopes), `${key} declares no operationalScopes list`);
  }
  const withNoRole = Object.entries(PERSONAS).filter(([, p]) => p.securityRoles.length === 0).map(([k]) => k);
  assert.deepEqual(withNoRole.sort(), ["records-clerk", "technician-on-leave"]);
});

test("the experience surface catalog satisfies its own invariants", () => {
  // The product's own guard, not a re-statement of it. A container of containers, a duplicate key, a
  // surface declared both granted and a gap, or a RECORD_ASSIGNMENT predicate on navigation all fail
  // here -- and every persona assertion below would be meaningless over a catalog that failed it.
  assert.deepEqual(surfaceCatalogViolations(), []);
  assert.equal(EXPERIENCE_SURFACE_KEYS.length, 29);
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
  assert.equal(files.length, 50, "the migration chain moved; re-measure before trusting anything below");
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
    assert.equal(rebuilt.length, 387);
    const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0].n;
    // `capabilities` is the GLOBAL catalog and carries no tenant_id; roles and the direct grants do.
    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.capabilities"), 76);
    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.roles WHERE tenant_id=$1", [TENANT]), 48);
    // ZERO direct Principal grants and ZERO conditions: every answer below is Role-derived, so
    // "yields the expected surfaces" is a statement about the ROLE COMPOSITION and nothing else.
    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.principal_capabilities WHERE tenant_id=$1", [TENANT]), 0);
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

  await t.test("EXPECTED_FAIL: OWNER is a strict SUBSET of ADMIN -- there is no separation of duties", async () => {
    // CLASSIFICATION: SECURITY_ROLE_DEFECT (candidate -- no ruling on this branch states a direction).
    //
    // MEASURED. owner holds 47 capabilities, admin 66, and the 47 are a SUBSET of the 66: there are
    // 19 capabilities admin holds and owner does not, and ZERO the other way round. So "Owner" is
    // not a peer authority to "Administrator" with different duties; it is a smaller Administrator.
    // Nothing an Owner may do is withheld from an Admin, which means the pair cannot express any
    // segregation-of-duty control at all -- including over the Administration surfaces they share.
    //
    // PINNED, NOT FIXED. This test asserts the CURRENT arrangement. If a ruling later gives Owner an
    // authority Admin lacks, this fails and the gap report must be revisited.
    const admin = await resolve(["admin"], NO_DIMENSIONS);
    const owner = await resolve(["owner"], NO_DIMENSIONS);
    assert.equal(admin.capabilities.size, 66);
    assert.equal(owner.capabilities.size, 47);
    const ownerOnly = [...owner.capabilities].filter((k) => !admin.capabilities.has(k)).sort();
    const adminOnly = [...admin.capabilities].filter((k) => !owner.capabilities.has(k)).sort();
    assert.deepEqual(ownerOnly, [], "owner has gained an authority admin lacks -- re-read the gap report");
    assert.equal(adminOnly.length, 19);
    // The surface consequence: three surfaces admin reaches and owner cannot, none the other way.
    assert.deepEqual(admin.surfaces.filter((s) => !owner.surfaces.includes(s)).sort(),
      ["administration.dataImport", "receiving.checkIn", "service.dispatch"]);
    assert.deepEqual(owner.surfaces.filter((s) => !admin.surfaces.includes(s)), []);
    assert.equal(admin.surfaces.length, 23);
    assert.equal(owner.surfaces.length, 20);
  });

  await t.test("EXPECTED_FAIL: no persona holds the `owner` Role, so the separation is unobservable", async () => {
    // CLASSIFICATION: TEST_FIXTURE_DEFECT.
    //
    // The catalog merged the separate Administrator persona INTO owner-executive
    // (`catalogGaps[2].disposition === "MERGED_INTO_OWNER_EXECUTIVE"`), and owner-executive holds
    // `admin`. So the `owner` Role has no persona in the acceptance world and the two-Role
    // Administration authority cannot be exercised from either side by a persona. Everything the two
    // tests above prove about owner is CONTRACT-LEVEL, resolved from the Role catalog, not live.
    assert.deepEqual(PERSONAS["owner-executive"].securityRoles, ["admin"]);
    const holders = Object.entries(PERSONAS).filter(([, p]) => p.securityRoles.includes("owner"));
    assert.deepEqual(holders, [], "an owner persona now exists -- promote the owner assertions to live");
    const merged = MANIFEST.catalogGaps.find((g) => g.disposition === "MERGED_INTO_OWNER_EXECUTIVE");
    assert.ok(merged, "the merge that removed the Administrator persona is no longer declared");
  });

  // ── 2. DISPATCHER

  await t.test("DISPATCHER receives NO Security Administration", async () => {
    const dispatcher = await resolvePersona("dispatcher");
    assert.equal(dispatcher.capabilities.size, 29);
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
    assert.deepEqual(await holdersOf("workOrder.lifecycle.dispatch"), ["admin", "dispatcher"]);
  });

  // ── 3. TECHNICIAN AND PARTS_OPERATIONS

  await t.test("TECHNICIAN cannot gain PARTS_OPERATIONS by Role, and the eligibility grants nothing", async () => {
    const technician = await resolvePersona("service-technician-a");
    assert.equal(technician.capabilities.size, 3);
    assert.deepEqual([...technician.capabilities].sort(),
      ["reorder.request.read", "workOrder.lifecycle.complete", "workOrder.transition"]);
    assert.deepEqual([...technician.surfaces], ["field.myWorkOrders", "service.workOrders"]);

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
    assert.equal(manager.capabilities.size, 20);
    assert.equal(associate.capabilities.size, 11);
    assert.equal(manager.surfaces.includes("inventory.reorderQueue"), true);
    assert.equal(associate.surfaces.includes("inventory.reorderQueue"), false);
    assert.equal(manager.destinations.includes("inventory/reorderQueue"), true);
    assert.equal(associate.destinations.includes("inventory/reorderQueue"), false);

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

  await t.test("EXPECTED_FAIL: neither warehouse persona can reach its own North Star warehouse surface", async () => {
    // CLASSIFICATION: SECURITY_ROLE_DEFECT.
    //
    // warehouse-manager's North Star names `warehouse.management`; warehouse-associate's names
    // `warehouse.picking`. BOTH are unreachable, and the reason is the Security Role, not the
    // governed dimensions -- both personas hold WAREHOUSE_OPERATIONS and a WAREHOUSE scope, so the
    // predicates would pass. The capability is simply not granted to their Roles:
    //   warehouse.record.read       -> admin, dispatcher, operationsManager, owner   (4, no warehouse Role)
    //   inventory.placement.record  -> admin                                          (1)
    //   inventory.stock.relocate    -> admin                                          (1)
    // These two surfaces are earnable by NO persona in the catalog at all.
    assert.deepEqual(await holdersOf("warehouse.record.read"), ["admin", "dispatcher", "operationsManager", "owner"]);
    assert.deepEqual(await holdersOf("inventory.placement.record"), ["admin"]);
    assert.deepEqual(await holdersOf("inventory.stock.relocate"), ["admin"]);
    const manager = await resolvePersona("warehouse-manager");
    const associate = await resolvePersona("warehouse-associate");
    assert.equal(manager.surfaces.includes("warehouse.management"), false);
    assert.equal(associate.surfaces.includes("warehouse.picking"), false);
    assert.equal(manager.destinations.includes("inventory/warehouses"), false);
    assert.equal(associate.destinations.includes("inventory/warehouseWorkspace"), false);
    // The North Stars that name them are still declared, so this is a gap and not a retirement.
    assert.match(PERSONAS["warehouse-manager"].northStar, /warehouse\.management/);
    assert.match(PERSONAS["warehouse-associate"].northStar, /warehouse\.picking/);
  });

  // ── 6. RETAIL / NATIONAL ACCOUNTS

  await t.test("RETAIL and NATIONAL ACCOUNTS may SHARE a Security Role -- permitted, not a defect", async () => {
    const personaKeys = ["retail-sales-a", "retail-sales-b", "national-accounts-sales"];
    for (const key of personaKeys) assert.deepEqual(PERSONAS[key].securityRoles, ["salesperson"]);
    const resolved = await Promise.all(personaKeys.map(resolvePersona));
    for (const r of resolved) {
      assert.equal(r.capabilities.size, 17);
      assert.equal(r.surfaces.length, 7);
      assert.deepEqual([...r.surfaces], [...resolved[0].surfaces]);
      assert.deepEqual(r.destinations, resolved[0].destinations);
    }
    // NON-VACUOUS: the shared answer is a real, non-empty business surface set, not "nothing".
    assert.deepEqual([...resolved[0].surfaces], [
      "commercial.opportunities", "commercial.salesOrders", "crm.accounts",
      "financials.invoices", "financials.payments", "inventory.balances", "inventory.catalog",
    ]);
    // Sharing a Role is NOT sharing a persona: the manifest keeps national accounts separate and
    // says why, so the identity of the access answer is a measured fact rather than a merge.
    assert.ok(PERSONAS["national-accounts-sales"].keptSeparateReason);
  });

  await t.test("EXPECTED_FAIL: the agreements gap's stated reason is measurably FALSE", async () => {
    // CLASSIFICATION: OBJECT_AUTHORITY_DEFECT (a stale gap register entry).
    //
    // `commercial.agreements` is national-accounts-sales' North Star and is declared an
    // EXPERIENCE_SURFACE_GAP whose reason reads "No salesAgreement.* capability is registered in
    // eos_policy.capabilities". FOUR ARE REGISTERED, under the `salesAgreement` Object, and the
    // salesperson Role -- the very persona the gap text names -- holds all four. So the surface is
    // NOT blocked by the governed vocabulary: it is undeclared. A gap whose reason is false hides a
    // buildable surface behind a sentence nobody re-checks.
    const gap = EXPERIENCE_SURFACE_GAPS.find((g) => g.key === "commercial.agreements");
    assert.ok(gap, "the agreements gap is no longer declared -- re-read the gap report");
    assert.match(gap.reason, /No salesAgreement\.\* capability is registered/);
    const registered = capabilityCatalog.filter((c) => c.key.startsWith("salesAgreement."));
    assert.deepEqual(registered.map((c) => c.key).sort(),
      ["salesAgreement.accept", "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft"]);
    for (const c of registered) assert.equal(c.objectKey, "salesAgreement");
    assert.deepEqual(await holdersOf("salesAgreement.read"),
      ["admin", "dispatcher", "generalManager", "owner", "salesManager", "salesperson"]);
    const sales = await resolvePersona("national-accounts-sales");
    assert.ok(sales.capabilities.has("salesAgreement.read"));
    // The consequence, pinned: the persona holds the read and is offered no destination for it.
    assert.equal(sales.surfaces.includes("commercial.agreements"), false);
    assert.equal(EXPERIENCE_SURFACE_KEYS.includes("commercial.agreements"), false);
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

    // CLASSIFICATION (b): TEST_FIXTURE_DEFECT. No persona holds a finance Role, so every statement
    // above about controller / accountingManager / financeManager is CONTRACT-LEVEL, resolved from
    // the Role catalog and never exercised by a persona. The catalog says so itself.
    const financeRoles = ["controller", "accountingManager", "financeManager"];
    const holders = Object.entries(PERSONAS)
      .filter(([, p]) => p.securityRoles.some((r) => financeRoles.includes(r))).map(([k]) => k);
    assert.deepEqual(holders, [], "a finance persona now exists -- promote these assertions to live");
    const gap = MANIFEST.catalogGaps.find((g) => /Finance/.test(g.requestedRole));
    assert.equal(gap.disposition, "MISSING_FROM_SAMPLE_COMPANY_V2");
    assert.equal(gap.seededHere, false);
    // The three finance Roles are nonetheless REAL and identically granted -- 17 capabilities each.
    for (const role of financeRoles) {
      assert.equal((await capabilitiesForRoleKeys(pool, TENANT, [role])).size, 17);
    }
  });

  // ── 8. REPORTING

  await t.test("EXPECTED_FAIL: the REPORTING persona is read-only only VACUOUSLY -- it reads nothing", async () => {
    // CLASSIFICATION: DOMAIN_NOT_ACTIVATED (+ TEST_FIXTURE_DEFECT for the absent persona).
    //
    // "Reporting persona is read-only" is TRUE and MEANS NOTHING here: all three reporting Roles hold
    // ZERO capabilities, so there is no write to exclude and no read to offer. Reported as vacuous
    // rather than as a pass, because a vacuous pass is how this expectation would stop being checked.
    for (const role of ["reportViewer", "reportFinanceViewer", "reportAuthor"]) {
      const caps = await capabilitiesForRoleKeys(pool, TENANT, [role]);
      assert.equal(caps.size, 0, `${role} now holds capabilities -- the vacuity is over, write the real assertion`);
      const r = await resolve([role], NO_DIMENSIONS);
      assert.deepEqual([...r.surfaces], []);
      assert.deepEqual(r.destinations, []);
      // The read-only half, asserted anyway so it is already written when the grants arrive.
      assert.equal(objectAccessOf(caps).effective.length, 0);
    }
    // The Reporting persona is likewise absent from the catalog, by declaration.
    const gap = MANIFEST.catalogGaps.find((g) => /Reporting/.test(g.requestedRole));
    assert.equal(gap.disposition, "MISSING_FROM_SAMPLE_COMPANY_V2");
    assert.equal(gap.seededHere, false);
    assert.deepEqual(gap.proposedSecurityRoles, ["reportViewer"]);
    // And the destinations it would need are declared gaps governed by the Firebase capability feed,
    // not by eos_policy -- which is why no grant here could open them anyway.
    assert.match(NAV_SURFACE_GAPS["reporting/builder"], /Firebase capability feed/);
  });

  // ── 9. RESTRICTED PERSONAS

  await t.test("RESTRICTED personas cannot accidentally reach a business write", async () => {
    for (const personaKey of ["records-clerk", "technician-on-leave"]) {
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
    // NON-VACUITY, which is the only thing that makes a zero meaningful. The SAME resolution path,
    // the SAME evaluator and the SAME client predicates hand owner-executive 23 surfaces and 27
    // destinations -- so an empty answer is a refusal, not a broken harness.
    const ownerExecutive = await resolvePersona("owner-executive");
    assert.equal(ownerExecutive.surfaces.length, 23);
    assert.equal(ownerExecutive.destinations.length, 28);
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
    const capsBefore = await capabilitiesForRoleKeys(pool, TENANT, ["reportViewer"]);
    assert.equal(capsBefore.size, 0);

    await setWorkflowRoleBinding(repo, { tenantId: TENANT, uid: ACTOR, heldRoleKeys: ["admin"] },
      { versionId: version.id, actionKey: "MarkReady", roleId: reportViewer.id, reason: "never-widens proof" });

    // THE BINDING IS LIVE -- so this test is not vacuous, and the widening it fails to cause is real.
    const after = await loadWorkflowVersionDefinition(repo, TENANT, version.id);
    assert.equal(decideWorkflowAction(after, instance, "MarkReady", attempt).allowed, true);

    // AND THE OBJECT AUTHORITY HAS NOT MOVED. Zero capabilities before, zero after; zero surfaces
    // before, zero after. The binding narrows who may attempt a transition; it grants nothing.
    const capsAfter = await capabilitiesForRoleKeys(pool, TENANT, ["reportViewer"]);
    assert.equal(capsAfter.size, 0);
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
    const EXPECTED_SURFACE_COUNTS = {
      "owner-executive": 23, "general-manager": 14, "office-manager": 2, "service-manager": 11,
      "dispatcher": 12, "service-technician-a": 2, "service-technician-b": 2, "contract-technician": 2,
      "technician-on-leave": 0, "retail-sales-a": 7, "retail-sales-b": 7, "national-accounts-sales": 7,
      "parts-manager": 13, "parts-associate": 8, "warehouse-manager": 10, "warehouse-associate": 6,
      "records-clerk": 0,
    };
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
    // TWO SURFACES ARE EARNABLE BY NOBODY IN THE CATALOG -- see the warehouse EXPECTED_FAIL above.
    // Pinned here as a census so a third cannot join them unnoticed.
    assert.deepEqual(EXPERIENCE_SURFACE_KEYS.filter((k) => !granted.has(k)).sort(),
      ["warehouse.management", "warehouse.picking"]);
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
    assert.deepEqual(await holdersOf("workOrder.lifecycle.dispatch"), ["admin", "dispatcher"]);
    assert.deepEqual(await holdersOf("workOrder.lifecycle.complete"), ["technician"]);
  });
});
