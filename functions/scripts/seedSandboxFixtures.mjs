// PRODUCTION-DERIVED OPERATIONAL FIXTURES — governed SANDBOX importer/seeder.
//
// Consumes the sanitized fixture artifact (from extractProductionFixtures.mjs) and seeds it into a SANDBOX
// environment, deterministically and idempotently.
//
// HARD SAFETY (Owner + existing seed pattern):
//   - REFUSES production: registry role must be 'sandbox'; refuses 'taylor-parts' and unknown projects.
//   - Requires --projectId (no default target).
//   - Validates relationship closure (dangling required refs -> FAIL CLOSED) before any write.
//   - Fails closed on identity/schema mismatch (docIdIsId collections: the identity field must equal the
//     doc id we write).
//   - Idempotent: writes at deterministic doc ids (docIdIsId -> identity; composite -> a stable synthetic
//     key), via set(); re-running is safe. Never deletes unrelated sandbox state.
//   - --dry-run reports exactly what it will seed and writes nothing.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { COLLECTIONS } from "./fixtures/fixtureSpec.mjs";
import { validateClosure } from "./fixtures/relationshipClosure.mjs";
import { assertPartIdentityIntact } from "./fixtures/idMapping.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- guards (pure, exported for tests) --------------------------------------------------------------
export function loadRegistry() {
  return JSON.parse(readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
}

// Reuses the established seed guard: refuse production by registry role, refuse taylor-parts explicitly,
// refuse unknown projects, require --projectId. Returns the resolved sandbox env.
export function assertSandboxTarget(projectId, registry) {
  if (!projectId || projectId === "true") throw new Error("--projectId is required. No default target.");
  if (projectId === "taylor-parts") throw new Error("REFUSING: taylor-parts is the customer production project.");
  const env = (registry.environments || []).find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not a known provisioned environment. Unknown projects fail closed.`);
  if (env.role === "production") throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  if (env.role !== "sandbox") throw new Error(`REFUSING: environment '${env.id}' has role '${env.role}', not sandbox.`);
  return env;
}

// Stable synthetic doc id for a composite-keyed (docIdIsId:false) collection, from its required-ref fields +
// any binCode/type discriminators — deterministic so re-import is idempotent.
function compositeDocId(collection, rec) {
  const refs = (COLLECTIONS[collection].refs || []).map((r) => rec[r.field]).filter((v) => v != null);
  const extra = [rec.binCode, rec.aliasType, rec.aliasValue, rec.aliasKey, rec.compatibilityType, rec.type].filter((v) => v != null);
  const basis = [...refs, ...extra].map(String).join("|");
  const h = createHash("sha256").update(`${collection}|${basis}`).digest("hex").slice(0, 16);
  return `fx-${collection}-${h}`;
}

// Pure plan: for each collection, compute the (docId, record) writes + validate identity/schema. Throws on
// a docIdIsId collection whose identity field is missing. Returns { writes: [{collection, docId, record}], total }.
export function planSeed(fixtureSet) {
  const writes = [];
  for (const [collection, records] of Object.entries(fixtureSet)) {
    const spec = COLLECTIONS[collection];
    if (!spec) throw new Error(`Unknown collection "${collection}" in fixture set — fail closed.`);
    for (const rec of records || []) {
      let docId;
      if (spec.docIdIsId) {
        const id = rec[spec.idField];
        if (id == null || String(id).length === 0) throw new Error(`${collection}: record missing identity field "${spec.idField}" — fail closed.`);
        docId = String(id);
      } else {
        docId = compositeDocId(collection, rec);
      }
      writes.push({ collection, docId, record: rec });
    }
  }
  return { writes, total: writes.length };
}

export function loadFixtureSet(artifactDir) {
  const dir = path.join(artifactDir, "fixtures");
  const set = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    set[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  }
  return set;
}

// ---- seeding (I/O) ----------------------------------------------------------------------------------
async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i].startsWith("--")) { const k = process.argv[i].slice(2); const nxt = process.argv[i + 1]; args[k] = nxt && !nxt.startsWith("--") ? nxt : true; }
  }
  const registry = loadRegistry();
  const env = assertSandboxTarget(args.projectId, registry);
  const artifactDir = typeof args.artifact === "string" ? args.artifact : "./_fixture-export";
  const dryRun = args["dry-run"] === true;

  const fixtureSet = loadFixtureSet(artifactDir);
  assertPartIdentityIntact(fixtureSet.parts || []);
  const closure = validateClosure(fixtureSet);
  if (!closure.ok) {
    console.error("FAIL CLOSED: dangling required references:");
    for (const d of closure.danglingRequired) console.error(`  ${d.from}.${d.field} -> ${d.to}:${d.value} MISSING`);
    process.exit(1);
  }
  const { writes, total } = planSeed(fixtureSet);

  const byCollection = writes.reduce((m, w) => ((m[w.collection] = (m[w.collection] || 0) + 1), m), {});
  console.log(`Fixture seed plan for '${env.id}' (${args.projectId}) — ${total} docs:`);
  for (const [c, n] of Object.entries(byCollection)) console.log(`  ${c}: ${n}`);
  console.log(`Relationship closure: OK (0 dangling required).`);
  if (dryRun) { console.log("--dry-run: no writes performed."); return; }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();
  let n = 0;
  for (const w of writes) {
    await db.collection(w.collection).doc(w.docId).set({ ...w.record, __fixture: "operational-fixtures-v1" }, { merge: true });
    n += 1;
  }
  console.log(`Seeded ${n} fixture docs (idempotent set/merge; no unrelated deletes).`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seedSandboxFixtures.mjs")) {
  main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
