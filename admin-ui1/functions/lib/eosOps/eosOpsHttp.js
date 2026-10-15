"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOperationsOperation = exports.OPERATIONS_ROUTES = exports.EQUIPMENT_ROUTE = exports.WORK_ORDER_ROUTE = exports.isSerializedAssetOperation = exports.SERIALIZED_ASSET_OPERATIONS = exports.SERIALIZED_ASSET_ROUTE = exports.isPlacementOperation = exports.PLACEMENT_OPERATIONS = exports.PLACEMENT_ROUTE = exports.isTransferOperation = exports.TRANSFER_OPERATIONS = exports.TRANSFER_ROUTE = exports.isRelocationOperation = exports.RELOCATION_OPERATIONS = exports.RELOCATION_ROUTE = exports.isCycleCountOperation = exports.CYCLE_COUNT_OPERATIONS = exports.CYCLE_COUNT_ROUTE = exports.OPERATIONS_ROUTE_BY_OPERATION = exports.OPERATIONS_MUTATION_OPERATIONS = exports.OPERATIONS_READ_OPERATIONS = void 0;
exports.executeOperation = executeOperation;
exports.executeCycleCountOperation = executeCycleCountOperation;
exports.executeInventoryCommandOperation = executeInventoryCommandOperation;
exports.executeWorkOrderOperation = executeWorkOrderOperation;
exports.handleOperationsRequest = handleOperationsRequest;
exports.createOperationsHttpHandler = createOperationsHttpHandler;
// The HTTP transport for the trusted Operations API — domain-separated from Administration.
//
// ════════════════════ WHY A SEPARATE TRANSPORT, NOT A THIRD adminPolicy OPERATION ════════════════════
//
// `adminPolicyApi.ts`'s closed operation lists (`ADMIN_READ_OPERATIONS` / `ADMIN_MUTATION_OPERATIONS`)
// are the Administration domain's list -- Objects, Fields, Roles, permissions, Workflows. An
// operational command like "resolve my Cycle Count capabilities" is not an Administration act, and
// putting it on that list would blur the one property that makes the closed list meaningful: that
// every entry on it names a governed Administration operation. A SECOND closed list, for a SECOND
// domain, keeps both lists meaning exactly what they say.
//
// ════════════════════ THE SHAPE IS DELIBERATELY IDENTICAL TO adminPolicyHttp.ts ════════════════════
//
// Same rule: this file is a TRANSPORT. It verifies identity, resolves the operational context, hands
// one named operation to `executeOperation`, and writes the result. No SQL, no policy decision that
// belongs to a command, and it must not grow either.
//
// There is deliberately no `POST /sql`, no `mutate(table, id, patch)`, no Firestore proxy, and no
// route that takes a table name.
const requestText_1 = require("../adminPolicy/requestText");
const capabilityAuthority_1 = require("./capabilityAuthority");
const cycleCountOperations_1 = require("./cycleCountOperations");
const cycleCountWriterState_1 = require("../cycleCount/cycleCountWriterState");
const stockRelocationOperations_1 = require("./stockRelocationOperations");
const stockRelocationWriterState_1 = require("../inventoryLocation/stockRelocationWriterState");
const transferOperations_1 = require("./transferOperations");
const transferWriterState_1 = require("../inventoryTransfer/transferWriterState");
const binPlacementOperations_1 = require("./binPlacementOperations");
const placementWriterState_1 = require("../inventoryLocation/placementWriterState");
const serializedAssetAcquireOperations_1 = require("./serializedAssetAcquireOperations");
const acquireWriterState_1 = require("../serializedAsset/acquireWriterState");
const entitledActionAuthority_1 = require("./entitledActionAuthority");
const experienceAuthority_1 = require("./experienceAuthority");
const reorderLifecycleCommands_js_1 = require("./reorderLifecycleCommands.js");
const reorderAssignmentAuthority_js_1 = require("./reorderAssignmentAuthority.js");
const partsReads_js_1 = require("./partsReads.js");
const receiveReorderStockCommand_js_1 = require("./receiveReorderStockCommand.js");
const receiptCorrectionCommand_js_1 = require("./receiptCorrectionCommand.js");
const supplierAdministration_js_1 = require("./supplierAdministration.js");
const principalContext_1 = require("../adminPolicy/principalContext");
const workOrderOperations_1 = require("./workOrderOperations");
const inboundWorkOperations_1 = require("./inboundWorkOperations");
const equipmentOperations_1 = require("./equipmentOperations");
const financeOperations_1 = require("../eosFinance/financeOperations");
const rentalOperations_1 = require("../eosRental/rentalOperations");
const analysisOperations_1 = require("../eosAnalysis/analysisOperations");
const workspaceOperations_1 = require("../eosExperience/workspaceOperations");
const workflowRuntimeOperations_1 = require("./workflowRuntimeOperations");
const workOrderWriterState_1 = require("./workOrderWriterState");
const contextualAuthorization_1 = require("./contextualAuthorization");
// ════════════════════ the closed operation list ════════════════════
//
// ONE operation in this P0: a bounded, non-mutating capability read. It proves the full path --
// HTTP -> identity verification -> EOS principal/tenant resolution -> Postgres capability
// authorization -- without wiring a mutating Cycle Count command end to end, which the Owner ruling
// explicitly does not require of this PR.
//
// A SECOND, still non-mutating read joins it: `resolveMyExperienceContext`, the canonical principal
// context the client navigates by (experienceAuthority.ts). It is served on its OWN route rather
// than added to /operations/inventory, because that path names the inventory domain and navigation
// is not an inventory act -- the same reason this transport exists separately from /admin/policy.
// One transport, one verifier, two honestly-named routes.
exports.OPERATIONS_READ_OPERATIONS = Object.freeze([
    "resolveMyCapabilities",
    "resolveMyExperienceContext",
    // THE REORDER READS. `readMyAssignedReorders` is the seam this cutover closes: the legacy client
    // asked Firestore `where(assignedToUserId == user.uid)`, and this asks the governed Employee
    // assignment instead. Reading the queue is a different question from reading your own work, so
    // they are different capabilities and different operations.
    "readReorderQueue",
    "readMyAssignedReorders",
    "readReorderRequest",
    "readMyReorderHistory",
    "listReorderWarehouseOptions",
    // The Reorder Purchase Order and its void record, by the Reorder Request ids a screen already holds.
    // Same reach as readReorderRequest, applied to every id. It replaces the browser's Firestore reads of
    // reorder_purchase_orders / reorder_purchase_order_voids, which stop being current at activation.
    "readReorderPurchaseOrders",
    // PARTS / PURCHASING / RECEIVING (Controller 2026-10-01): the PostgreSQL reads that replace the journey's Firebase reads
    // -- on-hand derived from the movement ledger, receipts, the governed receiving destinations, the Supplier master and
    // the Reorder assignment targets (eosOps/partsReads.ts, reorderAssignmentAuthority.ts).
    "readInventoryOnHand",
    "readInventoryMovements",
    "listReceipts",
    "readReceipt",
    "listReceivingLocationOptions",
    "listSuppliers",
    // DECISIONS #193: the governed supplier SELECTION for a new PO -- ACTIVE suppliers + the OTHER operating companies, by name.
    "listPurchaseOrderSupplierOptions",
    // DECISIONS #196: the CRM vendor organizations a new supplier relationship may be created for, by name.
    "listSupplierOrganizationOptions",
    "listInventoryWarehouses",
    "listInventoryLocations",
    "listTransferOrders",
    "listReorderAssignmentTargets",
    // TRUCK INVENTORY (Controller OD-T3 / OD-T7, 2026-10-01): the operational truck roster and one truck's stock.
    "listTruckRoster",
    "readTruckStock",
]);
/**
 * THE REORDER LIFECYCLE, as a closed list.
 *
 * Composing a route does not activate anything: each command refuses unless the caller holds the
 * capability the Role catalog already governs, and the three assignee-scoped commands refuse again
 * unless the caller resolves to the assigned Employee.
 */
