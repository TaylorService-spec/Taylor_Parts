// WHICH AUTOMATIC READS MAY A PARTS-FAMILY PAGE FIRE FOR THIS PERSON? (UAT RO-01; Access map, Option A piece 1)
//
// Parts Catalog, Part detail and Receiving each fire several reads the moment they mount. The server refuses a read the caller cannot make
// (403), and a screen that fires one anyway takes that 403 on EVERY load and then states a refusal as "try again shortly". The refusal is
// correct; firing the read is the defect.
//
// There is no list of capabilities in this file. Every answer is access/operationGate.js asking the generated map of what the SERVER requires
// for that operation (access/operationAccess.generated.js, built from the commands' own constants). This module only names the Parts pages'
// reads in the words the pages use:
//
//   queue                 readReorderQueue -- the EOS surface inventory.reorderQueue (reorder.request.read AND the REORDER_QUEUE scope).
//   myAssigned            readMyAssignedReorders -- reorder.request.read ONLY (the OWN reach).
//   warehouseOptions      listReorderWarehouseOptions
//   manufacturers         listManufacturers
//   suppliers             listSuppliers
//   supplierTermsReadable listPartSupplierItems -- a separate answer, not a key of partsReadGates().
//
// Where EOS is not the session source every answer is TRUE: the legacy behaviour is unchanged. These are READ gates. They never grant
// anything, and the server re-decides every call. A Part-detail section that needs a three-valued answer (loading / denied / askable) asks
// operationDecision() directly (access/operationGate.js).
import { operationAllowed } from "./operationGate.js";
import { useSessionAccess } from "./sessionAccess.js";

/** Pure, for tests: the answers for a session-access value. */
export function partsReadGates(access) {
  return Object.freeze({
    queue: operationAllowed(access, "readReorderQueue"),
    myAssigned: operationAllowed(access, "readMyAssignedReorders"),
    // true once the session answer has arrived (or EOS is not the source): a panel states an ABSENCE only then, so it never flashes before the answer.
    settled: !access?.eosSource || access.settled === true,
    warehouseOptions: operationAllowed(access, "listReorderWarehouseOptions"),
    manufacturers: operationAllowed(access, "listManufacturers"),
    suppliers: operationAllowed(access, "listSuppliers"),
  });
}

export function usePartsReadGates() {
  return partsReadGates(useSessionAccess());
}

/** Pure, for tests: may Part detail ask for this Part's supplier terms (listPartSupplierItems)? Kept out of partsReadGates() so that answer's shape is unchanged. */
export const supplierTermsReadable = (access) => operationAllowed(access, "listPartSupplierItems");

/** What a panel says in place of a queue the person does not hold. A statement of absence, never "none" or "try again". */
export const REORDER_QUEUE_NOT_AVAILABLE_COPY =
  "The shared Reorder request queues are shown to people with Reorder Queue access. Your account does not have it, so they were not requested.";

/** What Part detail says in place of a Reorder request status the person cannot read. A statement of absence, never "could not be loaded". */
export const PART_REORDER_STATUS_NOT_AVAILABLE_COPY =
  "Reorder requests for this part are shown to people with Reorder Queue access. Your account does not have it, so the part's reorder status was not requested.";

/** What Part detail's Identifiers section says in place of an identifier list the person cannot read. A statement of absence, never "none". */
export const PART_IDENTIFIERS_NOT_AVAILABLE_COPY =
  "Identifiers are listed for people with catalog management access. Your account does not have it, so they were not requested.";

/** What Part detail's archived-notes panel says in place of notes the person cannot read. */
export const LEGACY_NOTES_NOT_AVAILABLE_COPY =
  "Archived inventory notes are shown to people with inventory action access. Your account does not have it, so they were not requested.";
