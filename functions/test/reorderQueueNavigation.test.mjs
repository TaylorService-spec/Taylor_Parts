// NAVIGATION BLOCKER #4 -- THE REORDER QUEUE'S DOOR. Offline: no database, no emulator, no network.
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// `inventory.reorderQueue` was in EXPERIENCE_SURFACE_KEYS and was EARNABLE -- by
// `reorder.request.read.queue`, or by `reorder.request.read` plus the governed REORDER_QUEUE
// Operational Scope -- and ZERO entries in the client's NAV_SURFACE_ACCESS named it. A parts-manager
// persona therefore earned a surface navigation could not offer. The queue itself was reachable only
// as a disclosure rail inside Parts Catalog (gated by the CATALOG capabilities, a different authority
// answering a different question), from Part Detail, and from the notification bell -- none of which
// is a destination and none of which is governed by the queue's own authority.
//
// Inventory > Reorder Queue is the door. This file proves what it is gated on, and -- the part that
// matters more -- what it is NOT gated on.
//
// ════════════════════ FOUR AUTHORITIES, KEPT APART ════════════════════
//
//   Security capability   reorder.request.read          "may you perform this kind of read at all"
//   Work Eligibility      PARTS_OPERATIONS              "may you perform this CATEGORY OF WORK"
//   Operational Scope     REORDER_QUEUE                 "which operational QUEUE is visible"
//   Record Assignment     reorder_request_assignments   "is this particular record yours"
//
// The queue door asks the FIRST and the THIRD. It deliberately does not ask the second: PARTS_OPERATIONS
// is REORDER_ASSIGNMENT_QUALIFICATION -- the authority to BE ASSIGNED reorder work
// (functions/src/eosOps/reorderAssignmentAuthority.ts says so about itself) -- and folding it into the
// queue gate would turn an Operational Scope back into a Role by another name. It cannot ask the
// fourth: navigation names no record, and surfaceCatalogViolations() refuses a RECORD_ASSIGNMENT
// predicate on a surface for exactly that reason.
//
// ════════════════════ A REFUSAL MUST SAY WHICH REFUSAL IT IS ════════════════════
//
// `grantedSurfaceKeys` returns KEYS, so at the projection boundary every refusal looks identical --
// the surface is simply absent. That is correct for navigation (a door you were not granted should
// not explain itself in the rail) and it is NOT the whole system: the decision underneath is made by
// the same `authorizeObjectAction` every record action uses, and that evaluator distinguishes
// WORK_ELIGIBILITY_MISSING from OUTSIDE_OPERATIONAL_SCOPE from CAPABILITY_MISSING. This file drives
// the catalog's OWN grant paths through that evaluator so the two refusals are pinned distinct: a
// missing qualification must never be reported as "outside scope", and vice versa. Collapsing them
// would send an administrator to change the wrong authority.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  EXPERIENCE_SURFACES,
  EXPERIENCE_SURFACE_KEYS,
  grantedSurfaceKeys,
} from "../lib/eosOps/experienceAuthority.js";
import {
  authorizeObjectAction,
  snapshotContextualReader,
} from "../lib/eosOps/contextualAuthorization.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../..");
const clientModule = (...segments) =>
  new URL(`file://${path.join(REPO, "field-ops-app-vite", "src", ...segments).replace(/\\/g, "/")}`).href;

const { NAV_DOMAINS, NAV_SURFACE_ACCESS, NAV_SURFACE_GAPS, isDomainVisible, isNavItemVisible } =
  await import(clientModule("navigation", "navConfig.js"));
const { buildNavigationAuthority, EXPERIENCE_STATE } = await import(clientModule("access", "experienceContext.js"));

