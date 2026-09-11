// The inventory-authority writer -> capability census, P1A step 2 of docs/design/
// eos-operational-data-plane-inventory-authority-cutover.md.
//
// ONE deduplicated, mechanically-verified table -- read directly from source, never inferred
// from documentation -- naming every authorize(...) / permission / capability check the eight
// inventory-authority writers perform today, the exact capability key(s) involved, and whether
// that check goes through the governed capability catalog (`authorize(actorId, capability)`,
// resolved by `access/resolveEffectivePermission.ts`) or a hardcoded Firestore `users/{uid}.role`
// string comparison that the capability catalog has never covered.
//
// PURE DATA. No Firebase, no Postgres, no pg import -- safe to import from either the
// Firestore-reading parity harness (adminPolicy/migration/inventoryCapabilityParityHarness.ts) or
// the Postgres-only grant migration tool (eosOps/migration/inventoryCapabilityGrantMigration.ts)
// without either acquiring the other's guard obligations.
export type LegacyAuthorizationKind =
  // Resolved through access/resolveEffectivePermission.ts against the Role catalog
  // (compatibilityRoles.ts + governedBusinessRoles.ts) and the per-environment activation
  // overrides -- the SAME resolver every governed capability check in this codebase uses.
  | "CAPABILITY_CATALOG"
  // A hardcoded `users/{uid}.role` (or WO transitionEngine.ACTION_PERMISSIONS) string
  // comparison. The capability catalog has never named these. This is a mechanically-verified
  // discrepancy from the design doc's per-writer table, which reads "Same injected
  // authorize(...)" for every one of the eight writers.
  | "HARDCODED_ROLE";

export interface WriterCapabilityOperation {
  /** Stable id for this one authorization check -- a writer may perform more than one. */
  readonly operationKey: string;
  readonly writerFamily: string;
  readonly sourceFile: string;
  /** The exact capability KEY this operation is authorized against, once migrated into eos_policy. */
  readonly capabilityKey: string;
  readonly kind: LegacyAuthorizationKind;
  /**
   * For a CAPABILITY_CATALOG operation: the legacy capability string checked today (identical to
   * capabilityKey -- migration 006 preserves it exactly, invents nothing).
   *
   * For a HARDCODED_ROLE operation: undefined. There is no legacy capability string; the roles
   * below are what the legacy code checks directly.
   */
  readonly legacyCapabilityKey?: string;
  /** For a HARDCODED_ROLE operation: exactly the roles the legacy code accepts. */
  readonly legacyRoles?: readonly string[];
  /**
   * True when the legacy code also requires the acting principal to be the SPECIFIC assigned
   * technician (an instance-level ownership guard, e.g. `wo.assignedTechId === caller.technicianId`)
   * -- not a role/capability fact, and out of scope for the capability-parity harness, which asks
   * "may this principal EVER hold this capability", not "is this the record's own owner".
   */
  readonly requiresOwnAssignment: boolean;
  /** Human note on additional stages / guards beyond the capability check itself. */
  readonly note: string;
}

/**
 * The eight inventory-authority writers, deduplicated. Cycle Count's five keys are the P0
 * baseline (migration 004) and are included here only as a completeness check for the census --
 * this migration does not touch them.
 */
