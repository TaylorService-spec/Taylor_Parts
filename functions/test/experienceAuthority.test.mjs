// THE EOS PRINCIPAL EXPERIENCE CONTEXT -- offline proofs, no database, no emulator, no network.
//
// ════════════════════ WHAT THIS SUITE IS FOR ════════════════════
//
// A governed EOS persona could authenticate, reach the Render API and hold real capabilities, and
// still could not navigate the client: `isNavItemVisible` read `ROLE_NAV_ACCESS[users/{uid}.role]`,
// `employees/{id}.operationalRoles` and a Firestore capability feed, and nothing else. This file
// proves the replacement, end to end, across the package boundary:
//
//   eos_policy capabilities + eos_workforce dimensions
//        -> experienceAuthority.grantedSurfaceKeys          (functions/src/eosOps)
//        -> the client's own isNavItemVisible / isDomainVisible  (field-ops-app-vite/src)
//        -> the exact destinations a persona can open
//
// It imports the CLIENT's navigation module directly, the same way
// scripts/buildAdminPolicySeedSnapshot.mjs imports the client's metadata: there is no shared package,
// and a hand-mirrored copy of the nav tree would be a second nav tree. The point of the proof is that
// the REAL projection is exercised, not a description of it.
//
// ════════════════════ THE DIMENSIONS ARE READ, NOT RETYPED ════════════════════
//
// Every persona's Work Eligibility and Operational Scope comes from
// functions/scripts/fixtures/personaAuthorityDimensions.v1.json -- the governed manifest that owns
// them. Retyping them here would let the manifest and the proof drift, which is precisely the failure
// the manifest was written to end.
//
// The CAPABILITY SET is the test's independent variable and is declared below with its evidence.
// It is not a claim about which Role holds what in any deployment: that join lives in
// eos_policy.role_capabilities and is asserted against the real table by
// experienceAuthorityPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  EXPERIENCE_SURFACES,
  EXPERIENCE_SURFACE_GAPS,
  EXPERIENCE_SURFACE_KEYS,
  grantedSurfaceKeys,
  surfaceCatalogCapabilityKeys,
  surfaceCatalogViolations,
} from "../lib/eosOps/experienceAuthority.js";
import { snapshotContextualReader } from "../lib/eosOps/contextualAuthorization.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../..");
const clientModule = (...segments) =>
  new URL(`file://${path.join(REPO, "field-ops-app-vite", "src", ...segments).replace(/\\/g, "/")}`).href;

const { NAV_DOMAINS, NAV_SURFACE_ACCESS, isDomainVisible, isNavItemVisible, navigationSurfaceMapViolations } =
  await import(clientModule("navigation", "navConfig.js"));
const { EXPERIENCE_SURFACE_KEYS: CLIENT_SURFACE_KEYS, buildNavigationAuthority, EXPERIENCE_STATE } =
  await import(clientModule("access", "experienceContext.js"));

const MANIFEST = JSON.parse(
  readFileSync(path.join(here, "..", "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"),
);

const actorWith = (capabilities) =>
  Object.freeze({ tenantId: "taylor-nonprod", principalId: "prn-test", capabilities: new Set(capabilities) });

const dimensionsOf = (personaKey) => {
  const persona = MANIFEST.personas[personaKey];
  assert.ok(persona, `the manifest has no persona "${personaKey}"`);
  return {
    // Every login persona in Sample Company v2 has an active employee_principal_link (CX-16 records
    // that as the reason the no-link refusal cannot be produced by a persona).
    employeeId: persona.employee,
    workEligibility: persona.workEligibility ?? [],
    operationalScopes: (persona.operationalScopes ?? []).map((s) => {
      const [scopeType, scopeId] = s.split(":");
      return { scopeType, scopeId };
    }),
  };
};

// ════════════════════ the catalog is well formed ════════════════════

test("the surface catalog satisfies its own invariants", () => {
  assert.deepEqual(surfaceCatalogViolations(), []);
});

test("RECORD_ASSIGNMENT can never gate a surface -- and the guard would catch it", () => {
  // Navigation has no record. A surface predicated on one could only be evaluated against a record
  // the caller never named, and an unanswerable question must not open a door.
  const offending = [
    {
      key: "service.someoneElsesWork",
      label: "x",
      grants: [{ capabilityKey: "workOrder.transition", predicates: [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }] }],
    },
  ];
  const problems = surfaceCatalogViolations(offending);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /RECORD_ASSIGNMENT cannot gate a surface/);
});

