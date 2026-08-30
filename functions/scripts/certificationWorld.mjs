#!/usr/bin/env node
// CERTIFICATION WORLD - permanent, repository-owned sandbox fixture system.
//
// The repository owns the EXPECTED world. Firestore holds an instantiated copy. At any future point
// the copy can be cleared and rebuilt from this source without anyone recreating data by hand.
//
// THREE OPERATIONS, deliberately separate:
//
//   verify   compare sandbox against the expected repository version. WRITES NOTHING.
//   reset    delete governed certification records plus explicitly bounded legacy artifacts. Nothing else.
//   rebuild  verify -> (reset when asked) -> seed -> verify -> report.
//
// WHY SEPARATE. A single "make it right" command must guess what right means when it finds a
// half-built world, and guessing is how a partial dataset becomes a fourth thing matching no version
// at all. Each operation here does one knowable thing and refuses the rest.
//
// Usage -- READ-ONLY (no live-write authorization, by design):
//   node scripts/certificationWorld.mjs verify --projectId eos-platform-sandbox
//   node scripts/certificationWorld.mjs reset  --projectId eos-platform-sandbox --dry-run
//
// Usage -- LIVE WRITE. Each target has its OWN flag, and both --apply and that flag are required:
//   node scripts/certificationWorld.mjs rebuild --projectId eos-platform-sandbox \
//        --apply --apply-live-sandbox --confirm-reset
//   node scripts/certificationWorld.mjs rebuild --projectId eos-platform-certification \
//        --apply --apply-live-certification --confirm-reset
//
// ============================ SAFETY, AND WHY IT MOVED ============================
//
// This tool used to gate on assertSandboxTarget alone: a registry role of exactly "sandbox", plus
// refusals of production by name and of unknown projects. That was correct as far as it went, and
// it stopped going far enough the moment a SECOND sandbox-role environment existed.
//
// eos-platform-certification is role "sandbox". So was eos-platform-sandbox. Under a role-only
// guard the two are indistinguishable, and the command that rebuilds one becomes the command that
// rebuilds the other by editing a single word -- with no flag anywhere on the line naming which
// world is about to be deleted and reseeded. Every OTHER certification tool had already been
// brought under executionTarget.mjs, whose whole point is that the target is named by a flag that
// cannot be re-pointed. The tool that installs the entire world was the one still outside it.
//
// So the authority is now executionTarget.mjs, and there is no second role guard here. It refuses
// production by name AND by role, refuses unknown projects, refuses a missing --projectId, refuses
// ambient credentials that disagree with the stated target, and binds each live target to its own
// flag. See authorizeInvocation() below for the one rule this file adds on top.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { execFileSync } from "node:child_process";

import { MARKER_FIELD, LEGACY_CERTIFICATION_PATTERNS } from "./certificationWorld/manifest.mjs";
import { buildWorld } from "./certificationWorld/build.mjs";
import { writeRecords } from "./certificationWorld/seedWrite.mjs";
import { classifyWorld, WORLD_STATE, SEED_POLICY } from "./certificationWorld/verify.mjs";
import { STATE_COLLECTION, STATE_DOC_ID, VOLATILE_FIELDS, worldFingerprint } from "./certificationWorld/state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// THE authority. Not a second opinion beside assertSandboxTarget -- its replacement. Keeping both
// would mean two guards that can disagree, and the weaker one is the one an operator reaches.
const { resolveExecutionTarget, LIVE_TARGET_FLAGS_BY_PROJECT, describeTarget } =
  await import(pathToFileURL(path.join(__dirname, "certificationWorld", "executionTarget.mjs")).href);

function loadRegistry() {
  return JSON.parse(readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
}

/** Modes that can delete, create or mutate live data. `verify` is not one of them. */
const WRITE_MODES = new Set(["reset", "rebuild"]);

function parseArgs(argv) {
  const args = { mode: argv[0], confirmReset: false, dryRun: false, apply: false };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--projectId") args.projectId = argv[++i];
    else if (a === "--confirm-reset") args.confirmReset = true;
    else if (a === "--dry-run") args.dryRun = true;
    // The live-intent flags are RECOGNISED here and ADJUDICATED by executionTarget.mjs, which reads
    // them from argv itself. Parsing them into booleans here as well would be a second copy of the
    // rule, and the copy is what drifts.
    else if (a === "--apply") args.apply = true;
    else if (a.startsWith("--apply-live-")) args.liveFlags = [...(args.liveFlags ?? []), a];
    else throw new Error("unrecognized argument: " + a);
  }
  if (!["verify", "reset", "rebuild"].includes(args.mode)) {
    throw new Error("mode must be one of: verify | reset | rebuild");
  }
  if (!args.projectId) throw new Error("--projectId is required. There is no default target.");
  return args;
}

