"use strict";
// THE PARTS / PURCHASING / RECEIVING ADMINISTRATION DELTA -- the Controller-ruled authority this package needs, stated as
// DATA so the nonprod activation window issues a reviewed list through Administration, never an improvised grant and never a
// migration grant (Controller PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01).
//
//   DQ-A        Parts Associate -> reorder.request.create.manual. Request INITIATION, not approval: the Parts Associate gains
//               no approve / reject / cancel / assign; the Parts Manager keeps the management authority it already holds.
//   SUPPLIERS   supplier.record.read (registered by migration 1764380000000) to the Roles that work purchasing -- the Parts
//               Manager, Parts Associate and Purchasing Manager, who record the PO against a Supplier -- plus dispatcher,
//               who held the Firestore supplier read (`isAdminOrDispatcher()`) it replaces (parity). The `admin` Role also
//               held it, but Administration refuses a grant to a Role the granting principal holds (SELF_ADMINISTRATION,
//               DQ-033), so an admin grant cannot be issued through Administration by the administrator: RECORDED, not
//               worked around.
//   DQ-E        warehouse.record.manage (configuration) to the narrow Operational Configuration Administrator Role (DQ-033),
//               never to an operational Parts / Warehouse Role and never implied by WAREHOUSE scope.
//
// WHAT IT DELIBERATELY DOES NOT CONTAIN: DQ-036b `inventory.serializedAsset.acquire` (HELD by DQ-F until the acquire writer
// activates); any WAREHOUSE operational-scope assignment (an Employee scope through the Workforce writer,
// assignEmployeeOperationalScope, issued in the activation window against the REAL warehouse master once it exists -- never
// the synthetic acceptance warehouse as the permanent answer); any Ventana binding.
//
// Not read by any command; nothing changes until Administration applies it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPABILITY_OBJECT_ACTION = exports.PARTS_PURCHASING_RECEIVING_GRANTS = exports.PARTS_PURCHASING_RECEIVING_RULING = void 0;
exports.partsPurchasingReceivingOperations = partsPurchasingReceivingOperations;
exports.PARTS_PURCHASING_RECEIVING_RULING = "Controller PARTS / PURCHASING / RECEIVING RULINGS (2026-10-01)";
exports.PARTS_PURCHASING_RECEIVING_GRANTS = Object.freeze([
    { roleKey: "partsAssociate", capabilityKey: "reorder.request.create.manual", reason: `${exports.PARTS_PURCHASING_RECEIVING_RULING} DQ-A: the Parts Associate raises a manual Reorder Request (initiation, not approval)` },
    { roleKey: "partsManager", capabilityKey: "supplier.record.read", reason: `${exports.PARTS_PURCHASING_RECEIVING_RULING}: the Parts Manager reads the Supplier master it purchases against` },
    { roleKey: "partsAssociate", capabilityKey: "supplier.record.read", reason: `${exports.PARTS_PURCHASING_RECEIVING_RULING}: the Parts Associate records the PO against a governed Supplier` },
    { roleKey: "purchasingManager", capabilityKey: "supplier.record.read", reason: `${exports.PARTS_PURCHASING_RECEIVING_RULING}: purchasing management reads the Supplier master` },
    { roleKey: "dispatcher", capabilityKey: "supplier.record.read", reason: `${exports.PARTS_PURCHASING_RECEIVING_RULING}: parity with the retired Firestore supplier read (dispatcher)` },
    { roleKey: "operationalConfigurationAdministrator", capabilityKey: "warehouse.record.manage", reason: `${exports.PARTS_PURCHASING_RECEIVING_RULING} DQ-E: Warehouse and Bin master administration is configuration authority (DQ-033 Role)` },
].map((g) => Object.freeze(g)));
/** capability key -> (objectKey, actionKey), as registered in eos_policy.capabilities. */
exports.CAPABILITY_OBJECT_ACTION = Object.freeze({
    "reorder.request.create.manual": Object.freeze({ objectKey: "reorderRequest", actionKey: "createManual" }),
    "supplier.record.read": Object.freeze({ objectKey: "supplier", actionKey: "read" }),
    "warehouse.record.manage": Object.freeze({ objectKey: "warehouse", actionKey: "manage" }),
});
/** The Administration operations, exactly as a nonprod execution window issues them. */
function partsPurchasingReceivingOperations() {
    return Object.freeze(exports.PARTS_PURCHASING_RECEIVING_GRANTS.map((g) => Object.freeze({
        operation: "grantObjectActionToRole",
        input: Object.freeze({ roleKey: g.roleKey, ...exports.CAPABILITY_OBJECT_ACTION[g.capabilityKey], reason: g.reason }),
    })));
}
//# sourceMappingURL=partsPurchasingReceivingDelta.js.map