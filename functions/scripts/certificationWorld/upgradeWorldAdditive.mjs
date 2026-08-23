#!/usr/bin/env node
// ADDITIVE WORLD UPGRADE — bring an installed Certification World forward WITHOUT a reset.
//
// ============================ WHY THIS EXISTS ============================
//
// `certificationWorld.mjs rebuild` refuses to run over a world it did not just create, and with
// --confirm-reset it DELETES the world first. That is the right default: a rebuild that quietly
// filled in whatever was missing would hide a corrupt world behind a clean-looking count.
//
// But the live sandbox is a world that must not be destroyed. It carries an equipment-model identity
// migration, principal links minted by a real Auth service, and grants applied through the governed
// writer. A reset would take all of it, and re-earning it is not a formality.
//
// So this walks the DELTA. Every record the current version expects is compared against what is
// stored, on the parts that must match, and only the ones that are absent or genuinely different are
// written -- with merge, never replacement.
//
// ============================ WHAT IT WILL NOT DO ============================
//
// It DELETES NOTHING. Not a stale record, not an unexpected one, not a record the fixture no longer
// declares. Records the world no longer expects are REPORTED and left alone: deciding that a live
// record is obsolete is a judgement this tool is not entitled to make, and the one place it matters
// -- the superseded equipment models -- was handled by a migration written for exactly that, with
// its own preflight and its own refusals.
//
// It also does not relink principals. A rebuild must, because reset destroyed the employee
// documents; here they were never removed, so touching the link would be inventing work.
//
// ============================ MERGE IS THE SAFETY PROPERTY ============================
//
// Every write is set(..., { merge: true }). A live record that carries a field the fixture does not
// declare -- an environment-minted userId, a migration's updatedBy -- keeps it. Replacement would
// silently strip exactly the fields that exist because something real happened to that record.
//
// Run:
//   node scripts/certificationWorld/upgradeWorldAdditive.mjs --projectId eos-platform-sandbox
//   node scripts/certificationWorld/upgradeWorldAdditive.mjs --projectId eos-platform-sandbox --apply --apply-live-sandbox
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));
const { writeRecords } = await import(L("functions/scripts/certificationWorld/seedWrite.mjs"));
const { STATE_COLLECTION, STATE_DOC_ID, VOLATILE_FIELDS, stableShape, worldFingerprint } =
  await import(L("functions/scripts/certificationWorld/state.mjs"));
const { MARKER_FIELD } = await import(L("functions/scripts/certificationWorld/manifest.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");

/**
 * Compare on the parts that must match.
 *
 * stableShape strips the volatile fields the world contract already names -- server timestamps, the
 * environment-minted Auth uid, per-run idempotency keys. Reusing it rather than writing a comparison
 * here is the point: a second definition of "the same" would disagree with verify eventually, and
 * the disagreement would show up as a record this tool rewrites on every run forever.
 */
const differs = (expected, stored) =>
  JSON.stringify(stableShape(expected)) !== JSON.stringify(stableShape(pick(stored, Object.keys(expected))));

/** Only the keys the fixture declares -- extra stored fields are not drift, they are history. */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

let target = null;
try {
  target = resolveExecutionTarget();
} catch (err) {
  if (!(err instanceof ExecutionTargetRefused)) throw err;
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}

if (target) {
  console.log(describeTarget(target));
  if (!getApps().length) {
    initializeApp(target.isEmulator ? { projectId: target.projectId }
      : { credential: applicationDefault(), projectId: target.projectId });
  }
  const db = getFirestore();
  const { world, records } = expectedRecords();
  console.log(`\nexpected   : ${world.version}, ${records.length} records`);

  // ── Read every collection the world touches, ONCE. ───────────────────────────────────────────
  const collections = [...new Set(records.map((r) => r.collection))];
  const live = new Map();
  for (const c of collections) {
    const snap = await db.collection(c).get();
    for (const doc of snap.docs) live.set(`${c}/${doc.id}`, doc.data());
  }

  const missing = [];
  const changed = [];
  let identical = 0;
  for (const r of records) {
    const stored = live.get(`${r.collection}/${r.id}`);
    if (stored === undefined) { missing.push(r); continue; }
    if (differs(r.data, stored)) { changed.push({ r, stored }); continue; }
    identical += 1;
  }

  // Records carrying THIS world's marker that the current version no longer declares. Reported and
  // never touched -- see the header on why deletion is not this tool's decision.
  const expectedKeys = new Set(records.map((r) => `${r.collection}/${r.id}`));
  const orphaned = [];
  for (const [key, data] of live) {
    if (!expectedKeys.has(key) && data?.[MARKER_FIELD]) orphaned.push(key);
  }

  console.log(`identical  : ${identical}`);
  console.log(`missing    : ${missing.length}`);
  console.log(`differing  : ${changed.length}`);
  console.log(`marked but no longer expected: ${orphaned.length} (reported, NEVER deleted)`);
  console.log("");

  const byCollection = (rows, key = (x) => x.collection) => {
    const out = {};
    for (const x of rows) out[key(x)] = (out[key(x)] ?? 0) + 1;
    return out;
  };
  if (missing.length) console.log(`  MISSING   ${JSON.stringify(byCollection(missing))}`);
  if (changed.length) console.log(`  DIFFERING ${JSON.stringify(byCollection(changed, (x) => x.r.collection))}`);
  for (const m of missing.slice(0, 12)) console.log(`    + ${m.collection}/${m.id}`);
  for (const c of changed.slice(0, 12)) {
    const fields = Object.keys(c.r.data).filter((k) => differs({ [k]: c.r.data[k] }, c.stored));
    console.log(`    ~ ${c.r.collection}/${c.r.id}  [${fields.join(", ")}]`);
  }
  for (const o of orphaned.slice(0, 12)) console.log(`    ? ${o}`);

  const toWrite = [...missing, ...changed.map((c) => c.r)];
  const evidence = {
    target: target.projectId, version: world.version,
    expected: records.length, identical, missing: missing.length, differing: changed.length,
    orphaned, applied: Boolean(target.apply),
    missingIds: missing.map((m) => `${m.collection}/${m.id}`),
    differingIds: changed.map((c) => `${c.r.collection}/${c.r.id}`),
  };

  if (!target.apply) {
    console.log(`\nDRY RUN ONLY -- ${toWrite.length} record(s) would be written with merge. Nothing was changed.`);
  } else if (toWrite.length === 0) {
    console.log("\nNothing to do: every expected record is present and matches.");
  } else {
    const written = await writeRecords(db, toWrite);
    console.log(`\nwrote ${written} record(s) with merge`);

    // THE DEPLOYMENT RECORD, updated only after the write succeeds. It answers "which version is
    // installed" without archaeology, and a stale one is worse than none -- it would assert a
    // version the data does not have.
    const fp = worldFingerprint(records);
    await db.collection(STATE_COLLECTION).doc(STATE_DOC_ID).set({
      datasetVersion: world.version,
      seededAt: new Date().toISOString(),
      expectedRecords: records.length,
      fingerprint: fp.hash,
      volatileFieldsExcluded: VOLATILE_FIELDS.map((v) => v.field),
      upgradedAdditively: true,
    }, { merge: true });
    console.log(`deployment record updated to ${world.version} (fingerprint ${fp.hash})`);
    evidence.written = written;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "world-additive-upgrade.json");
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`evidence   : ${path.relative(REPO, file)}`);
}