exports.OPERATIONS_MUTATION_OPERATIONS = Object.freeze([
    "createReorderRequest",
    "reviewReorderRequest",
    "assignReorderRequest",
    "startPurchasingOnReorder",
    "postPurchasingUpdate",
    "markReorderReceived",
    "cancelReorderRequest",
    "recordReorderPurchaseOrder",
    "voidReorderPurchaseOrder",
    // RECEIVING, dispatched EXPLICITLY BY SOURCE TYPE (Owner Ruling R1). This operation owns
    // REORDER_PURCHASE_ORDER receipts and refuses every other source type outright. The canonical
    // PURCHASE_ORDER continues to be received by its existing authority until its own cutover, and
    // neither path ever falls back to the other: a receipt lands against the authority the caller
    // named, or it is refused.
    "receiveReorderStock",
    // RECEIPT CORRECTION (DECISIONS #193): "we recorded the receipt wrong" -- VOID or CORRECTED, never a vendor return.
    // inventory.receipt.correct + WAREHOUSE scope; compensating movements, the Finance reversal and the replacement receipt
    // commit with it.
    "correctReorderReceipt",
    // GOVERNED SUPPLIER ADMINISTRATION (DECISIONS #196): the one writer of eos_ops.suppliers -- inventory.catalog.manage for
    // create / update, inventory.catalog.activate for activate / deactivate (DECISIONS #78). Never a delete.
    "createSupplier",
    "updateSupplier",
    "setSupplierStatus",
]);
/**
 * Which route serves which operation. A closed map, not a prefix match: asking for the experience
 * context at the inventory path is a 404, so neither route can quietly grow the other's surface. The Reorder
 * reads, commands and Receiving are served on /operations/inventory (the Reorder domain cutover, #1961).
 */
