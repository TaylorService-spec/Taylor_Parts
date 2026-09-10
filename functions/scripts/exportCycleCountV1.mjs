#!/usr/bin/env node
// M-1 (Owner ruling 2026-09-10, Option A) -- READ-ONLY export of every schema-v1 cycle_counts document
// before Cycle Count moves to the v2 sheet/line shape. Writes NOTHING to Firestore.
//
//   node scripts/exportCycleCountV1.mjs --projectId eos-platform-sandbox --out <dir outside the repo>
//   node scripts/exportCycleCountV1.mjs --projectId eos-platform-certification --out <dir>
//
// Output: <out>/<projectId>.cycle_counts.v1.json -- every document, complete, in canonical form (keys
// sorted, Timestamps as {seconds,nanos}), each with its own sha256, plus the sha256 of the whole file's
// canonical body. The repository keeps only the MANIFEST (ids, statuses, hashes); full records stay out of
// git (scripts/operationalPayloadGuard.mjs). taylor-parts is refused by name. Operator gcloud login; no key.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import admin from "firebase-admin";

export const TOOL_VERSION = "exportCycleCountV1/1";
const ALLOWED = new Set(["eos-platform-sandbox", "eos-platform-certification"]);

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const projectId = flag("--projectId");
const out = flag("--out");
if (projectId === "taylor-parts") { console.error("REFUSED: production by name."); process.exit(1); }
if (!ALLOWED.has(projectId)) { console.error(`REFUSED: --projectId must be one of ${[...ALLOWED].join(", ")}`); process.exit(1); }
if (!out) { console.error("REFUSED: --out <directory outside the repository> is required."); process.exit(1); }

const win = process.platform === "win32";
const gcloud = (a) => execFileSync(win ? "gcloud.cmd" : "gcloud", a, { encoding: "utf8", shell: win, stdio: ["ignore", "pipe", "pipe"] }).trim();
const operator = gcloud(["config", "get-value", "account"]);
// The operator's Application Default Credentials -- the same login the other governed scripts use.
admin.initializeApp({ projectId, credential: admin.credential.applicationDefault() });
const db = admin.firestore();

// Canonical form: sorted keys at every depth; Timestamps as {seconds,nanos}; nothing else rewritten.
function canon(v) {
  if (v instanceof admin.firestore.Timestamp) return { __timestamp: { seconds: v.seconds, nanos: v.nanoseconds } };
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

const snap = await db.collection("cycle_counts").get();
const documents = [];
for (const doc of snap.docs) {
  const data = canon(doc.data());
  const subs = await doc.ref.listCollections();
  documents.push({
    id: doc.id,
    schemaVersion: data.schemaVersion ?? null,
    status: data.status ?? null,
    subcollections: subs.map((c) => c.id).sort(),
    sha256: sha(data),
    data,
  });
}
documents.sort((a, b) => a.id.localeCompare(b.id));
const body = { sourceProject: projectId, collection: "cycle_counts", exportedAt: new Date().toISOString(), operator, tool: TOOL_VERSION, count: documents.length, documents };
const bodySha256 = sha(body);
mkdirSync(out, { recursive: true });
const file = join(out, `${projectId}.cycle_counts.v1.json`);
writeFileSync(file, JSON.stringify({ ...body, bodySha256 }, null, 2));

console.log(`${projectId}: ${documents.length} document(s) -> ${file}`);
console.log(`bodySha256 ${bodySha256}`);
for (const d of documents) console.log(`${d.id}  v${d.schemaVersion}  ${String(d.status).padEnd(10)}  ${d.sha256}${d.subcollections.length ? `  subcollections=${d.subcollections}` : ""}`);
