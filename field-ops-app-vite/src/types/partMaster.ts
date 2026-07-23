// INV-1 Phase 1, PR 1.9 -- client mirror of the Part Master read contract.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this repo)
// from functions/src/partMaster/types.ts, same obligation as types/
// workOrder.ts: "if either file changes, change the other to match."
// READ-ONLY subset: only the descriptive fields the governed client read
// surface displays. No write contract is widened by this mirror; mutation
// stays trusted-service-only (ADR-008 / Decision #40). Optionality is kept
// loose (description/category/manufacturer fields optional) so historical
// or partial records stay representable.
// Parity is enforced by field-ops-app-vite/test/partMasterTypes.test.mjs
// against these exact literals.

export const PART_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const CONTROL_TYPES = ["STANDARD", "SERIALIZED", "LOT", "SERIALIZED_LOT"] as const;
export type ControlType = (typeof CONTROL_TYPES)[number];

export const STOCKING_CLASSES = ["STOCKED", "NON_STOCK", "SERVICE", "KIT"] as const;
export type StockingClass = (typeof STOCKING_CLASSES)[number];

export const UNIT_CODES = ["EACH", "KIT", "BOTTLE", "TUBE", "BOX", "CASE", "FOOT", "ROLL", "GALLON", "OUNCE", "POUND"] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

/** Read-only client view of a canonical Part record. */
export interface ClientPart {
  partId: string;
  internalPartNumber: string;
  name: string;
  description?: string;
  category?: string;
  status: PartStatus;
  stockingUnit: UnitCode;
  controlType: ControlType;
  stockingClass: StockingClass;
  version: number;
}