/**
 * Decide whether THIS invocation may run, and against what. Pure: parses, adjudicates, and throws.
 * No database, no process exit -- which is why the test suite can drive the real CLI contract
 * instead of asserting against resolveExecutionTarget in isolation and hoping the wiring matches.
 *
 * ============================ THE RULE THIS FILE ADDS ============================
 *
 * executionTarget.mjs treats `--apply-live-certification` as sufficient on its own: it implies live
 * intent, so it implies --apply. That is a reasonable contract for a tool that writes a handful of
 * records. This one deletes and reseeds an entire world, so it requires BOTH -- the generic
 * "this is not a dry run" and the specific "and it is THIS environment". Two independent words have
 * to be typed, and neither one alone reaches live Firestore.
 *
 * `--confirm-reset` is kept and is NOT part of that authorization. It acknowledges destruction, not
 * target: a reset needs to know both that you meant to write live HERE and that you accept the
 * delete. Letting it stand in for either live flag would make the destructive acknowledgement the
 * thing that unlocks the destination, which is backwards.
 */
export function authorizeInvocation(argv) {
  const args = parseArgs(argv);

  // A read-only mode must never demand live-write authorization -- that would train operators to
  // type --apply-live-certification for a command that reads. `reset --dry-run` previews only.
  const writes = WRITE_MODES.has(args.mode) && !args.dryRun;

  // Production (by name and by role), unknown projects, a missing --projectId, disagreeing ambient
  // credentials, and the wrong environment's live flag are all refused in here, once.
  const target = resolveExecutionTarget({ argv: ["node", "certificationWorld.mjs", ...argv], writes });

  if (writes) {
    const liveFlag = LIVE_TARGET_FLAGS_BY_PROJECT.get(target.projectId) ?? null;
    if (target.isLive) {
      if (!args.apply || !argv.includes(liveFlag)) {
        throw new Error(
          `${args.mode} writes live data to ${target.projectId}. It requires BOTH --apply and `
          + `${liveFlag}. Neither one alone reaches live Firestore, and --confirm-reset is not a `
          + "substitute for either.");
      }
    }
    if (args.mode === "reset" && !args.confirmReset) {
      throw new Error("reset is destructive: pass --confirm-reset (or --dry-run to preview).");
    }
  }

  return { args, target, writes };
}

function repoCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.resolve(__dirname, "../..") }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** Every record the world expects, flattened with its marker attached. */
export function expectedRecords() {
  const w = buildWorld();
  const groups = [
    ["accounts", w.accounts], ["locations", w.locations], ["contacts", w.contacts],
    ["equipment_models", w.equipmentModels], ["mobile_locations", w.trucks],
    // employees ADDED 2026-08-21 with world version 1.1.0. Omitting a group here is silent: the
    // world builds 47 employee records, verify never asks for them, and a sandbox missing every
    // employee reports COMPLETE. The version bump is what turns that into a detectable mismatch.
    ["employees", w.employees],
    // equipment ADDED with world version 1.3.0 -- the installed base. Same silent-omission risk
    // the comment above describes, which is why buildGroupsCoverage.test asserts that every
    // array buildWorld() returns appears in this table rather than trusting the next person to
    // read the warning.
    ["equipment", w.equipment],
    // parts ADDED with 1.4.0 -- the service catalog the installed base consumes.
    ["parts", w.parts],
    // technicians and jobs ADDED with 1.5.0 -- the workload the workforce had always DECLARED and
    // never had. Eleven technicians carried a certWorkload category with not one job anywhere in
    // the world; the coverage guard below is what caught them the moment buildWorld started
    // returning them, which is exactly the failure mode its comment describes.
    ["fieldops_technicians", w.technicians],
    ["fieldops_jobs", w.jobs],
  ];
  const out = [];
  for (const [datasetId, rows] of groups) {
    for (const r of rows) {
      out.push({ ...r, data: { ...r.data, [MARKER_FIELD]: { version: w.version, datasetId } } });
    }
  }
  return { world: w, records: out };
}

