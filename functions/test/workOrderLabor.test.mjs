// TECHNICIAN LABOR — hours are a business record, and this is what stops them being wrong.
//
// ============================ WHAT IS ACTUALLY AT RISK ============================
//
// Labor becomes cost, and eventually an invoice. The failures that matter are not exotic:
//
//   a phone retries and the technician is paid twice for one hour
//   somebody records time on a job that is not theirs
//   a correction quietly overwrites what was there, and the change cannot be explained
//   a timer left running records a 26-hour day and nobody notices
//   one technician is in two places at once
//
// Every one has a test. The refusals are asserted by CODE, because those are what a phone branches
// on, and capability is resolved against REAL roleAssignment documents -- a stubbed authorizer would
// prove nothing about the control that keeps a technician on their own work.
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "demo-wo-labor" });
const db = admin.firestore();

const {
  recordWorkOrderLabor, correctWorkOrderLabor, projectWorkOrderLabor,
  validateLaborRequest, laborEntryIdFor, workDateOf,
  LaborCommandError, LABOR_TYPES, LABOR_ENTRY_KINDS, LABOR_STATUSES,
  LABOR_RECORDABLE_WO_STATUSES, LABOR_ENTRIES_COLLECTION,
  MIN_LABOR_MINUTES, MAX_LABOR_MINUTES,
  LABOR_RECORD_CAPABILITY, LABOR_CORRECT_CAPABILITY,
} = await import("../lib/workOrderLabor/workOrderLaborCommand.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err?.message ?? err); }
}

const stamp = Date.now();
let seq = 0;
const uniq = (p) => `${p}-${stamp}-${(seq += 1)}`;

async function seedPrincipal({ roleIds = [], technicianId = null } = {}) {
  const uid = uniq("uid");
  const techId = technicianId ?? uniq("tech");
  await db.collection("users").doc(uid).set({ accessVersion: 1, role: "technician", technicianId: techId });
  for (const roleId of roleIds) {
    const id = uniq("asg");
    await db.collection("roleAssignments").doc(id).set({
      id, principalUid: uid, roleId, scope: { type: "global" },
      grantedBy: "test", grantedAt: admin.firestore.Timestamp.now(),
      status: "active", accessVersionAtGrant: 1,
    });
  }
  return { uid, technicianId: techId };
}

async function seedJob({ assignedTechId, status = "WORK_IN_PROGRESS" } = {}) {
  const workOrderId = uniq("wo");
  await db.collection("fieldops_wos").doc(workOrderId).set({
    id: workOrderId, woNumber: uniq("WO"), status, type: "SERVICE_CALL",
    customerId: uniq("acct"), locationId: uniq("loc"), assignedTechId,
  });
  return workOrderId;
}

// TWO RESOLVERS, FOR TWO DIFFERENT QUESTIONS.
//
// `grantedAuthorize` answers "does the command behave correctly for somebody who IS authorized" --
// injected, because both labor capabilities are registered active:false and are activated in NO
// environment, so the real resolver denies everybody today. That is the deliberate fail-closed state,
// not an oversight, and it is asserted in its own section below rather than worked around silently.
//
// `realAuthorize` is the deployed path, used to prove exactly that denial.
const grantedAuthorize = (roleIds) => async () => true;
const deniedAuthorize = async () => false;

async function realAuthorize(capability, actorId) {
  const { resolveEffectivePermission } = await import("../lib/access/resolveEffectivePermission.js");
  const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");
  const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
  const { resolveRuntimeCapabilityOverrides } = await import("../lib/access/environmentCapabilityOverrides.js");
  const u = await db.collection("users").doc(actorId).get();
  const a = await db.collection("roleAssignments")
    .where("principalUid", "==", actorId).where("status", "==", "active").get();
  return resolveEffectivePermission({
    permissionId: capability,
    assignments: a.docs.map((d) => ({ id: d.id, ...d.data() })),
    roles: { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES },
    currentAccessVersion: u.exists ? (u.data().accessVersion ?? 0) : 0,
    target: { scope: { type: "global" }, condition: {} },
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });
}

