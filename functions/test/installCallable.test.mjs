// THE INSTALL CALLABLE — a boundary test, because the boundary is all this file is.
//
// ============================ WHAT IS AND IS NOT BEING TESTED ============================
//
// installSerializedAssetCommand already has 22 tests covering what installation MEANS: the
// installable states, the account/location consistency rule, idempotency through a derived Equipment
// id, and the single transaction. None of that is retested here, because retesting it through a
// second surface is how two surfaces start disagreeing about which one is authoritative.
//
// What IS tested is everything the adapter could get wrong on its own:
//
//   an unauthenticated caller never reaches the command
//   the ACTOR is the authenticated session, never a field in the payload
//   capability resolution runs against real roleAssignments, in the real environment posture
//   every command refusal reaches the caller as a code it can act on
//
// That last one matters most for ALREADY_INSTALLED. The client's whole duplicate-submission story
// depends on being able to tell "already at this customer" from "failed" -- and if the adapter
// flattened both into `internal`, the UI would keep offering a retry for a machine that is already
// installed.
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";       // activates equipment.install
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "demo-install-callable" });
const db = admin.firestore();

const { installSerializedAssetCallable: installSerializedAsset } =
  await import("../lib/equipmentInstall/installCallables.js");
const { EQUIPMENT_INSTALL_CAPABILITY, equipmentDocIdFor } =
  await import("../lib/equipmentInstall/installSerializedAssetCommand.js");
const { SERIALIZED_ASSET_ACQUIRE_CAPABILITY } =
  await import("../lib/serializedAsset/acquireSerializedAssetCommand.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err?.message ?? err); }
}

