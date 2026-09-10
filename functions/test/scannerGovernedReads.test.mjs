// The scanner's governed reads -- lookupScannedPart and listStockMovementLocations -- which replace the
// client-direct `parts` and `warehouses` reads a Parts Associate was refused by firestore.rules.
// Emulator; drives the real callables (`.run`) with real role assignments and the real activation registry.
//
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/scannerGovernedReads.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const aliasCallables = await import("../lib/partMaster/partAliasCallables.js");
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
await check("unauthenticated is refused", async () => {
  assert.equal(await codeOf(aliasCallables.lookupScannedPartCallable.run(request(undefined, { rawValue: PART }))), "unauthenticated");
});
await check("the target PARTS ASSOCIATE resolves a Part by its code -- the gap this closes", async () => {
  const out = await inSandbox(() => aliasCallables.lookupScannedPartCallable.run(request(partsAssociate, { rawValue: PART, partCode: PART.toLowerCase() })));
  assert.deepEqual(out.parts.map((p) => p.id), [PART], "case-insensitive on the Part code, like the client's matcher");
  assert.equal(out.aliasDenied, false);
  assert.ok(out.alias && typeof out.alias.result === "string", "alias half answered through the canonical resolver");
});
await check("the projection is an allow-list: no cost, price or supplier terms", async () => {
  const out = await inSandbox(() => aliasCallables.lookupScannedPartCallable.run(request(relocator, { rawValue: PART, partCode: PART })));
  const data = out.parts[0].data;
  for (const k of Object.keys(data)) assert.ok(SCANNER_PART_FIELDS.includes(k), `unexpected field ${k}`);
  assert.equal(data.unitCost, undefined); assert.equal(data.listPrice, undefined); assert.equal(data.supplierTerms, undefined);
  assert.equal(data.controlType, "SERIALIZED");
});
await check("the relocation Role alone can resolve Parts (catalog.read + alias.read)", async () => {
  const out = await inSandbox(() => aliasCallables.lookupScannedPartCallable.run(request(relocator, { rawValue: PART, partCode: PART })));
  assert.equal(out.parts.length, 1);
});
await check("no catalog.read -> refused (technician; put-away-only)", async () => {
  await inSandbox(async () => {
    assert.equal(await codeOf(aliasCallables.lookupScannedPartCallable.run(request(technician, { rawValue: PART, partCode: PART }))), "permission-denied");
    assert.equal(await codeOf(aliasCallables.lookupScannedPartCallable.run(request(putAwayOnly, { rawValue: PART, partCode: PART }))), "permission-denied");
  });
});
await check("outside an environment that activates catalog.read, everyone is refused", async () => {
  assert.equal(await codeOf(aliasCallables.lookupScannedPartCallable.run(request(partsAssociate, { rawValue: PART, partCode: PART }))), "permission-denied");
});
await check("the client cannot shape the query: unknown fields and oversize values are refused", async () => {
  await inSandbox(async () => {
    assert.equal(await codeOf(aliasCallables.lookupScannedPartCallable.run(request(relocator, { rawValue: PART, collection: "users" }))), "invalid-argument");
    assert.equal(await codeOf(aliasCallables.lookupScannedPartCallable.run(request(relocator, { rawValue: "x".repeat(300) }))), "invalid-argument");
  });
  assert.equal(validateScannerPartLookup({ rawValue: "a", partCode: "../users/x" }).partCode, null, "an unsafe code is simply not a Part code");
});
await check("an unknown code is an honest empty answer, never another Part", async () => {
  const out = await inSandbox(() => aliasCallables.lookupScannedPartCallable.run(request(relocator, { rawValue: "NOPE-000", partCode: "NOPE-000" })));
  assert.deepEqual(out.parts, []);
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
