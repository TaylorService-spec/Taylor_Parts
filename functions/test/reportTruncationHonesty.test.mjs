// W1-C16 -- truncation honesty for the governed report engine.
//
// Pins census rule X-9 (docs/assessments/eos-dashboard-reporting-authority-census.md,
// recorded there as BINDING, with the FIN-004 precedent it cites):
//
//   "A bounded read may return a page and say so; a TOTAL may not --
//    bounding an aggregate produces a number smaller than the truth
//    while still labelled 'Total', which is worse than the slow
//    unbounded read it replaced."
//   "...an A/R page that would truncate renders 'unavailable', never a
//    partial 'ready'."
//
// reportExecutionService.ts fetches at most `maxScanDocs` documents and
// then filters/groups/aggregates IN MEMORY. Before this change, a scan
// that hit that bound still produced sum/avg/min/max/count/countRows
// values -- computed from an arbitrary partial population, returned as
// the aggregate's value, with only a `truncated: true` boolean beside
// them. Worse, `kind` did not reliably carry even that: "empty" (no row
// in the truncated slice matched) and "partially-authorized" (a column
// was dropped) both outrank "truncated-widened" in the kind ladder, so
// the understated total could arrive labelled "no results".
//
// NO EMULATOR REQUIRED. The X-9 decision is a pure function by design
// (reportExecutionService.ts's own stated architecture: "every
// authorization/projection/limit DECISION is made by small,
// independently testable pure helper functions"), so the rule itself is
// tested here without Firestore. The end-to-end refusal is exercised in
// reportExecutionService.test.mjs, which needs a live Firestore
// emulator on 127.0.0.1:8080.
//
// Prerequisite: `npm run build` in functions/ first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  judgeScanCompleteness,
  IncompleteAggregateScanError,
  MAX_RESULT_ROWS,
  MAX_GROUP_CARDINALITY,
  MAX_SCAN_DOCS,
} from "../lib/reporting/reportExecutionService.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = join(HERE, "..", "src", "reporting", "reportExecutionService.ts");
const CALLABLE_SRC = join(HERE, "..", "src", "reporting", "runReportDefinitionCallable.ts");

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

test("a truncated scan with aggregates is REFUSED -- a bounded total is never returned", () => {
  assert.equal(
    judgeScanCompleteness({ scanTruncated: true, hasAggregates: true }),
    "refuse-incomplete-total",
  );
});

test("a truncated scan WITHOUT aggregates is a bounded page -- a list may page and say so", () => {
  assert.equal(
    judgeScanCompleteness({ scanTruncated: true, hasAggregates: false }),
    "bounded-page",
  );
});

test("an untruncated scan is complete, with or without aggregates", () => {
  assert.equal(judgeScanCompleteness({ scanTruncated: false, hasAggregates: true }), "complete");
  assert.equal(judgeScanCompleteness({ scanTruncated: false, hasAggregates: false }), "complete");
});

test("the verdict depends on nothing but the scan bound and the presence of aggregates", () => {
  // Guards against a future edit that quietly re-admits a bounded total
  // for some special case (a "small enough" overrun, a particular
  // aggregate fn, a grouped-vs-ungrouped distinction). Scan truncation
  // corrupts every aggregate function equally, because it cuts the
  // POPULATION before any of them run.
  for (const scanTruncated of [true, false]) {
    for (const hasAggregates of [true, false]) {
      const first = judgeScanCompleteness({ scanTruncated, hasAggregates });
      const second = judgeScanCompleteness({ scanTruncated, hasAggregates });
      assert.equal(first, second, "the judgement is pure and total");
      assert.ok(
        ["complete", "bounded-page", "refuse-incomplete-total"].includes(first),
        `unexpected verdict ${first}`,
      );
    }
  }
});

test("refusal is an Error subclass, so a caller can catch this reason specifically", () => {
  const err = new IncompleteAggregateScanError("x");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof IncompleteAggregateScanError);
});

// ---------------------------------------------------------------------------
// The caps this rule is about are still the caps the service ships
// ---------------------------------------------------------------------------

test("the scan bound is real and above the row cap -- the refusal is not a routine occurrence", () => {
  assert.equal(MAX_RESULT_ROWS, 10_000);
  assert.equal(MAX_GROUP_CARDINALITY, 1_000);
  assert.equal(MAX_SCAN_DOCS, MAX_RESULT_ROWS * 2);
  assert.ok(MAX_SCAN_DOCS > MAX_RESULT_ROWS, "a run must be able to page rows without tripping the scan bound");
});

// ---------------------------------------------------------------------------
// Structural: the refusal must happen BEFORE anything partial exists,
// and must survive the trip through the callable
// ---------------------------------------------------------------------------

test("the service refuses before it joins, filters, groups or aggregates anything", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  const refusalAt = src.indexOf("throw new IncompleteAggregateScanError(");
  assert.ok(refusalAt > 0, "the refusal must exist in the service");

  // Everything that could produce a partial figure must come AFTER the
  // refusal point in runReportDefinition's body. If a future edit moves
  // the check down past any of these, a truncated aggregate becomes
  // reachable again.
  for (const marker of [
    "await joinRelatedDocs(",
    "const filtered = joinedRaw.filter(",
    "groupDocuments(filtered",
    "computeAggregate(rows",
  ]) {
    const at = src.indexOf(marker);
    assert.ok(at > 0, `expected to find ${marker} in the service`);
    assert.ok(
      at > refusalAt,
      `${marker} must run AFTER the X-9 refusal, otherwise a partial aggregate can be computed before the run is refused`,
    );
  }
});

test("a refused run is audited exactly like the object-gate denial, with no row data in the summary", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  const refusalAt = src.indexOf("throw new IncompleteAggregateScanError(");
  const auditAt = src.lastIndexOf("recordStandaloneAuditEvent({", refusalAt);
  assert.ok(auditAt > 0 && auditAt < refusalAt, "the refusal must be audited before it throws");

  const block = src.slice(auditAt, refusalAt);
  assert.match(block, /outcome: "denied"/, "a refused run is a denied outcome");
  assert.match(block, /action: "runReportDefinition"/);
  assert.match(block, /truncated: true/);
  // The summary is a fixed template over the objectId only -- never a
  // filter value, a field's content, or anything read from a document
  // (the module header's standing rule for every audit summary here).
  const summary = block.match(/summary: `([^`]*)`/);
  assert.ok(summary, "the refusal audit event must carry a summary");
  const interpolations = summary[1].match(/\$\{[^}]*\}/g) ?? [];
  assert.deepEqual(
    interpolations, ["${objectId}"],
    "the refusal summary may interpolate the objectId and nothing else",
  );
});

test("the callable maps the refusal to resource-exhausted, not to a success or a generic internal", () => {
  const src = readFileSync(CALLABLE_SRC, "utf8");
  assert.match(src, /IncompleteAggregateScanError/);
  assert.match(
    src,
    /if \(err instanceof IncompleteAggregateScanError\) \{\s*\n\s*throw new HttpsError\("resource-exhausted", err\.message\);/,
    "a refused aggregate must surface as its own code, distinguishable from invalid-argument and internal",
  );
});
