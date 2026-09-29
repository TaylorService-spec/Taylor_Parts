#!/usr/bin/env node
// CYCLE COUNT ZERO-POPULATION CENSUS (activation gate 1; functions/src/cycleCount/cycleCountActivationCensus.ts).
// READ ONLY, OFFLINE: classifies an exported snapshot of the top-level `cycle_counts` collection. Opens no Firebase
// app, reads no credentials, writes nothing but its report. Producing the snapshot is a separately governed read.
// Exit: 0 ZERO_POPULATION (gate open) | 3 V2_SHEETS_PRESENT or UNCLASSIFIABLE_PRESENT (STOP) | 2 refused input.
// Usage: node scripts/cycleCountActivationCensus.js --snapshot <file.json>
//   file: { "rows": [ {id, data} ] } or { "collections": { "cycle_counts": [ {id, data} ] } }; <file>.sha256 checked if present.
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
  : Array.isArray(parsed && parsed.collections && parsed.collections.cycle_counts) ? parsed.collections.cycle_counts : null;
if (rows === null) fail("snapshot has neither rows[] nor collections.cycle_counts[]");
const ids = new Set();
for (const r of rows) {
  if (!r || typeof r.id !== "string" || r.id === "") fail("every row needs a non-empty string id");
  if (ids.has(r.id)) fail(`duplicate row id ${r.id}`);
  ids.add(r.id);
}
const { censusCycleCountDocuments } = require(path.resolve(__dirname, "../lib/cycleCount/cycleCountActivationCensus.js"));
const census = censusCycleCountDocuments(rows);
process.stdout.write(`${JSON.stringify({ outcome: "CENSUS", snapshot: path.basename(snapshot), ...census }, null, 2)}\n`);
process.exit(census.verdict === "ZERO_POPULATION" ? 0 : 3);
