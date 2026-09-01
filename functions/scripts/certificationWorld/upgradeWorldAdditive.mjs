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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused, assertBothLiveFlags } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));
const { writeRecords, TIMESTAMP_POLICY, differsOnDeclaredFields, classifyTimestampPolicy } =
  await import(L("functions/scripts/certificationWorld/seedWrite.mjs"));
const { STATE_COLLECTION, STATE_DOC_ID, VOLATILE_FIELDS, stableShape, worldFingerprint } =
  await import(L("functions/scripts/certificationWorld/state.mjs"));
const { MARKER_FIELD } = await import(L("functions/scripts/certificationWorld/manifest.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");

/** The commit this upgrade was run FROM. "unknown" rather than a guess if git cannot answer. */
function repoCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim();
  } catch {
    return "unknown";
  }
}

// COMPARISON AND TIMESTAMP POLICY BOTH LIVE IN seedWrite.mjs.
//
// They used to be defined here, and the classifier had to be added beside them for
// CERT-UPGRADE-TIMESTAMPS-05. Two copies of "are these the same record" is how the tool and verify
// would drift apart, and a policy decided here could not be exercised by a test without executing
// this whole script against a project. One definition, imported.

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
  // CERT-UPGRADE-FLAGS-04. This tool rewrites EVERY record in the world -- 1093 of them on the
  // 1.7.0 -> 1.8.0 upgrade. That is the same weight as a rebuild, and it gets the same rule the
  // rebuild has: --apply-live-<env> alone implies live intent and would have been sufficient on
  // its own, which is the right contract for a tool that writes a handful of records and the wrong
  // one for a tool that writes all of them. Two independent words, neither sufficient alone.
  //
  // Applied only when the run would actually write: a dry run must never demand live-write
  // authorization, or operators learn to type the live flag for commands that read.
  if (target.apply) {
    try {
      assertBothLiveFlags({ target, argv: process.argv, act: "An additive upgrade that writes" });
    } catch (err) {
      if (!(err instanceof ExecutionTargetRefused)) throw err;
      console.error(`REFUSED: ${err.message}`);
      process.exitCode = 1;
      target = null;
    }
  }
}

if (target) {
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
    if (differsOnDeclaredFields(r.data, stored)) { changed.push({ r, stored }); continue; }
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
    const fields = Object.keys(c.r.data).filter((k) => differsOnDeclaredFields({ [k]: c.r.data[k] }, c.stored));
    console.log(`    ~ ${c.r.collection}/${c.r.id}  [${fields.join(", ")}]`);
  }
  for (const o of orphaned.slice(0, 12)) console.log(`    ? ${o}`);

  // ── TIMESTAMP TREATMENT, decided per record and carried WITH the record.
  //
  // merge:true preserves a stored field only when the payload omits it, so this classification is
  // what stops the upgrade rewriting createdAt on every document it touches. See seedWrite.mjs.
  const policyOf = (c) => classifyTimestampPolicy(c.r.data, c.stored);
  const contentChanged = changed.filter((c) => policyOf(c) === TIMESTAMP_POLICY.CONTENT_UPDATE);
  const markerOnly = changed.filter((c) => policyOf(c) === TIMESTAMP_POLICY.METADATA_ONLY);

  const toWrite = [
    ...missing.map((r) => ({ ...r, timestampPolicy: TIMESTAMP_POLICY.NEW_RECORD })),
    ...contentChanged.map((c) => ({ ...c.r, timestampPolicy: TIMESTAMP_POLICY.CONTENT_UPDATE })),
    ...markerOnly.map((c) => ({ ...c.r, timestampPolicy: TIMESTAMP_POLICY.METADATA_ONLY })),
  ];

  // THE LITERAL WRITE PAYLOAD, not a stable-shape summary. An operator reading "differing: 1092"
  // cannot tell from that number alone whether 1092 createdAt values are about to be replaced, and
  // that ambiguity is the whole of CERT-UPGRADE-TIMESTAMPS-05. So the mutation set is spelled out.
  console.log("TIMESTAMP TREATMENT (the actual Firestore write payload):");
  console.log(`  NEW_RECORD     ${String(missing.length).padStart(5)}  createdAt MINTED, updatedAt MINTED`);
  console.log(`  CONTENT_UPDATE ${String(contentChanged.length).padStart(5)}  createdAt PRESERVED, updatedAt advances (business content changed)`);
  console.log(`  METADATA_ONLY  ${String(markerOnly.length).padStart(5)}  createdAt PRESERVED, updatedAt PRESERVED (marker version only)`);
  console.log("  no existing createdAt or updatedAt is replaced by this upgrade.");
  console.log("");
  const evidence = {
    target: target.projectId, version: world.version,
    expected: records.length, identical, missing: missing.length, differing: changed.length,
    orphaned, applied: Boolean(target.apply),
    timestampTreatment: {
      NEW_RECORD: missing.length,
      CONTENT_UPDATE: contentChanged.length,
      METADATA_ONLY: markerOnly.length,
      existingStampsReplaced: 0,
    },
    contentChangedIds: contentChanged.map((c) => `${c.r.collection}/${c.r.id}`),
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
      // CERT-UPGRADE-PROVENANCE-03. The record is written with merge, and this field was NOT among
      // the keys it set -- so an additive upgrade advanced datasetVersion and fingerprint while
      // leaving the PREVIOUS version's commit in place. The record would then assert that 1.8.0 came
      // from the commit that built 1.7.0: a provenance claim that is precisely, checkably false, in
      // the one document whose entire job is to say where the installed world came from.
      repoCommit: repoCommit(),
    }, { merge: true });
    console.log(`deployment record updated to ${world.version} (fingerprint ${fp.hash})`);
    evidence.written = written;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "world-additive-upgrade.json");
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`evidence   : ${path.relative(REPO, file)}`);
}