test("no surface is both granted and declared a gap, and every gap states a reason", () => {
  const granted = new Set(EXPERIENCE_SURFACE_KEYS);
  for (const gap of EXPERIENCE_SURFACE_GAPS) {
    assert.equal(granted.has(gap.key), false, `${gap.key} is both a surface and a gap`);
    assert.ok(gap.reason.length > 40, `${gap.key} has no real reason`);
  }
});

test("every capability the catalog names looks like a capability key and none is invented prose", () => {
  for (const key of surfaceCatalogCapabilityKeys()) {
    assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/, `"${key}" is not a capability key`);
  }
});

// ════════════════════ the projection honours each authority separately ════════════════════

test("a capability alone earns an unpredicated surface", async () => {
  const surfaces = await grantedSurfaceKeys(
    actorWith(["customer.record.read"]),
    { employeeId: null, workEligibility: [], operationalScopes: [] },
  );
  assert.deepEqual(surfaces, ["crm.accounts"]);
});

test("holding nothing earns nothing -- an empty answer is an ANSWER, not an error", async () => {
  const surfaces = await grantedSurfaceKeys(
    actorWith([]),
    { employeeId: "synthetic-np-emp-records-clerk", workEligibility: [], operationalScopes: [] },
  );
  assert.deepEqual(surfaces, []);
});

test("WORK ELIGIBILITY narrows a capability without touching the grant", async () => {
  const capabilities = ["workOrder.transition"];
  const withoutQualification = await grantedSurfaceKeys(
    actorWith(capabilities),
    { employeeId: "emp-1", workEligibility: [], operationalScopes: [] },
  );
  const withQualification = await grantedSurfaceKeys(
    actorWith(capabilities),
    { employeeId: "emp-1", workEligibility: ["SERVICE_TECHNICIAN"], operationalScopes: [] },
  );
  // The SAME capability. The only difference is one governed eos_workforce row.
  assert.deepEqual(withoutQualification, ["service.workOrders"]);
  assert.deepEqual(withQualification, ["field.myWorkOrders", "service.workOrders"]);
});

test("OPERATIONAL SCOPE is the second path to the Reorder queue, and neither path implies the other", async () => {
  // CX-03 / CX-04 in personaAuthorityDimensions.v1: the technician HOLDS reorder.request.read and is
  // refused the queue by the scope predicate alone; the parts manager reaches it through the scope
  // with no dedicated queue capability.
  const technician = await grantedSurfaceKeys(
    actorWith(["reorder.request.read"]),
    dimensionsOf("service-technician-a"),
  );
  assert.equal(technician.includes("inventory.reorderQueue"), false);

  const partsManager = await grantedSurfaceKeys(
    actorWith(["reorder.request.read"]),
    dimensionsOf("parts-manager"),
  );
  assert.equal(partsManager.includes("inventory.reorderQueue"), true);

  // And the dedicated capability reaches it with no scope at all.
  const queueHolder = await grantedSurfaceKeys(
    actorWith(["reorder.request.read.queue"]),
    { employeeId: null, workEligibility: [], operationalScopes: [] },
  );
  assert.deepEqual(queueHolder, ["inventory.reorderQueue"]);
});

test("a Principal with NO linked Employee keeps unpredicated surfaces and loses every predicated one", async () => {
  // A service or administrative Principal is a legitimate shape, not an error (CX-16). It must not
  // be handed field or warehouse surfaces, and it must not lose its administrative ones either.
  const surfaces = await grantedSurfaceKeys(
    actorWith(["admin.principalAccess.read", "workOrder.transition", "warehouse.record.read"]),
    { employeeId: null, workEligibility: [], operationalScopes: [] },
  );
  // `administration.overview` rides in because `administration.users` did, and that is the container
  // working: it is a DISJUNCTION OVER CHILDREN, so it needs no capability, no predicate and -- as
  // this very case shows -- no linked Employee. It also cannot appear alone; the "container of
  // nothing reachable" case is asserted directly below.
  assert.deepEqual(surfaces, ["administration.overview", "administration.users", "service.workOrders"]);
});

// ════════════════════ the container surface ════════════════════

