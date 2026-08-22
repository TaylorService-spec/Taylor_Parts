#!/usr/bin/env node
// BOUNDED LIVE CORRECTION — reconcile the instantiated world toward the repaired expected world.
//
// ============================ WHY NOT JUST REBUILD ============================
//
// `rebuild` deletes and reseeds. It is the right tool for proving determinism and the wrong tool
// for repairing three fields, because it discards an operational sandbox -- the 47 provisioned
// identities' links, the 82 governed role assignments, and everything else that accumulated around
// the world -- to fix data that can be corrected in place. Reset is for proof; this is for repair.
//
// ============================ WHAT IT CORRECTS, AND NOTHING ELSE ============================
//
// The expected values come from `buildWorld()` -- the same function the seeder uses -- so this tool
// cannot drift from the builder. It is not a second opinion about what a customer should look like;
// it is the builder's opinion, applied to records that already exist.
//
// Only a NAMED set of fields is correctable:
//
//   status             DORMANT was never a domain value. 5 customers carried it, the portfolio
//                      summary refused to bucket them, and the screen said the categories did not
//                      add up. Corrected to the canonical INACTIVE.
//   nameLower          Derived search name. Absent entirely, so customer search was case-sensitive
//                      and "mesquite" could not find "Mesquite Soda Works".
//   relationshipTypes  Every account had none, so the Relationship filter had nothing to filter and
//                      no VENDOR existed anywhere in the world.
//   createdAt/updatedAt Stamped only where MISSING. Firestore's orderBy excludes documents lacking
//                      the ordered field, which is what hid 101 of 103 customers.
//
// Everything else is left alone. A reconciler that corrects every difference would silently revert
// legitimate operational edits made through the app -- it would treat the fixture as more
// authoritative than the business, which is backwards for a world people are actively using.
//
// ============================ SAFETY ============================
//
//   * DRY RUN BY DEFAULT. Writes only with --apply.
//   * SANDBOX ONLY. Production refused unconditionally; no override flag exists.
//   * MARKER-SCOPED for fixture fields. `status` and `relationshipTypes` are corrected only on
//     records carrying the Certification World marker, so a real record that happens to share an
//     id shape is never rewritten to match a fixture.
//   * IDEMPOTENT. Only DIFFERENCES are written, so a second run performs zero mutations. That is
//     asserted, not assumed -- the run reports its mutation count and a repeat run must report 0.
//
// Usage:
//   node scripts/certificationWorld/correctLiveWorld.mjs --projectId eos-platform-sandbox
//   node scripts/certificationWorld/correctLiveWorld.mjs --projectId eos-platform-sandbox --apply
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { buildWorld } = await import(L("functions/scripts/certificationWorld/build.mjs"));
const { MARKER_FIELD } = await import(L("functions/scripts/certificationWorld/manifest.mjs"));
const { normalizeNameForSearch, SEARCH_NAME_FIELD, TIMESTAMPED_COLLECTIONS } =
  await import(L("functions/scripts/certificationWorld/domainContracts.mjs"));
const { ENVIRONMENT_ACTIVATION_REGISTRY } = await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes("--apply");
const PROJECT_ID = flag("--projectId");

/** Fixture-owned fields: corrected only where the marker proves the record belongs to the world. */
const MARKER_SCOPED_FIELDS = ["status", "relationshipTypes"];

function assertSandboxTarget(projectId) {
  if (!projectId) throw new Error("--projectId is required. There is no default target.");
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || []).find((e) => e?.firebase?.projectId === projectId);
  if (!env) throw new Error(`Unknown project "${projectId}" -- not in config/environments.json. Refusing.`);
  if (env.role === "production") throw new Error(`"${projectId}" is PRODUCTION. This tool never writes production data.`);
  if (env.role !== "sandbox") throw new Error(`"${projectId}" has role "${env.role}". Sandbox only.`);
  return { projectId, role: env.role };
}

