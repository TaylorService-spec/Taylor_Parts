"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STARTER_QUESTIONS = void 0;
exports.startersFor = startersFor;
exports.STARTER_QUESTIONS = Object.freeze([
    // ── Customer
    { id: "cust.overview", surface: "CUSTOMER", text: "What should I know about this customer?",
        requiresToolIds: ["customer.summary"], requiresCapabilities: ["customer.record.read"] },
    { id: "cust.equipment", surface: "CUSTOMER", text: "What equipment do they have?",
        requiresToolIds: ["customer.equipment"], requiresCapabilities: ["customer.record.read"] },
    { id: "cust.openService", surface: "CUSTOMER", text: "Are there open service issues?",
        requiresToolIds: ["customer.openWorkOrders"], requiresCapabilities: ["customer.record.read"] },
    { id: "cust.opportunities", surface: "CUSTOMER", text: "What opportunities are active?",
        requiresToolIds: ["customer.opportunities"], requiresCapabilities: ["opportunity.read"] },
    { id: "cust.lastContact", surface: "CUSTOMER", text: "When did we last contact them?",
        requiresToolIds: ["customer.activity"], requiresCapabilities: ["crm.activity.read"] },
    // ── Work Order
    { id: "wo.next", surface: "WORK_ORDER", text: "What needs to happen next?",
        requiresToolIds: ["workOrder.context"], requiresCapabilities: ["customer.record.read"] },
    { id: "wo.blockers", surface: "WORK_ORDER", text: "What is blocking this job?",
        requiresToolIds: ["workOrder.context", "workOrder.partsPlan"], requiresCapabilities: ["customer.record.read"] },
    { id: "wo.parts", surface: "WORK_ORDER", text: "Do we have the parts?",
        requiresToolIds: ["workOrder.partsPlan", "inventory.availability"], requiresCapabilities: ["inventory.balance.read"] },
    { id: "wo.assigned", surface: "WORK_ORDER", text: "Who is assigned?",
        requiresToolIds: ["workOrder.context"], requiresCapabilities: ["customer.record.read"] },
    { id: "wo.history", surface: "WORK_ORDER", text: "What happened previously?",
        requiresToolIds: ["workOrder.history"], requiresCapabilities: ["customer.record.read"] },
    // ── Part
    { id: "part.reorder", surface: "PART", text: "Should this be reordered?",
        requiresToolIds: ["part.reorderState"], requiresCapabilities: ["inventory.balance.read", "reorder.purchaseOrder.read"] },
    { id: "part.where", surface: "PART", text: "Where is it available?",
        requiresToolIds: ["part.availability"], requiresCapabilities: ["inventory.balance.read"] },
    { id: "part.trucks", surface: "PART", text: "Which trucks have it?",
        requiresToolIds: ["part.truckStock"], requiresCapabilities: ["inventory.balance.read"] },
    { id: "part.demand", surface: "PART", text: "Which Work Orders need it?",
        requiresToolIds: ["part.demand"], requiresCapabilities: ["inventory.balance.read"] },
    { id: "part.onOrder", surface: "PART", text: "Is more already on order?",
        requiresToolIds: ["part.inboundPurchaseOrders"], requiresCapabilities: ["reorder.purchaseOrder.read"] },
    // ── Dispatch
    { id: "disp.attention", surface: "DISPATCH", text: "What needs attention?",
        requiresToolIds: ["dispatch.board"], requiresCapabilities: ["workOrder.transition"] },
    { id: "disp.ready", surface: "DISPATCH", text: "Which jobs are ready?",
        requiresToolIds: ["dispatch.board"], requiresCapabilities: ["workOrder.transition"] },
    { id: "disp.blocked", surface: "DISPATCH", text: "What is blocking this job?",
        requiresToolIds: ["dispatch.board", "workOrder.partsPlan"], requiresCapabilities: ["workOrder.transition"] },
    { id: "disp.technician", surface: "DISPATCH", text: "What work is assigned to this technician?",
        requiresToolIds: ["dispatch.technicianSchedule"], requiresCapabilities: ["workOrder.transition"] },
]);
/**
 * Starters this actor can actually have answered, on this surface.
 *
 * `availableToolIds` is passed in rather than assumed, because a starter needs BOTH the authority
 * and a registered tool. A question whose tool has not shipped yet is hidden rather than offered and
 * refused -- an offer that always fails teaches users to distrust the feature faster than an absence.
 */
function startersFor(surface, authority, availableToolIds) {
    return exports.STARTER_QUESTIONS.filter((q) => q.surface === surface
        && q.requiresCapabilities.every((c) => authority.operable.has(c))
        && q.requiresToolIds.every((t) => availableToolIds.has(t)));
}
//# sourceMappingURL=assistantStarters.js.map