test("administration.overview is NOT an unconditional door -- no reachable child, no Overview", async () => {
  const none = { employeeId: null, workEligibility: [], operationalScopes: [] };

  // Holds nothing at all.
  assert.deepEqual(await grantedSurfaceKeys(actorWith([]), none), []);

  // Holds real authority, but NONE of it is Administration. This is the case an `alwaysVisible`
  // index or a blanket `administration.read` would get wrong, and it is the whole reason the
  // Overview is derived: a dispatcher-shaped principal must not be seated on the policy menu.
  const dispatcherShaped = await grantedSurfaceKeys(
    actorWith(["workOrder.lifecycle.dispatch", "fulfillment.coordinatedVisit.read"]), none);
  assert.equal(dispatcherShaped.includes("administration.overview"), false);

  // Administration WRITE authority is not a read and does not open the menu either.
  const writerOnly = await grantedSurfaceKeys(
    actorWith(["admin.roleAssignment.write", "admin.userStatus.write", "workflowDefinition.publish"]), none);
  assert.deepEqual(writerOnly, []);

  // Data Import authority is Administration authority and still does not open it -- the Overview is
  // the menu over the ACCESS MODEL, and dataImport is deliberately not one of its children.
  const importer = await grantedSurfaceKeys(actorWith(["admin.dataImport.execute"]), none);
  assert.deepEqual(importer, ["administration.dataImport"]);
});

test("EACH governed Administration child on its own is enough, and each earns only itself + the menu", async () => {
  const none = { employeeId: null, workEligibility: [], operationalScopes: [] };
  const expected = {
    "admin.securityPolicy.read": [
      "administration.objects", "administration.overview",
      "administration.permissionPreview", "administration.rolesPermissions",
    ],
    "workflowDefinition.read": ["administration.overview", "administration.workflows"],
    "audit.event.read": ["administration.auditLogs", "administration.overview"],
    "admin.principalAccess.read": ["administration.overview", "administration.users"],
  };
  for (const [capabilityKey, surfaces] of Object.entries(expected)) {
    assert.deepEqual(await grantedSurfaceKeys(actorWith([capabilityKey]), none), surfaces,
      `${capabilityKey} opens something other than the surfaces it governs`);
  }
});

test("a Role KEY is not a capability, so no Role string can earn the Administration menu", async () => {
  const none = { employeeId: null, workEligibility: [], operationalScopes: [] };
  for (const shape of [["admin"], ["owner"], ["admin", "owner", "dispatcher"]]) {
    assert.deepEqual(await grantedSurfaceKeys(actorWith(shape), none), [],
      "a Role key earned a surface");
  }
});

test("the snapshot reader REFUSES a record question rather than guessing", async () => {
  const reader = snapshotContextualReader({ employeeId: "emp-1", workEligibility: [], operationalScopes: [] });
  await assert.rejects(() => reader.isAssignedEmployee(), /RECORD_ASSIGNMENT has no meaning without a record/);
});

// ════════════════════ client / server vocabulary parity ════════════════════

test("the client's surface vocabulary mirrors the server catalog exactly", () => {
  assert.deepEqual([...CLIENT_SURFACE_KEYS].sort(), [...EXPERIENCE_SURFACE_KEYS].sort());
});

test("the client's destination-to-surface map names only real destinations and real surfaces", () => {
  assert.deepEqual(navigationSurfaceMapViolations(CLIENT_SURFACE_KEYS), []);
});

test("every surface the server can grant is reachable from SOME destination, or is a declared client gap", () => {
  const mapped = new Set(Object.values(NAV_SURFACE_ACCESS).flat());
  const unreachable = EXPERIENCE_SURFACE_KEYS.filter((key) => !mapped.has(key));
  // A surface a principal can earn and no door can offer is the defect this lane exists to remove,
  // pointed the other way. Exactly one remains, and it is declared rather than discovered.
  assert.deepEqual(unreachable, ["inventory.reorderQueue"]);
});

// ════════════════════ THE PERSONA PROOF ════════════════════

/**
 * The capability set each persona is given, and why.
 *
 * INDEPENDENT VARIABLE, NOT A CLAIM ABOUT A DEPLOYMENT. Each set is the minimal, evidence-backed
 * collection for that persona's declared North Star, drawn from ids that
 * eos_policy.capabilities actually declares (proved against the real table by the PostgreSQL suite).
 * What this file proves is the PROJECTION: given these capabilities and the manifest's governed
 * dimensions, exactly these doors open -- and no role string participates.
 */
const PERSONA_CAPABILITIES = Object.freeze({
  "owner-executive": ["admin.principalAccess.read", "employee.record.read", "audit.event.read", "admin.dataImport.execute"],
  "general-manager": ["opportunity.read", "salesOrder.read", "employee.record.read"],
  "office-manager": ["customer.record.read"],
  "service-manager": ["workOrder.create", "workOrder.transition", "workOrder.lifecycle.dispatch"],
  dispatcher: ["workOrder.lifecycle.dispatch", "reorder.request.read", "fulfillment.coordinatedVisit.read"],
  "service-technician-a": ["workOrder.transition", "reorder.request.read"],
  "service-technician-b": ["workOrder.transition", "reorder.request.read"],
  "contract-technician": ["workOrder.transition", "reorder.request.read"],
  // CX: the persona on leave holds NO Security Role, so it holds no capability at all.
  "technician-on-leave": [],
  "retail-sales-a": ["opportunity.read"],
  "retail-sales-b": ["opportunity.read"],
  "national-accounts-sales": ["opportunity.read"],
  "parts-manager": ["reorder.request.read", "reorder.purchaseOrder.read", "inventory.catalog.read"],
  "parts-associate": ["inventory.stock.receive", "inventory.catalog.read"],
  "warehouse-manager": ["warehouse.record.read", "inventory.cycleCount.reconcile", "inventory.placement.record"],
  "warehouse-associate": ["inventory.cycleCount.create", "inventory.placement.record"],
  // CX: the records clerk holds no Security Role either.
  "records-clerk": [],
});

