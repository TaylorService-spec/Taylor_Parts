import assert from "node:assert/strict";
import test from "node:test";
import { formatTimestamp, formatAge, formatClockTime } from "../src/domain/displayTimestamp.js";

const NOW = Date.parse("2026-08-08T12:00:00Z");

test("formatClockTime never renders Invalid Date and coerces a Firestore Timestamp (the Operational History bug)", () => {
  const ms = Date.parse("2026-08-07T14:15:00Z");
  // The exact shape that produced "Invalid Date" on every Operational History row:
  // a governed Work Order's createdAt is a Firestore Timestamp, not epoch millis.
  const fromTimestamp = formatClockTime({ toMillis: () => ms });
  assert.notEqual(fromTimestamp, "Invalid Date");
  assert.notEqual(fromTimestamp, "Unknown"); // a valid Timestamp renders a real clock time
  assert.equal(formatClockTime({ seconds: Math.floor(ms / 1000) }) !== "Unknown", true);
  for (const bad of [undefined, null, NaN, 0, "", "not a date", {}, Infinity, -1]) {
    assert.equal(formatClockTime(bad), "Unknown", `${String(bad)} must be Unknown`);
    assert.notEqual(formatClockTime(bad), "Invalid Date");
  }
  assert.equal(formatClockTime(null, { unknown: "—" }), "—"); // caller-configurable, matching WorkOrderDetail
});

test("never renders the literal string Invalid Date", () => {
  for (const bad of [undefined, null, NaN, 0, "", "not a date", {}, [], Infinity, -1]) {
    assert.equal(formatTimestamp(bad), "Unknown", `${String(bad)} must be Unknown`);
    assert.notEqual(formatTimestamp(bad), "Invalid Date");
  }
});

test("the 19933d-ago class of value is capped, not printed as a number", () => {
  // Epoch-ish value: the shape that produced a ~54 year age on a request made this week.
  assert.equal(formatAge(1, NOW), "Over a year ago");
  assert.equal(formatAge(Date.parse("1971-01-01T00:00:00Z"), NOW), "Over a year ago");
});

test("zero is refused rather than treated as 1970", () => {
  assert.equal(formatAge(0, NOW), "Unknown");
  assert.equal(formatTimestamp(0), "Unknown");
});

test("a future timestamp is not rendered as though it just happened", () => {
  assert.equal(formatAge(NOW + 60_000, NOW), "Unknown");
});

test("real ages read naturally", () => {
  assert.equal(formatAge(NOW - 30_000, NOW), "Just now");
  assert.equal(formatAge(NOW - 5 * 60_000, NOW), "5m ago");
  assert.equal(formatAge(NOW - 3 * 3_600_000, NOW), "3h ago");
  assert.equal(formatAge(NOW - 2 * 86_400_000, NOW), "2d ago");
  assert.equal(formatAge(NOW - 100 * 86_400_000, NOW), "100d ago");
});

test("the plausibility boundary is a cap, not a cliff into Unknown", () => {
  assert.equal(formatAge(NOW - 400 * 86_400_000, NOW), "400d ago");
  assert.equal(formatAge(NOW - 401 * 86_400_000, NOW), "Over a year ago");
});

test("accepts the timestamp shapes the platform actually produces", () => {
  const ms = Date.parse("2026-08-07T12:00:00Z");
  assert.equal(formatAge(new Date(ms), NOW), "1d ago");
  assert.equal(formatAge({ toMillis: () => ms }, NOW), "1d ago");
  assert.equal(formatAge({ seconds: Math.floor(ms / 1000) }, NOW), "1d ago");
  assert.equal(formatAge("2026-08-07T12:00:00Z", NOW), "1d ago");
  assert.notEqual(formatTimestamp(new Date(ms)), "Unknown");
});

test("the unknown label is caller-configurable without weakening the rule", () => {
  assert.equal(formatTimestamp(null, { unknown: "—" }), "—");
  assert.equal(formatAge(null, NOW, { unknown: "—" }), "—");
});
