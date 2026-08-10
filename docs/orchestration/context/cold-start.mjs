// C-7 cold-start driver — the ONE deterministic command a fresh EOS session runs instead of
// reconstructing state by archaeology.
//
//   node docs/orchestration/context/cold-start.mjs --scope <domain> [--id <assignment>] [--commit <sha>]
//
// It composes the three cheap layers and prints a single bootstrap object:
//   L0 operating contract (pointer) · current-state pointer · C-7 context package (refs) ·
//   authority-first gate · governed-subjects-outside-scope checklist · COLD_START_CONTEXT_COST.
// It reads only tiny files (the L0 card, the pointer, the map). L1 authorities are RETRIEVED BY THE
// WORKER on need — the driver measures their size but does not inline them. No network, no deploy.

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMap, contextPackageFor } from "./build-package.mjs";
import { assembleBootstrap } from "../lib/coldStart.mjs";
import { deriveCurrentState, generateCurrentState } from "./current-state.mjs";
import { assembleReanchor } from "../lib/reanchor.mjs";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const L0_PATH = "docs/orchestration/context/EOS-BOOTSTRAP.md";

function arg(name, fb = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb;
}
const flag = (name) => process.argv.includes(`--${name}`);

const bytesOf = (repoRelPath) => { try { return statSync(join(REPO, repoRelPath)).size; } catch { return 0; } };

/**
 * Build the full cold-start bootstrap. `currentState` is loaded from the committed pointer when fresh,
 * else regenerated (stale-guard). Pure `assembleBootstrap` does the composition + cost.
 */
// Shared bootstrap build — the entries, package, live current-state pointer, and exact sizes. Both
// coldStart() and reanchor() consume this so re-anchor reuses the SAME context path (no second
// mechanism, no duplicated size logic).
function buildBootstrapContext({ id = "cold-start", scope = ["orchestration"], role = "cold-start worker", sourceCommit = null } = {}) {
  const { entries } = loadMap();
  const pkg = contextPackageFor({ id, scope, role, sourceCommit });

  // current-state pointer: ALWAYS recompute live when git + the backlog are available (cheap: one
  // file read + two `git rev-parse`), so freshness reflects the real repo — never a stored field
  // that was frozen "CURRENT" at generation. Fall back to the committed snapshot only offline.
  let currentState = null;
  try {
    currentState = generateCurrentState();
  } catch {
    try { currentState = JSON.parse(readFileSync(join(here, "current-state.json"), "utf8")); } catch { currentState = null; }
  }

  // Exact byte sizes. Orientation = L0 card + pointer + the ONE governing authority. The required L1
  // set is measured as an upper bound (refs, read on need) — not front-loaded.
  const l0Bytes = bytesOf(L0_PATH);
  const pointerBytes = currentState ? Buffer.byteLength(JSON.stringify(currentState, null, 2)) : bytesOf("docs/orchestration/context/current-state.json");
  const l1Bytes = (pkg.required || []).reduce((sum, r) => sum + bytesOf(r.retrievalPath), 0);
  const governingRef = [...(pkg.required || []), ...(pkg.onDemand || [])].find((r) => r.id === pkg.governingAuthority);
  const governingAuthorityBytes = governingRef ? bytesOf(governingRef.retrievalPath) : 0;

  return { entries, pkg, currentState, scope, sizes: { l0Bytes, pointerBytes, l1Bytes, governingAuthorityBytes } };
}

export function coldStart({ id = "cold-start", scope = ["orchestration"], sourceCommit = null } = {}) {
  const { entries, pkg, currentState, sizes } = buildBootstrapContext({ id, scope, sourceCommit });
  return assembleBootstrap({ entries, pkg, scope, currentState, sizes, l0Path: L0_PATH });
}

// Offline, deterministic durable facts for drift detection, derived from LOCAL git only (no network):
//   mergedPrNumbers — `(#NNN)` squash-merge markers in origin/main's history (so "remembered PR open
//                     vs durable merged" is comparable without hitting GitHub).
function gitMergedPrNumbers(limit = 400) {
  try {
    const log = execSync(`git log origin/main -n ${limit} --pretty=%s`, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const nums = new Set();
    for (const m of log.matchAll(/\(#(\d+)\)/g)) nums.add(Number(m[1]));
    return [...nums];
  } catch { return []; }
}

/**
 * RE-ANCHOR — realign a compacted session to CURRENT durable truth by REUSING the cold-start
 * bootstrap. `remembered` (optional) is the compressed-session claims object; drift is compared
 * deterministically against durable facts. `cont` selects RE-ANCHOR AND CONTINUE vs ONLY. Re-anchor
 * never grants authority; continuation is governed by the durable selector.
 */
export function reanchor({ id = "reanchor", scope = ["orchestration"], sourceCommit = null, remembered = null, continue: cont = false } = {}) {
  const { entries, pkg, currentState, sizes } = buildBootstrapContext({ id, scope, role: "reanchor worker", sourceCommit });
  const boot = assembleBootstrap({ entries, pkg, scope, currentState, sizes, l0Path: L0_PATH });
  const supersededDecisionIds = entries.filter((e) => e && e.kind === "decision" && (e.lifecycle !== "current" || e.supersededBy)).map((e) => e.id);
  return assembleReanchor({
    boot, entries, scope, remembered,
    durableExtras: { mergedPrNumbers: gitMergedPrNumbers(), supersededDecisionIds },
    continue: cont, sizes,
  });
}

// CLI
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const scope = (arg("scope") || "orchestration").split(",");
  if (flag("reanchor")) {
    // Optional remembered-claims file: --remembered <path.json>. Absent → re-anchor to durable truth
    // with no drift comparison (the honest fallback when remembered state is not deterministically
    // comparable). --continue selects RE-ANCHOR AND CONTINUE.
    let remembered = null;
    const rp = arg("remembered");
    if (rp) { try { remembered = JSON.parse(readFileSync(rp, "utf8")); } catch { remembered = null; } }
    const out = reanchor({ id: arg("id", "cli"), scope, sourceCommit: arg("commit"), remembered, continue: flag("continue") });
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    const boot = coldStart({ id: arg("id", "cli"), scope, sourceCommit: arg("commit") });
    process.stdout.write(JSON.stringify(boot, null, 2) + "\n");
  }
}

// re-export for tests/consumers that want the pure derivation without file I/O
export { deriveCurrentState };
