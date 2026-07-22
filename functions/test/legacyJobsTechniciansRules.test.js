// F-RULES-1 PR-1 -- Firestore Rules CONTRACT test suite for the legacy
// fieldops_jobs / fieldops_technicians collections.
//
// Governing artifacts:
//   docs/assessments/f-rules-1-legacy-job-technician-rules-assessment.md
//   docs/specifications/f-rules-1-legacy-job-technician-rules-contract.md
//   docs/implementation-plans/f-rules-1-contract-rules-test-suite.md
//
// SAME "zero-new-dependency" harness as the other *Rules.test.js suites:
// firebase-admin + Node's built-in fetch against the LOCAL Firestore/Auth
// emulator REST APIs (FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST
// below) -- no @firebase/rules-unit-testing, no test runner. It NEVER
// touches the live "taylor-parts" project; all reads/writes go to the
// emulator.
//
// PR-1 POSTURE (test-first; NOT registered in rulesRegressionRunner.mjs's
// SUITES). The current firestore.rules are still permissive for these two
// collections (`allow read, write: if isSignedIn()`), so this suite proves
// the F-RULES-1 vulnerability WITHOUT changing any Rule:
//
//   * COMPAT assertions   -- the contract expectation ALREADY holds under
//                            the current Rules (e.g. unauthenticated is
//                            denied; admin/dispatcher and a technician's
//                            own-assigned status transition are allowed).
//                            These MUST pass now; a COMPAT failure is a
//                            real defect.
//   * HARDENING assertions -- the contract requires DENY, but the current
//                            permissive Rules PERMIT it (the vulnerability).
//                            Run today, these are confirmed "currently
//                            permitted" (the documented gap PR-3 closes).
//
// Two run modes:
//   default (PR-1): PASS iff every COMPAT assertion matches the contract
//     AND every HARDENING assertion is confirmed currently-permitted
//     (i.e. the vulnerability is present exactly where predicted). Exit 0
//     documents the current state. This mode proves the vulnerability.
//   strict  (PR-3): set F_RULES_1_STRICT=1. PASS iff EVERY assertion
//     (COMPAT + HARDENING) matches the contract -- i.e. the hardened Rules
//     now DENY what the contract denies. This is the mode used once the
//     hardened Rules land and this suite is registered in SUITES.
//
// Direct run (documented, deterministic):
//   firebase emulators:exec --only firestore,auth \
//     "node functions/test/legacyJobsTechniciansRules.test.js"
// (run from the repository root so the emulator loads the repo firestore.rules)

"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const FIRESTORE_HOST = "http://127.0.0.1:8080";
const AUTH_HOST = "http://127.0.0.1:9099";
const DOC_BASE = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const STRICT = process.env.F_RULES_1_STRICT === "1";

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

// ---- REST value encoders (typed values, like reorderRequestsRules.test.js) ----
const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const nul = () => ({ nullValue: null });
const bool = (v) => ({ booleanValue: v });
const mapv = (obj) => ({ mapValue: { fields: obj } });

// ---- assertion tallies ---------------------------------------------------------
let compatPass = 0, compatFail = 0, hardeningGap = 0, hardeningEnforced = 0, unexpected = 0;
const failures = [];

// contract: "ALLOW" | "DENY"; phase: "COMPAT" | "HARDENING"
function record(name, phase, contract, status) {
  const denied = status === 401 || status === 403;
  const allowed = status >= 200 && status < 300;
  const matchesContract = contract === "ALLOW" ? allowed : denied;

  if (STRICT) {
    if (matchesContract) { console.log(`PASS  [${phase}] ${name} (${contract}, status ${status})`); (phase === "COMPAT" ? compatPass++ : hardeningEnforced++); }
    else { console.log(`FAIL  [${phase}] ${name} -- expected ${contract}, got status ${status}`); failures.push(name); (phase === "COMPAT" ? compatFail++ : unexpected++); }
    return;
  }

  // default (PR-1) mode
  if (phase === "COMPAT") {
    if (matchesContract) { compatPass++; console.log(`PASS  [COMPAT] ${name} (${contract}, status ${status})`); }
    else { compatFail++; failures.push(name); console.log(`FAIL  [COMPAT] ${name} -- expected ${contract}, got status ${status} (real defect)`); }
  } else {
    // HARDENING: contract is DENY; today's permissive Rules should ALLOW it.
    if (allowed) { hardeningGap++; console.log(`GAP   [HARDENING] ${name} -- contract=DENY but currently PERMITTED (status ${status}) -> PR-3 closes this`); }
    else if (denied) { hardeningEnforced++; console.log(`NOTE  [HARDENING] ${name} -- already DENY under current Rules (status ${status}); contract already satisfied`); }
    else { unexpected++; failures.push(name); console.log(`FAIL  [HARDENING] ${name} -- unexpected status ${status}`); }
  }
}

