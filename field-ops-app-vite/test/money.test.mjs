// Money — deterministic authoritative money (Owner §8). Pure tests (node:test). Proves integer-minor-unit
// exactness (no float), currency-mismatch fail-closed, exact string parsing, deterministic rounding for rates,
// and exact allocation (parts sum to the whole).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  money, zeroMoney, isMoney, fromMajorString, addMoney, subtractMoney, negateMoney,
  multiplyMoneyByQuantity, roundedDiv, multiplyMoneyByRate, rateFromBasisPoints, allocateMoney,
  compareMoney, isZeroMoney, isNegativeMoney, sumMoney, formatMoneyMajor, MoneyError, currencyExponent,
} from "../src/domain/money.js";

test("construction requires safe integer minor units + a currency", () => {
  const m = money(1234, "USD");
  assert.equal(m.minor, 1234);
  assert.equal(m.currency, "USD");
  assert.throws(() => money(1.5, "USD"), MoneyError); // no float minor units
  assert.throws(() => money(100, ""), MoneyError);
  assert.equal(isZeroMoney(zeroMoney("USD")), true);
});

test("fromMajorString parses EXACTLY to minor units; rejects over-precision and non-numeric", () => {
  assert.equal(fromMajorString("12.34", "USD").minor, 1234);
  assert.equal(fromMajorString("12", "USD").minor, 1200);
  assert.equal(fromMajorString("-0.09", "USD").minor, -9);
  assert.equal(fromMajorString("1000", "JPY").minor, 1000); // JPY exponent 0
  assert.throws(() => fromMajorString("12.345", "USD"), MoneyError); // more than 2 fractional digits
  assert.throws(() => fromMajorString("1.2.3", "USD"), MoneyError);
  assert.equal(currencyExponent("JPY"), 0);
});

test("add/subtract/negate are exact and currency-safe", () => {
  assert.equal(addMoney(money(1234, "USD"), money(66, "USD")).minor, 1300);
  assert.equal(subtractMoney(money(1300, "USD"), money(66, "USD")).minor, 1234);
  assert.equal(negateMoney(money(500, "USD")).minor, -500);
  assert.throws(() => addMoney(money(1, "USD"), money(1, "EUR")), MoneyError); // currency mismatch fails closed
});

test("multiply by integer quantity is exact (unitPrice × qty)", () => {
  assert.equal(multiplyMoneyByQuantity(money(12000, "USD"), 5).minor, 60000);
  assert.throws(() => multiplyMoneyByQuantity(money(1, "USD"), -1), MoneyError);
  assert.throws(() => multiplyMoneyByQuantity(money(1, "USD"), 1.5), MoneyError);
});

test("roundedDiv is deterministic HALF_UP by default; HALF_EVEN available", () => {
  assert.equal(roundedDiv(5, 2), 3); // 2.5 → 3 (half up)
  assert.equal(roundedDiv(-5, 2), -3); // symmetric away from zero
  assert.equal(roundedDiv(4, 2), 2);
  assert.equal(roundedDiv(5, 2, "HALF_EVEN"), 2); // banker's: 2.5 → 2
  assert.equal(roundedDiv(7, 2, "HALF_EVEN"), 4); // 3.5 → 4
  assert.throws(() => roundedDiv(1, 0), MoneyError);
});

test("multiplyMoneyByRate applies a tax/discount rate with one deterministic rounding", () => {
  // 8.25% of $100.00 (10000 minor) = 825 minor exactly
  assert.equal(multiplyMoneyByRate(money(10000, "USD"), rateFromBasisPoints(825)).minor, 825);
  // 8.25% of $12.34 (1234) = 101.805 → 102 (HALF_UP)
  assert.equal(multiplyMoneyByRate(money(1234, "USD"), rateFromBasisPoints(825)).minor, 102);
});

test("allocateMoney distributes remainder so parts sum EXACTLY to the whole", () => {
  const parts = allocateMoney(money(1000, "USD"), [1, 1, 1]); // 1000 / 3
  assert.deepEqual(parts.map((p) => p.minor), [334, 333, 333]); // largest-remainder first
  assert.equal(sumMoney(parts, "USD").minor, 1000); // no lost/invented cents
  const zeroWeights = allocateMoney(money(500, "USD"), [0, 0]);
  assert.deepEqual(zeroWeights.map((p) => p.minor), [0, 0]);
});

test("allocateMoney distributes remainder for NEGATIVE amounts too — parts still sum EXACTLY to the whole", () => {
  // sign-aware fix: a negative Money's leftover remainder is negative, so it must be handed out using its own
  // sign — otherwise the minor unit(s) are silently dropped and the parts fail the exact-sum guarantee.
  const negParts = allocateMoney(money(-1000, "USD"), [1, 1, 1]); // -1000 / 3
  assert.deepEqual(negParts.map((p) => p.minor), [-334, -333, -333]);
  assert.equal(sumMoney(negParts, "USD").minor, -1000); // no lost/invented cents

  const negSmall = allocateMoney(money(-100, "USD"), [1, 1, 1]);
  assert.deepEqual(negSmall.map((p) => p.minor), [-34, -33, -33]);
  assert.equal(sumMoney(negSmall, "USD").minor, -100);

  const negWeighted = allocateMoney(money(-1001, "USD"), [3, 2, 1]); // weighted negative split
  assert.deepEqual(negWeighted.map((p) => p.minor), [-501, -334, -166]);
  assert.equal(sumMoney(negWeighted, "USD").minor, -1001);

  const negTiny = allocateMoney(money(-7, "USD"), [1, 1, 1]);
  assert.deepEqual(negTiny.map((p) => p.minor), [-3, -2, -2]);
  assert.equal(sumMoney(negTiny, "USD").minor, -7);
});

test("compare / zero / negative / sum / format", () => {
  assert.equal(compareMoney(money(1, "USD"), money(2, "USD")), -1);
  assert.equal(isNegativeMoney(money(-1, "USD")), true);
  assert.equal(sumMoney([money(100, "USD"), money(200, "USD"), money(50, "USD")], "USD").minor, 350);
  assert.equal(formatMoneyMajor(money(1234, "USD")), "12.34");
  assert.equal(formatMoneyMajor(money(-9, "USD")), "-0.09");
  assert.equal(formatMoneyMajor(money(1000, "JPY")), "1000");
});
