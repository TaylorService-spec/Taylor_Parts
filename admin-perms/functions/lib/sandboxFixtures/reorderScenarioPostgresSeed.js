"use strict";
// SBX-SCN-001, THE REORDER DOMAIN, IN POSTGRESQL -- the scenario's form after the cutover.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// The Firestore seeder writes `reorder_requests` and `reorder_purchase_orders` directly. After the
// Reorder cutover that is not a fixture any more -- it is a second authority, recreating exactly the
// records the migration just retired, in the store that stopped being authoritative. A sandbox that
// re-seeds itself back into Firestore would undo the cutover every time someone refreshed it.
//
// So the scenario gets a PostgreSQL form, and it is built the only way that is honest: through the
// SAME GOVERNED COMMANDS a person would use. Nothing here inserts a row. `createGovernedReorderRequest`,
// `reviewReorderRequest`, `assignReorderRequestToEmployee`, `startPurchasingOnReorder` and
// `recordReorderPurchaseOrder` each run with their real capability and precondition checks, so a
// scenario that cannot be produced by the governed path cannot be produced at all -- which is
// precisely what makes it worth testing against.
//
// NO BRIDGE. This writes PostgreSQL and nothing else. It never reads Firestore, never writes it, and
// never reconciles the two. A Render -> Firestore bridge would reintroduce the dual authority the
// cutover removes, with the added property of being invisible from the Firestore side.
//
// ════════════════════ THE SCENARIO'S BUSINESS PURPOSE IS PRESERVED ════════════════════
//
//   - a STANDARD-part receiving candidate, ORDERED with a purchase order awaiting receipt
//   - a SERIALIZED-part receiving candidate, so receiving exercises serial capture and custody
//   - lifecycle queue examples: unreviewed, mid-purchasing, and the rejected terminal branch
//   - the chain STOPS at receiving-ready. The receipt is NOT seeded, because the receipt is the
//     governed write the scenario exists to prove. Seeding it would fake the step under test.
//
// IDENTITY IS NOT CARRIED OVER, and that is correct. The Firestore fixtures are named `ro-sbx-001`;
// a governed PostgreSQL create assigns its own id. Forcing the legacy names would mean bypassing the
// command that owns identity -- the one thing this module exists not to do. Callers get the created
// ids back and refer to them by ROLE.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REORDER_SCENARIO_SPECS = exports.REORDER_SCENARIO_ROLES = exports.SCENARIO_ID = void 0;
exports.seedReorderScenarioIntoPostgres = seedReorderScenarioIntoPostgres;
const reorderLifecycleCommands_js_1 = require("../eosOps/reorderLifecycleCommands.js");
const reorderAssignmentAuthority_js_1 = require("../eosOps/reorderAssignmentAuthority.js");
const reorderScenarioFixtures_js_1 = require("./reorderScenarioFixtures.js");
Object.defineProperty(exports, "SCENARIO_ID", { enumerable: true, get: function () { return reorderScenarioFixtures_js_1.SCENARIO_ID; } });
/** What each seeded Reorder is FOR. The scenario is referred to by role, never by a fixture id. */
exports.REORDER_SCENARIO_ROLES = Object.freeze([
    "STANDARD_RECEIVING_CANDIDATE",
    "SERIAL_RECEIVING_CANDIDATE",
    "UNREVIEWED_QUEUE_ITEM",
    "PURCHASING_IN_PROGRESS_ITEM",
    "REJECTED_TERMINAL_ITEM",
]);
/**
 * The scenario, as business intent rather than as rows.
 *
 * The part ids are the SAME ones the Firestore scenario uses, because the Part catalog is a
 * different authority with its own migration -- this module consumes governed Parts, it does not
 * create them. A part that is not in `eos_ops.parts` makes the governed create refuse, which is the
 * correct and useful failure: the Part prerequisite is real and must not be papered over here.
 */
exports.REORDER_SCENARIO_SPECS = Object.freeze([
    Object.freeze({
        role: "STANDARD_RECEIVING_CANDIDATE",
        partId: "PRT-1001", quantity: 4, urgency: "HIGH", advanceTo: "ORDERED",
        reviewNotes: "Shortage confirmed; unit down at Harbor Grill Downtown.",
        purchasingNotes: "Arctic Parts Supply confirmed availability.",
        purchaseOrder: {
            supplierId: "sup-arcticparts", externalPoNumber: "po-sbx-001",
            orderedDate: "2026-09-01", expectedArrivalDate: "2026-09-08",
        },
        purpose: "the STANDARD-part receiving candidate; receiving it posts a quantity movement",
    }),
    Object.freeze({
        role: "SERIAL_RECEIVING_CANDIDATE",
        partId: "PRT-2001", quantity: 2, urgency: "HIGH", advanceTo: "ORDERED",
        reviewNotes: "Two compressor units required for scheduled ice-machine replacements.",
        purchasingNotes: "ColdChain Components confirmed serial-tracked units.",
        purchaseOrder: {
            supplierId: "sup-coldchain", externalPoNumber: "po-sbx-003",
            orderedDate: "2026-09-01", expectedArrivalDate: "2026-09-10",
        },
        purpose: "the SERIALIZED receiving candidate; the quantity binds the serial count a receipt must supply",
    }),
    Object.freeze({
        role: "UNREVIEWED_QUEUE_ITEM",
        partId: "PRT-1003", quantity: 10, urgency: "MEDIUM", advanceTo: "PENDING_REVIEW",
        purpose: "an unreviewed queue item",
    }),
    Object.freeze({
        role: "PURCHASING_IN_PROGRESS_ITEM",
        partId: "PRT-1006", quantity: 8, urgency: "LOW", advanceTo: "PURCHASING_IN_PROGRESS",
        reviewNotes: "Approved for purchasing.",
        purchasingNotes: "Awaiting vendor quote.",
        purpose: "a mid-flight purchasing item",
    }),
    Object.freeze({
        role: "REJECTED_TERMINAL_ITEM",
        partId: "PRT-1002", quantity: 2, urgency: "LOW", advanceTo: "REJECTED",
        reviewNotes: "Sufficient stock already on hand.",
        purpose: "the alternate terminal branch",
    }),
]);
/**
 * Seed the Reorder portion of SBX-SCN-001 into PostgreSQL, through the governed commands.
 *
 * Governed creates assign their own ids. Each create carries a deterministic idempotency key (scenario, role, warehouse),
 * so a rerun by the same requester REPLAYS the existing requests rather than seeding the scenario twice -- and then fails
 * closed at the first advance step whose state has already moved. The caller still decides whether the scenario is
 * already present; inventing a "find the one that looks like this" rule here would be a second identity authority.
 */
