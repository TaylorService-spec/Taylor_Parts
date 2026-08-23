// TECHNICIAN WORK ORDER CLOSEOUT INSTALLATION — the boundary, the ordering, and the refusals.
//
// ============================ WHAT IS ACTUALLY AT RISK HERE ============================
//
// This path gives a technician the ability to place a machine at a customer permanently, from a
// device in the field, on a job they are already doing. The things that can go wrong are not exotic:
//
//   installing on somebody else's job
//   installing against a job that is not an installation at all
//   installing a component instead of a machine
//   installing twice because the network dropped
//   ending up with a completed job whose installation never happened
//
// Every one of those has a test below, and the refusals are asserted by CODE rather than by message,
// because the codes are what the closeout UI branches on.
//
// Capability is resolved against REAL roleAssignment documents in the emulator. A stubbed authorizer
// would prove nothing about the control that keeps a technician on their own work order.
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";       // activates equipment.install
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "demo-wo-install" });
const db = admin.firestore();

const {
  recordWorkOrderEquipmentInstall,
  validateWorkOrderInstallRequest,
  assertWorkOrderInstallable,
  WorkOrderInstallError,
  INSTALL_WORK_ORDER_TYPE,
  INSTALLABLE_WORK_ORDER_STATUSES,
} = await import("../lib/workOrderInstall/workOrderInstallCommand.js");
const { EQUIPMENT_INSTALL_CAPABILITY, INSTALLABLE_STATES } =
  await import("../lib/equipmentInstall/installSerializedAssetCommand.js");
const { makeResolveInstallPermissionThroughTxn, stageInstallAuditEvent } =
  await import("../lib/equipmentInstall/installCallableWiring.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err?.message ?? err); }
}

const stamp = Date.now();
let seq = 0;
const uniq = (p) => `${p}-${stamp}-${(seq += 1)}`;

const throughTxn = makeResolveInstallPermissionThroughTxn(EQUIPMENT_INSTALL_CAPABILITY);
/** The real resolver, in and out of a transaction — the same records the deployed callable reads. */
const authorize = (txn, actorId, capability) =>
  txn === null
    ? throughTxn.__outside ? throughTxn.__outside(actorId) : resolveOutside(actorId, capability)
    : throughTxn(txn, db, actorId);

// Outside a transaction the deployed callable uses the trusted feed. Reproducing the feed here would
// be a second implementation, so this reads the same documents the in-transaction resolver does.
async function resolveOutside(actorId, capability) {
  return db.runTransaction((txn) => throughTxn(txn, db, actorId));
}

/** A technician principal holding exactly these governed roles, linked to a technicianId. */
async function seedTechnician({ roleIds = [], technicianId = null, role = "technician" } = {}) {
  const uid = uniq("uid");
  const techId = technicianId ?? uniq("tech");
  await db.collection("users").doc(uid).set({ accessVersion: 1, role, technicianId: techId });
  for (const roleId of roleIds) {
    const id = uniq("asg");
    await db.collection("roleAssignments").doc(id).set({
      id, principalUid: uid, roleId, scope: { type: "global" },
      grantedBy: "test", grantedAt: admin.firestore.Timestamp.now(),
      status: "active", accessVersionAtGrant: 1,
    });
  }
  return { uid, technicianId: techId, role };
}

/** A customer, a location of theirs, an INSTALL work order in progress, and a machine to install. */
async function seedJob({ assignedTechId, type = INSTALL_WORK_ORDER_TYPE, status = "WORK_IN_PROGRESS", wholeUnit = true, inventoryState = "AVAILABLE" } = {}) {
  const accountId = uniq("acct");
  const locationId = uniq("loc");
  const partId = uniq("PART");
  const serialNo = uniq("SN");
  const workOrderId = uniq("wo");
  await db.collection("accounts").doc(accountId).set({ name: "Test Customer" });
  await db.collection("locations").doc(locationId).set({ accountId, name: "Test Site" });
  await db.collection("parts").doc(partId).set({ partId, name: "Taylor Test Machine", wholeUnit, equipmentModelId: "TAYLOR--TEST" });
  const assetId = uniq("sa");
  await db.collection("serialized_assets").doc(assetId).set({
    schemaVersion: 1, serialNo, partId, currentLocationId: "wh-test",
    ownership: "COMPANY", inventoryState, currentEquipmentId: null,
    createdAtMillis: stamp, createdByUid: "t", updatedAtMillis: stamp, updatedByUid: "t",
  });
  await db.collection("fieldops_wos").doc(workOrderId).set({
    id: workOrderId, woNumber: uniq("WO"), status, type,
    customerId: accountId, locationId, assignedTechId, priority: 2,
  });
  return { accountId, locationId, workOrderId, assetId, serialNo, partId };
}

