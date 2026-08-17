#!/usr/bin/env node
// Metadata list definitions vs declared Firestore composite indexes.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §9; the Owner ruling
// on index governance; docs/reviews/gate-a-metadata-foundation.md §5, which named this
// exact gap as something Gate A does NOT settle.
//
// THE GAP THIS CLOSES. listViewDefinition.js's requiredIndexes() derives the composite
// indexes a definition demands, and it has been tested since it was written — but nothing
// called it. A rule that "metadata must not promise filter combinations the backend
// cannot serve" was therefore enforced only for definitions somebody thought to check by
// hand, which is to say it was documentation.
//
// The failure it prevents is specific: a definition declares a filter, CI is green, and
// the query fails in front of a user with a Firestore "index required" error — at read
// time, in production, on a surface nobody touched. The metadata was the thing that
// lied, and the lie was cheap to detect and was not being detected.
//
// REUSES indexKey() FROM scripts/indexDriftGuard.mjs rather than re-deriving it. Key
// normalization has one genuinely subtle rule — Firestore appends __name__ implicitly, so
// a declared index never lists it and a naive comparison reports every index as missing —
// and two implementations of that rule would eventually disagree. The one that already
// exists is also the one the deploy path trusts.
//
// USAGE
//   node scripts/listIndexCoverage.mjs           report
//   node scripts/listIndexCoverage.mjs --check   exit 1 if any demand is undeclared (CI)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexKey } from "./indexDriftGuard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEXES_PATH = path.join(REPO_ROOT, "firestore.indexes.json");

/** Declared composite indexes, as the repository states them. */
export function readDeclaredIndexes(file = INDEXES_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return raw.indexes ?? [];
}

/**
 * Compare what list definitions demand against what the repository declares.
 *
 * `demands` is [{ index, listId }] as produced by requiredIndexes(). Returned separately
 * from a boolean so a caller can report WHICH list caused an undeclared demand — "some
 * index is missing" is not actionable, "account.index needs status+updatedAt" is.
 */
export function findUncoveredDemands(demands, declared) {
  const have = new Set((declared ?? []).map(indexKey));
  return (demands ?? []).filter((d) => !have.has(indexKey(d)));
}

/** Human-readable shape of an index, for an error a reader can act on without tooling. */
export function describeIndex(index) {
  const fields = (index.fields ?? [])
    .map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig ?? "ASC"}`)
    .join(", ");
  return `${index.collectionGroup}: ${fields}`;
}

/**
 * Report coverage.
 *
 * Entities and lists are passed IN rather than imported, because this script lives in
 * scripts/ (Node, repo root) while definitions live in field-ops-app-vite/src/metadata/.
 * A cross-package import here would work today and become a build-tooling question the
 * moment the frontend moves — the same trade the access-contract generator declined.
 */
export function reportCoverage({ demands = [], declared = [] } = {}) {
  const uncovered = findUncoveredDemands(demands, declared);
  return Object.freeze({
    demandCount: demands.length,
    declaredCount: declared.length,
    uncovered: Object.freeze(uncovered),
    covered: demands.length - uncovered.length,
  });
}

// The definitions registered today. Deliberately explicit rather than glob-discovered:
// a list that nobody added here is invisible to this check, and an explicit empty list
// makes that visible instead of implying coverage nobody verified.
//
// EMPTY IS THE HONEST STATE RIGHT NOW. The contracts exist and the runtimes exist, but no
// ListViewDefinition has been authored for a real surface yet — Customers is the first,
// and it is still queued behind the grid. Reporting "0 demands, 0 uncovered" is true;
// reporting nothing at all would let this script look like it was passing when it was
// merely idle.
export const REGISTERED_LIST_DEMANDS = Object.freeze([]);

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const check = process.argv.includes("--check");
  const declared = readDeclaredIndexes();
  const report = reportCoverage({ demands: REGISTERED_LIST_DEMANDS, declared });

  if (report.uncovered.length) {
    console.error(`Undeclared composite indexes required by list definitions (${report.uncovered.length}):`);
    for (const d of report.uncovered) {
      console.error(`  - required by ${d.requiredBy ?? "(unknown list)"}`);
      console.error(`      ${describeIndex(d)}`);
    }
    console.error("\nAdd them to firestore.indexes.json, or narrow the list definition's declared filters.");
    console.error("A declared filter is a promise the query layer has to keep.");
    if (check) process.exit(1);
  } else if (report.demandCount === 0) {
    console.log(
      `No list definitions are registered yet (${report.declaredCount} composite indexes declared). ` +
        "Nothing to check — this is idle, not passing."
    );
  } else {
    console.log(`All ${report.demandCount} list index demand(s) are declared (${report.declaredCount} indexes total).`);
  }
}
