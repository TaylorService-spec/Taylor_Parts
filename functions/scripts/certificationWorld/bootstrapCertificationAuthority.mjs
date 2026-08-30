#!/usr/bin/env node
// CERTIFICATION AUTHORITY GENESIS -- the live counterpart to the emulator authority bootstrap.
//
// ============================ WHAT IT IS FOR, AND ONLY THAT ============================
//
// A freshly installed Certification World has 1092 records, 47 linked principals, and ZERO role
// assignments. `admin.roleAssignment.write` is carried by exactly one Role -- `owner` -- which is
// privileged, and granting a privileged Role requires a second distinct approver who already holds
// that same authority. In an empty world there is no actor, no approver, and nobody who can
// authenticate.
//
// So the first grant is not merely awkward through the governed path. It is IMPOSSIBLE through it,
// and correctly so. Every OTHER grant is then trivial: the fixture declares 87 grants of which 86
// are non-privileged, and a non-privileged grant needs one authorized actor and no approver at all.
//
// This tool performs exactly the one grant the governed path cannot reach, and then gets out of the
// way permanently. It is a genesis event, not a role-assignment API.
//
// ============================ WHY A TOOL AND NOT A ONE-OFF ============================
//
// The Certification World is meant to be REPRODUCIBLE. Its dataset is rebuilt from the repository
// on demand, and a world whose authority had to be re-established by a human performing a manual
// two-person ceremony would be reproducible in name only -- the one step nobody could repeat.
// Genesis is therefore governed, repeatable and audited like everything else around it.
//
// ============================ WHAT IT REFUSES ============================
//
// The write itself lives in trustedWriterCommands.bootstrapCertificationAuthority, which fixes the
// Role, refuses any pre-existing active assignment, refuses production by runtime identity, and
// records a genesis audit event rather than impersonating a grantRole actor. This file adds the
// operational preconditions: the right project, named by its own flag, and a world that is actually
// the world it claims to be.
//
// Usage -- DRY RUN (reads and reports, writes nothing):
//   node scripts/certificationWorld/bootstrapCertificationAuthority.mjs \
//        --projectId eos-platform-certification
//
// Usage -- LIVE GENESIS. BOTH words required, and only this environment has a flag:
//   node scripts/certificationWorld/bootstrapCertificationAuthority.mjs \
//        --projectId eos-platform-certification --apply --apply-live-certification
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, assertBothLiveFlags, describeTarget, CERTIFICATION_PROJECT } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { buildWorkforce } = await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));
const { GOVERNED_BUSINESS_ROLES: GB } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { STATE_COLLECTION, STATE_DOC_ID } = await import(L("functions/scripts/certificationWorld/state.mjs"));

/** The world genesis is willing to bootstrap. Anything else is a different world. */
export const EXPECTED_DATASET_VERSION = "1.6.0";
export const EXPECTED_FINGERPRINT = "005ebb1b";
export const EXPECTED_RECORDS = 1092;
export const EXPECTED_PRINCIPALS = 47;

export const OUTCOME = Object.freeze({
  WOULD_BOOTSTRAP: "WOULD_BOOTSTRAP",
  BOOTSTRAPPED: "BOOTSTRAPPED",
  ALREADY_BOOTSTRAPPED: "ALREADY_BOOTSTRAPPED",
});

/**
 * The employee genesis establishes authority for -- DERIVED, never supplied.
 *
 * There is no --employeeId and no --roleId, and that is the point: a tool that accepted either
 * would be a general "grant arbitrary role to arbitrary person" command wearing a bootstrap label.
 * The fixture already declares exactly one privileged grant, so the answer is a lookup, not a
 * choice. If the fixture ever declared two, this throws rather than picking one.
 */
export function deriveGenesisEmployee(workforce = buildWorkforce()) {
  const privileged = workforce.flatMap((e) =>
    (e.certGovernedRoles ?? []).filter((r) => GB[r]?.privileged).map((roleId) => ({ employeeId: e.employeeId, roleId })));
  if (privileged.length === 0) {
    throw new Error("the fixture declares no privileged Role. Genesis has nothing to establish.");
  }
  if (privileged.length > 1) {
    throw new Error(
      `the fixture declares ${privileged.length} privileged grants (`
      + `${privileged.map((p) => `${p.employeeId}:${p.roleId}`).join(", ")}`
      + "). Genesis establishes exactly one authority holder and will not choose between them.");
  }
  return privileged[0];
}

/**
 * Authorization: the shared execution authority, plus certification-by-construction.
 *
 * The project is pinned rather than merely flagged. Certification is the only environment whose
 * authority is genuinely uninitialized by design, and the sandbox's authority was established long
 * ago through its own history -- so widening this tool to accept the sandbox would offer a second
 * source of authority for a world that already has one. If the sandbox ever needs it, that is a
 * decision to make deliberately, not a door to leave open.
 */
export function authorizeGenesis(argv) {
  const apply = argv.includes("--apply");
  const target = resolveExecutionTarget({
    argv: ["node", "bootstrapCertificationAuthority.mjs", ...argv],
    writes: apply,
  });
  if (target.projectId !== CERTIFICATION_PROJECT) {
    throw new Error(
      `genesis targets ${CERTIFICATION_PROJECT} only. Refusing "${target.projectId}" -- `
      + "every other environment's authority came from somewhere already.");
  }
  if (apply) assertBothLiveFlags({ target, argv, act: "Establishing genesis authority in" });
  return { target, apply };
}

