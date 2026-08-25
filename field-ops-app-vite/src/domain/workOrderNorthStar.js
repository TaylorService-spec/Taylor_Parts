import { planLinesFromSnapshot } from "./workOrderPartsPlan.js";
import { snapshotPartName, snapshotPartSku } from "./workOrderInventorySnapshot.js";

// THE WORK ORDER, DERIVED ONCE.
//
// ════════════════════ WHY THIS FILE EXISTS (NS-P4) ════════════════════
//
// The North Star's fourth protected principle is ONE FACT, ONE RENDERING. The pilot audit found the
// current Work Order showing status "four times in four treatments", the Account stating its AR
// denial three separate times, and the Parts surface rendering one reorder request three different
// ways. Every one of those is the same defect: a fact re-derived by whichever component happened to
// need it, each free to disagree with the others.
//
// So every fact the Work Order page displays is derived HERE, once, in a pure function, and the
// components render what they are handed. A component that formats a status, decides a severity, or
// works out readiness for itself has re-introduced the defect this file exists to remove.
//
// PURE. No React, no Firestore, no clock beyond an injected `nowMillis`. The whole page's meaning is
// therefore assertable offline, which is what makes the North Star rules falsifiable rather than
// aspirational.
//
// ════════════════════ WHAT IS DELIBERATELY ABSENT ════════════════════
//
// No ETA. No confidence percentage. No first-visit-fix rate. No "median completion". Those appear in
// `North Star - Work Order.dc.html`, whose own masthead says: "live truck-stock reads · WO naming
// service · notification channel · suggestion engine. None exist today — this is the destination,
// not the pilot." Rendering a computed-looking number with no service behind it would be a
// fabricated fact in an operations system, which is the worst thing this product could do.

/** The six-step spine the concept draws, mapped from the ELEVEN real governed statuses. */
export const WO_SPINE_STEPS = Object.freeze([
  { key: "created", label: "Created" },
  { key: "scheduled", label: "Scheduled" },
  { key: "dispatched", label: "Dispatched" },
  { key: "onSite", label: "On site" },
  { key: "complete", label: "Complete" },
  { key: "closed", label: "Closed" },
]);

// Which spine step each governed status occupies. The concept shows six chevrons; the engine has
// eleven states. This is the mapping, stated once, rather than each surface inventing a grouping.
const STATUS_TO_STEP = Object.freeze({
  CREATED: "created",
  READY_TO_DISPATCH: "created",
  SCHEDULED: "scheduled",
  DISPATCHED: "dispatched",
  ACCEPTED: "dispatched",
  EN_ROUTE: "onSite",
  ARRIVED: "onSite",
  WORK_IN_PROGRESS: "onSite",
  COMPLETED: "complete",
  CLOSED: "closed",
});

/**
 * STATUS IN WORDS (NS R04). The concept never prints `WORK_IN_PROGRESS`.
 *
 * An unknown status returns null rather than a prettified guess: a status this map does not know is
 * a real fact about the record that a human should see stated as unrecognised, not smoothed into
 * something readable and wrong.
 */
const STATUS_WORDS = Object.freeze({
  CREATED: "Created",
  READY_TO_DISPATCH: "Ready to dispatch",
  SCHEDULED: "Scheduled",
  DISPATCHED: "Dispatched",
  ACCEPTED: "Accepted by technician",
  EN_ROUTE: "En route",
  ARRIVED: "On site",
  WORK_IN_PROGRESS: "Work in progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
});

export function workOrderStatusWords(status) {
  return STATUS_WORDS[status] ?? null;
}

/** Tone for the status, so colour and word always agree. Never colour alone (NS R04). */
export function workOrderStatusTone(status) {
  if (status === "CANCELLED") return "negative";
  if (status === "COMPLETED" || status === "CLOSED") return "positive";
  if (status === "WORK_IN_PROGRESS" || status === "ARRIVED" || status === "EN_ROUTE") return "info";
  return "neutral";
}

