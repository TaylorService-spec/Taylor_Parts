// F-RULES-1 PR-A -- focused tests for the trusted technician job completion
// callable (functions/src/completeAssignedJob.ts; Decision #39).
//
// Same pattern as functions/test/workOrderEngineFunctions.test.js: the
// compiled onCall handler is invoked directly via `.run(request)` with a
// fabricated `request.auth` (no HTTP layer, no Auth emulator), against a
// live Firestore emulator. Imported from its own compiled module, never via
// lib/index.js (which calls initializeApp() itself and would collide with
// this file's own admin.initializeApp()).
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node --test test/completeAssignedJob.test.js
//
// Never touches the live "taylor-parts" project.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { completeAssignedJob } = require("../lib/completeAssignedJob.js");

const USERS = "users";
const JOBS = "fieldops_jobs";
const TECHS = "fieldops_technicians";
const AUDIT = "auditEvents";

let counter = 0;
function id(label) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}
function key(label) {
  // >= 8 chars of [A-Za-z0-9_-], unique per test.
  return `${label}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 10)}`.replace(/[^A-Za-z0-9_-]/g, "x");
}

function callRequest(data, authUid) {
  return { data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined };
}

async function assertHttpsErrorCode(promise, expectedCode) {
  try {
    await promise;
    assert.fail(`expected an HttpsError with code "${expectedCode}", but no error was thrown`);
  } catch (err) {
    assert.equal(err.code, expectedCode, `expected code "${expectedCode}", got "${err.code}": ${err.message}`);
  }
}

async function seedUser(uid, role, technicianId) {
  const doc = {};
  if (role !== undefined) doc.role = role;
  if (technicianId !== undefined) doc.technicianId = technicianId;
  await db.collection(USERS).doc(uid).set(doc);
}
async function seedTech(techId, status = "on_job") {
  await db.collection(TECHS).doc(techId).set({ name: `Tech ${techId}`, phone: "555", status });
}
async function seedJob(jobId, { status, technicianId }) {
  await db.collection(JOBS).doc(jobId).set({
    customer: { name: "Acme" },
    description: "fix the freezer",
    status,
    technicianId: technicianId ?? null,
    workOrderId: null,
    address: null,
  });
}

// Standard eligible fixture: technician user u mapped to tech T, job in_progress assigned to T.
async function seedEligible() {
  const uid = id("u-tech");
  const techId = id("T");
  const jobId = id("job");
  await seedUser(uid, "technician", techId);
  await seedTech(techId, "on_job");
  await seedJob(jobId, { status: "in_progress", technicianId: techId });
  return { uid, techId, jobId };
}

// ---- 1. authentication ----------------------------------------------------

test("unauthenticated caller is rejected", async () => {
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: "j", idempotencyKey: key("k") }, undefined)),
    "unauthenticated",
  );
});

// ---- 2/3. technician-only + ineligible callers -----------------------------

test("admin caller is rejected (no admin override through this endpoint)", async () => {
  const uid = id("u-admin");
  await seedUser(uid, "admin");
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: id("job"), idempotencyKey: key("k") }, uid)),
    "permission-denied",
  );
});

test("dispatcher caller is rejected", async () => {
  const uid = id("u-disp");
  await seedUser(uid, "dispatcher");
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: id("job"), idempotencyKey: key("k") }, uid)),
    "permission-denied",
  );
});

test("caller with no users doc (no resolvable role) is rejected", async () => {
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: id("job"), idempotencyKey: key("k") }, id("u-ghost"))),
    "permission-denied",
  );
});

test("technician-role caller with no technicianId mapping fails closed", async () => {
  const uid = id("u-unmapped");
  await seedUser(uid, "technician");
  const k = key("k-unmapped");
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: id("job"), idempotencyKey: k }, uid)),
    "failed-precondition",
  );
  // The substantive denial left exactly one denied Audit Event at the key.
  const audit = await db.collection(AUDIT).doc(k).get();
  assert.equal(audit.exists, true);
  assert.equal(audit.data().outcome, "denied");
  assert.equal(audit.data().action, "completeAssignedJob");
});

// ---- 4/5/6/14. input contract ---------------------------------------------

test("missing jobId is rejected", async () => {
  const { uid } = await seedEligible();
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ idempotencyKey: key("k") }, uid)),
    "invalid-argument",
  );
});

test("missing idempotencyKey is rejected", async () => {
  const { uid, jobId } = await seedEligible();
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId }, uid)),
    "invalid-argument",
  );
});

test("non-object request data is rejected", async () => {
  const { uid } = await seedEligible();
  await assertHttpsErrorCode(completeAssignedJob.run(callRequest("nope", uid)), "invalid-argument");
  await assertHttpsErrorCode(completeAssignedJob.run(callRequest(null, uid)), "invalid-argument");
});

