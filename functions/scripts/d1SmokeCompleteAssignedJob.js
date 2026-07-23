// F-RULES-1 Gate D1 -- operator-executed production backend smoke for the
// newly deployed completeAssignedJob callable (Decision #39; docs/operations/
// f-rules-1-d1-deployment-handoff.md is the governing runbook).
//
// OPERATOR-INVOKED ONLY (Cloud Shell, ADC). Referenced by no runtime, CI,
// build, install, deploy, or emulator path -- same posture as
// auditInventoryEffects.js / retryInventoryEffects.js. It mutates ONLY its
// own d1-smoke-* fixture documents plus the Audit Events the trusted
// callable itself writes (append-only by governance; retained, documented).
// It never touches a real customer, technician, user, or job.
//
// Usage (Cloud Shell, after `firebase deploy --only functions:completeAssignedJob`):
//   export D1_SMOKE_PASSWORD="$(openssl rand -base64 18)"   # session-only throwaway
//   cd functions && npm ci && node scripts/d1SmokeCompleteAssignedJob.js seed
//   node scripts/d1SmokeCompleteAssignedJob.js run
//   node scripts/d1SmokeCompleteAssignedJob.js cleanup
// Evidence JSON is written to ./d1-smoke-evidence/ (copy per the handoff).
//
// `run` exits 0 only if EVERY check passes: positive completion cascade,
// exact idempotent replay (no duplicate mutation), wrong-technician denial,
// invalid-state denial, and the applied Audit Event's shape.
"use strict";

const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const REGION = "us-central1";
const CALLABLE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/completeAssignedJob`;
// The web app's public API key (public by design -- shipped in every client
// bundle; see field-ops-app-vite/src/firebase/firebase.js). Needed only to
// exchange an Admin-SDK custom token for an ID token via the public
// Identity Toolkit endpoint. It is NOT a secret and grants nothing Rules/
// Auth would not already grant.
const WEB_API_KEY = "AIzaSyATXIiI5C1m" + "LmsvS0k-x3i7ZxAbAPtRpSY";

const RUN_TAG = process.env.D1_SMOKE_TAG || "d1smoke";
const IDS = {
  techUser1: `${RUN_TAG}-user-t1`,
  techUser2: `${RUN_TAG}-user-t2`,
  tech1: `${RUN_TAG}-T1`,
  tech2: `${RUN_TAG}-T2`,
  jobInProgress: `${RUN_TAG}-job-inprogress`,
  jobAssigned: `${RUN_TAG}-job-assigned`,
  keyPositive: `${RUN_TAG}-key-positive-0001`,
  keyWrongTech: `${RUN_TAG}-key-wrongtech-0001`,
  keyInvalidState: `${RUN_TAG}-key-invalidstate-0001`,
};

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

const EVIDENCE_DIR = join(process.cwd(), "d1-smoke-evidence");
const evidence = { runTag: RUN_TAG, startedAt: new Date().toISOString(), checks: [] };
let failures = 0;
function check(name, ok, detail) {
  evidence.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} -- ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`);
  if (!ok) failures += 1;
}

