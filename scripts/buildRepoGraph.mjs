#!/usr/bin/env node
// Builds docs/architecture/repo-graph.json and prints a hygiene report.
//
//   node scripts/buildRepoGraph.mjs            # write graph + report
//   node scripts/buildRepoGraph.mjs --check    # report only, exit 1 on stale refs
//
// The graph is committed on purpose: per docs/ai/ai-state-contract.md, structural
// truth belongs in the repository where every reader -- Owner, Claude, ChatGPT --
// sees the same answer, instead of each rediscovering it at their own cost.
import fs from "node:fs";
import path from "node:path";
import { buildGraph, isIgnored, toPosix } from "./repoGraph.mjs";

const OUT = "docs/architecture/repo-graph.json";
const check = process.argv.includes("--check");
const t0 = Date.now();

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const rel = toPosix(path.relative(".", path.join(dir, e.name)));
    if (!rel || isIgnored(rel)) continue;
    if (e.isDirectory()) walk(path.join(dir, e.name), acc);
    else acc.push(rel);
  }
  return acc;
}

const files = walk(".");
const graph = buildGraph({ files, read: (p) => fs.readFileSync(p, "utf8") });
const ms = Date.now() - t0;

const h = graph.hygiene;
console.log(`repo graph: ${graph.counts.files} files (${graph.counts.code} code, ${graph.counts.docs} docs, ` +
            `${graph.counts.workflows} workflows), ${graph.counts.importEdges} import edges — built in ${ms}ms\n`);
console.log("hygiene:");
console.log(`  stale doc references : ${h.staleRefs.length}`);
console.log(`  orphan docs          : ${h.orphanDocs.length}`);
console.log(`  tests w/o path trigger: ${h.testsNoPathTrigger.length}`);
console.log(`  unimported code      : ${h.unimportedCode.length}`);

if (h.staleRefs.length) {
  console.log("\nstale references (a doc cites a path that does not exist):");
  for (const s of h.staleRefs.slice(0, 25)) console.log(`  ${s.doc}\n      -> ${s.ref}`);
  if (h.staleRefs.length > 25) console.log(`  ... and ${h.staleRefs.length - 25} more`);
}
if (h.testsNoPathTrigger.length) {
  console.log("\nCI-uncovered tests (no workflow path filter selects them):");
  for (const t of h.testsNoPathTrigger.slice(0, 20)) console.log(`  ${t}`);
  if (h.testsNoPathTrigger.length > 20) console.log(`  ... and ${h.testsNoPathTrigger.length - 20} more`);
}

if (!check) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(graph, null, 1)}\n`);
  console.log(`\nwrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
}
process.exit(check && h.staleRefs.length ? 1 : 0);
