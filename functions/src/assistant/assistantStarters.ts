// CONTEXTUAL STARTER QUESTIONS. What the assistant offers to answer, per screen.
//
// ============================ A STARTER IS A PROMISE ============================
//
// Offering "Should this be reordered?" tells the user the assistant can answer it. If no governed
// tool can, the offer is a lie the product tells before the model gets a chance to. So a starter is
// only shown when the CURRENT USER can actually run the tools it needs -- the same effective
// authority the gateway uses, not a role guess and not a static list.
//
// The consequence is deliberate: two people on the same screen see different starters. That is
// correct. A technician who cannot read balances should not be invited to ask about them and then
// refused.
//
// STARTERS NEVER SUGGEST ACTIONS. V1 cannot transfer, receive, count or transition anything, so no
// starter is phrased as one. "Should this be reordered?" is a question; "Reorder this part" would
// be an offer to do something the assistant is architecturally incapable of.
import type { PermissionId } from "../types/access";
import type { AssistantSurface } from "./assistantContext";
import type { EffectiveAuthority } from "./assistantAuthorization";

export interface StarterQuestion {
  readonly id: string;
  readonly surface: AssistantSurface;
  readonly text: string;
  /** Tools this question needs to be answerable. Empty is not allowed — see the guard below. */
  readonly requiresToolIds: readonly string[];
  /** Capabilities those tools require. Kept explicit so eligibility is checkable without the registry. */
  readonly requiresCapabilities: readonly PermissionId[];
}

export const STARTER_QUESTIONS: readonly StarterQuestion[] = Object.freeze([
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

  // ── Dashboard. Not record-scoped -- every dashboard tool answers over the actor's own governed
  // reach, the same reach `composeDashboard` uses to decide which dashboard modules a role sees at
  // all. A starter here is offered only when the actor's effective authority already includes the
  // capability the module needs, which is what makes the offered set differ by role without any
  // starter here naming a role.
  //
  // ONLY TWO TOOLS ARE WIRED (owner review #1855 authority-parity correction) -- see dashboardTools.ts
  // for why serviceAttention/workOrdersByStatus/myGoals moved to DASHBOARD_STARTER_GAPS instead of
  // being offered here with an approximated capability.
  { id: "dash.reorderQueue", surface: "DASHBOARD", text: "What is waiting in the reorder queue?",
    requiresToolIds: ["dashboard.reorderQueue"], requiresCapabilities: ["reorder.request.read.queue"] },
  { id: "dash.reorderOldest", surface: "DASHBOARD", text: "What is the oldest pending reorder request?",
    requiresToolIds: ["dashboard.reorderQueue"], requiresCapabilities: ["reorder.request.read.queue"] },
  { id: "dash.accountPortfolio", surface: "DASHBOARD", text: "How many accounts do I have in my portfolio?",
    requiresToolIds: ["dashboard.accountPortfolio"], requiresCapabilities: ["customer.record.read"] },
  { id: "dash.accountStatusMix", surface: "DASHBOARD", text: "How many of my accounts are active versus prospects?",
    requiresToolIds: ["dashboard.accountPortfolio"], requiresCapabilities: ["customer.record.read"] },
]);

/**
 * Dashboard questions with no registered tool yet -- recorded here rather than invented as a starter,
 * so the gap is visible instead of silent. Register each with `AssistantToolRegistry.recordGap` at
 * composition time. A starter is a promise; these are explicitly NOT starters until a trusted read
 * backs them.
 */
export const DASHBOARD_STARTER_GAPS: readonly { readonly intendedToolId: string; readonly whatUsersWouldAsk: string; readonly blockedBy: string }[] =
  Object.freeze([
    // MOVED HERE by owner review #1855, having previously been wired with an approximated authority.
    { intendedToolId: "dashboard.serviceAttention", whatUsersWouldAsk: "What needs attention right now? / Is anything past due? / Are there scheduling conflicts?",
      blockedBy: "MyDashboard gates this on isOperationsViewer (role === \"admin\" || \"dispatcher\"), a legacy Rules-based check with no capability id. workOrder.transition is also held by technician and would widen reach. No existing capability reproduces the admin/dispatcher check." },
    { intendedToolId: "dashboard.workOrdersByStatus", whatUsersWouldAsk: "How are my work orders distributed by status? / How much work is still open?",
      blockedBy: "Same isOperationsViewer gap as dashboard.serviceAttention -- no capability id represents the admin/dispatcher Rules check this read actually uses." },
    { intendedToolId: "dashboard.myGoals", whatUsersWouldAsk: "What are my current goals?",
      blockedBy: "performance.goal.read authorizes goal TARGETS only, never the metric actual (performanceGoalClient.js: \"transport moves targets, never actuals\"). MyDashboard scopes an individual goal by employeeId, which this route cannot honestly derive from the EOS principal uid without a new mapping this PR does not add." },
    { intendedToolId: "dashboard.technicianComparison", whatUsersWouldAsk: "How is my team doing, by technician?",
      blockedBy: "No AssistantBusinessDataReader method for per-technician comparison yet." },
    { intendedToolId: "dashboard.technicianAvailability", whatUsersWouldAsk: "Who's available today?",
      blockedBy: "No AssistantBusinessDataReader method for recorded working hours yet." },
    { intendedToolId: "dashboard.receivingQueue", whatUsersWouldAsk: "What purchase orders are waiting to be received?",
      blockedBy: "No AssistantBusinessDataReader method for the receiving queue yet." },
    { intendedToolId: "dashboard.adminDecisions", whatUsersWouldAsk: "What role requests are waiting on me?",
      blockedBy: "No AssistantBusinessDataReader method for pending admin decisions yet." },
    { intendedToolId: "dashboard.finance", whatUsersWouldAsk: "What have we billed and collected this month?",
      blockedBy: "No AssistantBusinessDataReader method for governed financial facts yet." },
    { intendedToolId: "dashboard.myOpportunities", whatUsersWouldAsk: "What opportunities are open in my pipeline?",
      blockedBy: "No AssistantBusinessDataReader method for opportunities yet." },
    { intendedToolId: "dashboard.ordersRequiringAction", whatUsersWouldAsk: "Which coordinated orders need action?",
      blockedBy: "No AssistantBusinessDataReader method for coordinated fulfillment visits yet." },
  ]);

/**
 * Starters this actor can actually have answered, on this surface.
 *
 * `availableToolIds` is passed in rather than assumed, because a starter needs BOTH the authority
 * and a registered tool. A question whose tool has not shipped yet is hidden rather than offered and
 * refused -- an offer that always fails teaches users to distrust the feature faster than an absence.
 */
export function startersFor(
  surface: AssistantSurface,
  authority: EffectiveAuthority,
  availableToolIds: ReadonlySet<string>,
): readonly StarterQuestion[] {
  return STARTER_QUESTIONS.filter((q) =>
    q.surface === surface
    && q.requiresCapabilities.every((c) => authority.operable.has(c))
    && q.requiresToolIds.every((t) => availableToolIds.has(t)));
}