export const WRITER_CAPABILITY_CENSUS: readonly WriterCapabilityOperation[] = Object.freeze([
  {
    operationKey: "receiving.receive",
    writerFamily: "Receiving",
    sourceFile: "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts",
    capabilityKey: "inventory.stock.receive",
    legacyCapabilityKey: "inventory.stock.receive",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Single-stage authorization. No environment activation override is registered for this id -- it is reachable wherever the Role grant exists.",
  },
  {
    operationKey: "transfer.create",
    writerFamily: "Transfer",
    sourceFile: "functions/src/inventoryTransfer/transferOrderCommand.ts",
    capabilityKey: "inventory.transfer.create",
    legacyCapabilityKey: "inventory.transfer.create",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "One of four independently-authorized Transfer stages (create/dispatch/receive/cancel), each its own capability. Registered active:false by default; needs an environment activation override to be reachable at all.",
  },
  {
    operationKey: "transfer.dispatch",
    writerFamily: "Transfer",
    sourceFile: "functions/src/inventoryTransfer/transferOrderCommand.ts",
    capabilityKey: "inventory.transfer.dispatch",
    legacyCapabilityKey: "inventory.transfer.dispatch",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Second Transfer stage; same activation-override requirement as transfer.create.",
  },
  {
    operationKey: "transfer.receive",
    writerFamily: "Transfer",
    sourceFile: "functions/src/inventoryTransfer/transferOrderCommand.ts",
    capabilityKey: "inventory.transfer.receive",
    legacyCapabilityKey: "inventory.transfer.receive",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Third Transfer stage; also independently held by the Inventory Transfer Receiver Role (a technician accepting stock onto a truck, with none of the other three Transfer capabilities).",
  },
  {
    operationKey: "transfer.cancel",
    writerFamily: "Transfer",
    sourceFile: "functions/src/inventoryTransfer/transferOrderCommand.ts",
    capabilityKey: "inventory.transfer.cancel",
    legacyCapabilityKey: "inventory.transfer.cancel",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Fourth Transfer stage; same activation-override requirement as transfer.create.",
  },
  {
    operationKey: "relocation.relocate",
    writerFamily: "Relocation",
    sourceFile: "functions/src/inventoryLocation/stockRelocationCommand.ts",
    capabilityKey: "inventory.stock.relocate",
    legacyCapabilityKey: "inventory.stock.relocate",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "PRIMARY stage of a two-stage authorization: relocation always requires inventory.stock.relocate, then OPTIONALLY inventory.placement.record when the caller also asks to record a BIN placement (req.recordPlacement). Registered active:false; needs an environment activation override.",
  },
  {
    operationKey: "relocation.recordPlacement",
    writerFamily: "Relocation",
    sourceFile: "functions/src/inventoryLocation/stockRelocationCommand.ts",
    capabilityKey: "inventory.placement.record",
    legacyCapabilityKey: "inventory.placement.record",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "SECOND stage, checked only when req.recordPlacement is set. Also the sole capability of the separate Put-Away writer family's own primary check (inventoryLocation/putAwayCommand.ts) -- one capability key shared by two callers, not two keys for one concept.",
  },
  {
    operationKey: "workOrderConsumption.record",
    writerFamily: "Work Order physical consumption",
    sourceFile: "functions/src/updateWorkOrderExecutionData.ts",
    capabilityKey: "inventory.workOrderConsumption.record",
    kind: "HARDCODED_ROLE",
    legacyRoles: ["technician"],
    requiresOwnAssignment: true,
    note: "NOT authorized through the capability catalog. updateWorkOrderExecutionData.ts hardcodes `caller.role !== \"technician\"` (line ~128) plus `wo.assignedTechId !== caller.technicianId` (line ~163, the ownership guard, out of capability-parity scope). This is the LIVE writer (PHYSICAL_CONSUMPTION_ACTIVE = true) -> planPhysicalConsumption -> stageOperationalMovement. Neither consumptionMovement.ts nor planPhysicalConsumption.ts itself performs any authorization check.",
  },
  {
    operationKey: "serializedInstall.install",
    writerFamily: "Serialized asset install",
    sourceFile: "functions/src/equipmentInstall/installSerializedAssetCommand.ts",
    capabilityKey: "equipment.install",
    legacyCapabilityKey: "equipment.install",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Single-stage. Deliberately confers NO inventory.serializedAsset.acquire (bringing a unit onto the books) -- a separate, two-station design decision (2026-08-23) unrelated to this census.",
  },
  {
    operationKey: "dataImport.openingBalance",
    writerFamily: "Data Import opening balance",
    sourceFile: "functions/src/dataImport/openingInventoryBalance.ts",
    capabilityKey: "admin.dataImport.execute",
    legacyCapabilityKey: "admin.dataImport.execute",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "The check lives in the caller (dataImport/dataImportCallables.ts's requireCapability(db, actorUid, CAP_EXECUTE)), not in openingInventoryBalance.ts itself, which performs no authorization -- it only applies the ledger primitives once execution has already been authorized.",
  },
  {
    operationKey: "cycleCount.create",
    writerFamily: "Cycle Count reconcile",
    sourceFile: "functions/src/cycleCount/cycleCountSheetCommand.ts",
    capabilityKey: "inventory.cycleCount.create",
    legacyCapabilityKey: "inventory.cycleCount.create",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Already migrated (migration 004, P0). Included for census completeness only -- this migration does not touch it.",
  },
  {
    operationKey: "cycleCount.submit",
    writerFamily: "Cycle Count reconcile",
    sourceFile: "functions/src/cycleCount/cycleCountSheetCommand.ts",
    capabilityKey: "inventory.cycleCount.submit",
    legacyCapabilityKey: "inventory.cycleCount.submit",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Already migrated (migration 004, P0).",
  },
  {
    operationKey: "cycleCount.cancel",
    writerFamily: "Cycle Count reconcile",
    sourceFile: "functions/src/cycleCount/cycleCountSheetCommand.ts",
    capabilityKey: "inventory.cycleCount.cancel",
    legacyCapabilityKey: "inventory.cycleCount.cancel",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Already migrated (migration 004, P0).",
  },
  {
    operationKey: "cycleCount.reconcile",
    writerFamily: "Cycle Count reconcile",
    sourceFile: "functions/src/cycleCount/cycleCountSheetCommand.ts",
    capabilityKey: "inventory.cycleCount.reconcile",
    legacyCapabilityKey: "inventory.cycleCount.reconcile",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Already migrated (migration 004, P0). PLUS the M23 self-approval separation-of-duties guard (instance-level, out of capability-parity scope), same shape as workOrderConsumption's ownership guard.",
  },
  {
    operationKey: "cycleCount.close",
    writerFamily: "Cycle Count reconcile",
    sourceFile: "functions/src/cycleCount/cycleCountSheetCommand.ts",
    capabilityKey: "inventory.cycleCount.close",
    legacyCapabilityKey: "inventory.cycleCount.close",
    kind: "CAPABILITY_CATALOG",
    requiresOwnAssignment: false,
    note: "Already migrated (migration 004, P0).",
  },
  {
    operationKey: "workOrderReservation.dispatch",
    writerFamily: "Work Order reservation / commitment lifecycle",
    sourceFile: "functions/src/transitionEngine.ts (via functions/src/transitionWorkOrder.ts -> functions/src/inventoryService.ts)",
    capabilityKey: "workOrder.lifecycle.dispatch",
    kind: "HARDCODED_ROLE",
    legacyRoles: ["admin", "dispatcher"],
    requiresOwnAssignment: false,
    note: "inventoryService.ts itself performs ZERO authorization checks -- it is a server-only trigger (triggerInventoryEffects(), never client-callable) whose entire authority is inherited from the upstream WO transition. Opens the RESERVED commitment. Scoped to exactly this ACTION_PERMISSIONS entry, not the full WO action matrix.",
  },
  {
    operationKey: "workOrderReservation.cancel",
    writerFamily: "Work Order reservation / commitment lifecycle",
    sourceFile: "functions/src/transitionEngine.ts (via functions/src/transitionWorkOrder.ts -> functions/src/inventoryService.ts)",
    capabilityKey: "workOrder.lifecycle.cancel",
    kind: "HARDCODED_ROLE",
    legacyRoles: ["admin", "dispatcher"],
    requiresOwnAssignment: false,
    note: "Closes the open RESERVED commitment as RELEASED. Same inheritance shape as workOrderReservation.dispatch.",
  },
  {
    operationKey: "workOrderReservation.complete",
    writerFamily: "Work Order reservation / commitment lifecycle",
    sourceFile: "functions/src/transitionEngine.ts (via functions/src/transitionWorkOrder.ts -> functions/src/inventoryService.ts)",
    capabilityKey: "workOrder.lifecycle.complete",
    kind: "HARDCODED_ROLE",
    legacyRoles: ["technician"],
    requiresOwnAssignment: true,
    note: "Closes the open RESERVED commitment as CONSUMED. ACTION_PERMISSIONS.Complete additionally requires requiresOwnAssignment=true (the WO's own assigned technician) -- an instance-level guard, out of capability-parity scope, same shape as workOrderConsumption.record's ownership guard.",
  },
]);

/** The 8 writer families, exactly, for a completeness assertion independent of operation count. */
export const WRITER_FAMILIES: readonly string[] = Object.freeze([
  "Receiving",
  "Transfer",
  "Relocation",
  "Work Order physical consumption",
  "Serialized asset install",
  "Data Import opening balance",
  "Cycle Count reconcile",
  "Work Order reservation / commitment lifecycle",
]);

/** Every capability key this census names -- the "sufficient vocabulary" P1A-1 must catalog. */
export function censusCapabilityKeys(): readonly string[] {
  return Object.freeze([...new Set(WRITER_CAPABILITY_CENSUS.map((op) => op.capabilityKey))].sort());
}

/** The subset of capability keys migration 006 adds -- i.e. every key that is not one of Cycle Count's five P0 keys. */
export function newCapabilityKeys(): readonly string[] {
  return Object.freeze(censusCapabilityKeys().filter((key) => !key.startsWith("inventory.cycleCount.")));
}
