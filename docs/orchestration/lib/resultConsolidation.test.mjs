import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidateChildResults, assertChildrenComplete } from "./resultConsolidation.mjs";

const child = (requestId, findings, extra = {}) => ({ requestId, disposition: "COMPLETE", findings, ...extra });
const f = (file, category, severity, line = null, summary = "") => ({ file, category, severity, line, summary });

test("fail-closed: a missing expected child blocks consolidation (workers exited is NOT done)", () => {
  const out = consolidateChildResults({
    parentWorkId: "P",
    expectedChildIds: ["A", "B", "C"],
    children: [child("A", [f("x.ts", "bug", "HIGH")]), child("B", [])],
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, ["C"]);
});

test("fail-closed: an incomplete/failed child blocks consolidation", () => {
  const out = consolidateChildResults({
    parentWorkId: "P",
    expectedChildIds: ["A", "B"],
    children: [child("A", [f("x.ts", "bug", "HIGH")]), { requestId: "B", disposition: "FAILED", findings: [] }],
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.incomplete, ["B"]);
});

test("dedupe: the same finding from multiple children collapses to one, counted as an agreement", () => {
  const out = consolidateChildResults({
    expectedChildIds: ["A", "B", "C"],
    children: [
      child("A", [f("src/a.ts", "bug", "HIGH", 10)]),
      child("B", [f("src/a.ts", "BUG", "HIGH", 10)]), // same file+line+category (case-insensitive) → same finding
      child("C", [f("src/b.ts", "perf", "LOW", 5)]),
    ],
  });
  assert.equal(out.ok, true);
  assert.equal(out.counts.unique, 2, "two distinct findings after dedup");
  assert.equal(out.counts.duplicatesRemoved, 1, "one duplicate collapsed");
  const agreed = out.agreements.find((x) => x.file === "src/a.ts");
  assert.deepEqual(agreed.agreedBy.sort(), ["A", "B"], "both children credited");
});

test("conflict: children disagreeing on severity for the same finding are surfaced with both values", () => {
  const out = consolidateChildResults({
    expectedChildIds: ["A", "B"],
    children: [child("A", [f("src/a.ts", "bug", "HIGH", 1)]), child("B", [f("src/a.ts", "bug", "MEDIUM", 1)])],
  });
  assert.equal(out.counts.conflicts, 1);
  assert.deepEqual(out.conflicts[0].severities.sort(), ["HIGH", "MEDIUM"]);
  assert.equal(out.conflicts[0].severity, "HIGH", "canonical severity is the worst of the disagreement");
});

test("cross-sector risk: one finding surfaced by children in DIFFERENT sectors", () => {
  const out = consolidateChildResults({
    expectedChildIds: ["A", "B"],
    children: [
      child("A", [f("src/shared.ts", "bug", "HIGH", 3)], { sector: "inventory" }),
      child("B", [f("src/shared.ts", "bug", "HIGH", 3)], { sector: "work-orders" }),
    ],
  });
  assert.equal(out.counts.crossSectorRisks, 1);
  assert.deepEqual(out.crossSectorRisks[0].sectors.sort(), ["inventory", "work-orders"]);
});

test("deterministic ordering: worst severity first, then key ascending", () => {
  const out = consolidateChildResults({
    expectedChildIds: ["A"],
    children: [child("A", [
      f("z.ts", "bug", "LOW", 1),
      f("a.ts", "bug", "CRITICAL", 2),
      f("m.ts", "bug", "CRITICAL", 3),
    ])],
  });
  assert.deepEqual(out.findings.map((x) => x.file), ["a.ts", "m.ts", "z.ts"], "CRITICAL(a,m by key) then LOW(z)");
});

test("NO implicit expected set: absent/empty expectedChildIds fails closed", () => {
  // absent
  const g = assertChildrenComplete({ children: [{ requestId: "A", disposition: "COMPLETE", findings: [] }] });
  assert.equal(g.ok, false, "cannot verify completeness against an implicit set");
  assert.match(g.reason, /expectedChildIds is required/);
  // empty
  assert.equal(assertChildrenComplete({ expectedChildIds: [], children: [] }).ok, false);
  // consolidate refuses too, surfacing the reason
  const out = consolidateChildResults({ children: [{ requestId: "A", disposition: "COMPLETE", findings: [] }] });
  assert.equal(out.ok, false);
  assert.match(out.reason, /expectedChildIds is required/);
  // with an explicit set that matches, it passes
  assert.equal(assertChildrenComplete({ expectedChildIds: ["A"], children: [{ requestId: "A", disposition: "COMPLETE", findings: [] }] }).ok, true);
});

test("every consolidated collection is sorted worst-severity-first then key (not just findings)", () => {
  const out = consolidateChildResults({
    expectedChildIds: ["A", "B"],
    children: [
      // agreements + conflicts + cross-sector across mixed severities, reported out of order
      child("A", [f("z.ts", "bug", "LOW", 1), f("a.ts", "bug", "CRITICAL", 2), f("m.ts", "perf", "HIGH", 9)], { sector: "s1" }),
      child("B", [f("z.ts", "bug", "MEDIUM", 1), f("a.ts", "bug", "CRITICAL", 2), f("m.ts", "perf", "HIGH", 9)], { sector: "s2" }),
    ],
  });
  const sorted = (arr) => arr.map((x) => `${x.severity}:${x.key}`);
  const rank = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const cmp = (a, b) => (rank[b.severity] - rank[a.severity]) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const isWorstThenKey = (arr) => {
    for (let i = 1; i < arr.length; i++) {
      // each element must come no-later-than the next under the worst-then-key comparator
      assert.ok(cmp(arr[i - 1], arr[i]) <= 0, `out of order at ${i}: ${sorted(arr)}`);
    }
  };
  isWorstThenKey(out.findings);
  isWorstThenKey(out.agreements);
  isWorstThenKey(out.conflicts);
  isWorstThenKey(out.crossSectorRisks);
  // sanity: all three findings are agreements (both children reported each), z.ts is the severity conflict
  assert.equal(out.counts.agreements, 3);
  assert.equal(out.conflicts[0].file, "z.ts");
});