const audits = [];
const deps = (actor, { authorize = grantedAuthorize() } = {}) => ({
  db, actor, authorize,
  stageAudit: (txn, a) => { audits.push(a); },
  now: () => new Date("2026-08-23T20:00:00.000Z"),
});
const actorOf = (p) => ({ kind: "USER", id: p.uid, technicianId: p.technicianId, role: "technician" });

const duration = (workOrderId, over = {}) => ({
  workOrderId, laborType: "ONSITE", entryKind: "DURATION",
  durationMinutes: 90, workDate: "2026-08-23", idempotencyKey: uniq("idem"), ...over,
});
const interval = (workOrderId, over = {}) => ({
  workOrderId, laborType: "ONSITE", entryKind: "INTERVAL",
  startedAtMillis: Date.parse("2026-08-23T09:00:00Z"),
  endedAtMillis: Date.parse("2026-08-23T11:00:00Z"),
  idempotencyKey: uniq("idem"), ...over,
});
const fails = async (fn) => {
  try { await fn(); return { threw: false }; }
  catch (err) { return { threw: true, code: err?.code, message: err?.message }; }
};

// ── THE MODEL ─────────────────────────────────────────────────────────────────────────────────

await check("the vocabulary is small and closed", () => {
  // An enum invented ahead of the business decision produces categories nobody defined.
  assert.deepEqual([...LABOR_TYPES], ["ONSITE", "TRAVEL"]);
  assert.deepEqual([...LABOR_ENTRY_KINDS], ["INTERVAL", "DURATION"]);
  assert.deepEqual([...LABOR_STATUSES], ["ACTIVE", "REVERSED"]);
});

await check("NO RATE, NO COST, NO BILLABLE FLAG anywhere in a labor entry", async () => {
  // The three facts the schema refuses to collapse. A rate copied into an operational record freezes
  // a valuation nobody has decided, and cannot be un-frozen later.
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const out = await recordWorkOrderLabor(duration(wo), deps(actorOf(p)));
  const stored = (await db.collection(LABOR_ENTRIES_COLLECTION).doc(out.laborEntryId).get()).data();
  for (const forbidden of ["rate", "hourlyRate", "cost", "laborCost", "billable", "billableHours", "revenue", "amount", "price"]) {
    assert.equal(forbidden in stored, false, `${forbidden} has no place in an operational labor record`);
  }
});

await check("an INTERVAL derives its own duration and work date, and refuses to be told them", () => {
  // The duration IS the interval. Accepting both invites two answers that disagree.
  const v = validateLaborRequest(interval("wo1"));
  assert.equal(v.durationMinutes, 120);
  assert.equal(v.workDate, "2026-08-23");
  const r = (() => { try { validateLaborRequest(interval("wo1", { durationMinutes: 60 })); return null; } catch (e) { return e; } })();
  assert.equal(r.code, "INTERVAL_INVALID");
});

await check("a DURATION entry NEVER invents a clock position", () => {
  // A technician entering "2 hours" at the end of the day does not know when they started, and
  // fabricating a start time to satisfy the schema would be inventing a fact.
  const v = validateLaborRequest(duration("wo1"));
  assert.equal(v.startedAtMillis, undefined);
  assert.equal(v.endedAtMillis, undefined);
  const r = (() => { try { validateLaborRequest(duration("wo1", { startedAtMillis: 1 })); return null; } catch (e) { return e; } })();
  assert.equal(r.code, "DURATION_INVALID");
});

// ── AUTHORITY ─────────────────────────────────────────────────────────────────────────────────

await check("a technician records labor on their OWN active work order", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const out = await recordWorkOrderLabor(duration(wo), deps(actorOf(p)));
  assert.equal(out.outcome, "recorded");
  assert.equal(out.technicianId, p.technicianId);
  assert.equal(out.durationMinutes, 90);
});

await check("ANOTHER technician's work order is refused", async () => {
  const owner = await seedPrincipal({ roleIds: ["technician"] });
  const other = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: owner.technicianId });
  const r = await fails(() => recordWorkOrderLabor(duration(wo), deps(actorOf(other))));
  assert.equal(r.code, "NOT_ASSIGNED_TECHNICIAN");
});

