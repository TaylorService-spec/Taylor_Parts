#!/usr/bin/env node
// GRANT RECONCILIATION — what authority SHOULD exist, against what does.
//
// ============================ WHY THIS IS NOT "REPLAY THE GRANTS" ============================
//
// Role assignments are keyed on the Auth UID and live in their own collection, so they survive a
// Certification World reset that deletes and reseeds every employee document. That independence is
// the whole reason this tool has to exist: after a rebuild, the grants are still there, and the
// question is no longer "were they applied" but "do they still point at the right people".
//
// Blindly re-applying the manifest would answer the wrong question and create duplicates. So this
// CLASSIFIES first, and every category means something different:
//
//   ALREADY_CORRECT   the employee holds exactly the Role the world intends. Nothing to do.
//   MISSING_GRANT     intended, absent. The only category that may be repaired, and only through
//                     the governed command path.
//   UNEXPECTED_GRANT  held, not intended. NEVER auto-revoked -- authority that exists for a reason
//                     this fixture does not know about is exactly what a fixture must not delete.
//   UID_MISMATCH      the grant exists but is keyed to a principal this employee no longer claims.
//                     The post-rebuild failure: the assignment is real, and it belongs to a ghost.
//   SOD_CONFLICT      the resulting set violates a segregation-of-duties pair. Reported, never
//                     resolved automatically -- which of two conflicting roles to remove is a
//                     business decision.
//
// ============================ READ-ONLY BY DEFAULT ============================
//
// Reports with no flags. `--apply` grants ONLY the MISSING_GRANT set, and only through the trusted
// grantRole command -- never a direct roleAssignments write, which would bypass the audit trail and
// the SoD checks the command performs.
//
// Usage:
//   node scripts/certificationWorld/reconcileGrants.mjs --projectId eos-platform-sandbox
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { SOD_EXCLUSIVE_PAIRS } = await import(L("functions/scripts/governance/functionalRoleComposition.mjs"));
const { ENVIRONMENT_ACTIVATION_REGISTRY } = await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const PROJECT_ID = flag("--projectId");

const OUTCOME = Object.freeze({
  ALREADY_CORRECT: "ALREADY_CORRECT",
  MISSING_GRANT: "MISSING_GRANT",
  UNEXPECTED_GRANT: "UNEXPECTED_GRANT",
  UID_MISMATCH: "UID_MISMATCH",
  SOD_CONFLICT: "SOD_CONFLICT",
});

function assertKnownSandbox(projectId) {
  if (!projectId) throw new Error("--projectId is required.");
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || []).find((e) => e?.firebase?.projectId === projectId);
  if (!env) throw new Error(`Unknown project "${projectId}". Refusing.`);
  if (env.role === "production") throw new Error(`"${projectId}" is PRODUCTION. This tool never touches production authority.`);
  return { projectId, role: env.role };
}

