// SNAPSHOT CONTENT FINGERPRINT -- the source-quiescence proof of the Catalog + Reorder cutover. Offline; reads two
// snapshot FILES and nothing else. It never loads firebase-admin, never reads Firestore and never writes anything.
//
// WHY IT EXISTS. The cutover proves the legacy source did not move while it was copied WITHOUT any Firebase deployment
// (Owner correction 2026-09-28: no new Firebase deployment of any kind). The proof is a comparison: a snapshot exported
// before the COPY (FP-0) and one exported after VERIFY (FP-1) must carry identical records. A file checksum cannot
// answer that -- each export stamps its own `source.exportedAt` -- so this compares CONTENT: every record of every
// collection, by id, in the canonical form the exporters already write (keys sorted by encodeValue, records sorted by
// id). The `source` block is the only thing ignored.
//
// Each file's `<file>.sha256` sidecar is checked first; a snapshot whose checksum disagrees is refused, never compared.
//
// Usage:
//   node scripts/snapshotContentFingerprint.js --baseline fp0.json --current fp1.json
// Exit: 0 IDENTICAL | 3 DIFFERENT (added/removed/changed ids listed; values are never printed) | 2 refused.
"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Read a snapshot and verify it against its sidecar checksum. */
function readVerifiedSnapshot(file) {
  const text = fs.readFileSync(file, "utf8");
  let sidecar;
  try {
    sidecar = fs.readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0];
  } catch {
    throw new Error(`REFUSED: ${file}.sha256 is missing; an unchecksummed snapshot is not evidence.`);
  }
  if (sidecar !== sha256(text)) throw new Error(`REFUSED: ${file} does not match its .sha256 sidecar.`);
  return JSON.parse(text);
}

/** The collections of a snapshot as { name: [{id, data}] }, for both exporter formats. */
function collectionsOf(snapshot) {
  if (snapshot.format === "EOS_REORDER_SNAPSHOT") return snapshot.collections;
  if (snapshot.format === "EOS_CATALOG_SNAPSHOT") {
    const out = {};
    for (const [key, value] of Object.entries(snapshot)) {
      if (key === "format" || key === "version" || key === "source") continue;
      if (!Array.isArray(value)) throw new Error(`REFUSED: catalog snapshot key '${key}' is not a record array.`);
      out[key] = value;
    }
    return out;
  }
  throw new Error(`REFUSED: unknown snapshot format '${snapshot.format}'.`);
}

/** Per-collection content digest: count plus sha256 of the canonical record array. */
function fingerprint(snapshot) {
  const out = { format: snapshot.format, collections: {} };
  for (const [name, records] of Object.entries(collectionsOf(snapshot)).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out.collections[name] = { count: records.length, sha256: sha256(JSON.stringify(records)) };
  }
  return out;
}

/** Record-level comparison. Lists ids only; record values never leave the files. */
function compare(baseline, current) {
  if (baseline.format !== current.format) throw new Error("REFUSED: the two snapshots are of different formats.");
  const a = collectionsOf(baseline);
  const b = collectionsOf(current);
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diff = {};
  let identical = true;
  for (const name of names) {
    const before = new Map((a[name] ?? []).map((r) => [r.id, JSON.stringify(r.data)]));
    const after = new Map((b[name] ?? []).map((r) => [r.id, JSON.stringify(r.data)]));
    const added = [...after.keys()].filter((id) => !before.has(id)).sort();
    const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
    const changed = [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)).sort();
    const missingCollection = !(name in a) || !(name in b);
    if (added.length || removed.length || changed.length || missingCollection) identical = false;
    diff[name] = { added, removed, changed, ...(missingCollection ? { missingCollection: true } : {}) };
  }
  return { identical, diff };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--baseline" || argv[i] === "--current") args[argv[i].slice(2)] = argv[++i];
    else throw new Error(`REFUSED: unknown argument '${argv[i]}'.`);
  }
  if (!args.baseline || !args.current) throw new Error("--baseline and --current are both required.");
  const baseline = readVerifiedSnapshot(args.baseline);
  const current = readVerifiedSnapshot(args.current);
  const result = compare(baseline, current);
  console.log(JSON.stringify({
    verdict: result.identical ? "IDENTICAL" : "DIFFERENT",
    baseline: fingerprint(baseline), current: fingerprint(current), diff: result.diff,
  }, null, 2));
  return result.identical ? 0 : 3;
}

module.exports = { readVerifiedSnapshot, collectionsOf, fingerprint, compare };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
}
