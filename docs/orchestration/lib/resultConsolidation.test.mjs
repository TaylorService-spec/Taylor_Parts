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

test("assertChildrenComplete defaults expected set to the provided children when none is given", () => {
  const g = assertChildrenComplete({ children: [{ requestId: "A", disposition: "COMPLETE", findings: [] }] });
  assert.equal(g.ok, true);
  const g2 = assertChildrenComplete({ children: [{ requestId: "A", disposition: "BLOCKED", findings: [] }] });
  assert.equal(g2.ok, false);
  assert.deepEqual(g2.incomplete, ["A"]);
});