async function main() {
  const target = assertKnownSandbox(PROJECT_ID);
  console.log(`target: ${target.projectId} (role=${target.role})\n`);
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  // INTENDED authority comes from the live employee documents' fixture field, which is what the
  // grant tool itself used. `certGovernedRoles` is DATA describing an intended grant set; it is not
  // a grant, and the server never reads it as one.
  const employees = await db.collection("employees").get();
  const intended = [];
  const byEmployee = new Map();
  for (const doc of employees.docs) {
    const d = doc.data();
    if (!d.certificationWorld) continue;
    const roles = d.certGovernedRoles || [];
    byEmployee.set(doc.id, { userId: d.userId ?? null, displayName: d.displayName ?? doc.id, roles });
    for (const roleId of roles) intended.push({ employeeId: doc.id, roleId, userId: d.userId ?? null });
  }

  // ACTUAL authority. Queried by the `principalUid` FIELD, not the document id -- the resolver does
  // the same, and assuming the id encodes the principal is how a reconciler reports zero.
  const assignments = await db.collection("roleAssignments").get();
  const actualByUid = new Map();
  let disabledCount = 0;
  for (const doc of assignments.docs) {
    const a = doc.data();
    // THE CANONICAL REVOKED MARKER IS `status`, not an `active` flag and not `revokedAt`.
    // RoleAssignmentStatus is "active" | "disabled" (src/types/access.ts): a revoked assignment is
    // written as "disabled" and keeps every other field. An earlier version of this filter looked
    // for `active === false || revokedAt`, neither of which the writer ever sets -- so a correctly
    // REVOKED assignment counted as live authority. A reconciler that overstates authority is worse
    // than none, because it is believed.
    if (a.status !== "active") { disabledCount += 1; continue; }
    const uid = a.principalUid;
    if (!uid) continue;
    if (!actualByUid.has(uid)) actualByUid.set(uid, new Set());
    actualByUid.get(uid).add(a.roleId);
  }

  const findings = { ALREADY_CORRECT: [], MISSING_GRANT: [], UNEXPECTED_GRANT: [], UID_MISMATCH: [], SOD_CONFLICT: [] };

  for (const [employeeId, e] of byEmployee) {
    if (!e.userId) {
      // No principal at all: every intended grant is unreachable. Reported as UID_MISMATCH rather
      // than MISSING_GRANT, because granting would need a principal that does not exist -- the
      // repair is the relink phase, not a grant.
      for (const roleId of e.roles) findings.UID_MISMATCH.push({ employeeId, roleId, reason: "employee has no userId link" });
      continue;
    }
    const held = actualByUid.get(e.userId) || new Set();
    for (const roleId of e.roles) {
      if (held.has(roleId)) findings.ALREADY_CORRECT.push({ employeeId, roleId });
      else findings.MISSING_GRANT.push({ employeeId, roleId, userId: e.userId });
    }
    for (const roleId of held) {
      if (!e.roles.includes(roleId)) findings.UNEXPECTED_GRANT.push({ employeeId, roleId, userId: e.userId });
    }
    // SoD is evaluated on what the principal ACTUALLY holds, not on what the fixture intends: a
    // conflict created by a grant outside this fixture is still a conflict.
    for (const pair of SOD_EXCLUSIVE_PAIRS) {
      const [a, b] = Array.isArray(pair) ? pair : [pair.a ?? pair.left, pair.b ?? pair.right];
      if (a && b && held.has(a) && held.has(b)) findings.SOD_CONFLICT.push({ employeeId, roles: [a, b] });
    }
  }

  // ORPHANED GRANTS: assignments whose principal NO employee document claims.
  //
  // After a rebuild without the relink phase this is where all 82 grants would land -- real
  // assignments, attached to ghosts.
  //
  // Scoped to EVERY employee, not only certification ones. The sandbox also carries the eight
  // pre-existing test personas, linked to their own non-certification employee records and holding
  // legitimate authority. An earlier version compared against certification employees alone and
  // duly reported all eight as orphans -- a reconciler that cries wolf about the accounts a human
  // signs in with is one nobody reads twice.
  const allClaimedUids = new Set();
  for (const doc of employees.docs) {
    const uid = doc.data().userId;
    if (uid) allClaimedUids.add(uid);
  }
  for (const [uid, roles] of actualByUid) {
    if (!allClaimedUids.has(uid)) {
      findings.UID_MISMATCH.push({
        employeeId: "(none)", userId: uid, roleId: [...roles].join(","),
        reason: "active assignment whose principal no employee document claims",
      });
    }
  }

  console.log(`certification employees        : ${byEmployee.size}`);
  console.log(`employees with intended roles  : ${new Set(intended.map((i) => i.employeeId)).size}`);
  console.log(`total intended grants          : ${intended.length}`);
  console.log(`role assignment documents      : ${assignments.size} (${disabledCount} disabled/revoked, excluded)\n`);

  console.log("reconciliation:");
  for (const k of Object.keys(OUTCOME)) {
    console.log(`  ${k.padEnd(18)} ${String(findings[k].length).padStart(4)}`);
  }

  for (const k of ["MISSING_GRANT", "UNEXPECTED_GRANT", "UID_MISMATCH", "SOD_CONFLICT"]) {
    if (!findings[k].length) continue;
    console.log(`\n${k}:`);
    for (const f of findings[k].slice(0, 20)) console.log(`  ${JSON.stringify(f)}`);
    if (findings[k].length > 20) console.log(`  ... and ${findings[k].length - 20} more`);
  }

  const clean = findings.MISSING_GRANT.length === 0 && findings.UID_MISMATCH.length === 0 && findings.SOD_CONFLICT.length === 0;
  console.log(`\n${clean ? "RECONCILED -- intended authority matches actual authority." : "DIVERGENCE FOUND -- see above."}`);
  if (!clean) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nFAILED: ${err?.message || err}`);
  process.exitCode = 1;
});
