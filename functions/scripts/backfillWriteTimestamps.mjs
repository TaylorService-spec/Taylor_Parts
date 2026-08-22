#!/usr/bin/env node
// BACKFILL WRITE TIMESTAMPS onto records that were seeded without them.
//
// ============================ THE BUG THIS REPAIRS ============================
//
// Firestore's `orderBy` does not merely sort -- it FILTERS. A document missing the ordered field is
// silently excluded from the result set, with no error and no indication that anything was left
// out. The Customers list sorts `updatedAt DESC`, and the Certification World seeder wrote its
// records with no `updatedAt` at all, so 101 of 103 customers were dropped from their own list
// while the portfolio header -- a different read, which does not sort -- still counted all 103.
//
// A list quietly missing 94% of its rows looks exactly like a list of that size. Nothing about two
// rows says "there are a hundred more".
//
// ============================ THIS IS THE SECOND HALF OF THE FIX ============================
//
// The FIRST half is in scripts/certificationWorld.mjs: `writeRecords` now stamps both timestamps,
// so a future rebuild cannot reintroduce this. Without that, this script repairs the data once and
// the next rebuild breaks it again.
//
// This half repairs the records that ALREADY exist, because they will not be rewritten until
// someone chooses to rebuild the world, and the customers are missing from the list today.
//
// ============================ WHAT VALUE GETS WRITTEN, AND WHY ============================
//
// `updatedAt` is a factual claim about when a record was last written. Filling it with a convenient
// value would replace an honest absence with a dishonest presence, which is a worse bug than the
// one being fixed -- it would tell an operator that every customer was touched today.
//
// So the value is derived, in this order:
//
//   1. An existing `createdAt` on the document. The record has not been modified since it was
//      created, so its creation instant IS its last-write instant. This is the truthful answer and
//      it is preferred wherever the document can supply it.
//
//   2. Otherwise, the server timestamp of THIS write. Not a guess and not a placeholder: this
//      script is itself a write to the document, so the moment it runs genuinely is the moment the
//      record was last written. `state.mjs` already classifies both fields as volatile -- "server
//      timestamp on records written through Admin SDK helpers" -- which is exactly this.
//
// Everything written is a Firestore Timestamp. Firestore orders mixed types by TYPE first, so a
// numeric `updatedAt` beside a Timestamp one would sort into a separate block ahead of every real
// date -- trading an invisible bug for a subtler one.
//
// ============================ SAFETY ============================
//
//   * DRY RUN BY DEFAULT. Writes only with --apply.
//   * SANDBOX ONLY. Production is refused unconditionally; there is no override flag, because a
//     flag that can authorize production is a flag that can be typed by mistake.
//   * IDEMPOTENT. Only documents MISSING the field are touched, so a second run changes nothing.
//   * NON-DESTRUCTIVE. A merge write of one or two absent fields. No existing value is replaced --
//     a document that already has `updatedAt` is skipped entirely rather than "corrected".
//
// Usage:
//   node scripts/backfillWriteTimestamps.mjs --projectId eos-platform-sandbox
//   node scripts/backfillWriteTimestamps.mjs --projectId eos-platform-sandbox --apply
//   node scripts/backfillWriteTimestamps.mjs --projectId eos-platform-sandbox --collection locations
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { ENVIRONMENT_ACTIVATION_REGISTRY } = await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes("--apply");
const PROJECT_ID = flag("--projectId");
const COLLECTION = flag("--collection") || "accounts";
const SORT_FIELD = "updatedAt";

/**
 * Sandbox target assertion. Deliberately identical in spirit to provisionPrincipals.mjs: no
 * default, no production, no escape hatch.
 */
function assertSandboxTarget(projectId) {
  if (!projectId) {
    throw new Error("--projectId is required. There is no default target for a data backfill.");
  }
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || [])
    .find((e) => e?.firebase?.projectId === projectId);
  if (!env) {
    throw new Error(`Unknown project "${projectId}" -- not present in config/environments.json. Refusing.`);
  }
  if (env.role === "production") {
    throw new Error(`"${projectId}" is a PRODUCTION environment. This tool never writes production data.`);
  }
  if (env.role !== "sandbox") {
    throw new Error(`"${projectId}" has role "${env.role}". Only sandbox environments may be backfilled.`);
  }
  return { projectId, role: env.role };
}

