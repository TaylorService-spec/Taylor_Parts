// THE INVENTORY / WAREHOUSE ACTIVATION DELTA -- the Controller-ruled authority this package needs, stated as DATA so the
// nonprod activation window issues a reviewed list through Administration and the Workforce writer: never an improvised
// grant, never a migration grant, never a direct SQL scope (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
//   DQ-036b     inventory.serializedAsset.acquire -> Parts Associate, Parts Manager, Warehouse Associate, Warehouse Manager,
//               and nobody else by default. Acquire is for stock entering EOS OUTSIDE PO receiving (OPENING_BALANCE /
//               LEGACY_MIGRATION / EXISTING_COMPANY_ASSET); it is not another Receiving path.
//   TRANSFER    the EXISTING purpose-built Roles, completing the already-designed split (measured 2026-10-01: the operator
//               held only inventory.transfer.create; dispatch / receive / cancel were held by `admin` alone):
//                 inventoryTransferOperator  + inventory.transfer.dispatch, + inventory.transfer.cancel   (create already held)
//                 inventoryTransferReceiver  + inventory.transfer.receive
//               Not broadened beyond those designed responsibilities; no new Role.
//   PERSONAS    the SMALLEST existing Role per employee function (Role ASSIGNMENTS through Administration):
//                 Warehouse Associate  -> inventoryStockRelocationOperator (relocation / put-away: inventory.stock.relocate;
//                                         the placement record is the inventoryPutAwayOperator it already holds)
//                                      -> inventoryTransferOperator (transfer create / dispatch / cancel -- operational execution)
//                 Warehouse Manager    -> inventoryTransferReceiver (transfer receipt at the destination -- acceptance /
//                                         oversight; it already reconciles cycle counts)
//               Relocation and Transfer stay separate Roles: both move inventory, they are not the same responsibility.
//   SCOPE       WAREHOUSE taylor-main for the Warehouse Associate and Warehouse Manager Employees, through the existing
//               Employee Operational Scope writer (assignEmployeeOperationalScope). Never inferred from a Job Role; no
//               tenant-wide scope. The Parts Associate keeps its already-proven taylor-main scope.
//
// WHAT IT DELIBERATELY DOES NOT CONTAIN: inventory.location.scopeBinding.manage (DQ-029 HELD -- trucks are a later journey);
// any change to the Operational Configuration Administrator Role; any truck binding.
//
// Not read by any command; nothing changes until the activation window applies it.

export const INVENTORY_WAREHOUSE_RULING = "Controller INVENTORY / WAREHOUSE COMPLETION RULINGS (2026-10-01)";
export const TAYLOR_WAREHOUSE_ID = "taylor-main";

export interface InventoryGrantDecision { readonly roleKey: string; readonly capabilityKey: string; readonly reason: string }

export const INVENTORY_WAREHOUSE_GRANTS: readonly InventoryGrantDecision[] = Object.freeze([
  ...["partsAssociate", "partsManager", "warehouseAssociate", "warehouseManager"].map((roleKey) => ({
    roleKey, capabilityKey: "inventory.serializedAsset.acquire",
    reason: `${INVENTORY_WAREHOUSE_RULING} DQ-036b: serialized units entering EOS outside PO receiving (opening balance / legacy migration / existing company asset)`,
  })),
  { roleKey: "inventoryTransferOperator", capabilityKey: "inventory.transfer.dispatch", reason: `${INVENTORY_WAREHOUSE_RULING}: the designed Transfer operator split -- dispatch` },
  { roleKey: "inventoryTransferOperator", capabilityKey: "inventory.transfer.cancel", reason: `${INVENTORY_WAREHOUSE_RULING}: the designed Transfer operator split -- cancel before dispatch` },
  { roleKey: "inventoryTransferReceiver", capabilityKey: "inventory.transfer.receive", reason: `${INVENTORY_WAREHOUSE_RULING}: the designed Transfer receiver -- receipt at the destination` },
].map((g) => Object.freeze(g)));

/** capability key -> (objectKey, actionKey), as registered in eos_policy.capabilities. */
export const INVENTORY_CAPABILITY_OBJECT_ACTION: Readonly<Record<string, { readonly objectKey: string; readonly actionKey: string }>> = Object.freeze({
  "inventory.serializedAsset.acquire": Object.freeze({ objectKey: "serializedAssets", actionKey: "acquire" }),
  "inventory.transfer.dispatch": Object.freeze({ objectKey: "transferOrder", actionKey: "dispatch" }),
  "inventory.transfer.cancel": Object.freeze({ objectKey: "transferOrder", actionKey: "cancel" }),
  "inventory.transfer.receive": Object.freeze({ objectKey: "transferOrder", actionKey: "receive" }),
});

/** The nonprod synthetic personas (principal ids measured 2026-10-01, census ppAct0) and the Roles each is assigned. */
export const INVENTORY_PERSONA_ROLE_ASSIGNMENTS = Object.freeze([
  Object.freeze({ persona: "warehouseAssociate", principalId: "65a269d9-86f8-4c7a-b974-436dd6779bbf", roleKey: "inventoryStockRelocationOperator",
    reason: `${INVENTORY_WAREHOUSE_RULING}: relocation / put-away authority for the Warehouse Associate (smallest existing Role)` }),
  Object.freeze({ persona: "warehouseAssociate", principalId: "65a269d9-86f8-4c7a-b974-436dd6779bbf", roleKey: "inventoryTransferOperator",
    reason: `${INVENTORY_WAREHOUSE_RULING}: Transfer create / dispatch / cancel for the Warehouse Associate (operational execution)` }),
  Object.freeze({ persona: "warehouseManager", principalId: "00e45827-043a-484f-b150-0d8502e8e39f", roleKey: "inventoryTransferReceiver",
    reason: `${INVENTORY_WAREHOUSE_RULING}: Transfer receipt at the destination for the Warehouse Manager (acceptance / oversight)` }),
]);

/** WAREHOUSE taylor-main, through the Employee Operational Scope writer. */
export const INVENTORY_WAREHOUSE_SCOPES = Object.freeze([
  Object.freeze({ employeeId: "synthetic-np-emp-warehouse-associate", scopeType: "WAREHOUSE", scopeId: TAYLOR_WAREHOUSE_ID,
    reason: `${INVENTORY_WAREHOUSE_RULING}: the Warehouse Associate works the real Taylor warehouse` }),
  Object.freeze({ employeeId: "synthetic-np-emp-warehouse-manager", scopeType: "WAREHOUSE", scopeId: TAYLOR_WAREHOUSE_ID,
    reason: `${INVENTORY_WAREHOUSE_RULING}: the Warehouse Manager oversees the real Taylor warehouse` }),
]);

/** The Administration grant operations, exactly as the activation window issues them. */
export function inventoryWarehouseGrantOperations(): readonly { readonly operation: "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze(INVENTORY_WAREHOUSE_GRANTS.map((g) => Object.freeze({
    operation: "grantObjectActionToRole" as const,
    input: Object.freeze({ roleKey: g.roleKey, ...INVENTORY_CAPABILITY_OBJECT_ACTION[g.capabilityKey], reason: g.reason }),
  })));
}
