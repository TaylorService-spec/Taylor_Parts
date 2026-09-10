#!/usr/bin/env node
// COMPLETE BIN CONVERSION -- the governed step that passes a Warehouse through the Bin conversion gate
// (BIN-P7, Decision #178 B4). After it, that Warehouse's Bins may be admitted to Cycle Count.
//
// It re-runs the SAME reconciliation the read-only script prints, and writes
// warehouse_bin_conversions/{warehouseId} = CONVERSION_COMPLETE only when that report balances:
// relocationNet == 0 and aggregateAfter - aggregateBefore == explained other activity, for every part,
// with no unresolved bin and no malformed row. Otherwise it writes nothing.
//
// Usage (after `npm run build` in functions/), with the report you reviewed:
//   node scripts/completeBinConversion.mjs --projectId eos-platform-sandbox --warehouse WH-PHX \
//     --start 2026-09-15T13:00:00Z --end 2026-09-15T21:00:00Z --expect-report <sha256>
//
// --expect-report is REQUIRED: the gate is passed on exactly the report a person looked at. If the
// ledger moved since, the hash differs and nothing is written -- re-run the reconciliation and review.
//
// SAFETY: taylor-parts is refused by name (production conversion needs its own authorization);
// create-only (an existing record is never overwritten); the operator's existing gcloud login, no key.
// Exit: 0 written or already complete for the same report, 2 not proven / hash mismatch, 1 refused.

import { openBinConversionContext, printReport, refuse } from "./_binConversionCli.mjs";

const ctx = openBinConversionContext(process.argv.slice(2));
const expected = ctx.flag("--expect-report");
if (!expected || !/^[0-9a-f]{64}$/.test(expected)) refuse("--expect-report <sha256 from the reconciliation you reviewed> is required.");

const { readBinConversionReport } = await import("../lib/inventoryLedger/binConversionReport.js");
const { buildConversionCompletion, ConversionNotProvenError, WAREHOUSE_BIN_CONVERSIONS_COLLECTION } = await import("../lib/inventoryLocation/binConversionGate.js");

const loaded = await readBinConversionReport(ctx.db, ctx.warehouseId, ctx.start, ctx.end);
printReport(loaded);
if (loaded.reportSha256 !== expected) {
  console.error(`\nNOT WRITTEN: the report is ${loaded.reportSha256}, not the one reviewed (${expected}). Review again.`);
  process.exit(2);
}

let record;
try {
  record = buildConversionCompletion(loaded.report, { completedBy: ctx.operator, reportSha256: loaded.reportSha256, malformedRows: loaded.malformedRows });
} catch (err) {
  if (err instanceof ConversionNotProvenError) { console.error(`\nNOT WRITTEN: ${err.message}`); process.exit(2); }
  throw err;
}

const ref = ctx.db.collection(WAREHOUSE_BIN_CONVERSIONS_COLLECTION).doc(ctx.warehouseId);
const outcome = await ctx.db.runTransaction(async (txn) => {
  const snap = await txn.get(ref);
  if (snap.exists) return snap.data()?.evidence?.reportSha256 === loaded.reportSha256 ? "already" : "conflict";
  txn.create(ref, { ...record, completedAt: ctx.admin.firestore.FieldValue.serverTimestamp() });
  return "written";
});
if (outcome === "conflict") { console.error("\nNOT WRITTEN: this warehouse already passed the gate on a different report."); process.exit(2); }
console.log(outcome === "written" ? `\nCONVERSION_COMPLETE recorded for ${ctx.warehouseId}.` : `\nAlready complete for this report.`);
process.exit(0);