exports.OPERATIONS_ROUTE_BY_OPERATION = Object.freeze({
    resolveMyCapabilities: "/operations/inventory",
    resolveMyExperienceContext: "/operations/experience",
    readReorderQueue: "/operations/inventory",
    readMyAssignedReorders: "/operations/inventory",
    readReorderRequest: "/operations/inventory",
    readMyReorderHistory: "/operations/inventory",
    listReorderWarehouseOptions: "/operations/inventory",
    readReorderPurchaseOrders: "/operations/inventory",
    readInventoryOnHand: "/operations/inventory",
    readInventoryMovements: "/operations/inventory",
    listReceipts: "/operations/inventory",
    readReceipt: "/operations/inventory",
    listReceivingLocationOptions: "/operations/inventory",
    listSuppliers: "/operations/inventory",
    listPurchaseOrderSupplierOptions: "/operations/inventory",
    listInventoryWarehouses: "/operations/inventory",
    listInventoryLocations: "/operations/inventory",
    listTransferOrders: "/operations/inventory",
    listReorderAssignmentTargets: "/operations/inventory",
    listTruckRoster: "/operations/inventory",
    readTruckStock: "/operations/inventory",
    createReorderRequest: "/operations/inventory",
    reviewReorderRequest: "/operations/inventory",
    assignReorderRequest: "/operations/inventory",
    startPurchasingOnReorder: "/operations/inventory",
    postPurchasingUpdate: "/operations/inventory",
    markReorderReceived: "/operations/inventory",
    cancelReorderRequest: "/operations/inventory",
    recordReorderPurchaseOrder: "/operations/inventory",
    voidReorderPurchaseOrder: "/operations/inventory",
    receiveReorderStock: "/operations/inventory",
    correctReorderReceipt: "/operations/inventory",
    listSupplierOrganizationOptions: "/operations/inventory",
    createSupplier: "/operations/inventory",
    updateSupplier: "/operations/inventory",
    setSupplierStatus: "/operations/inventory",
});
// ════════════════════ the Cycle Count command route (Controller rulings DQ-017 / DQ-018) ════════════════════
//
// The FIRST inventory domain on this transport, and the first operations that WRITE. It is a third,
// honestly-named route with its OWN closed operation table (eosOps/cycleCountOperations.ts) rather than
// entries on the read list: a route names a domain, and the read list stays exactly what it says. The
// shape is unchanged -- verify identity, resolve the operational context from PostgreSQL, hand ONE named
// operation its input, write the result. Warehouse scope is enforced INSIDE each operation, per record.
exports.CYCLE_COUNT_ROUTE = "/operations/cycle-count";
exports.CYCLE_COUNT_OPERATIONS = Object.freeze(Object.keys(cycleCountOperations_1.EOS_CYCLE_COUNT_OPERATIONS));
const isCycleCountOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(cycleCountOperations_1.EOS_CYCLE_COUNT_OPERATIONS, name);
exports.isCycleCountOperation = isCycleCountOperation;
// ════════════════════ the Stock Relocation command route (Controller ruling DQ-036) ════════════════════
//
// The EXISTING relocation on EOS, on its OWN honestly-named route with its OWN closed table, exactly as
// Cycle Count: a route names a domain. Built and proven; INACTIVE until the inventory baseline COPY
// (inventoryLocation/stockRelocationWriterState.ts).
exports.RELOCATION_ROUTE = "/operations/relocation";
exports.RELOCATION_OPERATIONS = Object.freeze(Object.keys(stockRelocationOperations_1.EOS_RELOCATION_OPERATIONS));
const isRelocationOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(stockRelocationOperations_1.EOS_RELOCATION_OPERATIONS, name);
exports.isRelocationOperation = isRelocationOperation;
// ════════════════════ the Transfer command route (DQ-024 / DQ-026; ACTIVE since 2026-10-01) ════════════════════
exports.TRANSFER_ROUTE = "/operations/transfer";
exports.TRANSFER_OPERATIONS = Object.freeze(Object.keys(transferOperations_1.EOS_TRANSFER_OPERATIONS));
const isTransferOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(transferOperations_1.EOS_TRANSFER_OPERATIONS, name);
exports.isTransferOperation = isTransferOperation;
// ════════════════════ Bin placement (put-away; DQ-038) and serialized asset acquisition (DQ-036(b)) ════════════════════
exports.PLACEMENT_ROUTE = "/operations/placement";
exports.PLACEMENT_OPERATIONS = Object.freeze(Object.keys(binPlacementOperations_1.EOS_PLACEMENT_OPERATIONS));
const isPlacementOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(binPlacementOperations_1.EOS_PLACEMENT_OPERATIONS, name);
exports.isPlacementOperation = isPlacementOperation;
exports.SERIALIZED_ASSET_ROUTE = "/operations/serialized-asset";
exports.SERIALIZED_ASSET_OPERATIONS = Object.freeze(Object.keys(serializedAssetAcquireOperations_1.EOS_ACQUIRE_OPERATIONS));
const isSerializedAssetOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(serializedAssetAcquireOperations_1.EOS_ACQUIRE_OPERATIONS, name);
exports.isSerializedAssetOperation = isSerializedAssetOperation;
// ════════════════════ the Work Order route (WORK ORDER DOMAIN CUTOVER AUTHORIZATION, 2026-09-30) ════════════════════
//
// The governed PostgreSQL Work Order domain on its OWN route with its OWN closed table (workOrderOperations.ts).
// Fail-closed until WORK_ORDER_WRITER_AUTHORITY.postgres is ACTIVE (DQ-S4); only the readiness probe answers before.
exports.WORK_ORDER_ROUTE = "/operations/work-orders";
// ════════════════════ the Equipment register route (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01) ════════════════════
//
// The PostgreSQL Equipment register on its OWN route with its OWN closed table (equipmentOperations.ts), resolved exactly
// as the Work Order route resolves its caller (the flat set AND the scoped holdings a seller's read is decided by).
exports.EQUIPMENT_ROUTE = "/operations/equipment";
exports.OPERATIONS_ROUTES = Object.freeze([...new Set([...Object.values(exports.OPERATIONS_ROUTE_BY_OPERATION), exports.CYCLE_COUNT_ROUTE, exports.RELOCATION_ROUTE, exports.TRANSFER_ROUTE,
        exports.PLACEMENT_ROUTE, exports.SERIALIZED_ASSET_ROUTE, exports.WORK_ORDER_ROUTE, inboundWorkOperations_1.INBOUND_WORK_ROUTE, exports.EQUIPMENT_ROUTE, financeOperations_1.FINANCE_ROUTE, rentalOperations_1.RENTAL_ROUTE, analysisOperations_1.ANALYSIS_ROUTE, workspaceOperations_1.WORKSPACE_ROUTE, workflowRuntimeOperations_1.WORKFLOW_RUNTIME_ROUTE])].sort());
