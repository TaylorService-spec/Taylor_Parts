// A CONFIRMED SALES ORDER CARRIES A PRICE ON EVERY LINE.
//
// GOVERNANCE: docs/assessments/core-transaction-actionability-audit.md, Owner Decision 3.
//
// ============================ THE CONTRADICTION THIS CLOSES ============================
//
//   salesOrderCommands   unitPrice was OPTIONAL, and creation goes straight to CONFIRMED
//   invoiceCommands      refuses to bill a line with no price (UNPRICED)
//   sandbox              7 of 14 CONFIRMED orders carry no price on any line
//
// So the system let somebody commit to an order it would later decline to invoice, and nothing said
// so until billing — at which point the commercial conversation has already happened.
//
// EVERY LINE IS BILLABLE. `billingEligibleQty` in invoiceCommands discriminates by QUANTITY,
// min(ordered, fulfilled), and never by kind — so EQUIPMENT_MODEL, PART and SERVICE are equally
// billable and there is no subset to exempt.
//
// ============================ PROVEN THROUGH THE REAL COMMAND ============================
//
// Every case below calls buildCreateSalesOrder from the COMPILED lib and asserts on what it
// returns or throws. Nothing here asserts that a source file mentions a property — the Sales Order
// Dollars defect shipped because a test did exactly that, and passed while the value was undefined.

import test from "node:test";
import assert from "node:assert/strict";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";

const CTX = { actorUid: "uid-1", nowMillis: 1_754_600_000_000 };
const base = (lines) => ({
  accountId: "ACCT-1",
  ownerEmployeeId: "EMP-9",
  operatingCompanyId: "taylor",
  salesChannel: "RETAIL",
  lines,
});
const build = (lines) => buildCreateSalesOrder(base(lines), CTX);

// ═════════════════════════════════════════ the invariant

test("a priced line survives the command and keeps its exact minor-unit value", () => {
  const built = build([{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 2, unitPrice: 12000 }]);
  assert.equal(built.state, "CONFIRMED");
  assert.equal(built.lines.length, 1);
  // The VALUE, not a reference to it. 12000 minor units is what invoicing will snapshot as
  // unitPriceMinor and refuse to contradict.
  assert.equal(built.lines[0].unitPrice, 12000);
  assert.equal(built.currency, "USD");
});

test("an unpriced line is REFUSED, and the order is not created", () => {
  assert.throws(
    () => build([{ kind: "PART", ref: "PRT-1", orderedQty: 1 }]),
    (e) => e.code === "UNPRICED_LINE",
  );
});

test("the refusal names EVERY unpriced line, not just the first", () => {
  // Failing on line 1 of a six-line order makes pricing an order a six-round trip.
  try {
    build([
      { kind: "PART", ref: "PRT-A", orderedQty: 1 },
      { kind: "PART", ref: "PRT-B", orderedQty: 1, unitPrice: 500 },
      { kind: "SERVICE", ref: "SVC-C", businessUnitId: "SERVICE", orderedQty: 1 },
    ]);
    assert.fail("expected UNPRICED_LINE");
  } catch (e) {
    assert.equal(e.code, "UNPRICED_LINE");
    assert.match(e.message, /PRT-A/);
    assert.match(e.message, /SVC-C/);
    assert.doesNotMatch(e.message, /PRT-B/, "a priced line must not be reported as unpriced");
  }
});

test("EVERY line kind must be priced — none is exempt", () => {
  for (const kind of ["EQUIPMENT_MODEL", "PART", "SERVICE"]) {
    // FIN-002: SERVICE also requires a declared reporting unit; supplied here so what this test
    // measures stays the PRICING gate, not the attribution gate (which has its own tests).
    const bu = kind === "SERVICE" ? { businessUnitId: "SERVICE" } : {};
    assert.throws(
      () => build([{ kind, ref: `ref-${kind}`, orderedQty: 1, ...bu }]),
      (e) => e.code === "UNPRICED_LINE",
      `${kind} must require a price`,
    );
    // And the same kind builds fine once priced.
    const ok = build([{ kind, ref: `ref-${kind}`, orderedQty: 1, unitPrice: 100, ...bu }]);
    assert.equal(ok.lines[0].unitPrice, 100);
  }
});