test("malformed idempotencyKey is rejected (too short / bad charset)", async () => {
  const { uid, jobId } = await seedEligible();
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: "short" }, uid)),
    "invalid-argument",
  );
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: "bad key with spaces!" }, uid)),
    "invalid-argument",
  );
});

test("request-supplied identity/authority fields are rejected, not ignored", async () => {
  const { uid, jobId, techId } = await seedEligible();
  for (const extra of [
    { technicianId: techId },
    { callerUserId: uid },
    { role: "admin" },
    { assignedTechnicianId: techId },
    { targetState: "complete" },
  ]) {
    await assertHttpsErrorCode(
      completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k"), ...extra }, uid)),
      "invalid-argument",
    );
  }
  // Nothing mutated by any rejected request.
  const job = await db.collection(JOBS).doc(jobId).get();
  assert.equal(job.data().status, "in_progress");
});

// ---- 7. job not found ------------------------------------------------------

test("job not found", async () => {
  const { uid } = await seedEligible();
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: id("job-missing"), idempotencyKey: key("k") }, uid)),
    "not-found",
  );
});

// ---- 8. ownership ----------------------------------------------------------

test("caller who is not the assigned technician is denied and nothing changes", async () => {
  const { uid } = await seedEligible(); // caller mapped to their own T
  const otherTech = id("T-other");
  const otherJob = id("job-other");
  await seedTech(otherTech, "on_job");
  await seedJob(otherJob, { status: "in_progress", technicianId: otherTech });
  const k = key("k-notmine");
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: otherJob, idempotencyKey: k }, uid)),
    "permission-denied",
  );
  const job = await db.collection(JOBS).doc(otherJob).get();
  assert.equal(job.data().status, "in_progress");
  const tech = await db.collection(TECHS).doc(otherTech).get();
  assert.equal(tech.data().status, "on_job");
  // denied Audit Event recorded at the key
  const audit = await db.collection(AUDIT).doc(k).get();
  assert.equal(audit.data().outcome, "denied");
});

// ---- 9/10. lifecycle -------------------------------------------------------

test("open job cannot be completed", async () => {
  const uid = id("u-tech");
  const techId = id("T");
  const jobId = id("job-open");
  await seedUser(uid, "technician", techId);
  await seedTech(techId, "available");
  await seedJob(jobId, { status: "open", technicianId: null });
  // open job is unassigned -> ownership denies first (fail closed, no state leak beyond assignment)
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k") }, uid)),
    "permission-denied",
  );
});

test("assigned job cannot be completed directly -- in_progress is required (O-3)", async () => {
  const uid = id("u-tech");
  const techId = id("T");
  const jobId = id("job-assigned");
  await seedUser(uid, "technician", techId);
  await seedTech(techId, "on_job");
  await seedJob(jobId, { status: "assigned", technicianId: techId });
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k") }, uid)),
    "failed-precondition",
  );
  const job = await db.collection(JOBS).doc(jobId).get();
  assert.equal(job.data().status, "assigned");
});

// ---- 11/12/15/22. happy path, fields, audit, response contract -------------

test("assigned technician completes own in_progress job: cascade + atomic audit + narrow response", async () => {
  const { uid, techId, jobId } = await seedEligible();
  const k = key("k-happy");
  const result = await completeAssignedJob.run(callRequest({ jobId, idempotencyKey: k }, uid));

  // 22: response contains ONLY the approved fields
  assert.deepEqual(Object.keys(result).sort(), ["idempotentReplay", "jobId", "status"]);
  assert.deepEqual(result, { jobId, status: "complete", idempotentReplay: false });

  // 12: authoritative fields updated, and ONLY status changed on each doc
  const job = (await db.collection(JOBS).doc(jobId).get()).data();
  assert.equal(job.status, "complete");
  assert.equal(job.technicianId, techId); // assignment untouched
  assert.equal(job.description, "fix the freezer"); // other fields untouched
  const tech = (await db.collection(TECHS).doc(techId).get()).data();
  assert.equal(tech.status, "available");
  assert.equal(tech.name, `Tech ${techId}`);

  // 15: audit event at the idempotencyKey with trusted actor + transition
  const audit = (await db.collection(AUDIT).doc(k).get()).data();
  assert.equal(audit.action, "completeAssignedJob");
  assert.equal(audit.actorUid, uid); // server-derived, not caller-supplied
  assert.equal(audit.targetType, "fieldops_job");
  assert.equal(audit.targetId, jobId);
  assert.equal(audit.outcome, "applied");
  assert.deepEqual(audit.scope, { type: "ownAssignment", value: techId });
  assert.ok(audit.at); // server timestamp
  assert.match(audit.summary, /in_progress -> complete/);
});

// ---- 16. exact idempotent replay ------------------------------------------

