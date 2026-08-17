#!/usr/bin/env node
// Renders metadata-program/LEDGER.md from metadata-program/ledger.json, and
// validates the ledger on the way through.
//
// Run:  node docs/orchestration/lib/renderMetadataProgramLedger.mjs
// Check-only (CI): node docs/orchestration/lib/renderMetadataProgramLedger.mjs --check
//
// --check exits non-zero if the committed markdown is stale OR the ledger is
// invalid, so a ledger that lies (a merge with no SHA, a block with no reason)
// fails the build rather than quietly misleading the next session.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLedger, renderMarkdown, makeEntry } from "./metadataProgramLedger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(HERE, "..", "metadata-program", "ledger.json");
const MD_PATH = path.resolve(HERE, "..", "metadata-program", "LEDGER.md");

const checkOnly = process.argv.includes("--check");

const raw = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
// Normalize through makeEntry so authored JSON may omit fields that have safe
// defaults (deploy, gate, arrays) without the validator reporting them as unknown
// values. The JSON stays terse; the model stays strict.
const ledger = { ...raw, entries: (raw.entries ?? []).map(makeEntry) };

const problems = validateLedger(ledger);
if (problems.length) {
  console.error(`Ledger is invalid (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const rendered = renderMarkdown(ledger);

if (checkOnly) {
  const current = fs.existsSync(MD_PATH) ? fs.readFileSync(MD_PATH, "utf8") : "";
  if (current !== rendered) {
    console.error("LEDGER.md is stale — re-run: node docs/orchestration/lib/renderMetadataProgramLedger.mjs");
    process.exit(1);
  }
  console.log(`Ledger valid and LEDGER.md current (${ledger.entries.length} entries).`);
  process.exit(0);
}

fs.writeFileSync(MD_PATH, rendered, "utf8");
console.log(`Ledger valid. Rendered ${ledger.entries.length} entries to ${path.relative(process.cwd(), MD_PATH)}.`);
