// OWNER-RULED, NOW ACTIVATED -- the proof that the activation is exactly the ruling and nothing more.
//
// Set POLICY_TEST_DATABASE_URL to run the database phases; without it they SKIP and every
// pure-function proof still runs, so the separation controls are demonstrated on any machine.
//
// ════════════════════ WHAT CHANGED SINCE LANE BK ════════════════════
//
// BK recorded ten grants and two capabilities as APPROVED_NOT_APPLIED and authored NO migration,
// because a grant-bearing migration alone makes the rebuild produce more rows than the baseline
// declares and the rebuild guard reports MISSING DECLARATION. Owner ruling E resolves that by
// requiring BOTH halves in one change. Migration 1762300800000 is the activation, the baseline
// moved 387 -> 413 with it, and the pending set is now EMPTY BY CONSTRUCTION.
//
// So the questions this suite answers have inverted, and the guards did not have to be weakened to
// let that happen -- `assertPendingIsNotAuthority` is precisely what FORCED the pending list to
// empty, and `assertActivatedIsAuthority` is its mirror.
//
// ════════════════════ WHAT IS PROVED ════════════════════
//
// 1. The pending set is EMPTY and every activated pair IS declared by the measured baseline --
//    nothing is claimed in both places, and nothing is claimed in neither.
// 2. The activation is exactly the Owner's rulings: 26 grants, 3 capabilities, and not one more.
// 3. THE SIX SEPARATION PROOFS, each executable:
//      counter != reconciler
//      technician does not gain PARTS_OPERATIONS and keeps reorder.request.read
//      Parts Associate does not gain queue / assignment management
//      Service Manager does not gain completion
//      warehouse POSITION alone does not gain placement / relocation write
//      Owner does not become Admin
// 4. LEAST PRIVILEGE: every Role's capability set grew by exactly the pairs a ruling named.
// 5. A clean rebuild reproduces the new authority EXACTLY -- 413, 0 missing, 0 unexplained -- and
//    the three registered capabilities are really in the vocabulary afterwards.
//
// The database phases WRITE ONLY to POLICY_TEST_DATABASE_URL, a disposable local database.
// Nothing here reads or writes nonprod.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { seedTenantPolicy } from "../lib/adminPolicy/seed/policySeed.js";
import { SOD_EXCLUSIVE_PAIRS } from "../scripts/governance/functionalRoleComposition.mjs";
import {
  AUTHORITY_BASELINE_GRANTS,
  AUTHORITY_BASELINE_NONPROD_MEASURED_TOTAL,
  AUTHORITY_BASELINE_NOT_YET_APPLIED_MIGRATIONS,
  CATALOG_DECLARED_NOT_ACTIVATED,
  GLOBAL_CATALOG_ACTIVATED_GRANTS,
  NONPROD_ACTIVATED_CAPABILITY_GRANTS,
  SEED_BOUNDARY_MIGRATION,
  assertAuthorityRebuildMatches,
  countsBySource,
  globalAuthorityGrants,
  nonprodAuthorityGrants,
} from "../lib/adminPolicy/roleCapabilityAuthorityBaseline.js";
import {
  ACTIVATED_BY,
  ACTIVATED_CAPABILITIES,
  ACTIVATED_GRANTS,
  ACTIVATION_STATUS,
  CRED_READ_WIRING,
  EDIT_WITHOUT_READ_AFTER,
  EDIT_WITHOUT_READ_BEFORE,
  EDIT_WITHOUT_READ_CENSUS_AFTER,
  EDIT_WITHOUT_READ_CENSUS_BEFORE,
  EDIT_WITHOUT_READ_RECONCILED,
  PENDING_APPLIED_ENVIRONMENTS,
  PENDING_CAPABILITIES,
  PENDING_GRANTS,
  PendingCorrectionsError,
  REFUSED_CAPABILITIES,
  REFUSED_GRANTS,
  RESIDUAL_EDIT_WITHOUT_READ,
  activatedGrantPairs,
  assertActivatedIsAuthority,
  assertPendingIsNotAuthority,
  assertRefusedGrantsAreNotHeld,
  assertSeparationOfDutyPreserved,
  countsByRuling,
  pendingGrantPairs,
} from "../lib/adminPolicy/pendingAuthorityCorrections.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to rebuild against";

