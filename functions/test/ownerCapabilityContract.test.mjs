// THE OWNER CAPABILITY CONTRACT -- proof tests for Owner ruling A (2026-09-24).
//
// "NARROW the compiled Owner Role. Do NOT widen live Owner to match Admin."
//
// The defect this pins shut: OWNER_PERMISSIONS used to be `[...ADMIN_ROLE.permissions, ...]`, and
// ADMIN_ROLE.permissions is itself the ENTIRE PERMISSION_CATALOG, so `owner` and `admin` declared
// 151 identical ids with zero difference in either direction. Live nonprod meanwhile grants owner
// 47 and admin 66, owner a strict subset. Because the policy seed writes eos_policy.role_capabilities
// FROM this catalog, naming `owner` on a Principal would have widened the live Owner Role by the 19
// capabilities that are admin-only today -- the widening ruling S5 forbids.
//
// WHAT IS PROVEN HERE, in order:
//   1. Owner is no longer admin. The two permission sets differ, in the correct direction only.
//   2. The contract itself: Owner's in-vocabulary set is exactly the 41 decided capabilities.
//   3. The exclusions are real: none of the 19 admin-only capabilities is on Owner.
//   4. THE RECONCILE PROOF. Owner's in-vocabulary declaration is a SUBSET of the live Owner grant
//      set measured in nonprod, so removing `withheldFromReconciliation: ["owner"]` would write
//      zero rows and therefore cannot add an admin-only capability.
//   5. The dead `active !== false` predicate is gone and Owner holds every registered report.* id.
//
// THE MEASURED LIVE SET IS NOT RE-DERIVED HERE. It is read from
// functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json -- the nonprod measurement
// (387 grants, 2026-09-24) that roleCapabilityAuthorityBaselinePostgres.test.mjs asserts equals the
// live table. Re-measuring inside a unit test would need a live connection and would prove less.
//
// Dependency-free: plain Node assert against the compiled catalog, matching governedBusinessRoles
// .test.mjs's convention. No emulator, no database, no network.
//
// Prerequisite: `npm run build` in functions/ first (imports the compiled lib/ output).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_ROLE } from "../lib/access/compatibilityRoles.js";
import {
  GOVERNED_BUSINESS_ROLES,
  OWNER_ROLE,
  OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES,
  OWNER_EXCLUDED_NOT_AN_AUTHORITY,
} from "../lib/access/governedBusinessRoles.js";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json"), "utf8"),
);
const liveGrantsFor = (roleKey) =>
  new Set(BASELINE.grants.filter((g) => g.roleKey === roleKey).map((g) => g.capabilityKey));
const LIVE_OWNER = liveGrantsFor("owner");
const LIVE_ADMIN = liveGrantsFor("admin");

// The governed PostgreSQL capability vocabulary -- the 76 ids eos_policy.capabilities holds -- read
// from the Sample Company manifest's own declaration of it rather than hand-listed here. The
// manifest's verifier asserts that list equals the live table, so this is the in-repo authority for
// it. Taking it from the BASELINE grants instead would silently omit any capability that is
// registered but granted to nobody -- exactly the id a future over-declaration would use.
// This file only READS the manifest; it is owned by another lane.
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "scripts", "fixtures", "sampleCompany.v2.json"), "utf8"),
);
const VOCABULARY = new Set(MANIFEST.expectedAccess.postgresCapabilityVocabulary);

const OWNER = new Set(OWNER_ROLE.permissions);
const ADMIN = new Set(ADMIN_ROLE.permissions);
const ownerInVocabulary = [...OWNER].filter((id) => VOCABULARY.has(id)).sort();

// ═══════════════ 1. Owner is no longer Administrator ═══════════════

check("Owner and Administrator are no longer the same Role -- the compiled sets differ", () => {
  assert.notDeepEqual([...OWNER].sort(), [...ADMIN].sort());
  const adminNotOwner = [...ADMIN].filter((id) => !OWNER.has(id));
  assert.ok(
    adminNotOwner.length > 0,
    "the whole point of ruling A: there must be capabilities admin holds and owner does not",
  );
});

