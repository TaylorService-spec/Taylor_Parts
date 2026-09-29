#!/usr/bin/env node
// CYCLE COUNT ZERO-POPULATION CENSUS (activation gate 1; functions/src/cycleCount/cycleCountActivationCensus.ts).
// READ ONLY, OFFLINE: classifies an exported snapshot of the top-level `cycle_counts` collection. Opens no Firebase
// app, reads no credentials, writes nothing but its report. Producing the snapshot is a separately governed read.
// Exit: 0 ZERO_POPULATION (gate open) | 3 V2_SHEETS_PRESENT or UNCLASSIFIABLE_PRESENT (STOP) | 2 refused input.
// Usage: node scripts/cycleCountActivationCensus.js --snapshot <file.json>
//   file: { "rows": [ {id, data} ] } or { "collections": { "cycle_counts": [ {id, data} ] } }; <file>.sha256 checked if present.
"use strict";
const path = require("node:path");

function fail(message) { process.stdout.write(`${JSON.stringify({ outcome: "REFUSED", message })}\n`); process.exit(2); }

const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== "--snapshot") fail("usage: --snapshot <file.json>");
const snapshot = argv[1];
let rows;
try {
  ({ rows } = require("./inventorySnapshotFile.js").loadSnapshotRows(snapshot, { exportKey: "cycleCounts", collectionName: "cycle_counts" }));
} catch (err) { fail(err.message.replace(/^REFUSED: /, "")); }
const { censusCycleCountDocuments } = require(path.resolve(__dirname, "../lib/cycleCount/cycleCountActivationCensus.js"));
const census = censusCycleCountDocuments(rows);
process.stdout.write(`${JSON.stringify({ outcome: "CENSUS", snapshot: path.basename(snapshot), ...census }, null, 2)}\n`);
process.exit(census.verdict === "ZERO_POPULATION" ? 0 : 3);