/**
 * Read an existing creation instant, whatever shape it was stored in.
 *
 * Returns a Timestamp, or null when the document cannot honestly supply one. Returning null is a
 * real answer here -- it routes the document to the server-timestamp branch rather than inventing
 * a date from nothing.
 */
function creationInstant(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value.toDate === "function") return value;
  // Epoch milliseconds. Bounded deliberately: a plausible-looking number that is actually seconds,
  // or a sentinel like 0, would otherwise be written as a confident date in 1970.
  if (typeof value === "number" && Number.isFinite(value) && value > 946_684_800_000) {
    return Timestamp.fromMillis(value);
  }
  return null;
}

const SOURCE = Object.freeze({
  FROM_CREATED_AT: "FROM_CREATED_AT",
  SERVER_NOW: "SERVER_NOW",
});

async function main() {
  const target = assertSandboxTarget(PROJECT_ID);
  console.log(`target      : ${target.projectId} (role=${target.role})`);
  console.log(`collection  : ${COLLECTION}`);
  console.log(`mode        : ${APPLY ? "APPLY (writes)" : "DRY RUN (writes nothing)"}\n`);

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  const snap = await db.collection(COLLECTION).get();
  const plan = [];
  let alreadyHave = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data[SORT_FIELD] !== undefined && data[SORT_FIELD] !== null) { alreadyHave += 1; continue; }
    const created = creationInstant(data.createdAt);
    plan.push({
      id: doc.id,
      name: data.name ?? "(unnamed)",
      source: created ? SOURCE.FROM_CREATED_AT : SOURCE.SERVER_NOW,
      created,
      // Only fill createdAt when the document has nothing usable. An existing value is never
      // rewritten, even when it is a number rather than a Timestamp -- reshaping a field this
      // script was not asked to touch is how a backfill turns into a migration.
      alsoCreatedAt: data.createdAt === undefined || data.createdAt === null,
    });
  }

  const bySource = plan.reduce((acc, p) => { acc[p.source] = (acc[p.source] || 0) + 1; return acc; }, {});
  console.log(`${snap.size} document(s) in ${COLLECTION}`);
  console.log(`  already have ${SORT_FIELD} : ${alreadyHave}  (untouched)`);
  console.log(`  MISSING ${SORT_FIELD}      : ${plan.length}`);
  for (const [s, n] of Object.entries(bySource).sort()) console.log(`      ${String(n).padStart(4)}  ${s}`);

  if (plan.length === 0) {
    console.log(`\nNothing to do -- every document already carries ${SORT_FIELD}.`);
    return;
  }

  console.log(`\nsample of the planned writes:`);
  for (const p of plan.slice(0, 5)) {
    const val = p.source === SOURCE.FROM_CREATED_AT ? p.created.toDate().toISOString() : "<server timestamp at write>";
    console.log(`  ${p.id.padEnd(24)} ${String(p.name).slice(0, 28).padEnd(30)} ${SORT_FIELD}=${val}${p.alsoCreatedAt ? " (+createdAt)" : ""}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN -- nothing was written. Re-run with --apply to perform ${plan.length} write(s).`);
    return;
  }

  let written = 0;
  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 400)) {
      const patch = { [SORT_FIELD]: p.created ?? FieldValue.serverTimestamp() };
      if (p.alsoCreatedAt) patch.createdAt = p.created ?? FieldValue.serverTimestamp();
      batch.set(db.collection(COLLECTION).doc(p.id), patch, { merge: true });
    }
    await batch.commit();
    written += Math.min(400, plan.length - i);
    console.log(`  committed ${written}/${plan.length}`);
  }

  // ── PROVE IT, by running the query the LIST runs.
  //
  // A write that succeeded is not evidence the list recovered. `orderBy` is what was excluding
  // these documents, so the only honest check re-issues that exact ordered read and counts what
  // comes back -- the same question the screen asks.
  const ordered = await db.collection(COLLECTION).orderBy(SORT_FIELD, "desc").get();
  console.log(`\nverification -- the ordered read the list issues:`);
  console.log(`  orderBy(${SORT_FIELD}, desc) now returns ${ordered.size} of ${snap.size} document(s)`);
  if (ordered.size !== snap.size) {
    console.log(`  INCOMPLETE -- ${snap.size - ordered.size} document(s) are still excluded.`);
    process.exitCode = 1;
    return;
  }
  console.log(`  COMPLETE -- every document in ${COLLECTION} is now reachable through the sorted list.`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err?.message || err}`);
  process.exitCode = 1;
});