/** The destinations a persona can open, computed through the CLIENT's real visibility functions. */
function destinationsFor(surfaces, { role = null, operationalRoles = [], employmentStatus = null } = {}) {
  const authority = buildNavigationAuthority({
    state: surfaces.length > 0 ? EXPERIENCE_STATE.READY : EXPERIENCE_STATE.REFUSED,
    context: { surfaces },
  });
  const operationalContext = { operationalRoles, employmentStatus, eosNavigationAuthority: authority };
  const out = [];
  for (const domain of NAV_DOMAINS) {
    if (!isDomainVisible(domain, role, [], operationalContext)) continue;
    for (const item of domain.subnav ?? []) {
      if (item.alwaysVisible) continue; // the dashboard index is not an access decision
      if (isNavItemVisible(item, role, [], operationalContext)) out.push(`${domain.key}/${item.key}`);
    }
  }
  return out.sort();
}

test("every persona in the governed manifest gets a destination set earned entirely by EOS authority", async () => {
  const observed = {};
  for (const personaKey of Object.keys(MANIFEST.personas)) {
    const surfaces = await grantedSurfaceKeys(
      actorWith(PERSONA_CAPABILITIES[personaKey] ?? []),
      dimensionsOf(personaKey),
    );
    observed[personaKey] = { surfaces: [...surfaces], destinations: destinationsFor([...surfaces]) };
  }

  // Written out rather than snapshotted: a reviewer has to be able to read who can open what.
  assert.deepEqual(observed["service-technician-a"], {
    surfaces: ["field.myWorkOrders", "service.workOrders"],
    destinations: [
      "service/coordinatedMission",
      "service/jobAssignments",
      "service/scan",
      "service/technicianWorkspace",
      "service/workOrders",
      "serviceOperations/serviceOperations",
    ],
  });

  // THE TECHNICIAN ON LEAVE. No Security Role, so no capability, so no door -- and nothing about
  // employmentStatus or operationalRoles was consulted to arrive at that.
  assert.deepEqual(observed["technician-on-leave"], { surfaces: [], destinations: [] });
  assert.deepEqual(observed["records-clerk"], { surfaces: [], destinations: [] });

  // THE PARTS PERSONA THE LEGACY MODEL COULD NOT EXPRESS. `partsAssociate` is not one of
  // admin|dispatcher|technician, so ROLE_NAV_ACCESS had nothing to say about it and the product had
  // no doors for it at all. It now has three, earned by capability.
  assert.deepEqual(observed["parts-associate"], {
    surfaces: ["inventory.catalog", "receiving.checkIn"],
    destinations: [
      "dashboard/operationsDashboard",
      "inventory/parts",
      "inventory/receiving",
      "purchasing/receipts",
      "service/scan",
    ],
  });

  // THE SURFACE WITH NO DOOR, ASSERTED RATHER THAN HIDDEN. The parts manager earns
  // `inventory.reorderQueue` -- reorder.request.read plus the governed REORDER_QUEUE scope -- and
  // navigation still cannot offer it, because no destination in navConfig IS the Reorder queue. That
  // is a real remaining gap in the cutover and it is declared in NAV_SURFACE_GAPS.
  assert.equal(observed["parts-manager"].surfaces.includes("inventory.reorderQueue"), true);
  assert.equal(observed["parts-manager"].destinations.some((d) => /reorder/i.test(d)), false);

  // THE WAREHOUSE ASSOCIATE: the count surface needs the capability AND WAREHOUSE_OPERATIONS AND a
  // warehouse scope. All three come from governed tables; none from a role string.
  assert.deepEqual(observed["warehouse-associate"], {
    surfaces: ["inventory.cycleCount.count", "warehouse.picking"],
    destinations: ["inventory/cycleCounts", "inventory/warehouseWorkspace", "service/scan"],
  });

  assert.deepEqual(observed.dispatcher.surfaces, [
    "inventory.reorderQueue",
    "service.coordinatedVisits",
    "service.dispatch",
    "service.workOrders",
  ]);
  assert.deepEqual(observed["owner-executive"].destinations, [
    "administration/auditLogs",
    "administration/dataImport",
    // The container's destination. It is here BECAUSE the three above are; the persona earns no
    // capability for it and none exists to earn.
    "administration/overview",
    "administration/users",
  ]);
});