const deps = (actor) => ({
  db, actor, authorize, stageAudit: stageInstallAuditEvent, now: () => new Date("2026-08-23T18:00:00.000Z"),
});
const actorOf = (t) => ({ kind: "USER", id: t.uid, technicianId: t.technicianId, role: t.role });
const req = (job, over = {}) => ({
  workOrderId: job.workOrderId, serializedAssetId: job.assetId, idempotencyKey: uniq("idem"), ...over,
});
const fails = async (fn) => {
  try { await fn(); return { threw: false }; }
  catch (err) { return { threw: true, code: err?.code, message: err?.message }; }
};

// ── THE REQUEST SHAPE ─────────────────────────────────────────────────────────────────────────

await check("customer and location may NOT be supplied -- they come from the work order", () => {
  // REFUSED, not ignored. Silently dropping them would let a technician believe they had chosen a
  // customer, and the mismatch would surface later as an installation somewhere nobody intended.
  for (const field of ["accountId", "locationId"]) {
    const r = (() => { try { validateWorkOrderInstallRequest({ workOrderId: "w", serializedAssetId: "s", idempotencyKey: "k", [field]: "x" }); return null; } catch (e) { return e; } })();
    assert.ok(r instanceof WorkOrderInstallError, `${field} should be refused`);
    assert.match(r.message, /derived from the work order/);
  }
});

// ── WHOSE JOB ─────────────────────────────────────────────────────────────────────────────────

await check("the assigned technician may record the installation", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const out = await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech)));
  assert.equal(out.outcome, "installed");
  assert.equal(out.accountId, job.accountId, "customer must be inherited from the work order");
  assert.equal(out.locationId, job.locationId, "location must be inherited from the work order");
  assert.equal(out.completionRequired, true, "the job still has to be completed");
  const eq = (await db.collection("equipment").doc(out.equipmentId).get()).data();
  assert.equal(eq.accountId, job.accountId);
  assert.equal(eq.serializedAssetId, job.assetId);
});

await check("ANOTHER technician who also holds equipment.install is DENIED", async () => {
  // The control that matters most. Holding the capability is not permission to finish somebody
  // else's job, and this is exactly the boundary Complete already enforces.
  const owner = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const other = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: owner.technicianId });
  const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(other))));
  assert.equal(r.code, "NOT_ASSIGNED_TECHNICIAN");
  const eq = await db.collection("equipment").where("serializedAssetId", "==", job.assetId).get();
  assert.equal(eq.size, 0, "a denied attempt created equipment");
});

await check("a technician WITHOUT the installer role is denied, and learns nothing about the job", async () => {
  const tech = await seedTechnician({ roleIds: [] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech))));
  assert.equal(r.code, "PERMISSION_DENIED");
  // Capability is checked BEFORE the work order is read, so the refusal cannot leak the customer.
  assert.ok(!r.message.includes(job.accountId));
});

await check("a manager-shaped actor is directed to the manager path", async () => {
  const mgr = await seedTechnician({ roleIds: ["equipmentInstaller"], role: "dispatcher" });
  const job = await seedJob({ assignedTechId: mgr.technicianId });
  const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(mgr))));
  assert.equal(r.code, "NOT_ASSIGNED_TECHNICIAN");
});

// ── WHICH JOB ─────────────────────────────────────────────────────────────────────────────────

await check("a NON-INSTALL work order is refused", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  for (const type of ["SERVICE_CALL", "PM", "WARRANTY", "INSPECTION"]) {
    const job = await seedJob({ assignedTechId: tech.technicianId, type });
    const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech))));
    assert.equal(r.code, "WORK_ORDER_NOT_INSTALL_TYPE", `${type} should not carry an installation`);
  }
});

await check("LEGACY DATA: a missing or unknown type is NEVER read as INSTALL", async () => {
  // Live data contains work orders typed "SERVICE" -- not a member of WorkOrderType -- and work
  // orders with no type at all. Treating either as an installation would install machines against
  // jobs nobody classified.
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  for (const type of ["SERVICE", null, "", "install"]) {
    const job = await seedJob({ assignedTechId: tech.technicianId, type: type ?? undefined });
    if (type === null) await db.collection("fieldops_wos").doc(job.workOrderId).update({ type: admin.firestore.FieldValue.delete() });
    const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech))));
    assert.equal(r.code, "WORK_ORDER_NOT_INSTALL_TYPE", `${String(type)} must not be read as INSTALL`);
  }
});

