import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyReconciliationRow,
  quantityText,
  varianceText,
  summariseReconciliation,
} from "../src/domain/reconciliationRowHonesty.js";

test("the exact row three personas reported is UNKNOWN, never CRITICAL", () => {
  const r = classifyReconciliationRow({ expectedQuantity: 0, actualQuantity: NaN, variance: NaN, severity: "CRITICAL" });
  assert.equal(r.trustworthy, false);
  assert.equal(r.severity, "UNKNOWN");
  assert.equal(r.actual, null);
  assert.equal(r.variance, null);
});

test("a genuinely critical row keeps its severity", () => {
  const r = classifyReconciliationRow({ expectedQuantity: 10, actualQuantity: 2, variance: -8, severity: "CRITICAL" });
  assert.deepEqual(r, { trustworthy: true, severity: "CRITICAL", expected: 10, actual: 2, variance: -8 });
});

test("a missing variance is derived from figures already confirmed real", () => {
  const r = classifyReconciliationRow({ expectedQuantity: 4, actualQuantity: 9, severity: "LOW" });
  assert.equal(r.variance, 5);
});

test("a non-numeric variance never survives as NaN", () => {
  for (const variance of [NaN, Infinity, "3", null, undefined, {}]) {
    const r = classifyReconciliationRow({ expectedQuantity: 4, actualQuantity: 9, variance, severity: "LOW" });
    assert.equal(r.variance, 5, `variance ${String(variance)} must be re-derived`);
  }
});

test("every unusable quantity shape yields UNKNOWN, not a number", () => {
  for (const actualQuantity of [NaN, Infinity, -Infinity, undefined, null, "7", {}]) {
    const r = classifyReconciliationRow({ expectedQuantity: 1, actualQuantity, severity: "CRITICAL" });
    assert.equal(r.trustworthy, false, `actual ${String(actualQuantity)} must not be trusted`);
    assert.equal(r.severity, "UNKNOWN");
  }
});

test("a row with no severity at all is UNKNOWN rather than assumed benign", () => {
  const r = classifyReconciliationRow({ expectedQuantity: 1, actualQuantity: 1 });
  assert.equal(r.severity, "UNKNOWN");
});

test("malformed rows never throw", () => {
  for (const row of [undefined, null, {}, 3, "x"]) {
    assert.equal(classifyReconciliationRow(row).trustworthy, false);
  }
});

test("display text never renders NaN", () => {
  assert.equal(quantityText(null), "Unknown");
  assert.equal(quantityText(0), "0");
  assert.equal(varianceText(null), "Unknown");
  assert.equal(varianceText(3), "+3");
  assert.equal(varianceText(-3), "-3");
  assert.equal(varianceText(0), "0");
});

test("a summary can never build a critical count out of failed arithmetic", () => {
  const rows = [
    { expectedQuantity: 0, actualQuantity: NaN, severity: "CRITICAL" },
    { expectedQuantity: 0, actualQuantity: NaN, severity: "CRITICAL" },
    { expectedQuantity: 10, actualQuantity: 1, severity: "CRITICAL" },
    { expectedQuantity: 5, actualQuantity: 4, severity: "LOW" },
  ];
  const s = summariseReconciliation(rows);
  assert.equal(s.CRITICAL, 1, "only the row with real numbers counts as critical");
  assert.equal(s.LOW, 1);
  assert.equal(s.unevaluable, 2);
  assert.equal(s.evaluated, 2);
  assert.equal(s.total, 4);
});

test("an empty or malformed set summarises to zeros, not a throw", () => {
  for (const rows of [[], undefined, null, "x"]) {
    const s = summariseReconciliation(rows);
    assert.equal(s.total, 0);
    assert.equal(s.CRITICAL, 0);
    assert.equal(s.unevaluable, 0);
  }
});
