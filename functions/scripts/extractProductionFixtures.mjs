// PRODUCTION-DERIVED OPERATIONAL FIXTURES — READ-ONLY extraction tool (OPERATOR-RUN).
//
// Reads a BOUNDED, representative subset of Parts / Inventory / Equipment from PRODUCTION, sanitizes each
// record INLINE (so raw production values never touch disk), closes required relationships, and writes a
// sandbox-safe fixture artifact + manifest to an operator-controlled local directory.
//
// HARD SAFETY (Owner):
//   - READS ONLY. Uses a db proxy that throws on any write method (set/add/update/delete/create/commit/...).
//   - Explicitly targets PRODUCTION and requires an explicit --confirm-production-read acknowledgment.
//   - NO embedded credentials; uses applicationDefault (the operator's ADC). NEVER uses the service-account
//     key sitting in Downloads (that credential should be rotated/revoked separately).
//   - Bounded: never exceeds MAX_PER_COLLECTION.
//   - Produces counts + a sha256 manifest + provenance.
//
// Claude does NOT run this. It is prepared for the authorized operator (see the handoff doc). Usage:
//   cd functions
//   node scripts/extractProductionFixtures.mjs --project taylor-parts --confirm-production-read --out ./_fixture-export --asOf 2026-08-07
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { COLLECTIONS, COLLECTION_NAMES, SELECTION_CRITERIA, MAX_PER_COLLECTION, FIXTURE_VERSION, collectionsForDomain, DOMAINS } from "./fixtures/fixtureSpec.mjs";
import { sanitizeRecord, SANITIZER_VERSION } from "./fixtures/sanitize.mjs";
import { sandboxId } from "./fixtures/idMapping.mjs";
import { requiredReferencedIds } from "./fixtures/relationshipClosure.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Collections seeded/selected in v1 (part_supplier_items / inventory_transactions / equipment_compatibility_sources
// are intentionally EXCLUDED from v1: supplier-confidential terms, WO-scoped ledger, and free-text evidence
// respectively — deferred to a later fixture version). Target/closure collections are included.
export const V1_SELECTED = [
  "parts", "manufacturers", "part_aliases",
  "warehouses", "stock_locations", "trucks", "mobile_locations",
  "equipment_models", "equipment_model_aliases", "equipment_part_compatibility", "equipment",
];

// ---- guards (pure, exported for tests) --------------------------------------------------------------
export function loadRegistry() {
  return JSON.parse(readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
}

// Extraction targets PRODUCTION explicitly. Refuse anything that is not a registry-known production env, and
// require the explicit read acknowledgment. Returns the resolved env.
export function assertProductionReadTarget(projectId, confirmed, registry) {
  if (!projectId || projectId === "true") throw new Error("--project is required (the production project).");
  if (confirmed !== true) throw new Error("Refusing: --confirm-production-read acknowledgment is required.");
  const env = (registry.environments || []).find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`Refusing: '${projectId}' is not a registry-known environment.`);
  if (env.role !== "production") throw new Error(`Refusing: '${env.id}' has role '${env.role}', not production. This tool reads production only.`);
  return env;
}

// A Firestore proxy that permits ONLY read methods; any write method throws. Defense-in-depth so the tool
// cannot write even if code changed. Pure factory over a real firestore instance.
const READ_METHODS = new Set(["collection", "doc", "get", "where", "limit", "orderBy", "select", "startAfter"]);
export function readOnlyProxy(target) {
  return new Proxy(target, {
    get(obj, prop) {
      const v = obj[prop];
      if (typeof v !== "function") return v;
      if (["set", "add", "update", "delete", "create", "commit", "batch", "runTransaction", "bulkWriter"].includes(prop)) {
        throw new Error(`READ-ONLY VIOLATION: '${String(prop)}' is a write and is forbidden by this tool.`);
      }
      return (...args) => {
        const res = v.apply(obj, args);
        return res && typeof res === "object" && (res.get || res.where || res.doc) ? readOnlyProxy(res) : res;
      };
    },
  });
}

function sha256(s) { return createHash("sha256").update(s).digest("hex"); }

