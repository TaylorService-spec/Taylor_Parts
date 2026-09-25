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
  experienceSurfaceGapViolations,
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

// ════════════════════ THE GAP REGISTER IS A CLAIM, AND CLAIMS GET CHECKED ════════════════════
//
// `commercial.agreements` declared "No salesAgreement.* capability is registered in
// eos_policy.capabilities" while four WERE registered and granted to six Roles -- including
// `salesperson`, the exact Role held by the persona the entry was written about. Nothing failed,
// because the only thing ever asserted about a gap was that its reason ran past 40 characters.
//
// These tests assert the SHAPE. experienceAuthorityPostgres.test.mjs asserts the same entries
// against the real eos_policy.capabilities table, which is the only place the claims are measurable.
test("every gap declares a checkable kind, and its evidence fields match that kind", () => {
  assert.deepEqual(experienceSurfaceGapViolations(), []);
  for (const gap of EXPERIENCE_SURFACE_GAPS) {
    assert.ok(["VOCABULARY", "DESTINATION", "NOT_A_DESTINATION"].includes(gap.kind), `${gap.key} has no kind`);
  }
});

test("a gap whose kind and evidence disagree is REFUSED, each way", () => {
  const long = "x".repeat(41);
  const cases = [
    [{ key: "a.b", kind: "VOCABULARY", reason: long }, /naming no absent capability prefix/],
    [{ key: "a.b", kind: "VOCABULARY", absentCapabilityPrefixes: ["z."], governedBy: "z.read", reason: long }, /it is a DESTINATION gap/],
    // THE INVERSE OF WHAT WENT WRONG HERE: a DESTINATION gap naming no governing capability is a
    // vocabulary claim wearing a destination label, and is refused for the same reason.
    [{ key: "a.b", kind: "DESTINATION", reason: long }, /naming no governing capability/],
    [{ key: "a.b", kind: "DESTINATION", governedBy: "z.read", absentCapabilityPrefixes: ["z."], reason: long }, /cannot both have and lack its vocabulary/],
    [{ key: "a.b", kind: "NOT_A_DESTINATION", governedBy: "z.read", reason: long }, /carries capability evidence/],
    [{ key: "a.b", kind: "SOMETHING_ELSE", reason: long }, /unknown gap kind/],
    [{ key: "a.b", kind: "NOT_A_DESTINATION", reason: "too short" }, /no real reason/],
  ];
  for (const [gap, pattern] of cases) {
    const problems = experienceSurfaceGapViolations([gap]);
    assert.ok(problems.length >= 1, `${gap.kind} was accepted and should not have been`);
    assert.ok(problems.some((p) => pattern.test(p)), `${gap.kind}: got ${JSON.stringify(problems)}`);
  }
});

// THE SPECIFIC CORRECTION, PINNED BY NAME -- not a style assertion. This entry is the one that was
// false, and the shape asserted here is the shape that makes its falseness measurable next time.
test("commercial.agreements is a DESTINATION gap governed by a real salesAgreement capability", () => {
  const gap = EXPERIENCE_SURFACE_GAPS.find((g) => g.key === "commercial.agreements");
  assert.ok(gap, "the commercial.agreements gap is gone -- declaring the surface requires a destination for it");
  assert.equal(gap.kind, "DESTINATION");
  assert.equal(gap.governedBy, "salesAgreement.read");
  assert.equal(gap.absentCapabilityPrefixes, undefined);
  // The old reason claimed the vocabulary did not exist. It must never say that again.
  assert.doesNotMatch(gap.reason, /No salesAgreement\.\* capability is registered/);
  assert.match(gap.reason, /DESTINATION GAP/);
});

