// The ONE vocabulary for Equipment status.
//
// Same problem workOrderStatus.js was written to solve, one field over. EQUIPMENT_STATUS
// (domain/constants.js) is the stored machine value -- ACTIVE, INACTIVE, RETIRED -- and
// two surfaces already turn it into words privately and identically:
// modules/equipment/EquipmentDetail.jsx and modules/equipment/EquipmentRegister.jsx each
// carry their own `STATUS_LABEL = { ACTIVE: "Active", INACTIVE: "Inactive", RETIRED:
// "Retired" }`. They agree today, by coincidence rather than by a shared source -- exactly
// the setup #1093 turned into a wrong number on screen once already, one field over. This
// module is the shared source; it does not change either label, only where it lives.
//
// Created for S-INV-EQUIPMENT-DEFINITION so the equipment metadata definition can cite a
// domain vocabulary the way workOrder.js cites workOrderStatus.js, rather than declaring
// a second, metadata-local copy (which the metadata boundary §8/§7 forbids -- a definition
// is data, and a label map inlined into it would be a third private copy, not zero).
//
// The machine values stay uppercase (EQUIPMENT_STATUS) and are never compared against
// these labels. NOT the inventory-control lifecycle (CONTROLLED/EXITED/NOT_STARTED/
// UNKNOWN) -- that is a separately computed read, described where it is computed
// (domain/equipmentInventoryControlAdapter.js), and has no place in this map.

import { EQUIPMENT_STATUS } from "./constants.js";

/** Stored value -> the words a user reads. */
export const EQUIPMENT_STATUS_LABEL = Object.freeze({
  [EQUIPMENT_STATUS.ACTIVE]: "Active",
  [EQUIPMENT_STATUS.INACTIVE]: "Inactive",
  [EQUIPMENT_STATUS.RETIRED]: "Retired",
});

/** The canonical machine values, declaration order. */
export const EQUIPMENT_STATUS_VALUES = Object.freeze(Object.keys(EQUIPMENT_STATUS_LABEL));

/**
 * Display text for a stored status.
 *
 * An unrecognised value is returned VERBATIM rather than mapped to a default -- the same
 * fail-closed choice workOrderStatusLabel() makes, for the same reason: a status this
 * vocabulary does not know about is a data question, and silently relabelling it would
 * hide exactly the kind of mismatch #1093 was.
 */
export function equipmentStatusLabel(status) {
  return EQUIPMENT_STATUS_LABEL[status] ?? status ?? "";
}