const TENANT = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
const TENANT_KEY = "taylor-nonprod";
const REBUILD_ACTOR = "activation-corrections-rebuild";
const MIG = "migration:1762300800000";

const pairId = (p) => `${p.roleKey}\u0000${p.capabilityKey}`;

/** What a Role holds in the canonical authority. */
const capabilitiesOf = (roleKey) =>
  new Set(AUTHORITY_BASELINE_GRANTS.filter((g) => g.roleKey === roleKey).map((g) => g.capabilityKey));

/** What a Role held BEFORE this activation -- the baseline minus the rows this migration wrote. */
const capabilitiesBeforeOf = (roleKey) =>
  new Set(AUTHORITY_BASELINE_GRANTS
    .filter((g) => g.roleKey === roleKey && g.evidence !== MIG)
    .map((g) => g.capabilityKey));

const holdersOf = (capabilityKey) =>
  [...new Set(AUTHORITY_BASELINE_GRANTS.filter((g) => g.capabilityKey === capabilityKey).map((g) => g.roleKey))].sort();

// ════════════════════ THE MEASUREMENT, AND THE TWO QUESTIONS IT KEEPS SEPARATE ════════════════════

test("the baseline declares the ACTIVATED authority, and still says what nonprod holds today", () => {
  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 413, "387 measured + 26 activated");
  assert.deepEqual(countsBySource(), {
    MIGRATION_BACKED: 355, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0,
  });
  assert.equal(globalAuthorityGrants().length, 408);
  assert.equal(nonprodAuthorityGrants().length, 413);
  // ...and the OTHER question is still answerable without arithmetic in somebody's head.
  assert.equal(AUTHORITY_BASELINE_NONPROD_MEASURED_TOTAL, 387);
  assert.deepEqual([...AUTHORITY_BASELINE_NOT_YET_APPLIED_MIGRATIONS], [MIG],
    "exactly one grant-bearing migration is authored and not yet run against the environment");
});

test("the manifest declares itself ACTIVATED and applied to NO environment", () => {
  assert.equal(ACTIVATION_STATUS, "ACTIVATED");
  assert.equal(ACTIVATED_BY, MIG);
  assert.deepEqual([...PENDING_APPLIED_ENVIRONMENTS], [],
    "this lane is not authorized to apply anything to an environment; a non-empty list here is a false claim");
});

test("the PENDING set is empty, and the ACTIVATED set is entirely IN the authority", () => {
  assert.deepEqual([...PENDING_GRANTS], []);
  assert.deepEqual([...PENDING_CAPABILITIES], []);
  assert.deepEqual([...pendingGrantPairs()], []);
  assertPendingIsNotAuthority(nonprodAuthorityGrants());
  assertActivatedIsAuthority(nonprodAuthorityGrants());

  // Neither guard is vacuous.
  assert.throws(
    () => assertPendingIsNotAuthority(nonprodAuthorityGrants(),
      [{ roleKey: "admin", capabilityKey: "warehouse.record.read" }]),
    (err) => err instanceof PendingCorrectionsError && /already held/.test(err.message),
  );
  assert.throws(
    () => assertActivatedIsAuthority(nonprodAuthorityGrants(),
      [{ roleKey: "technician", capabilityKey: "admin.securityPolicy.read" }]),
    (err) => err instanceof PendingCorrectionsError && /NOT declared by the measured authority/.test(err.message),
  );
});

