// FIREBASE BIN CENSUS -- OFFLINE, READ-ONLY (Firebase exit B3, DECISIONS #B3; Owner ruling 6). Classifies every Firebase bin as SYNTHETIC,
// DUPLICATE or UNMATCHED against what EOS holds, with reasons (functions/src/eosOps/migration/binCensus.ts). It reads TWO FILES you hand it,
// opens no network connection, loads no SDK, holds no credential and WRITES NOTHING except an optional report file created exclusively.
// Nothing is copied, imported, merged or deleted: a classification is evidence for the Owner's later disposition, and the copy stays HELD.
//
// Inputs
//   --snapshot  the Firestore export (node scripts/exportBinSnapshot.js, operator-run, with its own project fence)
//   --eos       the EOS reference: JSON { "warehouses": [{ "warehouseId", "name" }], "bins": [{ "binId", "warehouseId", "area", "aisle", "bay",
//               "position", "code" }] } -- the answers of the Warehouse Racking reads (listRackingWarehouses, then listRackingBins per warehouse;
//               each item already has these field names). Existing read path only; no database credential is needed here.
//   --map       optional JSON { "<firestore warehouse id>": "<eos warehouse id>" }. Never inferred from a name.
//   --out       optional report path (created exclusively with `<out>.sha256`; never overwritten)
//
// Usage (after `npm run build`):
//   node scripts/binCensus.js --snapshot ./bins-snapshot.json --eos ./eos-racking.json [--map ./warehouse-map.json] [--out ./bin-census.json]
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    out[key] = value;
    i += 1;
  }
  return out;
}

const readJson = (file, what) => {
  const text = fs.readFileSync(path.resolve(file), "utf8");
  try { return { json: JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") }; } catch { throw new Error(`${what} is not valid JSON: ${file}`); }
};

/** The Firestore export's documents, as the census reads them. A bin document is trusted for nothing it does not state. */
function firebaseSide(snapshot) {
  if (!snapshot || snapshot.format !== "EOS_BIN_SNAPSHOT") throw new Error("--snapshot is not an EOS_BIN_SNAPSHOT export");
  const warehouses = (snapshot.warehouses ?? []).map((d) => ({ id: String(d.id), name: typeof d.data?.name === "string" ? d.data.name : null }));
  const bins = (snapshot.bins ?? []).map((d) => ({
    id: String(d.id), warehouseId: String(d.data?.warehouseId ?? ""), area: d.data?.area ?? null, aisle: d.data?.aisle ?? null,
    bay: typeof d.data?.bay === "number" ? d.data.bay : null, position: typeof d.data?.position === "number" ? d.data.position : null,
    code: typeof d.data?.code === "string" ? d.data.code : null, status: d.data?.status ?? null,
  }));
  return { warehouses, bins };
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.snapshot || !flags.eos) throw new Error("usage: node scripts/binCensus.js --snapshot <file> --eos <file> [--map <file>] [--out <file>]");
  const { classifyFirebaseBins } = require("../lib/eosOps/migration/binCensus.js");
  const snapshot = readJson(flags.snapshot, "--snapshot");
  const eos = readJson(flags.eos, "--eos");
  const map = flags.map ? readJson(flags.map, "--map") : null;
  const report = classifyFirebaseBins({
    firebase: firebaseSide(snapshot.json),
    eos: { warehouses: eos.json.warehouses ?? [], bins: eos.json.bins ?? [] },
    ...(map ? { warehouseMap: map.json } : {}),
  });
  const text = JSON.stringify({
    format: "EOS_BIN_CENSUS", version: 1,
    inputs: { snapshotSha256: snapshot.sha256, eosSha256: eos.sha256, mapSha256: map ? map.sha256 : null },
    counts: report.counts, byWarehouse: report.byWarehouse, rows: report.rows,
  }, null, 2) + "\n";
  if (flags.out) {
    const out = path.resolve(flags.out);
    fs.writeFileSync(out, text, { flag: "wx", mode: 0o600 });
    fs.writeFileSync(`${out}.sha256`, `${createHash("sha256").update(text).digest("hex")}  ${path.basename(out)}\n`, { flag: "wx", mode: 0o600 });
  }
  console.log(JSON.stringify({ counts: report.counts, byWarehouse: report.byWarehouse, out: flags.out ?? null }, null, 2));
}

module.exports = { firebaseSide, parseFlags };

if (require.main === module) {
  try { main(); } catch (err) { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 2; }
}
