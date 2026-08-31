// THE ACQUIRE CALLABLE — a boundary test, because the boundary is all this file is.
//
// ============================ WHAT IS AND IS NOT BEING TESTED ============================
//
// `acquireSerializedAssetCommand` owns what acquisition MEANS: the closed reason set, the
// SERIAL-only Part rule, the governed active-warehouse rule, the derived identity that makes
// `create` the duplicate check, replay-versus-conflict, and the refusal to overwrite a unit that
// arrived by receipt. Those rules are exercised here THROUGH the callable rather than restated,
// because what this file is for is proving the adapter cannot lose them — an adapter that
// swallowed a code, resolved the wrong capability, or read an actor from the payload would leave
// every one of those rules intact and unreachable.
//
// What matters most:
//
//   an unauthenticated caller never reaches a command that creates owned inventory
//   the ACTOR is the authenticated session, never a field in the payload
//   capability resolution runs against real roleAssignments, in the real environment posture
//   the INSTALLER is denied — acquiring and installing are deliberately different stations
//   every command refusal reaches the caller as a code it can act on
//   a replay is a SUCCESS and a conflicting intent is not
//
// A unit that arrived by RECEIPT must never be rewritten as acquired: that would erase real
// purchasing history, and it is the one failure here that is silent if it is not asserted.
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";   // activates inventory.serializedAsset.acquire
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "demo-acquire-callable" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const { acquireSerializedAssetCallable: acquireSerializedAsset } =
  await import("../lib/serializedAsset/acquireCallables.js");
const {
  SERIALIZED_ASSET_ACQUIRE_CAPABILITY, ACQUISITION_REASONS, ACQUISITION_PROVENANCE,
  ACQUIRED_INITIAL_STATE,
} = await import("../lib/serializedAsset/acquireSerializedAssetCommand.js");
const { serializedAssetDocId } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { EQUIPMENT_INSTALL_CAPABILITY } =
  await import("../lib/equipmentInstall/installSerializedAssetCommand.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err?.stack ?? err?.message ?? err); }
}

