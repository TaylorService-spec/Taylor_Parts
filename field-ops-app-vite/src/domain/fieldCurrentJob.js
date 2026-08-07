import { nextFieldAction, fieldProgressStep, FIELD_ACTIONS } from "./fieldWorkOrder.js";
import { buildWorkOrderPartsReadiness } from "./workOrderPartsReadiness.js";

/**
 * F1 — the Current Job operating projection.
 *
 * Composes ALREADY-GOVERNED facts into the technician's operating rhythm:
 *
 *   Context -> State -> Attention -> Readiness -> Next Best Action
 *
 * It DERIVES; it never invents authority.
 *   - lifecycle state + timestamps  : the governed Work Order (F0)
 *   - next action                   : getAllowedActions via nextFieldAction (F0)
 *   - parts readiness               : buildWorkOrderPartsReadiness (#638) — CONSUMED,
 *                                     never re-derived. This module contains no
 *                                     availability arithmetic and no readiness vocabulary
 *                                     of its own; READY/ATTENTION/UNKNOWN/NO_PLAN and
 *                                     degraded[] keep exactly the shared semantics.
 *   - customer identity             : see CUSTOMER IDENTITY below.
 *
 * CUSTOMER IDENTITY. The governed Work Order carries `customerId`/`locationId` as
 * REFERENCES to canonical Customer/Account authority. It deliberately does not carry a
 * denormalised name — duplicating customer identity onto the Work Order would create a
 * second canonical representation.
 *
 * A technician cannot currently resolve those references: `firestore.rules` gates
 * `accounts`, `locations` and `equipment` reads to `isAdminOrDispatcher()`, and the
 * technician compatibility Role does not hold `account.record.read`. So this projection
 * reports customer identity as an explicit, honest state and NEVER fabricates a label,
 * never shows a raw id as if it were a name, and never silently omits the field so the
 * screen reads as though a customer were absent.
 */

export const CUSTOMER_IDENTITY = Object.freeze({
  /** Resolved from canonical authority. */
  RESOLVED: "RESOLVED",
  /** The Work Order references a customer the viewer is not authorised to read. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** The Work Order carries no customer reference at all — a data gap, not a denial. */
  ABSENT: "ABSENT",
  /** A reference exists and a resolver ran, but could not produce a name. */
  UNRESOLVED: "UNRESOLVED",
});

/**
 * Resolve the customer for display.
 *
 * `resolver` is injected so this stays pure and so the caller — not this module —
 * owns whether a governed read path exists. When no resolver is supplied the answer is
 * NOT_AUTHORIZED rather than ABSENT, because the distinction between "you may not see
 * this" and "there is nothing here" is exactly what the experience must not blur.
 */
export function resolveCustomerIdentity(workOrder, resolver = null) {
  const customerId = workOrder?.customerId ?? null;
  if (!customerId) return { state: CUSTOMER_IDENTITY.ABSENT, name: null, customerId: null };
  if (typeof resolver !== "function") {
    return { state: CUSTOMER_IDENTITY.NOT_AUTHORIZED, name: null, customerId };
  }
  const name = resolver(customerId);
  if (typeof name === "string" && name.trim()) {
    return { state: CUSTOMER_IDENTITY.RESOLVED, name: name.trim(), customerId };
  }
  return { state: CUSTOMER_IDENTITY.UNRESOLVED, name: null, customerId };
}

/** Attention items are things that should change what the technician does next. */
function buildAttention(workOrder, readiness, customer) {
  const items = [];

  if (readiness.jobReadiness === "ATTENTION") {
    const n = readiness.counts?.ATTENTION ?? 0;
    items.push({
      key: "parts-attention",
      severity: "high",
      label: n === 1 ? "1 planned part needs attention" : `${n} planned parts need attention`,
    });
  }
  if (readiness.jobReadiness === "UNKNOWN") {
    items.push({
      key: "parts-unknown",
      severity: "medium",
      label: "Parts readiness can't be confirmed",
    });
  }
  for (const capability of readiness.degraded ?? []) {
    items.push({
      key: `degraded-${capability}`,
      severity: "low",
      label: `${capability} information is unavailable here`,
    });
  }
  if (customer.state === CUSTOMER_IDENTITY.NOT_AUTHORIZED) {
    items.push({
      key: "customer-not-authorized",
      severity: "medium",
      label: "Customer details aren't available to your role",
    });
  }
  if (customer.state === CUSTOMER_IDENTITY.ABSENT) {
    items.push({
      key: "customer-absent",
      severity: "medium",
      label: "This work order has no customer on record",
    });
  }
  if (workOrder?.severity === "HIGH" || workOrder?.severity === "CRITICAL") {
    items.push({ key: "severity", severity: "high", label: `${workOrder.severity} severity` });
  }
  return items;
}

/**
 * Build the whole Current Job view model.
 *
 * `plannedParts` are the caller's already-resolved readiness rows (see
 * buildWorkOrderPartsReadiness's contract). Passing none is not an error — it yields the
 * shared NO_PLAN state, which reads differently from "everything is ready".
 */
export function buildCurrentJob({
  workOrder = null,
  technicianId = null,
  plannedParts = [],
  capabilities = {},
  customerResolver = null,
} = {}) {
  if (!workOrder) return null;

  const customer = resolveCustomerIdentity(workOrder, customerResolver);
  const readiness = buildWorkOrderPartsReadiness({ workOrder, plannedParts, capabilities });
  const next = nextFieldAction(workOrder, technicianId);

  return {
    workOrderId: workOrder.id ?? null,
    reference: workOrder.woNumber ?? workOrder.id ?? null,

    // CONTEXT — where am I going, who is the customer, what am I working on
    context: {
      customer,
      locationId: workOrder.locationId ?? null,
      complaint: workOrder.complaint ?? null,
      scheduledStart: workOrder.scheduledStart ?? null,
    },

    // STATE — what is its governed state
    state: {
      status: workOrder.status ?? null,
      step: fieldProgressStep(workOrder.status),
      totalSteps: FIELD_ACTIONS.length,
      priority: workOrder.priority ?? null,
      severity: workOrder.severity ?? null,
    },

    // ATTENTION — what requires me before I act
    attention: buildAttention(workOrder, readiness, customer),

    // READINESS — the SHARED projection, passed through unchanged
    readiness,

    // NEXT BEST ACTION — governed, or null when nothing is permitted
    nextAction: next,
  };
}