const READS = new Set(exports.OPERATIONS_READ_OPERATIONS);
const MUTATIONS = new Set(exports.OPERATIONS_MUTATION_OPERATIONS);
const isOperationsOperation = (name) => typeof name === "string" && (READS.has(name) || MUTATIONS.has(name));
exports.isOperationsOperation = isOperationsOperation;
/** Every operation of the PostgreSQL Reorder authority: all but the two principal-context resolvers. */
const REORDER_AUTHORITY_OPERATIONS = new Set([
    "readReorderQueue", "readMyAssignedReorders", "readReorderRequest", "readMyReorderHistory", "listReorderWarehouseOptions",
    "readReorderPurchaseOrders",
    "createReorderRequest", "reviewReorderRequest", "assignReorderRequest", "startPurchasingOnReorder", "postPurchasingUpdate",
    "markReorderReceived", "cancelReorderRequest", "recordReorderPurchaseOrder", "voidReorderPurchaseOrder", "receiveReorderStock",
    "correctReorderReceipt", "createSupplier", "updateSupplier", "setSupplierStatus", "listSupplierOrganizationOptions",
    // The Parts / Purchasing / Receiving reads (2026-10-01) sit behind the same activation boundary.
    "readInventoryOnHand", "readInventoryMovements", "listReceipts", "readReceipt", "listReceivingLocationOptions",
    "listSuppliers", "listPurchaseOrderSupplierOptions", "listReorderAssignmentTargets", "listInventoryWarehouses", "listInventoryLocations", "listTransferOrders",
    "listTruckRoster", "readTruckStock",
]);
/**
 * Execute one named operational read.
 *
 * `resolveMyCapabilities` never throws for "authenticated but holds nothing" -- it returns an empty
 * list, which is the honest answer for a caller with no qualifying Role. It DOES fail closed for an
 * unknown principal, a disabled principal, no tenant membership, or an ambiguous tenant, by letting
 * `PrincipalContextError` surface as FORBIDDEN.
 */
