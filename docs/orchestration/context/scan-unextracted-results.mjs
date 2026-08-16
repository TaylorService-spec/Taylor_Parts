#!/usr/bin/env node
// Scans landed audit results for the "false clean" case -- COMPLETE with zero findings
// whose human report actually contains findings. See lib/unextractedResults.mjs for why.
//
//   node docs/orchestration/context/scan-unextracted-results.mjs          # report
//   node docs/orchestration/context/scan-unextracted-results.mjs --strict # exit 1 if any found
//
// Exit codes: 0 = nothing to re-read (or report-only), 1 = unextracted results found (--strict).
import fs from "node:fs";
import path from "node:path";
import { detectUnextracted } from "../lib/unextractedResults.mjs";

const ROOT = "docs/orchestration/work-intake/results";
const strict = process.argv.includes("--strict");

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
};

const files = walk(ROOT);
const results = files.filter((f) => f.endsWith(".result.json"));
const flagged = [];

for (const rf of results) {
  let result;
  try { result = JSON.parse(fs.readFileSync(rf, "utf8")); } catch { continue; }

  // Prefer the declared contentLocation; fall back to any sibling content.md.
  let content = "";
  const candidates = [];
  if (result.contentLocation) candidates.push(result.contentLocation);
  candidates.push(...files.filter((f) => path.dirname(f) === path.dirname(rf) && f.endsWith(".content.md")));
  for (const c of candidates) {
    try { content = fs.readFileSync(c, "utf8"); if (content.trim()) break; } catch { /* next */ }
  }

  const verdict = detectUnextracted({ result, content });
  if (verdict.unextracted) {
    flagged.push({ requestId: result.requestId ?? path.basename(path.dirname(rf)), file: rf, ...verdict });
  }
}

console.log(`scanned ${results.length} result artifact(s) under ${ROOT}`);
if (!flagged.length) {
  console.log("no unextracted results — every COMPLETE/zero-findings result is trustworthy.");
  process.exit(0);
}
console.log(`\n${flagged.length} UNEXTRACTED result(s) — reported clean, but the report contains findings:\n`);
for (const f of flagged) {
  console.log(`  ${f.requestId}`);
  console.log(`    ${f.file}`);
  console.log(`    ${f.signalCount} finding-shaped signal(s) [${f.signals.join(", ")}], ${f.cleanPhrases} clean phrase(s)`);
}
console.log("\nThese must be re-read from their content.md and dispositioned — they are NOT clean runs.");
process.exit(strict ? 1 : 0);
