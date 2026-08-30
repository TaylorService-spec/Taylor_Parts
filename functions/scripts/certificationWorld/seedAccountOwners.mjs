#!/usr/bin/env node
// SANDBOX ACCOUNT-OWNER SEED — Owner ruling D-6 (2026-08-30).
//
// The ownership census measured `accounts: 103 scanned, 0 resolved, 103 "no accountOwner"`. Every
// other ownerless family has no ownership field at all; Accounts HAS the storage, the governed
// write path, the seven-field completeness invariant and the UI — and not one of the 103 fixtures
// used it. That is a seeding gap, and this closes it.
//
// It matters more than a fixture usually would, because ruling D-4 makes the Account owner the ROOT
// of the entire person-owned inheritance chain. With no Account owner, a `createOpportunity` that
// omits `ownerEmployeeId` REFUSES — correctly — so inherited creation cannot be exercised at all
// until Accounts have owners. This script is what makes that test possible.
//
// ============================ WHY THIS IS NOT IN buildWorld() ============================
//
// A complete `accountOwner` needs SEVEN fields, and they come from two different places:
//
//   assignedToEmployeeId / assignedByEmployeeId   deterministic world facts — buildWorld knows them
//   assignedToUserId     / assignedByUserId       PROVISIONED identities — buildWorld does NOT
//
// `buildWorld()` emits employees with no `userId`; the uid arrives later, when identities are
// provisioned. So a builder-owned accountOwner could only ever write a PARTIAL map, and a partial
// map is exactly what `isCompleteAccountOwner()` rejects — the fixture would be born failing the
// invariant its own UI enforces.
//
// This is therefore a POST-PROVISION applier, the same shape and for the same reason as
// `applyRoleGrants.mjs`: facts that depend on provisioned identity are applied after the world is
// built, not baked into it. Consequence worth stating plainly: a `rebuild` wipes accountOwner, and
// this must be re-run after one. It is idempotent, so that is safe.
//
// ============================ HOW THE ASSIGNMENT IS CHOSEN ============================
//
// DETERMINISTIC, and from a legitimate business fact — not a proxy. Ruling D-6 forbids inferring
// Account ownership from creator, territory, coverage, activity, sales history, or auth uid, and
// none of those is read here. The cohort is the employees whose governed roles actually include
// `salesperson`, sorted by employee id; the account's numeric fixture index selects from it
// round-robin. Same world in, same assignment out, every time.
//
// The assignor is the `salesManager`, which is what an assignor IS — the person with the authority
// to assign an account. If no manager resolves, the script REFUSES rather than nominating someone.
//
// ============================ SAFETY ============================
//
//   * DRY RUN BY DEFAULT. Writes only with --apply.
//   * TARGET NAMED BY FLAG. A live run needs BOTH --apply and the target's own --apply-live-*.
//     Production is refused unconditionally, by name and by role; there is no override flag.
//   * MARKER-SCOPED. Only Certification World accounts are touched.
//   * NEVER OVERWRITES. An account that already has a complete accountOwner is left exactly as it
//     is — this fills silence, it does not reassign ownership. Reassignment is a HANDOFF, which is
//     an explicit audited act and is not what a seeding script does.
//   * IDEMPOTENT. A second run reports zero mutations.
//
// This is sandbox fixture population. It is NOT the ownership backfill, which remains gated.
//
// Usage:
//   node scripts/certificationWorld/seedAccountOwners.mjs --projectId eos-platform-sandbox
//   node scripts/certificationWorld/seedAccountOwners.mjs --projectId eos-platform-sandbox --apply
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");

const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { resolveExecutionTarget, assertBothLiveFlags, describeTarget } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));

const MARKER_FIELD = "certificationWorld";
const SALES_ROLE = "salesperson";
const MANAGER_ROLE = "salesManager";

// A FIXED epoch, not Date.now(). A seeded assignment timestamp that moved on every run would make
// the fixture non-deterministic and every diff noisy. 2026-08-30T00:00:00Z, the ruling's date.
const ASSIGNED_AT = Date.UTC(2026, 7, 30, 0, 0, 0);


// ============================ TARGET AUTHORITY ============================
//
// This file arrived with its own role-only guard: production refused by name, unknown projects
// refused, registry role must be exactly "sandbox". That was the established pattern when it was
// written, and it is the pattern that stopped working the moment a SECOND sandbox-role environment
// existed.
//
// eos-platform-certification is also role "sandbox". A role check cannot tell the two worlds apart,
// so the command that seeds account owners in one becomes the command that seeds them in the other
// by editing a single word -- with nothing on the line naming which world is about to be written.
//
// Every other Certification World writer was brought under executionTarget.mjs already. This one
// landed afterwards and reintroduced the gap, which is exactly why the guard that catches it is a
// test rather than a convention.
//
// The local guard is REMOVED, not kept beside the shared one: a parallel path that can authorize a
// write independently is precisely what routing through a shared authority has to exclude.
export function authorizeOwnerSeed(argv) {
  const apply = argv.includes("--apply");
  // Production by name AND by role, unknown projects, missing --projectId, and ambient credentials
  // that disagree with the stated target are all refused in here, once.
  const target = resolveExecutionTarget({ argv: ["node", "seedAccountOwners.mjs", ...argv], writes: apply });
  // A live run demands BOTH words; a dry run demands neither and writes nothing.
  if (apply) assertBothLiveFlags({ target, argv, act: "Seeding account owners in" });
  return { target, apply };
}