async function executeOperation(deps, request) {
    // THE ACTIVATION BOUNDARY, before any identity work: until the PostgreSQL Reorder authority is activated, none of its
    // operations answers. The capability and experience resolvers are not Reorder operations and are unaffected.
    if (REORDER_AUTHORITY_OPERATIONS.has(request.operation) && !(deps.reorderPostgresActive ?? reorderLifecycleCommands_js_1.REORDER_POSTGRES_ACTIVE)) {
        return { ok: false, operation: request.operation, code: "PRECONDITION_FAILED",
            message: "the PostgreSQL Reorder authority is not active yet; the Reorder cutover has not activated it" };
    }
    try {
        // ONE resolution for every Reorder operation: the caller's EOS Principal, tenant and the
        // capabilities the Role catalog grants them. `principalContext.uid` IS the EOS principal id --
        // every downstream record identifies the actor by it, and no Firebase uid reaches these commands.
        const reorderActor = async () => {
            const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
                identityProvider: request.caller.identityProvider,
                externalSubject: request.caller.externalSubject,
                requestedTenantId: request.caller.requestedTenantId,
            });
            return {
                pool: deps.pool,
                actor: {
                    tenantId: ctx.principalContext.tenantId,
                    principalId: ctx.principalContext.uid,
                    capabilities: new Set(ctx.capabilities),
                },
            };
        };
        const ok = (result) => ({ ok: true, operation: request.operation, result });
        switch (request.operation) {
            case "resolveMyCapabilities": {
                // Conditions from PostgreSQL -- the source Administration writes. Lazy: this read never asks
                // for entitlements, so composing the provider costs no query.
                const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
                    identityProvider: request.caller.identityProvider,
                    externalSubject: request.caller.externalSubject,
                    requestedTenantId: request.caller.requestedTenantId,
                }, (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool));
                return {
                    ok: true,
                    operation: "resolveMyCapabilities",
                    result: {
                        tenantId: ctx.principalContext.tenantId,
                        uid: ctx.principalContext.uid,
                        heldRoleKeys: ctx.principalContext.heldRoleKeys,
                        capabilities: [...ctx.capabilities].sort(),
                    },
                };
            }
            case "resolveMyExperienceContext": {
                // Same resolution, same refusals. It returns the caller's OWN context and accepts no
                // selector, so it cannot describe anybody else, and it grants nothing: every surface it
                // names is re-authorized by the read or command behind it.
                const context = await (0, experienceAuthority_1.resolveExperienceContext)(deps.reader, deps.pool, {
                    identityProvider: request.caller.identityProvider,
                    externalSubject: request.caller.externalSubject,
                    requestedTenantId: request.caller.requestedTenantId,
                });
                return { ok: true, operation: "resolveMyExperienceContext", result: context };
            }
            case "readReorderQueue": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.readReorderQueue)({ pool }, actor, request.input ?? {}));
            }
            case "readReorderRequest": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.readReorderRequest)({ pool }, actor, request.input ?? {}));
            }
            case "readReorderPurchaseOrders": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.readReorderPurchaseOrders)({ pool }, actor, request.input ?? {}));
            }
            case "readMyReorderHistory": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.readMyReorderHistory)({ pool }, actor));
            }
            case "listReorderWarehouseOptions": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.listReorderWarehouseOptions)({ pool }, actor));
            }
            case "readMyAssignedReorders": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.readMyAssignedReorders)({ pool }, actor));
            }
            case "readInventoryOnHand": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.readInventoryOnHand)({ pool }, actor, request.input ?? {}));
            }
            case "readInventoryMovements": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.readInventoryMovements)({ pool }, actor, request.input ?? {}));
            }
            case "listReceipts": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listReceipts)({ pool }, actor, request.input ?? {}));
            }
            case "readReceipt": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.readReceipt)({ pool }, actor, request.input ?? {}));
            }
            case "listReceivingLocationOptions": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listReceivingLocationOptions)({ pool }, actor, request.input ?? {}));
            }
            case "listSuppliers": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listSuppliers)({ pool }, actor, request.input ?? {}));
            }
            case "listPurchaseOrderSupplierOptions": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listPurchaseOrderSupplierOptions)({ pool }, actor, request.input ?? {}));
            }
            case "listInventoryWarehouses": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listInventoryWarehouses)({ pool }, actor, request.input ?? {}));
            }
            case "listInventoryLocations": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listInventoryLocations)({ pool }, actor, request.input ?? {}));
            }
            case "listTransferOrders": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listTransferOrders)({ pool }, actor, request.input ?? {}));
            }
            case "listTruckRoster": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.listTruckRoster)({ pool }, actor, request.input ?? {}));
            }
            case "readTruckStock": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, partsReads_js_1.readTruckStock)({ pool }, actor, request.input ?? {}));
            }
            case "listReorderAssignmentTargets": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderAssignmentAuthority_js_1.listReorderAssignmentTargets)({ pool }, actor, request.input ?? {}));
            }
            case "createReorderRequest": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.createGovernedReorderRequest)({ pool }, actor, request.input ?? {}));
            }
            case "reviewReorderRequest": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.reviewReorderRequest)({ pool }, actor, request.input ?? {}));
            }
            case "assignReorderRequest": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderAssignmentAuthority_js_1.assignReorderRequestToEmployee)({ pool }, actor, request.input ?? {}));
            }
            case "startPurchasingOnReorder": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.startPurchasingOnReorder)({ pool }, actor, request.input ?? {}));
            }
            case "postPurchasingUpdate": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.postPurchasingUpdate)({ pool }, actor, request.input ?? {}));
            }
            case "markReorderReceived": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.markReorderReceived)({ pool }, actor, request.input ?? {}));
            }
            case "cancelReorderRequest": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.cancelReorderRequest)({ pool }, actor, request.input ?? {}));
            }
            case "recordReorderPurchaseOrder": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.recordReorderPurchaseOrder)({ pool }, actor, request.input ?? {}));
            }
            case "voidReorderPurchaseOrder": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, reorderLifecycleCommands_js_1.voidReorderPurchaseOrder)({ pool }, actor, request.input ?? {}));
            }
            case "receiveReorderStock": {
                // The SAME resolved Principal context every other operation uses. The receipt's actor is an
                // EOS Principal holding inventory.stock.receive -- never a Firebase uid, and never the
                // Employee the purchasing work happens to be assigned to.
                const { actor, pool } = await reorderActor();
                return ok(await (0, receiveReorderStockCommand_js_1.receiveReorderStock)({ pool }, actor, request.input ?? {}));
            }
            case "listSupplierOrganizationOptions": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, supplierAdministration_js_1.listSupplierOrganizationOptions)({ pool }, actor, request.input ?? {}));
            }
            case "createSupplier": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, supplierAdministration_js_1.createSupplier)({ pool }, actor, request.input ?? {}));
            }
            case "updateSupplier": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, supplierAdministration_js_1.updateSupplier)({ pool }, actor, request.input ?? {}));
            }
            case "setSupplierStatus": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, supplierAdministration_js_1.setSupplierStatus)({ pool }, actor, request.input ?? {}));
            }
            case "correctReorderReceipt": {
                const { actor, pool } = await reorderActor();
                return ok(await (0, receiptCorrectionCommand_js_1.correctReorderReceipt)({ pool }, actor, request.input ?? {}));
            }
            default:
                return { ok: false, operation: request.operation, code: "UNKNOWN_OPERATION", message: "no such Operations operation" };
        }
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError) {
            return { ok: false, operation: request.operation, code: "FORBIDDEN", message: err.refusal };
        }
        // A governed refusal is the ANSWER, not a failure: the caller is told which rule refused them,
        // with the command's own category preserved rather than flattened to 500.
        if (err instanceof reorderLifecycleCommands_js_1.ReorderLifecycleError || err instanceof reorderAssignmentAuthority_js_1.ReorderAssignmentError || err instanceof receiveReorderStockCommand_js_1.ReceiveStockError) {
            const code = err.category === "FAILED" ? "INTERNAL" : err.category;
            const details = err instanceof reorderLifecycleCommands_js_1.ReorderLifecycleError ? err.details : undefined;
            return details === undefined ? { ok: false, operation: request.operation, code, message: err.message }
                : { ok: false, operation: request.operation, code, message: err.message, details };
        }
        // eslint-disable-next-line no-console -- same posture as adminPolicyHttp.ts's unhandled-error log
        console.error("[eosOpsHttp] unhandled", err);
        return { ok: false, operation: request.operation, code: "INTERNAL", message: "the request could not be completed" };
    }
}
const STATUS_BY_CYCLE_COUNT_CATEGORY = Object.freeze({
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    PRECONDITION_FAILED: 412,
    CONFLICT: 409,
    FORBIDDEN: 403,
    NOT_ACTIVATED: 503,
    FAILED: 500,
});
/**
 * Execute one Cycle Count operation for an already-verified caller. An unknown / disabled / non-member
 * Principal is FORBIDDEN (PrincipalContextError); a capability reached only through a CONDITIONED grant
 * is withheld (this kernel cannot evaluate conditions -- fail closed), exactly as the Commercial route does.
 */
async function executeCycleCountOperation(deps, request) {
    const { operation } = request;
    try {
        const postgresState = deps.cycleCountPostgresState ?? cycleCountWriterState_1.CYCLE_COUNT_WRITER_AUTHORITY.postgres;
        const conditions = (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool);
        const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
            identityProvider: request.caller.identityProvider,
            externalSubject: request.caller.externalSubject,
            requestedTenantId: request.caller.requestedTenantId,
        }, conditions);
        const capabilities = await (0, capabilityAuthority_1.capabilitiesWithoutUnevaluatedConditions)(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
        const actor = Object.freeze({ tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities });
        const result = await cycleCountOperations_1.EOS_CYCLE_COUNT_OPERATIONS[operation]({ pool: deps.pool, postgresState }, actor, request.input);
        return { status: 200, body: { ok: true, operation, result } };
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError)
            return { status: 403, body: { ok: false, operation, code: "FORBIDDEN", message: err.refusal } };
        if (err instanceof cycleCountOperations_1.CycleCountOperationError) {
            return { status: STATUS_BY_CYCLE_COUNT_CATEGORY[err.category] ?? 500, body: { ok: false, operation, code: err.code, message: err.message } };
        }
        // eslint-disable-next-line no-console -- same posture as the read path's unhandled-error log
        console.error("[eosOpsHttp] cycle count unhandled", err);
        return { status: 500, body: { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" } };
    }
}
/**
 * Execute one Stock Relocation or Transfer operation for an already-verified caller -- the Cycle Count shape
 * exactly: operational context from PostgreSQL, conditioned grants withheld, the domain's own activation constant.
 */