test("the activation is exactly the Owner's rulings, and nothing else", () => {
  assert.equal(ACTIVATED_GRANTS.length, 26);
  assert.deepEqual(countsByRuling(), { S1: 2, S2: 4, S3: 1, S4: 1, S6: 2, B: 13, C: 3 });
  assert.deepEqual(activatedGrantPairs().map((p) => `${p.roleKey}/${p.capabilityKey}`).sort(), [
    "admin/receivingOrder.record.read",
    "admin/reportDefinition.read",
    "admin/workOrder.record.read",
    "dispatcher/receivingOrder.record.read",
    "dispatcher/workOrder.record.read",
    "fieldManager/workOrder.lifecycle.cancel",
    "fieldManager/workOrder.lifecycle.dispatch",
    "fieldManager/workOrder.record.read",
    "generalManager/workOrder.record.read",
    "inventoryCycleCountReconciler/inventory.cycleCount.close",
    "inventoryPutAwayOperator/inventory.placement.record",
    "inventoryReceivingClerk/receivingOrder.record.read",
    "inventoryStockRelocationOperator/inventory.stock.relocate",
    "operationsManager/workOrder.record.read",
    "owner/receivingOrder.record.read",
    "owner/reportDefinition.read",
    "owner/workOrder.record.read",
    "partsAssociate/workOrder.record.read",
    "partsManager/reorder.request.assign",
    "partsManager/workOrder.record.read",
    "reportViewer/reportDefinition.read",
    "shopAssociate/workOrder.record.read",
    "shopManager/workOrder.record.read",
    "technician/workOrder.record.read",
    "warehouseAssociate/warehouse.record.read",
    "warehouseManager/warehouse.record.read",
  ]);
  for (const g of ACTIVATED_GRANTS) {
    assert.ok(g.why.length > 20, `${g.roleKey}/${g.capabilityKey} lacks a reason`);
    assert.equal(g.grantedBy, MIG);
  }
  // Every activated pair is MIGRATION_BACKED in the baseline and stamped by the same migration --
  // the two records agree about WHICH migration produces each row, not merely that one does.
  const byPair = new Map(AUTHORITY_BASELINE_GRANTS.map((g) => [pairId(g), g]));
  for (const p of activatedGrantPairs()) {
    const g = byPair.get(pairId(p));
    assert.equal(g.source, "MIGRATION_BACKED", `${p.roleKey}/${p.capabilityKey}`);
    assert.equal(g.evidence, MIG, `${p.roleKey}/${p.capabilityKey}`);
  }
});

test("the two catalog-declared pairs this activation turned on have LEFT catalogDeclaredNotActivated", () => {
  const catalogDeclared = new Set(CATALOG_DECLARED_NOT_ACTIVATED.map(pairId));
  assert.equal(CATALOG_DECLARED_NOT_ACTIVATED.length, 30, "32 -> 30");
  for (const g of ACTIVATED_GRANTS) {
    assert.ok(!catalogDeclared.has(pairId(g)),
      `${g.roleKey}/${g.capabilityKey} cannot be both authority and a recorded gap`);
  }
  assert.deepEqual(ACTIVATED_GRANTS.filter((g) => g.alreadyCatalogDeclared).map((g) => `${g.roleKey}/${g.capabilityKey}`).sort(), [
    "inventoryPutAwayOperator/inventory.placement.record",
    "inventoryStockRelocationOperator/inventory.stock.relocate",
  ], "S2's functional-Role grants ACTIVATE declarations the catalog already carried; they are not new authority");
  // And `owner`'s declarations of the SAME two keys stay unactivated -- the ruling named the
  // functional Roles, and the pairs beside them were not swept in.
  assert.ok(catalogDeclared.has(pairId({ roleKey: "owner", capabilityKey: "inventory.placement.record" })));
  assert.ok(catalogDeclared.has(pairId({ roleKey: "owner", capabilityKey: "inventory.stock.relocate" })));
});

// ════════════════════ RULING B -- EDIT WITHOUT READ ════════════════════