/** The seven fields, all present or the record is not written. Mirrors isCompleteAccountOwner(). */
function buildAccountOwner(assignee, assignor) {
  return {
    assignedToEmployeeId: assignee.employeeId,
    assignedToUserId: assignee.userId,
    assignedToDisplayName: assignee.displayName,
    assignedByEmployeeId: assignor.employeeId,
    assignedByUserId: assignor.userId,
    assignedByDisplayName: assignor.displayName,
    assignedAt: ASSIGNED_AT,
  };
}

const isComplete = (o) =>
  Boolean(
    o &&
      o.assignedToEmployeeId &&
      o.assignedToUserId &&
      o.assignedToDisplayName &&
      o.assignedByEmployeeId &&
      o.assignedByUserId &&
      o.assignedByDisplayName &&
      Number.isFinite(o.assignedAt),
  );

/** Employees usable as an owner: linked to a user, active, and carrying the role. */
function cohortFrom(docs, role) {
  return docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((e) => (e.certGovernedRoles ?? []).includes(role))
    .filter((e) => e.active === true && e.userId && e.displayName)
    .map((e) => ({ employeeId: e.employeeId ?? e.id, userId: e.userId, displayName: e.displayName }))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

/** The account's stable position in the fixture, from its id. Not its creation order or read order. */
function fixtureIndex(accountId) {
  const m = /(\d+)\s*$/.exec(accountId);
  return m ? Number.parseInt(m[1], 10) : null;
}

async function main() {
  const argv = process.argv.slice(2);
  // AUTHORIZE BEFORE ANYTHING CONNECTS -- ahead of initializeApp, so a refused invocation never
  // opens a client against the project it was refused for.
  const { target, apply } = authorizeOwnerSeed(argv);
  console.log(describeTarget(target));

  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  const employeeSnap = await db.collection("employees").get();
  const owners = cohortFrom(employeeSnap.docs, SALES_ROLE);
  const managers = cohortFrom(employeeSnap.docs, MANAGER_ROLE);

  if (owners.length === 0) throw new Error(`REFUSING: no active, user-linked employee carries the '${SALES_ROLE}' role.`);
  if (managers.length === 0) {
    throw new Error(
      `REFUSING: no active, user-linked employee carries the '${MANAGER_ROLE}' role. An assignment needs a real ` +
        "assignor -- nominating an arbitrary one would fabricate the provenance the invariant exists to record.",
    );
  }
  const assignor = managers[0];

  console.log(`Owner cohort (${SALES_ROLE}, active, user-linked): ${owners.map((o) => o.employeeId).join(", ")}`);
  console.log(`Assignor (${MANAGER_ROLE}): ${assignor.employeeId} (${assignor.displayName})\n`);

  const accountSnap = await db.collection("accounts").get();
  const planned = [];
  let alreadyOwned = 0;
  let skippedNotFixture = 0;
  let skippedNoIndex = 0;

  for (const doc of accountSnap.docs) {
    const data = doc.data();
    if (data[MARKER_FIELD] === undefined) {
      skippedNotFixture += 1;
      continue;
    }
    if (isComplete(data.accountOwner)) {
      alreadyOwned += 1;
      continue;
    }
    const index = fixtureIndex(doc.id);
    if (index === null) {
      // No stable position means no deterministic assignment. Left alone and reported, rather than
      // given an owner chosen by read order -- which would differ between runs.
      skippedNoIndex += 1;
      continue;
    }
    planned.push({ id: doc.id, owner: buildAccountOwner(owners[index % owners.length], assignor) });
  }

  console.log(`accounts scanned:        ${accountSnap.size}`);
  console.log(`  not fixture (skipped): ${skippedNotFixture}`);
  console.log(`  already owned:         ${alreadyOwned}`);
  console.log(`  no stable index:       ${skippedNoIndex}`);
  console.log(`  to assign:             ${planned.length}`);

  const perOwner = {};
  for (const p of planned) perOwner[p.owner.assignedToEmployeeId] = (perOwner[p.owner.assignedToEmployeeId] ?? 0) + 1;
  console.log("\nplanned distribution:");
  for (const [id, n] of Object.entries(perOwner).sort()) console.log(`  ${id}: ${n}`);
  console.log("\nfirst five:");
  for (const p of planned.slice(0, 5)) console.log(`  ${p.id} -> ${p.owner.assignedToEmployeeId} (${p.owner.assignedToDisplayName})`);

  if (!apply) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply to assign ${planned.length} account owner(s).`);
    return;
  }

  let written = 0;
  for (let i = 0; i < planned.length; i += 400) {
    const batch = db.batch();
    for (const p of planned.slice(i, i + 400)) {
      // Field-scoped merge: only accountOwner is written. Nothing else on the customer is touched.
      batch.set(db.collection("accounts").doc(p.id), { accountOwner: p.owner }, { merge: true });
      written += 1;
    }
    await batch.commit();
  }
  console.log(`\nAssigned ${written} account owner(s). Re-run without --apply to confirm 0 remain.`);
}

// RUN ONLY WHEN INVOKED DIRECTLY, so the authorization decision can be imported by its test
// without the tool executing on import -- an unguarded main() demands --projectId, refuses, and
// kills the test process. A decision that cannot be imported without running the script is a
// decision that does not get tested.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