// ════════ THE OTHER HALF OF A DESTINATION CLAIM: IS IT ACTUALLY HELD? ════════
//
// A DESTINATION gap asserts "the authority is already here and the door is not". Registration alone
// does not make that true -- a capability nobody holds is not an authority anybody has. The
// registration half is proved against the real table by experienceAuthorityPostgres.test.mjs; that
// database is migrated from clean and carries no seed grants, so the GRANT half cannot be measured
// there. It is measured here, against the recorded nonprod measurement this repository already
// keeps: adminPolicy/seed/roleCapabilityAuthorityBaseline.json.
//
// If that baseline ever shows the capability held by nobody, the gap has become a vocabulary-shaped
// problem again and the reason has to be rewritten -- which is precisely the transition nothing
// noticed last time, in the other direction.
test("every DESTINATION gap's governing capability is HELD in the recorded grant baseline", () => {
  const baseline = JSON.parse(
    readFileSync(path.join(here, "..", "src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json"), "utf8"),
  );
  const holders = new Map();
  for (const grant of baseline.grants) {
    if (!holders.has(grant.capabilityKey)) holders.set(grant.capabilityKey, new Set());
    holders.get(grant.capabilityKey).add(grant.roleKey);
  }
  const destinationGaps = EXPERIENCE_SURFACE_GAPS.filter((g) => g.kind === "DESTINATION");
  assert.ok(destinationGaps.length >= 1, "commercial.agreements is the one this exists for");
  for (const gap of destinationGaps) {
    const held = holders.get(gap.governedBy);
    assert.ok(
      held && held.size > 0,
      `${gap.key} claims ${gap.governedBy} already governs it, but ${baseline.environment} (measured ${baseline.measuredAt}) records no grant of it`,
    );
  }
  // The specific population the corrected reason states, so the sentence and the measurement cannot
  // drift apart silently.
  assert.deepEqual(
    [...holders.get("salesAgreement.read")].sort(),
    ["admin", "dispatcher", "generalManager", "owner", "salesManager", "salesperson"],
    "salesAgreement.read's holders have moved; the corrected commercial.agreements reason names them",
  );
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
  //
  // `administration.permissionPreview` rides in on the SAME `admin.principalAccess.read`, under the
  // Wave 10 Owner ruling: Permission Preview reads and evaluates a PRINCIPAL'S EFFECTIVE ACCESS, so
  // it is earned by the `principal` Object's own read exactly as Users & Employees is. It is listed
  // here rather than filtered out, because an administrative Principal reaching it with no linked
  // Employee is precisely the shape this test exists to hold still.
  assert.deepEqual(surfaces, [
    "administration.overview", "administration.permissionPreview", "administration.users",
    "service.workOrders",
  ]);
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
  // THE SPLIT THE WAVE 10 OWNER RULING DREW, and this table is where it is visible as a whole: the
  // security-policy CONFIGURATION read opens the configuration surfaces and stops there, and the
  // PRINCIPAL read opens the two surfaces that disclose a named Principal's effective access --
  // Users & Employees and Permission Preview. Permission Preview moved off
  // `admin.securityPolicy.read` because it reads and evaluates a principal's access, not the
  // Role x Object x action matrix; that the two keys are held by the same Roles today is a
  // coincidence of the current population and is deliberately not what this table is derived from.
  const expected = {
    "admin.securityPolicy.read": [
      "administration.objects", "administration.overview", "administration.rolesPermissions",
    ],
    "workflowDefinition.read": ["administration.overview", "administration.workflows"],
    "audit.event.read": ["administration.auditLogs", "administration.overview"],
    "admin.principalAccess.read": [
      "administration.overview", "administration.permissionPreview", "administration.users",
    ],
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
  // pointed the other way. NONE remains. `inventory.reorderQueue` was the last one: it is now mapped
  // to Inventory > Reorder Queue, the destination navigation blocker #4 said did not exist.
  //
  // THIS LIST MUST STAY EMPTY. Adding a surface to EXPERIENCE_SURFACES without a door for it
  // re-creates the exact defect -- a persona that earns something the product cannot offer -- and
  // "declare it a gap instead" is not an alternative here: a gap register that can absorb any new
  // surface stops being a blocker list.
  assert.deepEqual(unreachable, []);
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
      // WAVE 10 / LANE AR. Was `if (item.alwaysVisible) continue;`. Lane AM deleted
      // `alwaysVisible` outright and re-expressed the dashboard index as a CONTAINER, so that
      // filter silently stopped matching anything and the derived index started appearing in
      // every earned destination set. The intent is unchanged and is AM's own: a container is
      // DERIVED from the list being built, not granted, so it is not an access decision of its
      // own. field-ops-app-vite/test/navigationExperienceProjection.test.mjs:145 is the same
      // line in AM's copy of this helper.
      if (item.containerScope) continue;
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

  // THE SURFACE THAT HAD NO DOOR, NOW ASSERTED AS A DOOR. The parts manager earns
  // `inventory.reorderQueue` -- reorder.request.read plus the governed REORDER_QUEUE Operational
  // Scope, with no dedicated queue capability anywhere in its set -- and navigation now offers it at
  // Inventory > Reorder Queue. The whole persona is written out, because the point is that the queue
  // arrived WITHOUT anything else arriving with it: no inventoryRole destination, no receiving, no
  // warehouse. A scope opened one door.
  assert.deepEqual(observed["parts-manager"], {
    surfaces: ["inventory.catalog", "inventory.reorderQueue", "purchasing.purchaseOrders"],
    destinations: [
      "dashboard/operationsDashboard",
      "inventory/parts",
      "inventory/reorderQueue",
      "purchasing/purchaseOrders",
    ],
  });

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
  // THE OWNER EXECUTIVE HOLDS `admin.principalAccess.read` AND NOT `admin.securityPolicy.read`, and
  // under the Wave 10 Owner ruling that is exactly the crossed shape the ruling is about: it opens
  // Permission Preview -- a read and evaluation of a PRINCIPAL'S EFFECTIVE ACCESS -- and it is still
  // refused Roles & Permissions and Objects, which expose the policy CONFIGURATION. This persona is
  // the one place in the offline suite where the separation is observable on a manifest persona
  // rather than on a constructed capability set.
  // WAVE 12 / LANE AV: `administration/overview` LEAVES THIS LIST, and its absence is the container
  // rule working rather than an access change. The helper above skips every `containerScope`
  // destination, because a container is DERIVED from the list being built and is not an access
  // decision of its own -- `dashboard/my` has never appeared here for the same reason. The Owner's
  // Wave 12 ruling made Administration > Overview a container on the client too (one rule, both
  // sources), so it is now skipped by that same line. The persona's SURFACES are unchanged: the
  // server still derives `administration.overview` for them, and the assertion below measures the
  // destination directly instead of reading it out of a list the helper deliberately excludes.
  assert.deepEqual(observed["owner-executive"].destinations, [
    "administration/auditLogs",
    "administration/dataImport",
    "administration/permissionPreview",
    "administration/users",
  ]);
  assert.equal(observed["owner-executive"].surfaces.includes("administration.overview"), true,
    "the server stopped deriving the container for a persona that holds three of its children");
  // ...and the configuration surfaces stay shut, which is what makes the line above a separation
  // rather than a widening.
  assert.equal(observed["owner-executive"].destinations.includes("administration/rolesPermissions"), false);
  assert.equal(observed["owner-executive"].destinations.includes("administration/objects"), false);
});

// ═════ WAVE 12 / LANE AV: THE CONTAINER, MEASURED DIRECTLY, THROUGH THE CLIENT'S REAL PREDICATE ═════
//
// The helper above deliberately excludes containers from a persona's destination set, so the one
// question it cannot answer is whether the Administration index actually opens. That question is the
// Owner's Wave 12 ruling, and it is asked here against the same real projection: the persona's
// governed surfaces go in, `isNavItemVisible` answers, and no role literal is consulted anywhere.
test("the Administration index opens for the personas that earn a governed child, and for no others", async () => {
  const perPersona = {};
  for (const personaKey of Object.keys(MANIFEST.personas)) {
    perPersona[personaKey] = await grantedSurfaceKeys(
      actorWith(PERSONA_CAPABILITIES[personaKey] ?? []),
      dimensionsOf(personaKey),
    );
  }
  const administration = NAV_DOMAINS.find((d) => d.key === "administration");
  const overview = administration.subnav.find((i) => i.key === "overview");
  const overviewOpensFor = (surfaces, role) => {
    const authority = buildNavigationAuthority({
      state: surfaces.length > 0 ? EXPERIENCE_STATE.READY : EXPERIENCE_STATE.REFUSED,
      context: { surfaces },
    });
    return isNavItemVisible(overview, role, [], {
      operationalRoles: [], employmentStatus: null, eosNavigationAuthority: authority,
    });
  };

  // THE OWNER EXECUTIVE earns three of the six children, so the menu has three things on it.
  const ownerSurfaces = perPersona["owner-executive"];
  assert.equal(overviewOpensFor(ownerSurfaces, "owner"), true,
    "owner-executive holds administration.users/auditLogs/permissionPreview and gets no menu over them");

  // THE DISPATCHER earns NONE of them -- measured, not assumed -- so it gets no Administration index,
  // and passing the widest legacy role literal alongside cannot change that under the EOS source.
  const dispatcherSurfaces = perPersona.dispatcher;
  for (const childKey of ["administration.rolesPermissions", "administration.objects",
    "administration.workflows", "administration.permissionPreview", "administration.users",
    "administration.auditLogs"]) {
    assert.equal(dispatcherSurfaces.includes(childKey), false,
      `dispatcher has acquired ${childKey}, which changes what this test is measuring`);
  }
  assert.equal(overviewOpensFor(dispatcherSurfaces, "dispatcher"), false,
    "dispatcher reached the Administration index with no governed child behind it");
  assert.equal(overviewOpensFor(dispatcherSurfaces, "admin"), false,
    "a Firebase-era role literal reopened the Administration index under the EOS source");

  // AND EVERY OTHER PERSONA: the index opens exactly when a governed child did, never otherwise.
  const childSurfaces = EXPERIENCE_SURFACES.find((s) => s.key === "administration.overview").containerOf;
  for (const [personaKey, surfaces] of Object.entries(perPersona)) {
    const earnsAChild = childSurfaces.some((key) => surfaces.includes(key));
    assert.equal(overviewOpensFor(surfaces, "technician"), earnsAChild,
      `${personaKey}: the Administration index and its children disagree`);
  }
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