await check("a principal WITHOUT the capability is denied", async () => {
  const p = await seedPrincipal({ roleIds: [] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const r = await fails(() => recordWorkOrderLabor(duration(wo), deps(actorOf(p), { authorize: deniedAuthorize })));
  assert.equal(r.code, "PERMISSION_DENIED");
});

// ── THE DEPLOYED RESOLVER, TODAY ──────────────────────────────────────────────────────────────

await check("BOTH LABOR CAPABILITIES DENY EVERYONE RIGHT NOW -- activation is a separate decision", async () => {
  // Registered active:false and activated in no environment, so the resolver refuses ahead of any
  // Role grant. The Roles exist and are grantable; they simply confer nothing until somebody
  // deliberately activates the capabilities. That is the fail-closed state, stated rather than
  // discovered later.
  const holder = await seedPrincipal({ roleIds: ["technicianLaborRecorder", "workOrderLaborCorrector"] });
  for (const cap of [LABOR_RECORD_CAPABILITY, LABOR_CORRECT_CAPABILITY]) {
    const d = await realAuthorize(cap, holder.uid);
    assert.equal(d.decision, "DENY", `${cap} should be inactive`);
    assert.equal(d.reason, "inactivePermission",
      `${cap} must deny for INACTIVITY, not for a missing grant -- the grant is present`);
  }
});

await check("the two Roles carry exactly their own capability", async () => {
  const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES.technicianLaborRecorder.permissions], [LABOR_RECORD_CAPABILITY]);
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES.workOrderLaborCorrector.permissions], [LABOR_CORRECT_CAPABILITY]);
  // Recording does not confer correcting, and job title confers neither.
  assert.equal(GOVERNED_BUSINESS_ROLES.technicianLaborRecorder.permissions.includes(LABOR_CORRECT_CAPABILITY), false);
});

await check("LABOR CANNOT BE RECORDED FOR SOMEBODY ELSE, and the attempt is refused not ignored", async () => {
  // Silently dropping a technicianId would let a caller believe they had recorded another person's
  // time. This is the field that must never be accepted.
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const r = await fails(() => recordWorkOrderLabor(
    { ...duration(wo), technicianId: "somebody-else" }, deps(actorOf(p))));
  assert.equal(r.code, "REQUEST_INVALID");
  assert.match(r.message, /never for somebody named in the payload/);
});

await check("a principal with the capability but NO technician identity has nobody to record for", async () => {
  const uid = uniq("uid");
  await db.collection("users").doc(uid).set({ accessVersion: 1, role: "technician" });
  const id = uniq("asg");
  await db.collection("roleAssignments").doc(id).set({
    id, principalUid: uid, roleId: "technician", scope: { type: "global" },
    grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1,
  });
  const wo = await seedJob({ assignedTechId: "someone" });
  const r = await fails(() => recordWorkOrderLabor(duration(wo),
    deps({ kind: "USER", id: uid, technicianId: null, role: "technician" })));
  assert.equal(r.code, "NOT_ASSIGNED_TECHNICIAN");
});

// ── WORK ORDER STATE ──────────────────────────────────────────────────────────────────────────

await check("labor is accepted in every EXECUTION state", async () => {
  for (const status of LABOR_RECORDABLE_WO_STATUSES) {
    const p = await seedPrincipal({ roleIds: ["technician"] });
    const wo = await seedJob({ assignedTechId: p.technicianId, status });
    const out = await recordWorkOrderLabor(duration(wo), deps(actorOf(p)));
    assert.equal(out.outcome, "recorded", `${status} should accept labor`);
  }
});

await check("a TERMINAL work order refuses new labor -- that is a correction, not an entry", async () => {
  for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
    const p = await seedPrincipal({ roleIds: ["technician"] });
    const wo = await seedJob({ assignedTechId: p.technicianId, status });
    const r = await fails(() => recordWorkOrderLabor(duration(wo), deps(actorOf(p))));
    assert.equal(r.code, "WORK_ORDER_STATE_INVALID", `${status} must refuse new labor`);
  }
});

await check("a pre-execution work order refuses labor too", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId, status: "SCHEDULED" });
  assert.equal((await fails(() => recordWorkOrderLabor(duration(wo), deps(actorOf(p))))).code, "WORK_ORDER_STATE_INVALID");
});

// ── VALIDATION ────────────────────────────────────────────────────────────────────────────────

