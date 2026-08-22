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
    requiresToolIds: ["customer.summary"], requiresCapabilities: ["account.record.read"] },
  { id: "cust.equipment", surface: "CUSTOMER", text: "What equipment do they have?",
    requiresToolIds: ["customer.equipment"], requiresCapabilities: ["account.record.read"] },
  { id: "cust.openService", surface: "CUSTOMER", text: "Are there open service issues?",
    requiresToolIds: ["customer.openWorkOrders"], requiresCapabilities: ["account.record.read"] },
  { id: "cust.opportunities", surface: "CUSTOMER", text: "What opportunities are active?",
    requiresToolIds: ["customer.opportunities"], requiresCapabilities: ["opportunity.read"] },
  { id: "cust.lastContact", surface: "CUSTOMER", text: "When did we last contact them?",
    requiresToolIds: ["customer.activity"], requiresCapabilities: ["crm.activity.read"] },

  // ── Work Order
  { id: "wo.next", surface: "WORK_ORDER", text: "What needs to happen next?",
    requiresToolIds: ["workOrder.context"], requiresCapabilities: ["account.record.read"] },
  { id: "wo.blockers", surface: "WORK_ORDER", text: "What is blocking this job?",
    requiresToolIds: ["workOrder.context", "workOrder.partsPlan"], requiresCapabilities: ["account.record.read"] },
  { id: "wo.parts", surface: "WORK_ORDER", text: "Do we have the parts?",
    requiresToolIds: ["workOrder.partsPlan", "inventory.availability"], requiresCapabilities: ["inventory.balance.read"] },
  { id: "wo.assigned", surface: "WORK_ORDER", text: "Who is assigned?",
    requiresToolIds: ["workOrder.context"], requiresCapabilities: ["account.record.read"] },
  { id: "wo.history", surface: "WORK_ORDER", text: "What happened previously?",
    requiresToolIds: ["workOrder.history"], requiresCapabilities: ["account.record.read"] },

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