async function seedReorderScenarioIntoPostgres(deps, actors, warehouseId) {
    const seeded = [];
    for (const spec of exports.REORDER_SCENARIO_SPECS) {
        const created = await (0, reorderLifecycleCommands_js_1.createGovernedReorderRequest)(deps, actors.requester, {
            partId: spec.partId,
            warehouseId,
            requestedQuantity: spec.quantity,
            recommendedQuantity: spec.quantity,
            recommendationStatus: "RECOMMENDED",
            quantitySource: "RECOMMENDED",
            urgency: spec.urgency,
            manual: true,
            // G2 (2026-10-01): deterministic per scenario role + warehouse, so a retried seed replays its own create instead
            // of raising a second request (which DQ-B would refuse anyway as duplicate open demand).
            idempotencyKey: `${reorderScenarioFixtures_js_1.SCENARIO_ID}:${spec.role}:${warehouseId}`,
        });
        const id = created.reorderRequestId;
        let status = "PENDING_REVIEW";
        let purchaseOrderId = null;
        if (spec.advanceTo === "REJECTED") {
            ({ status } = await (0, reorderLifecycleCommands_js_1.reviewReorderRequest)(deps, actors.requester, {
                reorderRequestId: id, decision: "REJECTED", reviewNotes: spec.reviewNotes,
            }));
        }
        else if (spec.advanceTo !== "PENDING_REVIEW") {
            ({ status } = await (0, reorderLifecycleCommands_js_1.reviewReorderRequest)(deps, actors.requester, {
                reorderRequestId: id, decision: "APPROVED", reviewNotes: spec.reviewNotes,
            }));
            await (0, reorderAssignmentAuthority_js_1.assignReorderRequestToEmployee)(deps, actors.partsManager, {
                reorderRequestId: id,
                employeeId: actors.purchasingEmployeeId,
                reason: `${reorderScenarioFixtures_js_1.SCENARIO_ID} scenario setup`,
            });
            ({ status } = await (0, reorderLifecycleCommands_js_1.startPurchasingOnReorder)(deps, actors.partsAssociate, {
                reorderRequestId: id, purchasingNotes: spec.purchasingNotes,
            }));
            if (spec.advanceTo === "ORDERED") {
                if (spec.purchaseOrder === undefined) {
                    throw new Error(`${spec.role} advances to ORDERED but declares no purchase order`);
                }
                const recorded = await (0, reorderLifecycleCommands_js_1.recordReorderPurchaseOrder)(deps, actors.partsAssociate, {
                    reorderRequestId: id,
                    supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: spec.purchaseOrder.supplierId },
                    externalPoNumber: spec.purchaseOrder.externalPoNumber,
                    orderedQuantity: spec.quantity,
                    orderedDate: spec.purchaseOrder.orderedDate,
                    expectedArrivalDate: spec.purchaseOrder.expectedArrivalDate,
                    unitPriceMinor: spec.purchaseOrder.unitPriceMinor,
                    currency: spec.purchaseOrder.currency,
                });
                status = recorded.status;
                purchaseOrderId = recorded.purchaseOrderId;
            }
        }
        seeded.push(Object.freeze({
            role: spec.role, reorderRequestId: id, status, partId: spec.partId, purchaseOrderId,
        }));
    }
    // THE RECEIPT IS NOT SEEDED. The scenario deliberately stops at receiving-ready: the receipt is
    // the governed write the whole scenario exists to exercise, and seeding one would fake the step
    // under test and leave the sandbox unable to prove the thing it was built to prove.
    return Object.freeze({
        scenarioId: reorderScenarioFixtures_js_1.SCENARIO_ID,
        tenantId: actors.requester.tenantId,
        reorders: Object.freeze(seeded),
        receivingCandidates: Object.freeze(seeded.filter((x) => x.purchaseOrderId !== null)),
        receivingLeftToTheGovernedCommand: true,
    });
}
//# sourceMappingURL=reorderScenarioPostgresSeed.js.map