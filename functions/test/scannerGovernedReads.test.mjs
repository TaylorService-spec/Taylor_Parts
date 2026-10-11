// The scanner's governed reads -- lookupScannedPart and listStockMovementLocations -- which replace the
// client-direct `parts` and `warehouses` reads a Parts Associate was refused by firestore.rules.
// Emulator; drives the real services and the relocation callable (`.run`) with real role assignments and the real
// activation registry. The lookupScannedPart callable checks were migrated to EOS (see below).
//
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/scannerGovernedReads.test.mjs
import "./support/firebaseEmulatorGuard.cjs"; // FIRST: Firebase test-safety guard (emulator mode) -- see test/support/firebaseTestGuard.cjs
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "demo-eos-test" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const relocation = await import("../lib/inventoryLocation/stockRelocationCallables.js");
const { lookupScannedPart, validateScannerPartLookup, SCANNER_PART_FIELDS } = await import("../lib/partMaster/scannerPartLookup.js");
const { __resetRuntimeCapabilityOverridesCacheForTest } = await import("../lib/access/environmentCapabilityOverrides.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const request = (uid, data = {}) => ({ data, auth: uid ? { uid, token: {} } : undefined });
const codeOf = async (p) => { try { await p; return null; } catch (e) { return e.code; } };
async function inSandbox(fn) {
  const prev = process.env.GCLOUD_PROJECT;
  __resetRuntimeCapabilityOverridesCacheForTest();
  process.env.GCLOUD_PROJECT = "eos-platform-sandbox";
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = prev;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
}

const runId = Date.now();
async function principal(tag, roleIds) {
  const uid = `scan-${tag}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  for (const roleId of roleIds) {
    await db.collection("roleAssignments").doc(`${uid}-${roleId}`).set({
      principalUid: uid, roleId, scope: { type: "global" }, grantedBy: "test",
      grantedAt: Timestamp.now(), status: "active", accessVersionAtGrant: 1,
    });
  }
  return uid;
}
const partsAssociate = await principal("pa", ["partsAssociate", "inventoryLookupReader"]); // the persona the scanner is for
const relocator = await principal("reloc", ["inventoryStockRelocationOperator"]);
const putAwayOnly = await principal("put", ["inventoryPutAwayOperator"]);
const technician = await principal("tech", ["technician"]);

const PART = `PRT-${String(runId).slice(-6)}`;
await db.collection("parts").doc(PART).set({
  partId: PART, internalPartNumber: PART, name: "Evaporator fan", description: "d", category: "c", status: "ACTIVE",
  stockingUnit: "EACH", controlType: "SERIALIZED", stockingClass: "STOCKED", version: 3,
  // Fields a scanner must NEVER receive.
  unitCost: 123.45, listPrice: 200, supplierTerms: "net 30",
});
const WH_ACTIVE = `wh-scan-a-${runId}`;
const WH_INACTIVE = `wh-scan-i-${runId}`;
for (const [id, status] of [[WH_ACTIVE, "ACTIVE"], [WH_INACTIVE, "INACTIVE"]]) {
  const t = Timestamp.fromDate(new Date(1_700_000_000_000));
  await db.collection("warehouses").doc(id).set({ id, name: `Name ${id}`, location: "x", status, version: 1, updatedAt: t, updatedBy: "seed", provenance: "NATIVE", createdAt: t, createdBy: "seed" });
}

// ---------------------------------------------------------------- lookupScannedPart
// The lookupScannedPart CALLABLE checks that stood here (unauthenticated, part-code resolution, field allow-list,
// capability refusal, request shaping, unknown code) were MIGRATED to the authoritative EOS path when the callable was
// retired (Firebase retirement F3b, 2026-10-11): functions/test/catalogReadAuthorizationPostgres.test.mjs -- the
// "SCANNER: lookupScannedPart answers the scanner contract on the EOS path" subtest, plus its UNAUTHENTICATED and
// "REFUSED: a tenant MEMBER without inventory.catalog.read" subtests, all through the real handleCatalogRequest.
await check("an unsafe Part code is simply not a Part code (the pure request validator)", async () => {
  assert.equal(validateScannerPartLookup({ rawValue: "a", partCode: "../users/x" }).partCode, null);
});
await check("CORE: an alias that resolves to one Part returns that Part; alias denial reads no alias", async () => {
  const found = await lookupScannedPart({ rawValue: "0123456789012", partCode: null },
    { db, aliasAllowed: true, resolve: async () => ({ result: "FOUND", partId: PART, aliasType: "UPC", aliasId: "a1" }) });
  assert.deepEqual(found.parts.map((p) => p.id), [PART]);
  let called = false;
  const denied = await lookupScannedPart({ rawValue: "0123456789012", partCode: null }, { db, aliasAllowed: false, resolve: async () => { called = true; return { result: "NOT_FOUND" }; } });
  assert.equal(called, false); assert.equal(denied.aliasDenied, true); assert.deepEqual(denied.parts, []);
});

// ---------------------------------------------------------------- listStockMovementLocations
await check("the relocation operator gets ACTIVE governed warehouses as {warehouseId, name} only", async () => {
  const out = await inSandbox(() => relocation.listStockMovementLocationsCallable.run(request(relocator, {})));
  const ids = out.warehouses.map((w) => w.warehouseId);
  assert.ok(ids.includes(WH_ACTIVE)); assert.ok(!ids.includes(WH_INACTIVE));
  for (const w of out.warehouses) assert.deepEqual(Object.keys(w).sort(), ["name", "warehouseId"]);
});
await check("without relocate (put-away-only, technician) -> refused; a request field -> refused", async () => {
  await inSandbox(async () => {
    assert.equal(await codeOf(relocation.listStockMovementLocationsCallable.run(request(putAwayOnly, {}))), "permission-denied");
    assert.equal(await codeOf(relocation.listStockMovementLocationsCallable.run(request(technician, {}))), "permission-denied");
    assert.equal(await codeOf(relocation.listStockMovementLocationsCallable.run(request(relocator, { where: "x" }))), "invalid-argument");
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