function countByCollection(rows) {
  const counts = {};
  for (const r of rows) counts[r.collection] = (counts[r.collection] ?? 0) + 1;
  return counts;
}

/**
 * Read back everything carrying our marker.
 *
 * MARKER-SCOPED, which is what makes reset safe: unrelated sandbox data -- baseline packs,
 * transactional fixtures, persona records -- is never read and therefore never a deletion candidate.
 */
async function readInstalled(db, collections) {
  const found = [];
  const versions = new Set();
  for (const c of collections) {
    const snap = await db.collection(c).get().catch(() => null);
    if (!snap) continue;
    snap.forEach((d) => {
      const data = d.data();
      const m = data ? data[MARKER_FIELD] : null;
      if (!m || typeof m.version !== "string") return;
      versions.add(m.version);
      found.push({ collection: c, id: d.id, data });
    });
  }
  return { found, versions: [...versions] };
}

async function doVerify(db, quiet) {
  const { world, records } = expectedRecords();
  const collections = [...new Set(records.map((r) => r.collection))];
  const { found, versions } = await readInstalled(db, collections);

  const actual = countByCollection(found);

  const seen = new Set();
  const duplicateIds = [];
  for (const r of found) {
    const key = r.collection + "/" + r.id;
    if (seen.has(key)) duplicateIds.push(key);
    seen.add(key);
  }

  // Relationship invariant: a location whose account is absent means the world disagrees with
  // itself. That is CORRUPT rather than merely incomplete, and reseeding would not repair it.
  const accountIds = new Set(found.filter((r) => r.collection === "accounts").map((r) => r.id));
  const invariantViolations = [];
  const orphans = found.filter((r) => r.collection === "locations" && !accountIds.has(r.data.accountId));
  if (orphans.length > 0 && accountIds.size > 0) {
    invariantViolations.push(orphans.length + " locations reference a missing account");
  }

  // ============================ IDENTITY IS PART OF COMPLETENESS ============================
  //
  // Measured here rather than assumed, because a rebuild is exactly the operation that breaks it:
  // reset deletes the employee documents, and buildWorld() does not carry `userId` (a UID is
  // environment state, and a deterministic fixture must not depend on it). Every record can return
  // while all 47 employee->principal links are gone -- counts match, fingerprint matches, and
  // nobody can sign in as anyone.
  const identityLinkage = await measureIdentityLinkage(db, found);

  const result = classifyWorld({
    expected: { version: world.version, counts: countByCollection(records) },
    actual, versionsFound: versions, duplicateIds, invariantViolations, identityLinkage,
  });

  const stateSnap = await db.collection(STATE_COLLECTION).doc(STATE_DOC_ID).get().catch(() => null);
  const deployed = stateSnap && stateSnap.exists ? stateSnap.data() : null;

  if (!quiet) {
    console.log("\ncertification world: " + result.state);
    console.log("  expected version : " + world.version);
    console.log("  versions found   : " + (versions.length ? versions.join(", ") : "(none)"));
    console.log("  deployment record: " + (deployed
      ? deployed.datasetVersion + " from " + deployed.repoCommit + " at " + deployed.seededAt
      : "(none)"));
    console.log("  expected records : " + records.length);
    console.log("  installed records: " + found.length);
    for (const f of result.findings) console.log("  ! " + f);
  }
  return { result, world, records, found, deployed };
}

async function deleteRefs(db, refs, label, report) {
  let n = 0;
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
    n += Math.min(400, refs.length - i);
  }
  if (n > 0) report[label] = (report[label] ?? 0) + n;
}

