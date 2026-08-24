import { makePageDefinition, makeSection } from "../pageDefinition.js";
import { EDITABLE_EQUIPMENT_FIELDS } from "../../domain/equipment.js";

// THE EQUIPMENT RECORD PAGE.
//
// ════════════════════ WHAT AN EDIT HERE ACTUALLY WRITES ════════════════════
//
// `domain/equipmentRepository.js#updateEquipment` -> updateEquipmentWith -> buildEquipmentEditPayload.
// The allowlist is not restated here: it is IMPORTED from the write path itself
// (EDITABLE_EQUIPMENT_FIELDS), because a copy would drift the first time that contract changed and
// the page would keep offering a pencil for a field the command had stopped accepting.
//
// ════════════════════ WHAT IS DELIBERATELY NOT EDITABLE ════════════════════
//
//   accountId, locationId   GOVERNED_EQUIPMENT_FIELDS. An ordinary edit that asked to change either
//                           is REFUSED WHOLE -- "a dropped move reported as success is worse than a
//                           refused edit". Moving equipment is a trusted, audited action, not a
//                           field you type over.
//   createdAt               governed likewise, and a fact besides.
//   updatedAt               stamped by the writer on every save; a typed value would be overwritten
//                           by the same call that saved it.
//   status                  THE INTERESTING ONE. It IS writable here, ACTIVE<->INACTIVE only
//                           (#312, mirroring firestore.rules equipmentTransitionAllowed). Into or
//                           out of RETIRED is refused, because retire and reactivate are trusted
//                           audited actions.
//
//                           So it is NOT on the page's editableFieldIds. A pencil is a promise that
//                           the field can be changed, and this one can be changed only in one
//                           direction pair -- a promise the page cannot qualify. The existing edit
//                           modal offers the legal transition with its own guard, and the retire /
//                           reactivate actions stay where they are. Rendering a pencil that
//                           sometimes refuses would teach people to distrust every pencil.
//
// ════════════════════ DENSITY ════════════════════
//
// SUMMARY answers what this unit is, what state it is in, and whose it is. Everything a technician
// standing in front of a machine needs before anything else.

export const equipmentRecordPage = makePageDefinition({
  id: "equipment.record",
  entityId: "equipment",
  label: "Equipment",
  writeCommand: "domain/equipmentRepository.js#updateEquipment",
  // Imported, never restated. See the header.
  editableFieldIds: [...EDITABLE_EQUIPMENT_FIELDS],
  sections: [
    makeSection({
      id: "equipmentIdentity",
      kind: "FIELD_GROUP",
      region: "HEADER",
      order: 0,
      label: "Overview",
      density: "SUMMARY",
      // Identity, state, and the serial number -- how a person standing at the machine confirms
      // they are looking at the right record.
      //
      // accountId and locationId are DELIBERATELY ABSENT, and are not missing from the page: the
      // existing "Customer & location" panel renders both, and it distinguishes a FAILED read from
      // a genuinely-unknown one with a Retry control. The generic field grid has no slot for that
      // -- it can say LOADING, DENIED, NOT_FOUND, but it cannot offer the retry. Rendering them
      // here as well would either duplicate the rows or lose the affordance, and losing it would
      // turn "we could not look" back into "Unknown customer" stated as a fact.
      fieldIds: ["name", "status", "serialNumber"],
    }),
    makeSection({
      id: "equipmentSpecification",
      kind: "FIELD_GROUP",
      region: "MAIN",
      order: 0,
      label: "Specification",
      density: "DETAILS",
      fieldIds: ["manufacturer", "model", "assetTag", "installedDate"],
    }),
    makeSection({
      id: "equipmentService",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 0,
      label: "Service & Notes",
      density: "SECONDARY",
      fieldIds: ["warrantyExpiresDate", "notes"],
    }),
    makeSection({
      id: "equipmentRecordMeta",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 10,
      label: "Record",
      density: "SYSTEM",
      // Stored as epoch NUMBERs on this collection, not Timestamps -- see equipment.js's
      // X-EQUIPMENT-PROVENANCE-GAP. There is no createdBy/updatedBy at all, so none is claimed.
      fieldIds: ["createdAt", "updatedAt"],
    }),
  ],
});
