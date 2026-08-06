// Supplier Master (S4) -- emulator DRY-RUN test. Seeds SYNTHETIC governed suppliers +
// reorder_purchase_orders (Admin SDK), runs the dry-run planner against live reads, and asserts
// (a) the classification counts and EXACT linkage, and (b) that the dry-run WROTE NOTHING -- the
// reorder_purchase_orders docs are byte-identical afterward (no supplierId/supplierNameSnapshot added).
// No production data, no production credentials. Sandbox-only.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { dryRunSupplierLinkageMigration } = await import("../lib/supplierMaster/reorderPurchaseOrderSupplierMigration.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const stamp = Date.now();
const ns = (p) => `s4-${p}-${stamp}`; // namespace ids so concurrent runs never collide
// Namespace the supplier NAMES too (not just ids): the dry-run reads the WHOLE suppliers collection,
// so a generic name like "Acme Supply" could collide with suppliers seeded by another suite sharing
// the emulator DB and flip an EXACT match to AMBIGUOUS. A per-run token keeps every normalizedKey
// unique to this run, so classification is deterministic regardless of what else is in the collection.
const nm = (base) => `${base} ${stamp}`;
const key = (base) => `${base.toLowerCase()} ${stamp}`; // matches normalizeSupplierName of nm(base)

console.log("reorderPurchaseOrderSupplierMigrationEmulator.test.mjs");

// Seed governed suppliers (direct Admin write; the governed shape the workspace/commands produce).
const supplierSeed = [
  { id: ns("acme"), name: nm("Acme Supply"), normalizedKey: key("Acme Supply"), status: "ACTIVE", version: 1 },
  { id: ns("glx1"), name: nm("Globex"), normalizedKey: key("Globex"), status: "ACTIVE", version: 1 },
  { id: ns("glx2"), name: nm("Globex"), normalizedKey: key("Globex"), status: "ACTIVE", version: 1 },
  { id: ns("umb"), name: nm("Umbrella Co"), normalizedKey: key("Umbrella Co"), status: "INACTIVE", version: 1 },
];
// EXACT PO uses a deliberately messy-cased/spaced form of the acme name; it normalizes to the same
// key but must round-trip VERBATIM as the snapshot.
const EXACT_MESSY_NAME = `  ACME   supply ${stamp}  `;
// Seed reorder POs spanning every classification.
const poSeed = [
  { id: ns("po-exact"), supplierName: EXACT_MESSY_NAME }, // EXACT (normalizes to acme's key)
  { id: ns("po-amb"), supplierName: nm("Globex") }, // AMBIGUOUS
  { id: ns("po-inact"), supplierName: nm("Umbrella Co") }, // INACTIVE
  { id: ns("po-unm"), supplierName: `Nobody Inc ${stamp}` }, // UNMATCHED
  { id: ns("po-hist"), partId: "P-1" }, // HISTORICAL (no supplierName)
];

await check("seed synthetic suppliers + reorder POs", async () => {
  const batch = db.batch();
  for (const s of supplierSeed) batch.set(db.collection("suppliers").doc(s.id), s);
  for (const p of poSeed) batch.set(db.collection("reorder_purchase_orders").doc(p.id), p);
  await batch.commit();
});

await check("dry-run: correct classification + EXACT linkage over the seeded set", async () => {
  const plan = await dryRunSupplierLinkageMigration(db, { projectId: "taylor-parts", governedCommit: "s4-test" });
  const seededIds = new Set(poSeed.map((p) => p.id));
  const mine = plan.classified.filter((c) => seededIds.has(c.poId));
  assert.equal(mine.length, 5);
  const byId = Object.fromEntries(mine.map((c) => [c.poId, c]));
  assert.equal(byId[ns("po-exact")].classification, "EXACT");
  assert.equal(byId[ns("po-exact")].supplierId, ns("acme"));
  assert.equal(byId[ns("po-exact")].supplierNameSnapshot, EXACT_MESSY_NAME); // verbatim, not normalized
  assert.equal(byId[ns("po-amb")].classification, "AMBIGUOUS");
  assert.equal(byId[ns("po-amb")].supplierId, null);
  assert.equal(byId[ns("po-inact")].classification, "INACTIVE");
  assert.equal(byId[ns("po-unm")].classification, "UNMATCHED");
  assert.equal(byId[ns("po-hist")].classification, "HISTORICAL");
  assert.ok(typeof plan.planFingerprint === "string" && plan.planFingerprint.length === 64);
});

await check("dry-run WROTE NOTHING: reorder PO docs unchanged (no supplierId/supplierNameSnapshot added)", async () => {
  await dryRunSupplierLinkageMigration(db, { projectId: "taylor-parts", governedCommit: "s4-test" });
  for (const p of poSeed) {
    const doc = (await db.collection("reorder_purchase_orders").doc(p.id).get()).data();
    assert.ok(!("supplierId" in doc), `${p.id} must not gain supplierId`);
    assert.ok(!("supplierNameSnapshot" in doc), `${p.id} must not gain supplierNameSnapshot`);
    assert.deepEqual(doc, p); // byte-identical to the seed
  }
});

console.log(`\nreorderPurchaseOrderSupplierMigration: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