const MANIFEST = JSON.parse(
  readFileSync(path.join(here, "..", "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"),
);

const SURFACE = "inventory.reorderQueue";
const DESTINATION = "inventory/reorderQueue";
const QUEUE_SCOPE = "REORDER_QUEUE";

const actorWith = (capabilities) =>
  Object.freeze({ tenantId: "taylor-nonprod", principalId: "prn-test", capabilities: new Set(capabilities) });

const dimensionsOf = (personaKey) => {
  const persona = MANIFEST.personas[personaKey];
  assert.ok(persona, `the manifest has no persona "${personaKey}"`);
  return {
    employeeId: persona.employee,
    workEligibility: persona.workEligibility ?? [],
    operationalScopes: (persona.operationalScopes ?? []).map((s) => {
      const [scopeType, scopeId] = s.split(":");
      return { scopeType, scopeId };
    }),
  };
};

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

/**
 * THE MEASURED NONPROD DIMENSIONS, kept separate from the manifest's on purpose.
 *
 * `personaAuthorityDimensions.v1.json` is the INTENT: a platform-sandbox fixture whose operating
 * company key is `sample-co-synthetic`, and which declares REORDER_QUEUE for parts-associate as well
 * as parts-manager. The live nonprod rows are not that. They were written by migration
 * 1761696000000's one-time Role-derived preservation, which inserted a queue scope for the ACTIVE
 * linked Employees of six Security Roles -- admin, dispatcher, operationsManager, owner,
 * partsManager, purchasingManager -- against that tenant's OWN operating company key. `partsAssociate`
 * is not one of the six, so synthetic-np-emp-parts-associate holds PARTS_OPERATIONS and NO queue
 * scope there. Both are true of their own database, and the difference is the whole reason this file
 * states which one it is asserting on every persona.
 */
const NONPROD_MEASURED = Object.freeze({
  "parts-manager": Object.freeze({
    employeeId: "synthetic-np-emp-parts-manager",
    workEligibility: Object.freeze(["PARTS_OPERATIONS"]),
    operationalScopes: Object.freeze([Object.freeze({ scopeType: "REORDER_QUEUE", scopeId: "taylor" })]),
  }),
  // THE SCOPE-NEGATIVE PARTS PERSONA. Identical to the manager in every authority but one.
  "parts-associate": Object.freeze({
    employeeId: "synthetic-np-emp-parts-associate",
    workEligibility: Object.freeze(["PARTS_OPERATIONS"]),
    operationalScopes: Object.freeze([]),
  }),
});

// ════════════════════ AK1 / AK2: THE DOOR EXISTS AND IS THE RIGHT ONE ════════════════════

test("the Reorder queue surface has exactly one destination, and it is a first-class Inventory door", () => {
  const doors = Object.entries(NAV_SURFACE_ACCESS).filter(([, surfaces]) => surfaces.includes(SURFACE));
  assert.deepEqual(doors, [[DESTINATION, [SURFACE]]]);

  const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
  const item = inventory.subnav.find((i) => i.key === "reorderQueue");
  assert.ok(item, "Inventory must carry the Reorder Queue destination");
  assert.equal(item.path, "reorder-queue");
  assert.equal(item.navHidden, undefined, "a door that is earned must be offered, not hidden");

  // And the gap it used to be declared as is gone, by DESTINATION key and by the old surface key.
  assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_GAPS, DESTINATION), false);
  assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_GAPS, SURFACE), false);
});

test("the queue door is NOT re-homed onto the legacy operationalRoles domain", () => {
  // `inventoryRole` reads employees/{id}.operationalRoles and IS the Firebase business authority the
  // Work Eligibility / Operational Scope decomposition retires. Pointing the governed surface at it
  // would have been the cheap close and would have preserved the construct being removed.
  for (const item of NAV_DOMAINS.find((d) => d.key === "inventoryRole").subnav) {
    const key = `inventoryRole/${item.key}`;
    assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_ACCESS, key), false, `${key} must stay unmapped`);
    assert.ok(NAV_SURFACE_GAPS[key], `${key} must stay a declared gap`);
  }
});

test("the surface catalog gates the queue on capability plus SCOPE, and never on a qualification", () => {
  const entry = EXPERIENCE_SURFACES.find((s) => s.key === SURFACE);
  assert.ok(entry);
  assert.deepEqual(
    entry.grants.map((g) => ({
      capabilityKey: g.capabilityKey,
      predicates: (g.predicates ?? []).map((p) => `${p.kind}:${p.scopeType ?? p.qualificationCode}`),
    })),
    [
      { capabilityKey: "reorder.request.read.queue", predicates: [] },
      { capabilityKey: "reorder.request.read", predicates: [`OPERATIONAL_SCOPE:${QUEUE_SCOPE}`] },
    ],
  );
  // THE SEPARATION, ASSERTED AS AN ABSENCE. No path may require PARTS_OPERATIONS: that qualification
  // answers "may this Employee be ASSIGNED reorder work", which is not "may this Employee see the
  // shared queue". A WORK_ELIGIBILITY predicate appearing here would be a Role wearing a scope's name.
  for (const path of entry.grants) {
    for (const predicate of path.predicates ?? []) {
      assert.notEqual(predicate.kind, "WORK_ELIGIBILITY", "the queue is a scope question, not a qualification one");
      assert.notEqual(predicate.kind, "RECORD_ASSIGNMENT", "navigation names no record");
    }
  }
});