/**
 * THE LIFECYCLE SPINE (NS-P1).
 *
 * Returns steps shaped for LifecycleChevrons — the primitive that already exists and is deliberately
 * business-rule-free. This function supplies the business rules; the component supplies none.
 *
 * CANCELLED is not a step. A cancelled Work Order did not reach "Closed" through the spine, and
 * drawing it as though it had would be a lie about how the record ended. It returns the steps it
 * genuinely reached, everything after as future, and a terminal badge — the same shape the
 * Opportunity lifecycle already uses for Lost.
 */
export function workOrderSpine(status) {
  const currentKey = STATUS_TO_STEP[status] ?? null;
  const currentIndex = currentKey ? WO_SPINE_STEPS.findIndex((s) => s.key === currentKey) : -1;
  const cancelled = status === "CANCELLED";

  const steps = WO_SPINE_STEPS.map((step, i) => {
    let stepStatus = "future";
    if (currentIndex >= 0) {
      if (i < currentIndex) stepStatus = "complete";
      else if (i === currentIndex) stepStatus = cancelled ? "future" : "current";
    }
    return { key: step.key, label: step.label, status: stepStatus };
  });

  return {
    steps,
    terminal: cancelled ? { key: "cancelled", label: "Cancelled", tone: "negative" } : null,
    // An unrecognised status resolves no step at all. Surfaced so the page can say so rather than
    // drawing six hollow rings that look like a brand-new record.
    unrecognised: !cancelled && currentIndex < 0,
  };
}

// ═════════════════════════════════════════ PARTS READINESS

/**
 * Readiness states. UNKNOWN is the important one and the honest one.
 *
 * The concept shows "✓ On truck" / "Staged — not picked up" / "Warehouse pick". Those require a live
 * truck-stock read, which does not exist (see the Design Grammar's implementation-reality table).
 * What EOS genuinely holds today is the PLAN: which parts, how many, recorded on the Work Order's
 * inventorySnapshot by a governed command that explicitly creates no reservation.
 *
 * So readiness renders as PLANNED with an explicit "readiness not available" note, never as a green
 * tick this system cannot substantiate. A fabricated ✓ would send a technician to a job without the
 * part — which is precisely the failure the concept's readiness column exists to prevent.
 */
export const READINESS = Object.freeze({
  PLANNED: "PLANNED",
  UNKNOWN: "UNKNOWN",
});

export function workOrderPartsPlan(workOrder) {
  const lines = planLinesFromSnapshot(workOrder?.inventorySnapshot) ?? [];
  return lines.map((l) => ({
    partId: l.partId ?? null,
    // Delegated to the ONE snapshot-display vocabulary rather than re-deriving a name here. The
    // snapshot is the authoritative HISTORICAL record -- what was called this at planning time --
    // and a second derivation is how the parts table comes to disagree with the parts panel.
    name: snapshotPartName(l.raw) || null,
    sku: snapshotPartSku(l.raw) || null,
    qtyPlanned: Number.isFinite(l.qtyPlanned) ? l.qtyPlanned : null,
    // One value, one meaning. When a truck-stock authority exists this becomes PLANNED -> ON_TRUCK /
    // STAGED / MISSING, and nothing else on the page changes.
    readiness: READINESS.UNKNOWN,
  }));
}

// ═════════════════════════════════════════ ATTENTION (NS pattern 3)

export const SEVERITY = Object.freeze({ BLOCKING: "BLOCKING", ATTENTION: "ATTENTION" });

const DAY = 24 * 60 * 60 * 1000;

/**
 * THE ATTENTION BLOCK — "renders nothing when clean" (NS pattern 3).
 *
 * Deterministic, derived from facts EOS already holds. This is NOT AI and is not presented as such:
 * the Design Grammar permits "a truthful deterministic attention state" in the composition where the
 * suggestion band will eventually live, and forbids dressing deterministic logic as intelligence.
 *
 * Each item states a plain-language fact, not a rule name. "Scheduled window has passed" is what the
 * dispatcher needs to read; SLA_BREACH_PENDING is what a developer named it.
 */
