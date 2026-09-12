// F-RULES-1 Gate D3 -- operator-executed final production verification
// fixtures + data-plane checks for the SHIPPED Field Mode UI completing a
// job through completeAssignedJob (Decision #39; docs/operations/
// f-rules-1-d3-closure-handoff.md is the governing runbook -- the BROWSER
// half of the verification lives there; this script owns seed, the
// post-UI data-plane assertions, and cleanup).
//
// OPERATOR-INVOKED ONLY (Cloud Shell, ADC). Same posture as the D1/D2
// tooling: d3smoke-prefixed fixtures only, session-only password from
// D3_SMOKE_PASSWORD (never printed/persisted), no IAM widening, no keys.
//
// Usage:
//   export D3_SMOKE_PASSWORD="$(openssl rand -base64 18)"
//   node scripts/d3SmokeUiVerification.js seed
//   ... operator performs the browser steps (sign in, click Complete) ...
//   node scripts/d3SmokeUiVerification.js verify
//   node scripts/d3SmokeUiVerification.js cleanup
"use strict";

const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
// ============================ PRODUCTION MUST BE NAMED, PER RUN ============================
//
// PROJECT_ID below is hardcoded to the customer production project, and correctly so -- this tool's
// whole purpose is to verify what is actually deployed THERE, and its callable URL, REST base and web
// API key are all bound to that same project. The defect was not the constant; it was that
// `admin.initializeApp({ projectId: PROJECT_ID })` ran unconditionally at MODULE LOAD. Simply invoking
// `node scripts/d3SmokeUiVerification.js` -- or mistyping the mode -- constructed a production-bound
// Admin SDK client before a single guard had run, with production named nowhere on the line the
// operator actually typed.
//
// So the confirmation is a per-run act, and it is checked HERE -- above the firebase-admin require, not
// merely above initializeApp(). A refused invocation therefore never loads the Admin SDK at all, so
// there is no client in the process that could have contacted anything. The flag value is compared
// against the SHARED PRODUCTION_PROJECT_ID rather than a local literal.
//
// It is deliberately NOT satisfiable by an environment variable, a stored setting, ambient credentials,
// or anything else the machine can supply -- only by an argument on the line being run.
const { PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");
if (process.argv.indexOf("--confirm-production") === -1
    || process.argv[process.argv.indexOf("--confirm-production") + 1] !== PRODUCTION_PROJECT_ID) {
  console.error(
    `REFUSED: D3 smoke targets the production project "${PRODUCTION_PROJECT_ID}". Re-run naming it explicitly:\n`
    + `  node scripts/d3SmokeUiVerification.js <seed|verify|cleanup> --confirm-production ${PRODUCTION_PROJECT_ID}\n`
    + "No Firebase SDK has been loaded, no client created, and nothing contacted."
  );
  process.exit(2);
}

const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const RUN_TAG = process.env.D3_SMOKE_TAG || "d3smoke";
const IDS = {
  techUser: `${RUN_TAG}-user-t1`,
  tech: `${RUN_TAG}-T1`,
  job: `${RUN_TAG}-job-ui`,
};

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

const EVIDENCE_DIR = join(process.cwd(), "d3-smoke-evidence");
const evidence = { runTag: RUN_TAG, gate: "D3", startedAt: new Date().toISOString(), checks: [] };
let failures = 0;
function check(name, ok, detail) {
  evidence.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} -- ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`);
  if (!ok) failures += 1;
}

function smokePassword() {
  const pw = process.env.D3_SMOKE_PASSWORD;
  if (typeof pw !== "string" || pw.length < 12) {
    throw new Error("D3_SMOKE_PASSWORD env var is required (>= 12 chars); generate a throwaway, e.g.: export D3_SMOKE_PASSWORD=\"$(openssl rand -base64 18)\"");
  }
  return pw;
}
const smokeEmail = (uid) => `${uid}@d3smoke.example.com`;

async function seed() {
  const password = smokePassword();
  try { await auth.deleteUser(IDS.techUser); } catch { /* not present */ }
  await auth.createUser({ uid: IDS.techUser, email: smokeEmail(IDS.techUser), password, emailVerified: true });
  await db.doc(`users/${IDS.techUser}`).set({ role: "technician", technicianId: IDS.tech });
  await db.doc(`fieldops_technicians/${IDS.tech}`).set({ name: "D3 Smoke Tech", phone: "000", status: "on_job", createdAt: Date.now() });
  // in_progress so the shipped Field Mode shows "Complete Job" immediately.
  await db.doc(`fieldops_jobs/${IDS.job}`).set({
    customer: { name: "D3 SMOKE (not a real customer)" }, description: "D3 final UI verification fixture",
    status: "in_progress", technicianId: IDS.tech, workOrderId: null, address: null, createdAt: Date.now(),
  });
  console.log(`seeded d3smoke fixtures. Browser sign-in email: ${smokeEmail(IDS.techUser)} (password = your session D3_SMOKE_PASSWORD)`);
}

async function verify() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const job = (await db.doc(`fieldops_jobs/${IDS.job}`).get()).data();
  check("UI completion: job is complete", job?.status === "complete", { status: job?.status });
  check("job untouched otherwise (assignment + description intact)", job?.technicianId === IDS.tech && job?.description === "D3 final UI verification fixture", { technicianId: job?.technicianId });

  const tech = (await db.doc(`fieldops_technicians/${IDS.tech}`).get()).data();
  check("cascade: technician is available", tech?.status === "available", { status: tech?.status });

  const applied = await db.collection("auditEvents")
    .where("targetId", "==", IDS.job).where("outcome", "==", "applied").get();
  check("exactly ONE applied audit event (no duplicate cascade)", applied.size === 1, { count: applied.size });
  const evt = applied.size === 1 ? applied.docs[0] : null;
  check("audit: action completeAssignedJob by the signed-in technician", !!evt && evt.data().action === "completeAssignedJob" && evt.data().actorUid === IDS.techUser, evt && { action: evt.data().action, actorUid: evt.data().actorUid });
  check("audit id is a UI-minted idempotency key (cmpl-*)", !!evt && /^cmpl-[A-Za-z0-9_-]+$/.test(evt.id), evt && { id: evt.id });
  check("audit scope: ownAssignment of the fixture technician", !!evt && evt.data().scope?.type === "ownAssignment" && evt.data().scope?.value === IDS.tech, evt && { scope: evt.data().scope });

  evidence.finishedAt = new Date().toISOString();
  evidence.result = failures === 0 ? "PASS" : "FAIL";
  writeFileSync(join(EVIDENCE_DIR, "d3-smoke-results.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`\nD3 VERIFY ${evidence.result}: ${evidence.checks.filter((c) => c.ok).length} passed, ${failures} failed`);
  console.log(`evidence: ${join(EVIDENCE_DIR, "d3-smoke-results.json")} (no tokens or secrets are written)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function cleanup() {
  for (const p of [`fieldops_jobs/${IDS.job}`, `fieldops_technicians/${IDS.tech}`, `users/${IDS.techUser}`]) {
    await db.doc(p).delete();
  }
  try { await auth.deleteUser(IDS.techUser); } catch { /* already gone */ }
  console.log("d3smoke fixture documents and auth user removed (audit events retained, append-only)");
}

const mode = process.argv[2];
const modes = { seed, verify, cleanup };
if (!modes[mode]) {
  console.error("usage: node scripts/d3SmokeUiVerification.js <seed|verify|cleanup>");
  process.exit(2);
}
modes[mode]().catch((e) => { console.error("D3 SMOKE ERROR:", e.message); process.exit(1); });
