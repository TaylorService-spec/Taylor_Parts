// FIN-BLOCK-003A ACTIVATION — the committed price on the client write path.
//
// The conversion from what a person types to what the authority stores is the one place in this
// feature where money can silently become wrong, so it is tested where it happens rather than only
// where it lands. "19.99" must become exactly 1999, "19.999" must be refused rather than rounded to
// a price nobody agreed, and 0 must survive as a real committed price rather than being swallowed by
// a falsy check.
import test from "node:test";
import assert from "node:assert/strict";
import { fromMajorString, MoneyError } from "../src/domain/money.js";

// ── the exact conversion the write path performs ────────────────────────────────────────────────
// Exercised through the SAME function the write path calls. Testing a private copy of the arithmetic
// would prove the copy correct and say nothing about what the button does.

test("a typed major amount becomes exact minor units", () => {
  assert.equal(fromMajorString("19.99", "USD").minor, 1999);
  assert.equal(fromMajorString("0.01", "USD").minor, 1);
  assert.equal(fromMajorString("1234.50", "USD").minor, 123450);
  assert.equal(fromMajorString("7", "USD").minor, 700, "a whole amount is not 7 minor units");
});

test("the float route this deliberately avoids is provably wrong", () => {
  // Not a test of our code — a test of WHY the code is shaped this way, so the next person to
  // simplify it can see the failure they would be reintroducing.
  assert.notEqual(19.99 * 100, 1999);
  assert.equal(fromMajorString("19.99", "USD").minor, 1999);
});

test("more fractional digits than the currency allows is REFUSED, never rounded", () => {
  // Rounding here would commit a price the purchasing person did not type, to a vendor, permanently.
  assert.throws(() => fromMajorString("19.999", "USD"), MoneyError);
  assert.throws(() => fromMajorString("0.005", "USD"), MoneyError);
});

test("a non-numeric amount is refused rather than coerced", () => {
  for (const bad of ["", "abc", "19.99 USD", "$19.99", "1,999.00", "1e3"]) {
    assert.throws(() => fromMajorString(bad, "USD"), MoneyError, `"${bad}" must be refused`);
  }
});

test("ZERO is a legal committed price, distinct from a missing one", () => {
  // A no-charge line — warranty replacement, sample, supplier making good — is a real commercial
  // fact. It must not be conflated with "nobody entered a price", which is UNKNOWN.
  const zero = fromMajorString("0", "USD");
  assert.equal(zero.minor, 0);
  assert.equal(fromMajorString("0.00", "USD").minor, 0);
  assert.notEqual(zero.minor, null);
});

test("the currency governs the number of minor units, and is never assumed", () => {
  // JPY has no minor unit. A hardcoded ×100 would make ¥500 into 50,000.
  assert.equal(fromMajorString("500", "JPY").minor, 500);
  assert.equal(fromMajorString("500", "USD").minor, 50000);
});

// ── the write path's own guards ──────────────────────────────────────────────────────────────────
// recordPurchaseOrder imports firebase, so it cannot be imported in a bare node test. Its guards are
// asserted against the SOURCE, which is what this repo already does for domain wiring it cannot
// import (see reorderTrustedWritePathContract.test.mjs).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "domain", "reorderPurchaseOrders.js"),
  "utf8",
);

test("the write path converts through the shared money core, not its own arithmetic", () => {
  assert.match(SRC, /import \{ fromMajorString \} from "\.\/money\.js"/);
  assert.match(SRC, /fromMajorString\(priceText, trimmedCurrency\)\.minor/);
  // CODE ONLY — comments stripped first. The module deliberately NAMES `Number(major) * 100` in
  // prose to explain why it is not used, and a guard that cannot tell an explanation from a use
  // fires on the very comment warning against the thing it guards.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const f of ["* 100", "*100", "parseFloat", "toFixed", "Math.round"]) {
    assert.ok(!code.includes(f), `the write path must not use ${f} on money`);
  }
});

test("MINOR UNITS cross the wire — the typed string never reaches the callable", () => {
  const payload = SRC.slice(SRC.indexOf("submitRecordReorderPurchaseOrder({"));
  assert.match(payload, /unitPriceMinor,/);
  assert.match(payload, /currency: trimmedCurrency,/);
  assert.ok(!/unitPriceMajor/.test(payload.slice(0, payload.indexOf("}"))), "the raw typed value must not be sent");
});

test("an EMPTY price is refused, and the check is emptiness rather than falsiness", () => {
  // `if (!price)` would reject "0", which is the bug this assertion exists to prevent.
  assert.match(SRC, /priceText === ""/);
  assert.ok(!/if \(!unitPriceMajor\)/.test(SRC), "a falsy check would silently reject a zero price");
});

test("currency is required and normalized, never defaulted silently", () => {
  assert.match(SRC, /\^\[A-Z\]\{3\}\$/);
  assert.match(SRC, /toUpperCase\(\)/);
});
