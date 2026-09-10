#!/usr/bin/env node
// BIN CONVERSION RECONCILIATION -- READ-ONLY proof that converting a warehouse to bins created and
// destroyed nothing. Pure logic: src/inventoryLedger/binConversionReconciliation.ts.
//
// Usage (after `npm run build` in functions/):
//   Emulator:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/binConversionReconciliation.mjs \
//                --warehouse WH-PHX --start 2026-09-15T13:00:00Z [--end 2026-09-15T21:00:00Z]
//   Sandbox:   node scripts/binConversionReconciliation.mjs --projectId eos-platform-sandbox \
//                --warehouse WH-PHX --start ... [--end ...]
//
// SAFETY
//   - Writes NOTHING, anywhere. There is no apply mode: conversion itself happens through the governed
//     relocateStock command (Scan -> Move stock), never through a script.
//   - taylor-parts (production) is refused BY NAME. Production reconciliation is a separately
//     authorized operation and does not run from here.
//   - Uses the operator's existing `gcloud auth` login for sandbox. It creates no credential and reads
//     no key file.
//
// Exit: 0 balanced, 2 NOT balanced (a part whose change is not explained), 1 refused / error.

import { execFileSync } from "node:child_process";
import admin from "firebase-admin";

const PRODUCTION_PROJECT = "taylor-parts";
const SANDBOX_PROJECT = "eos-platform-sandbox";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function refuse(message) { console.error(`REFUSED: ${message}`); process.exit(1); }

const warehouseId = flag("--warehouse");
const startIso = flag("--start");
const endIso = flag("--end");
const projectId = flag("--projectId");
const emulator = process.env.FIRESTORE_EMULATOR_HOST;

if (!warehouseId) refuse("--warehouse is required.");
if (!startIso || Number.isNaN(Date.parse(startIso))) refuse("--start must be an ISO timestamp (when putting-away began).");
if (endIso !== undefined && Number.isNaN(Date.parse(endIso))) refuse("--end must be an ISO timestamp.");
if (projectId === PRODUCTION_PROJECT) refuse(`"${PRODUCTION_PROJECT}" is the customer production project. Refused by name.`);
if (!emulator && projectId !== SANDBOX_PROJECT) refuse(`Without an emulator, only --projectId ${SANDBOX_PROJECT} is accepted.`);

const start = Date.parse(startIso);
const end = endIso ? Date.parse(endIso) : Date.now();
if (end < start) refuse("--end is before --start.");

if (emulator) {
  admin.initializeApp({ projectId: projectId ?? "taylor-parts-emulator" });
} else {
  let token;
  try {
    const win = process.platform === "win32";
    token = execFileSync(win ? "gcloud.cmd" : "gcloud", ["auth", "print-access-token"], {
      encoding: "utf8", shell: win, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    refuse(`No gcloud access token (${err?.message ?? err}). Run \`gcloud auth login\`; this script creates no credentials.`);
  }
  admin.initializeApp({
    projectId,
    credential: { getAccessToken: async () => ({ access_token: token, expires_in: 3000 }) },
  });
}
const db = admin.firestore();

const { reconcileBinConversion } = await import("../lib/inventoryLedger/binConversionReconciliation.js");
const { classifyLedgerDoc, deserializeOperationalMovement } = await import("../lib/inventoryLedger/operationalMovementRepository.js");
const { parentageFromBinSnapshots } = await import("../lib/inventoryLocation/binParentage.js");

// Every bin of this warehouse, from its governed documents -- the ONLY source of parentage.
const binSnap = await db.collection("bins").where("warehouseId", "==", warehouseId).get();
const parentage = parentageFromBinSnapshots(binSnap.docs);
const locationIds = [warehouseId, ...parentage.keys()];

// Every ledger row at the warehouse or any of its bins. `in` takes 30 values per query.
const rows = [];
let skipped = 0;
for (let i = 0; i < locationIds.length; i += 30) {
  const chunk = locationIds.slice(i, i + 30);
  const snap = await db.collection("inventory_transactions").where("location.locationId", "in", chunk).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (classifyLedgerDoc(data) !== "operational") continue;
    try {
      const d = deserializeOperationalMovement(data);
      rows.push({ value: d.value, recordedAt: d.recordedAt });
    } catch {
      skipped += 1; // a malformed row is reported, never trusted
    }
  }
}

const report = reconcileBinConversion(rows, warehouseId, parentage, start, end);

console.log(`Warehouse ${warehouseId}   window ${new Date(start).toISOString()} .. ${new Date(end).toISOString()}`);
console.log(`Bins: ${parentage.size}   ledger rows read: ${rows.length}   malformed rows skipped: ${skipped}`);
console.log("");
console.log("part".padEnd(28), "before".padStart(8), "after".padStart(8), "reloc".padStart(7), "other".padStart(7), "binned".padStart(8), "direct".padStart(8), "  ok");
for (const p of report.parts) {
  console.log(p.partId.padEnd(28), String(p.aggregateBefore).padStart(8), String(p.aggregateAfter).padStart(8),
    String(p.relocationNet).padStart(7), String(p.otherNet).padStart(7), String(p.binnedAfter).padStart(8),
    String(p.directAfter).padStart(8), p.balanced ? "  yes" : "  NO");
}
if (report.unresolvedBinIds.length) console.log(`\nUnresolved bin ids (NOT assumed): ${report.unresolvedBinIds.join(", ")}`);
console.log(`\n${report.balanced ? "BALANCED" : "NOT BALANCED"} -- ${report.parts.filter((p) => !p.balanced).length} part(s) unexplained, ${skipped} malformed row(s).`);
process.exit(report.balanced && skipped === 0 ? 0 : 2);
