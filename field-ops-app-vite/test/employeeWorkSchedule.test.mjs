// Scheduling PR-2 — the pure Work Schedule helpers. The form must produce exactly the setTechnicianWorkingHours
// payload, refuse what the server refuses, and NEVER invent hours.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  WEEKDAYS, copyDay, currentSchedules, describeDay, formFromWeeklyHours, isTimeZone, weeklyHoursFromForm,
} from "../src/domain/employeeWorkSchedule.js";

describe("describing a governed day", () => {
  it("names the gap between intervals as a break", () => {
    assert.equal(describeDay([{ start: "12:30", end: "16:00" }, { start: "07:00", end: "12:00" }]),
      "7:00a–12:00p · 30 min break · 12:30p–4:00p");
  });
  it("a day with no intervals is Off, and midnight reads as 12:00a", () => {
    assert.equal(describeDay(undefined), "Off");
    assert.equal(describeDay([{ start: "22:00", end: "24:00" }]), "10:00p–12:00a");
  });
});

describe("the form never invents hours", () => {
  it("an absent schedule is an EMPTY form, not a default shift", () => {
    const form = formFromWeeklyHours(null);
    assert.deepEqual(WEEKDAYS.map(({ key }) => form[key].length), [0, 0, 0, 0, 0, 0, 0]);
  });
  it("an empty form is refused, exactly as the server refuses WEEKLY_HOURS_EMPTY", () => {
    const r = weeklyHoursFromForm(formFromWeeklyHours(null));
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /never assumed/);
  });
});

describe("the form produces the command's weeklyHours", () => {
  it("round-trips a governed schedule, sorting intervals and dropping blank rows", () => {
    const governed = { 1: [{ start: "07:00", end: "12:00" }, { start: "12:30", end: "16:00" }], 5: [{ start: "06:00", end: "14:00" }] };
    const form = formFromWeeklyHours(governed);
    form["1"] = [form["1"][1], form["1"][0], { start: "", end: "" }];
    assert.deepEqual(weeklyHoursFromForm(form), { ok: true, weeklyHours: {
      1: [{ start: "07:00", end: "12:00" }, { start: "12:30", end: "16:00" }], 5: [{ start: "06:00", end: "14:00" }] } });
  });

  it("mirrors the server's refusals: reversed, overlapping, malformed, too many", () => {
    const base = formFromWeeklyHours(null);
    const bad = (rows) => weeklyHoursFromForm({ ...base, 2: rows });
    assert.match(bad([{ start: "16:00", end: "07:00" }]).errors[0].message, /ends before it starts/);
    assert.match(bad([{ start: "07:00", end: "12:00" }, { start: "11:00", end: "15:00" }]).errors[0].message, /overlap/);
    assert.match(bad([{ start: "7am", end: "12:00" }]).errors[0].message, /HH:MM/);
    assert.match(bad(Array.from({ length: 7 }, (_, i) => ({ start: `0${i}:00`, end: `0${i}:30` }))).errors[0].message, /at most 6/);
    assert.equal(bad([{ start: "18:00", end: "24:00" }]).ok, true, "end may be 24:00");
  });

  it("copies one day onto others without aliasing", () => {
    const form = copyDay({ ...formFromWeeklyHours(null), 1: [{ start: "07:00", end: "16:00" }] }, "1", ["2", "3"]);
    form["2"][0].start = "08:00";
    assert.equal(form["1"][0].start, "07:00");
    assert.equal(form["3"][0].start, "07:00");
  });
});

describe("helpers", () => {
  it("validates IANA zones", () => {
    assert.equal(isTimeZone("America/Phoenix"), true);
    assert.equal(isTimeZone("Mars/Olympus"), false);
    assert.equal(isTimeZone(""), false);
  });
  it("current schedules put the company-specific one first (the server's precedence)", () => {
    const list = currentSchedules([
      { scheduleId: "wide", status: "CURRENT", operatingCompanyId: null },
      { scheduleId: "old", status: "ENDED", operatingCompanyId: "taylor" },
      { scheduleId: "co", status: "CURRENT", operatingCompanyId: "taylor" },
    ]);
    assert.deepEqual(list.map((s) => s.scheduleId), ["co", "wide"]);
  });
});