await check("a work order that is not in progress is refused", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  for (const status of ["CREATED", "SCHEDULED", "ARRIVED", "COMPLETED", "CLOSED", "CANCELLED"]) {
    const job = await seedJob({ assignedTechId: tech.technicianId, status });
    const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech))));
    assert.equal(r.code, "WORK_ORDER_STATE_INVALID", `${status} should not accept an installation`);
  }
  assert.deepEqual([...INSTALLABLE_WORK_ORDER_STATUSES], ["WORK_IN_PROGRESS"]);
});

await check("a work order with no customer or no location is refused, not defaulted", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const a = await seedJob({ assignedTechId: tech.technicianId });
  await db.collection("fieldops_wos").doc(a.workOrderId).update({ customerId: admin.firestore.FieldValue.delete() });
  assert.equal((await fails(() => recordWorkOrderEquipmentInstall(req(a), deps(actorOf(tech))))).code, "WORK_ORDER_MISSING_CUSTOMER");
  const b = await seedJob({ assignedTechId: tech.technicianId });
  await db.collection("fieldops_wos").doc(b.workOrderId).update({ locationId: admin.firestore.FieldValue.delete() });
  assert.equal((await fails(() => recordWorkOrderEquipmentInstall(req(b), deps(actorOf(tech))))).code, "WORK_ORDER_MISSING_LOCATION");
});

await check("a work order that does not exist is not-found", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const r = await fails(() => recordWorkOrderEquipmentInstall(req(job, { workOrderId: "no-such-wo" }), deps(actorOf(tech))));
  assert.equal(r.code, "WORK_ORDER_NOT_FOUND");
});

// ── WHICH MACHINE ─────────────────────────────────────────────────────────────────────────────

await check("a SERIALIZED COMPONENT cannot be installed as customer equipment", async () => {
  // A control board has a serial too. Installing one would put a component in the installed base as
  // if it were a machine.
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId, wholeUnit: false });
  const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech))));
  assert.equal(r.code, "ASSET_NOT_WHOLE_UNIT");
});

await check("a unit in a non-installable state is refused", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  for (const state of ["RECEIVED", "LOADED", "IN_TRANSIT"]) {
    const job = await seedJob({ assignedTechId: tech.technicianId, inventoryState: state });
    const r = await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech))));
    assert.equal(r.code, "ASSET_NOT_INSTALLABLE", `${state} should not be installable`);
    assert.equal(INSTALLABLE_STATES.includes(state), false);
  }
});

await check("an unknown serial is not-found", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const r = await fails(() => recordWorkOrderEquipmentInstall(req(job, { serializedAssetId: "sa_nope" }), deps(actorOf(tech))));
  assert.equal(r.code, "ASSET_NOT_FOUND");
});

await check("a unit installed for ANOTHER customer cannot be installed again", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const first = await seedJob({ assignedTechId: tech.technicianId });
  const done = await recordWorkOrderEquipmentInstall(req(first), deps(actorOf(tech)));
  assert.equal(done.outcome, "installed");
  // A second job, a different customer, the same physical machine.
  const second = await seedJob({ assignedTechId: tech.technicianId });
  const r = await fails(() => recordWorkOrderEquipmentInstall(
    req(second, { serializedAssetId: first.assetId }), deps(actorOf(tech))));
  assert.equal(r.code, "ASSET_INSTALLED_ELSEWHERE");
});

// ── RETRY, WITHOUT THE BROWSER REMEMBERING ANYTHING ──────────────────────────────────────────

await check("the SAME request replays -- one machine, one Equipment", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const request = req(job);
  const first = await recordWorkOrderEquipmentInstall(request, deps(actorOf(tech)));
  const again = await recordWorkOrderEquipmentInstall(request, deps(actorOf(tech)));
  assert.equal(again.equipmentId, first.equipmentId);
  const all = await db.collection("equipment").where("serializedAssetId", "==", job.assetId).get();
  assert.equal(all.size, 1, "a retry created a second Equipment record");
});

await check("A LOST RESPONSE IS RECOVERED FROM THE DATABASE, not from the tab", async () => {
  // The technician's first attempt succeeded but they never saw the answer. They retry with a NEW
  // idempotency key -- because the browser lost everything -- and must still not install twice.
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const first = await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech)));

  const retry = await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech)));   // new key
  assert.equal(retry.outcome, "already_installed_for_this_work_order");
  assert.equal(retry.equipmentId, first.equipmentId, "the retry must name the SAME equipment");
  assert.equal(retry.completionRequired, true, "the job still needs completing");
  const all = await db.collection("equipment").where("serializedAssetId", "==", job.assetId).get();
  assert.equal(all.size, 1);
});