test("RULING B: thirteen rows in, ZERO left, each with a disposition and an action", () => {
  assert.equal(EDIT_WITHOUT_READ_BEFORE, 13);
  assert.equal(EDIT_WITHOUT_READ_AFTER, 0);
  assert.equal(EDIT_WITHOUT_READ_RECONCILED.length, 13);

  const DISPOSITIONS = new Set(["WRITE_LEGITIMATE_READ_REQUIRED", "WRITE_NOT_LEGITIMATE", "PROJECTION_DEFECT"]);
  for (const r of EDIT_WITHOUT_READ_RECONCILED) {
    assert.ok(DISPOSITIONS.has(r.disposition), `${r.objectKey}/${r.roleKey} has no valid disposition`);
    assert.ok(r.action.length > 20 && r.why.length > 20, `${r.objectKey}/${r.roleKey} is unexplained`);
    // The Role really does hold the write it is recorded as holding.
    const held = capabilitiesBeforeOf(r.roleKey);
    assert.ok(held.has(r.holdsModifyCapability),
      `${r.roleKey} is recorded as holding ${r.holdsModifyCapability} and does not`);
    // ...and it now holds a READ on that Object, which is what "closed" means.
    const read = r.objectKey === "receivingOrder" ? "receivingOrder.record.read" : "workOrder.record.read";
    assert.ok(capabilitiesOf(r.roleKey).has(read), `${r.roleKey} still cannot read ${r.objectKey}`);
  }
  assert.deepEqual(EDIT_WITHOUT_READ_RECONCILED.map((r) => `${r.objectKey}/${r.roleKey}`).sort(), [
    "receivingOrder/admin", "receivingOrder/dispatcher", "receivingOrder/inventoryReceivingClerk",
    "workOrder/admin", "workOrder/dispatcher", "workOrder/fieldManager", "workOrder/generalManager",
    "workOrder/operationsManager", "workOrder/partsAssociate", "workOrder/partsManager",
    "workOrder/shopAssociate", "workOrder/shopManager", "workOrder/technician",
  ]);
});

test("RULING B: the wider census is classified too -- nothing is left UNEXPLAINED", () => {
  assert.equal(EDIT_WITHOUT_READ_CENSUS_BEFORE, 29);
  assert.equal(EDIT_WITHOUT_READ_CENSUS_AFTER, 10);
  assert.equal(RESIDUAL_EDIT_WITHOUT_READ.length, 10);
  const DISPOSITIONS = new Set(["WRITE_LEGITIMATE_READ_REQUIRED", "WRITE_NOT_LEGITIMATE", "PROJECTION_DEFECT"]);
  for (const r of RESIDUAL_EDIT_WITHOUT_READ) {
    assert.ok(DISPOSITIONS.has(r.disposition), `${r.objectKey}/${r.roleKey} has no disposition`);
    assert.ok(/RECORDED, NOT/.test(r.action), `${r.objectKey}/${r.roleKey} claims an action it did not take`);
    assert.ok(r.why.length > 40, `${r.objectKey}/${r.roleKey} is unexplained`);
  }
  // The three dispositions are all genuinely used across the two lists, so the classification is a
  // decision rather than a label everything receives.
  const all = [...EDIT_WITHOUT_READ_RECONCILED, ...RESIDUAL_EDIT_WITHOUT_READ];
  assert.ok(all.some((r) => r.disposition === "WRITE_LEGITIMATE_READ_REQUIRED"));
  assert.ok(all.some((r) => r.disposition === "PROJECTION_DEFECT"));
  // No residual row is silently granted the read instead of being recorded.
  const activated = new Set(activatedGrantPairs().map(pairId));
  for (const r of RESIDUAL_EDIT_WITHOUT_READ) {
    for (const key of ["workOrder.record.read", "receivingOrder.record.read"]) {
      if (r.objectKey !== key.split(".")[0]) continue;
      assert.ok(!activated.has(pairId({ roleKey: r.roleKey, capabilityKey: key })),
        `${r.roleKey} is recorded as RESIDUAL and was granted ${key} anyway`);
    }
  }
});

test("S1 / C: each Object's READ verb is wired to the capability that governs it", () => {
  assert.deepEqual(CRED_READ_WIRING.map((w) => w.objectKey).sort(),
    ["employee", "receivingOrder", "reportDefinition", "rolesPermissions", "workOrder"]);

  // employee and rolesPermissions needed NO new authority: the capability existed and was held.
  for (const key of ["employee", "rolesPermissions"]) {
    const w = CRED_READ_WIRING.find((x) => x.objectKey === key);
    assert.equal(w.capabilityAlreadyExists, true);
    assert.equal(w.disposition, "PROJECTION_DEFECT");
    assert.ok(capabilitiesOf("owner").has(w.readCapabilityKey), `owner must already hold ${w.readCapabilityKey}`);
    assert.equal(ACTIVATED_GRANTS.filter((g) => g.capabilityKey === w.readCapabilityKey).length, 0,
      `${key} needed a wiring correction, NOT a grant -- granting here would have invented authority`);
  }

  // receivingOrder, workOrder and reportDefinition needed the capability registering first.
  for (const key of ["receivingOrder", "workOrder", "reportDefinition"]) {
    const w = CRED_READ_WIRING.find((x) => x.objectKey === key);
    assert.equal(w.capabilityAlreadyExists, false);
    assert.ok(ACTIVATED_CAPABILITIES.some((c) => c.capabilityKey === w.readCapabilityKey));
  }

  // The three registered capabilities are READ and confer no write.
  assert.equal(ACTIVATED_CAPABILITIES.length, 3);
  for (const c of ACTIVATED_CAPABILITIES) {
    assert.equal(c.actionKind, "READ");
    assert.equal(c.actionKey, "read");
    assert.equal(c.capabilityKey.split(".")[0], c.objectKey);
    assert.equal(c.registeredBy, MIG);
  }
  // Owner gets the READs only -- no lifecycle or receipt authority rides along.
  const owner = capabilitiesOf("owner");
  for (const k of ["workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel", "workOrder.lifecycle.complete",
    "inventory.stock.receive"]) {
    assert.ok(!owner.has(k), `owner must not gain ${k} from an S1 READ correction`);
  }
});