// ---- extraction (I/O; operator-run) -----------------------------------------------------------------
async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i].startsWith("--")) {
      const k = process.argv[i].slice(2);
      const nxt = process.argv[i + 1];
      args[k] = nxt && !nxt.startsWith("--") ? nxt : true;
    }
  }
  const registry = loadRegistry();
  const env = assertProductionReadTarget(args.project, args["confirm-production-read"] === true, registry);
  const outDir = typeof args.out === "string" ? args.out : "./_fixture-export";
  const asOf = typeof args.asOf === "string" ? args.asOf : null;
  if (!asOf) throw new Error("--asOf YYYY-MM-DD is required (recorded as extraction date; keep provenance explicit).");
  const cap = Math.min(Number(args.max) || MAX_PER_COLLECTION, MAX_PER_COLLECTION);

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: args.project });
  const db = readOnlyProxy(getFirestore());

  console.log(`READ-ONLY extraction from production '${env.id}' (${args.project}); cap ${cap}/collection.`);

  // 1) representative selection per collection (bounded), 2) close required refs, 3) sanitize inline, 4) write.
  const selected = {}; // collection -> [raw records]
  for (const collection of V1_SELECTED) {
    const crit = SELECTION_CRITERIA[collection];
    const snap = await db.collection(collection).limit(cap).get();
    let rows = snap.docs.map((d) => ({ __docId: d.id, ...d.data() }));
    if (crit) {
      // keep at least one record per criterion where available, then fill up to cap
      const picked = new Map();
      for (const c of crit) { const hit = rows.find((r) => c.match(r)); if (hit) picked.set(hit.__docId, hit); }
      for (const r of rows) { if (picked.size >= cap) break; picked.set(r.__docId, r); }
      rows = [...picked.values()];
    }
    selected[collection] = rows.slice(0, cap);
  }

  // close required referenced ids that weren't already selected
  const need = requiredReferencedIds(Object.fromEntries(Object.entries(selected).map(([c, rs]) => [c, rs])));
  for (const [target, idset] of Object.entries(need)) {
    const have = new Set((selected[target] || []).map((r) => r[COLLECTIONS[target].idField]).map(String));
    for (const id of idset) {
      if (have.has(id)) continue;
      const doc = await db.collection(target).doc(id).get();
      if (doc.exists) { (selected[target] ??= []).push({ __docId: doc.id, ...doc.data() }); have.add(id); }
    }
  }

  // sanitize inline (raw prod values never written), map remapped ids
  mkdirSync(path.join(outDir, "fixtures"), { recursive: true });
  const manifestCollections = {};
  for (const [collection, rows] of Object.entries(selected)) {
    const out = [];
    const classif = { keep: new Set(), transform: new Set(), remove: new Set() };
    for (const raw of rows) {
      const { __docId, ...rest } = raw;
      const s = sanitizeRecord(collection, rest);
      s.kept.forEach((f) => classif.keep.add(f)); s.transformed.forEach((f) => classif.transform.add(f)); s.removed.forEach((f) => classif.remove.add(f));
      const idField = COLLECTIONS[collection].idField;
      const rec = { ...s.record };
      if (idField && rec[idField] != null) rec[idField] = sandboxId(collection, rec[idField]);
      out.push(rec);
    }
    const json = JSON.stringify(out, null, 2) + "\n";
    writeFileSync(path.join(outDir, "fixtures", `${collection}.json`), json);
    manifestCollections[collection] = {
      sourceCount: rows.length, selectedCount: out.length, sha256: sha256(json),
      fields: { keep: [...classif.keep].sort(), transform: [...classif.transform].sort(), remove: [...classif.remove].sort() },
    };
  }

  const manifest = {
    fixtureVersion: FIXTURE_VERSION, domains: DOMAINS,
    source: { environmentId: env.id, projectId: args.project, extractionDate: asOf, cap },
    sanitizerVersion: SANITIZER_VERSION,
    collections: manifestCollections,
    note: "Sanitized inline at extraction; raw production values were never written to disk. Provenance lives here, not in the seeded documents.",
  };
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote sanitized fixtures + manifest to ${outDir}. Collections: ${Object.keys(manifestCollections).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("extractProductionFixtures.mjs")) {
  main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