async function doReset(db, opts) {
  const { records } = expectedRecords();
  const collections = [...new Set(records.map((r) => r.collection))];
  const report = {};

  // 1. MARKER-SCOPED. Exactly and only what this world created.
  const { found } = await readInstalled(db, collections);
  const byCollection = {};
  for (const r of found) {
    if (!byCollection[r.collection]) byCollection[r.collection] = [];
    byCollection[r.collection].push(db.collection(r.collection).doc(r.id));
  }

  // 2. BOUNDED LEGACY ARTIFACTS. The rule lives in the manifest and is executed here. A pattern in a
  //    reviewed file is repeatable and auditable; a one-off delete typed into a terminal is neither.
  const legacy = {};
  for (const p of LEGACY_CERTIFICATION_PATTERNS) {
    const snap = await db.collection(p.collection).get();
    const hits = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data && p.test(data[p.field])) hits.push(d.ref);
    });
    if (hits.length) legacy[p.collection + " (legacy: " + p.describe + ")"] = hits;
  }

  if (opts.dryRun) {
    console.log("\nDRY RUN - nothing deleted.");
    let total = 0;
    for (const [c, refs] of Object.entries(byCollection)) { console.log("  would delete " + refs.length + " from " + c + " (marker)"); total += refs.length; }
    for (const [c, refs] of Object.entries(legacy)) { console.log("  would delete " + refs.length + " from " + c); total += refs.length; }
    if (total === 0) console.log("  (nothing to delete - already clean)");
    return { report: {}, total };
  }

  for (const [c, refs] of Object.entries(byCollection)) await deleteRefs(db, refs, c, report);
  for (const [c, refs] of Object.entries(legacy)) await deleteRefs(db, refs, c, report);
  await db.collection(STATE_COLLECTION).doc(STATE_DOC_ID).delete().catch(() => {});

  const total = Object.values(report).reduce((a, b) => a + b, 0);
  console.log("\nreset deleted " + total + " record(s):");
  for (const [c, n] of Object.entries(report).sort()) console.log("  " + String(n).padStart(5) + "  " + c);
  if (total === 0) console.log("  (nothing to delete - already clean)");
  return { report, total };
}

/**
 * Measure the employee <-> principal linkage of the INSTALLED world.
 *
 * Both directions are read. A one-way link is the failure that looks like success: `employee.userId`
 * present with no matching `users/{uid}.employeeId` passes every check that only asks whether the
 * employee has a principal, and breaks every lookup that starts from the signed-in user.
 */
async function measureIdentityLinkage(db, found) {
  const employees = found.filter((r) => r.collection === "employees");
  // Only employees the certification world expects to have a principal. An employee fixture that
  // was never provisioned is not a linkage defect, and counting it as one would make the check
  // permanently red for a reason nobody can fix.
  const expected = employees.filter((r) => r.data?.userId !== undefined || r.data?.certEmail);
  const expectedLinked = expected.length;

  let linked = 0, reverseLinked = 0;
  const mismatched = [];
  const byUid = new Map();

  for (const e of expected) {
    const userId = e.data?.userId;
    if (!userId) continue;
    linked += 1;
    if (!byUid.has(userId)) byUid.set(userId, []);
    byUid.get(userId).push(e.id);

    const userSnap = await db.collection("users").doc(userId).get().catch(() => null);
    const reverseEmployeeId = userSnap && userSnap.exists ? userSnap.data()?.employeeId : undefined;
    if (reverseEmployeeId === undefined) continue;
    reverseLinked += 1;
    if (reverseEmployeeId !== e.id) mismatched.push({ employeeId: e.id, userId, reverse: reverseEmployeeId });
  }

  const duplicateUids = [...byUid.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([userId, employeeIds]) => ({ userId, employeeIds }));

  return { expectedLinked, linked, reverseLinked, mismatched, duplicateUids };
}