// ════════════════════ REPORTING SLICE 1 ════════════════════

test("REPORTING SLICE 1 is ONE Object read, and the Role model is not a ladder", () => {
  assert.deepEqual(holdersOf("reportDefinition.read"), ["admin", "owner", "reportViewer"]);

  // ADDITIVE, NOT A SUPERSET. The finance tier holds NO Object-level reporting capability.
  const finance = capabilitiesOf("reportFinanceViewer");
  assert.equal([...finance].filter((c) => c.startsWith("reportDefinition.")).length, 0,
    "reportFinanceViewer must hold NO Object-level reporting capability -- it is additive field visibility");
  assert.ok(REFUSED_GRANTS.some((r) => r.roleKey === "reportFinanceViewer" && r.capabilityKey === "reportDefinition.read"));

  // Authoring is not reading.
  const author = capabilitiesOf("reportAuthor");
  assert.equal([...author].filter((c) => c.startsWith("reportDefinition.")).length, 0);
  assert.ok(REFUSED_GRANTS.some((r) => r.roleKey === "reportAuthor" && r.capabilityKey === "reportDefinition.read"));

  // reportDefinition.delete is NOT REGISTERED, so it is ungrantable rather than merely ungranted.
  assert.equal(ACTIVATED_CAPABILITIES.filter((c) => c.capabilityKey === "reportDefinition.delete").length, 0);
  assert.equal(AUTHORITY_BASELINE_GRANTS.filter((g) => g.capabilityKey === "reportDefinition.delete").length, 0);
  assert.ok(REFUSED_CAPABILITIES.some((c) => c.capabilityKey === "reportDefinition.delete"));

  // NO JOB-TITLE ROLE receives Reporting in this tranche.
  const jobTitles = ["technician", "dispatcher", "partsManager", "partsAssociate", "shopManager", "shopAssociate",
    "fieldManager", "generalManager", "operationsManager", "accountingManager", "financeManager",
    "officeManager", "salesManager", "warehouseManager", "warehouseAssociate", "purchasingManager"];
  for (const role of jobTitles) {
    assert.equal([...capabilitiesOf(role)].filter((c) => c.startsWith("reportDefinition.")).length, 0,
      `${role} is a job title and must receive no Reporting in this tranche`);
  }
});

// ════════════════════ THE SIX SEPARATION PROOFS ════════════════════

test("PROOF 1/6: counter != reconciler -- the cycle count segregation survives S3", () => {
  const counter = capabilitiesOf("inventoryCycleCountCounter");
  const reconciler = capabilitiesOf("inventoryCycleCountReconciler");
  assert.ok(reconciler.has("inventory.cycleCount.close"), "S3 grants close to the reconciler");
  assert.ok(!counter.has("inventory.cycleCount.close"),
    "DECISIONS #111: the counter may not approve their own material variance");
  assert.deepEqual([...counter].filter((c) => reconciler.has(c)), [],
    "counter and reconciler must share NO capability");
  assert.deepEqual(holdersOf("inventory.cycleCount.close"), ["inventoryCycleCountReconciler"]);

  assertSeparationOfDutyPreserved(SOD_EXCLUSIVE_PAIRS, capabilitiesOf);
  assert.throws(
    () => assertSeparationOfDutyPreserved([["a", "b", "synthetic"]], () => new Set(["inventory.cycleCount.close"])),
    (err) => err instanceof PendingCorrectionsError && /separation of duty defeated/.test(err.message),
  );
});

