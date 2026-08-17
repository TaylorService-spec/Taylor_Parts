#!/usr/bin/env node
// EOS shared access contracts — deterministic generator.
//
// PROBLEM. Several access/ modules exist twice: once under functions/src/access/
// (the enforcement side) and once under field-ops-app-vite/src/access/ (so the UI
// can reason about the same catalog without a round trip). There is no shared-module
// tooling — no root package.json, no workspaces — and introducing some would mean
// widening the Functions tsconfig rootDir and changing what `firebase deploy` packages,
// against a manual, un-CI-gated deploy pipeline. That trade is worse than the problem.
//
// So the copies stay, but they stop being hand-maintained.
//
// WHY THE HEADERS HAD TO CHANGE FIRST. Before this, the ONLY difference between each
// pair was a self-referential sentence in which each copy named the OTHER copy's path
// — plus the wrap point of that sentence, since the two paths differ in length. That
// difference existed solely because the text pointed at a location. A generator could
// have been written to substitute the path and re-wrap the paragraph, but that means
// teaching a script to reflow prose, and the reflow is only needed because the prose
// encodes a pathname. Removing the pathname removes the whole class of problem: the
// bodies become byte-identical, generation becomes a copy, and verification becomes
// byte equality with no normalization to get subtly wrong.
//
// CONTRACT.
//   - functions/src/access/<name>.ts is CANONICAL. Edit it.
//   - field-ops-app-vite/src/access/<name>.ts is GENERATED: a banner, then the
//     canonical body verbatim. Never edit it.
//   - Generation is deterministic: same input, same bytes, no timestamps, no ordering
//     dependence. A generator whose output drifts on its own cannot be CI-verified.
//
// USAGE
//   node scripts/syncAccessContracts.mjs            regenerate the client copies
//   node scripts/syncAccessContracts.mjs --check    verify, exit 1 on drift (CI)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Modules whose two copies are byte-identical apart from the banner.
 *
 * DELIBERATELY EXCLUDED, with reasons, because a silent omission here looks identical
 * to an oversight and this list is the thing a reviewer checks:
 *
 *   permissionCatalog.ts — the client copy carries independently abbreviated comment
 *     wording (roughly 30 lines' worth). The existing parity test strips comments, so
 *     the divergence is real but invisible to it. Generating would rewrite those
 *     comments to the server's fuller text: behavior-neutral, but a substantial diff in
 *     the most authorization-sensitive file in the repo, and it deserves its own review
 *     rather than arriving as a side effect of introducing a generator.
 *
 * parityFixtures.ts IS synced, but through a declared substitution — see
 * PLATFORM_SUBSTITUTIONS. It is the one legitimate case: the difference is a real SDK
 * boundary (firebase-admin vs firebase), not an artificial one invented by the text
 * itself, so removing it is not an option the way removing a pathname was.
 */
export const SYNCED_MODULES = Object.freeze([
  "compactClaims.ts",
  "compatibilityRoles.ts",
  "resolveEffectivePermission.ts",
  "governedBusinessRoles.ts",
  "shadowParityHarness.ts",
  "legacyAuthorizationSurface.ts",
  "parityFixtures.ts",
]);

const CANONICAL_DIR = path.join("functions", "src", "access");
const GENERATED_DIR = path.join("field-ops-app-vite", "src", "access");

/**
 * The generated-file banner. Neutral: it describes provenance, not a pathname pair,
 * so it never becomes a reason for the two bodies to differ.
 */
export const GENERATED_BANNER = [
  "// GENERATED FILE — DO NOT EDIT.",
  "//",
  "// Generated from the canonical EOS access contract by scripts/syncAccessContracts.mjs.",
  "// Edit the canonical source under functions/src/access/ and re-run the generator;",
  "// edits made here are overwritten and CI fails on drift.",
  "",
  "",
].join("\n");

/**
 * Declared platform substitutions, applied to the GENERATED copy only.
 *
 * The bar for adding an entry here is deliberately narrower than "the two copies
 * differ": a substitution is legitimate only when the difference is a real platform
 * boundary that cannot be removed. The self-referential pathnames this generator
 * replaced were NOT that — they differed only because the prose named a location, so
 * the fix was to stop naming it. A firebase-admin vs firebase import is different in
 * kind: the server genuinely cannot import the web SDK's type.
 *
 * Every rule must actually apply. A rule whose `canonical` string is absent means the
 * canonical file moved on and the rule is stale — and a silently-skipped substitution
 * emits a client module importing firebase-admin, which fails at build time far from
 * its cause. `generate` throws instead of quietly producing that.
 */
export const PLATFORM_SUBSTITUTIONS = Object.freeze({
  "parityFixtures.ts": Object.freeze([
    Object.freeze({
      canonical: 'import type { Timestamp } from "firebase-admin/firestore";',
      generated: 'import type { Timestamp } from "firebase/firestore";',
      why: "the server uses the Admin SDK's Timestamp type; the client uses the web SDK's",
    }),
  ]),
});

/** Deterministic: banner + canonical body (with any declared substitutions), LF-normalized. */
export function generate(canonicalSource, moduleFile = null) {
  let body = canonicalSource.replace(/\r\n/g, "\n");
  for (const rule of PLATFORM_SUBSTITUTIONS[moduleFile] ?? []) {
    if (!body.includes(rule.canonical)) {
      throw new Error(
        `syncAccessContracts: stale substitution for ${moduleFile} — canonical text not found: ${rule.canonical}`,
      );
    }
    body = body.split(rule.canonical).join(rule.generated);
  }
  return GENERATED_BANNER + body;
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function syncAll({ check = false, root = REPO_ROOT } = {}) {
  const drift = [];
  const written = [];

  for (const moduleFile of SYNCED_MODULES) {
    const canonicalPath = path.join(root, CANONICAL_DIR, moduleFile);
    const generatedPath = path.join(root, GENERATED_DIR, moduleFile);

    const canonical = readIfExists(canonicalPath);
    if (canonical === null) {
      drift.push(`${moduleFile}: canonical source missing at ${CANONICAL_DIR}/${moduleFile}`);
      continue;
    }

    const expected = generate(canonical, moduleFile);
    const actual = readIfExists(generatedPath);
    const actualNormalized = actual === null ? null : actual.replace(/\r\n/g, "\n");

    if (actualNormalized === expected) continue;

    if (check) {
      drift.push(
        actual === null
          ? `${moduleFile}: generated copy missing at ${GENERATED_DIR}/${moduleFile}`
          : `${moduleFile}: generated copy differs from the canonical source`
      );
    } else {
      fs.writeFileSync(generatedPath, expected, "utf8");
      written.push(moduleFile);
    }
  }
  return { drift, written };
}

// Only run when invoked directly, so tests can import the pure parts.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const check = process.argv.includes("--check");
  const { drift, written } = syncAll({ check });

  if (check) {
    if (drift.length) {
      console.error(`Access contract drift (${drift.length}):`);
      for (const d of drift) console.error(`  - ${d}`);
      console.error("\nRun: node scripts/syncAccessContracts.mjs");
      process.exit(1);
    }
    console.log(`Access contracts in sync (${SYNCED_MODULES.length} modules).`);
  } else {
    console.log(
      written.length
        ? `Regenerated ${written.length} of ${SYNCED_MODULES.length}: ${written.join(", ")}`
        : `Already in sync (${SYNCED_MODULES.length} modules).`
    );
  }
}