async function executeInventoryCommandOperation(deps, route, request) {
    const { operation } = request;
    try {
        const conditions = (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool);
        const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
            identityProvider: request.caller.identityProvider,
            externalSubject: request.caller.externalSubject,
            requestedTenantId: request.caller.requestedTenantId,
        }, conditions);
        const capabilities = await (0, capabilityAuthority_1.capabilitiesWithoutUnevaluatedConditions)(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
        const actor = Object.freeze({ tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities });
        const result = route === "relocation"
            ? await stockRelocationOperations_1.EOS_RELOCATION_OPERATIONS[operation]({ pool: deps.pool, postgresState: deps.relocationPostgresState ?? stockRelocationWriterState_1.RELOCATION_WRITER_AUTHORITY.postgres }, actor, request.input)
            : route === "transfer"
                ? await transferOperations_1.EOS_TRANSFER_OPERATIONS[operation]({ pool: deps.pool, postgresState: deps.transferPostgresState ?? transferWriterState_1.TRANSFER_WRITER_AUTHORITY.postgres }, actor, request.input)
                : route === "placement"
                    ? await binPlacementOperations_1.EOS_PLACEMENT_OPERATIONS[operation]({ pool: deps.pool, postgresState: deps.placementPostgresState ?? placementWriterState_1.PLACEMENT_WRITER_AUTHORITY.postgres }, actor, request.input)
                    : await serializedAssetAcquireOperations_1.EOS_ACQUIRE_OPERATIONS[operation]({ pool: deps.pool, postgresState: deps.acquirePostgresState ?? acquireWriterState_1.ACQUIRE_WRITER_AUTHORITY.postgres }, actor, request.input);
        return { status: 200, body: { ok: true, operation, result } };
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError)
            return { status: 403, body: { ok: false, operation, code: "FORBIDDEN", message: err.refusal } };
        if (err instanceof stockRelocationOperations_1.RelocationOperationError || err instanceof transferOperations_1.TransferOperationError
            || err instanceof binPlacementOperations_1.PlacementOperationError || err instanceof serializedAssetAcquireOperations_1.AcquireOperationError) {
            return { status: STATUS_BY_CYCLE_COUNT_CATEGORY[err.category] ?? 500, body: { ok: false, operation, code: err.code, message: err.message } };
        }
        // eslint-disable-next-line no-console -- same posture as the read path's unhandled-error log
        console.error(`[eosOpsHttp] ${route} unhandled`, err);
        return { status: 500, body: { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" } };
    }
}
const STATUS_BY_WORK_ORDER_CATEGORY = Object.freeze({
    INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403,
    UNAVAILABLE: 503, NOT_ACTIVATED: 503, FAILED: 500,
});
/** Every governed Work Order refusal class carries { code, category }; each is answered with its own category. */
const WORK_ORDER_ERROR_NAMES = new Set([
    "WorkOrderLifecycleError", "WorkOrderAssignmentError", "WorkOrderCreateError", "WorkOrderPartsPlanError", "WorkOrderReadError",
    "WorkOrderEquipmentInstallError", "EquipmentOperationError",
    // Finance Closure (#206): the /operations/finance table's governed refusal classes.
    "FinanceOperationError", "FinanceFoundationError", "CostEvidenceSupplyError", "IntercompanyReliefError",
    // Rental (#207): the /operations/rental table's governed refusal class.
    "RentalError",
    // Analysis (#208): the read-only /operations/analysis table's governed refusal class.
    "AnalysisError",
    // Application Assembly (#209): the read-only /operations/workspace table's governed refusal class.
    "MyWorkError",
    "WorkflowRuntimeError",
]);
/**
 * Execute one Work Order operation for an already-verified caller. The caller is resolved ONCE, into both the flat
 * capability set (conditioned keys withheld) and the entitled actor the per-record read decision needs.
 */
