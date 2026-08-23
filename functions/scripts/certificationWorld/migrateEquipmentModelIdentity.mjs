#!/usr/bin/env node
// BOUNDED MIGRATION — certification equipment models onto their canonical registry identity.
//
// ============================ WHAT IS WRONG, AND WHY IT MATTERS ============================
//
// `equipment_models` belongs to the Equipment Compatibility registry, where the document id IS the
// domain identity: `TAYLOR--C713`. The certification builder minted `cw-model-taylor-c713` instead,
// in a record shape the registry's own validator refuses on its first check (`unknown_field`),
// before it even looks at the id. 48 documents, and 278 equipment records pointing at them.
//
// The back-references are therefore ALREADY structurally invalid live. They resolve to documents
// that exist, which is why nothing has complained -- but no consumer has ever read one THROUGH the
// registry, and the first that does will be refused. Leaving it because a screen currently renders
// something is exactly the reasoning that let it survive this long.
//
// ============================ WHY A MIGRATION AND NOT A REBUILD ============================
//
// A Certification World rebuild is destructive and is explicitly forbidden. It would also be a far
// larger action than the defect: nothing is wrong with the 278 equipment records except ONE FIELD.
// So this rewrites that field and nothing else.
//
// ============================ WHAT IT WILL NOT TOUCH ============================
//
// Equipment ids, serials, customers, locations, install dates, warranty, status, service history.
// The write is a single-field update built by name, never a document replacement, so there is no
// path by which an unrelated field could be lost.
//
// ============================ ORDER IS THE SAFETY PROPERTY ============================
//
// Create canonical models -> verify each through the registry's own validator -> rewrite the
// back-references -> re-read all 278 through the registry -> and only then delete legacy documents,
// and only those with zero remaining references. At no point does an equipment record point at
// nothing: the canonical target exists before anything is repointed, and the legacy document still
// exists until nothing needs it.
//
// If ANY equipment record cannot be mapped deterministically, the run applies ZERO. A partial
// migration of an identity field is worse than none -- it splits the fleet across two identity
// schemes with no record of which is which.
//
// Run:
//   node scripts/certificationWorld/migrateEquipmentModelIdentity.mjs --projectId eos-platform-sandbox
//   node scripts/certificationWorld/migrateEquipmentModelIdentity.mjs --projectId eos-platform-sandbox --apply --apply-live-sandbox
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { buildWorld } = await import(L("functions/scripts/certificationWorld/build.mjs"));
const { modelFromFirestore } = await import(L("functions/lib/equipmentCompatibility/equipmentModelRepository.js"));
const { isCanonicalEquipmentModelId } =
  await import(L("functions/lib/equipmentCompatibility/domain/equipmentModel.js"));

const MODELS = "equipment_models";
const EQUIPMENT = "equipment";
const MIGRATION_AUTHOR = "certification-model-identity-migration";
// The certification marker. Its PRESENCE is what makes a record this migration's business.
const MARKER_FIELD = "certificationWorld";
const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");

// ── The execution boundary. Nothing below runs until this passes. ──────────────────────────────
//
// Gated on being the ENTRY POINT. buildMapping is the part worth testing, and a module that resolved
// an execution target merely by being imported would make its own test suite a run of the tool.
const INVOKED_DIRECTLY = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (INVOKED_DIRECTLY) {
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
    console.log("");
    await main(target);
  }
}

/**
 * The mapping, derived from the fixture rather than from the live data.
 *
 * Deriving it from what is live would be circular: the live ids are the defect, and a rule inferred
 * from them would reproduce whatever they encode. buildWorld() knows what each model IS, and
 * build.mjs already mints each model's canonical id through the ONE derivation
 * (equipmentMasters.canonicalEquipmentModelId), so the record's own id IS the target.
 */
function buildMapping() {
  const world = buildWorld();
  const legacySlug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const byLegacyId = new Map();
  const canonical = new Map();
  for (const record of world.equipmentModels) {
    const legacyId = `cw-model-${legacySlug(record.data.manufacturerName)}-${legacySlug(record.data.modelNumber)}`;
    byLegacyId.set(legacyId, record.id);
    canonical.set(record.id, record);
  }
  return { world, byLegacyId, canonical };
}

