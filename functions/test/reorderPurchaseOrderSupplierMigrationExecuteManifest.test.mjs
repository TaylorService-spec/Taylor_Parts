// Supplier Master (execute tooling) -- OFFLINE tests for manifest validation + the accidental-execute
// guard (no Firebase/network; compiled lib). Proves every fail-closed manifest condition and that EXECUTE
// is impossible without an explicit target + confirmation token.
import assert from "node:assert/strict";
import {
  planSupplierLinkageMigration,
  reorderPurchaseOrderRecordFingerprint,
} from "../lib/supplierMaster/reorderPurchaseOrderSupplierMigration.js";
import {
  validateExecutionManifest,
  executeSupplierLinkageMigration,
  SupplierMigrationExecuteError,
} from "../lib/supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.js";

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
console.log("reorderPurchaseOrderSupplierMigrationExecuteManifest.test.mjs");

const SUPPLIERS = [
  { id: "acme", name: "Acme Supply", normalizedKey: "acme supply", status: "ACTIVE" },
  { id: "glx1", name: "Globex", normalizedKey: "globex", status: "ACTIVE" },
  { id: "glx2", name: "Globex", normalizedKey: "globex", status: "ACTIVE" },
  { id: "umb", name: "Umbrella Co", normalizedKey: "umbrella co", status: "INACTIVE" },
];
const POS = [
  { poId: "po-exact", data: { supplierName: "Acme Supply", partId: "P1" } }, // EXACT -> acme
  { poId: "po-amb", data: { supplierName: "Globex", partId: "P2" } }, // AMBIGUOUS -> glx1/glx2
  { poId: "po-inact", data: { supplierName: "Umbrella Co", partId: "P3" } }, // INACTIVE -> umb
  { poId: "po-unm", data: { supplierName: "Nobody Inc", partId: "P4" } }, // UNMATCHED
  { poId: "po-hist", data: { partId: "P5" } }, // HISTORICAL
];
const TARGET = { projectId: "taylor-parts", databaseId: "(default)" };
const PINS = { projectId: "taylor-parts", governedCommit: "test-commit" };
const plan = planSupplierLinkageMigration(POS, SUPPLIERS, PINS);
const fp = (poId) => reorderPurchaseOrderRecordFingerprint(POS.find((p) => p.poId === poId).data);

function baseManifest(entries) {
  return { target: TARGET, governedCommit: plan.governedCommit, planFingerprint: plan.planFingerprint, entries };
}
const exactEntry = { poId: "po-exact", supplierId: "acme", supplierNameSnapshot: "Acme Supply", preStateFingerprint: fp("po-exact") };

await check("valid manifest (EXACT + human-resolved AMBIGUOUS/INACTIVE) passes", () => {
  const m = baseManifest([
    exactEntry,
    { poId: "po-amb", supplierId: "glx2", supplierNameSnapshot: "Globex", preStateFingerprint: fp("po-amb") }, // chose a candidate
    { poId: "po-inact", supplierId: "umb", supplierNameSnapshot: "Umbrella Co", preStateFingerprint: fp("po-inact") },
  ]);
  const r = validateExecutionManifest(m, plan, TARGET);
  assert.equal(r.valid, true, r.reason ?? "");
  assert.equal(r.entries.length, 3);
});

