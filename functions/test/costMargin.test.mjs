// Finance — gross-margin derivation core (F5 / FIN-006). Pure tests. Proves the ONE margin invariant:
// COMPUTED only when every revenue line has a governed cost fact; otherwise UNKNOWN with NO margin number
// (never revenue − 0, never a partial margin). Malformed cost facts are caller defects (thrown), not
// silently-dropped inputs. Integer minor units throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGrossMargin, CostMarginError, MARGIN_STATUSES } from "../lib/finance/costMargin.js";

const fact = (over = {}) => ({
  lineRef: "L1",
  costMinor: 6000,
  costBasis: "RECEIPT_COST",
  sourceType: "RECEIVING_RECEIPT",
  sourceRecordId: "RCV-1",
  ...over,
});
const base = (over = {}) => ({
  currency: "USD",
  lines: [{ ref: "L1", revenueMinor: 10000 }],
  costFacts: [fact()],
  ...over,
});

test("statuses are the closed set COMPUTED/UNKNOWN — there is no partial state", () => {
  assert.deepEqual([...MARGIN_STATUSES], ["COMPUTED", "UNKNOWN"]);
});

test("fully-costed lines ⇒ COMPUTED margin = revenue − governed cost", () => {
  const r = deriveGrossMargin(base());
  assert.equal(r.status, "COMPUTED");
  assert.equal(r.revenueMinor, 10000);
  assert.equal(r.costMinor, 6000);
  assert.equal(r.marginMinor, 4000);
  assert.deepEqual(r.reasons, []);
});

test("multiple cost facts per line accumulate (e.g. parts + freight when so decided)", () => {
  const r = deriveGrossMargin(base({ costFacts: [fact({ costMinor: 5000 }), fact({ costMinor: 500, sourceRecordId: "RCV-2" })] }));
  assert.equal(r.status, "COMPUTED");
  assert.equal(r.costMinor, 5500);
  assert.equal(r.marginMinor, 4500);
});

test("ANY line without a governed cost fact ⇒ UNKNOWN, margin numbers are null (never revenue − 0)", () => {
  const r = deriveGrossMargin(base({
    lines: [{ ref: "L1", revenueMinor: 10000 }, { ref: "L2", revenueMinor: 5000 }],
  }));
  assert.equal(r.status, "UNKNOWN");
  assert.equal(r.revenueMinor, 15000); // revenue side is governed and still reported
  assert.equal(r.costMinor, null);
  assert.equal(r.marginMinor, null);
  assert.ok(r.reasons.some((m) => m.includes("L2") && m.includes("never revenue − 0")));
});

test("no cost facts at all (today's repository reality) ⇒ UNKNOWN", () => {
  const r = deriveGrossMargin(base({ costFacts: [] }));
  assert.equal(r.status, "UNKNOWN");
  assert.equal(r.marginMinor, null);
});

test("a cost fact referencing no revenue line ⇒ UNKNOWN (attribution defect surfaced, not absorbed)", () => {
  const r = deriveGrossMargin(base({ costFacts: [fact(), fact({ lineRef: "GHOST" })] }));
  assert.equal(r.status, "UNKNOWN");
  assert.ok(r.reasons.some((m) => m.includes("GHOST")));
});

test("negative margin is a legitimate COMPUTED result (a loss is a fact, not an error)", () => {
  const r = deriveGrossMargin(base({ costFacts: [fact({ costMinor: 12000 })] }));
  assert.equal(r.status, "COMPUTED");
  assert.equal(r.marginMinor, -2000);
});

test("malformed cost facts are thrown caller defects, never silently dropped into a smaller margin", () => {
  assert.throws(() => deriveGrossMargin(base({ costFacts: [fact({ sourceRecordId: "" })] })), (e) => e instanceof CostMarginError && e.code === "COST_FACT_INVALID");
  assert.throws(() => deriveGrossMargin(base({ costFacts: [fact({ costBasis: "" })] })), (e) => e.code === "COST_FACT_INVALID");
  assert.throws(() => deriveGrossMargin(base({ costFacts: [fact({ costMinor: 1.5 })] })), (e) => e.code === "COST_FACT_INVALID");
  assert.throws(() => deriveGrossMargin(base({ costFacts: [fact({ costMinor: -1 })] })), (e) => e.code === "COST_FACT_INVALID");
});

test("bad revenue lines / missing currency are thrown defects", () => {
  assert.throws(() => deriveGrossMargin(base({ currency: " " })), (e) => e.code === "CURRENCY_REQUIRED");
  assert.throws(() => deriveGrossMargin(base({ lines: [{ ref: "L1", revenueMinor: 10.5 }] })), (e) => e.code === "LINE_INVALID");
  assert.throws(() => deriveGrossMargin(base({ lines: [{ ref: "", revenueMinor: 1 }] })), (e) => e.code === "LINE_INVALID");
});

test("zero revenue lines ⇒ UNKNOWN, not a zero margin", () => {
  const r = deriveGrossMargin(base({ lines: [], costFacts: [] }));
  assert.equal(r.status, "UNKNOWN");
  assert.equal(r.revenueMinor, 0);
  assert.equal(r.marginMinor, null);
});