async function main() {
  // AUTHORIZE BEFORE ANYTHING CONNECTS. This runs ahead of initializeApp, so a refused invocation
  // never opens a client against the project it was refused for.
  const { args, target } = authorizeInvocation(process.argv.slice(2));
  const registry = loadRegistry();
  const env = (registry.environments || []).find((e) => e?.firebase?.projectId === args.projectId);
  console.log("certification world :: " + args.mode + " :: " + (env?.id ?? "unknown") + " (" + args.projectId + ", role=" + target.role + ")");
  console.log(describeTarget(target));

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  if (args.mode === "verify") {
    const v = await doVerify(db, false);
    // ABSENT is a legitimate, honest state -- an empty sandbox is not a failure.
    process.exitCode = (v.result.state === WORLD_STATE.COMPLETE || v.result.state === WORLD_STATE.ABSENT) ? 0 : 1;
    return;
  }

  if (args.mode === "reset") {
    // The --confirm-reset requirement now lives in authorizeInvocation, beside the live-flag rule,
    // so every precondition for a destructive run is decided in one place and tested there.
    await doReset(db, { dryRun: args.dryRun });
    return;
  }

  // REBUILD. Never "fill in whatever is missing" -- see verify.mjs on why PARTIAL fails closed.
  const before = await doVerify(db, true);
  if (before.result.state !== WORLD_STATE.ABSENT) {
    if (!args.confirmReset) {
      const policy = SEED_POLICY[before.result.state];
      console.log("\nrefusing to rebuild over a " + before.result.state + " world.");
      console.log("  " + policy.reason);
      for (const f of before.result.findings) console.log("  ! " + f);
      console.log("  pass --confirm-reset to clear it first.");
      process.exitCode = before.result.state === WORLD_STATE.COMPLETE ? 0 : 1;
      return;
    }
    await doReset(db, { dryRun: false });
  }

  const { world, records } = expectedRecords();
  const written = await writeRecords(db, records);
  const fp = worldFingerprint(records);

  // THE DEPLOYMENT RECORD. Answers, later and without archaeology: which dataset version is
  // installed, which commit defines it, when it was seeded, and what it should contain.
  await db.collection(STATE_COLLECTION).doc(STATE_DOC_ID).set({
    datasetVersion: world.version,
    repoCommit: repoCommit(),
    seededAt: new Date().toISOString(),
    expectedRecords: records.length,
    expectedCounts: countByCollection(records),
    fingerprint: fp.hash,
    volatileFieldsExcluded: VOLATILE_FIELDS.map((v) => v.field),
  });
  console.log("\nseeded " + written + " record(s); fingerprint " + fp.hash + " over " + fp.rowCount + " rows");

  // ============================ PHASE: PRINCIPAL RELINK ============================
  //
  // REQUIRED, not optional. Reset deleted the employee documents and buildWorld() does not carry
  // `userId` -- correctly, because a Firebase UID is ENVIRONMENT state and a deterministic fixture
  // must not depend on one. Without this phase a rebuild restores all 717 records with all 47
  // employee->principal links gone: counts match, fingerprint matches, and nobody can sign in as
  // anyone, while the governed role assignments -- keyed on UID and stored separately -- survive,
  // pointing at principals that no employee document claims.
  //
  // REUSES THE AUDITED TOOL rather than reimplementing the link. provisionPrincipals.mjs already
  // resolves each principal by its deterministic certification identity, refuses ambiguity, and is
  // idempotent (ALREADY_LINKED on a second run). A second copy of identity-linking logic is the
  // last thing this system needs, so it runs as a subprocess and there stays ONE implementation.
  //
  // It creates no identity that did not already exist: Auth principals survive reset, so this is a
  // relink of survivors rather than a re-provision.
  console.log("\n== phase: principal relink ==");
  try {
    const relink = execFileSync(
      process.execPath,
      [path.join(__dirname, "certificationWorld", "provisionPrincipals.mjs"), "--projectId", args.projectId, "--apply"],
      { encoding: "utf8", cwd: path.resolve(__dirname, "..") },
    );
    console.log(relink.split("\n").slice(-12).join("\n"));
  } catch (err) {
    // A failed relink must NOT be swallowed. The verify below would report
    // IDENTITY_LINKAGE_INCOMPLETE regardless, but saying WHY here saves an operator the hunt.
    console.error("principal relink FAILED: " + (err?.message || err));
    console.error(String(err?.stdout || "").split("\n").slice(-15).join("\n"));
  }

  // The final verify judges DATA and IDENTITY together, so COMPLETE is reported only when the
  // relink above actually restored every link.
  const after = await doVerify(db, false);
  process.exitCode = after.result.state === WORLD_STATE.COMPLETE ? 0 : 1;
}

// RUN ONLY WHEN INVOKED DIRECTLY.
//
// expectedRecords() above is imported by its test -- the guard that every collection buildWorld()
// produces is actually registered for seeding. An unguarded main() runs the entire tool on import:
// it demands --projectId, fails, and calls process.exit(2), killing the test process outright.
//
// A script whose logic cannot be imported without executing it is a script whose logic does not get
// tested. reconcileGrants.mjs had the same shape and shipped with two bugs because of it.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("certificationWorld failed: " + err.message);
    process.exit(2);
  });
}