test("the destination is INVISIBLE under the legacy source, for every legacy role, with no EOS authority", () => {
  // The whole change is inert until EOS_NAVIGATION_AUTHORITY_READY makes the governed projection the
  // source. `capabilityAccess` with no `legacyKey` is the fail-closed shape: a negative or ABSENT
  // capability decision lands on `if (item.capabilityAccess) return false` and never reaches
  // PLACEHOLDER_DEFAULT_ROLES, so this door widens nobody's navigation today.
  const item = NAV_DOMAINS.find((d) => d.key === "inventory").subnav.find((i) => i.key === "reorderQueue");
  assert.deepEqual(item.capabilityAccess, ["reorder.request.read"]);
  assert.equal(item.legacyKey, undefined);
  for (const role of ["admin", "dispatcher", "technician", "partsManager", null]) {
    assert.equal(isNavItemVisible(item, role, ["inventory", "operations", "jobs", "fieldMode"], undefined), false);
    assert.equal(
      isNavItemVisible(item, role, ["inventory"], { operationalRoles: ["PARTS_MANAGER"], employmentStatus: "ACTIVE" }),
      false,
    );
    // Even a POSITIVE Firebase capability feed is not asked about this id today -- but if it ever is,
    // the answer must be the capability's, not the role list's. Asserted both ways so the shape is pinned.
    assert.equal(
      isNavItemVisible(item, role, ["inventory"], { hasCapability: () => true }),
      true,
      "a positive governed decision is the one thing the legacy path honours",
    );
    assert.equal(isNavItemVisible(item, role, ["inventory"], { hasCapability: () => false }), false);
  }
});

// ════════════════════ AK3: THE PERSONA PROOF ════════════════════

const PARTS_CAPABILITIES = Object.freeze(["reorder.request.read", "reorder.purchaseOrder.read", "inventory.catalog.read"]);

test("POSITIVE -- capability + PARTS_OPERATIONS + REORDER_QUEUE opens the queue door (measured nonprod dimensions)", async () => {
  const surfaces = [...(await grantedSurfaceKeys(actorWith(PARTS_CAPABILITIES), NONPROD_MEASURED["parts-manager"]))];
  assert.ok(surfaces.includes(SURFACE));
  assert.deepEqual(destinationsFor(surfaces), [
    "dashboard/operationsDashboard",
    "inventory/parts",
    DESTINATION,
    "purchasing/purchaseOrders",
  ]);
});

test("NEGATIVE -- the SAME capabilities and the SAME qualification, minus the queue scope, open no queue door", async () => {
  const positive = NONPROD_MEASURED["parts-manager"];
  const negative = NONPROD_MEASURED["parts-associate"];
  // The two personas differ in exactly one governed row. Stated as an assertion rather than as prose,
  // because a proof that the scope is what decided it is only a proof if nothing else differs.
  assert.deepEqual([...positive.workEligibility], [...negative.workEligibility]);
  assert.equal(negative.operationalScopes.length, 0);

  const surfaces = [...(await grantedSurfaceKeys(actorWith(PARTS_CAPABILITIES), negative))];
  assert.equal(surfaces.includes(SURFACE), false);
  assert.equal(destinationsFor(surfaces).includes(DESTINATION), false);
  // It loses the QUEUE and nothing else. A scope closed one door; it did not demote the persona.
  assert.deepEqual(surfaces, ["inventory.catalog", "purchasing.purchaseOrders"]);
});