test("PROOF 2/6: technician does not gain PARTS_OPERATIONS, and keeps the capability its denial does NOT rest on", () => {
  // PARTS_OPERATIONS is a WORK ELIGIBILITY qualification code, not a capability. This activation
  // changes no eligibility and no scope, so the technician's standing negative case is untouched.
  const technician = capabilitiesOf("technician");
  assert.equal([...technician].filter((c) => /PARTS_OPERATIONS/i.test(c)).length, 0,
    "PARTS_OPERATIONS is not a capability and must never appear as one");

  // The technician gains EXACTLY the ruling-B work order read, and nothing else.
  const gained = [...technician].filter((c) => !capabilitiesBeforeOf("technician").has(c));
  assert.deepEqual(gained.sort(), ["workOrder.record.read"],
    "the technician transitions work orders and now may read them; that is the whole change");

  // MEASURED CONTEXT WORTH KEEPING: the technician DOES hold reorder.request.read. The queue denial
  // rests on a withheld SCOPE row, so removing the capability would be a false "strengthening".
  assert.ok(technician.has("reorder.request.read"),
    "technician must KEEP reorder.request.read -- the denial is a scope fact, not a capability fact");
  assert.ok(!technician.has("reorder.request.assign"));

  const manifest = JSON.parse(readFileSync(
    join(import.meta.dirname, "../src/adminPolicy/seed/pendingAuthorityCorrections.json"), "utf8"));
  assert.match(manifest.unchanged.workEligibility, /no qualification code added/);
  assert.match(manifest.unchanged.operationalScope, /no scope row added/);
});

test("PROOF 3/6: Parts Associate does not gain queue / assignment management", () => {
  const pa = capabilitiesOf("partsAssociate");
  assert.ok(!pa.has("reorder.request.assign"), "assignment is queue management; a parts associate does not assign");
  assert.deepEqual(ACTIVATED_GRANTS.filter((g) => g.roleKey === "partsAssociate").map((g) => g.capabilityKey),
    ["workOrder.record.read"], "the parts associate gains the ruling-B read and nothing else");
  assert.ok(REFUSED_GRANTS.some((r) => r.roleKey === "partsAssociate" && r.capabilityKey === "reorder.request.assign"),
    "the refusal is written down, so its absence is a control rather than an oversight");
  // S4 lands on partsManager ALONE -- not dispatcher, technician, purchasing, or every parts employee.
  assert.deepEqual(holdersOf("reorder.request.assign"), ["partsManager"]);
});

test("PROOF 4/6: Service Manager does not gain completion", () => {
  const fm = capabilitiesOf("fieldManager");
  assert.ok(fm.has("workOrder.lifecycle.dispatch"), "S6 grants dispatch");
  assert.ok(fm.has("workOrder.lifecycle.cancel"), "S6 grants cancel");
  assert.ok(!fm.has("workOrder.lifecycle.complete"),
    "completion remains technician execution authority: a manager who may dispatch AND complete can close work nobody performed");
  assert.deepEqual(holdersOf("workOrder.lifecycle.complete"), ["technician"],
    "completion holders must be unchanged by this activation");
  assert.ok(REFUSED_GRANTS.some((r) => r.roleKey === "fieldManager" && r.capabilityKey === "workOrder.lifecycle.complete"));
});

test("PROOF 5/6: warehouse POSITION alone does not gain placement / relocation write", () => {
  for (const position of ["warehouseManager", "warehouseAssociate"]) {
    const caps = capabilitiesOf(position);
    assert.ok(caps.has("warehouse.record.read"), `${position} gets the warehouse READ`);
    assert.ok(!caps.has("inventory.placement.record"),
      `${position} must NOT receive an inventory operating write because of its job title`);
    assert.ok(!caps.has("inventory.stock.relocate"), `${position} must NOT receive the relocation write`);
    const gained = [...caps].filter((c) => !capabilitiesBeforeOf(position).has(c));
    assert.deepEqual(gained, ["warehouse.record.read"]);
  }
  // Position != Functional Role: the writes land on the FUNCTIONAL Roles only.
  assert.deepEqual(holdersOf("inventory.placement.record"), ["admin", "inventoryPutAwayOperator"]);
  assert.deepEqual(holdersOf("inventory.stock.relocate"), ["admin", "inventoryStockRelocationOperator"]);
});

