// W1 / Account line-of-business (LOB wireframe §3.8, Owner-approved model
// correction 2026-08-05). Pins the ACCOUNT_LINE_OF_BUSINESS constant and the
// canonical ordering + additive contract that AccountForm.handleSubmit and
// AccountDetail's LineOfBusinessBadges both rely on. This is the corrected W1:
// an optional, additive, informational-only Account array (NOT operatingCompanyId,
// which is a per-transaction field — the conflation §3.3 warns against).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_LINE_OF_BUSINESS } from "../src/domain/constants.js";

// The exact ordering idiom used inline by both consumers.
const orderLob = (values) => Object.values(ACCOUNT_LINE_OF_BUSINESS).filter((c) => values.includes(c));

test("ACCOUNT_LINE_OF_BUSINESS is exactly { TAYLOR, VENTANA }", () => {
  assert.deepEqual(ACCOUNT_LINE_OF_BUSINESS, { TAYLOR: "TAYLOR", VENTANA: "VENTANA" });
});

test("canonical order: TAYLOR before VENTANA regardless of input order", () => {
  assert.deepEqual(orderLob(["VENTANA", "TAYLOR"]), ["TAYLOR", "VENTANA"]);
  assert.deepEqual(orderLob(["TAYLOR", "VENTANA"]), ["TAYLOR", "VENTANA"]);
});

test("optional/additive: empty stays empty (no badge, no silent default to Taylor)", () => {
  assert.deepEqual(orderLob([]), []);
  assert.deepEqual(orderLob(undefined ?? []), []);
});

test("'both' is a first-class value; single values pass through", () => {
  assert.deepEqual(orderLob(["TAYLOR", "VENTANA"]), ["TAYLOR", "VENTANA"]);
  assert.deepEqual(orderLob(["VENTANA"]), ["VENTANA"]);
  assert.deepEqual(orderLob(["TAYLOR"]), ["TAYLOR"]);
});

test("unrecognized values are dropped (never rendered or persisted)", () => {
  assert.deepEqual(orderLob(["BOGUS", "TAYLOR"]), ["TAYLOR"]);
  assert.deepEqual(orderLob(["BOGUS"]), []);
});
