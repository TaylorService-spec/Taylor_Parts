#!/usr/bin/env node
// TEST HARNESS ONLY — establishes already-approved Certification World authority inside
// demo-certworld so real authorization paths can be exercised.
//
// ============================ WHAT THIS IS NOT ============================
//
// This is NOT evidence that Role grants were created through the governed writer. That evidence
// already exists, from the 82-grant run against the live sandbox through the deployed grantRole
// command, reconciled at 82 ALREADY_CORRECT / 0 unexpected / 0 UID mismatch / 0 SoD conflict.
//
// This is fixture SETUP. It recreates the authority state that run already approved, so that the
// REAL receiving service, the REAL resolveReceivePermissionThroughTxn, and the REAL
// resolveEffectivePermission can be exercised inside an emulator that has no grant history.
//
// It is deliberately not named grantRole, not named a governed grant, and not named a bootstrap of
// role administration. Calling it any of those would let a later reader mistake a test precondition
// for a governance proof.
//
// ============================ WHY IT HAD TO EXIST ============================
//
// Receiving is the FIRST domain in this program that enforces capability. stageOperationalMovement
// validates an actor's SHAPE and refuses a SYSTEM id, but never asks whether that person may move
// stock; procurementService.createPurchaseOrder takes no actor at all. So every "accountable actor"
// claim before this point was ATTRIBUTION, not AUTHORIZATION -- nobody had been refused, because
// nothing had asked.
//
// Real receive authorization reads users/{uid}.accessVersion and roleAssignments, and a fresh
// emulator has neither. Without this, every employee is denied identically and the receiving proof
// would say nothing about who is allowed to receive.
//
// ============================ WHY NOT THE PRODUCTION BOOTSTRAP ============================
//
// scripts/bootstrapCompatibilityAdmin.js is an ADR-009 controlled exception whose header states it
// is "NOT invoked by Claude Code; a designated infrastructure operator runs it". That boundary is
// deliberate and is respected: this tool cannot reach any real project.
//
// ============================ IT STAYS DUMB ============================
//
// No privileged approval, no grant authorization policy, no admin role-assignment rules, no audit
// approval workflow. Those belong to the product and are proven against the live sandbox. This
// writes the minimum records the resolver reads, in the schema the real writer uses, and nothing
// else.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const ROLE_ASSIGNMENTS = "roleAssignments";
const USERS = "users";
const EMPLOYEES = "employees";

/** The ONLY project this may ever touch. */
const ALLOWED_PROJECT = "demo-certworld";
/** Every assignment is written at this version, and every user carries at least it. */
const ACCESS_VERSION = 1;

const APPLY = process.argv.includes("--apply");
const flag = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const PROJECT_ID = flag("--projectId");

/**
 * Structural refusal. Two independent conditions, both required.
 *
 * The emulator-host check is what makes a real project unreachable: even the correct project id
 * cannot proceed against a live Firestore endpoint, because the Admin SDK would then be talking to
 * Google rather than to localhost.
 */
function assertEmulatorOnly(projectId) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) {
    throw new Error("FIRESTORE_EMULATOR_HOST is not set. This tool only ever runs against an emulator.");
  }
  if (!projectId) {
    throw new Error("--projectId is required. There is no default target for an authority write.");
  }
  if (projectId !== ALLOWED_PROJECT) {
    throw new Error(`"${projectId}" is not ${ALLOWED_PROJECT}. This tool cannot target any other project.`);
  }
  return { projectId, host };
}

