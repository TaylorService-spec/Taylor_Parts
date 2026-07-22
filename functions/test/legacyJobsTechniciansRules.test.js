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
// POSTURE (test-first; NOT registered in rulesRegressionRunner.mjs's SUITES
// yet -- registration deferred to PR-3, since 3 DEFERRED gaps below remain).
// PR-2 enforced the WRITE/CREATE/DELETE slice for these two collections. The
// read-scoping slice then scoped reads (admin/dispatcher read all; a technician
// reads only their own record and only jobs assigned to them), landed together
// with the Field Mode client query migration. Assertion phases:
//
//   * COMPAT   -- an approved compatibility expectation that already holds
//                 (unauth denied; admin/dispatcher and a technician's
//                 own-assigned status transition allowed). MUST pass.
//   * ENFORCED -- a contract=DENY gap now CLOSED (the WRITE/CREATE/DELETE gaps
//                 from PR-2 plus the two READ-scoping gaps). MUST be denied.
//   * HARDENING (DEFERRED) -- a contract=DENY gap still intentionally deferred:
//                 the technician self-write gap (needs the cross-doc assign/
//                 complete cascade to move to trusted Functions -- Spec sec17).
//                 Still permitted today; documented, not a failure in default.
//
// Two run modes:
//   default (PR-2): PASS iff every COMPAT holds, every ENFORCED gap now denies,
//     and the DEFERRED gaps are the expected still-permitted set.
//   strict  (PR-3): set F_RULES_1_STRICT=1. PASS iff EVERY assertion (incl. the
//     deferred DENY gaps) matches the contract -- used once ALL gaps are closed
//     and this suite is registered in SUITES.
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
// Phases:
//   COMPAT    -- contract expectation already holds; must match now.
//   ENFORCED  -- contract=DENY and PR-2 now enforces it; MUST be denied now.
//   HARDENING -- contract=DENY but intentionally DEFERRED: full technician
//                self-write denial needs the cross-doc assign/complete cascade
//                to move to trusted Functions (Spec sec17). Still permitted;
//                documented, not a failure in default mode.
let compatPass = 0, compatFail = 0, enforcedPass = 0, enforcedFail = 0, deferredGap = 0, unexpected = 0;
const failures = [];

