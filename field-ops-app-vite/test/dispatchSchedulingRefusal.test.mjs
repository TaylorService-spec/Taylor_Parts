// Dispatch North Star P1 · frame 1b — "The chip springs back; never raw backend codes."
//
// The artifact makes this a design requirement rather than a nicety, and the reason is operational:
// a dispatcher told `BLOCKED_TIME_CONFLICT` has been handed the server's internal vocabulary and
// asked to translate it while a customer waits.
//
// The other half of what this suite defends is subtler and matters more. ND-20's WARNINGS ride along
// with a SUCCESSFUL placement, and they must be neither dropped nor rendered as failures. Dropping
// them makes an out-of-hours placement look unremarkable; styling them as errors tells a dispatcher
// their action failed when it committed.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  blockedKindChipLabel,
  blockedKindLabel,
  refusalContextFor,
  schedulingRefusalMessage,
  schedulingWarningMessage,
  schedulingWarningMessages,
} from "../src/domain/schedulingRefusal.js";

const TECHS = [{ id: "tech-a", name: "J. Barela" }, { id: "tech-b", name: "R. Ochoa" }];

describe("every governed refusal becomes a sentence", () => {
  const context = { technicianName: "J. Barela", workOrderRef: "WO-2026-001248" };

  it("names the technician and the condition", () => {
    assert.match(schedulingRefusalMessage("SCHEDULE_CONFLICT", "failed-precondition", context), /J\. Barela/);
    assert.match(schedulingRefusalMessage("SCHEDULE_CONFLICT", "failed-precondition", context), /already has work scheduled/);
    assert.match(schedulingRefusalMessage("BLOCKED_TIME_CONFLICT", "failed-precondition", context), /blocked time/);
    assert.match(schedulingRefusalMessage("START_IN_PAST", "failed-precondition", context), /in the past/);
    assert.match(schedulingRefusalMessage("TECHNICIAN_INELIGIBLE", "failed-precondition", context), /cannot be scheduled/);
  });

  it("never leaks the raw code into the sentence", () => {
    for (const code of ["SCHEDULE_CONFLICT", "BLOCKED_TIME_CONFLICT", "START_IN_PAST", "TECHNICIAN_INELIGIBLE", "STALE_WORK_ORDER"]) {
      const message = schedulingRefusalMessage(code, "failed-precondition", context);
      assert.ok(!message.includes(code), `"${message}" leaks ${code}`);
      assert.ok(!/_/.test(message), `"${message}" contains an underscore, which reads as a code`);
    }
  });

  it("tells a stale board what to actually do about it", () => {
    // The server reuses STALE_WORK_ORDER for a lost contention race and a genuinely stale view,
    // because from the caller's side they are the same situation with the same remedy.
    const message = schedulingRefusalMessage("STALE_WORK_ORDER", "aborted", context);
    assert.match(message, /changed while you were moving this/);
    assert.match(message, /try again/);
  });

  it("falls through to the transport status for an unrecognised code rather than guessing", () => {
    const message = schedulingRefusalMessage("SOME_FUTURE_CODE", "permission-denied", context);
    assert.match(message, /not authorized/);
  });

  it("says the least that is still true when nothing is recognised", () => {
    const message = schedulingRefusalMessage(null, "internal", context);
    assert.match(message, /could not be completed/);
    assert.match(message, /Nothing was changed/, "a refusal must state that state is intact");
  });

  it("degrades to a generic subject when the technician cannot be named", () => {
    const message = schedulingRefusalMessage("SCHEDULE_CONFLICT", "failed-precondition", {});
    assert.match(message, /that technician/);
    assert.ok(!message.includes("undefined") && !message.includes("null"));
  });
});

describe("warnings are successes, and are not dropped", () => {
  it("an out-of-hours placement reads as scheduled, not refused", () => {
    const message = schedulingWarningMessage("OUTSIDE_WORKING_HOURS", { technicianName: "J. Barela" });
    assert.match(message, /outside J\. Barela's recorded working hours/);
    assert.ok(!/refused/i.test(message), "a warning must never read as a refusal");
  });

  it("unrecorded availability warns DIFFERENTLY from outside-hours", () => {
    // These are two different facts and the domain keeps them apart server-side; collapsing them
    // here would tell a dispatcher a shift was violated when none is recorded at all.
    const outside = schedulingWarningMessage("OUTSIDE_WORKING_HOURS", {});
    const unrecorded = schedulingWarningMessage("NO_WORKING_AVAILABILITY_RECORDED", {});
    assert.notEqual(outside, unrecorded);
    assert.match(unrecorded, /no working hours recorded/);
  });

  it("renders every warning on a result, in order, and drops unknown codes rather than guessing", () => {
    const messages = schedulingWarningMessages(
      [{ code: "OUTSIDE_WORKING_HOURS" }, { code: "SOMETHING_NEW" }, { code: "NO_WORKING_AVAILABILITY_RECORDED" }],
      { technicianName: "R. Ochoa" },
    );
    assert.equal(messages.length, 2);
    assert.match(messages[0], /outside/);
    assert.match(messages[1], /no working hours recorded/);
  });

  it("a result with no warnings produces nothing to say", () => {
    assert.deepEqual(schedulingWarningMessages([], {}), []);
    assert.deepEqual(schedulingWarningMessages(undefined, {}), []);
  });
});

describe("the governed blocked-time vocabulary", () => {
  it("labels every kind the domain defines", () => {
    for (const kind of ["PTO", "LUNCH", "TRAINING", "MEETING", "TRUCK_SERVICE", "UNAVAILABLE", "COMPANY_CLOSURE"]) {
      const chip = blockedKindChipLabel(kind);
      assert.ok(chip.length > 0);
      assert.ok(!chip.includes("_"), `${chip} still reads as a code`);
    }
    assert.equal(blockedKindChipLabel("TRUCK_SERVICE"), "Truck service");
    assert.equal(blockedKindChipLabel("PTO"), "PTO", "an acronym stays an acronym");
  });

  it("an unrecognised kind degrades to plain words rather than rendering the raw value", () => {
    assert.equal(blockedKindLabel("SOMETHING_NEW"), "blocked time");
  });
});

describe("refusal context resolves names through the governed resolver", () => {
  it("uses a resolved technician name", () => {
    assert.equal(refusalContextFor(TECHS, "tech-a", { woNumber: "WO-1" }).technicianName, "J. Barela");
  });

  it("does NOT print a document id when the technician cannot be resolved", () => {
    // The whole point of routing through resolveTechnicianIdentity: an unknown id must fall back to
    // generic wording, never surface the raw key at a dispatcher.
    const context = refusalContextFor(TECHS, "tech-missing", { woNumber: "WO-1" });
    assert.equal(context.technicianName, null);
    const message = schedulingRefusalMessage("SCHEDULE_CONFLICT", "failed-precondition", context);
    assert.ok(!message.includes("tech-missing"));
  });

  it("carries the human work order reference, not the document id", () => {
    const context = refusalContextFor(TECHS, "tech-a", { id: "abc123XYZ", woNumber: "WO-2026-001248" });
    assert.equal(context.workOrderRef, "WO-2026-001248");
    const message = schedulingRefusalMessage("WORK_ORDER_NOT_FOUND", "not-found", context);
    assert.ok(!message.includes("abc123XYZ"));
  });
});
