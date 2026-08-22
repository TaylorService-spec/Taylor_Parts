#!/usr/bin/env node
// DATA-CONTRACT PARITY — is the INSTALLED world logically equivalent to the EXPECTED one?
//
// ============================ THE QUESTION THIS ANSWERS ============================
//
// The sandbox reports VERSION_MISMATCH: its records carry the 1.1.0 marker, the repository expects
// 1.2.0. That is truthful and must stay visible. But it is a LABEL comparison, and it cannot tell
// you the thing an operator actually wants to know:
//
//   the 1.2.0 corrections were applied to the live world by bounded backfill.
//   Is the live data now equivalent to what a clean 1.2.0 seed would produce?
//
// Those are different questions. A world can carry the right label and the wrong data, or -- as
// here -- the wrong label and the right data. Only one of them is checkable by comparing content.
//
// ============================ WHAT IT DOES NOT DO ============================
//
// It does NOT rewrite the version marker. Changing a label to match a claim, rather than changing
// the data to match a contract, is how a fixture system starts lying about what it contains -- the
// exact failure the version bump existed to prevent. The marker is moved by a real seed, and by
// nothing else.
//
// Volatile fields are excluded via state.mjs's own declared list, so the comparison is over the
// parts that must match rather than the parts that legitimately differ per write.
//
// READ-ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { buildWorld } = await import(L("functions/scripts/certificationWorld/build.mjs"));
const { stableShape, VOLATILE_FIELDS } = await import(L("functions/scripts/certificationWorld/state.mjs"));
const { MARKER_FIELD } = await import(L("functions/scripts/certificationWorld/manifest.mjs"));
const { ENVIRONMENT_ACTIVATION_REGISTRY } = await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const PROJECT_ID = flag("--projectId");

function assertKnown(projectId) {
  if (!projectId) throw new Error("--projectId is required.");
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || []).find((e) => e?.firebase?.projectId === projectId);
  if (!env) throw new Error(`Unknown project "${projectId}". Refusing.`);
  return { projectId, role: env.role };
}

/** Field-level differences between two records, volatile fields already stripped. */
function diffRecord(expected, actual) {
  const out = [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of keys) {
    // The version marker is EXPECTED to differ -- that is the whole premise. Comparing it would
    // report the one difference already known and drown the ones that are not.
    if (k === MARKER_FIELD) continue;
    const e = JSON.stringify(expected[k]);
    const a = JSON.stringify(actual[k]);
    if (e !== a) out.push({ field: k, expected: expected[k], actual: actual[k] });
  }
  return out;
}

async function main() {
  const target = assertKnown(PROJECT_ID);
  console.log(`target: ${target.projectId} (role=${target.role})\n`);
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  const world = buildWorld();
  const expected = new Map();
  for (const r of [...world.accounts, ...world.locations, ...world.contacts,
                   ...world.equipmentModels, ...world.trucks, ...world.employees]) {
    expected.set(`${r.collection}/${r.id}`, r.data);
  }

  const collections = [...new Set([...expected.keys()].map((k) => k.split("/")[0]))];
  let compared = 0, identical = 0, missing = 0, extra = 0;
  const differing = [];
  const seen = new Set();

  for (const collection of collections) {
    const snap = await db.collection(collection).get();
    for (const doc of snap.docs) {
      const key = `${collection}/${doc.id}`;
      const exp = expected.get(key);
      const live = doc.data();
      if (!exp) {
        // Only counted when it carries the marker: unrelated records in a shared collection are not
        // this world's business.
        if (live[MARKER_FIELD]) extra += 1;
        continue;
      }
      seen.add(key);
      compared += 1;
      const d = diffRecord(stableShape(exp), stableShape(live));
      if (d.length === 0) identical += 1;
      else differing.push({ key, diffs: d });
    }
  }
  for (const key of expected.keys()) if (!seen.has(key)) missing += 1;

  // The INSTALLED label, read from the records themselves rather than from the state document --
  // the state doc records what a seed intended; the records are what is actually there.
  const installedVersions = new Set();
  for (const collection of collections) {
    const snap = await db.collection(collection).where(`${MARKER_FIELD}.version`, "!=", null).limit(50).get().catch(() => null);
    if (snap) for (const d of snap.docs) installedVersions.add(d.data()?.[MARKER_FIELD]?.version);
  }

  console.log(`REPO DATASET VERSION      : ${world.version}`);
  console.log(`LIVE INSTALLED VERSION    : ${[...installedVersions].filter(Boolean).join(", ") || "(none found)"}`);
  console.log(`volatile fields excluded  : ${VOLATILE_FIELDS.map((v) => v.field).join(", ")}\n`);

  console.log(`expected records          : ${expected.size}`);
  console.log(`compared                  : ${compared}`);
  console.log(`identical (content)       : ${identical}`);
  console.log(`differing                 : ${differing.length}`);
  console.log(`missing from live         : ${missing}`);
  console.log(`extra marked in live      : ${extra}`);

  if (differing.length) {
    console.log(`\nfirst differences:`);
    for (const d of differing.slice(0, 10)) {
      console.log(`  ${d.key}`);
      for (const f of d.diffs.slice(0, 4)) {
        console.log(`     ${f.field}: expected ${JSON.stringify(f.expected)} / live ${JSON.stringify(f.actual)}`);
      }
    }
    if (differing.length > 10) console.log(`  ... and ${differing.length - 10} more records`);
  }

  const compliant = differing.length === 0 && missing === 0;
  console.log(`\nLIVE DATA CONTRACT COMPLIANCE: ${compliant ? "EQUIVALENT" : "NOT EQUIVALENT"}`);
  if (compliant) {
    console.log(`The installed world's CONTENT matches the ${world.version} contract on every non-volatile field.`);
    console.log(`The version MARKER still reads ${[...installedVersions].filter(Boolean).join(", ") || "?"}, which is truthful:`);
    console.log(`these records were seeded at that version and corrected in place, not seeded at ${world.version}.`);
    console.log(`VERSION_MISMATCH stays visible until a real seed moves the marker.`);
  }
  if (!compliant) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`\nFAILED: ${err?.message || err}`);
    process.exitCode = 1;
  });
}
