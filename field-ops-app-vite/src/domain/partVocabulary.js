// Part Master — the human-readable label vocabulary for Part's closed enums.
//
// partMasterView.js already carries the canonical MACHINE VALUES for four of Part's five
// enums (PART_STATUSES, CONTROL_TYPES, STOCKING_CLASSES, UNIT_CODES) — it needs them to
// validate a raw Firestore document before handing a view model to React. What it does
// NOT carry is a word for any of them: the read-view mapper renders the stored value
// verbatim, and nothing in the client turns "SUPERSEDED" or "SERIALIZED_LOT" into
// something a person reads. This module is that missing layer, sourced from the same
// values rather than a second copy of them — the #1093 lesson (a label map that drifts
// from the values it labels is how "0 Active" ends up beside a table of ACTIVE rows).
//
// OEM_STATUSES HAS NO EXISTING CLIENT COPY. Unlike the other four, `oemStatus`
// (functions/src/partMaster/types.ts OEM_STATUSES) was never mirrored client-side —
// partMasterView.js's read-view mapper does not even validate it. Declared fresh here
// rather than left for the metadata definition to invent inline, for the same reason the
// other four are not: a definition file is not where a vocabulary lives.
//
// A metadata FieldDefinition imports its enumValues and enumLabels from here. It must
// never carry a second label map of its own — that is exactly the mistake this file
// exists to stop repeating.

import { PART_STATUSES, CONTROL_TYPES, STOCKING_CLASSES, UNIT_CODES } from "./partMasterView.js";

export { PART_STATUSES, CONTROL_TYPES, STOCKING_CLASSES, UNIT_CODES };

/** Stored value -> the words a user reads. */
export const PART_STATUS_LABEL = Object.freeze({
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  SUPERSEDED: "Superseded",
  DISCONTINUED: "Discontinued",
});

export const CONTROL_TYPE_LABEL = Object.freeze({
  STANDARD: "Standard",
  SERIALIZED: "Serialized",
  LOT: "Lot Tracked",
  SERIALIZED_LOT: "Serialized + Lot",
});

export const STOCKING_CLASS_LABEL = Object.freeze({
  STOCKED: "Stocked",
  NON_STOCK: "Non-Stock",
  SERVICE: "Service",
  KIT: "Kit",
});

/**
 * No existing client copy of the values — see the file header. Sourced here rather than
 * from functions/src/partMaster/types.ts, which is a server-only package this client
 * bundle cannot import across the package boundary (the same constraint salesOrder.js's
 * currency note and scripts/listIndexCoverage.mjs's cross-package comment both name).
 */
export const OEM_STATUSES = Object.freeze(["OEM", "AFTERMARKET", "UNKNOWN"]);

export const OEM_STATUS_LABEL = Object.freeze({
  OEM: "OEM (Genuine)",
  AFTERMARKET: "Aftermarket",
  UNKNOWN: "Unknown",
});

export const UNIT_CODE_LABEL = Object.freeze({
  EACH: "Each",
  KIT: "Kit",
  BOTTLE: "Bottle",
  TUBE: "Tube",
  BOX: "Box",
  CASE: "Case",
  FOOT: "Foot",
  ROLL: "Roll",
  GALLON: "Gallon",
  OUNCE: "Ounce",
  POUND: "Pound",
});
