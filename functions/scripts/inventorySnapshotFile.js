// Shared, OFFLINE snapshot-file reader for the inventory census tools (inventoryLedgerCensus.js,
// cycleCountActivationCensus.js, transferCopyCensus.js). Pure file I/O: no Firebase, no database.
//
// Accepts:
//   * the governed export (scripts/exportInventorySnapshot.js): { format: "EOS_INVENTORY_SNAPSHOT", <exportKey>: [...] }
//     -- its `<file>.sha256` is REQUIRED and must match (a governed snapshot is only evidence if it is intact);
//   * a hand-built fixture: { rows: [...] } or { collections: { <collection>: [...] } } -- `.sha256` checked if present.
// Every row must carry a unique, non-empty string id. Refusals are thrown as Error("REFUSED: ...").
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");

function refuse(message) { throw new Error(`REFUSED: ${message}`); }

function loadSnapshotRows(file, { exportKey, collectionName }) {
  let raw;
  try { raw = fs.readFileSync(file); } catch (err) { refuse(`snapshot unreadable: ${err.code || err.message}`); }
  let parsed;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { refuse("snapshot is not JSON"); }
  const governed = parsed && parsed.format === "EOS_INVENTORY_SNAPSHOT";
  const sumFile = `${file}.sha256`;
  if (governed && !fs.existsSync(sumFile)) refuse("a governed inventory snapshot must carry its .sha256");
  if (fs.existsSync(sumFile)) {
    const expected = fs.readFileSync(sumFile, "utf8").trim().split(/\s+/)[0];
    if (crypto.createHash("sha256").update(raw).digest("hex") !== expected) refuse("snapshot checksum does not match its .sha256 file");
  }
  const rows = governed ? (Array.isArray(parsed[exportKey]) ? parsed[exportKey] : null)
    : Array.isArray(parsed && parsed.rows) ? parsed.rows
      : Array.isArray(parsed && parsed.collections && parsed.collections[collectionName]) ? parsed.collections[collectionName] : null;
  if (rows === null) refuse(`snapshot has no ${governed ? exportKey : `rows[] or collections.${collectionName}[]`}`);
  const seen = new Set();
  for (const r of rows) {
    if (!r || typeof r.id !== "string" || r.id === "") refuse("every row needs a non-empty string id");
    if (seen.has(r.id)) refuse(`duplicate row id ${r.id}`);
    seen.add(r.id);
  }
  return { rows, governed, source: governed ? parsed.source ?? null : null };
}

module.exports = { loadSnapshotRows };
