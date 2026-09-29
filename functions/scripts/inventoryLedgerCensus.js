#!/usr/bin/env node
// INVENTORY LEDGER PRE-ACTIVATION CENSUS (Controller ruling DQ-019, 2026-09-28) -- READ ONLY, OFFLINE.
//
// Classifies an OFFLINE snapshot of `inventory_transactions` with the SAME classifier and strict reader the
// authoritative inventory results now fail closed on (functions/src/inventoryLedger/authoritativeLedgerRows.ts),
// and prints: total / operational / legacy / malformed (by reason), the malformed row IDS (never contents), the
// parts whose authoritative reads those rows would refuse, and a verdict READY | MALFORMED_ROWS_PRESENT.
//
// THE SOURCE IS A FILE. This tool opens NO Firebase app, reads NO credentials, connects to NOTHING, and writes
// nothing but its report to stdout. `lib/` is loaded only for the pure classifier (whose module carries the
// Firestore Timestamp VALUE class used to decode `{"$timestamp":{seconds,nanoseconds}}` tags -- a data type, not a
// connection). Producing the snapshot itself is a separately governed, migration-only read that this tool does not
// perform and does not authorize.
//
// It REPAIRS NOTHING. A non-zero malformed count is a finding for a governed decision (ambiguous real-data repair
// is never a tool's call). Exit code: 0 READY, 3 MALFORMED_ROWS_PRESENT, 2 refused input.
//
// Usage: node scripts/inventoryLedgerCensus.js --snapshot <file.json>
//   The file is either { "rows": [ { "id", "data" } ... ] } or the exporter shape
//   { "collections": { "inventory_transactions": [ { "id", "data" } ... ] } }. If <file>.sha256 exists it must match.
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

function fail(message) {
  process.stdout.write(`${JSON.stringify({ outcome: "REFUSED", message })}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--snapshot") out.snapshot = argv[++i];
    else fail(`unknown argument ${argv[i]}`);
  }
  if (!out.snapshot) fail("--snapshot <file.json> is required");
  return out;
}

function main() {
  const { snapshot } = parseArgs(process.argv.slice(2));
  let raw;
  try { raw = fs.readFileSync(snapshot); } catch (err) { fail(`snapshot unreadable: ${err.code || err.message}`); }
  const sumFile = `${snapshot}.sha256`;
  if (fs.existsSync(sumFile)) {
    const expected = fs.readFileSync(sumFile, "utf8").trim().split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(raw).digest("hex");
    if (expected !== actual) fail("snapshot checksum does not match its .sha256 file");
  }
  let parsed;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { fail("snapshot is not JSON"); }
  const rows = Array.isArray(parsed && parsed.rows) ? parsed.rows
    : Array.isArray(parsed && parsed.collections && parsed.collections.inventory_transactions) ? parsed.collections.inventory_transactions
      : null;
  if (rows === null) fail("snapshot has neither rows[] nor collections.inventory_transactions[]");
  const ids = new Set();
  for (const r of rows) {
    if (!r || typeof r.id !== "string" || r.id === "") fail("every row needs a non-empty string id");
    if (ids.has(r.id)) fail(`duplicate row id ${r.id}`);
    ids.add(r.id);
  }

  const lib = path.resolve(__dirname, "../lib/inventoryLedger");
  const { decodeLedgerSnapshotValue } = require(path.join(lib, "operationalMovementRepository.js"));
  const { censusLedgerRows } = require(path.join(lib, "authoritativeLedgerRows.js"));
  const docs = rows.map((r) => { const data = decodeLedgerSnapshotValue(r.data); return { id: r.id, data: () => data }; });
  const census = censusLedgerRows(docs);
  process.stdout.write(`${JSON.stringify({ outcome: "CENSUS", snapshot: path.basename(snapshot), ...census }, null, 2)}\n`);
  process.exit(census.verdict === "READY" ? 0 : 3);
}

main();