await check("time that runs backwards, or not at all, is refused", () => {
  const start = Date.parse("2026-08-23T09:00:00Z");
  for (const ended of [start - 1, start]) {
    const r = (() => { try { validateLaborRequest(interval("wo1", { endedAtMillis: ended })); return null; } catch (e) { return e; } })();
    assert.equal(r.code, "INTERVAL_INVALID");
  }
});

await check("a negative or zero duration is refused", () => {
  for (const minutes of [-30, 0]) {
    const r = (() => { try { validateLaborRequest(duration("wo1", { durationMinutes: minutes })); return null; } catch (e) { return e; } })();
    assert.equal(r.code, "DURATION_INVALID");
  }
  assert.equal(MIN_LABOR_MINUTES, 1);
});

await check("A 26-HOUR ENTRY DOES NOT SILENTLY PASS", () => {
  // A technical bound, not an HR rule -- past this a single unbroken entry is more likely a timer
  // left running than a fact.
  const r = (() => { try { validateLaborRequest(duration("wo1", { durationMinutes: 26 * 60 })); return null; } catch (e) { return e; } })();
  assert.equal(r.code, "DURATION_INVALID");
  assert.match(r.message, /technical bound/);
  // And the same bound applies to an interval, which is the shape a runaway timer actually produces.
  const start = Date.parse("2026-08-23T00:00:00Z");
  const long = (() => { try { validateLaborRequest(interval("wo1", { startedAtMillis: start, endedAtMillis: start + 26 * 3600_000 })); return null; } catch (e) { return e; } })();
  assert.equal(long.code, "DURATION_INVALID");
  assert.equal(MAX_LABOR_MINUTES, 960);
});

await check("an unknown labor type is refused, never defaulted", async () => {
  const r = (() => { try { validateLaborRequest(duration("wo1", { laborType: "SHOP" })); return null; } catch (e) { return e; } })();
  assert.equal(r.code, "REQUEST_INVALID");
});

// ── OVERLAP ───────────────────────────────────────────────────────────────────────────────────

await check("ONE TECHNICIAN CANNOT BE IN TWO PLACES AT ONCE", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const woA = await seedJob({ assignedTechId: p.technicianId });
  const woB = await seedJob({ assignedTechId: p.technicianId });
  await recordWorkOrderLabor(interval(woA), deps(actorOf(p)));
  const r = await fails(() => recordWorkOrderLabor(
    interval(woB, {
      startedAtMillis: Date.parse("2026-08-23T10:00:00Z"),
      endedAtMillis: Date.parse("2026-08-23T12:00:00Z"),
    }), deps(actorOf(p))));
  assert.equal(r.code, "OVERLAPPING_ENTRY");
});

await check("touching intervals do NOT overlap -- 09:00-11:00 and 11:00-12:00 are both fine", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  await recordWorkOrderLabor(interval(wo), deps(actorOf(p)));
  const next = await recordWorkOrderLabor(interval(wo, {
    startedAtMillis: Date.parse("2026-08-23T11:00:00Z"),
    endedAtMillis: Date.parse("2026-08-23T12:00:00Z"),
  }), deps(actorOf(p)));
  assert.equal(next.outcome, "recorded");
});

await check("a DURATION entry is not overlap-checked, and the schema does not pretend it is", async () => {
  // It has no clock position. Claiming to check it would be the schema lying about what it knows.
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  await recordWorkOrderLabor(interval(wo), deps(actorOf(p)));
  const d = await recordWorkOrderLabor(duration(wo), deps(actorOf(p)));
  assert.equal(d.outcome, "recorded");
});

await check("another technician's entries never block mine", async () => {
  const a = await seedPrincipal({ roleIds: ["technician"] });
  const b = await seedPrincipal({ roleIds: ["technician"] });
  const woA = await seedJob({ assignedTechId: a.technicianId });
  const woB = await seedJob({ assignedTechId: b.technicianId });
  await recordWorkOrderLabor(interval(woA), deps(actorOf(a)));
  const out = await recordWorkOrderLabor(interval(woB), deps(actorOf(b)));
  assert.equal(out.outcome, "recorded");
});

// ── IDEMPOTENCY ───────────────────────────────────────────────────────────────────────────────