test("TWO PERSONAS, ONE SECURITY ROLE, DIFFERENT DOORS -- the difference is a governed workforce row", async () => {
  // Technician A and the technician on leave are the same shape except for their Work Eligibility and
  // their Role assignment. Nothing in the client had to know that.
  const a = await grantedSurfaceKeys(actorWith(["workOrder.transition"]), dimensionsOf("service-technician-a"));
  const onLeave = await grantedSurfaceKeys(actorWith(["workOrder.transition"]), dimensionsOf("technician-on-leave"));
  assert.equal(a.includes("field.myWorkOrders"), true);
  assert.equal(onLeave.includes("field.myWorkOrders"), false, "no SERVICE_TECHNICIAN eligibility, no field workspace");
  assert.equal(onLeave.includes("service.workOrders"), true, "the unpredicated surface is unaffected");
});

// ════════════════════ THE FENCE: FIREBASE BUSINESS AUTHORITY IS GONE ════════════════════

test("once the EOS authority is present, users/{uid}.role and operationalRoles change NOTHING", async () => {
  const surfaces = [...(await grantedSurfaceKeys(
    actorWith(PERSONA_CAPABILITIES["parts-associate"]),
    dimensionsOf("parts-associate"),
  ))];
  const expected = destinationsFor(surfaces);

  // Every legacy business fact, swung as far as it goes. If any of them still had authority, one of
  // these would differ -- an `admin` role alone used to unlock eight legacyKeys and every
  // PLACEHOLDER_DEFAULT_ROLES destination in the product.
  const swings = [
    { role: "admin", operationalRoles: [], employmentStatus: "ACTIVE" },
    { role: "dispatcher", operationalRoles: [], employmentStatus: "ACTIVE" },
    { role: "technician", operationalRoles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER", "PARTS_ASSOCIATE"], employmentStatus: "ACTIVE" },
    { role: null, operationalRoles: [], employmentStatus: null },
    { role: "not-a-role", operationalRoles: ["ANYTHING"], employmentStatus: "TERMINATED" },
  ];
  for (const swing of swings) {
    assert.deepEqual(destinationsFor(surfaces, swing), expected, `legacy fact still had authority: ${JSON.stringify(swing)}`);
  }
});

test("an EOS authority that is not READY grants NOTHING -- there is no degrade to the legacy role", () => {
  for (const state of [EXPERIENCE_STATE.LOADING, EXPERIENCE_STATE.REFUSED, EXPERIENCE_STATE.UNAVAILABLE]) {
    const authority = buildNavigationAuthority({ state, context: { surfaces: ["crm.accounts", "service.workOrders"] } });
    const operationalContext = { operationalRoles: [], employmentStatus: "ACTIVE", eosNavigationAuthority: authority };
    for (const domain of NAV_DOMAINS) {
      for (const item of domain.subnav ?? []) {
        if (item.alwaysVisible) continue;
        assert.equal(
          // `admin` is the widest legacy role there is. It must open nothing here.
          isNavItemVisible(item, "admin", ["controlTower", "jobs", "technicians", "dispatch", "fieldMode", "inventory", "operations", "dispatcherBoard"], operationalContext),
          false,
          `${domain.key}/${item.key} was visible in state ${state}`,
        );
      }
    }
  }
});

test("the legacy source is untouched when no EOS authority is supplied", () => {
  // The seam is OFF in every environment today. An admin must still see exactly what an admin saw.
  const legacyContext = { operationalRoles: [], employmentStatus: "ACTIVE" };
  const adminKeys = ["controlTower", "jobs", "technicians", "dispatch", "fieldMode", "inventory", "operations", "dispatcherBoard"];
  const parts = NAV_DOMAINS.find((d) => d.key === "inventory").subnav.find((i) => i.key === "parts");
  const users = NAV_DOMAINS.find((d) => d.key === "administration").subnav.find((i) => i.key === "users");
  assert.equal(isNavItemVisible(parts, "admin", adminKeys, legacyContext), true);
  assert.equal(isNavItemVisible(users, "admin", adminKeys, legacyContext), true);
  assert.equal(isNavItemVisible(users, "technician", ["fieldMode", "jobs", "technicianDashboard"], legacyContext), false);
});
