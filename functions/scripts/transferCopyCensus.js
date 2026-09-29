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
const path = require("node:path");

function fail(message) { process.stdout.write(`${JSON.stringify({ outcome: "REFUSED", message })}\n`); process.exit(2); }
const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== "--snapshot") fail("usage: --snapshot <file.json>");
const snapshot = argv[1];
let rows;
try {
  ({ rows } = require("./inventorySnapshotFile.js").loadSnapshotRows(snapshot, { exportKey: "transferOrders", collectionName: "transfer_orders" }));
} catch (err) { fail(err.message.replace(/^REFUSED: /, "")); }
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
