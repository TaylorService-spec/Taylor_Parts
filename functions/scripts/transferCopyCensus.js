#!/usr/bin/env node
// TRANSFER COPY-LANE CENSUS (Controller ruling DQ-018: Transfer is the second inventory cutover) -- READ ONLY, OFFLINE.
//
// Runs every record of an exported `transfer_orders` snapshot through the EXISTING governed mapper
// (eosOps/migration/purchasingMigrationMapping.ts: mapLegacyTransferOrder + reconcileTransferOrderMigration) and
// prints what a COPY would face: mapped vs refused (by code, with ids), status distribution, cross-company split,
// and the IN_TRANSIT population whose TRANSFER_OUT is already in the legacy ledger (the ledger COPY and the transfer
// COPY must agree on those, or a receive would double or lose stock). It maps nothing into a database, repairs
// nothing, opens no Firebase app, and connects to nothing. Producing the snapshot is a separately governed read.
// Exit: 0 COPY_READY (every record maps) | 3 REFUSALS_PRESENT | 2 refused input.
// Usage: node scripts/transferCopyCensus.js --snapshot <file.json>
//   file: { "rows": [ {id, data} ] } or { "collections": { "transfer_orders": [ {id, data} ] } }; <file>.sha256 checked if present.
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

function fail(message) { process.stdout.write(`${JSON.stringify({ outcome: "REFUSED", message })}\n`); process.exit(2); }
const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== "--snapshot") fail("usage: --snapshot <file.json>");
const snapshot = argv[1];
let raw;
try { raw = fs.readFileSync(snapshot); } catch (err) { fail(`snapshot unreadable: ${err.code || err.message}`); }
if (fs.existsSync(`${snapshot}.sha256`)) {
  const expected = fs.readFileSync(`${snapshot}.sha256`, "utf8").trim().split(/\s+/)[0];
  if (crypto.createHash("sha256").update(raw).digest("hex") !== expected) fail("snapshot checksum does not match its .sha256 file");
}
let parsed;
try { parsed = JSON.parse(raw.toString("utf8")); } catch { fail("snapshot is not JSON"); }
const rows = Array.isArray(parsed && parsed.rows) ? parsed.rows
  : Array.isArray(parsed && parsed.collections && parsed.collections.transfer_orders) ? parsed.collections.transfer_orders : null;
if (rows === null) fail("snapshot has neither rows[] nor collections.transfer_orders[]");
const seen = new Set();
for (const r of rows) {
  if (!r || typeof r.id !== "string" || r.id === "") fail("every row needs a non-empty string id");
  if (seen.has(r.id)) fail(`duplicate row id ${r.id}`);
  seen.add(r.id);
}
const { mapLegacyTransferOrder, reconcileTransferOrderMigration } =
  require(path.resolve(__dirname, "../lib/eosOps/migration/purchasingMigrationMapping.js"));
const results = rows.map((r) => mapLegacyTransferOrder(r.id, r.data));
const reconciliation = reconcileTransferOrderMigration(results);
const refusals = results.filter((r) => r.ok !== true).map((r) => ({ id: r.documentId ?? r.id ?? null, code: r.code }));
const byStatus = {};
for (const r of results) if (r.ok === true) byStatus[r.row.status] = (byStatus[r.row.status] ?? 0) + 1;
const inTransit = results.filter((r) => r.ok === true && r.row.status === "IN_TRANSIT").map((r) => r.row.id).sort();
const verdict = reconciliation.refused === 0 ? "COPY_READY" : "REFUSALS_PRESENT";
process.stdout.write(`${JSON.stringify({
  outcome: "CENSUS", snapshot: path.basename(snapshot), verdict, reconciliation, byStatus,
  inTransitNeedingLedgerAgreement: inTransit, refusals,
}, null, 2)}\n`);
process.exit(verdict === "COPY_READY" ? 0 : 3);