export function workOrderAttention(workOrder, { nowMillis = null, partsPlan = null } = {}) {
  if (!workOrder) return [];
  const items = [];
  const status = workOrder.status;
  const closed = status === "COMPLETED" || status === "CLOSED" || status === "CANCELLED";

  // A closed record is not "overdue". Attention on a finished job is noise that trains people to
  // ignore the band.
  if (!closed) {
    const start = millisOf(workOrder.scheduledStart);
    if (start == null) {
      items.push({
        key: "unscheduled",
        severity: SEVERITY.BLOCKING,
        fact: "Not scheduled — no visit window has been set.",
      });
    } else if (nowMillis != null && start < nowMillis && (status === "SCHEDULED" || status === "DISPATCHED" || status === "ACCEPTED")) {
      const daysLate = Math.floor((nowMillis - start) / DAY);
      items.push({
        key: "window-passed",
        severity: SEVERITY.BLOCKING,
        fact: daysLate >= 1
          ? `Scheduled window passed ${daysLate} day${daysLate === 1 ? "" : "s"} ago and the visit has not started.`
          : "Scheduled window has passed and the visit has not started.",
      });
    }

    if (!workOrder.scheduledTechId) {
      items.push({
        key: "unassigned",
        severity: SEVERITY.BLOCKING,
        fact: "No technician assigned.",
      });
    }

    const plan = partsPlan ?? workOrderPartsPlan(workOrder);
    if (plan.length === 0) {
      items.push({
        key: "no-parts-plan",
        severity: SEVERITY.ATTENTION,
        fact: "No parts planned. If this visit needs parts, plan them before dispatch.",
      });
    }
  }

  return items;
}

function millisOf(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (typeof v?.seconds === "number") return v.seconds * 1000;
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? null : parsed;
}

// ═════════════════════════════════════════ LINEAGE (NS-P1, R09)

/**
 * The chain edges this Work Order genuinely has.
 *
 * `state` is the honest-reference contract: RESOLVED carries a governed reference, UNRESOLVED means
 * the relationship exists but its reference could not be resolved, ABSENT means there is no
 * relationship. The document id is never returned as a label under any of the three (DECISIONS #106,
 * R03) — an UNRESOLVED edge names the entity and says the reference is unavailable, exactly as the
 * brief requires.
 */
export const EDGE = Object.freeze({ RESOLVED: "RESOLVED", UNRESOLVED: "UNRESOLVED", ABSENT: "ABSENT" });

export function workOrderLineage(workOrder, { salesOrderReference = null } = {}) {
  const edges = [];
  const soId = workOrder?.salesOrderId ?? null;
  if (!soId) {
    edges.push({ key: "salesOrder", label: "Sales order", state: EDGE.ABSENT });
  } else if (typeof salesOrderReference === "string" && /^SO-\d{4}-\d{6}$/.test(salesOrderReference)) {
    edges.push({ key: "salesOrder", label: "Sales order", state: EDGE.RESOLVED, reference: salesOrderReference, targetId: soId });
  } else {
    // The relationship is real and the reference is not resolvable from what this page can read.
    // Naming the entity and stating the absence is the contract; printing `soId` is the defect.
    edges.push({ key: "salesOrder", label: "Sales order", state: EDGE.UNRESOLVED, targetId: soId });
  }
  return edges;
}

/**
 * The single header derivation — everything the record header states, in one object.
 *
 * Assembled here rather than in the component so that "the status" is one value used by the header,
 * the spine and the attention rules, and cannot drift between them.
 */
export function workOrderHeader(workOrder) {
  if (!workOrder) return null;
  const status = workOrder.status ?? null;
  return {
    reference: typeof workOrder.woNumber === "string" && workOrder.woNumber.trim() ? workOrder.woNumber.trim() : null,
    kind: workOrder.type ?? null,
    priority: workOrder.priority ?? null,
    statusWords: workOrderStatusWords(status),
    statusTone: workOrderStatusTone(status),
    rawStatus: status,
    isClosed: status === "COMPLETED" || status === "CLOSED" || status === "CANCELLED",
    isCancelled: status === "CANCELLED",
  };
}