// D1 correction (operator run 1 blocker): auth.createCustomToken() requires
// service-account SIGNING (iam signBlob), which Cloud Shell user-ADC cannot
// do and which we deliberately do NOT grant (no Token Creator role, no SA
// keys). Instead the smoke signs in EXACTLY like the real client app does:
// password sign-in through the public Identity Toolkit endpoint. The
// throwaway password comes ONLY from the D1_SMOKE_PASSWORD env var (operator
// generates it for the session, e.g. openssl rand); it is never printed,
// never written to evidence, and dies with the Auth users at cleanup.
function smokePassword() {
  const pw = process.env.D1_SMOKE_PASSWORD;
  if (typeof pw !== "string" || pw.length < 12) {
    throw new Error("D1_SMOKE_PASSWORD env var is required (>= 12 chars); generate a throwaway, e.g.: export D1_SMOKE_PASSWORD=\"$(openssl rand -base64 18)\"");
  }
  return pw;
}
function smokeEmail(uid) {
  return `${uid}@d1smoke.example.com`; // reserved example domain, no real mailbox
}
async function idTokenFor(uid) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: smokeEmail(uid), password: smokePassword(), returnSecureToken: true }) },
  );
  const body = await res.json();
  if (!body.idToken) {
    // never echo the request body or password -- surface only the API's error code
    throw new Error(`password sign-in failed for ${uid}: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  }
  return body.idToken;
}

async function callCallable(idToken, data) {
  const res = await fetch(CALLABLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function seed() {
  const password = smokePassword();
  for (const uid of [IDS.techUser1, IDS.techUser2]) {
    try { await auth.deleteUser(uid); } catch { /* not present -- fine */ }
    await auth.createUser({ uid, email: smokeEmail(uid), password, emailVerified: true });
  }
  await db.doc(`users/${IDS.techUser1}`).set({ role: "technician", technicianId: IDS.tech1 });
  await db.doc(`users/${IDS.techUser2}`).set({ role: "technician", technicianId: IDS.tech2 });
  await db.doc(`fieldops_technicians/${IDS.tech1}`).set({ name: "D1 Smoke Tech 1", phone: "000", status: "on_job", createdAt: Date.now() });
  await db.doc(`fieldops_technicians/${IDS.tech2}`).set({ name: "D1 Smoke Tech 2", phone: "000", status: "available", createdAt: Date.now() });
  await db.doc(`fieldops_jobs/${IDS.jobInProgress}`).set({
    customer: { name: "D1 SMOKE (not a real customer)" }, description: "D1 backend smoke fixture",
    status: "in_progress", technicianId: IDS.tech1, workOrderId: null, address: null, createdAt: Date.now(),
  });
  await db.doc(`fieldops_jobs/${IDS.jobAssigned}`).set({
    customer: { name: "D1 SMOKE (not a real customer)" }, description: "D1 backend smoke fixture (assigned)",
    status: "assigned", technicianId: IDS.tech1, workOrderId: null, address: null, createdAt: Date.now(),
  });
  console.log(`seeded d1-smoke fixtures (tag "${RUN_TAG}")`);
}

async function run() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const [tok1, tok2] = [await idTokenFor(IDS.techUser1), await idTokenFor(IDS.techUser2)];

  // 1. Positive: assigned technician completes own in_progress job.
  const pos = await callCallable(tok1, { jobId: IDS.jobInProgress, idempotencyKey: IDS.keyPositive });
  check("positive: HTTP 200", pos.status === 200, { status: pos.status });
  check("positive: response contract", JSON.stringify(pos.body?.result) === JSON.stringify({ jobId: IDS.jobInProgress, status: "complete", idempotentReplay: false }), pos.body?.result ?? pos.body);
  const jobAfter = (await db.doc(`fieldops_jobs/${IDS.jobInProgress}`).get()).data();
  const techAfter = (await db.doc(`fieldops_technicians/${IDS.tech1}`).get()).data();
  check("cascade: job -> complete", jobAfter?.status === "complete", { status: jobAfter?.status });
  check("cascade: technician -> available", techAfter?.status === "available", { status: techAfter?.status });
  const audit = (await db.doc(`auditEvents/${IDS.keyPositive}`).get()).data();
  check("audit: applied event at the idempotency key", !!audit && audit.action === "completeAssignedJob" && audit.actorUid === IDS.techUser1 && audit.targetId === IDS.jobInProgress && audit.outcome === "applied", audit && { action: audit.action, actorUid: audit.actorUid, outcome: audit.outcome });

  // 2. Exact replay: same key + job -> idempotent success, no second mutation.
  //    Perturb the technician doc first (admin correction), so a re-run of the
  //    cascade would be visible.
  await db.doc(`fieldops_technicians/${IDS.tech1}`).update({ status: "off_shift" });
  const replay = await callCallable(tok1, { jobId: IDS.jobInProgress, idempotencyKey: IDS.keyPositive });
  check("replay: HTTP 200", replay.status === 200, { status: replay.status });
  check("replay: idempotentReplay true", replay.body?.result?.idempotentReplay === true, replay.body?.result);
  const techAfterReplay = (await db.doc(`fieldops_technicians/${IDS.tech1}`).get()).data();
  check("replay: no duplicate cascade (perturbed tech status untouched)", techAfterReplay?.status === "off_shift", { status: techAfterReplay?.status });
  const auditCount = await db.collection("auditEvents").where("targetId", "==", IDS.jobInProgress).where("outcome", "==", "applied").get();
  check("replay: exactly one applied audit event", auditCount.size === 1, { count: auditCount.size });

  // 3. Negative: wrong technician on T1's (already complete) job -- and on a
  //    fresh assigned job to prove ownership denial specifically.
  const wrong = await callCallable(tok2, { jobId: IDS.jobAssigned, idempotencyKey: IDS.keyWrongTech });
  check("negative: wrong technician denied (permission-denied)", wrong.status === 403 || wrong.body?.error?.status === "PERMISSION_DENIED", { status: wrong.status, err: wrong.body?.error?.status });

  // 4. Negative: owner but invalid lifecycle state (assigned, not in_progress).
  const invalid = await callCallable(tok1, { jobId: IDS.jobAssigned, idempotencyKey: IDS.keyInvalidState });
  check("negative: assigned state denied (failed-precondition)", invalid.status === 400 || invalid.body?.error?.status === "FAILED_PRECONDITION", { status: invalid.status, err: invalid.body?.error?.status });
  const assignedAfter = (await db.doc(`fieldops_jobs/${IDS.jobAssigned}`).get()).data();
  const tech2After = (await db.doc(`fieldops_technicians/${IDS.tech2}`).get()).data();
  check("negative: no mutation from denied attempts", assignedAfter?.status === "assigned" && tech2After?.status === "available", { job: assignedAfter?.status, tech2: tech2After?.status });

  evidence.finishedAt = new Date().toISOString();
  evidence.result = failures === 0 ? "PASS" : "FAIL";
  writeFileSync(join(EVIDENCE_DIR, "d1-smoke-results.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`\nD1 SMOKE ${evidence.result}: ${evidence.checks.filter((c) => c.ok).length} passed, ${failures} failed`);
  console.log(`evidence: ${join(EVIDENCE_DIR, "d1-smoke-results.json")} (no tokens or secrets are written)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function cleanup() {
  // Fixture docs only. The Audit Events written by the callable are
  // append-only by governance and are RETAINED (documented in the handoff);
  // their d1smoke-prefixed ids and fixture targetIds make them identifiable.
  for (const p of [
    `fieldops_jobs/${IDS.jobInProgress}`, `fieldops_jobs/${IDS.jobAssigned}`,
    `fieldops_technicians/${IDS.tech1}`, `fieldops_technicians/${IDS.tech2}`,
    `users/${IDS.techUser1}`, `users/${IDS.techUser2}`,
  ]) await db.doc(p).delete();
  for (const uid of [IDS.techUser1, IDS.techUser2]) {
    try { await auth.deleteUser(uid); } catch { /* already gone (partial seed / re-run) */ }
  }
  console.log("d1-smoke fixture documents and auth users removed (audit events retained, append-only)");
}

const mode = process.argv[2];
const modes = { seed, run, cleanup };
if (!modes[mode]) {
  console.error("usage: node scripts/d1SmokeCompleteAssignedJob.js <seed|run|cleanup>");
  process.exit(2);
}
modes[mode]().catch((e) => { console.error("D1 SMOKE ERROR:", e.message); process.exit(1); });
