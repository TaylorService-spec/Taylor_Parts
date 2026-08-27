// Dispatch North Star P1 — the pure geometry behind the board.
//
// These assertions are the ones that decide whether the board tells the truth. Not "does it render"
// — whether a chip sits where the committed window says it sits, whether three views can disagree
// about one placement, and whether an unrecorded shift can turn into a confident 0%.
//
// The last of those is the single most consequential rule in the Scheduling domain, and it is the
// reason this file leads with it: `availableMinutesInWindow(null, …)` returns null rather than 0
// server-side, and a board that collapsed that into a percentage would report a fact about our data
// entry as though it were a fact about the business — every technician looking permanently free on
// the day the collection ships and nobody has filled it in.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  bandHours,
  blockedMinutesInBand,
  bucketByDay,
  bucketBlockedByDay,
  dayBand,
  dayOccupancy,
  fleetBookedPercent,
  fortnightDays,
  isPlaced,
  laneCapacity,
  placeInBand,
  placedBlockedTime,
  placementWindow,
  shiftLabel,
  startOfDayMillis,
  weekDays,
} from "../src/domain/dispatchBoardGeometry.js";

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** A local 09:00 on a fixed date, built through the same Date API the module uses. */
function localAt(hour, minute = 0, dayOffset = 0) {
  const d = new Date(2026, 8, 15, hour, minute, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.getTime();
}

const BAND = dayBand(localAt(12));

function scheduledWo(id, startMillis, endMillis, techId = "tech-a") {
  return { id, woNumber: `WO-${id}`, status: "SCHEDULED", scheduledTechId: techId, scheduledStart: startMillis, scheduledEnd: endMillis };
}

// ---------------------------------------------------------------------------------------------
describe("absent is not empty", () => {
  it("unknown availability yields no percentage, and says the denominator is unknown", () => {
    const capacity = laneCapacity(null, [scheduledWo("1", localAt(9), localAt(11))], BAND);
    assert.equal(capacity.known, false);
    assert.equal(capacity.percentBooked, null, "an unknown denominator must not produce a percentage");
  });

  it("booked minutes are still reported when the denominator is unknown", () => {
    // Booked time comes from COMMITTED placements and is known regardless. Withholding it too would
    // throw away a fact the board has, which is the opposite error from inventing one.
    const capacity = laneCapacity(null, [scheduledWo("1", localAt(9), localAt(11))], BAND);
    assert.equal(capacity.bookedMinutes, 120);
  });

  it("a technician with a recorded schedule but zero available minutes is NOT the same as unknown", () => {
    const zero = laneCapacity({ availableMinutes: 0, workingAvailability: {} }, [], BAND);
    assert.equal(zero.known, true, "the record exists, so the fact is known");
    assert.equal(zero.percentBooked, null, "a ratio over zero is still unanswerable");
  });

  it("a recorded schedule produces a real percentage", () => {
    const capacity = laneCapacity(
      { availableMinutes: 480, workingAvailability: {} },
      [scheduledWo("1", localAt(9), localAt(11))],
      BAND,
    );
    assert.equal(capacity.known, true);
    assert.equal(capacity.percentBooked, 25);
  });

  it("the fleet number is withheld when ANY technician's denominator is unknown", () => {
    const known = laneCapacity({ availableMinutes: 480, workingAvailability: {} }, [], BAND);
    const unknown = laneCapacity(null, [], BAND);
    assert.equal(fleetBookedPercent([known, known]), 0, "all known: a real aggregate");
    assert.equal(
      fleetBookedPercent([known, unknown]), null,
      "one unknown denominator makes the aggregate a fabrication",
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("time geometry comes from committed facts", () => {
  it("places a window by its clock position, not by row order", () => {
    const at9 = placeInBand(localAt(9), localAt(11), BAND);
    const at13 = placeInBand(localAt(13), localAt(15), BAND);
    // Band is 7a-5p = 10 hours. 9a is 2 hours in = 20%; 1p is 6 hours in = 60%.
    assert.equal(Math.round(at9.leftPercent), 20);
    assert.equal(Math.round(at9.widthPercent), 20);
    assert.equal(Math.round(at13.leftPercent), 60);
    assert.ok(at13.leftPercent > at9.leftPercent, "a later job sits further right");
  });

  it("clamps a window that overruns the band and SAYS it did", () => {
    const early = placeInBand(localAt(5), localAt(9), BAND);
    assert.equal(early.leftPercent, 0);
    assert.equal(early.outsideBand, true, "the chip must be able to say it is cut off");
  });

  it("returns null for a window entirely outside the band, rather than drawing it at an edge", () => {
    assert.equal(placeInBand(localAt(2), localAt(4), BAND), null);
    assert.equal(placeInBand(localAt(20), localAt(22), BAND), null);
  });

  it("refuses to place an unusable window", () => {
    assert.equal(placeInBand(null, localAt(9), BAND), null);
    assert.equal(placeInBand(localAt(11), localAt(9), BAND), null, "an inverted window is not geometry");
  });

  it("the hour header spans the same band the lanes do", () => {
    const hours = bandHours(BAND);
    assert.equal(hours.length, 10);
    assert.equal(hours[0].label, "7a");
    assert.equal(hours[9].label, "4p");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the band covers what the day actually holds", () => {
  // THE DEFECT THIS SECTION EXISTS FOR. ND-20 allows work outside recorded hours, because field
  // service legitimately schedules an emergency at 02:00. A fixed 7a–5p board would COMMIT that
  // placement and then draw nothing — the job would exist, be billable, and be invisible on the
  // surface built to see it. Found by the live Quick Gate: every scheduled job in the sandbox sat
  // outside the fixed band, and the day board rendered empty while insisting it was fine.

  it("defaults to 7a–5p on a day with nothing on it", () => {
    const band = dayBand(localAt(12), []);
    assert.equal(new Date(band.startMillis).getHours(), 7);
    assert.equal(new Date(band.endMillis).getHours(), 17);
  });

  it("stretches EARLIER for an overnight emergency, so the chip is drawn", () => {
    const emergency = scheduledWo("e", localAt(2), localAt(4));
    const band = dayBand(localAt(12), dayOccupancy([emergency]));
    assert.equal(new Date(band.startMillis).getHours(), 2);
    assert.ok(placeInBand(localAt(2), localAt(4), band), "the 02:00 job is now placeable");
  });

  it("stretches LATER, rounding a part-hour end up so nothing is clipped", () => {
    const evening = scheduledWo("v", localAt(18), localAt(19, 30));
    const band = dayBand(localAt(12), dayOccupancy([evening]));
    assert.equal(new Date(band.endMillis).getHours(), 20, "19:30 rounds up to 20:00");
    assert.equal(placeInBand(localAt(18), localAt(19, 30), band).outsideBand, false, "drawn whole");
  });

  it("never shrinks below the working day — a quiet day still reads as one", () => {
    const midday = scheduledWo("m", localAt(11), localAt(12));
    const band = dayBand(localAt(12), dayOccupancy([midday]));
    assert.equal(new Date(band.startMillis).getHours(), 7);
    assert.equal(new Date(band.endMillis).getHours(), 17);
  });

  it("blocked time widens the band too", () => {
    const view = { blockedTime: [{ blockId: "b", kind: "PTO", startMillis: localAt(5), endMillis: localAt(6) }] };
    const band = dayBand(localAt(12), dayOccupancy([], [view]));
    assert.equal(new Date(band.startMillis).getHours(), 5);
  });

  it("a neighbouring day does not drag its hours onto this one", () => {
    const tomorrow = scheduledWo("t", localAt(3, 0, 1), localAt(5, 0, 1));
    const band = dayBand(localAt(12), dayOccupancy([tomorrow]));
    assert.equal(new Date(band.startMillis).getHours(), 7, "tomorrow 3am must not open today at 3am");
  });

  it("the hour header always spans exactly the band in force", () => {
    const band = dayBand(localAt(12), dayOccupancy([scheduledWo("e", localAt(2), localAt(4))]));
    const hours = bandHours(band);
    assert.equal(hours.length, 15, "2a..5p");
    assert.equal(hours[0].label, "2a");
  });
});

// ---------------------------------------------------------------------------------------------
describe("what counts as placed", () => {
  it("only SCHEDULED work with a real window is placed on a lane", () => {
    assert.equal(isPlaced(scheduledWo("1", localAt(9), localAt(11))), true);
    assert.equal(isPlaced({ ...scheduledWo("2", localAt(9), localAt(11)), status: "DISPATCHED" }), false);
    assert.equal(isPlaced({ id: "3", status: "SCHEDULED" }), false, "SCHEDULED without a window is not placed");
    assert.equal(isPlaced({ id: "4", status: "READY_TO_DISPATCH" }), false);
  });

  it("reads Firestore Timestamp windows as well as raw millis", () => {
    const asTimestamp = {
      id: "5", status: "SCHEDULED",
      scheduledStart: { toMillis: () => localAt(9) },
      scheduledEnd: { toMillis: () => localAt(11) },
    };
    assert.equal(placementWindow(asTimestamp).durationMinutes, 120);
  });
});

// ---------------------------------------------------------------------------------------------
describe("blocked time is drawn from the governed read", () => {
  const view = {
    blockedTime: [
      { blockId: "b1", kind: "LUNCH", startMillis: localAt(12), endMillis: localAt(12, 30) },
      { blockId: "b2", kind: "PTO", startMillis: localAt(3), endMillis: localAt(5) },
    ],
  };

  it("positions only blocks that overlap the drawn band", () => {
    const placed = placedBlockedTime(view, BAND);
    assert.equal(placed.length, 1, "the 3am-5am block is outside 7a-5p");
    assert.equal(placed[0].block.blockId, "b1");
  });

  it("totals blocked minutes inside the band only", () => {
    assert.equal(blockedMinutesInBand(view, BAND), 30);
  });

  it("reports no blocked time when the availability record is absent", () => {
    assert.equal(blockedMinutesInBand(null, BAND), 0);
    assert.deepEqual(placedBlockedTime(null, BAND), []);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the shift line", () => {
  const weekly = { [new Date(BAND.startMillis).getDay()]: [{ start: "07:00", end: "12:00" }, { start: "13:00", end: "16:00" }] };

  it("reports the outer bounds of a split day", () => {
    // An unpaid lunch is two intervals. The line reports 7a-4p and the GAP shows in the grid, rather
    // than the line inventing a summary the record does not make.
    assert.equal(shiftLabel({ workingAvailability: { weeklyHours: weekly } }, BAND), "7a–4p");
  });

  it("is null when no schedule is recorded, so the caller can say so in words", () => {
    assert.equal(shiftLabel(null, BAND), null);
    assert.equal(shiftLabel({ workingAvailability: null }, BAND), null);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Day, Week and 2 Weeks agree on one schedule", () => {
  const wo = scheduledWo("same", localAt(9), localAt(11));

  it("the same placement lands on the same calendar day in every projection", () => {
    const days = weekDays(localAt(12), localAt(12));
    const weekBucket = bucketByDay([wo], days);
    const fortnight = fortnightDays(localAt(12), localAt(12));
    const fortnightBucket = bucketByDay([wo], fortnight);
    const dayStart = startOfDayMillis(localAt(9));

    assert.equal((weekBucket.get(dayStart) ?? []).length, 1, "week view finds it on its own day");
    assert.equal((fortnightBucket.get(dayStart) ?? []).length, 1, "fortnight finds it on the same day");
    // And the day board's own band is that same day.
    assert.equal(startOfDayMillis(dayBand(localAt(9)).startMillis), dayStart);
  });

  it("bucketing uses the committed window, so no view can invent a different day", () => {
    const days = weekDays(localAt(12), localAt(12));
    const tomorrow = scheduledWo("t", localAt(9, 0, 1), localAt(11, 0, 1));
    const buckets = bucketByDay([wo, tomorrow], days);
    assert.equal((buckets.get(startOfDayMillis(localAt(9))) ?? []).length, 1);
    assert.equal((buckets.get(startOfDayMillis(localAt(9, 0, 1))) ?? []).length, 1);
  });

  it("orders a day's jobs by start time", () => {
    const days = weekDays(localAt(12), localAt(12));
    const late = scheduledWo("late", localAt(14), localAt(15));
    const early = scheduledWo("early", localAt(8), localAt(9));
    const bucket = bucketByDay([late, early], days).get(startOfDayMillis(localAt(9)));
    assert.deepEqual(bucket.map((e) => e.workOrder.id), ["early", "late"]);
  });

  it("a multi-day block hatches every day it covers", () => {
    // A two-day PTO that only marked its first day would invite a drop onto the second.
    const days = weekDays(localAt(12), localAt(12));
    const view = { blockedTime: [{ blockId: "pto", kind: "PTO", startMillis: localAt(9), endMillis: localAt(9, 0, 2) }] };
    const buckets = bucketBlockedByDay(view, days);
    assert.equal((buckets.get(startOfDayMillis(localAt(9))) ?? []).length, 1);
    assert.equal((buckets.get(startOfDayMillis(localAt(9, 0, 1))) ?? []).length, 1);
  });
});
