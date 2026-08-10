// C-7 context-package generator (slice 2).
//
// Emits a REPRODUCIBLE context package for an assignment scope, derived from the committed
// context-map.json via the contextMap contract. This is what a cold worker is handed instead of
// chat history: role · scope · governing authority · required (L1) + on-demand (L2) refs · excluded
// (superseded/historical/out-of-scope) · sufficiency · reproducible provenance (map + source commit).
//
// Usage:  node docs/orchestration/context/build-package.mjs --scope orchestration [--commit <sha>]
// Pure of network; reads the committed map + optionally a supplied commit for provenance.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildContextPackage, lintContextMap, createContextEntry } from "../lib/contextMap.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

export function loadMap(mapPath = join(here, "context-map.json")) {
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const entries = (map.entries || []).map((e) => createContextEntry(e));
  return { map, entries };
}

export function contextPackageFor({ id = "assignment", scope = [], role = "worker", objective = null, mapPath, sourceCommit = null } = {}) {
  const { map, entries } = loadMap(mapPath);
  const health = lintContextMap(entries);
  const pkg = buildContextPackage({ assignment: { id, scope }, entries, mapVersion: map.mapSchemaVersion, sourceCommit });
  return {
    role, objective, domain: map.domain,
    protectedBoundaries: "repo-safe only; no deploy/credential/authority-expansion; the map holds pointers, not authority",
    ...pkg,
    contextHealth: health.healthy ? "HEALTHY" : health.defects,
  };
}

// CLI
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const scope = (arg("scope") || "orchestration").split(",");
  const pkg = contextPackageFor({ id: arg("id", "cli"), scope, role: arg("role", "worker"), objective: arg("objective"), sourceCommit: arg("commit") });
  process.stdout.write(JSON.stringify(pkg, null, 2) + "\n");
}