// ═════════════════════════════════════════ zero is a price; absent is not

test("ZERO IS A REAL COMMITTED PRICE and is accepted", () => {
  // A no-charge line is a legitimate commercial act. Refusing zero would force somebody to invent
  // a price to record a giveaway.
  const built = build([{ kind: "PART", ref: "PRT-FREE", orderedQty: 1, unitPrice: 0 }]);
  assert.equal(built.lines[0].unitPrice, 0);
});

test("MISSING IS NOT ZERO — an absent price is never defaulted", () => {
  // The single most expensive mistake available here: turning "nobody priced this" into "this is
  // free". The order is refused instead.
  assert.throws(() => build([{ kind: "PART", ref: "P", orderedQty: 1 }]), (e) => e.code === "UNPRICED_LINE");
  assert.throws(() => build([{ kind: "PART", ref: "P", orderedQty: 1, unitPrice: undefined }]), (e) => e.code === "UNPRICED_LINE");
  assert.throws(() => build([{ kind: "PART", ref: "P", orderedQty: 1, unitPrice: null }]), (e) => e.code === "LINE_INVALID");
});

// ═════════════════════════════════════════ integer minor units

test("a fractional price is REFUSED rather than silently treated as absent", () => {
  // It used to be accepted and then dropped by the read projection, which produced an order that
  // looked priced and billed as unpriced. Loud beats silent.
  assert.throws(
    () => build([{ kind: "PART", ref: "P", orderedQty: 1, unitPrice: 12.5 }]),
    (e) => e.code === "LINE_INVALID" && /minor units/.test(e.message),
  );
});

test("a negative price is REFUSED — that is a credit, not a price", () => {
  assert.throws(
    () => build([{ kind: "PART", ref: "P", orderedQty: 1, unitPrice: -100 }]),
    (e) => e.code === "LINE_INVALID",
  );
});

test("a non-numeric price is REFUSED", () => {
  for (const bad of ["1200", true, {}, []]) {
    assert.throws(
      () => build([{ kind: "PART", ref: "P", orderedQty: 1, unitPrice: bad }]),
      (e) => e.code === "LINE_INVALID",
      `${JSON.stringify(bad)} must not be accepted as a price`,
    );
  }
});

// ═════════════════════════════════════════ nothing else was weakened

test("the serialized-line prohibition still holds, and is checked BEFORE pricing", () => {
  // A serialized reference is an identity error, not a commercial one. Reporting it as unpriced
  // would send somebody to price a line that must not exist at all.
  assert.throws(
    () => build([{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, serialNumber: "SN-1" }]),
    (e) => e.code === "SERIALIZED_LINE_FORBIDDEN",
  );
});

test("quantity invariants still hold, and are checked before pricing", () => {
  for (const qty of [0, -1, 1.5]) {
    assert.throws(
      () => build([{ kind: "PART", ref: "P", orderedQty: qty }]),
      (e) => e.code === "QTY_INVALID",
      `orderedQty ${qty} must fail on quantity, not on price`,
    );
  }
});

test("an order with no lines is still refused for having no lines", () => {
  assert.throws(() => buildCreateSalesOrder(base([]), CTX), (e) => e.code === "NO_LINES");
});

test("a multi-line order where every line is priced is created whole", () => {
  const built = build([
    { kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, unitPrice: 500000 },
    { kind: "PART", ref: "PRT-1", orderedQty: 4, unitPrice: 2500 },
    { kind: "SERVICE", ref: "INSTALL", businessUnitId: "INSTALLATION", orderedQty: 1, unitPrice: 75000 },
  ]);
  assert.equal(built.lines.length, 3);
  assert.deepEqual(built.lines.map((l) => l.unitPrice), [500000, 2500, 75000]);
  // Quantities still initialise to zero — pricing changed nothing about the fulfillment model.
  assert.deepEqual(built.lines.map((l) => l.allocatedQty), [0, 0, 0]);
  assert.deepEqual(built.lines.map((l) => l.billedQty), [0, 0, 0]);
});