const stamp = Date.now();
let seq = 0;
const uniq = (p) => `${p}-${stamp}-${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid === undefined ? undefined : { uid: authUid, token: {} } });

/** A principal holding exactly the Roles named -- the real records the resolver reads. */
async function seedActor(...roleIds) {
  const uid = uniq("uid");
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  for (const roleId of roleIds) {
    const id = uniq("asg");
    await db.collection("roleAssignments").doc(id).set({
      id, principalUid: uid, roleId, scope: { type: "global" },
      grantedBy: "test", grantedAt: admin.firestore.Timestamp.now(),
      status: "active", accessVersionAtGrant: 1,
    });
  }
  return uid;
}

/** A customer, one of its locations, and an AVAILABLE unit sitting in a warehouse. */
async function seedInstallable() {
  const accountId = uniq("acct");
  const locationId = uniq("loc");
  const partId = uniq("PART");
  const serialNo = uniq("SN");
  await db.collection("accounts").doc(accountId).set({ name: "Test Customer" });
  await db.collection("locations").doc(locationId).set({ accountId, name: "Test Site" });
  const assetId = uniq("sa");
  await db.collection("serialized_assets").doc(assetId).set({
    schemaVersion: 1, serialNo, partId, currentLocationId: "wh-test",
    ownership: "COMPANY", inventoryState: "AVAILABLE", currentEquipmentId: null,
    createdAtMillis: stamp, createdByUid: "test", updatedAtMillis: stamp, updatedByUid: "test",
  });
  return { accountId, locationId, assetId, serialNo, partId };
}

const installRequest = (o, over = {}) => ({
  serializedAssetId: o.assetId, accountId: o.accountId, locationId: o.locationId,
  name: `Unit ${o.serialNo}`, idempotencyKey: uniq("idem"), ...over,
});

const failsWith = async (fn, code) => {
  try { await fn(); return { threw: false }; }
  catch (err) { return { threw: true, code: err?.code, details: err?.details, message: err?.message }; }
};

// ── AUTHENTICATION ────────────────────────────────────────────────────────────────────────────

await check("an unauthenticated caller is refused before the command is reached", async () => {
  const o = await seedInstallable();
  const r = await failsWith(() => installSerializedAsset.run(req(installRequest(o))));
  assert.equal(r.threw, true);
  assert.equal(r.code, "unauthenticated");
  // Nothing was created. The assertion that matters: an unauthenticated request must not have
  // reached a command whose write is irreversible.
  const eq = await db.collection("equipment").where("serializedAssetId", "==", o.assetId).get();
  assert.equal(eq.size, 0);
});

// ── AUTHORIZATION, THROUGH REAL RECORDS ───────────────────────────────────────────────────────

await check("a principal with NO roles is denied", async () => {
  const [uid, o] = [await seedActor(), await seedInstallable()];
  const r = await failsWith(() => installSerializedAsset.run(req(installRequest(o), uid)));
  assert.equal(r.code, "permission-denied");
  assert.equal(r.details, "PERMISSION_DENIED");
});

await check("THE ACQUIRER IS DENIED -- the separation survives the callable", async () => {
  // The control that would be silently lost if the adapter resolved a different capability, or the
  // wrong one, or none. inventorySerializedAssetAcquirer may bring units onto the books and must
  // never be able to place one at a customer.
  const [uid, o] = [await seedActor("inventorySerializedAssetAcquirer"), await seedInstallable()];
  const r = await failsWith(() => installSerializedAsset.run(req(installRequest(o), uid)));
  assert.equal(r.code, "permission-denied");
  assert.notEqual(SERIALIZED_ASSET_ACQUIRE_CAPABILITY, EQUIPMENT_INSTALL_CAPABILITY);
});

await check("the installer succeeds, and the Equipment carries the asset", async () => {
  const [uid, o] = [await seedActor("equipmentInstaller"), await seedInstallable()];
  const request = installRequest(o);
  const out = await installSerializedAsset.run(req(request, uid));
  assert.equal(out.outcome, "installed");
  assert.equal(out.equipmentId, equipmentDocIdFor(request.idempotencyKey));
  const eq = (await db.collection("equipment").doc(out.equipmentId).get()).data();
  assert.equal(eq.serializedAssetId, o.assetId);
  assert.equal(eq.accountId, o.accountId);
  assert.equal(eq.locationId, o.locationId);
  const asset = (await db.collection("serialized_assets").doc(o.assetId).get()).data();
  assert.equal(asset.inventoryState, "INSTALLED");
  assert.equal(asset.currentEquipmentId, out.equipmentId);
});

await check("THE ACTOR IS THE SESSION -- a payload cannot name a different installer", async () => {
  // If the adapter read an actor from the request, this would be the shape that exploits it: an
  // unauthorized caller attributing the installation to somebody who IS authorized. The command's
  // allow-list rejects the unknown field outright, which is the stronger answer -- the request is
  // refused rather than quietly ignored.
  const [uid, o] = [await seedActor(), await seedInstallable()];
  const installerUid = await seedActor("equipmentInstaller");
  const r = await failsWith(() => installSerializedAsset.run(
    req({ ...installRequest(o), actorUid: installerUid }, uid)));
  assert.equal(r.threw, true);
  assert.ok(r.code === "invalid-argument" || r.code === "permission-denied",
    `expected refusal, got ${r.code}`);
});

// ── THE REFUSALS THE CLIENT HAS TO TELL APART ────────────────────────────────────────────────

await check("ALREADY_INSTALLED arrives as an actionable code, not a generic failure", async () => {
  // The one the duplicate-submission UX depends on. A client that could not distinguish this would
  // keep offering a retry for a machine that is already at a customer.
  const [uid, o] = [await seedActor("equipmentInstaller"), await seedInstallable()];
  await installSerializedAsset.run(req(installRequest(o), uid));
  const r = await failsWith(() => installSerializedAsset.run(req(installRequest(o), uid)));
  assert.equal(r.code, "failed-precondition");
  assert.equal(r.details, "ALREADY_INSTALLED");
});

await check("a REPLAY of the same key returns the same Equipment, not a second machine", async () => {
  const [uid, o] = [await seedActor("equipmentInstaller"), await seedInstallable()];
  const request = installRequest(o);
  const first = await installSerializedAsset.run(req(request, uid));
  const again = await installSerializedAsset.run(req(request, uid));
  assert.equal(again.outcome, "replayed");
  assert.equal(again.equipmentId, first.equipmentId);
  const all = await db.collection("equipment").where("serializedAssetId", "==", o.assetId).get();
  assert.equal(all.size, 1, "a network retry created a second Equipment record");
});

await check("LOCATION_NOT_OF_ACCOUNT reaches the caller as invalid-argument", async () => {
  // The backend is the authority on this pairing, whatever the client filtered. A UI bug that let a
  // mismatched pair through must produce a refusal the user can read, not an internal error.
  const [uid, a, b] = [await seedActor("equipmentInstaller"), await seedInstallable(), await seedInstallable()];
  const r = await failsWith(() => installSerializedAsset.run(
    req(installRequest(a, { locationId: b.locationId }), uid)));
  assert.equal(r.code, "invalid-argument");
  assert.equal(r.details, "LOCATION_NOT_OF_ACCOUNT");
});

await check("a missing customer is not-found, not internal", async () => {
  const [uid, o] = [await seedActor("equipmentInstaller"), await seedInstallable()];
  const r = await failsWith(() => installSerializedAsset.run(
    req(installRequest(o, { accountId: "no-such-account" }), uid)));
  assert.equal(r.code, "not-found");
  assert.equal(r.details, "ACCOUNT_NOT_FOUND");
});

await check("an invalid request is invalid-argument", async () => {
  const [uid, o] = [await seedActor("equipmentInstaller"), await seedInstallable()];
  const r = await failsWith(() => installSerializedAsset.run(
    req({ serializedAssetId: o.assetId, accountId: o.accountId, locationId: o.locationId }, uid)));
  assert.equal(r.code, "invalid-argument");
  assert.equal(r.details, "REQUEST_INVALID");
});

await check("EVERY failure code has an explicit mapping -- none defaults to internal", async () => {
  // A default would send a code the client cannot branch on the first time somebody adds one.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/equipmentInstall/installCallables.ts", import.meta.url), "utf8"));
  const commandSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/equipmentInstall/installSerializedAssetCommand.ts", import.meta.url), "utf8"));
  const declared = [...commandSrc.matchAll(/^\s*\|\s*"([A-Z_]+)"$/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 10, `expected the failure union, found ${declared.length}`);
  for (const code of declared) {
    assert.ok(new RegExp(`\\b${code}:\\s*\\{`).test(src), `${code} has no explicit HTTPS mapping`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
