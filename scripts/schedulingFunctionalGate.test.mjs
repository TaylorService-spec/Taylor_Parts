// Unit cover for the PURE parts of the live Scheduling Functional Gate.
//
// The gate itself cannot run in CI: it needs sandbox persona credentials and a live estate, and it
// mutates data. What CAN be covered here is everything the gate would get quietly wrong without ever
// failing loudly -- argument parsing that silently runs against the wrong project, a window helper
// that lands an hour off and reports a working-hours defect that does not exist, and the value
// normalisation that made the first run of this gate report two false positives.
//
// That last one is the reason this file exists at a level of detail that might otherwise look
// excessive. A gate that produces a false FAIL is worse than no gate: the next real failure gets
// argued with instead of fixed.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { millisOf, nextLocalHour, parseArgs, plain, zoneOffsetMillis } from "./schedulingFunctionalGate.mjs";

const HOUR = 3_600_000;

test("parseArgs reads the project confirmation and the json sink", () => {
  const a = parseArgs(["--confirm-project", "eos-platform-sandbox", "--json", "out.json"]);
  assert.equal(a.confirmProject, "eos-platform-sandbox");
  assert.equal(a.json, "out.json");
});

test("parseArgs defaults the project confirmation to null, so an absent flag can never pass the guard", () => {
  assert.equal(parseArgs([]).confirmProject, null);
  assert.equal(parseArgs(["--json", "x.json"]).confirmProject, null);
});

test("millisOf accepts both stored shapes of a scheduling window", () => {
  // The commands take millis on the wire; Firestore hands the same field back as an ISO timestamp.
  assert.equal(millisOf(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(millisOf("2026-08-29T16:00:00Z"), Date.parse("2026-08-29T16:00:00Z"));
});

test("millisOf reports absence as null rather than as zero", () => {
  // Zero is a real instant. Collapsing "no window recorded" into it is the same class of mistake as
  // rendering unknown availability as 0% -- which is the thing this whole domain exists to avoid.
  assert.equal(millisOf(undefined), null);
  assert.equal(millisOf(null), null);
  assert.equal(millisOf("not a date"), null);
});

test("plain flattens the Firestore REST value shapes the gate reads", () => {
  const out = plain({
    status: { stringValue: "SCHEDULED" },
    scheduledStart: { timestampValue: "2026-08-29T16:00:00Z" },
    durationMinutes: { integerValue: "120" },
    active: { booleanValue: true },
    clearedField: { nullValue: null },
  });
  assert.equal(out.status, "SCHEDULED");
  assert.equal(out.scheduledStart, "2026-08-29T16:00:00Z");
  assert.equal(out.durationMinutes, 120);
  assert.equal(out.active, true);
  assert.equal(out.clearedField, null);
});

test("plain leaves a field that is absent absent, so a deleted field can be told from a blanked one", () => {
  // M5 turns on exactly this: Unschedule DELETES scheduledTechId. If plain() invented an
  // undefined-to-null mapping, a blanked field and a deleted one would read identically and the
  // check would pass against the very defect it exists to catch.
  const out = plain({ status: { stringValue: "READY_TO_DISPATCH" } });
  assert.equal("scheduledTechId" in out, false);
  assert.equal(out.scheduledTechId, undefined);
});

test("zoneOffsetMillis resolves a fixed-offset zone", () => {
  // Phoenix does not observe DST, so its offset is the same in January and in July. Any drift here
  // is the helper, not the calendar.
  const jan = Date.UTC(2026, 0, 15, 12);
  const jul = Date.UTC(2026, 6, 15, 12);
  assert.equal(zoneOffsetMillis("America/Phoenix", jan), -7 * HOUR);
  assert.equal(zoneOffsetMillis("America/Phoenix", jul), -7 * HOUR);
});

test("zoneOffsetMillis follows a DST-observing zone across the boundary", () => {
  // Denver is Phoenix's neighbour and does observe DST. The pair is what makes an offset bug visible:
  // a helper that hardcoded an offset would agree with Phoenix and disagree here.
  assert.equal(zoneOffsetMillis("America/Denver", Date.UTC(2026, 0, 15, 12)), -7 * HOUR);
  assert.equal(zoneOffsetMillis("America/Denver", Date.UTC(2026, 6, 15, 12)), -6 * HOUR);
});

test("nextLocalHour lands on the requested wall-clock hour in the requested zone", () => {
  for (const zone of ["America/Phoenix", "America/Denver", "America/New_York", "UTC"]) {
    for (const hour of [2, 9, 16]) {
      const at = nextLocalHour(zone, hour, 2, Date.UTC(2026, 7, 27, 19));
      const rendered = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" })
        .format(new Date(at));
      assert.equal(Number(rendered), hour, `${zone} @ ${hour}:00 rendered as ${rendered}`);
    }
  }
});

test("nextLocalHour lands on the requested hour across a spring-forward boundary", () => {
  // 2026-03-08 is the US spring-forward. A single-pass offset resolution lands an hour out here,
  // which is precisely how a gate would report a spurious OUTSIDE_WORKING_HOURS.
  const beforeTransition = Date.UTC(2026, 2, 6, 12);
  const at = nextLocalHour("America/Denver", 9, 3, beforeTransition);
  const rendered = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", hourCycle: "h23" })
    .format(new Date(at));
  assert.equal(Number(rendered), 9);
});

test("nextLocalHour returns an instant in the future for a same-day-later hour", () => {
  const from = Date.UTC(2026, 7, 27, 19);
  assert.ok(nextLocalHour("America/Phoenix", 9, 2, from) > from);
});
