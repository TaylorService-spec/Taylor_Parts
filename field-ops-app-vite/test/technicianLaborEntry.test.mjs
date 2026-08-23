// Recording time on a phone: what may be sent, what it is worth before the server sees it, and what
// the screen is never allowed to show.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LABOR_TYPE_OPTIONS, LABOR_SUBMIT, MAX_LABOR_MINUTES,
  toDurationMinutes, validateLaborEntry, deriveLaborIntentId,
  buildLaborRequest, interpretLaborResult, formatMinutes, captureOfflineLabor,
} from "../src/domain/technicianLaborEntry.js";

const form = { workOrderId: "wo1", workDate: "2026-08-23", laborType: "ONSITE", hours: 1, minutes: 30 };

test("hours and minutes become one number", () => {
  assert.equal(toDurationMinutes({ hours: 1, minutes: 30 }), 90);
  assert.equal(toDurationMinutes({ hours: 0, minutes: 45 }), 45);
  assert.equal(toDurationMinutes({ hours: 2 }), 120);
  assert.equal(toDurationMinutes({ hours: -1, minutes: 0 }), null);
  assert.equal(toDurationMinutes({ hours: "x" }), null);
});

test("every refusal says what to do about it", () => {
  // A disabled Save with no explanation is what a technician in a plant room least needs.
  for (const bad of [{}, { hours: 0, minutes: 0, laborType: "ONSITE" }, { hours: 1, laborType: "SHOP" }]) {
    const v = validateLaborEntry(bad);
    assert.equal(v.valid, false);
    assert.ok(v.reason && v.reason.length > 10, JSON.stringify(bad));
  }
});

test("the 16-hour bound is explained, not just enforced", () => {
  const v = validateLaborEntry({ hours: 26, minutes: 0, laborType: "ONSITE" });
  assert.equal(v.valid, false);
  assert.match(v.reason, /Split it into separate entries/);
  assert.equal(MAX_LABOR_MINUTES, 960);
});

test("only ONSITE and TRAVEL are offered", () => {
  assert.deepEqual(LABOR_TYPE_OPTIONS.map((o) => o.value), ["ONSITE", "TRAVEL"]);
});

test("the same entry replays; a CHANGED entry does not", () => {
  const a = deriveLaborIntentId({ ...form, durationMinutes: 90, attemptToken: "t" });
  assert.equal(deriveLaborIntentId({ ...form, durationMinutes: 90, attemptToken: "t" }), a);
  // If the key ignored the duration, correcting a typo and resubmitting would replay the first
  // request and report the WRONG number of minutes as success.
  assert.notEqual(deriveLaborIntentId({ ...form, durationMinutes: 60, attemptToken: "t" }), a);
  assert.notEqual(deriveLaborIntentId({ ...form, laborType: "TRAVEL", durationMinutes: 90, attemptToken: "t" }), a);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("the request is a DURATION entry and invents no clock position", () => {
  const req = buildLaborRequest({ ...form, attemptToken: "t" });
  assert.equal(req.entryKind, "DURATION");
  assert.equal(req.durationMinutes, 90);
  assert.equal(req.workDate, "2026-08-23");
  assert.equal("startedAtMillis" in req, false);
  assert.equal("endedAtMillis" in req, false);
  // And it never names a technician -- the server records for the authenticated one.
  assert.equal("technicianId" in req, false);
});

test("ONLINE entries send no device clock reading", () => {
  // Adding a second timestamp that never disagreed invites somebody to reconcile them.
  assert.equal("deviceReportedAtMillis" in buildLaborRequest({ ...form, attemptToken: "t" }), false);
});

test("an OFFLINE capture carries the device reading and claims nothing", () => {
  const intent = captureOfflineLabor(form, "t", 1787000000000);
  assert.equal(intent.state, "PENDING_SYNC");
  assert.equal(intent.request.deviceReportedAtMillis, 1787000000000);
  assert.equal("saved" in intent, false);
  assert.equal("laborEntryId" in intent, false);
});

test("an invalid entry mints no request at all", () => {
  assert.equal(buildLaborRequest({ ...form, hours: 0, minutes: 0, attemptToken: "t" }), null);
  assert.equal(buildLaborRequest({ ...form, attemptToken: null }), null);
});

test("a replay is SUCCESS -- the time is recorded either way", () => {
  const r = interpretLaborResult({ outcome: { outcome: "replayed", laborEntryId: "lab_1", durationMinutes: 90 } });
  assert.equal(r.status, LABOR_SUBMIT.SAVED);
  assert.match(r.message, /Already recorded/);
});

test("each refusal carries its own message, never a raw backend string", () => {
  for (const code of ["NOT_ASSIGNED_TECHNICIAN", "WORK_ORDER_STATE_INVALID", "OVERLAPPING_ENTRY", "PERMISSION_DENIED"]) {
    const r = interpretLaborResult({ error: { details: code, message: "raw backend text" } });
    assert.equal(r.status, LABOR_SUBMIT.FAILED);
    assert.equal(r.code, code);
    assert.notEqual(r.message, "raw backend text");
  }
});

test("totals read as time, not as a number of minutes", () => {
  assert.equal(formatMinutes(90), "1h 30m");
  assert.equal(formatMinutes(120), "2h");
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(null), "0m");
});

test("NO RATE, COST OR BILLING VOCABULARY anywhere in this module", async () => {
  // The record carries none of them; a screen showing a figure would have to invent it.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/domain/technicianLaborEntry.js", import.meta.url), "utf8"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["rate", "cost", "billable", "invoice", "revenue", "price"]) {
    assert.doesNotMatch(code, new RegExp(`\b${forbidden}\b`, "i"), `${forbidden} must not appear`);
  }
});
