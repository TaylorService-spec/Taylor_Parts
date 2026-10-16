// The Schedule dialog reads and writes times in the operating company's governed business time zone, not the browser's.
// Run: node --test test/zonedTime.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { formatZoned, fromZonedInput, toZonedInput } from "../src/domain/zonedTime.js";

test("Phoenix wall clock <-> instant (UTC-7, no daylight saving)", () => {
  assert.equal(toZonedInput(Date.parse("2030-10-01T14:00:00Z"), "America/Phoenix"), "2030-10-01T07:00");
  assert.equal(fromZonedInput("2030-10-01T07:00", "America/Phoenix"), Date.parse("2030-10-01T14:00:00Z"));
  assert.equal(fromZonedInput("2030-01-15T07:00", "America/Phoenix"), Date.parse("2030-01-15T14:00:00Z"), "same offset in winter");
});

test("a zone WITH daylight saving converts correctly on both sides of the change", () => {
  // America/Denver: MDT (UTC-6) in July, MST (UTC-7) in December.
  assert.equal(fromZonedInput("2030-07-10T09:00", "America/Denver"), Date.parse("2030-07-10T15:00:00Z"));
  assert.equal(fromZonedInput("2030-12-10T09:00", "America/Denver"), Date.parse("2030-12-10T16:00:00Z"));
  for (const iso of ["2030-07-10T15:00:00Z", "2030-12-10T16:00:00Z", "2030-03-10T12:30:00Z"]) {
    const ms = Date.parse(iso);
    assert.equal(fromZonedInput(toZonedInput(ms, "America/Denver"), "America/Denver"), ms, `round trip ${iso}`);
  }
});

test("malformed or empty input is null, never a guessed instant", () => {
  for (const bad of ["", null, undefined, "2030-10-01", "07:00", "2030-10-01 07:00"]) assert.equal(fromZonedInput(bad, "America/Phoenix"), null, String(bad));
  assert.equal(toZonedInput(null, "America/Phoenix"), "");
});

test("sentence formatting is in the named zone", () => {
  assert.match(formatZoned(Date.parse("2030-10-01T14:00:00Z"), "America/Phoenix"), /Oct 1, 7:00\sAM/);
});