check("Owner's permission list is DECLARED, not derived from ADMIN_ROLE", () => {
  // A structural guard against the exact regression: if someone reinstates the spread, owner
  // becomes a superset of admin again and this fails immediately. Stated as "admin must have ids
  // owner lacks" rather than "the source must not contain a spread", because the property is what
  // matters and the syntax is not.
  const adminNotOwner = new Set([...ADMIN].filter((id) => !OWNER.has(id)));
  for (const id of OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES) {
    if (!ADMIN.has(id)) continue; // the two workOrder.lifecycle.* ids are not in PERMISSION_CATALOG
    assert.ok(adminNotOwner.has(id), `${id} must be admin-not-owner in the compiled catalog`);
  }
});

check("Owner gains nothing outside the contract -- every non-report id Owner holds is decided", () => {
  // Owner may legitimately hold ids admin does not (the report.* family). What it may never do is
  // acquire an id nobody decided on. Every Owner id must be a real catalog id.
  const catalog = new Set(PERMISSION_CATALOG.map((p) => p.id));
  for (const id of OWNER) {
    assert.ok(catalog.has(id), `Owner declares "${id}", which is not a registered PERMISSION_CATALOG id`);
  }
});

// ═══════════════ 2. The contract ═══════════════

// The 41 governed capabilities Owner holds, decided one at a time in
// docs/governance/owner-capability-contract.md. Pinned as an exact list, not a count: a count
// tolerates a swap, and this is the artifact the Owner signed off.
const OWNER_CONTRACT_IN_VOCABULARY = [
  "admin.accessRequest.decide",
  "admin.credentialReset.initiate",
  "admin.employeeJobRole.write",
  "admin.employeeOperationalScope.write",
  "admin.employeeProfile.write",
  "admin.employeeWorkEligibility.write",
  "admin.principalAccess.read",
  "admin.roleAssignment.write",
  "admin.userStatus.write",
  "audit.event.read",
  "customer.record.create",
  "customer.record.read",
  "customer.record.update",
  "employee.record.read",
  "equipment.compatibility.view",
  "finance.adjustment.record",
  "finance.invoice.issue",
  "finance.payment.apply",
  "finance.refund.record",
  "fulfillment.coordinatedVisit.read",
  "inventory.action.read",
  "inventory.catalog.manage",
  "inventory.catalog.read",
  "inventory.serializedAsset.read",
  "inventory.transaction.read",
  "inventory.transfer.create",
  "opportunity.read",
  "opportunity.write",
  "reorder.purchaseOrder.create",
  "reorder.purchaseOrder.read",
  "reorder.request.create.manual",
  "reorder.request.create.system",
  "salesAgreement.create",
  "salesAgreement.read",
  "salesAgreement.updateDraft",
  "salesOrder.read",
  "salesOrder.write",
  "warehouse.record.read",
  "warehouse.transferOrder.read",
  "workOrder.create",
  "workOrder.transition",
];

check("Owner's governed (in-vocabulary) capabilities are exactly the 41 in the contract", () => {
  assert.deepEqual(ownerInVocabulary, [...OWNER_CONTRACT_IN_VOCABULARY].sort());
  assert.equal(ownerInVocabulary.length, 41, "41 governed capabilities -- 47 live minus the 6 with no PERMISSION_CATALOG id");
});

check("administration READS do not separate Owner from Administrator", () => {
  // Settled reference point: migration 1762041600000 granted admin.securityPolicy.read and
  // admin.principalAccess.read to exactly {admin, owner}, each as its own row. Only the first has
  // a PERMISSION_CATALOG id to assert on; the second is asserted against the live measurement.
  assert.ok(OWNER.has("admin.principalAccess.read"));
  assert.ok(ADMIN.has("admin.principalAccess.read"));
  for (const id of ["admin.securityPolicy.read", "admin.principalAccess.read"]) {
    assert.ok(LIVE_OWNER.has(id), `${id} must be granted to owner in live nonprod`);
    assert.ok(LIVE_ADMIN.has(id), `${id} must be granted to admin in live nonprod`);
  }
});