test("NEGATIVE -- a technician stays negative WITHOUT being given Parts eligibility", async () => {
  // The technician HOLDS reorder.request.read in nonprod (it resolves for admin, dispatcher,
  // operationsManager, owner, partsManager, purchasingManager and technician). The scope predicate is
  // the only thing refusing them, and nothing here adds PARTS_OPERATIONS to a technician to make the
  // negative come out right -- doing so would destroy the case it is meant to prove.
  for (const personaKey of ["service-technician-a", "service-technician-b", "contract-technician"]) {
    const dimensions = dimensionsOf(personaKey);
    assert.equal(dimensions.workEligibility.includes("PARTS_OPERATIONS"), false, `${personaKey} must not hold PARTS_OPERATIONS`);
    assert.equal(dimensions.operationalScopes.some((s) => s.scopeType === QUEUE_SCOPE), false);
    const surfaces = [...(await grantedSurfaceKeys(actorWith(["workOrder.transition", "reorder.request.read"]), dimensions))];
    assert.equal(surfaces.includes(SURFACE), false, `${personaKey} must not earn the queue`);
    assert.equal(destinationsFor(surfaces).includes(DESTINATION), false);
  }
});

test("THE MANIFEST AND NONPROD DISAGREE ABOUT parts-associate, and the projection follows the DATA either way", async () => {
  // personaAuthorityDimensions.v1.json declares REORDER_QUEUE:sample-co-synthetic for parts-associate
  // (provesGate REORDER_QUEUE_SCOPE_PRESENT); the measured nonprod rows do not carry it, because
  // migration 1761696000000 preserved the scope from six Security Roles and partsAssociate is not one.
  // The divergence is recorded here rather than smoothed over, and the point of the assertion is that
  // the answer is a function of the ROWS and of nothing else -- not of the persona's name, job role or
  // Security Role.
  const manifestDimensions = dimensionsOf("parts-associate");
  assert.equal(manifestDimensions.operationalScopes.some((s) => s.scopeType === QUEUE_SCOPE), true);
  const fromManifest = [...(await grantedSurfaceKeys(actorWith(PARTS_CAPABILITIES), manifestDimensions))];
  const fromNonprod = [...(await grantedSurfaceKeys(actorWith(PARTS_CAPABILITIES), NONPROD_MEASURED["parts-associate"]))];
  assert.equal(fromManifest.includes(SURFACE), true, "with the scope row, the same persona earns the queue");
  assert.equal(fromNonprod.includes(SURFACE), false, "without it, the same persona does not");
});

// ════════════════════ AK3: THE TWO REFUSALS ARE DISTINGUISHABLE ════════════════════

/** Run ONE catalog grant path through the real evaluator and return its decision. */
const decide = (dimensions, capabilities, path) =>
  authorizeObjectAction(snapshotContextualReader(dimensions), {
    actor: actorWith(capabilities),
    capabilityKey: path.capabilityKey,
    predicates: path.predicates,
  });

test("a missing QUALIFICATION and a missing SCOPE are different refusals, with different predicates", async () => {
  const queue = EXPERIENCE_SURFACES.find((s) => s.key === SURFACE);
  const scopedPath = queue.grants.find((g) => (g.predicates ?? []).length > 0);
  // The cycle-count surface is the catalog's own WORK_ELIGIBILITY-first shape; using a real entry
  // rather than a hand-built predicate keeps this a proof about the catalog, not about a fixture.
  const countPath = EXPERIENCE_SURFACES.find((s) => s.key === "inventory.cycleCount.count").grants[0];
  assert.equal(countPath.predicates[0].kind, "WORK_ELIGIBILITY");
  assert.equal(countPath.predicates[0].qualificationCode, "WAREHOUSE_OPERATIONS");

  const partsAssociate = NONPROD_MEASURED["parts-associate"];

  // OUTSIDE SCOPE: holds the capability, holds a qualification, holds no queue scope.
  const scopeRefusal = await decide(partsAssociate, ["reorder.request.read"], scopedPath);
  assert.deepEqual(
    { allowed: scopeRefusal.allowed, reason: scopeRefusal.reason, predicate: scopeRefusal.predicate, detail: scopeRefusal.detail },
    { allowed: false, reason: "OUTSIDE_OPERATIONAL_SCOPE", predicate: "OPERATIONAL_SCOPE", detail: QUEUE_SCOPE },
  );

  // MISSING QUALIFICATION: holds the capability, holds PARTS_OPERATIONS, does NOT hold the one asked for.
  const qualificationRefusal = await decide(partsAssociate, ["inventory.cycleCount.create"], countPath);
  assert.deepEqual(
    {
      allowed: qualificationRefusal.allowed,
      reason: qualificationRefusal.reason,
      predicate: qualificationRefusal.predicate,
      detail: qualificationRefusal.detail,
    },
    { allowed: false, reason: "WORK_ELIGIBILITY_MISSING", predicate: "WORK_ELIGIBILITY", detail: "WAREHOUSE_OPERATIONS" },
  );

  // NEITHER IS THE OTHER. Both directions, because a one-way check would pass if the evaluator
  // returned one constant refusal for everything.
  assert.notEqual(scopeRefusal.reason, qualificationRefusal.reason);
  assert.notEqual(scopeRefusal.predicate, qualificationRefusal.predicate);

  // AND NEITHER IS "you hold nothing". A principal without the capability at all is refused BEFORE
  // any workforce row is read -- which is why a capability-less caller never causes an eos_workforce
  // query, and why an administrator is never sent to fix a scope that was not the problem.
  const capabilityRefusal = await decide(partsAssociate, [], scopedPath);
  assert.deepEqual(
    { allowed: capabilityRefusal.allowed, reason: capabilityRefusal.reason, predicate: capabilityRefusal.predicate },
    { allowed: false, reason: "CAPABILITY_MISSING", predicate: undefined },
  );

  // A principal with NO governed Employee is a fourth, distinct answer -- not "outside scope".
  const linkRefusal = await decide(
    { employeeId: null, workEligibility: [], operationalScopes: [] },
    ["reorder.request.read"],
    scopedPath,
  );
  assert.deepEqual(
    { allowed: linkRefusal.allowed, reason: linkRefusal.reason, predicate: linkRefusal.predicate },
    { allowed: false, reason: "EMPLOYEE_LINK_REQUIRED", predicate: "OPERATIONAL_SCOPE" },
  );

  assert.equal(new Set([
    scopeRefusal.reason, qualificationRefusal.reason, capabilityRefusal.reason, linkRefusal.reason,
  ]).size, 4);
});