async function main(t) {
  if (!getApps().length) {
    initializeApp(t.isEmulator ? { projectId: t.projectId }
      : { credential: applicationDefault(), projectId: t.projectId });
  }
  const report = await runMigration({ db: getFirestore(), apply: t.apply, log: console.log });
  if (report.outcome !== "APPLIED" && report.outcome !== "DRY_RUN") process.exitCode = 1;
  writeEvidence({ target: t.projectId, ...report });
  return report;
}

/**
 * The migration itself, against any Firestore-shaped database.
 *
 * Takes `db` rather than reaching for one, and RETURNS a report rather than only printing: a
 * migration whose only output is console text can be exercised but not asserted, and this one runs
 * against live records.
 */
export async function runMigration({ db, apply = false, log = () => {} }) {
  const { world, byLegacyId, canonical } = buildMapping();

  log(`fixture    : ${canonical.size} canonical models, ${world.equipment.length} equipment records`);

  // ── PREFLIGHT 1. The live models. ────────────────────────────────────────────────────────────
  const liveModels = await db.collection(MODELS).get();
  const liveById = new Map(liveModels.docs.map((d) => [d.id, d.data()]));
  const legacyLive = [...liveById.keys()].filter((id) => !isCanonicalEquipmentModelId(id));
  const canonicalLive = [...liveById.keys()].filter((id) => isCanonicalEquipmentModelId(id));
  log(`live models: ${liveById.size} (${canonicalLive.length} canonical, ${legacyLive.length} legacy)`);

  const unmappedLegacy = legacyLive.filter((id) => !byLegacyId.has(id));
  const toCreate = [...canonical.keys()].filter((id) => !liveById.has(id));

  // ── PREFLIGHT 2. Every equipment record, and where its model reference points. ───────────────
  //
  // Read by document, not by query on the model field: a record MISSING the field would be excluded
  // by any where() clause, and "invisible to the query" is precisely how a record escapes a
  // migration and stays broken.
  const liveEquipment = await db.collection(EQUIPMENT).get();
  const plan = [];
  const unresolved = [];
  const outOfScope = [];
  let alreadyCanonical = 0;
  for (const doc of liveEquipment.docs) {
    const data = doc.data();
    const current = data.equipmentModelId;
    const isCertification = Boolean(data[MARKER_FIELD]);
    const hasModelRef = typeof current === "string" && current !== "";

    // OUT OF SCOPE IS NOT THE SAME AS UNMAPPABLE, and conflating them would either block this
    // migration forever or let a broken record slip through it.
    //
    // The sandbox holds equipment that predates the certification world AND predates the
    // equipment-model link entirely -- eq-cool-001, eq-ice-001, five hand-made C713 rows. They carry
    // no model reference at all, so they have no back-reference to fix and cannot be left
    // half-migrated. Inventing one would mint a model link nobody established.
    //
    // A CERTIFICATION record missing the field is a different thing entirely: it is a record this
    // migration owns, that lost its reference, and that any where() query would skip. That still
    // blocks.
    if (!isCertification && !hasModelRef) {
      outOfScope.push({ id: doc.id, why: "not a certification record and carries no model reference" });
      continue;
    }
    if (!hasModelRef) {
      unresolved.push({ id: doc.id, current: current ?? null, why: "certification record with no equipmentModelId to map" });
      continue;
    }
    if (canonical.has(current)) { alreadyCanonical += 1; continue; }
    const mapped = byLegacyId.get(current);
    if (!mapped) {
      unresolved.push({ id: doc.id, current, why: "not a known certification model id" });
      continue;
    }
    // An UNMARKED record pointing at a certification model is claiming this world's identity without
    // this world's marker. Migrating it would quietly adopt a record nobody said belongs here.
    if (!isCertification) {
      unresolved.push({ id: doc.id, current, why: "carries a certification model id but not the certification marker" });
      continue;
    }
    plan.push({ id: doc.id, from: current, to: mapped });
  }

  // ── PREFLIGHT 3. Which legacy documents would become unreferenced. ───────────────────────────
  const stillReferenced = new Set();
  for (const doc of liveEquipment.docs) {
    const current = doc.data().equipmentModelId;
    if (typeof current === "string" && !canonical.has(current)) stillReferenced.add(current);
  }
  const toDelete = legacyLive.filter((id) => byLegacyId.has(id));

  // ── COLLISIONS. Two legacy ids mapping to one canonical id would silently merge two models. ───
  const collisions = [];
  const seenTargets = new Map();
  for (const [legacyId, canonicalId] of byLegacyId) {
    if (seenTargets.has(canonicalId)) collisions.push({ canonicalId, from: [seenTargets.get(canonicalId), legacyId] });
    else seenTargets.set(canonicalId, legacyId);
  }

  log("");
  log("── DRY RUN ────────────────────────────────────────────────────────────────");
  log(`invalid legacy model docs   : ${legacyLive.length}`);
  log(`canonical models to create  : ${toCreate.length}`);
  log(`equipment to repoint        : ${plan.length}`);
  log(`equipment already canonical : ${alreadyCanonical}`);
  log(`unresolved equipment        : ${unresolved.length}`);
  log(`out of scope (not this world): ${outOfScope.length}`);
  log(`mapping collisions          : ${collisions.length}`);
  log(`legacy models to delete     : ${toDelete.length}`);
  log(`unmapped legacy live models : ${unmappedLegacy.length}`);
  for (const u of unresolved.slice(0, 20)) log(`  UNRESOLVED ${u.id}: ${String(u.current)} -- ${u.why}`);
  // Named individually, never summarised away. A migration that silently skipped records would look
  // identical to one that covered everything.
  for (const o of outOfScope) log(`  OUT OF SCOPE ${o.id}: ${o.why}`);
  for (const c of collisions) log(`  COLLISION  ${c.canonicalId} <- ${c.from.join(", ")}`);
  for (const id of unmappedLegacy.slice(0, 20)) log(`  UNMAPPED   ${id}`);

  // ── THE REFUSAL. Any unresolved record, any collision -> APPLY 0. ────────────────────────────
  const blocked = unresolved.length > 0 || collisions.length > 0 || unmappedLegacy.length > 0;
  if (blocked) {
    log("");
    log("BLOCKED: not every record maps deterministically. APPLY 0.");
    log("A partially migrated identity field splits the fleet across two schemes with no");
    log("record of which is which, which is worse than the defect it would half-fix.");
    return { outcome: "BLOCKED", unresolved, outOfScope, collisions, unmappedLegacy, created: 0, repointed: 0, deleted: 0 };
  }

  if (!apply) {
    log("");
    log("DRY RUN ONLY -- nothing written. Re-run with --apply --apply-live-sandbox to execute.");
    return { outcome: "DRY_RUN", toCreate, plan, toDelete, alreadyCanonical, outOfScope, created: 0, repointed: 0, deleted: 0 };
  }

  // ── STEP 1. Canonical models exist BEFORE anything is repointed. ─────────────────────────────
  let created = 0;
  for (let i = 0; i < toCreate.length; i += 400) {
    const batch = db.batch();
    for (const id of toCreate.slice(i, i + 400)) {
      batch.set(db.collection(MODELS).doc(id), {
        createdAt: FieldValue.serverTimestamp(), createdBy: MIGRATION_AUTHOR,
        updatedAt: FieldValue.serverTimestamp(), updatedBy: MIGRATION_AUTHOR,
        ...canonical.get(id).data,
      }, { merge: true });
    }
    await batch.commit();
    created += Math.min(400, toCreate.length - i);
  }
  log(`created    : ${created} canonical model documents`);

  // ── STEP 2. Verify each through the REGISTRY'S OWN reader before trusting it as a target. ────
  //
  // Not a field checklist. modelFromFirestore is what a consumer calls, and it enforces things the
  // fixture cannot assert about itself -- that the stored id equals the document id, and that the id
  // is canonical in its own right.
  const modelFailures = [];
  for (const id of canonical.keys()) {
    const snap = await db.collection(MODELS).doc(id).get();
    if (!snap.exists) { modelFailures.push({ id, why: "missing after create" }); continue; }
    try { modelFromFirestore(id, snap.data()); } catch (err) { modelFailures.push({ id, why: err.message }); }
  }
  if (modelFailures.length > 0) {
    log("");
    log(`STOPPED after step 1: ${modelFailures.length} canonical models do not read back valid.`);
    for (const f of modelFailures.slice(0, 10)) log(`  ${f.id}: ${f.why}`);
    log("No equipment record was repointed. The legacy documents are untouched.");
    return { outcome: "STOPPED_MODELS_INVALID", modelFailures, created, repointed: 0, deleted: 0 };
  }
  log(`verified   : ${canonical.size}/${canonical.size} canonical models read back through the registry`);

  // ── STEP 3. Rewrite ONE FIELD on each equipment record. ─────────────────────────────────────
  let repointed = 0;
  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const row of plan.slice(i, i + 400)) {
      // update(), not set(): a single named field. There is no shape here that could drop another.
      batch.update(db.collection(EQUIPMENT).doc(row.id), {
        equipmentModelId: row.to,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: MIGRATION_AUTHOR,
      });
    }
    await batch.commit();
    repointed += Math.min(400, plan.length - i);
  }
  log(`repointed  : ${repointed} equipment back-references`);

  // ── STEP 4. Re-read EVERY equipment record and resolve its model through the registry. ───────
  const after = await db.collection(EQUIPMENT).get();
  const dangling = [];
  let resolved = 0;
  const modelCache = new Map();
  const outOfScopeIds = new Set(outOfScope.map((o) => o.id));
  for (const doc of after.docs) {
    if (outOfScopeIds.has(doc.id)) continue;   // never had a model reference; still does not
    const id = doc.data().equipmentModelId;
    if (typeof id !== "string" || !canonical.has(id)) { dangling.push({ id: doc.id, ref: id ?? null }); continue; }
    if (!modelCache.has(id)) {
      const snap = await db.collection(MODELS).doc(id).get();
      modelCache.set(id, snap.exists ? snap.data() : null);
    }
    const data = modelCache.get(id);
    if (data === null) { dangling.push({ id: doc.id, ref: id }); continue; }
    try { modelFromFirestore(id, data); resolved += 1; }
    catch (err) { dangling.push({ id: doc.id, ref: id, why: err.message }); }
  }
  log(`resolved   : ${resolved}/${after.size - outOfScope.length} in-scope equipment records resolve through the registry`);
  if (dangling.length > 0) {
    log("");
    log(`STOPPED before deletion: ${dangling.length} equipment records still do not resolve.`);
    for (const d of dangling.slice(0, 10)) log(`  ${d.id} -> ${String(d.ref)} ${d.why ?? ""}`);
    log("Legacy model documents are LEFT IN PLACE -- deleting them now would strand these.");
    return { outcome: "STOPPED_DANGLING", dangling, created, repointed, deleted: 0 };
  }

  // ── STEP 5. Only now, and only what nothing references. ─────────────────────────────────────
  const referencedAfter = new Set(after.docs.map((d) => d.data().equipmentModelId).filter((v) => typeof v === "string"));
  const safeToDelete = toDelete.filter((id) => !referencedAfter.has(id));
  const heldBack = toDelete.filter((id) => referencedAfter.has(id));
  let deleted = 0;
  for (let i = 0; i < safeToDelete.length; i += 400) {
    const batch = db.batch();
    for (const id of safeToDelete.slice(i, i + 400)) batch.delete(db.collection(MODELS).doc(id));
    await batch.commit();
    deleted += Math.min(400, safeToDelete.length - i);
  }
  log(`deleted    : ${deleted} superseded legacy model documents${heldBack.length ? ` (${heldBack.length} held back -- still referenced)` : ""}`);

  log("");
  log("MIGRATION COMPLETE");
  return { outcome: "APPLIED", created, repointed, resolved, deleted, heldBack, outOfScope, total: after.size, inScope: after.size - outOfScope.length };
}

function writeEvidence(payload) {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "equipment-model-identity-migration.json");
  writeFileSync(file, JSON.stringify({ ...payload, generatedFrom: "migrateEquipmentModelIdentity.mjs" }, null, 2) + "\n");
  console.log(`evidence   : ${path.relative(REPO, file)}`);
}

export { buildMapping };