/**
 * Is this the world we were told it is?
 *
 * A genesis grant against the WRONG world would establish real authority over a dataset nobody
 * verified, and the mistake would be invisible afterwards -- the assignment looks identical either
 * way. So the preconditions are checked against the deployment record and the live principal links,
 * not assumed from the fact that a rebuild was run at some point.
 */
export function assessWorld({ state, employeeCount, linkedCount, genesisEmployee, genesisUid }) {
  const problems = [];
  if (!state) problems.push("no certification_world/current deployment record -- world not installed");
  else {
    if (state.datasetVersion !== EXPECTED_DATASET_VERSION) {
      problems.push(`datasetVersion ${state.datasetVersion} != expected ${EXPECTED_DATASET_VERSION}`);
    }
    if (state.fingerprint !== EXPECTED_FINGERPRINT) {
      problems.push(`fingerprint ${state.fingerprint} != expected ${EXPECTED_FINGERPRINT}`);
    }
    if (state.expectedRecords !== EXPECTED_RECORDS) {
      problems.push(`expectedRecords ${state.expectedRecords} != expected ${EXPECTED_RECORDS}`);
    }
  }
  if (employeeCount !== EXPECTED_PRINCIPALS) {
    problems.push(`${employeeCount} employees installed, expected ${EXPECTED_PRINCIPALS}`);
  }
  if (linkedCount !== EXPECTED_PRINCIPALS) {
    problems.push(`${linkedCount}/${EXPECTED_PRINCIPALS} principals linked -- run the relink phase`);
  }
  if (!genesisUid) {
    problems.push(`${genesisEmployee} has no linked principal -- genesis has nobody to authorize`);
  }
  return problems;
}

async function main() {
  const argv = process.argv.slice(2);
  // Authorize before anything connects.
  const { target, apply } = authorizeGenesis(argv);
  console.log(describeTarget(target));

  const genesis = deriveGenesisEmployee();
  console.log(`genesis grant : ${genesis.roleId} -> ${genesis.employeeId} (derived from the fixture)`);

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  const stateSnap = await db.collection(STATE_COLLECTION).doc(STATE_DOC_ID).get();
  const state = stateSnap.exists ? stateSnap.data() : null;
  const employees = await db.collection("employees").get();
  const linked = employees.docs.filter((d) => typeof d.data().userId === "string" && d.data().userId);
  const genesisDoc = employees.docs.find((d) => d.id === genesis.employeeId);
  const genesisUid = genesisDoc?.data()?.userId ?? null;

  const problems = assessWorld({
    state,
    employeeCount: employees.size,
    linkedCount: linked.length,
    genesisEmployee: genesis.employeeId,
    genesisUid,
  });
  console.log(`world         : v${state?.datasetVersion ?? "-"} fp ${state?.fingerprint ?? "-"} `
    + `${employees.size} employees, ${linked.length} linked`);
  if (problems.length) {
    console.error("\nREFUSED -- the world is not the one genesis was told to bootstrap:");
    for (const p of problems) console.error(`  ! ${p}`);
    process.exitCode = 1;
    return;
  }

  // ── ALREADY DONE? Read the world, not a memo about it.
  const active = await db.collection("roleAssignments").where("status", "==", "active").limit(5).get();
  if (!active.empty) {
    const rows = active.docs.map((d) => d.data());
    const genesisRow = rows.find((r) => r.principalUid === genesisUid && r.roleId === genesis.roleId);
    if (genesisRow && rows.length === 1) {
      console.log(`\n${OUTCOME.ALREADY_BOOTSTRAPPED}: ${genesis.employeeId} already holds `
        + `"${genesis.roleId}"${genesisRow.genesis ? " (genesis)" : ""}. Nothing written.`);
      return;
    }
    console.error(`\nREFUSED -- ${OUTCOME.ALREADY_BOOTSTRAPPED} is not the state here. `
      + `${active.size} active assignment(s) exist and they are not the expected genesis state:`);
    for (const r of rows) console.error(`  ! ${r.roleId} -> ${r.principalUid}`);
    console.error("  Authority that already exists came from somewhere. Use grantRole.");
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(`\n${OUTCOME.WOULD_BOOTSTRAP}: would establish "${genesis.roleId}" for `
      + `${genesis.employeeId} (${genesisUid}).`);
    console.log("DRY RUN -- nothing written.");
    return;
  }

  // The write itself belongs to the trusted authority module, never to this script.
  const { bootstrapCertificationAuthority } =
    await import(L("functions/lib/access/trustedWriterCommands.js"));
  const outcome = await bootstrapCertificationAuthority({
    principalUid: genesisUid,
    employeeId: genesis.employeeId,
    // Deterministic, so a re-run is a replay rather than a second genesis.
    idempotencyKey: `cw-genesis-${genesis.employeeId}-${genesis.roleId}`,
  });
  console.log(`\n${outcome.status === "applied" ? OUTCOME.BOOTSTRAPPED : OUTCOME.ALREADY_BOOTSTRAPPED}: `
    + `"${genesis.roleId}" for ${genesis.employeeId} (${genesisUid})`);
  console.log(`audit event   : ${outcome.auditEventId}`);
  console.log(`accessVersion : ${outcome.accessVersionAfter}`);
  console.log("\nGenesis is complete and will refuse from here. Every further grant uses grantRole.");
}

// RUN ONLY WHEN INVOKED DIRECTLY, so the authorization and derivation can be tested without the
// tool executing on import.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`\nREFUSED: ${err?.message || err}`);
    process.exitCode = 1;
  });
}