async function main() {
  const target = assertEmulatorOnly(PROJECT_ID);
  console.log("TEST HARNESS ONLY -- emulator authority precondition, not governed-grant evidence.\n");
  console.log(`project  : ${target.projectId}`);
  console.log(`emulator : ${target.host}`);
  console.log(`mode     : ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  if (!getApps().length) initializeApp({ projectId: target.projectId });
  const db = getFirestore();

  // ── The APPROVED manifest: the same certGovernedRoles the live sandbox grants were built from.
  //    No new roster is invented here.
  const employees = await db.collection(EMPLOYEES).get();
  const intended = [];
  const problems = [];
  const uidSeen = new Map();

  // EVERY certification principal gets a users record, not only the ones holding a role.
  //
  // An earlier version indexed only role holders, so 14 employees carried a userId pointing at a
  // users document that did not exist. Nothing failed -- they hold no roles, so nothing resolved
  // them -- but the reference sweep found 14 dangling principals, and a principal that exists in
  // one collection and not the other is exactly the sort of half-record that resolves to a blank
  // later on.
  const allPrincipals = new Set();
  for (const doc of employees.docs) {
    const d = doc.data();
    if (!d.certificationWorld) continue;
    if (d.userId) allPrincipals.add(d.userId);
    const roles = d.certGovernedRoles ?? [];
    if (roles.length === 0) continue;
    const uid = d.userId;
    if (!uid) { problems.push(`${doc.id}: no userId -- run the principal relink first`); continue; }
    if (uidSeen.has(uid)) { problems.push(`duplicate principal ${uid}: ${uidSeen.get(uid)} and ${doc.id}`); continue; }
    uidSeen.set(uid, doc.id);
    for (const roleId of roles) intended.push({ employeeId: doc.id, uid, roleId });
  }

  if (problems.length) {
    console.error("REFUSING -- principal linkage is not sound:");
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log(`certification employees with roles : ${uidSeen.size}`);
  console.log(`intended assignments (manifest)    : ${intended.length}`);

  // The privileged Owner grant is NOT part of this. It is still awaiting an authenticated human
  // Admin decision in the live world, and inventing it here to make a test easier would fabricate
  // exactly the approval the whole privileged flow exists to require.
  const privileged = intended.filter((i) => i.roleId === "owner");
  if (privileged.length) {
    console.log(`  excluding ${privileged.length} privileged owner assignment(s) -- still pending human approval`);
  }
  const grantable = intended.filter((i) => i.roleId !== "owner");
  console.log(`grantable (non-privileged)         : ${grantable.length}`);

  // ── Existing state.
  const existing = await db.collection(ROLE_ASSIGNMENTS).get();
  const byKey = new Map();
  for (const doc of existing.docs) {
    const a = doc.data();
    byKey.set(`${a.principalUid}::${a.roleId}`, { id: doc.id, status: a.status });
  }

  const outcomes = { CREATED: 0, ALREADY_CORRECT: 0, UPDATED: 0, FAILED: 0 };
  const writes = [];
  for (const item of grantable) {
    const key = `${item.uid}::${item.roleId}`;
    const hit = byKey.get(key);
    if (hit && hit.status === "active") { outcomes.ALREADY_CORRECT += 1; continue; }
    if (hit) { outcomes.UPDATED += 1; } else { outcomes.CREATED += 1; }
    writes.push({
      // Deterministic doc id, so a second run addresses the same record rather than adding one.
      docId: `cwemu_${item.uid}_${item.roleId}`.replace(/[^A-Za-z0-9_-]/g, "-"),
      data: {
        principalUid: item.uid,
        roleId: item.roleId,
        // The canonical shape the resolver validates: status is the marker, never an `active` flag.
        status: "active",
        scope: { type: "global" },
        accessVersionAtGrant: ACCESS_VERSION,
        grantedBy: "certification-emulator-harness",
        grantedAt: FieldValue.serverTimestamp(),
      },
    });
  }

  const unexpected = [...byKey.entries()].filter(([key]) => {
    const [uid, roleId] = key.split("::");
    return !grantable.some((g) => g.uid === uid && g.roleId === roleId);
  });

  console.log(`\nplanned: CREATED ${outcomes.CREATED}, UPDATED ${outcomes.UPDATED}, ALREADY_CORRECT ${outcomes.ALREADY_CORRECT}`);
  console.log(`unexpected existing assignments    : ${unexpected.length}`);

  if (!APPLY) {
    console.log(`\nDRY RUN -- nothing written. Re-run with --apply to write ${writes.length} assignment(s).`);
    return;
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) {
      batch.set(db.collection(ROLE_ASSIGNMENTS).doc(w.docId), w.data, { merge: true });
    }
    await batch.commit();
  }

  // ── users/{uid}.accessVersion. The resolver refuses an assignment whose accessVersionAtGrant
  //    exceeds the principal's current version, so every holder must carry at least it.
  const uids = [...allPrincipals];
  let versionWrites = 0;
  for (let i = 0; i < uids.length; i += 400) {
    const batch = db.batch();
    for (const uid of uids.slice(i, i + 400)) {
      batch.set(db.collection(USERS).doc(uid), { accessVersion: ACCESS_VERSION }, { merge: true });
      versionWrites += 1;
    }
    await batch.commit();
  }

  console.log(`\nwrote ${writes.length} assignment(s), ${versionWrites} principal accessVersion record(s).`);
  const after = await db.collection(ROLE_ASSIGNMENTS).where("status", "==", "active").count().get();
  console.log(`active assignments now: ${after.data().count}`);
  console.log("\nEMULATOR AUTHORITY BOOTSTRAP IS TEST PRECONDITION, NOT GOVERNED-GRANT EVIDENCE");
  console.log("LIVE SANDBOX GRANT PATH REMAINS THE GOVERNANCE PROOF");
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`\nREFUSED: ${err?.message || err}`);
    process.exitCode = 1;
  });
}
