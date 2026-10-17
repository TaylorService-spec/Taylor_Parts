// The Dispatcher Board's clock: browser-local by default (other screens unchanged), the governed zone when set.
// Run: node --test test/boardClock.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { addDays, atWall, setBoardTimeZone, startOfDay, wall } from "../src/domain/boardClock.js";
import { startOfDayMillis, dayBand, bandHours } from "../src/domain/dispatchBoardGeometry.js";
import { startOfWeekMillis } from "../src/domain/schedulingWorkspace.js";

test("Phoenix: day start, hour band and week start are the company's, wherever the browser is", () => {
  setBoardTimeZone("America/Phoenix");
  try {
    const noonUtc = Date.parse("2030-10-02T19:00:00Z"); // 12:00 in Phoenix (UTC-7), a Wednesday
    assert.equal(startOfDay(noonUtc), Date.parse("2030-10-02T07:00:00Z"));
    assert.equal(startOfDayMillis(noonUtc), Date.parse("2030-10-02T07:00:00Z"), "geometry routes through the clock");
    const band = dayBand(noonUtc);
    assert.equal(band.startMillis, Date.parse("2030-10-02T14:00:00Z"), "7a Phoenix");
    assert.equal(band.endMillis, Date.parse("2030-10-03T00:00:00Z"), "5p Phoenix");
    assert.equal(bandHours(band)[0].label, "7a");
    assert.equal(startOfWeekMillis(noonUtc), Date.parse("2030-09-30T07:00:00Z"), "Monday 00:00 Phoenix");
    assert.equal(wall(noonUtc).dow, 3);
  } finally { setBoardTimeZone(null); }
});

test("a daylight-saving zone steps days by the calendar, not by 24 hours", () => {
  setBoardTimeZone("America/Denver");
  try {
    const sat = Date.parse("2030-03-09T12:00:00Z"); // Sat before spring-forward (Sun 2030-03-10)
    const sun = addDays(startOfDay(sat), 1);
    const mon = addDays(sun, 1);
    assert.equal(sun, Date.parse("2030-03-10T07:00:00Z"), "Sunday 00:00 MST");
    assert.equal(mon, Date.parse("2030-03-11T06:00:00Z"), "Monday 00:00 MDT -- a 23-hour Sunday");
    assert.equal(atWall(2030, 3, 32), Date.parse("2030-04-01T06:00:00Z"), "overflowing day normalizes");
  } finally { setBoardTimeZone(null); }
});

test("with no zone set the clock is the browser's own, exactly as before", () => {
  setBoardTimeZone(null);
  const t = Date.parse("2030-10-02T19:00:00Z");
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  assert.equal(startOfDay(t), d.getTime());
});