await check("recovery reports completionRequired FALSE once the work order is done", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech)));
  await db.collection("fieldops_wos").doc(job.workOrderId).update({ status: "COMPLETED" });
  // The work order is no longer WORK_IN_PROGRESS, so a fresh install would be refused -- but the
  // recovery path answers first, because the machine IS installed and saying otherwise would be false.
  const after = await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech)));
  assert.equal(after.outcome, "already_installed_for_this_work_order");
  assert.equal(after.completionRequired, false);
});

// ── THIS COMMAND DOES NOT COMPLETE THE JOB ───────────────────────────────────────────────────

await check("THE WORK ORDER IS NOT TOUCHED -- ordering, not atomicity", async () => {
  // The whole consistency model in one assertion: installing does not complete. Completion is a
  // separate call, so a completed job whose installation failed cannot exist.
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const before = (await db.collection("fieldops_wos").doc(job.workOrderId).get()).data();
  const out = await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech)));
  const after = (await db.collection("fieldops_wos").doc(job.workOrderId).get()).data();
  assert.deepEqual(after, before, "the work order document changed");
  assert.equal(after.status, "WORK_IN_PROGRESS");
  assert.equal(out.workOrderStatus, "WORK_IN_PROGRESS");
  assert.equal(out.completionRequired, true);
});

await check("A FAILED INSTALL LEAVES THE WORK ORDER COMPLETABLE", async () => {
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId, inventoryState: "IN_TRANSIT" });
  await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech))));
  const wo = (await db.collection("fieldops_wos").doc(job.workOrderId).get()).data();
  assert.equal(wo.status, "WORK_IN_PROGRESS", "a failed install must not disturb the job");
  const eq = await db.collection("equipment").where("serializedAssetId", "==", job.assetId).get();
  assert.equal(eq.size, 0);
});

// ── PROVENANCE ────────────────────────────────────────────────────────────────────────────────

await check("ONE install audit event, carrying the work order it discharged", async () => {
  // Not a second, independent technician-install event: "how many machines were installed" must have
  // one answer. The work order is the one thing the actor cannot carry.
  const tech = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: tech.technicianId });
  const out = await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(tech)));
  const events = await db.collection("auditEvents").where("targetId", "==", out.equipmentId).get();
  assert.equal(events.size, 1, "expected exactly one install audit event");
  const e = events.docs[0].data();
  assert.equal(e.action, "installSerializedAsset");
  assert.equal(e.actorUid, tech.uid, "the audit must name the authenticated technician");
  assert.match(e.summary, new RegExp(job.workOrderId), "the work order must be traceable from the event");
  assert.match(e.summary, /AVAILABLE@wh-test/, "prior state and location must be recorded");
});

// ── THE POLICY, STATED STRUCTURALLY ──────────────────────────────────────────────────────────

await check("INSTALL is the only type, and WORK_IN_PROGRESS the only state", () => {
  // Pinned so a later edit widens them deliberately rather than incidentally.
  assert.equal(INSTALL_WORK_ORDER_TYPE, "INSTALL");
  assert.deepEqual([...INSTALLABLE_WORK_ORDER_STATUSES], ["WORK_IN_PROGRESS"]);
});

await check("MUTATION: eligibility is what refuses -- drop it and the same call succeeds", async () => {
  // Proves the assignment check is load-bearing rather than incidental: the identical request that
  // was refused above succeeds once the technician IS the assigned one.
  const owner = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  const job = await seedJob({ assignedTechId: owner.technicianId });
  const other = await seedTechnician({ roleIds: ["equipmentInstaller"] });
  assert.equal((await fails(() => recordWorkOrderEquipmentInstall(req(job), deps(actorOf(other))))).code, "NOT_ASSIGNED_TECHNICIAN");
  const ok = await recordWorkOrderEquipmentInstall(req(job), deps(actorOf(owner)));
  assert.equal(ok.outcome, "installed");
});

await check("the work-order eligibility rule is pure and reusable by the read path", () => {
  // The read and the write must not drift into two different ideas of who may see what.
  const wo = { workOrderId: "w", status: "WORK_IN_PROGRESS", type: "INSTALL", customerId: "a", locationId: "l", assignedTechId: "t1", woNumber: "WO-1" };
  assert.doesNotThrow(() => assertWorkOrderInstallable(wo, { kind: "USER", id: "u", technicianId: "t1", role: "technician" }));
  assert.throws(() => assertWorkOrderInstallable(wo, { kind: "USER", id: "u", technicianId: "t2", role: "technician" }), WorkOrderInstallError);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