function record(name, phase, contract, status) {
  const denied = status === 401 || status === 403;
  const allowed = status >= 200 && status < 300;
  const matchesContract = contract === "ALLOW" ? allowed : denied;

  if (STRICT) {
    // PR-3 posture: EVERY assertion must match the contract.
    if (matchesContract) { console.log(`PASS  [${phase}] ${name} (${contract}, status ${status})`); (phase === "COMPAT" ? compatPass++ : enforcedPass++); }
    else { console.log(`FAIL  [${phase}] ${name} -- expected ${contract}, got status ${status}`); failures.push(name); (phase === "COMPAT" ? compatFail++ : enforcedFail++); }
    return;
  }

  if (phase === "COMPAT") {
    if (matchesContract) { compatPass++; console.log(`PASS  [COMPAT] ${name} (${contract}, status ${status})`); }
    else { compatFail++; failures.push(name); console.log(`FAIL  [COMPAT] ${name} -- expected ${contract}, got status ${status} (real defect)`); }
  } else if (phase === "ENFORCED") {
    if (denied) { enforcedPass++; console.log(`PASS  [ENFORCED] ${name} -- now DENY (status ${status})`); }
    else if (allowed) { enforcedFail++; failures.push(name); console.log(`FAIL  [ENFORCED] ${name} -- expected DENY but PERMITTED (status ${status}) -- PR-2 gap not closed`); }
    else { unexpected++; failures.push(name); console.log(`FAIL  [ENFORCED] ${name} -- unexpected status ${status}`); }
  } else {
    // HARDENING (deferred past PR-2): contract=DENY, still permitted.
    if (allowed) { deferredGap++; console.log(`GAP   [DEFERRED] ${name} -- contract=DENY, still PERMITTED (status ${status}) -> future PR closes this`); }
    else if (denied) { console.log(`NOTE  [DEFERRED] ${name} -- already DENY (status ${status}); contract already satisfied`); }
    else { unexpected++; failures.push(name); console.log(`FAIL  [DEFERRED] ${name} -- unexpected status ${status}`); }
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

  // -- ENFORCED (read scoping: technician reads only jobs assigned to them) --
  record("technician cannot read another technician's job", "ENFORCED", "DENY", await readDoc("fieldops_jobs", "job-assigned-T2-fr1", t1Tok));
  record("technician cannot create a job", "ENFORCED", "DENY", await createDoc("fieldops_jobs", "job-tech-forge-fr1", t1Tok, validJobCreateFields()));
  record("technician cannot update another technician's job status", "ENFORCED", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T2-fr1", t1Tok, { status: str("in_progress") }));
  record("technician cannot change technicianId (assignment is admin/dispatcher-only)", "ENFORCED", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", t1Tok, { technicianId: str("T2-fr1") }));
  record("technician status write cannot smuggle an extra field (hasOnly status)", "ENFORCED", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", t1Tok, { status: str("in_progress"), customer: mapv({ name: str("HIJACK") }) }));
  record("technician cannot skip lifecycle (assigned->complete directly)", "ENFORCED", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T2-fr1", t2Tok, { status: str("complete") }));
  record("a completed job is terminal (cannot be reopened)", "ENFORCED", "DENY", await updateDoc("fieldops_jobs", "job-complete-T1-fr1", adminTok, { status: str("open") }));
  record("no client can delete a job", "ENFORCED", "DENY", await deleteDoc("fieldops_jobs", "job-assigned-T2-fr1", adminTok));
  record("unmapped technician (no technicianId) cannot update a job (fail closed)", "ENFORCED", "DENY", await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", unmappedTok, { status: str("in_progress") }));
  record("operationalRole-only principal cannot create a job (opRole is not authorization)", "ENFORCED", "DENY", await createDoc("fieldops_jobs", "job-oprole-forge-fr1", oproleTok, validJobCreateFields()));
  record("technician cannot forge a job with arbitrary status/technicianId", "ENFORCED", "DENY", await createDoc("fieldops_jobs", "job-tech-forge2-fr1", t1Tok, { customer: mapv({ name: str("X") }), description: str("d"), status: str("complete"), technicianId: str("T1-fr1"), workOrderId: nul(), address: nul(), createdAt: int(Date.now()) }));

  // ================= fieldops_technicians =================
  // -- COMPAT --
  record("unauthenticated cannot read a technician record", "COMPAT", "DENY", await readDoc("fieldops_technicians", "T1-fr1", null));
  record("admin can read a technician record", "COMPAT", "ALLOW", await readDoc("fieldops_technicians", "T1-fr1", adminTok));
  record("admin can create a technician record", "COMPAT", "ALLOW", await createDoc("fieldops_technicians", "T-new-fr1", adminTok, { name: str("New"), phone: str("555"), status: str("available"), createdAt: int(Date.now()) }));
  record("technician can read own technician record", "COMPAT", "ALLOW", await readDoc("fieldops_technicians", "T1-fr1", t1Tok));

  // -- ENFORCED (read scoping: technician reads only their own record) --
  record("technician cannot read another technician's record", "ENFORCED", "DENY", await readDoc("fieldops_technicians", "T2-fr1", t1Tok));
  // -- HARDENING (DEFERRED: self-write denial needs the assign/complete cascade in trusted Functions, Spec sec17) --
  record("technician cannot update own technician record (no self-write)", "HARDENING", "DENY", await updateDoc("fieldops_technicians", "T1-fr1", t1Tok, { status: str("off_shift") }));
  record("technician cannot update another technician's record", "ENFORCED", "DENY", await updateDoc("fieldops_technicians", "T2-fr1", t1Tok, { status: str("off_shift") }));
  record("technician cannot create a technician record", "ENFORCED", "DENY", await createDoc("fieldops_technicians", "T-tech-forge-fr1", t1Tok, { name: str("Forge"), phone: str("5"), status: str("available"), createdAt: int(Date.now()) }));
  record("no client can delete a technician record", "ENFORCED", "DENY", await deleteDoc("fieldops_technicians", "T2-fr1", adminTok));
  record("a technician record cannot be set to an invalid status", "ENFORCED", "DENY", await updateDoc("fieldops_technicians", "T1-fr1", adminTok, { status: str("vacationing") }));

  // ================= summary =================
  console.log("\n---- F-RULES-1 contract-test summary ----");
  console.log(`mode: ${STRICT ? "STRICT (PR-3: all DENY assertions must be enforced)" : "default (PR-2: enforced gaps must deny; deferred gaps documented)"}`);
  console.log(`COMPAT:   ${compatPass} pass, ${compatFail} fail`);
  console.log(`ENFORCED: ${enforcedPass} now-denied, ${enforcedFail} not-yet-denied`);
  console.log(`DEFERRED: ${deferredGap} still-permitted gaps (later PR closes), ${unexpected} unexpected`);

  if (STRICT) {
    const ok = failures.length === 0;
    console.log(ok ? "\nSTRICT: all contract assertions satisfied." : `\nSTRICT FAIL: ${failures.length} assertion(s) do not match the contract:\n- ${failures.join("\n- ")}`);
    process.exitCode = ok ? 0 : 1;
  } else {
    // PR-2 success: every COMPAT holds, every ENFORCED gap now denies, and the
    // remaining DEFERRED gaps are the expected still-permitted set. A COMPAT
    // failure, an un-closed ENFORCED gap, or any unexpected status is a defect.
    const ok = compatFail === 0 && enforcedFail === 0 && unexpected === 0;
    console.log(ok
      ? `\nContract OK: compatibility preserved; ${enforcedPass} gap(s) now enforced; ${deferredGap} gap(s) intentionally deferred (technician self-write cascade -> trusted Functions, Spec sec17).`
      : `\nContract FAIL: ${compatFail} compat defect(s), ${enforcedFail} un-closed enforced gap(s), ${unexpected} unexpected:\n- ${failures.join("\n- ")}`);
    process.exitCode = ok ? 0 : 1;
  }
}

main().catch((e) => { console.error("SUITE ERROR:", e); process.exitCode = 2; });