async function executeWorkOrderOperation(deps, request, 
/** The closed table this route serves: the Work Order table, or the Inbound Work table on its own route. */
table = workOrderOperations_1.EOS_WORK_ORDER_OPERATIONS) {
    const { operation } = request;
    const postgresState = deps.workOrderPostgresState ?? workOrderWriterState_1.WORK_ORDER_WRITER_AUTHORITY.postgres;
    if (operation === "readWorkOrderAuthorityStatus") {
        return { status: 200, body: { ok: true, operation, result: { postgres: postgresState,
                    readiness: postgresState === "ACTIVE" ? "ACTIVE" : "NOT_YET_ACTIVATED" } } };
    }
    if (postgresState !== "ACTIVE") {
        return { status: 503, body: { ok: false, operation, code: "NOT_ACTIVATED",
                message: "the PostgreSQL Work Order authority is not activated yet" } };
    }
    try {
        const conditions = (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool);
        const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
            identityProvider: request.caller.identityProvider,
            externalSubject: request.caller.externalSubject,
            requestedTenantId: request.caller.requestedTenantId,
        }, conditions);
        const capabilities = await (0, capabilityAuthority_1.capabilitiesWithoutUnevaluatedConditions)(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
        const tenantId = ctx.principalContext.tenantId;
        const principalId = ctx.principalContext.uid;
        const caller = Object.freeze({
            actor: Object.freeze({ tenantId, principalId, capabilities }),
            operational: Object.freeze({ tenantId, principalId, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
                scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements }),
        });
        const result = await table[operation]({ pool: deps.pool, reader: (0, contextualAuthorization_1.postgresContextualReader)(deps.pool), postgresState, policyReader: deps.reader,
            equipmentPostgresState: deps.equipmentPostgresState }, caller, request.input);
        return { status: 200, body: { ok: true, operation, result } };
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError)
            return { status: 403, body: { ok: false, operation, code: "FORBIDDEN", message: err.refusal } };
        if (err instanceof Error && WORK_ORDER_ERROR_NAMES.has(err.name)) {
            const e = err;
            return { status: STATUS_BY_WORK_ORDER_CATEGORY[e.category] ?? 500, body: { ok: false, operation, code: e.code, message: e.message } };
        }
        // eslint-disable-next-line no-console -- same posture as the read path's unhandled-error log
        console.error("[eosOpsHttp] work order unhandled", err);
        return { status: 500, body: { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" } };
    }
}
const STATUS_BY_CODE = Object.freeze({
    UNKNOWN_OPERATION: 404,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    // 412, as on the Commercial, CRM, Workforce and Catalog transports -- and as the Reorder client maps it. 409 made a
    // governed precondition (e.g. "the PostgreSQL Reorder authority is not active") indistinguishable from CONFLICT, and
    // the client rendered it as one (L5, contract-mismatch auto-fix, 2026-09-28).
    PRECONDITION_FAILED: 412,
    CONFLICT: 409,
    INTERNAL: 500,
});
function baseHeaders(origin) {
    return {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    };
}
const json = (status, body, origin) => ({
    status, headers: baseHeaders(origin), body: JSON.stringify(body),
});
/**
 * Handle one request.
 *
 *   POST /operations/inventory    resolveMyCapabilities. Authenticated.
 *   POST /operations/experience   resolveMyExperienceContext. Authenticated.
 *   OPTIONS *                     CORS preflight.
 *
 * The operation must match the route it was posted to (OPERATIONS_ROUTE_BY_OPERATION); a mismatch is
 * a 404, not a redirect, so a route never answers for a neighbour.
 *
 * There is no `/health` here -- `/health` is process-wide and already served by adminPolicyHttp's
 * handler in server.ts; this transport answers only its own routes.
 */