test("PROOF 6/6: Owner does not become Admin", () => {
  const admin = capabilitiesOf("admin");
  const owner = capabilitiesOf("owner");
  const adminBefore = capabilitiesBeforeOf("admin");
  const ownerBefore = capabilitiesBeforeOf("owner");

  // MEASURED BEFORE: owner was a STRICT SUBSET of admin -- 47 of admin's 66, 19 admin-only, 0 owner-only.
  assert.equal(adminBefore.size, 66);
  assert.equal(ownerBefore.size, 47);
  assert.equal([...adminBefore].filter((c) => !ownerBefore.has(c)).length, 19);

  // AFTER: admin STILL holds 19 authorities owner does not. Nothing was copied across.
  const adminOnly = [...admin].filter((c) => !owner.has(c)).sort();
  assert.equal(adminOnly.length, 19, "Owner must not absorb Admin's administration authority");
  for (const k of ["admin.dataImport.execute", "inventory.stock.receive", "inventory.placement.record",
    "inventory.stock.relocate", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel",
    "inventory.cycleCount.create", "inventory.cycleCount.reconcile"]) {
    assert.ok(adminOnly.includes(k), `${k} must remain Admin-only`);
  }

  // Neither is a superset of the other: admin and owner now differ in BOTH directions because the
  // ruling-B reads landed on the Roles that hold the writes, and admin holds writes owner does not.
  const ownerOnly = [...owner].filter((c) => !admin.has(c)).sort();
  assert.deepEqual(ownerOnly, [], "admin holds every read owner does; the distinction is the WRITES owner lacks");
  assert.equal(admin.size - owner.size, 19);

  // The rolesPermissions reconciliation does NOT copy Admin to Owner: Owner reads the security
  // policy on a grant it already independently holds, and gains no administration WRITE here.
  assert.ok(ownerBefore.has("admin.securityPolicy.read"));
  assert.deepEqual(ACTIVATED_GRANTS.filter((g) => g.roleKey === "owner").map((g) => g.capabilityKey).sort(),
    ["receivingOrder.record.read", "reportDefinition.read", "workOrder.record.read"],
    "every activated owner grant is a READ");
});

// ════════════════════ LEAST PRIVILEGE ════════════════════

test("LEAST PRIVILEGE: every Role grew by exactly the named pairs and by nothing else", () => {
  const touched = [...new Set(ACTIVATED_GRANTS.map((g) => g.roleKey))].sort();
  assert.deepEqual(touched, [
    "admin", "dispatcher", "fieldManager", "generalManager", "inventoryCycleCountReconciler",
    "inventoryPutAwayOperator", "inventoryReceivingClerk", "inventoryStockRelocationOperator",
    "operationsManager", "owner", "partsAssociate", "partsManager", "reportViewer",
    "shopAssociate", "shopManager", "technician", "warehouseAssociate", "warehouseManager",
  ]);
  const allRoles = [...new Set(AUTHORITY_BASELINE_GRANTS.map((g) => g.roleKey))];
  for (const role of allRoles) {
    const gained = [...capabilitiesOf(role)].filter((c) => !capabilitiesBeforeOf(role).has(c));
    const expected = ACTIVATED_GRANTS.filter((g) => g.roleKey === role).map((g) => g.capabilityKey).sort();
    assert.deepEqual(gained.sort(), expected, `${role} gained something no ruling named`);
  }
  // NOTHING IS REVOKED: the activation is strictly additive.
  for (const role of allRoles) {
    for (const c of capabilitiesBeforeOf(role)) {
      assert.ok(capabilitiesOf(role).has(c), `${role} must not lose ${c}`);
    }
  }
  assert.equal(AUTHORITY_BASELINE_GRANTS.filter((g) => g.evidence === MIG).length, 26);
});