check("the Work Order lifecycle exclusion of Owner is honoured by the LEGACY id too", () => {
  // The five-row activation ruling excluded `owner` from workOrder.lifecycle.dispatch/.cancel
  // explicitly. `workOrder.cancel` is the Firebase-era id for the same act -- the canonical
  // vocabulary omits it as a duplicate -- so leaving it on Owner would have granted through the
  // legacy resolver exactly what the governed ruling withholds.
  assert.equal(OWNER.has("workOrder.cancel"), false, "the legacy cancel id must not defeat the lifecycle exclusion");
  assert.equal(OWNER.has("workOrder.lifecycle.cancel"), false);
  assert.equal(OWNER.has("workOrder.lifecycle.dispatch"), false);
});

check("the SUPERSEDED reorder queue key is not declared on Owner", () => {
  // eos_policy retains reorder.request.read.queue only as migration evidence after the 2026-09-17
  // ruling; the Sample Company manifest's own words are that it may never be granted again.
  assert.ok(OWNER_EXCLUDED_NOT_AN_AUTHORITY.includes("reorder.request.read.queue"));
  assert.equal(OWNER.has("reorder.request.read.queue"), false);
  assert.equal(OWNER.has("reorder.request.assign"), false);
});

// ═══════════════ 3. The exclusions are real ═══════════════

check("OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES is exactly the 19 admin-only keys measured in nonprod", () => {
  const measuredAdminOnly = [...LIVE_ADMIN].filter((id) => !LIVE_OWNER.has(id)).sort();
  assert.equal(measuredAdminOnly.length, 19);
  assert.deepEqual([...OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES].sort(), measuredAdminOnly);
});

check("Owner declares NONE of the 19 admin-only capabilities", () => {
  for (const id of OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES) {
    assert.equal(OWNER.has(id), false, `owner must not declare the admin-only capability ${id}`);
  }
});

check("the exclusions were an over-declaration, not an invention -- admin still holds all 17 declarable ones", () => {
  // Guards against "fixing" the drift by narrowing ADMIN instead of OWNER, which would silently
  // revoke authority the business does grant.
  const declarable = OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES.filter((id) =>
    PERMISSION_CATALOG.some((p) => p.id === id),
  );
  assert.equal(declarable.length, 17);
  for (const id of declarable) assert.ok(ADMIN.has(id), `admin must still hold ${id}`);
});

// ═══════════════ 4. THE RECONCILE PROOF ═══════════════

check("RECONCILE PROOF: Owner's governed declaration is a SUBSET of the live Owner grant set", () => {
  // This is the whole deliverable. The seed writes role_capabilities from this catalog and can
  // only write ids eos_policy already knows, so the rows a seed apply would ADD for role `owner`
  // are exactly (catalog owner set INTERSECT vocabulary) MINUS (live owner set). Proving that
  // difference empty proves the apply is a no-op for Owner.
  const wouldBeAdded = ownerInVocabulary.filter((id) => !LIVE_OWNER.has(id));
  assert.deepEqual(
    wouldBeAdded,
    [],
    "removing withheldFromReconciliation: [\"owner\"] must add ZERO grants to the live Owner Role",
  );
});

check("RECONCILE PROOF: and in particular it adds no ADMIN-ONLY capability", () => {
  // Weaker than the subset property above and stated separately on purpose: this is the exact
  // sentence Owner ruling A asks to be proven, and it must stay readable as its own assertion even
  // if the subset property is ever relaxed for a deliberate reason.
  const adminOnly = new Set([...LIVE_ADMIN].filter((id) => !LIVE_OWNER.has(id)));
  const addedAdminOnly = ownerInVocabulary.filter((id) => !LIVE_OWNER.has(id) && adminOnly.has(id));
  assert.deepEqual(addedAdminOnly, []);
});

