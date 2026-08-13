// Regression for the technician double-booking defect (EOS-ISSUE-852 finding H2, discriminator
// `no-technician-availability-check`). Before this guard, transitionWorkOrder's Dispatch set assignedTechId
// unconditionally — a technician could be dispatched to two active Work Orders at once. These prove the guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findDoubleBookingConflict, isOccupyingStatus } from "../src/workOrderAvailability.ts";

test("DEFECT GUARD: a technician already on an active Work Order cannot be dispatched to another (double-booking)", () => {
  const others = [{ id: "wo-existing", assignedTechId: "tech-1", status: "WORK_IN_PROGRESS" }];
  const conflict = findDoubleBookingConflict("tech-1", "wo-new", others);
  assert.equal(conflict, "wo-existing", "the double-booking is detected and identified");
});

test("occupying statuses cover the whole active-dispatch span; terminal/pre-dispatch free the technician", () => {
  for (const s of ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]) assert.equal(isOccupyingStatus(s), true, s);
  for (const s of ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "COMPLETED", "CLOSED", "CANCELLED"]) assert.equal(isOccupyingStatus(s), false, s);
});

test("a technician whose only other Work Order is terminal (COMPLETED/CANCELLED) is FREE — no false block", () => {
  const others = [
    { id: "wo-done", assignedTechId: "tech-1", status: "COMPLETED" },
    { id: "wo-cancelled", assignedTechId: "tech-1", status: "CANCELLED" },
  ];
  assert.equal(findDoubleBookingConflict("tech-1", "wo-new", others), null);
});

test("re-dispatching the SAME Work Order to the same technician is not a conflict (self excluded)", () => {
  const others = [{ id: "wo-1", assignedTechId: "tech-1", status: "DISPATCHED" }];
  assert.equal(findDoubleBookingConflict("tech-1", "wo-1", others), null);
});

test("another technician's active Work Order does not block this technician", () => {
  const others = [{ id: "wo-other", assignedTechId: "tech-2", status: "WORK_IN_PROGRESS" }];
  assert.equal(findDoubleBookingConflict("tech-1", "wo-new", others), null);
});
