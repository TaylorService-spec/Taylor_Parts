// C-7 current-state POINTER generator.
//
// Emits `current-state.json` — a tiny, deterministic POINTER/INDEX (not a second authority and not
// narrative state). It records source provenance + control-plane version pointers, and a small
// DERIVED digest (READY set, Owner gates, protected actions, active assignments) mechanically
// extracted from the execution-backlog AUTHORITY. The backlog governs; this file indexes it, exactly
// as `roadmap/ROADMAP.md` projects `roadmapModel.mjs`. Stale-guard: `generatedFromCommit` — if it is
// behind `origin/main`, regenerate before trusting the derived lists.
//
// Usage:  node docs/orchestration/context/current-state.mjs [--write]   (default: print to stdout)
// Pure of network. `deriveCurrentState()` is a pure function unit-tested against the committed backlog.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const BACKLOG = join(here, "..", "execution-backlog.md");
const MAP = join(here, "context-map.json");

// Sections we index, and the AUTHORITY row-anchor each points back to. Item labels are extracted from
// the column literally headed "Item" (READY puts "Item" in column 2; the rest in column 1 — we detect
// it, so table shape changes don't silently mis-extract).
const SECTIONS = Object.freeze([
  { header: "READY", key: "readyItemIds" },
  { header: "RUNNING", key: "activeAssignmentIds" },
  { header: "OWNER_DECISION", key: "ownerDecisionIds" },
  { header: "PROTECTED_ACTION", key: "protectedActionIds" },
  { header: "BLOCKED_DEPENDENCY", key: "blockedIds" },
]);

const cleanCell = (s) =>
  (s || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [txt](url) → txt
    .replace(/[`*]/g, "")                     // backticks / bold
    .replace(/\s+/g, " ")
    .trim();

const isStruck = (s) => /^~~.*~~$/.test((s || "").trim());       // resolved rows are struck through
const isEmptyItem = (s) => !s || /^(—|-|\*\(none\)\*|\(none\))$/i.test(s.trim());

// Extract the "Item" column of the FIRST markdown table inside a `## HEADER` (or `### HEADER`) block.
export function extractSectionItems(backlogText, header) {
  const lines = backlogText.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^#{2,3}\\s+${header}\\b`).test(l));
  if (start === -1) return [];
  const items = [];
  let headerCols = null;
  let itemIdx = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{2,3}\s+/.test(line) || /^---\s*$/.test(line)) break; // next section
    if (!line.trim().startsWith("|")) continue;                  // not a table row
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // separator row
    if (!headerCols) {                                            // first table row = header
      headerCols = cells.map((c) => c.toLowerCase());
      const found = headerCols.indexOf("item");
      itemIdx = found === -1 ? 0 : found;
      continue;
    }
    const raw = cells[itemIdx] ?? cells[0] ?? "";
    if (isStruck(raw)) continue;                                 // resolved — excluded
    const cleaned = cleanCell(raw);
    if (isEmptyItem(cleaned)) continue;
    items.push(cleaned.length > 140 ? cleaned.slice(0, 137) + "…" : cleaned);
  }
  return items;
}

/**
 * Pure derivation: given the backlog text + provenance + map version, produce the pointer object.
 * No I/O — the same output for the same inputs (reproducible).
 */
export function deriveCurrentState({ backlogText = "", sourceCommit = null, originMainCommit = null, mapVersion = null } = {}) {
  const derived = {};
  for (const s of SECTIONS) derived[s.key] = extractSectionItems(backlogText, s.header);
  derived.ownerGateIds = [...derived.ownerDecisionIds, ...derived.protectedActionIds];

  const freshness = !sourceCommit || !originMainCommit ? "UNKNOWN"
    : sourceCommit === originMainCommit ? "CURRENT" : "BEHIND_OR_DIVERGED";

  return {
    pointer: "EOS-CURRENT-STATE/1.0.0",
    note: "POINTER/INDEX only — the execution-backlog is the authority; this is a generated digest with provenance. Not a second state store. Regenerate when generatedFromCommit is behind origin/main.",
    provenance: { sourceCommit, generatedFromCommit: sourceCommit, originMainCommit, freshness, mapVersion },
    authorities: {
      operatingMode: "AGENTS.md + docs/DelegationCharter.md §8",
      runModel: "docs/orchestration/continuous-workstream-orchestrator.md",
      currentStateAuthority: "docs/orchestration/execution-backlog.md",
      selector: "docs/orchestration/lib/selectNextWork.mjs",
      roadmap: "docs/orchestration/lib/roadmapModel.mjs",
      contextMap: "docs/orchestration/context/context-map.json",
    },
    derived,
    selectorHint: derived.readyItemIds.length === 0
      ? "No READY item in the backlog — the last selection reached a legitimate terminal CHECKPOINT. A DIRECTED assignment overrides this; do not manufacture autonomous work."
      : `${derived.readyItemIds.length} READY item(s) — run the selector for the next-eligible pick.`,
  };
}

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
}

export function generateCurrentState() {
  const backlogText = readFileSync(BACKLOG, "utf8");
  const mapVersion = JSON.parse(readFileSync(MAP, "utf8")).mapSchemaVersion || null;
  const sourceCommit = git("rev-parse HEAD");
  const originMainCommit = git("rev-parse origin/main");
  return deriveCurrentState({ backlogText, sourceCommit, originMainCommit, mapVersion });
}

// CLI
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const state = generateCurrentState();
  const json = JSON.stringify(state, null, 2) + "\n";
  if (process.argv.includes("--write")) {
    writeFileSync(join(here, "current-state.json"), json);
    process.stderr.write(`wrote current-state.json @ ${state.provenance.sourceCommit} (${state.provenance.freshness})\n`);
  } else {
    process.stdout.write(json);
  }
}