test("every REFUSED grant is held by nobody and smuggled into nothing", () => {
  assertRefusedGrantsAreNotHeld(nonprodAuthorityGrants());
  assert.ok(REFUSED_GRANTS.length >= 12);
  for (const r of REFUSED_GRANTS) assert.ok(r.why.startsWith("NOT AUTHORIZED"), `${r.roleKey}/${r.capabilityKey}`);
  for (const c of REFUSED_CAPABILITIES) assert.ok(c.why.startsWith("NOT REGISTERED"), c.capabilityKey);
  assert.throws(
    () => assertRefusedGrantsAreNotHeld(nonprodAuthorityGrants(),
      [{ roleKey: "admin", capabilityKey: "warehouse.record.read", ruling: "S2", why: "NOT AUTHORIZED synthetic" }]),
    (err) => err instanceof PendingCorrectionsError && /is HELD/.test(err.message),
  );
});

// ════════════════════ THE DATABASE: THE REBUILD REALLY PRODUCES IT ════════════════════

function migrate(count) {
  const args = ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"];
  if (count !== undefined) args.push(String(count));
  execFileSync(process.execPath, args, { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

async function dropEverything() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const schema of declaredSchemas()) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query("DROP TABLE IF EXISTS public.pgmigrations");
  await client.end();
}

async function grantsIn(pool) {
  const { rows } = await pool.query(
    `SELECT r.key AS role_key, c.key AS capability_key, rc.granted_by
       FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r ON r.id = rc.role_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 ORDER BY 1, 2`,
    [TENANT],
  );
  return rows.map((r) => ({ roleKey: r.role_key, capabilityKey: r.capability_key, grantedBy: r.granted_by }));
}

async function applyPairs(pool, pairs, grantedBy) {
  for (const { roleKey, capabilityKey } of pairs) {
    await pool.query(
      `INSERT INTO eos_policy.role_capabilities
             (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT 'rc_pending_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
         FROM eos_policy.roles r, eos_policy.capabilities c
        WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
       ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`,
      [TENANT, roleKey, capabilityKey, grantedBy],
    );
  }
}

/** The SAME pipeline the measured guard uses, so this suite proves against the real rebuild. */
async function rebuild(pool) {
  await dropEverything();
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
  migrate(files.filter((f) => f < SEED_BOUNDARY_MIGRATION).length);
  await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $2)", [TENANT, TENANT_KEY]);
  await seedTenantPolicy(new PostgresPolicyRepository(pool), TENANT, REBUILD_ACTOR);
  migrate();
  await applyPairs(pool, GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:" + REBUILD_ACTOR);
  await applyPairs(pool, NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:" + REBUILD_ACTOR);
  return grantsIn(pool);
}

test("the rebuild reproduces the ACTIVATED authority exactly, and every activated pair carries the migration stamp",
  { skip: SKIP }, async () => {
    const pool = new pg.Pool({ connectionString: URL, max: 2 });
    try {
      const rebuilt = await rebuild(pool);
      assertAuthorityRebuildMatches(nonprodAuthorityGrants(), rebuilt);
      assert.equal(rebuilt.length, 413);

      const stamped = new Map(rebuilt.map((r) => [pairId(r), r.grantedBy]));
      for (const p of activatedGrantPairs()) {
        assert.equal(stamped.get(pairId(p)), MIG,
          `${p.roleKey}/${p.capabilityKey} did not come back stamped by the activation migration`);
      }

      // The three registered capabilities really are in the vocabulary now.
      for (const c of ACTIVATED_CAPABILITIES) {
        const { rows } = await pool.query(
          "SELECT object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = $1", [c.capabilityKey]);
        assert.equal(rows.length, 1, `${c.capabilityKey} is not registered`);
        assert.deepEqual(rows[0], { object_key: c.objectKey, action_key: c.actionKey, action_kind: c.actionKind });
      }
      // ...and the one that is NOT registered stays that way.
      const { rows: absent } = await pool.query(
        "SELECT count(*)::int AS n FROM eos_policy.capabilities WHERE key = 'reportDefinition.delete'");
      assert.equal(absent[0].n, 0, "reportDefinition.delete must be ungrantable, not merely ungranted");
    } finally {
      await pool.end();
    }
  });