check("RECONCILE PROOF: the six live Owner grants this catalog lacks are a catalog gap, not a narrowing", () => {
  // The other direction, recorded rather than hidden: live Owner holds six ids that have no
  // PERMISSION_CATALOG entry at all, so this catalog CANNOT declare them without registering a new
  // capability -- which this lane is forbidden to do. Their absence pre-dates this change.
  const catalog = new Set(PERMISSION_CATALOG.map((p) => p.id));
  const liveNotDeclared = [...LIVE_OWNER].filter((id) => !OWNER.has(id)).sort();
  assert.deepEqual(liveNotDeclared, [
    "admin.securityPolicy.read",
    "finance.invoice.read",
    "finance.payment.read",
    "inventory.manufacturer.read",
    "reorder.request.read",
    "workflowDefinition.read",
  ]);
  for (const id of liveNotDeclared) {
    assert.equal(catalog.has(id), false, `${id} must be absent from PERMISSION_CATALOG -- otherwise this is a narrowing, not a gap`);
  }
});

check("the vocabulary this proof is measured against is the full 76-key registered set", () => {
  // If the vocabulary shrank to "keys someone happens to hold", the subset proof above would stop
  // seeing an Owner declaration of a registered-but-ungranted capability -- which is precisely the
  // shape a future over-declaration would take.
  assert.equal(VOCABULARY.size, 76);
  for (const g of BASELINE.grants) {
    assert.ok(VOCABULARY.has(g.capabilityKey), `live grant ${g.capabilityKey} must be in the declared vocabulary`);
  }
});

// ═══════════════ 5. The dead predicate ═══════════════

check("DEAD PREDICATE FIXED: Owner holds every registered report.* id, not the empty set", () => {
  // The old filter was `p.id.startsWith("report.") && p.active !== false`. DECISIONS #167 moved the
  // whole report.* family to active:false and pushed the split to the activation layer, so that
  // predicate matched NOTHING and Owner held report.* only through the ADMIN_ROLE spread. Removing
  // the spread without fixing the filter would have deleted Owner's one genuinely Owner-only
  // authority and broken the W-SAVE ruling.
  const registered = PERMISSION_CATALOG.filter((p) => p.id.startsWith("report.")).map((p) => p.id);
  assert.equal(registered.length, 39);
  assert.equal(
    registered.filter((id) => PERMISSION_CATALOG.find((p) => p.id === id).active !== false).length,
    0,
    "every report.* id is active:false -- which is precisely why filtering membership on it was dead",
  );
  for (const id of registered) assert.ok(OWNER.has(id), `Owner must hold ${id}`);
});

check("Owner is still the only Role holding any report.* id", () => {
  for (const role of Object.values(GOVERNED_BUSINESS_ROLES)) {
    if (role.id === "owner") continue;
    const held = (role.permissions || []).filter((id) => id.startsWith("report."));
    // The three approved Reporting tiers are the documented exception, pinned in detail by
    // governedBusinessRoles.test.mjs; this check only guarantees no BUSINESS TITLE picked one up.
    if (["reportViewer", "reportFinanceViewer", "reportAuthor"].includes(role.id)) continue;
    assert.deepEqual(held, [], `${role.id} must hold no report.* id`);
  }
  assert.equal(ADMIN_ROLE.permissions.some((id) => id.startsWith("report.")), true,
    "admin holds them through its own whole-catalog derivation -- stated so the 'only Role' claim is understood as being about GOVERNED business Roles");
});

// ═══════════════ 6. The safety guard stays ═══════════════

check("this lane does NOT remove the withholding -- it only proves removing it would be safe", () => {
  // withheldFromReconciliation is declared in functions/scripts/fixtures/sampleCompany.v2.json by a
  // different lane and is not owned here. If it is present, it must still name owner. If it is not
  // present in this branch's base, that is recorded rather than asserted away.
  const manifestPath = path.join(HERE, "..", "scripts", "fixtures", "sampleCompany.v2.json");
  const text = fs.readFileSync(manifestPath, "utf8");
  if (!text.includes("withheldFromReconciliation")) {
    console.log(
      "      note: withheldFromReconciliation is not declared in this branch's sampleCompany.v2.json; " +
        "the subset proof above is what makes adding-then-removing it safe.",
    );
    return;
  }
  const manifest = JSON.parse(text);
  const withheld = JSON.stringify(manifest).match(/"withheldFromReconciliation":\s*\[[^\]]*\]/);
  assert.ok(withheld && withheld[0].includes("owner"), "owner must remain withheld from reconciliation in this lane");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
