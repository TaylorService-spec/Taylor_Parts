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

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const L0_PATH = "docs/orchestration/context/EOS-BOOTSTRAP.md";

function arg(name, fb = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb;
}

const bytesOf = (repoRelPath) => { try { return statSync(join(REPO, repoRelPath)).size; } catch { return 0; } };

/**
 * Build the full cold-start bootstrap. `currentState` is loaded from the committed pointer when fresh,
 * else regenerated (stale-guard). Pure `assembleBootstrap` does the composition + cost.
 */
export function coldStart({ id = "cold-start", scope = ["orchestration"], sourceCommit = null } = {}) {
  const { entries } = loadMap();
  const pkg = contextPackageFor({ id, scope, role: "cold-start worker", sourceCommit });

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

  return assembleBootstrap({ entries, pkg, scope, currentState, sizes: { l0Bytes, pointerBytes, l1Bytes, governingAuthorityBytes }, l0Path: L0_PATH });
}

// CLI
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const scope = (arg("scope") || "orchestration").split(",");
  const boot = coldStart({ id: arg("id", "cli"), scope, sourceCommit: arg("commit") });
  process.stdout.write(JSON.stringify(boot, null, 2) + "\n");
}

// re-export for tests/consumers that want the pure derivation without file I/O
export { deriveCurrentState };