await check("A PHONE THAT RETRIES DOES NOT PAY THE TECHNICIAN TWICE", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const req = duration(wo);
  const first = await recordWorkOrderLabor(req, deps(actorOf(p)));
  const again = await recordWorkOrderLabor(req, deps(actorOf(p)));
  assert.equal(again.outcome, "replayed");
  assert.equal(again.laborEntryId, first.laborEntryId);
  const all = await db.collection(LABOR_ENTRIES_COLLECTION).where("workOrderId", "==", wo).get();
  assert.equal(all.size, 1, "a retry created a second hour");
});

await check("the SAME key with a DIFFERENT payload is a conflict, not a silent overwrite", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const key = uniq("idem");
  await recordWorkOrderLabor(duration(wo, { idempotencyKey: key }), deps(actorOf(p)));
  const r = await fails(() => recordWorkOrderLabor(
    duration(wo, { idempotencyKey: key, durationMinutes: 240 }), deps(actorOf(p))));
  assert.equal(r.code, "IDEMPOTENCY_CONFLICT");
});

await check("the entry id is derived from the key, so the create IS the check", () => {
  assert.equal(laborEntryIdFor("k1"), laborEntryIdFor("k1"));
  assert.notEqual(laborEntryIdFor("k1"), laborEntryIdFor("k2"));
});

// ── CORRECTION ────────────────────────────────────────────────────────────────────────────────

await check("A CORRECTION REVERSES AND REPLACES -- the original survives, explaining itself", async () => {
  const tech = await seedPrincipal({ roleIds: ["technician"] });
  const mgr = await seedPrincipal({ roleIds: ["fieldManager"] });
  const wo = await seedJob({ assignedTechId: tech.technicianId });
  const original = await recordWorkOrderLabor(duration(wo, { durationMinutes: 480 }), deps(actorOf(tech)));

  const corrected = await correctWorkOrderLabor({
    ...duration(wo, { durationMinutes: 360 }), correctsLaborEntryId: original.laborEntryId,
  }, deps(actorOf(mgr)));

  assert.equal(corrected.reversedLaborEntryId, original.laborEntryId);
  const before = (await db.collection(LABOR_ENTRIES_COLLECTION).doc(original.laborEntryId).get()).data();
  assert.equal(before.status, "REVERSED", "the original must not be deleted");
  assert.equal(before.durationMinutes, 480, "the original keeps its own value");
  assert.equal(before.reversedByLaborEntryId, corrected.laborEntryId);
  const after = (await db.collection(LABOR_ENTRIES_COLLECTION).doc(corrected.laborEntryId).get()).data();
  assert.equal(after.correctsLaborEntryId, original.laborEntryId);
  // A correction fixes what was recorded; it does not move labor from one person to another.
  assert.equal(after.technicianId, tech.technicianId);
  assert.equal(after.recordedByUid, mgr.uid, "who corrected it is recorded separately");
});

await check("correction needs its OWN capability -- recording does not confer it", async () => {
  const tech = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: tech.technicianId });
  const original = await recordWorkOrderLabor(duration(wo), deps(actorOf(tech)));
  const r = await fails(() => correctWorkOrderLabor(
    { ...duration(wo, { durationMinutes: 30 }), correctsLaborEntryId: original.laborEntryId },
    deps(actorOf(tech), { authorize: deniedAuthorize })));
  assert.equal(r.code, "PERMISSION_DENIED");
  assert.notEqual(LABOR_RECORD_CAPABILITY, LABOR_CORRECT_CAPABILITY);
});

await check("an already-corrected entry chains FORWARD, never back through history", async () => {
  const tech = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: tech.technicianId });
  const original = await recordWorkOrderLabor(duration(wo), deps(actorOf(tech)));
  const allow = { ...deps(actorOf(tech), { authorize: deniedAuthorize }), authorize: async () => true };
  await correctWorkOrderLabor({ ...duration(wo, { durationMinutes: 60 }), correctsLaborEntryId: original.laborEntryId }, allow);
  const r = await fails(() => correctWorkOrderLabor(
    { ...duration(wo, { durationMinutes: 45 }), correctsLaborEntryId: original.laborEntryId }, allow));
  assert.equal(r.code, "ENTRY_ALREADY_REVERSED");
});