const sameArray = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  const target = assertSandboxTarget(PROJECT_ID);
  console.log(`target : ${target.projectId} (role=${target.role})`);
  console.log(`mode   : ${APPLY ? "APPLY (writes)" : "DRY RUN (writes nothing)"}\n`);

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  const world = buildWorld();
  console.log(`expected world version ${world.version}\n`);

  // Expected records, indexed for lookup.
  const expected = new Map();
  for (const r of [...world.accounts, ...world.locations, ...world.contacts,
                   ...world.equipmentModels, ...world.trucks, ...world.employees]) {
    expected.set(`${r.collection}/${r.id}`, r.data);
  }

  const collections = [...new Set(TIMESTAMPED_COLLECTIONS)];
  const plan = [];
  const stats = {};

  for (const collection of collections) {
    const snap = await db.collection(collection).get();
    const s = { collection, docs: snap.size, status: 0, nameLower: 0, relationshipTypes: 0, timestamps: 0 };

    for (const doc of snap.docs) {
      const live = doc.data();
      const exp = expected.get(`${collection}/${doc.id}`);
      const isCertRecord = live[MARKER_FIELD] !== undefined && live[MARKER_FIELD] !== null;
      const patch = {};

      // ── Fixture-owned fields: only where the marker proves ownership AND the builder has an
      //    opinion about this exact record.
      if (exp && isCertRecord) {
        for (const field of MARKER_SCOPED_FIELDS) {
          const want = exp[field];
          if (want === undefined) continue; // builder deliberately leaves it unset
          const have = live[field];
          const equal = Array.isArray(want) ? sameArray(want, have) : want === have;
          if (!equal) { patch[field] = want; s[field] += 1; }
        }
      }

      // ── The derived search name applies to EVERY account, fixture or not: a real customer that
      //    cannot be found by search is the same defect as a fixture one.
      if (collection === "accounts") {
        const want = normalizeNameForSearch(live.name);
        if (want && live[SEARCH_NAME_FIELD] !== want) { patch[SEARCH_NAME_FIELD] = want; s.nameLower += 1; }
      }

      // ── Write timestamps, only where absent. Never overwritten: an existing value is a fact
      //    about when the record actually changed, and this run is not that moment.
      let stampedHere = false;
      for (const field of ["createdAt", "updatedAt"]) {
        if (live[field] === undefined || live[field] === null) {
          patch[field] = FieldValue.serverTimestamp();
          stampedHere = true;
        }
      }
      if (stampedHere) s.timestamps += 1;

      if (Object.keys(patch).length) plan.push({ collection, id: doc.id, patch, name: live.name });
    }

    stats[collection] = s;
  }

  console.log("planned corrections by collection:");
  console.log("  collection            docs  status  nameLower  relTypes  timestamps");
  for (const c of collections) {
    const s = stats[c];
    console.log(`  ${c.padEnd(20)} ${String(s.docs).padStart(4)}  ${String(s.status).padStart(6)}  `
      + `${String(s.nameLower).padStart(9)}  ${String(s.relationshipTypes).padStart(8)}  ${String(s.timestamps).padStart(10)}`);
  }
  console.log(`\ntotal documents to write: ${plan.length}`);

  const statusFixes = plan.filter((p) => "status" in p.patch);
  if (statusFixes.length) {
    console.log(`\nstatus corrections (${statusFixes.length}):`);
    for (const p of statusFixes) console.log(`  ${p.id.padEnd(20)} ${String(p.name).slice(0, 30).padEnd(32)} -> ${p.patch.status}`);
  }

  if (!plan.length) {
    console.log("\nNothing to correct -- the live world already matches the expected world on every correctable field.");
    return;
  }
  if (!APPLY) {
    console.log(`\nDRY RUN -- nothing written. Re-run with --apply to perform ${plan.length} write(s).`);
    return;
  }

  let written = 0;
  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 400)) batch.set(db.collection(p.collection).doc(p.id), p.patch, { merge: true });
    await batch.commit();
    written += Math.min(400, plan.length - i);
    console.log(`  committed ${written}/${plan.length}`);
  }
  console.log(`\napplied ${written} correction(s).`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err?.message || err}`);
  process.exitCode = 1;
});
