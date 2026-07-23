// F-RULES-1 Gate D2 -- operator-executed post-deploy production verification
// of the hardened Firestore Rules (Decision #39; docs/operations/
// f-rules-1-d2-deployment-handoff.md is the governing runbook).
//
// OPERATOR-INVOKED ONLY (Cloud Shell, ADC). Referenced by no runtime, CI,
// build, install, deploy, or emulator path. Mutates ONLY its own d2smoke-*
// fixture documents plus the append-only Audit Events the trusted callable
// writes. Client-side checks use the PRODUCTION Firestore REST API with a
// real password-authenticated ID token, so every allow/deny below is the
// deployed Rules' actual production behavior -- exactly what D2 must prove.
//
// Auth: same approach as D1 (no token signing, no IAM widening): two
// deterministic d2smoke Auth users with a session-only password from
// D2_SMOKE_PASSWORD (never printed or persisted).
//
// Usage (Cloud Shell, AFTER `firebase deploy --only firestore:rules`):
//   export D2_SMOKE_PASSWORD="$(openssl rand -base64 18)"
//   cd functions && node scripts/d2SmokeRulesVerification.js seed
//   node scripts/d2SmokeRulesVerification.js run
//   node scripts/d2SmokeRulesVerification.js cleanup
// `run` exits 0 only if ALL 21 checks pass.
"use strict";

const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const REGION = "us-central1";
const CALLABLE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/completeAssignedJob`;
const DOC_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
// Public web API key (shipped in every client bundle) -- used only for the
// public password sign-in endpoint; not a secret.
const WEB_API_KEY = "AIzaSyATXIiI5C1m" + "LmsvS0k-x3i7ZxAbAPtRpSY";

const RUN_TAG = process.env.D2_SMOKE_TAG || "d2smoke";
const IDS = {
  techUser1: `${RUN_TAG}-user-t1`,
  techUser2: `${RUN_TAG}-user-t2`,
  tech1: `${RUN_TAG}-T1`,
  tech2: `${RUN_TAG}-T2`,
  job: `${RUN_TAG}-job-flow`,
  keyCallable: `${RUN_TAG}-key-callable-0001`,
};
const INVENTORY_COLLECTIONS = ["parts", "manufacturers", "part_aliases", "part_supplier_items"];

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

const EVIDENCE_DIR = join(process.cwd(), "d2-smoke-evidence");
const evidence = { runTag: RUN_TAG, gate: "D2", startedAt: new Date().toISOString(), checks: [] };
let failures = 0;
function check(name, ok, detail) {
  evidence.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} -- ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`);
  if (!ok) failures += 1;
}

function smokePassword() {
  const pw = process.env.D2_SMOKE_PASSWORD;
  if (typeof pw !== "string" || pw.length < 12) {
    throw new Error("D2_SMOKE_PASSWORD env var is required (>= 12 chars); generate a throwaway, e.g.: export D2_SMOKE_PASSWORD=\"$(openssl rand -base64 18)\"");
  }
  return pw;
}
const smokeEmail = (uid) => `${uid}@d2smoke.example.com`;