test("the PROJECTION flattens all four refusals to one absent key -- recorded, not fixed here", async () => {
  // `grantedSurfaceKeys` answers in keys. That is right for a nav rail and it means the client cannot
  // tell WHY a door is missing; only the server's evaluator can. Pinned so nobody later reads the
  // absent key as evidence that the distinction does not exist, and so a future refusal-explaining
  // read is written against the evaluator rather than reconstructed in the client.
  const scopeless = [...(await grantedSurfaceKeys(actorWith(["reorder.request.read"]), NONPROD_MEASURED["parts-associate"]))];
  const capabilityless = [...(await grantedSurfaceKeys(actorWith([]), NONPROD_MEASURED["parts-manager"]))];
  const unlinked = [...(await grantedSurfaceKeys(actorWith(["reorder.request.read"]), { employeeId: null, workEligibility: [], operationalScopes: [] }))];
  for (const surfaces of [scopeless, capabilityless, unlinked]) assert.equal(surfaces.includes(SURFACE), false);
  assert.equal(EXPERIENCE_SURFACE_KEYS.includes(SURFACE), true);
});

// ════════════════════ POLICY_RECONCILIATION_REQUIRED ════════════════════

test("POLICY_RECONCILIATION_REQUIRED -- the catalog's first grant path names a SUPERSEDED capability", () => {
  // `reorder.request.read.queue` holds 0 grant rows in nonprod, and that is not a gap to be filled.
  // Migration 1761696000000 DELETED every grant to it and rewrote its description to
  // "SUPERSEDED by reorder.request.read plus the REORDER_QUEUE Operational Scope ... it must not be
  // granted again"; sampleCompany.v2.json repeats that it "may never be granted again". So the first
  // path of the queue surface is permanently unearnable, and the REAL queue authority is the second.
  //
  // NOT REMOVED HERE, deliberately: narrowing the security catalog is the Owner's call, not a
  // navigation lane's, and the path is inert at runtime while EOS_NAVIGATION_AUTHORITY_READY is false
  // in every environment. Pinned instead, so the reconciliation is a decision someone makes rather
  // than a comment someone believes. If the key is ever granted again, that grant would reach this
  // surface WITHOUT the REORDER_QUEUE scope -- which is the bypass the migration removed.
  const entry = EXPERIENCE_SURFACES.find((s) => s.key === SURFACE);
  const superseded = entry.grants[0];
  assert.equal(superseded.capabilityKey, "reorder.request.read.queue");
  assert.equal(superseded.predicates, undefined);
  assert.equal(
    (entry.grants.find((g) => g.capabilityKey === "reorder.request.read").predicates ?? []).length,
    1,
    "the earnable path must keep its scope predicate",
  );
});