const NOW = new Date();
const stamp = Date.now();
let seq = 0;
const uniq = (p) => `${p}-${stamp}-${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid === undefined ? undefined : { uid: authUid, token: {} } });
const failsWith = async (fn) => {
  try { const value = await fn(); return { threw: false, value }; }
  catch (err) { return { threw: true, code: err?.code, details: err?.details, message: err?.message }; }
};

/** A principal holding exactly the Roles named — the real records the resolver reads. */
async function seedActor(...roleIds) {
  const uid = uniq("uid");
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  for (const roleId of roleIds) {
    const id = uniq("asg");
    await db.collection("roleAssignments").doc(id).set({
      id, principalUid: uid, roleId, scope: { type: "global" },
      grantedBy: "test", grantedAt: Timestamp.now(),
      status: "active", accessVersionAtGrant: 1,
    });
  }
  return uid;
}

/** A governed warehouse, in the exact shape validateGovernedWarehouse accepts. */
async function seedWarehouse(id, over = {}) {
  await db.collection("warehouses").doc(id).set({
    id, name: id, location: "somewhere", status: "ACTIVE", version: 1,
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed",
    updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
    provenance: "NATIVE",
    ...over,
  });
  return id;
}

/** A governed Part, in the shape partFromFirestore reads. */
async function seedPart(over = {}) {
  const partId = uniq("SKU");
  await db.collection("parts").doc(partId).set({
    partId, internalPartNumber: partId, name: `Fixture ${partId}`,
    status: "ACTIVE", stockingUnit: "EACH", controlType: "SERIALIZED", stockingClass: "STOCKED",
    version: 1, createdAt: Timestamp.fromDate(NOW), createdBy: "seed",
    updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
    ...over,
  });
  return partId;
}

const acquireRequest = (o, over = {}) => ({
  partId: o.partId, serialNo: o.serialNo, locationId: o.locationId,
  reason: "EXISTING_COMPANY_ASSET", idempotencyKey: uniq("idem"), ...over,
});

async function fixture(overPart = {}) {
  const [partId, locationId] = [await seedPart(overPart), await seedWarehouse(uniq("wh"))];
  return { partId, locationId, serialNo: uniq("SN") };
}

// ── AUTHENTICATION ────────────────────────────────────────────────────────────────────────────

await check("an unauthenticated caller is refused before the command is reached", async () => {
  const o = await fixture();
  const r = await failsWith(() => acquireSerializedAsset.run(req(acquireRequest(o))));
  assert.equal(r.threw, true);
  assert.equal(r.code, "unauthenticated");
  // The assertion that matters: nothing was created. An unauthenticated request must not have
  // reached a command that puts a machine on the company's books.
  const snap = await db.collection("serialized_assets").doc(serializedAssetDocId(o.partId, o.serialNo)).get();
  assert.equal(snap.exists, false);
});

// ── AUTHORIZATION, THROUGH REAL RECORDS ───────────────────────────────────────────────────────

await check("a principal with NO roles is denied", async () => {
  const [uid, o] = [await seedActor(), await fixture()];
  const r = await failsWith(() => acquireSerializedAsset.run(req(acquireRequest(o), uid)));
  assert.equal(r.code, "permission-denied");
  assert.equal(r.details, "PERMISSION_DENIED");
});

await check("THE INSTALLER IS DENIED — the separation of stations survives the callable", async () => {
  // The mirror of installCallable's own test, and the control that would be silently lost if this
  // adapter resolved a different capability, or none. equipmentInstaller may place a unit at a
  // customer and must never be able to bring one into existence.
  const [uid, o] = [await seedActor("equipmentInstaller"), await fixture()];
  const r = await failsWith(() => acquireSerializedAsset.run(req(acquireRequest(o), uid)));
  assert.equal(r.code, "permission-denied");
  assert.notEqual(SERIALIZED_ASSET_ACQUIRE_CAPABILITY, EQUIPMENT_INSTALL_CAPABILITY);
});

await check("the acquirer reaches the command and the unit lands on the books", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const request = acquireRequest(o, { reason: "OPENING_BALANCE", provenanceNote: "counted in the van" });
  const out = await acquireSerializedAsset.run(req(request, uid));

  assert.equal(out.outcome, "acquired");
  assert.equal(out.serializedAssetId, serializedAssetDocId(o.partId, o.serialNo));
  assert.equal(out.state, ACQUIRED_INITIAL_STATE);
  assert.equal(out.reason, "OPENING_BALANCE");

  const asset = (await db.collection("serialized_assets").doc(out.serializedAssetId).get()).data();
  assert.equal(asset.inventoryState, "AVAILABLE");
  assert.equal(asset.ownership, "COMPANY");
  assert.equal(asset.acquisitionProvenance, ACQUISITION_PROVENANCE);
  assert.equal(asset.acquisitionReason, "OPENING_BALANCE");
  assert.equal(asset.acquisitionNote, "counted in the van");
  assert.equal(asset.currentLocationId, o.locationId);
  // NOT INSTALLED, and no customer. Acquiring is custody, not placement.
  assert.equal(asset.currentEquipmentId, null);
  // NO RECEIVING PROVENANCE. A report asking "what did we receive?" filters on this field and an
  // acquired unit must never answer.
  assert.equal("activatedByReceivingId" in asset, false);
  // AND NO EQUIPMENT RECORD ANYWHERE.
  const eq = await db.collection("equipment").where("serializedAssetId", "==", out.serializedAssetId).get();
  assert.equal(eq.size, 0);
  // The actor is recorded as the authenticated session.
  assert.equal(asset.createdByUid, uid);
});

await check("THE ACTOR IS THE SESSION — a payload cannot name a different acquirer", async () => {
  // If the adapter read an actor from the request, this is the shape that would exploit it. The
  // command's allow-list refuses the unknown key outright, which is the stronger answer: the
  // request is invalid rather than merely ineffective.
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req({ ...acquireRequest(o), actorId: "somebody-else" }, uid)));
  assert.equal(r.code, "invalid-argument");
  assert.equal(r.details, "REQUEST_INVALID");
});

// ── INPUT, THROUGH THE COMMAND'S OWN CONTRACT ─────────────────────────────────────────────────

await check("an unrecognised reason is refused, never coerced to a default", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req(acquireRequest(o, { reason: "WE_BOUGHT_IT" }), uid)));
  assert.equal(r.code, "invalid-argument");
  assert.equal(r.details, "REQUEST_INVALID");
  // "we bought it" is deliberately not in the set: a purchased unit has a purchase order.
  assert.equal(ACQUISITION_REASONS.includes("WE_BOUGHT_IT"), false);
});

await check("a missing idempotencyKey is refused", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const { idempotencyKey, ...withoutKey } = acquireRequest(o);
  void idempotencyKey;
  const r = await failsWith(() => acquireSerializedAsset.run(req(withoutKey, uid)));
  assert.equal(r.code, "invalid-argument");
  assert.equal(r.details, "REQUEST_INVALID");
});

await check("a missing serialNo is refused", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const { serialNo, ...withoutSerial } = acquireRequest(o);
  void serialNo;
  const r = await failsWith(() => acquireSerializedAsset.run(req(withoutSerial, uid)));
  assert.equal(r.details, "REQUEST_INVALID");
});

// ── THE PART ──────────────────────────────────────────────────────────────────────────────────

await check("a Part that does not exist is refused as NOT_FOUND", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req(acquireRequest(o, { partId: uniq("MISSING") }), uid)));
  assert.equal(r.code, "not-found");
  assert.equal(r.details, "PART_NOT_FOUND");
});

await check("an INACTIVE Part is refused", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture({ status: "DISCONTINUED" })];
  const r = await failsWith(() => acquireSerializedAsset.run(req(acquireRequest(o), uid)));
  assert.equal(r.details, "PART_NOT_FOUND");
});

await check("a NON-SERIAL Part is refused, and says so distinctly from 'not found'", async () => {
  // A quantity part is real and the wrong KIND. "Not found" would send somebody hunting for a Part
  // that is sitting in front of them.
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture({ controlType: "STANDARD" })];
  const r = await failsWith(() => acquireSerializedAsset.run(req(acquireRequest(o), uid)));
  assert.equal(r.code, "failed-precondition");
  assert.equal(r.details, "PART_NOT_SERIALIZED");
});

// ── THE LOCATION ──────────────────────────────────────────────────────────────────────────────

await check("a location that is not a governed warehouse is refused", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req(acquireRequest(o, { locationId: uniq("nowhere") }), uid)));
  assert.equal(r.code, "invalid-argument");
  assert.equal(r.details, "LOCATION_INVALID");
});

await check("an INACTIVE warehouse is refused", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const inactive = await seedWarehouse(uniq("wh"), { status: "INACTIVE" });
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req(acquireRequest(o, { locationId: inactive }), uid)));
  assert.equal(r.details, "LOCATION_INVALID");
});

await check("A CUSTOMER LOCATION CAN NEVER QUALIFY", async () => {
  // The property that keeps acquisition from becoming installation by another name. A customer
  // location lives in `locations`, and the warehouse resolver reads `warehouses` — so it fails
  // closed without ever needing to know what a customer is.
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const customerLocationId = uniq("custloc");
  await db.collection("locations").doc(customerLocationId).set({ accountId: uniq("acct"), name: "Customer Site" });
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req(acquireRequest(o, { locationId: customerLocationId }), uid)));
  assert.equal(r.details, "LOCATION_INVALID");
});

// ── IDEMPOTENCY, AND THE HISTORY THAT MUST NOT BE OVERWRITTEN ─────────────────────────────────

await check("the same intent replays rather than acquiring twice", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const request = acquireRequest(o, { reason: "LEGACY_MIGRATION" });
  const first = await acquireSerializedAsset.run(req(request, uid));
  assert.equal(first.outcome, "acquired");
  // Same intent, and deliberately a DIFFERENT idempotency key: identity is derived from
  // part+serial, so the second call is the same unit however it is keyed.
  const second = await acquireSerializedAsset.run(req({ ...request, idempotencyKey: uniq("idem") }, uid));
  assert.equal(second.outcome, "replayed");
  assert.equal(second.serializedAssetId, first.serializedAssetId);
  assert.equal(second.state, ACQUIRED_INITIAL_STATE);
});

await check("a DIFFERENT reason for the same unit is a conflict, not a silent overwrite", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  await acquireSerializedAsset.run(req(acquireRequest(o, { reason: "OPENING_BALANCE" }), uid));
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req(acquireRequest(o, { reason: "LEGACY_MIGRATION" }), uid)));
  assert.equal(r.code, "failed-precondition");
  assert.equal(r.details, "ALREADY_EXISTS_CONFLICT");
});

await check("a DIFFERENT location for the same unit is a conflict", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  await acquireSerializedAsset.run(req(acquireRequest(o), uid));
  const elsewhere = await seedWarehouse(uniq("wh"));
  const r = await failsWith(() =>
    acquireSerializedAsset.run(req(acquireRequest(o, { locationId: elsewhere }), uid)));
  assert.equal(r.details, "ALREADY_EXISTS_CONFLICT");
});

await check("A RECEIVED UNIT IS NEVER REWRITTEN AS ACQUIRED", async () => {
  // The one that erases real purchasing history if it is wrong, and the one nothing else would
  // catch: the write would succeed and the receipt would simply be gone.
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const assetId = serializedAssetDocId(o.partId, o.serialNo);
  await db.collection("serialized_assets").doc(assetId).set({
    schemaVersion: 1, serialNo: o.serialNo, partId: o.partId, currentLocationId: o.locationId,
    inventoryState: "AVAILABLE", currentEquipmentId: null, ownership: "COMPANY",
    // Arrived by RECEIPT — note the absence of acquisitionReason, which is what the command keys on.
    activatedByReceivingId: uniq("recv"),
    createdAtMillis: stamp, createdByUid: "receiving", updatedAtMillis: stamp, updatedByUid: "receiving",
  });
  const r = await failsWith(() => acquireSerializedAsset.run(req(acquireRequest(o), uid)));
  assert.equal(r.details, "ALREADY_EXISTS_CONFLICT");
  const after = (await db.collection("serialized_assets").doc(assetId).get()).data();
  assert.equal(after.acquisitionReason, undefined);
  assert.ok(after.activatedByReceivingId, "the receipt provenance must survive untouched");
});

// ── AUDIT ─────────────────────────────────────────────────────────────────────────────────────

await check("an acquisition stages the governed audit event", async () => {
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await fixture()];
  const out = await acquireSerializedAsset.run(req(acquireRequest(o), uid));
  const events = await db.collection("auditEvents")
    .where("targetId", "==", out.serializedAssetId).get();
  assert.ok(events.size >= 1, "an audit event must exist for the acquisition");
  const event = events.docs[0].data();
  assert.equal(event.action, "acquireSerializedAsset");
  assert.equal(event.actorUid, uid);
  assert.equal(event.targetType, "serializedAsset");
  // Distinguishable from a receipt in a query AND at a glance.
  assert.match(event.summary, /no purchase order/);
});

// ── TRANSPORT ─────────────────────────────────────────────────────────────────────────────────

await check("every AcquireFailureCode has an explicit mapping — none defaults", async () => {
  // Read off the adapter's own table rather than re-listing it here, so a code added to the command
  // without a mapping fails this test rather than reaching a caller as an unhandled internal error.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/serializedAsset/acquireCallables.ts", import.meta.url), "utf8"));
  const commandSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/serializedAsset/acquireSerializedAssetCommand.ts", import.meta.url), "utf8"));
  const declared = [...commandSrc.matchAll(/^\s*\|\s*"([A-Z_]+)"/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 7, `expected the failure union, found ${declared.length}`);
  for (const code of declared) {
    assert.ok(new RegExp(`${code}:\\s*\\{`).test(src), `${code} has no explicit mapping in the callable`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
