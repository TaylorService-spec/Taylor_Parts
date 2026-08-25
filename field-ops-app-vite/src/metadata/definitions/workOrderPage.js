import { makePageDefinition, makeSection } from "../pageDefinition.js";

// THE WORK ORDER RECORD PAGE — READ-ONLY FIELDS, GOVERNED ACTIONS.
//
// ════════════════════ STATUS IS NOT A FIELD YOU TYPE OVER ════════════════════
//
// This is the authority boundary that matters most on this object. A Work Order's status is the
// output of a LIFECYCLE TRANSITION, not a value:
//
//     transitionWorkOrder           takes an ACTION NAME (Dispatch, Accept, Arrive, Complete, ...),
//                                   never a target status, and the transition engine decides
//                                   whether that action is legal from where the record is now
//     updateWorkOrderExecutionData  technician-only, ownership-checked execution data
//     setWorkOrderPartsPlan         its own capability and its own producer
//
// A status dropdown that patched the field would bypass every one of those guards, and it would
// bypass them silently — the record would land in a state no transition could have produced, and
// the engine would have no way to know how it got there. The same is true of the technician:
// assignment is what a Dispatch action DOES, and a patched assignedTechId is an assignment nobody
// dispatched.
//
// So `editableFieldIds` is EMPTY. There is no field-patch command for this object at all, which
// makes that a derived fact rather than a restraint the page is exercising. The existing lifecycle
// and execution actions stay exactly where they are.
//
// ════════════════════ DENSITY ════════════════════
//
// SUMMARY is a dispatcher's four questions: which job, what state, how urgent, whose, and is
// somebody going. Everything else is reference.

export const workOrderRecordPage = makePageDefinition({
  id: "workOrder.record",
  entityId: "workOrder",
  label: "Work Order",
  // No command accepts a field patch on this object. See the header.
  writeCommand: null,
  editableFieldIds: [],
  sections: [
    makeSection({
      id: "workOrderIdentity",
      kind: "FIELD_GROUP",
      region: "HEADER",
      order: 0,
      label: "Overview",
      density: "SUMMARY",
      fieldIds: ["woNumber", "status", "priority", "customerId", "equipmentId"],
    }),
    makeSection({
      id: "workOrderOperational",
      kind: "FIELD_GROUP",
      region: "MAIN",
      order: 0,
      label: "Job Details",
      density: "DETAILS",
      // scheduledStart is OPTIONAL on the record — an unscheduled Work Order simply has none, and
      // the field renders an em dash rather than implying a date nobody set.
      fieldIds: ["type", "scheduledStart", "locationId", "assignedTechId"],
    }),
    makeSection({
      id: "workOrderRecordMeta",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 0,
      label: "Record",
      density: "SYSTEM",
      // No equipment reference is claimed: the record has none at all
      // (WORK_ORDER_CARRIES_NO_EQUIPMENT_REFERENCE), and a column fed from install close-outs would
      // be empty for every open job — the rows a dispatcher is actually looking at.
      fieldIds: ["createdAt"],
    }),
  ],
});
