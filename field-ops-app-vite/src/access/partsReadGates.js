// WHICH AUTOMATIC READS MAY A PARTS-FAMILY PAGE FIRE FOR THIS PERSON? (UAT RO-01)
//
// Parts Catalog, Part detail and Receiving each fire several reads the moment they mount. The server refuses a read the caller cannot make
// (403), and a screen that fires one anyway takes that 403 on EVERY load and then states a refusal as "try again shortly". The refusal is
// correct; firing the read is the defect. This module answers, from the one EOS session answer, whether each read can possibly succeed, so
// the page asks only what it may be told.
//
//   queue                 readReorderQueue / readMyAssignedReorders -- the EOS surface inventory.reorderQueue: reorder.request.read AND the
//                         REORDER_QUEUE Operational Scope (or the Administrator's reach). reorder.request.read ALONE is refused
//                         (OUTSIDE_OPERATIONAL_SCOPE), which is why a Service Technician (holds it, has a MOBILE scope only) is refused.
//                         The same decision NotificationControl already makes for the bell.
//   warehouseOptions      listReorderWarehouseOptions -- reorder.request.create.manual.
//   manufacturers         listManufacturers -- inventory.catalog.read AND inventory.manufacturer.read (the page's own door is catalog.read).
//   suppliers             listSuppliers -- supplier.record.read.
//
// Where EOS is not the session source every answer is TRUE: the legacy behaviour is unchanged (access/sessionAccess.js). These are READ
// gates. They never grant anything, and the server re-decides every call.
import {
  SESSION_GATE_KEYS,
  SESSION_GATE_SURFACES,
  sessionDecision,
  sessionSurfaceDecision,
  useSessionAccess,
} from "./sessionAccess.js";

/** Pure, for tests: the four answers for a session-access value. */
export function partsReadGates(access) {
  return Object.freeze({
    queue: sessionSurfaceDecision(access, SESSION_GATE_SURFACES.reorderQueue, true),
    warehouseOptions: sessionDecision(access, SESSION_GATE_KEYS.reorderManual, true),
    manufacturers: sessionDecision(access, SESSION_GATE_KEYS.manufacturerRead, true),
    suppliers: sessionDecision(access, SESSION_GATE_KEYS.supplierRead, true),
  });
}

export function usePartsReadGates() {
  return partsReadGates(useSessionAccess());
}

/** What a panel says in place of a queue the person does not hold. A statement of absence, never "none" or "try again". */
export const REORDER_QUEUE_NOT_AVAILABLE_COPY =
  "Reorder request queues are shown to people with Reorder Queue access. Your account does not have it, so nothing was requested.";
