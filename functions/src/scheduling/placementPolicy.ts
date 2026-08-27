// Dispatch & Scheduler -- THE governed placement policy. One implementation, every entry point.
//
// ============================ WHY THIS IS ITS OWN MODULE (ND-24) ============================
//
// ND-20 decided the collision policy for the SCHEDULING DOMAIN, not for one callable. It shipped
// implemented inside schedulingCommands.ts and wired into `rescheduleWorkOrder` and
// `reassignScheduledWorkOrder` -- while `transitionWorkOrder` action `Schedule`, the path that makes
// the FIRST placement, went on validating overlap alone, exactly as it had before the domain existed.
//
// The live Scheduling Functional Gate found the consequence: a dispatcher could Schedule a Work Order
// to start in the past, or into a technician's PTO, and be refused for the identical window if they
// instead pressed Reschedule. Two entry points, two answers, same business question. The board would
// have inherited the inconsistency and presented it as fact.
//
// So the policy moved OUT of the command service and into this file, and both callers import it.
// That is the whole point and it is worth being blunt about: this module exists so the two paths
// CANNOT drift, not merely so they happen to agree today. A second copy of this table anywhere is
// the defect being reintroduced, and `schedulingPlacementSymmetry.test.mjs` is what makes saying so
// falsifiable rather than aspirational.
//
// ============================ WHAT IT DELIBERATELY IS NOT ============================
//
// It is not a state machine, an authorization check, or an audit writer. It answers exactly one
// question -- MAY this technician hold this window -- and its callers remain responsible for
// everything else. It performs READS ONLY, so it is safe to call anywhere in a transaction's read
// phase, and it must stay that way: a policy check that wrote would make every caller's write
// ordering its problem.
import type { Transaction } from "firebase-admin/firestore";

import { WORK_ORDERS_COLLECTION } from "../constants/collections";
import { findScheduleConflict } from "../workOrderAvailability";
import { assessWorkingHours, findBlockedTimeConflict } from "./availabilityModel";
import {
  db,
  GOVERNED_TECHNICIAN_STATUSES,
  loadBlockedTime,
  loadTechnician,
  loadWorkingAvailability,
} from "./schedulingRepository";
import { SchedulingError, type SchedulingWarning } from "./types";

/**
 * How far into the past a start may fall before it is refused.
 *
 * Not zero, on purpose: a dispatcher pressing Schedule for "now" loses a race against their own
 * network. Client clocks, request latency and server clocks all differ by seconds, and refusing on
 * that would refuse a correct action for a reason nobody could see.
 */
export const PAST_START_TOLERANCE_MS = 60_000;

export interface PlacementCheck {
  technicianId: string;
  /** Excluded from the overlap query -- a Work Order never collides with its own placement. */
  workOrderId: string;
  startMillis: number;
  endMillis: number;
  nowMillis: number;
}

/**
 * Every refusal in ND-20 except the ones input validation already made, applied in one place so no
 * placement path can drift into a different idea of what a legal placement is.
 *
 * REFUSES on: a start in the past, a technician that does not exist or carries no governed status,
 * blocked time, and an overlapping Work Order.
 *
 * RETURNS the warnings that ride along with a placement that is legal but worth mentioning --
 * outside recorded working hours, or no working hours recorded at all. Warnings are returned rather
 * than thrown because ND-20 says they must not refuse: field service legitimately schedules emergency
 * work at 02:00, and a system that refused would be refusing real business. A caller that discards
 * the return value is discarding the only signal a dispatcher gets, and is wrong to.
 */
export async function checkPlacement(tx: Transaction, check: PlacementCheck): Promise<SchedulingWarning[]> {
  const { technicianId, workOrderId, startMillis, endMillis, nowMillis } = check;

  if (startMillis < nowMillis - PAST_START_TOLERANCE_MS) {
    throw new SchedulingError("START_IN_PAST", "A Work Order cannot be scheduled to start in the past.");
  }

  const technician = await loadTechnician(tx, technicianId);
  if (!technician) {
    throw new SchedulingError("TECHNICIAN_NOT_FOUND", `No technician record exists at ${technicianId}.`);
  }
  // Eligibility, as far as this repository can honestly assert it today: a governed technician record
  // whose status is one the platform recognises. There is no skill, certification or territory model
  // to check against -- inventing one here would be inventing business policy, so this refuses only
  // what it can actually see is wrong. When a real eligibility authority exists, it belongs on this
  // line and nowhere else -- and now that both placement paths run through here, "this line" is a
  // single line rather than one per entry point.
  if (!GOVERNED_TECHNICIAN_STATUSES.has(technician.status)) {
    throw new SchedulingError(
      "TECHNICIAN_INELIGIBLE",
      `Technician ${technicianId} has no governed status and cannot be scheduled.`,
    );
  }

  const blocks = await loadBlockedTime(tx, technicianId, startMillis);
  const blocked = findBlockedTimeConflict(blocks, startMillis, endMillis);
  if (blocked) {
    throw new SchedulingError(
      "BLOCKED_TIME_CONFLICT",
      `Technician ${technicianId} has ${blocked.kind} blocked time overlapping that window.`,
    );
  }

  // The same query and the same pure overlap function the Schedule transition used inline before
  // ND-24 -- which is why moving Schedule onto this function changed its overlap behavior not at all,
  // and changed everything above.
  const otherSnap = await tx.get(
    db().collection(WORK_ORDERS_COLLECTION).where("scheduledTechId", "==", technicianId),
  );
  const others = otherSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      scheduledTechId: data.scheduledTechId,
      scheduledStart: data.scheduledStart,
      scheduledEnd: data.scheduledEnd,
      status: data.status,
    };
  });
  const conflict = findScheduleConflict(technicianId, workOrderId, startMillis, endMillis, others);
  if (conflict) {
    throw new SchedulingError(
      "SCHEDULE_CONFLICT",
      `Technician ${technicianId} is already scheduled for overlapping Work Order ${conflict}.`,
    );
  }

  const availability = await loadWorkingAvailability(tx, technicianId);
  return assessWorkingHours(availability, startMillis, endMillis).warnings;
}
