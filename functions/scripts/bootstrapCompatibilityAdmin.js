// Legacy Compatibility-Admin Bootstrap -- OPERATOR-RUN ONLY. One-time,
// audited migration of an existing legacy administrator (users/{uid}.role
// === "admin", enabled Auth user with the exact approved email) into the
// governed roleAssignment model, by invoking the trusted
// bootstrapCompatibilityAdmin command (functions/src/access/
// trustedWriterCommands.ts). ADR-009 controlled technical exception:
// explicitly authorized, narrowly scoped, audited, idempotent, never a
// routine business workflow. It is NOT a deployed callable and NOT invoked
// by Claude Code; a designated infrastructure operator runs it. It creates
// only a Firestore roleAssignment -- never Firebase/Google Cloud IAM,
// never a manual document edit.
//
// SAFETY:
//   - DRY-RUN DEFAULT. Every invocation validates input and reads current
//     state; only --apply permits the single audited write. A dry-run
//     performs zero writes.
//   - Project guard: --project-id and --confirm-project must both equal the
//     exact target project.
//   - Refuses to run against the Firestore emulator with --apply (production
//     migration only), preventing emulator/production ambiguity.
//
// Usage:
//   node scripts/bootstrapCompatibilityAdmin.js \
//     --project-id taylor-parts --confirm-project taylor-parts \
//     --uid <targetUid> --operator <operatorIdentity> \
//     --email <exact email> --commit <approved commit> [--apply]
// Exit: 0 ok (or dry-run clean); 1 refused/invalid/precondition-failed;
//       2 technical failure.
"use strict";
const {
  InvalidInvocationError, parseCliArgs, assertProjectConfirmation,
} = require("./inventoryEffectOperatorShared");

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
    if (args.help === true) { console.log("bootstrapCompatibilityAdmin -- DRY-RUN default; --apply to write. Required: --project-id --confirm-project --uid --operator --email --commit"); return 0; }
    assertProjectConfirmation(args);
    for (const k of ["uid", "operator", "email", "commit"]) {
      if (typeof args[k] !== "string" || args[k].length === 0) throw new InvalidInvocationError(`--${k} is required`);
    }
  } catch (err) {
    if (err instanceof InvalidInvocationError) { console.error(`INVALID INVOCATION: ${err.message}`); return 1; }
    throw err;
  }
  const apply = args.apply === true;
  if (apply && typeof process.env.FIRESTORE_EMULATOR_HOST === "string" && process.env.FIRESTORE_EMULATOR_HOST.length > 0) {
    console.error("REFUSED: --apply against the Firestore emulator is not allowed (production migration only); unset FIRESTORE_EMULATOR_HOST");
    return 1;
  }

  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");
  initializeApp({ projectId: args["project-id"] });
  const db = getFirestore();

  console.log(`bootstrapCompatibilityAdmin (${apply ? "APPLY" : "DRY-RUN"}) -- project ${args["project-id"]}, target ${args.uid}`);

  // Read-only precondition check (mirrors the command's verify; no writes).
  let rec;
  try { rec = await getAuth().getUser(args.uid); }
  catch { console.error(`PRECONDITION FAILED: no Auth user exists for uid "${args.uid}"`); return 1; }
  if (rec.disabled) { console.error(`PRECONDITION FAILED: Auth user "${args.uid}" is disabled`); return 1; }
  if (rec.email !== args.email) { console.error(`PRECONDITION FAILED: Auth user email does not match --email`); return 1; }
  const userSnap = await db.collection("users").doc(args.uid).get();
  const role = userSnap.exists ? userSnap.data().role : undefined;
  if (role !== "admin") { console.error(`PRECONDITION FAILED: users/${args.uid}.role is not exactly "admin" (got ${JSON.stringify(role)})`); return 1; }
  const activeAdmins = await db.collection("roleAssignments")
    .where("principalUid", "==", args.uid).where("status", "==", "active").where("roleId", "==", "admin").get();
  const conflicts = activeAdmins.docs.filter((d) => d.id !== `bootstrap-admin-${args.uid}`);
  if (conflicts.length > 0) { console.error(`PRECONDITION FAILED: conflicting active admin roleAssignment(s): ${conflicts.map((d) => d.id).join(", ")}`); return 1; }

  console.log("preconditions OK: enabled Auth user, exact email match, users.role=admin, no conflicting active admin assignment");

  if (!apply) {
    console.log("DRY-RUN: would create roleAssignments/bootstrap-admin-" + args.uid + " (roleId=admin, scope=global, grantedBy=bootstrap:legacy-admin-migration) + one applied audit. Re-run with --apply to write.");
    return 0;
  }

  const { bootstrapCompatibilityAdmin } = require("../lib/access/trustedWriterCommands");
  const idempotencyKey = `bootstrap-admin-${args.uid}-${new Date().toISOString().replace(/[^0-9A-Za-z]/g, "")}`;
  const result = await bootstrapCompatibilityAdmin({
    operatorUid: args.operator,
    uid: args.uid,
    expectedEmail: args.email,
    provenanceCommit: args.commit,
    idempotencyKey,
  });
  console.log(`RESULT: ${result.status} (auditEventId ${result.auditEventId}, accessVersionAfter ${result.accessVersionAfter ?? "n/a"})`);
  return 0;
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c; }).catch((err) => { console.error(`BOOTSTRAP FAILURE (technical): ${err.message}`); process.exitCode = 2; });
}
module.exports = { main };