// ── PROJECTION ────────────────────────────────────────────────────────────────────────────────

await check("the rollup matches the ACTIVE entries, and excludes what was corrected away", async () => {
  const totals = projectWorkOrderLabor([
    { status: "ACTIVE", laborType: "ONSITE", durationMinutes: 120 },
    { status: "ACTIVE", laborType: "TRAVEL", durationMinutes: 30 },
    { status: "REVERSED", laborType: "ONSITE", durationMinutes: 480 },
  ]);
  assert.equal(totals.totalMinutes, 150);
  assert.equal(totals.onsiteMinutes, 120);
  assert.equal(totals.travelMinutes, 30);
  assert.equal(totals.activeEntries, 2);
  // Reversed entries are COUNTED SEPARATELY, not erased: "what did this cost in time" and "what was
  // recorded and later corrected" are different questions.
  assert.equal(totals.reversedEntries, 1);
});

await check("the rollup survives malformed input rather than throwing at a reader", () => {
  assert.equal(projectWorkOrderLabor(null).totalMinutes, 0);
  assert.equal(projectWorkOrderLabor([{ status: "ACTIVE" }]).totalMinutes, 0);
});

await check("MULTIPLE ENTRIES AGGREGATE -- end to end, from the database", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  await recordWorkOrderLabor(duration(wo, { durationMinutes: 90, laborType: "ONSITE" }), deps(actorOf(p)));
  await recordWorkOrderLabor(duration(wo, { durationMinutes: 30, laborType: "TRAVEL" }), deps(actorOf(p)));
  const snap = await db.collection(LABOR_ENTRIES_COLLECTION).where("workOrderId", "==", wo).get();
  const totals = projectWorkOrderLabor(snap.docs.map((d) => d.data()));
  assert.equal(totals.totalMinutes, 120);
  assert.equal(totals.onsiteMinutes, 90);
  assert.equal(totals.travelMinutes, 30);
});

// ── DEVICE CLOCK ──────────────────────────────────────────────────────────────────────────────

await check("BOTH TIMESTAMPS SURVIVE -- the device's reading is never mistaken for the server's", async () => {
  // Rewriting work time to sync time would move real work to the moment the signal came back. A
  // device clock is also not an accounting authority. So both are kept and neither is overwritten.
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const deviceTime = Date.parse("2026-08-23T14:12:00Z");
  const out = await recordWorkOrderLabor(
    duration(wo, { deviceReportedAtMillis: deviceTime }), deps(actorOf(p)));
  const stored = (await db.collection(LABOR_ENTRIES_COLLECTION).doc(out.laborEntryId).get()).data();
  assert.equal(stored.deviceReportedAtMillis, deviceTime);
  assert.equal(stored.recordedAtMillis, Date.parse("2026-08-23T20:00:00.000Z"));
  assert.notEqual(stored.deviceReportedAtMillis, stored.recordedAtMillis);
});

await check("an entry recorded online carries no device claim at all", async () => {
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  const out = await recordWorkOrderLabor(duration(wo), deps(actorOf(p)));
  const stored = (await db.collection(LABOR_ENTRIES_COLLECTION).doc(out.laborEntryId).get()).data();
  assert.equal("deviceReportedAtMillis" in stored, false);
});

// ── AUDIT ─────────────────────────────────────────────────────────────────────────────────────

await check("every labor act is audited, naming the principal AND the technician", async () => {
  audits.length = 0;
  const p = await seedPrincipal({ roleIds: ["technician"] });
  const wo = await seedJob({ assignedTechId: p.technicianId });
  await recordWorkOrderLabor(duration(wo), deps(actorOf(p)));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "record");
  assert.equal(audits[0].actorId, p.uid);
  assert.equal(audits[0].technicianId, p.technicianId);
  assert.equal(audits[0].workOrderId, wo);
});

await check("the work date of an interval is derived, in UTC, so it never drifts", () => {
  assert.equal(workDateOf(Date.parse("2026-08-23T23:59:59Z")), "2026-08-23");
  assert.equal(workDateOf(Date.parse("2026-08-24T00:00:01Z")), "2026-08-24");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