async function idTokenFor(uid) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: smokeEmail(uid), password: smokePassword(), returnSecureToken: true }) },
  );
  const body = await res.json();
  if (!body.idToken) throw new Error(`password sign-in failed for ${uid}: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  return body.idToken;
}

// ---- Rules-enforced CLIENT operations (production Firestore REST) ----------
const str = (v) => ({ stringValue: v });
async function clientPatch(idToken, path, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${DOC_BASE}/${path}?${mask}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  return res.status;
}
async function clientGet(idToken, path) {
  const res = await fetch(`${DOC_BASE}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  return res.status;
}
async function clientCreate(idToken, collection, docId, fields) {
  const res = await fetch(`${DOC_BASE}/${collection}?documentId=${docId}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  return res.status;
}
async function callCallable(idToken, data) {
  const res = await fetch(CALLABLE_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function seed() {
  const password = smokePassword();
  for (const uid of [IDS.techUser1, IDS.techUser2]) {
    try { await auth.deleteUser(uid); } catch { /* not present */ }
    await auth.createUser({ uid, email: smokeEmail(uid), password, emailVerified: true });
  }
  await db.doc(`users/${IDS.techUser1}`).set({ role: "technician", technicianId: IDS.tech1 });
  await db.doc(`users/${IDS.techUser2}`).set({ role: "technician", technicianId: IDS.tech2 });
  await db.doc(`fieldops_technicians/${IDS.tech1}`).set({ name: "D2 Smoke Tech 1", phone: "000", status: "on_job", createdAt: Date.now() });
  await db.doc(`fieldops_technicians/${IDS.tech2}`).set({ name: "D2 Smoke Tech 2", phone: "000", status: "available", createdAt: Date.now() });
  await db.doc(`fieldops_jobs/${IDS.job}`).set({
    customer: { name: "D2 SMOKE (not a real customer)" }, description: "D2 rules verification fixture",
    status: "assigned", technicianId: IDS.tech1, workOrderId: null, address: null, createdAt: Date.now(),
  });
  console.log(`seeded d2smoke fixtures (tag "${RUN_TAG}")`);
}

async function run() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const [tok1, tok2] = [await idTokenFor(IDS.techUser1), await idTokenFor(IDS.techUser2)];
  const jobPath = `fieldops_jobs/${IDS.job}`;

  // 1. Wrong technician cannot start T1's assigned job.
  const wrongStart = await clientPatch(tok2, jobPath, { status: str("in_progress") });
  check("wrong technician direct start denied", wrongStart === 403, { status: wrongStart });

  // 2-3. Assigned technician's direct status-only start is ALLOWED.
  const start = await clientPatch(tok1, jobPath, { status: str("in_progress") });
  check("assigned technician direct start (status-only) allowed", start === 200, { status: start });
  const afterStart = (await db.doc(jobPath).get()).data();
  check("job is in_progress after direct start", afterStart?.status === "in_progress", { status: afterStart?.status });

  // 4-5. Direct completion is DENIED (the D2 closure itself).
  const directComplete = await clientPatch(tok1, jobPath, { status: str("complete") });
  check("technician direct completion denied", directComplete === 403, { status: directComplete });
  const afterDenied = (await db.doc(jobPath).get()).data();
  check("job unchanged after denied direct completion", afterDenied?.status === "in_progress", { status: afterDenied?.status });

  // 6. Self-availability is DENIED.
  const selfAvail = await clientPatch(tok1, `fieldops_technicians/${IDS.tech1}`, { status: str("available") });
  check("technician self-availability update denied", selfAvail === 403, { status: selfAvail });

  // 7-10. Trusted callable still completes: cascade + audit.
  const call = await callCallable(tok1, { jobId: IDS.job, idempotencyKey: IDS.keyCallable });
  check("callable completion HTTP 200", call.status === 200, { status: call.status });
  const result = call.body?.result;
  check("callable response contract", JSON.stringify(result) === JSON.stringify({ jobId: IDS.job, status: "complete", idempotentReplay: false }), result ?? call.body);
  const jobDone = (await db.doc(jobPath).get()).data();
  const techDone = (await db.doc(`fieldops_technicians/${IDS.tech1}`).get()).data();
  check("cascade: job -> complete", jobDone?.status === "complete", { status: jobDone?.status });
  check("cascade: technician -> available", techDone?.status === "available", { status: techDone?.status });
  const audit = (await db.doc(`auditEvents/${IDS.keyCallable}`).get()).data();
  check("audit: applied event at the idempotency key", !!audit && audit.action === "completeAssignedJob" && audit.actorUid === IDS.techUser1 && audit.outcome === "applied", audit && { action: audit.action, outcome: audit.outcome });

  // 11-13. Exact idempotent replay under deployed Rules.
  await db.doc(`fieldops_technicians/${IDS.tech1}`).update({ status: "off_shift" });
  const replay = await callCallable(tok1, { jobId: IDS.job, idempotencyKey: IDS.keyCallable });
  check("replay: idempotentReplay true", replay.body?.result?.idempotentReplay === true, replay.body?.result);
  const techReplay = (await db.doc(`fieldops_technicians/${IDS.tech1}`).get()).data();
  check("replay: no duplicate cascade (perturbed tech untouched)", techReplay?.status === "off_shift", { status: techReplay?.status });
  const applied = await db.collection("auditEvents").where("targetId", "==", IDS.job).where("outcome", "==", "applied").get();
  check("replay: exactly one applied audit event", applied.size === 1, { count: applied.size });

  // 14-21. Inventory client closure: read AND create denied on all four
  // trusted-writer-only collections (fixture ids only; nothing real is read).
  for (const coll of INVENTORY_COLLECTIONS) {
    const readStatus = await clientGet(tok1, `${coll}/${RUN_TAG}-probe`);
    check(`inventory closure: client read of ${coll} denied`, readStatus === 403, { status: readStatus });
  }
  for (const coll of INVENTORY_COLLECTIONS) {
    const createStatus = await clientCreate(tok1, coll, `${RUN_TAG}-forge`, { note: str("d2smoke forge attempt") });
    check(`inventory closure: client create in ${coll} denied`, createStatus === 403, { status: createStatus });
  }

  evidence.finishedAt = new Date().toISOString();
  evidence.result = failures === 0 ? "PASS" : "FAIL";
  writeFileSync(join(EVIDENCE_DIR, "d2-smoke-results.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`\nD2 SMOKE ${evidence.result}: ${evidence.checks.filter((c) => c.ok).length} passed, ${failures} failed`);
  console.log(`evidence: ${join(EVIDENCE_DIR, "d2-smoke-results.json")} (no tokens or secrets are written)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function cleanup() {
  for (const p of [
    `fieldops_jobs/${IDS.job}`,
    `fieldops_technicians/${IDS.tech1}`, `fieldops_technicians/${IDS.tech2}`,
    `users/${IDS.techUser1}`, `users/${IDS.techUser2}`,
  ]) await db.doc(p).delete();
  for (const uid of [IDS.techUser1, IDS.techUser2]) {
    try { await auth.deleteUser(uid); } catch { /* already gone */ }
  }
  console.log("d2smoke fixture documents and auth users removed (audit events retained, append-only)");
}

const mode = process.argv[2];
const modes = { seed, run, cleanup };
if (!modes[mode]) {
  console.error("usage: node scripts/d2SmokeRulesVerification.js <seed|run|cleanup>");
  process.exit(2);
}
modes[mode]().catch((e) => { console.error("D2 SMOKE ERROR:", e.message); process.exit(1); });
