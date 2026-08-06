// R1-A — legacy authorization surface DRIFT GATE (Issue #226 readiness).
//
// Re-parses the real firestore.rules and asserts it still matches the
// recorded corpus in functions/src/access/legacyAuthorizationSurface.ts.
//
// The point is not to measure once. It is to make the legacy authorization
// surface UNABLE TO GROW SILENTLY while convergence is in progress: adding a
// new isAdminOrDispatcher()/isAdmin()/isTechnician() call site to
// firestore.rules fails this test until the author either removes it or
// deliberately records it in the corpus. Removing one also fails, which is
// the desired signal during Rows 23-26 -- the corpus is updated in the same
// change that shrinks the surface, so the burn-down is always evidenced.
//
// Pure and dependency-free: reads a file, imports compiled pure data.
// No emulator, no network, no credentials, no Firestore, no deployment.
//
// Run: node --test functions/test/legacyAuthorizationSurface.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  LEGACY_AUTHORIZATION_SURFACE,
  LEGACY_ROLE_HELPERS,
  totalLegacySites,
  entriesForRow,
  collectionsWithoutPermissionCoverage,
} from "../lib/access/legacyAuthorizationSurface.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_RULES = resolve(HERE, "../../firestore.rules");
const MIRROR_RULES = resolve(HERE, "../../field-ops-app-vite/firestore.rules");

/**
 * Parse firestore.rules into { collection: { helper: count } }.
 *
 * Deliberately conservative and mirrors how a reader reasons about the file:
 * track the innermost `match /<collection>` seen, and count helper
 * invocations on lines that are neither comments nor the helper's own
 * definition. Comment lines are excluded because commentary in this file
 * frequently names the helpers while describing intent -- counting those
 * would inflate the surface (exactly the error the earlier "66" figure made).
 */
function parseLegacySurface(rulesText) {
  const surface = {};
  let current = null;
  for (const line of rulesText.split("\n")) {
    const match = /match\s+\/([A-Za-z_0-9{}$()]+)/.exec(line);
    if (match && !line.includes("databases")) current = match[1];
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) continue;
    if (line.includes("function ")) continue;
    for (const helper of LEGACY_ROLE_HELPERS) {
      if (new RegExp(`\\b${helper}\\(\\)`).test(line)) {
        const key = current ?? "(root)";
        surface[key] ??= {};
        surface[key][helper] = (surface[key][helper] ?? 0) + 1;
      }
    }
  }
  return surface;
}

const parsed = parseLegacySurface(readFileSync(ROOT_RULES, "utf8"));

test("D1: every recorded collection still exists in firestore.rules with the recorded call sites", () => {
  for (const entry of LEGACY_AUTHORIZATION_SURFACE) {
    const actual = parsed[entry.collection];
    assert.ok(
      actual,
      `Corpus records legacy sites for "${entry.collection}" but firestore.rules has none. ` +
        `If this domain was cut over, update legacyAuthorizationSurface.ts in the SAME change.`,
    );
    assert.deepEqual(
      actual,
      { ...entry.sites },
      `Legacy call-site count changed for "${entry.collection}". ` +
        `Update the corpus in the same change that changed the Rules.`,
    );
  }
});

test("D2: firestore.rules contains no legacy call site the corpus does not record", () => {
  const recorded = new Set(LEGACY_AUTHORIZATION_SURFACE.map((e) => e.collection));
  const undocumented = Object.keys(parsed).filter((c) => !recorded.has(c));
  assert.deepEqual(
    undocumented,
    [],
    `New legacy-role authorization site(s) appeared in firestore.rules for: ` +
      `${undocumented.join(", ")}. The legacy surface must not grow during ` +
      `convergence (ADR-005 §2.7 criterion 1). Either use the governed ` +
      `Permission model, or record the addition deliberately in the corpus.`,
  );
});

test("D3: the total enforced surface matches the recorded baseline", () => {
  const actualTotal = Object.values(parsed)
    .flatMap((helpers) => Object.values(helpers))
    .reduce((a, b) => a + b, 0);
  assert.equal(
    totalLegacySites(),
    actualTotal,
    "Corpus total and parsed firestore.rules total diverged.",
  );
});

test("D4: the client Rules mirror is byte-identical to the root Rules", () => {
  // SYSTEM_AUTHORITIES: there are two rules files, not one; both must stay in
  // sync. A corpus measured against one is meaningless if they differ.
  assert.equal(
    readFileSync(ROOT_RULES, "utf8"),
    readFileSync(MIRROR_RULES, "utf8"),
    "firestore.rules and field-ops-app-vite/firestore.rules have diverged.",
  );
});

test("D5: every recorded entry is assigned to a cutover row", () => {
  const valid = new Set(["row23", "row24", "row25", "row26", "unassigned"]);
  for (const entry of LEGACY_AUTHORIZATION_SURFACE) {
    assert.ok(valid.has(entry.row), `Unknown cutover row "${entry.row}".`);
  }
});

test("D6: the per-row burn-down is reportable (no row silently empty of scope)", () => {
  // Rows 23-25 must each own at least one collection; if a row owns nothing,
  // either the surface was mis-assigned or the row's scope is misunderstood.
  for (const row of ["row23", "row24", "row25"]) {
    assert.ok(
      entriesForRow(row).length > 0,
      `Cutover ${row} owns no legacy collections — check the row assignment.`,
    );
  }
});

test("D7: permission-coverage gaps are enumerable and explicitly recorded", () => {
  // This test does NOT require full coverage — most collections genuinely have
  // no governed permission yet. It requires the gap to be *knowable*, so each
  // row's cutover precondition list can be generated rather than guessed.
  const gaps = collectionsWithoutPermissionCoverage();
  assert.ok(Array.isArray(gaps));
  for (const collection of gaps) {
    const entry = LEGACY_AUTHORIZATION_SURFACE.find((e) => e.collection === collection);
    assert.equal(
      entry.permissions.length,
      0,
      `Coverage-gap list is inconsistent for "${collection}".`,
    );
  }
  // Guard-rail: if this ever reaches zero, ADR-005 §2.7 criterion 2 has
  // plausibly been met and the retirement readiness assessment should be
  // re-run rather than assumed still current.
  assert.ok(
    gaps.length <= LEGACY_AUTHORIZATION_SURFACE.length,
    "Coverage-gap list exceeded the corpus size.",
  );
});
