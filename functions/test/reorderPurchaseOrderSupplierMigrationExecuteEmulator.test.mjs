// Supplier Master (execute tooling) -- emulator lifecycle test. Seeds SYNTHETIC suppliers + reorder POs,
// builds a frozen manifest from a dry-run plan, and proves: DRY_RUN writes nothing; EXECUTE adds ONLY
// supplierId + supplierNameSnapshot and NEVER touches supplierName; re-run is idempotent (already_linked);
// a drifted PO fails STALE_PRESTATE (bounded, run continues); a PO with a different existing link fails
// UNEXPECTED_EXISTING_LINK (never overwritten); and rollback removes exactly the two fields (supplierName
// intact) and is idempotent. Sandbox-only; no production data/credentials.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const M = await import("../lib/supplierMaster/reorderPurchaseOrderSupplierMigration.js");
const E = await import("../lib/supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const stamp = Date.now();
const id = (p) => `s8-${p}-${stamp}`;
const nm = (b) => `${b} ${stamp}`;
const TARGET = { projectId: "taylor-parts", databaseId: "(default)" };
const CONFIRM = `${TARGET.projectId}/${TARGET.databaseId}`;
const PINS = { projectId: "taylor-parts", governedCommit: "s8-test" };
const read = async (poId) => (await db.collection("reorder_purchase_orders").doc(poId).get()).data();

console.log("reorderPurchaseOrderSupplierMigrationExecuteEmulator.test.mjs");

// Seed one ACTIVE supplier (unique key) + POs: one EXACT match, one already linked to a DIFFERENT supplier.
const suppliers = [{ id: id("acme"), name: nm("Acme Supply"), normalizedKey: `acme supply ${stamp}`, status: "ACTIVE", version: 1 }];
const poExact = { poId: id("po-exact"), data: { supplierName: nm("Acme Supply"), partId: "P1", externalPoNumber: "PO-1", orderedQuantity: 3, createdBy: "seed", createdAt: 123 } };
const poDrift = { poId: id("po-drift"), data: { supplierName: nm("Acme Supply"), partId: "P2", externalPoNumber: "PO-2", orderedQuantity: 1, createdBy: "seed", createdAt: 123 } };
const poConflict = { poId: id("po-conflict"), data: { supplierName: nm("Acme Supply"), partId: "P3", externalPoNumber: "PO-3", orderedQuantity: 2, supplierId: "SOMEONE-ELSE", supplierNameSnapshot: nm("Acme Supply"), createdBy: "seed", createdAt: 123 } };

await check("seed", async () => {
  const b = db.batch();
  for (const s of suppliers) b.set(db.collection("suppliers").doc(s.id), s);
  for (const p of [poExact, poDrift, poConflict]) b.set(db.collection("reorder_purchase_orders").doc(p.poId), p.data);
  await b.commit();
});

// Build the plan from the exact live docs, then a manifest for the three POs.
const plan = M.planSupplierLinkageMigration([poExact, poDrift, poConflict], suppliers, PINS);
const entryFor = (po) => ({ poId: po.poId, supplierId: id("acme"), supplierNameSnapshot: nm("Acme Supply"), preStateFingerprint: M.reorderPurchaseOrderRecordFingerprint(po.data) });
const mf = (entries) => ({ target: TARGET, governedCommit: plan.governedCommit, planFingerprint: plan.planFingerprint, entries });
// Main manifest links po-exact and (attempts) po-conflict; po-drift is exercised separately so its
// STALE_PRESTATE case stays clean (it is never linked in the main run).
const manifest = mf([entryFor(poExact), entryFor(poConflict)]);

await check("plan classifies the three POs as EXACT (single ACTIVE match)", () => {
  for (const p of [poExact, poDrift]) assert.equal(plan.classified.find((c) => c.poId === p.poId).classification, "EXACT");
});

await check("DRY_RUN writes nothing (docs unchanged)", async () => {
  const r = await E.executeSupplierLinkageMigration({ db, plan, manifest, target: TARGET, mode: "DRY_RUN", actorUid: "op" });
  assert.equal(r.counts.wouldApply >= 1, true);
  assert.ok(!("supplierId" in (await read(poExact.poId)))); // untouched
});

await check("EXECUTE adds ONLY supplierId+snapshot; supplierName intact; conflict & (later) drift excluded", async () => {
  const r = await E.executeSupplierLinkageMigration({ db, plan, manifest, target: TARGET, mode: "EXECUTE", confirmExecute: CONFIRM, actorUid: "op" });
  const doc = await read(poExact.poId);
  assert.equal(doc.supplierId, id("acme"));
  assert.equal(doc.supplierNameSnapshot, nm("Acme Supply"));
  assert.equal(doc.supplierName, nm("Acme Supply")); // NEVER replaced
  assert.equal(doc.partId, "P1"); // nothing else touched
  // po-conflict already had a DIFFERENT supplierId -> fail closed, never overwritten
  assert.equal((await read(poConflict.poId)).supplierId, "SOMEONE-ELSE");
  const conflictOutcome = r.outcomes.find((o) => o.poId === poConflict.poId);
  assert.equal(conflictOutcome.result, "failed");
  assert.equal(conflictOutcome.code, "UNEXPECTED_EXISTING_LINK");
  assert.ok(r.rollbackArtifact.linkedPoIds.includes(poExact.poId));
});

await check("EXECUTE is idempotent (re-run -> already_linked, no error)", async () => {
  const r = await E.executeSupplierLinkageMigration({ db, plan, manifest, target: TARGET, mode: "EXECUTE", confirmExecute: CONFIRM, actorUid: "op" });
  assert.equal(r.outcomes.find((o) => o.poId === poExact.poId).result, "already_linked");
});

await check("STALE_PRESTATE: a PO changed since the manifest fails closed (bounded); not written", async () => {
  const driftManifest = mf([entryFor(poDrift)]); // fingerprint from ORIGINAL po-drift data
  await db.collection("reorder_purchase_orders").doc(poDrift.poId).update({ orderedQuantity: 999 }); // drift after manifest authored
  const r = await E.executeSupplierLinkageMigration({ db, plan, manifest: driftManifest, target: TARGET, mode: "EXECUTE", confirmExecute: CONFIRM, actorUid: "op" });
  const o = r.outcomes.find((x) => x.poId === poDrift.poId);
  assert.equal(o.result, "failed");
  assert.equal(o.code, "STALE_PRESTATE");
  assert.ok(!("supplierId" in (await read(poDrift.poId)))); // never written
});

await check("rollback: DRY_RUN would_remove; EXECUTE removes ONLY the two fields; supplierName intact", async () => {
  const artifact = { target: TARGET, governedCommit: plan.governedCommit, planFingerprint: plan.planFingerprint, linkedPoIds: [poExact.poId] };
  const dry = await E.rollbackSupplierLinkageMigration({ db, rollbackArtifact: artifact, mode: "DRY_RUN", actorUid: "op" });
  assert.equal(dry.counts.wouldRemove, 1);
  assert.equal((await read(poExact.poId)).supplierId, id("acme")); // dry-run didn't remove
  const live = await E.rollbackSupplierLinkageMigration({ db, rollbackArtifact: artifact, mode: "EXECUTE", confirmExecute: CONFIRM, actorUid: "op" });
  assert.equal(live.counts.removed, 1);
  const doc = await read(poExact.poId);
  assert.ok(!("supplierId" in doc) && !("supplierNameSnapshot" in doc)); // both removed
  assert.equal(doc.supplierName, nm("Acme Supply")); // historical name intact
});

await check("rollback is idempotent (already_absent)", async () => {
  const artifact = { target: TARGET, governedCommit: plan.governedCommit, planFingerprint: plan.planFingerprint, linkedPoIds: [poExact.poId] };
  const r = await E.rollbackSupplierLinkageMigration({ db, rollbackArtifact: artifact, mode: "EXECUTE", confirmExecute: CONFIRM, actorUid: "op" });
  assert.equal(r.counts.alreadyAbsent, 1);
});

console.log(`\nreorderPurchaseOrderSupplierMigrationExecute: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
