// Dispatch & Scheduler -- the trusted READ path for technician availability.
//
// WHY THIS EXISTS. Both availability collections deny client reads as well as client writes (Owner
// ruling 2026-08-27, matching the sales_orders / opportunities posture). So the Dispatch board cannot
// query them, and without a read service the lane shading, blocked-time blocks and capacity figures
// the North Star draws would have nothing behind them.
//
// It is READ-ONLY. It writes nothing, audits nothing, and refuses nothing except an unauthorized
// caller -- there is no state to protect here beyond who may look.
//
// The capacity numbers it returns come from the SAME pure functions the scheduling commands validate
// against (availabilityModel.ts). That is deliberate and it is the point: a board fed by a different
// calculation than the one the server enforces is a board that lies, slowly, in ways nobody notices
// until a dispatcher trusts it.
import { getCallerContext } from "../callerContext";
import {
  availableMinutesInWindow,
  blockedMinutesInWindow,
} from "./availabilityModel";
import { db, TECHNICIANS_COLLECTION } from "./schedulingRepository";
import {
  SchedulingError,
  TECHNICIAN_BLOCKED_TIME_COLLECTION,
  TECHNICIAN_WORKING_AVAILABILITY_COLLECTION,
  type TechnicianBlockedTime,
  type TechnicianWorkingAvailability,
} from "./types";
import { parseScheduleWindow } from "./validation";

export interface TechnicianAvailabilityView {
  technicianId: string;
  /** Null when no working schedule is recorded. NOT the same as an empty one -- see below. */
  workingAvailability: TechnicianWorkingAvailability | null;
  blockedTime: TechnicianBlockedTime[];
  /**
   * Recorded working minutes in the requested window, minus blocked time. Null when no working
   * schedule is recorded.
   *
   * A caller MUST render null as "no working schedule recorded" and never as 0. Percent-booked over
   * an unknown denominator is not zero percent, it is unanswerable, and a board that shows every
   * technician at 0% on the day this collection ships would be reporting a fact about our data entry
   * as though it were a fact about the business.
   */
  availableMinutes: number | null;
}

export interface AvailabilityReadResult {
  startMillis: number;
  endMillis: number;
  technicians: TechnicianAvailabilityView[];
}

// A board asks for a day, a week or a fortnight of technicians. Past this the caller is not drawing a
// board, and a query fanning out over hundreds of technicians belongs in a report.
const MAX_TECHNICIANS = 200;

/**
 * Availability for the named technicians over one window, or for every technician when none are
 * named (what the Dispatch board asks for).
 */
export async function readTechnicianAvailability(actorUid: string, raw: unknown): Promise<AvailabilityReadResult> {
  const caller = await getCallerContext(actorUid);
  if (caller.role !== "admin" && caller.role !== "dispatcher") {
    throw new SchedulingError("PERMISSION_DENIED", "Only an admin or dispatcher may read technician availability.");
  }

  const data = (raw ?? {}) as Record<string, unknown>;
  const window = parseScheduleWindow({ scheduledStart: data.startMillis, scheduledEnd: data.endMillis });
  if (!window.valid) {
    throw new SchedulingError("INVALID_INPUT", "startMillis and endMillis must be a valid, bounded window.");
  }
  const { startMillis, endMillis } = window.value;

  let technicianIds: string[];
  if (Array.isArray(data.technicianIds)) {
    technicianIds = data.technicianIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  } else {
    const snap = await db().collection(TECHNICIANS_COLLECTION).limit(MAX_TECHNICIANS).get();
    technicianIds = snap.docs.map((d) => d.id);
  }
  if (technicianIds.length > MAX_TECHNICIANS) {
    throw new SchedulingError("INVALID_INPUT", `At most ${MAX_TECHNICIANS} technicians may be read at once.`);
  }

  const technicians = await Promise.all(
    technicianIds.map(async (technicianId): Promise<TechnicianAvailabilityView> => {
      const [availabilitySnap, blockedSnap] = await Promise.all([
        db().collection(TECHNICIAN_WORKING_AVAILABILITY_COLLECTION).doc(technicianId).get(),
        db()
          .collection(TECHNICIAN_BLOCKED_TIME_COLLECTION)
          .where("technicianId", "==", technicianId)
          .where("endMillis", ">", startMillis)
          .get(),
      ]);

      const workingAvailability = availabilitySnap.exists
        ? (availabilitySnap.data() as TechnicianWorkingAvailability)
        : null;
      // The same half-open overlap the commands enforce, applied here so a block the board draws is
      // exactly a block the server would refuse a placement into.
      const blockedTime = blockedSnap.docs
        .map((d) => ({ ...(d.data() as TechnicianBlockedTime), blockId: d.id }))
        .filter((b) => b.startMillis < endMillis);

      const available = availableMinutesInWindow(workingAvailability, { startMillis, endMillis });
      const blocked = blockedMinutesInWindow(workingAvailability, blockedTime, { startMillis, endMillis });
      const availableMinutes = available === null || blocked === null ? null : Math.max(0, available - blocked);

      return { technicianId, workingAvailability, blockedTime, availableMinutes };
    }),
  );

  return { startMillis, endMillis, technicians };
}