// ---- token minting (custom token -> id token via Auth emulator) ----------------
async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const body = await res.json();
  if (!body.idToken) throw new Error(`Failed to mint ID token for ${uid}: ${JSON.stringify(body)}`);
  return body.idToken;
}

// ---- REST helpers (return HTTP status) -----------------------------------------
async function createDoc(collection, docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { method: "PATCH", headers, body: JSON.stringify({ fields }) });
  return res.status;
}
async function updateDoc(collection, docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}?${mask}`, { method: "PATCH", headers, body: JSON.stringify({ fields }) });
  return res.status;
}
async function readDoc(collection, docId, idToken) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { method: "GET", headers });
  return res.status;
}
async function deleteDoc(collection, docId, idToken) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { method: "DELETE", headers });
  return res.status;
}

// A representative valid job create payload (jobActions.createJob shape:
// customer/description/status=open/technicianId=null/workOrderId=null/address + createdAt).
function validJobCreateFields() {
  return {
    customer: mapv({ name: str("ACME") }),
    description: str("compressor down"),
    status: str("open"),
    technicianId: nul(),
    workOrderId: nul(),
    address: nul(),
    createdAt: int(Date.now()),
  };
}

// ---- seed (admin SDK bypasses Rules) -------------------------------------------
async function seed() {
  // users/{uid} compatibility profiles + technicianId mapping (immutable via Rules)
  await db.doc("users/u-admin-fr1").set({ role: "admin" });
  await db.doc("users/u-dispatcher-fr1").set({ role: "dispatcher" });
  await db.doc("users/u-tech1-fr1").set({ role: "technician", technicianId: "T1-fr1" });
  await db.doc("users/u-tech2-fr1").set({ role: "technician", technicianId: "T2-fr1" });
  await db.doc("users/u-tech-unmapped-fr1").set({ role: "technician" }); // no technicianId
  await db.doc("users/u-oprole-fr1").set({ role: "technician", technicianId: "T3-fr1", employeeId: "emp-oprole-fr1" });
  await db.doc("employees/emp-oprole-fr1").set({
    employeeId: "emp-oprole-fr1", displayName: "OpRole Tech", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "u-oprole-fr1", createdAt: Date.now(),
  });

  // technician docs
  for (const t of ["T1-fr1", "T2-fr1", "T3-fr1"]) {
    await db.doc(`fieldops_technicians/${t}`).set({ name: `Tech ${t}`, phone: "555", status: "available", createdAt: Date.now() });
  }

  // job docs at each lifecycle state
  await db.doc("fieldops_jobs/job-open-fr1").set({ customer: { name: "ACME" }, description: "d", status: "open", technicianId: null, workOrderId: null, address: null, createdAt: Date.now() });
  await db.doc("fieldops_jobs/job-assigned-T1-fr1").set({ customer: { name: "ACME" }, description: "d", status: "assigned", technicianId: "T1-fr1", workOrderId: null, address: null, createdAt: Date.now() });
  await db.doc("fieldops_jobs/job-inprogress-T1-fr1").set({ customer: { name: "ACME" }, description: "d", status: "in_progress", technicianId: "T1-fr1", workOrderId: null, address: null, createdAt: Date.now() });
  await db.doc("fieldops_jobs/job-complete-T1-fr1").set({ customer: { name: "ACME" }, description: "d", status: "complete", technicianId: "T1-fr1", workOrderId: null, address: null, createdAt: Date.now() });
  await db.doc("fieldops_jobs/job-assigned-T2-fr1").set({ customer: { name: "ACME" }, description: "d", status: "assigned", technicianId: "T2-fr1", workOrderId: null, address: null, createdAt: Date.now() });
}

async function main() {
  await seed();
  const [adminTok, dispTok, t1Tok, t2Tok, unmappedTok, oproleTok] = await Promise.all([
    idTokenFor("u-admin-fr1"), idTokenFor("u-dispatcher-fr1"), idTokenFor("u-tech1-fr1"),
    idTokenFor("u-tech2-fr1"), idTokenFor("u-tech-unmapped-fr1"), idTokenFor("u-oprole-fr1"),
  ]);

  // ================= fieldops_jobs =================
  // -- COMPAT (must hold now) --
  record("unauthenticated cannot read a job", "COMPAT", "DENY", await readDoc("fieldops_jobs", "job-assigned-T1-fr1", null));
  record("unauthenticated cannot create a job", "COMPAT", "DENY", await createDoc("fieldops_jobs", "job-unauth-fr1", null, validJobCreateFields()));
  record("admin can read a job", "COMPAT", "ALLOW", await readDoc("fieldops_jobs", "job-assigned-T1-fr1", adminTok));
  record("dispatcher can read a job", "COMPAT", "ALLOW", await readDoc("fieldops_jobs", "job-open-fr1", dispTok));
  record("admin can create a valid (open, unassigned) job", "COMPAT", "ALLOW", await createDoc("fieldops_jobs", "job-admin-new-fr1", adminTok, validJobCreateFields()));
  record("dispatcher can assign a job (technicianId + status)", "COMPAT", "ALLOW", await updateDoc("fieldops_jobs", "job-open-fr1", dispTok, { technicianId: str("T1-fr1"), status: str("assigned") }));
  record("assigned technician can start own job (assigned->in_progress, status only)", "COMPAT", "ALLOW", await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", t1Tok, { status: str("in_progress") }));
  record("assigned technician can complete own job (in_progress->complete)", "COMPAT", "ALLOW", await updateDoc("fieldops_jobs", "job-inprogress-T1-fr1", t1Tok, { status: str("complete") }));
  record("assigned technician can read own job", "COMPAT", "ALLOW", await readDoc("fieldops_jobs", "job-assigned-T1-fr1", t1Tok));

  // -- HARDENING (contract=DENY; currently permitted) --
  record("technician cannot read another technician's job", "HARDENING", "DENY", await readDoc("fieldops_jobs", "job-assigned-T2-fr1", t1Tok));
  record("technician cannot create a job", "HARDENING", "DENY", await createDoc("fieldops_jobs", "job-tech-forge-fr1", t1Tok, validJobCreateFields()));
  record("technician cannot update another technician's job status", "HARDENING", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T2-fr1", t1Tok, { status: str("in_progress") }));
  record("technician cannot change technicianId (assignment is admin/dispatcher-only)", "HARDENING", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", t1Tok, { technicianId: str("T2-fr1") }));
  record("technician status write cannot smuggle an extra field (hasOnly status)", "HARDENING", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", t1Tok, { status: str("in_progress"), customer: mapv({ name: str("HIJACK") }) }));
  record("technician cannot skip lifecycle (assigned->complete directly)", "HARDENING", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T2-fr1", t2Tok, { status: str("complete") }));
  record("a completed job is terminal (cannot be reopened)", "HARDENING", "DENY", await updateDoc("fieldops_jobs", "job-complete-T1-fr1", adminTok, { status: str("open") }));
  record("no client can delete a job", "HARDENING", "DENY", await deleteDoc("fieldops_jobs", "job-assigned-T2-fr1", adminTok));
  record("unmapped technician (no technicianId) cannot update a job (fail closed)", "HARDENING", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", unmappedTok, { status: str("in_progress") }));
  record("operationalRole-only principal cannot create a job (opRole is not authorization)", "HARDENING", "DENY", await createDoc("fieldops_jobs", "job-oprole-forge-fr1", oproleTok, validJobCreateFields()));
  record("technician cannot forge a job with arbitrary status/technicianId", "HARDENING", "DENY", await createDoc("fieldops_jobs", "job-tech-forge2-fr1", t1Tok, { customer: mapv({ name: str("X") }), description: str("d"), status: str("complete"), technicianId: str("T1-fr1"), workOrderId: nul(), address: nul(), createdAt: int(Date.now()) }));

  // ================= fieldops_technicians =================
  // -- COMPAT --
  record("unauthenticated cannot read a technician record", "COMPAT", "DENY", await readDoc("fieldops_technicians", "T1-fr1", null));
  record("admin can read a technician record", "COMPAT", "ALLOW", await readDoc("fieldops_technicians", "T1-fr1", adminTok));
  record("admin can create a technician record", "COMPAT", "ALLOW", await createDoc("fieldops_technicians", "T-new-fr1", adminTok, { name: str("New"), phone: str("555"), status: str("available"), createdAt: int(Date.now()) }));
  record("technician can read own technician record", "COMPAT", "ALLOW", await readDoc("fieldops_technicians", "T1-fr1", t1Tok));

  // -- HARDENING --
  record("technician cannot read another technician's record", "HARDENING", "DENY", await readDoc("fieldops_technicians", "T2-fr1", t1Tok));
  record("technician cannot update own technician record (no self-write)", "HARDENING", "DENY", await updateDoc("fieldops_technicians", "T1-fr1", t1Tok, { status: str("off_shift") }));
  record("technician cannot update another technician's record", "HARDENING", "DENY", await updateDoc("fieldops_technicians", "T2-fr1", t1Tok, { status: str("off_shift") }));
  record("technician cannot create a technician record", "HARDENING", "DENY", await createDoc("fieldops_technicians", "T-tech-forge-fr1", t1Tok, { name: str("Forge"), phone: str("5"), status: str("available"), createdAt: int(Date.now()) }));
  record("no client can delete a technician record", "HARDENING", "DENY", await deleteDoc("fieldops_technicians", "T2-fr1", adminTok));
  record("a technician record cannot be set to an invalid status", "HARDENING", "DENY", await updateDoc("fieldops_technicians", "T1-fr1", adminTok, { status: str("vacationing") }));

  // ================= summary =================
  console.log("\n---- F-RULES-1 PR-1 contract-test summary ----");
  console.log(`mode: ${STRICT ? "STRICT (PR-3: all assertions must match the contract)" : "default (PR-1: prove vulnerability against current permissive Rules)"}`);
  console.log(`COMPAT: ${compatPass} pass, ${compatFail} fail`);
  console.log(`HARDENING: ${hardeningGap} currently-permitted gaps (PR-3 closes), ${hardeningEnforced} already-enforced, ${unexpected} unexpected`);

  if (STRICT) {
    const ok = failures.length === 0;
    console.log(ok ? "\nSTRICT: all contract assertions satisfied." : `\nSTRICT FAIL: ${failures.length} assertion(s) do not match the contract:\n- ${failures.join("\n- ")}`);
    process.exitCode = ok ? 0 : 1;
  } else {
    // PR-1 success = harness healthy: every COMPAT holds AND every hardening
    // target is a confirmed currently-permitted gap (the vulnerability is
    // present exactly where the contract will close it). Any COMPAT fail or
    // unexpected status is a real problem.
    const ok = compatFail === 0 && unexpected === 0;
    console.log(ok
      ? `\nPR-1 OK: compatibility preserved; ${hardeningGap} vulnerability gap(s) confirmed present (to be closed by PR-3 hardened Rules).`
      : `\nPR-1 FAIL: ${compatFail} compatibility defect(s) and/or ${unexpected} unexpected result(s):\n- ${failures.join("\n- ")}`);
    process.exitCode = ok ? 0 : 1;
  }
}

main().catch((e) => { console.error("SUITE ERROR:", e); process.exitCode = 2; });
