// OBJECT LIST METADATA AUTHORITY — the boundary, as a build failure.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md.
//
// ============================ WHY A GUARD AND NOT A NOTE ============================
//
// A parallel architecture is not built on purpose. It is built by somebody who did not know the
// canonical one existed — which is exactly how `src/domain/fieldMetadata.js` came to duplicate five
// entity definitions that already had canonical equivalents, and how `/inventory` and
// `/inventory/part-master` ended up as two Parts lists on two list systems.
//
// The retired modules are deleted, so nothing can import them. What this file protects is the
// SECOND-ORDER failure: somebody re-creating the same shape under a different name, or adding a
// thirty-first object definition somewhere other than the canonical registry. Neither breaks a test
// today; both are found in a review six months later, if at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SRC, p).split("\\").join("/");
const files = walk(SRC);

// ─────────────────────────────────────────────────────────────────────────────── retirement

/**
 * The duplicate architecture, by path.
 *
 * Deletion over deprecation, on purpose: a "deprecated but still usable" parallel system is the one
 * the next person finds first, because it is the one that still works.
 */
const RETIRED = [
  "domain/fieldMetadata.js",
  "domain/objectFields.js",
  "domain/purchaseOrderFields.js",
  "domain/partFields.js",
  "domain/listQueryState.js",
  "shared/ui/ListControls.jsx",
];

test("the duplicate object-list metadata architecture is GONE, not deprecated", () => {
  for (const r of RETIRED) {
    assert.equal(existsSync(path.join(SRC, r)), false, `${r} still exists — deletion, not deprecation`);
  }
});

test("nothing imports a retired module", () => {
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const r of RETIRED) {
      const bare = r.replace(/\.(jsx?|tsx?)$/, "");
      const leaf = bare.split("/").pop();
      // Matches `from ".../partFields.js"` and `from ".../partFields"` alike.
      if (new RegExp(`from\\s+["'][^"']*/${leaf}(\\.jsx?)?["']`).test(src)) {
        offenders.push(`${rel(f)} -> ${r}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `retired modules must have no importers:\n  ${offenders.join("\n  ")}`);
});

// ─────────────────────────────────────────────────────────────────────────────── one authority

test("entity definitions live ONLY under src/metadata/definitions", () => {
  // The shape of a definition, not its name: `makeEntityDefinition(` is the constructor, and a copy
  // of this architecture elsewhere would have to call something like it.
  const offenders = files
    .filter((f) => !rel(f).startsWith("metadata/"))
    .filter((f) => /makeEntityDefinition\s*\(/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(
    offenders, [],
    `an EntityDefinition outside src/metadata/definitions is a second object model:\n  ${offenders.join("\n  ")}`,
  );
});

test("list view definitions live ONLY under src/metadata", () => {
  const offenders = files
    .filter((f) => !rel(f).startsWith("metadata/"))
    .filter((f) => /makeListViewDefinition\s*\(/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, [], `a ListViewDefinition outside src/metadata:\n  ${offenders.join("\n  ")}`);
});

test("there is ONE filter UI and ONE sort UI", () => {
  // A second "+ Add Filter" is how two filter systems end up on one screen — which is what mounting
  // the pilot's controls on an already-metadata-driven Account list would have done.
  const offenders = files
    .filter((f) => rel(f) !== "metadata/MetadataListControls.jsx")
    .filter((f) => /\+ Add Filter/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, [], `a second filter builder:\n  ${offenders.join("\n  ")}`);
});

test("there is ONE URL-state layer for list criteria", () => {
  const offenders = files
    .filter((f) => rel(f) !== "metadata/listUrlState.js")
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      // A module that both writes and reads list criteria to a query string is a second URL layer.
      return /export function toSearchParams/.test(src) && /export function fromSearchParams/.test(src);
    })
    .map(rel);
  assert.deepEqual(offenders, [], `a second list-criteria URL layer:\n  ${offenders.join("\n  ")}`);
});

// ─────────────────────────────────────────────────────────────────────────────── query honesty

test("no screen builds Firestore query constraints for a list of its own", () => {
  // §18: a list query is the runtime's to shape. A component assembling where()/orderBy()/limit()
  // itself is making a promise no index coverage check ever saw. Services translate a DESCRIPTOR;
  // modules must not translate criteria.
  const offenders = files
    .filter((f) => rel(f).startsWith("modules/"))
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from\s+["']firebase\/firestore["']/.test(src) && /\borderBy\s*\(/.test(src) && /\blimit\s*\(/.test(src);
    })
    .map(rel);
  assert.deepEqual(
    offenders, [],
    `a module building its own bounded query:\n  ${offenders.join("\n  ")}`,
  );
});