async function handleOperationsRequest(options, request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = pathOf(request.url ?? "/");
    const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));
    if (method === "OPTIONS") {
        return {
            status: 204,
            headers: {
                ...baseHeaders(origin),
                "access-control-allow-methods": "POST, OPTIONS",
                "access-control-allow-headers": "authorization, content-type, x-eos-tenant",
                "access-control-max-age": "600",
            },
            body: "",
        };
    }
    if (!exports.OPERATIONS_ROUTES.includes(path))
        return json(404, notFound(path), origin);
    if (method !== "POST")
        return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);
    let payload;
    try {
        payload = parseBody(request.body);
    }
    catch {
        return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
    }
    // U+0000 is refused at the envelope, before identity or any query (requestText.ts; Controller XLF-002).
    if ((0, requestText_1.containsNulCharacter)(payload)) {
        return json(400, { ok: false, operation: typeof payload.operation === "string" ? payload.operation : "", code: "INVALID_INPUT", message: requestText_1.NUL_CHARACTER_REFUSAL }, origin);
    }
    const operation = payload.operation;
    if (path === exports.CYCLE_COUNT_ROUTE) {
        if (!(0, exports.isCycleCountOperation)(operation))
            return json(404, notFound(String(operation ?? "")), origin);
        const input = payload.input === undefined ? {} : payload.input;
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            return json(400, { ok: false, operation, code: "INVALID_INPUT", message: "input must be a JSON object" }, origin);
        }
        const ccBearer = bearerToken(header(request, "authorization"));
        if (!ccBearer)
            return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
        let ccIdentity;
        try {
            ccIdentity = await options.verifyToken(ccBearer);
        }
        catch {
            return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
        }
        const out = await executeCycleCountOperation(options, {
            caller: {
                externalSubject: ccIdentity.externalSubject,
                identityProvider: ccIdentity.identityProvider,
                requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
            },
            operation,
            input: input,
        });
        return json(out.status, out.body, origin);
    }
    if (path === exports.WORK_ORDER_ROUTE || path === inboundWorkOperations_1.INBOUND_WORK_ROUTE || path === exports.EQUIPMENT_ROUTE || path === financeOperations_1.FINANCE_ROUTE || path === rentalOperations_1.RENTAL_ROUTE || path === analysisOperations_1.ANALYSIS_ROUTE || path === workspaceOperations_1.WORKSPACE_ROUTE || path === workflowRuntimeOperations_1.WORKFLOW_RUNTIME_ROUTE) {
        const inbound = path === inboundWorkOperations_1.INBOUND_WORK_ROUTE;
        const equipment = path === exports.EQUIPMENT_ROUTE;
        const finance = path === financeOperations_1.FINANCE_ROUTE;
        const rental = path === rentalOperations_1.RENTAL_ROUTE;
        const analysis = path === analysisOperations_1.ANALYSIS_ROUTE;
        const workspace = path === workspaceOperations_1.WORKSPACE_ROUTE;
        const workflowRuntime = path === workflowRuntimeOperations_1.WORKFLOW_RUNTIME_ROUTE;
        if (workflowRuntime ? !(0, workflowRuntimeOperations_1.isWorkflowRuntimeOperation)(operation) : workspace ? !(0, workspaceOperations_1.isWorkspaceOperation)(operation) : analysis ? !(0, analysisOperations_1.isAnalysisOperation)(operation) : rental ? !(0, rentalOperations_1.isRentalOperation)(operation) : finance ? !(0, financeOperations_1.isFinanceOperation)(operation) : equipment ? !(0, equipmentOperations_1.isEquipmentOperation)(operation) : inbound ? !(0, inboundWorkOperations_1.isInboundWorkOperation)(operation) : !(0, workOrderOperations_1.isWorkOrderOperation)(operation)) {
            return json(404, notFound(String(operation ?? "")), origin);
        }
        const input = payload.input === undefined ? {} : payload.input;
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            return json(400, { ok: false, operation, code: "INVALID_INPUT", message: "input must be a JSON object" }, origin);
        }
        const woBearer = bearerToken(header(request, "authorization"));
        if (!woBearer)
            return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
        let woIdentity;
        try {
            woIdentity = await options.verifyToken(woBearer);
        }
        catch {
            return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
        }
        const out = await executeWorkOrderOperation(options, {
            caller: {
                externalSubject: woIdentity.externalSubject,
                identityProvider: woIdentity.identityProvider,
                requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
            },
            operation: operation,
            input: input,
        }, workflowRuntime ? workflowRuntimeOperations_1.EOS_WORKFLOW_RUNTIME_OPERATIONS
            : workspace ? workspaceOperations_1.EOS_WORKSPACE_OPERATIONS
                : analysis ? analysisOperations_1.EOS_ANALYSIS_OPERATIONS
                    : rental ? rentalOperations_1.EOS_RENTAL_OPERATIONS
                        : finance ? financeOperations_1.EOS_FINANCE_OPERATIONS
                            : equipment ? equipmentOperations_1.EOS_EQUIPMENT_OPERATIONS
                                : inbound ? inboundWorkOperations_1.EOS_INBOUND_WORK_OPERATIONS : workOrderOperations_1.EOS_WORK_ORDER_OPERATIONS);
        return json(out.status, out.body, origin);
    }
    if (path === exports.RELOCATION_ROUTE || path === exports.TRANSFER_ROUTE || path === exports.PLACEMENT_ROUTE || path === exports.SERIALIZED_ASSET_ROUTE) {
        const route = path === exports.RELOCATION_ROUTE ? "relocation" : path === exports.TRANSFER_ROUTE ? "transfer"
            : path === exports.PLACEMENT_ROUTE ? "placement" : "serializedAsset";
        const known = route === "relocation" ? (0, exports.isRelocationOperation)(operation) : route === "transfer" ? (0, exports.isTransferOperation)(operation)
            : route === "placement" ? (0, exports.isPlacementOperation)(operation) : (0, exports.isSerializedAssetOperation)(operation);
        if (!known)
            return json(404, notFound(String(operation ?? "")), origin);
        const input = payload.input === undefined ? {} : payload.input;
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            return json(400, { ok: false, operation, code: "INVALID_INPUT", message: "input must be a JSON object" }, origin);
        }
        const cmdBearer = bearerToken(header(request, "authorization"));
        if (!cmdBearer)
            return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
        let cmdIdentity;
        try {
            cmdIdentity = await options.verifyToken(cmdBearer);
        }
        catch {
            return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
        }
        const out = await executeInventoryCommandOperation(options, route, {
            caller: {
                externalSubject: cmdIdentity.externalSubject,
                identityProvider: cmdIdentity.identityProvider,
                requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
            },
            operation: operation,
            input: input,
        });
        return json(out.status, out.body, origin);
    }
    if (!(0, exports.isOperationsOperation)(operation))
        return json(404, notFound(String(operation ?? "")), origin);
    // The operation must belong to the route it arrived on. Without this, /operations/inventory would
    // answer for /operations/experience and the route names would stop describing anything.
    if (exports.OPERATIONS_ROUTE_BY_OPERATION[operation] !== path)
        return json(404, notFound(operation), origin);
    const bearer = bearerToken(header(request, "authorization"));
    if (!bearer) {
        return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
    }
    let identity;
    try {
        identity = await options.verifyToken(bearer);
    }
    catch {
        return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
    }
    const result = await executeOperation(options, {
        caller: {
            externalSubject: identity.externalSubject,
            identityProvider: identity.identityProvider,
            requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
        },
        operation,
        input: payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
            ? payload.input
            : {},
    });
    if (result.ok)
        return json(200, result, origin);
    return json(STATUS_BY_CODE[result.code] ?? 500, result, origin);
}
/** Adapt the pure handler onto node:http, matching adminPolicyHttp.ts's own adapter. */
function createOperationsHttpHandler(options) {
    return async function nodeHandler(req, res) {
        const body = await readBody(req);
        let response;
        try {
            response = await handleOperationsRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
        }
        catch (err) {
            console.error("[eosOpsHttp] unhandled", err);
            response = json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
// ════════════════════ small helpers (mirrors adminPolicyHttp.ts) ════════════════════
const MAX_BODY_BYTES = 1_000_000;
function readBody(req) {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error("request body too large"));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
function parseBody(body) {
    if (!body || body.trim().length === 0)
        return {};
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
    return parsed;
}
const header = (req, name) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
const singleHeader = (value) => {
    if (Array.isArray(value))
        return value[0] ?? null;
    return typeof value === "string" && value.length > 0 ? value : null;
};
function bearerToken(value) {
    const raw = singleHeader(value);
    if (!raw)
        return null;
    const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
    return match ? match[1].trim() : null;
}
function pathOf(url) {
    const idx = url.indexOf("?");
    const path = idx >= 0 ? url.slice(0, idx) : url;
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
function resolveOrigin(allowed, value) {
    const origin = singleHeader(value);
    if (!origin || !allowed || allowed.length === 0)
        return null;
    return allowed.includes(origin) ? origin : null;
}
const notFound = (what) => ({ ok: false, operation: what, code: "UNKNOWN_OPERATION", message: "no such Operations operation" });
//# sourceMappingURL=eosOpsHttp.js.map