const cases = [
  ["not-object", "manifest_not_object", "nope"],
  ["wrong target", "wrong_target", { ...baseManifest([exactEntry]), target: { projectId: "other", databaseId: "(default)" } }],
  ["wrong commit", "wrong_commit", { ...baseManifest([exactEntry]), governedCommit: "different" }],
  ["plan fingerprint drift", "plan_fingerprint_drift", { ...baseManifest([exactEntry]), planFingerprint: "deadbeef" }],
  ["entries not array", "entries_not_array", { ...baseManifest([]), entries: "x" }],
  ["malformed entry", "entry_malformed", baseManifest([{ poId: "po-exact" }])],
  ["duplicate entry", "duplicate_entry", baseManifest([exactEntry, exactEntry])],
  ["unknown po", "unknown_po", baseManifest([{ poId: "po-ghost", supplierId: "acme", supplierNameSnapshot: "x", preStateFingerprint: "z" }])],
  ["not migratable (UNMATCHED)", "not_migratable", baseManifest([{ poId: "po-unm", supplierId: "acme", supplierNameSnapshot: "Nobody Inc", preStateFingerprint: fp("po-unm") }])],
  ["not migratable (HISTORICAL)", "not_migratable", baseManifest([{ poId: "po-hist", supplierId: "acme", supplierNameSnapshot: "", preStateFingerprint: fp("po-hist") }])],
  ["EXACT supplier override rejected", "exact_supplier_override", baseManifest([{ ...exactEntry, supplierId: "glx1" }])],
  ["AMBIGUOUS non-candidate rejected", "supplier_not_a_candidate", baseManifest([{ poId: "po-amb", supplierId: "acme", supplierNameSnapshot: "Globex", preStateFingerprint: fp("po-amb") }])],
  ["snapshot mismatch rejected", "snapshot_mismatch", baseManifest([{ ...exactEntry, supplierNameSnapshot: "Acme Supply INC" }])],
];
for (const [name, reason, manifest] of cases) {
  await check(`rejects: ${name}`, () => {
    const r = validateExecutionManifest(manifest, plan, TARGET);
    assert.equal(r.valid, false);
    assert.equal(r.reason, reason);
  });
}

// --- accidental-execute guard (no db reached) ---
await check("EXECUTE without confirmExecute -> AMBIGUOUS_TARGET (impossible by default)", async () => {
  await assert.rejects(
    executeSupplierLinkageMigration({ db: null, plan, manifest: baseManifest([exactEntry]), target: TARGET, mode: "EXECUTE", actorUid: "op" }),
    (e) => e instanceof SupplierMigrationExecuteError && e.code === "AMBIGUOUS_TARGET",
  );
});
await check("EXECUTE with wrong confirmExecute token -> AMBIGUOUS_TARGET", async () => {
  await assert.rejects(
    executeSupplierLinkageMigration({ db: null, plan, manifest: baseManifest([exactEntry]), target: TARGET, mode: "EXECUTE", confirmExecute: "taylor-parts/wrong", actorUid: "op" }),
    (e) => e.code === "AMBIGUOUS_TARGET",
  );
});
await check("EXECUTE with correct token but MISMATCHED connected db -> AMBIGUOUS_TARGET (destination guard)", async () => {
  // The token is self-consistent, but the db is bound to a different project -> the destination guard
  // must still refuse, proving the token confirms intent, not destination. (Stub db: assertExecutable
  // reads only projectId/databaseId and throws before any db method is called.)
  const wrongDb = { projectId: "some-other-project", databaseId: "(default)" };
  await assert.rejects(
    executeSupplierLinkageMigration({ db: wrongDb, plan, manifest: baseManifest([exactEntry]), target: TARGET, mode: "EXECUTE", confirmExecute: `${TARGET.projectId}/${TARGET.databaseId}`, actorUid: "op" }),
    (e) => e.code === "AMBIGUOUS_TARGET",
  );
});
await check("missing target -> AMBIGUOUS_TARGET", async () => {
  await assert.rejects(
    executeSupplierLinkageMigration({ db: null, plan, manifest: baseManifest([exactEntry]), target: { projectId: "", databaseId: "" }, mode: "DRY_RUN", actorUid: "op" }),
    (e) => e.code === "AMBIGUOUS_TARGET",
  );
});
await check("missing manifest -> MANIFEST_MISSING (after target guard passes)", async () => {
  await assert.rejects(
    executeSupplierLinkageMigration({ db: null, plan, manifest: null, target: TARGET, mode: "DRY_RUN", actorUid: "op" }),
    (e) => e.code === "MANIFEST_MISSING",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