test("exact replay performs no second mutation and reports idempotentReplay", async () => {
  const { uid, techId, jobId } = await seedEligible();
  const k = key("k-replay");
  const first = await completeAssignedJob.run(callRequest({ jobId, idempotencyKey: k }, uid));
  assert.equal(first.idempotentReplay, false);

  // Perturb the technician doc; a true replay must NOT rewrite it.
  await db.collection(TECHS).doc(techId).update({ status: "on_job" });

  const replay = await completeAssignedJob.run(callRequest({ jobId, idempotencyKey: k }, uid));
  assert.deepEqual(replay, { jobId, status: "complete", idempotentReplay: true });

  const tech = (await db.collection(TECHS).doc(techId).get()).data();
  assert.equal(tech.status, "on_job", "replay must not re-run the cascade");
  const job = (await db.collection(JOBS).doc(jobId).get()).data();
  assert.equal(job.status, "complete");
});

// ---- 17. key reuse for a different request ---------------------------------

test("same idempotencyKey with a different job is rejected with no mutation", async () => {
  const { uid, jobId } = await seedEligible();
  const k = key("k-reuse");
  await completeAssignedJob.run(callRequest({ jobId, idempotencyKey: k }, uid));

  const second = await seedEligible(); // same-caller? new caller+job; reuse the same KEY
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: second.jobId, idempotencyKey: k }, second.uid)),
    "already-exists",
  );
  const job2 = (await db.collection(JOBS).doc(second.jobId).get()).data();
  assert.equal(job2.status, "in_progress", "conflicting key reuse must not mutate");
});

test("a key burned by a denied attempt cannot be replayed into success", async () => {
  const { uid, jobId } = await seedEligible();
  const other = await seedEligible();
  const k = key("k-denied");
  // Denied attempt (not the assigned technician) records outcome=denied at k.
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId: other.jobId, idempotencyKey: k }, uid)),
    "permission-denied",
  );
  // Retrying the SAME key -- even for the caller's own valid job -- fails
  // loud (immutable Audit Event; mint a fresh key), and mutates nothing.
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: k }, uid)),
    "already-exists",
  );
  assert.equal((await db.collection(JOBS).doc(jobId).get()).data().status, "in_progress");
});

// ---- 18. completed through another operation -------------------------------

test("job already completed by another operation is a precondition failure, not this request's success", async () => {
  const { uid, jobId } = await seedEligible();
  // Simulate an unrelated authorized completion (e.g. a dispatcher correction).
  await db.collection(JOBS).doc(jobId).update({ status: "complete" });
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k-fresh") }, uid)),
    "failed-precondition",
  );
});

// ---- 19. concurrency -------------------------------------------------------

test("concurrent completion attempts result in exactly one authoritative completion", async () => {
  const { uid, techId, jobId } = await seedEligible();
  const results = await Promise.allSettled([
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k-c1") }, uid)),
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k-c2") }, uid)),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one attempt must win");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "failed-precondition");
  const job = (await db.collection(JOBS).doc(jobId).get()).data();
  assert.equal(job.status, "complete");
  const tech = (await db.collection(TECHS).doc(techId).get()).data();
  assert.equal(tech.status, "available");
  // exactly one APPLIED audit event exists across both keys
  const applied = await db.collection(AUDIT).where("targetId", "==", jobId).where("outcome", "==", "applied").get();
  assert.equal(applied.size, 1);
});

// ---- 20. no partial writes on failure --------------------------------------

test("transaction failure (missing mapped technician doc) leaves the job unchanged", async () => {
  const uid = id("u-tech");
  const techId = id("T-missing-doc");
  const jobId = id("job");
  await seedUser(uid, "technician", techId);
  // NOTE: no fieldops_technicians/{techId} doc -- inconsistent mapping.
  await seedJob(jobId, { status: "in_progress", technicianId: techId });
  await assertHttpsErrorCode(
    completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k") }, uid)),
    "failed-precondition",
  );
  const job = (await db.collection(JOBS).doc(jobId).get()).data();
  assert.equal(job.status, "in_progress", "no partial completion may persist");
});

// ---- 21. no unauthorized inventory mutation --------------------------------

test("the callable touches no inventory/ledger collection", async () => {
  const { uid, jobId } = await seedEligible();
  await completeAssignedJob.run(callRequest({ jobId, idempotencyKey: key("k-inv") }, uid));
  for (const coll of ["inventory_transactions", "inventory_sync_status", "fieldops_wos"]) {
    const snap = await db.collection(coll).limit(1).get();
    assert.equal(snap.size, 0, `collection ${coll} must remain untouched`);
  }
});

// ---- 23. export ------------------------------------------------------------

test("completeAssignedJob is exported from the Functions entry point", () => {
  // lib/index.js calls initializeApp() at import time, so assert on the
  // compiled source text instead of importing it (same reason
  // workOrderEngineFunctions.test.js never imports lib/index.js).
  const compiled = fs.readFileSync(path.join(__dirname, "..", "lib", "index.js"), "utf8");
  assert.match(compiled, /completeAssignedJob/);
});
