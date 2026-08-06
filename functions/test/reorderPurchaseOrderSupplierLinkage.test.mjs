// Supplier Master (S4) -- OFFLINE tests for the PURE supplier-linkage compatibility + migration
// planning (no Firebase/network; compiled lib). Asserts the classification taxonomy
// (exact/ambiguous/inactive/unmatched/historical), verbatim snapshot preservation, supplierId only on
// an unambiguous ACTIVE match, deterministic plan counts + fingerprint, and no input mutation.
import assert from "node:assert/strict";
import {
  buildGovernedSupplierIndex,
  deriveSupplierLinkage,
} from "../lib/supplierMaster/reorderPurchaseOrderSupplierCompatibility.js";
import {
  planSupplierLinkageMigration,
} from "../lib/supplierMaster/reorderPurchaseOrderSupplierMigration.js";

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
console.log("reorderPurchaseOrderSupplierLinkage.test.mjs");

// Governed suppliers: Acme has ONE active; Globex has TWO active (duplicate -> ambiguous); Umbrella
// has only an INACTIVE; Wayne recomputes its key from name (no stored normalizedKey).
const SUPPLIERS = [
  { id: "acme", name: "Acme Supply", normalizedKey: "acme supply", status: "ACTIVE" },
  { id: "globex1", name: "Globex", normalizedKey: "globex", status: "ACTIVE" },
  { id: "globex2", name: "GLOBEX", normalizedKey: "globex", status: "ACTIVE" },
  { id: "umbrella", name: "Umbrella Co", normalizedKey: "umbrella co", status: "INACTIVE" },
  { id: "wayne", name: "Wayne Enterprises", status: "ACTIVE" }, // no stored key -> recomputed
  { id: "bad", name: "", status: "ACTIVE" }, // empty key -> skipped
];

check("buildGovernedSupplierIndex: groups by key, recomputes missing key, sorts ids, skips empties", () => {
  const idx = buildGovernedSupplierIndex(SUPPLIERS);
  assert.deepEqual(idx.get("acme supply"), { activeIds: ["acme"], inactiveIds: [] });
  assert.deepEqual(idx.get("globex"), { activeIds: ["globex1", "globex2"], inactiveIds: [] });
  assert.deepEqual(idx.get("umbrella co"), { activeIds: [], inactiveIds: ["umbrella"] });
  assert.deepEqual(idx.get("wayne enterprises"), { activeIds: ["wayne"], inactiveIds: [] }); // recomputed key
  assert.equal(idx.has(""), false); // empty-key supplier skipped
});

const IDX = buildGovernedSupplierIndex(SUPPLIERS);

check("deriveSupplierLinkage: EXACT -> supplierId set; snapshot preserved verbatim", () => {
  const r = deriveSupplierLinkage({ supplierName: "  ACME   supply  " }, IDX); // messy casing/spacing
  assert.equal(r.classification, "EXACT");
  assert.equal(r.supplierId, "acme");
  assert.equal(r.supplierNameSnapshot, "  ACME   supply  "); // verbatim, NOT normalized
});
check("deriveSupplierLinkage: AMBIGUOUS (duplicate) -> no supplierId, candidates listed", () => {
  const r = deriveSupplierLinkage({ supplierName: "globex" }, IDX);
  assert.equal(r.classification, "AMBIGUOUS");
  assert.equal(r.supplierId, null);
  assert.deepEqual([...r.candidateIds], ["globex1", "globex2"]);
});
check("deriveSupplierLinkage: INACTIVE-only match -> not linkable", () => {
  const r = deriveSupplierLinkage({ supplierName: "Umbrella Co" }, IDX);
  assert.equal(r.classification, "INACTIVE");
  assert.equal(r.supplierId, null);
  assert.deepEqual([...r.candidateIds], ["umbrella"]);
});
check("deriveSupplierLinkage: UNMATCHED -> snapshot kept, no id", () => {
  const r = deriveSupplierLinkage({ supplierName: "Nobody Inc" }, IDX);
  assert.equal(r.classification, "UNMATCHED");
  assert.equal(r.supplierId, null);
  assert.equal(r.supplierNameSnapshot, "Nobody Inc");
});
check("deriveSupplierLinkage: HISTORICAL for missing/blank name", () => {
  for (const po of [{}, { supplierName: "" }, { supplierName: "   " }, { supplierName: 42 }]) {
    const r = deriveSupplierLinkage(po, IDX);
    assert.equal(r.classification, "HISTORICAL");
    assert.equal(r.supplierId, null);
    assert.equal(r.supplierNameSnapshot, null);
  }
});

const POS = [
  { poId: "po-3", data: { supplierName: "Acme Supply" } }, // EXACT
  { poId: "po-1", data: { supplierName: "globex" } }, // AMBIGUOUS
  { poId: "po-2", data: { supplierName: "Umbrella Co" } }, // INACTIVE
  { poId: "po-4", data: { supplierName: "Nobody Inc" } }, // UNMATCHED
  { poId: "po-5", data: {} }, // HISTORICAL
];
const PINS = { projectId: "taylor-parts", governedCommit: "test-commit" };

check("planSupplierLinkageMigration: counts by class; sorted by poId; needsResolution = ambiguous+inactive", () => {
  const plan = planSupplierLinkageMigration(POS, SUPPLIERS, PINS);
  assert.deepEqual(plan.counts, { total: 5, exact: 1, ambiguous: 1, inactive: 1, unmatched: 1, historical: 1 });
  assert.deepEqual(plan.classified.map((c) => c.poId), ["po-1", "po-2", "po-3", "po-4", "po-5"]); // sorted
  assert.deepEqual(plan.needsResolution.map((c) => c.poId).sort(), ["po-1", "po-2"]); // ambiguous + inactive
  assert.equal(plan.classified.find((c) => c.poId === "po-3").supplierId, "acme");
});
check("planSupplierLinkageMigration: fingerprint deterministic; changes when a decision changes", () => {
  const a = planSupplierLinkageMigration(POS, SUPPLIERS, PINS).planFingerprint;
  const b = planSupplierLinkageMigration(POS, SUPPLIERS, PINS).planFingerprint;
  assert.equal(a, b); // same inputs -> same fingerprint
  // Deactivating acme flips po-3 EXACT -> INACTIVE, changing the plan and thus the fingerprint.
  const altered = SUPPLIERS.map((s) => (s.id === "acme" ? { ...s, status: "INACTIVE" } : s));
  assert.notEqual(planSupplierLinkageMigration(POS, altered, PINS).planFingerprint, a);
});
check("planSupplierLinkageMigration: pure -- does not mutate inputs", () => {
  const posCopy = JSON.parse(JSON.stringify(POS));
  planSupplierLinkageMigration(POS, SUPPLIERS, PINS);
  assert.deepEqual(POS, posCopy); // untouched
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
