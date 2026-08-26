import { SALES_ORDER_STATE_LABEL } from "./salesOrderStatus.js";

// THE SALES ORDER, DERIVED ONCE.
//
// ════════════════════ WHY THIS FILE EXISTS (NS-P4) ════════════════════
//
// Second family in the North Star migration, and the same protected principle applies: ONE FACT,
// ONE RENDERING. The Sales Order page as shipped states the lifecycle state twice — once as a pill
// in the ContextBand and once inside the metadata field grid — and states the money in one place
// while `SalesOrderFulfillmentSection` separately re-derives progress from the same lines. Each of
// those is a fact re-derived by whichever component needed it, free to disagree with the others.
//
// So every fact the Sales Order page displays is derived HERE, once, in a pure function, and the
// components render what they are handed. This mirrors `workOrderNorthStar.js` deliberately: the
// two families must read as one product, and the way to guarantee that is to make the derivation
// layers structurally the same rather than merely similar-looking.
//
// PURE. No React, no Firestore, no clock beyond an injected `nowMillis`.
//
// ════════════════════ WHAT IS DELIBERATELY ABSENT, AND WHY ════════════════════
//
// NO STAGE TIMESTAMPS BEYOND CREATED AND UPDATED. This is the single largest honest gap in the
// family, and it is a DATA fact, not a rendering choice. `functions/src/salesOrder/
// salesOrderReadService.ts` projects exactly two times — `createdAtMillis` and `updatedAtMillis` —
// because the canonical document stores exactly two: `createdAt` and `updatedAt`. There is no
// `confirmedAt`, no `allocatedAt` on the order, no `fulfilledAt`, no `closedAt`, no `cancelledAt`.
//
// The Work Order spine can say WHEN each stage happened because the Work Order records it. The
// Sales Order spine cannot, and this file says so in words rather than borrowing `updatedAt` for
// whichever stage the record currently occupies. `updatedAt` is the time of the LAST write of any
// kind; presenting it as "Fulfilled at" would be a fabricated fact about a sale, which is the worst
// thing this product could do. Recorded as ND-8.
//
// NO REVENUE RECOGNITION, NO MARGIN, NO FORECAST, NO FX. The money that exists is the committed
// price snapshot in integer minor units, totalled by the server ONLY when every line is priced.
// This file carries that through and never sums a partly-priced order.

/**
 * The four-step spine, mapped from the five governed states.
 *
 * Server authority: functions/src/salesOrder/salesOrderLifecycle.ts SALES_ORDER_STATES. CANCELLED
 * is NOT a step, for the same reason it is not one on the Work Order: a cancelled order did not
 * reach "Closed" through the spine, and drawing it as though it had would be a lie about how the
 * record ended. It returns as a terminal badge instead.
 */
export const SO_SPINE_STEPS = Object.freeze([
  { key: "confirmed", label: "Confirmed" },
  { key: "inFulfillment", label: "In fulfillment" },
  { key: "fulfilled", label: "Fulfilled" },
  { key: "closed", label: "Closed" },
]);

const STATE_TO_STEP = Object.freeze({
  CONFIRMED: "confirmed",
  IN_FULFILLMENT: "inFulfillment",
  FULFILLED: "fulfilled",
  CLOSED: "closed",
});

/**
 * STATE IN WORDS (NS R04). The composition never prints `IN_FULFILLMENT`.
 *
 * Sourced from the ONE existing vocabulary rather than copied. `salesOrderStateLabel` returns an
 * unrecognised value VERBATIM, which is right for a field grid and wrong here: a state the spine
 * cannot place must be reported as unplaceable, not echoed as though it were a word. So this
 * reads the map directly and returns null on a miss, matching `workOrderStatusWords`.
 */
export function salesOrderStateWords(state) {
  return SALES_ORDER_STATE_LABEL[state] ?? null;
}

/**
 * STATE AS A SENTENCE — the same treatment P1v2 ruled for the Work Order.
 *
 * The clause answers "what is it waiting on", and every clause here is DERIVED FROM THE ENGINE'S
 * OWN GUARDS rather than invented:
 *
 *   CONFIRMED       — `canAllocate` is true here, and allocation is the next thing anyone does.
 *   IN_FULFILLMENT  — `canAdvance` refuses this state unless `allLinesFulfilled`, so that is
 *                     literally what it is waiting on.
 *   FULFILLED       — FORWARD maps it to CLOSED; nothing else gates it.
 *
 * CLOSED and CANCELLED add nothing: a terminal state is not waiting on anything, and padding it
 * into a sentence for symmetry would be writing copy rather than stating fact.
 */
const STATE_CLAUSE = Object.freeze({
  CONFIRMED: "awaiting allocation",
  IN_FULFILLMENT: "every line must be fulfilled before this order can advance",
  FULFILLED: "awaiting closeout",
  CLOSED: null,
  CANCELLED: null,
});

export function salesOrderStateSentence(state) {
  const words = salesOrderStateWords(state);
  if (!words) return null;
  const clause = STATE_CLAUSE[state];
  return clause ? words + " — " + clause : words;
}

/** Tone, so colour and word always agree. Never colour alone (NS R04). */
export function salesOrderStateTone(state) {
  if (state === "CANCELLED") return "negative";
  if (state === "FULFILLED" || state === "CLOSED") return "positive";
  if (state === "IN_FULFILLMENT") return "info";
  return "neutral";
}

/**
 * THE LIFECYCLE SPINE (NS-P1).
 *
 * Shaped for LifecycleBand, which is business-rule-free. This function supplies the rules.
 */
export function salesOrderSpine(state) {
  const currentKey = STATE_TO_STEP[state] ?? null;
  const currentIndex = currentKey ? SO_SPINE_STEPS.findIndex((s) => s.key === currentKey) : -1;
  const cancelled = state === "CANCELLED";

  const steps = SO_SPINE_STEPS.map((step, i) => {
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
    unrecognised: !cancelled && currentIndex < 0,
  };
}

/**
 * ONE LINE OF FACT for whichever spine stage the reader opened.
 *
 * ════════════════════ THE HONEST PART ════════════════════
 *
 * Only ONE stage can state a time: "Confirmed", from `createdAtMillis`. Every other stage returns
 * a sentence saying no time is recorded, because none is. See the file header (ND-8).
 *
 * What the other stages CAN say is quantity fact, which the order genuinely holds: how many lines
 * are allocated, how many fulfilled, how many billed. That is a real read of stored data and it is
 * what a reader opening "In fulfillment" actually wants. It is stated as a count, never as a
 * percentage complete — a percentage implies a schedule, and there is no schedule here.
 *
 * @param salesOrder the READY view model from salesOrderView
 * @param stepKey    one of SO_SPINE_STEPS
 * @param formatWhen injected formatter (this file stays pure and unaware of display formatting)
 * @returns { tone, lead, fact } — tone is "complete" | "current" | "future"
 */
export function salesOrderStageDetail(salesOrder, stepKey, formatWhen) {
  const spine = salesOrderSpine(salesOrder?.state);
  const step = spine.steps.find((s) => s.key === stepKey) ?? null;
  const tone = step?.status === "complete" ? "complete" : step?.status === "current" ? "current" : "future";
  const label = SO_SPINE_STEPS.find((s) => s.key === stepKey)?.label ?? null;
  if (!label) return null;

  const q = summariseLines(salesOrder?.lines);
  const NO_TIME = "No time is recorded for this stage — a Sales Order stores only when it was created and when it was last changed.";

  if (stepKey === "confirmed") {
    const when = typeof formatWhen === "function" ? formatWhen(salesOrder?.createdAtMillis ?? null) : null;
    return {
      tone,
      lead: "Confirmed",
      fact: when
        ? `Order created ${when}. ${q.lineCount === 0 ? "No lines were recorded." : `${q.lineCount} line${q.lineCount === 1 ? "" : "s"} ordered.`}`
        : `No creation time is recorded. ${q.lineCount === 0 ? "No lines were recorded." : `${q.lineCount} line${q.lineCount === 1 ? "" : "s"} ordered.`}`,
    };
  }

  if (stepKey === "inFulfillment") {
    return {
      tone,
      lead: "In fulfillment",
      fact: q.lineCount === 0
        ? `${NO_TIME} This order has no lines to fulfil.`
        : `${q.allocatedLines} of ${q.lineCount} line${q.lineCount === 1 ? "" : "s"} allocated, ${q.fulfilledLines} fully fulfilled. ${NO_TIME}`,
    };
  }

  if (stepKey === "fulfilled") {
    return {
      tone,
      lead: "Fulfilled",
      fact: q.lineCount === 0
        ? `${NO_TIME} This order has no lines.`
        : `${q.fulfilledLines} of ${q.lineCount} line${q.lineCount === 1 ? "" : "s"} fully fulfilled. ${NO_TIME}`,
    };
  }

  // closed
  return {
    tone,
    lead: "Closed",
    fact: q.lineCount === 0
      ? NO_TIME
      : `${q.billedLines} of ${q.lineCount} line${q.lineCount === 1 ? "" : "s"} billed. ${NO_TIME}`,
  };
}

/**
 * The line quantity model, counted once.
 *
 * COUNTS LINES, NOT UNITS. A line is "allocated" when its allocated quantity reaches what was
 * ordered — a partly-allocated line is not allocated, and rolling partial units into one figure
 * would produce a number that looks like progress and is not.
 */
export function summariseLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const at = (l, key) => (typeof l?.[key] === "number" ? l[key] : 0);
  const ordered = (l) => at(l, "orderedQty");
  return {
    lineCount: list.length,
    allocatedLines: list.filter((l) => ordered(l) > 0 && at(l, "allocatedQty") >= ordered(l)).length,
    fulfilledLines: list.filter((l) => l?.fullyFulfilled === true).length,
    billedLines: list.filter((l) => ordered(l) > 0 && at(l, "billedQty") >= ordered(l)).length,
    anyAllocated: list.some((l) => at(l, "allocatedQty") > 0),
  };
}

/**
 * THE MILESTONE LIST — two rows, and the page says why there are only two.
 *
 * `planned` is not used here: neither of these is a plan. The shape matches `workOrderTimeline`
 * so the shared renderer can consume either without knowing which family it is drawing.
 */
export function salesOrderTimeline(salesOrder) {
  return [
    { key: "created", label: "Order created", at: salesOrder?.createdAtMillis ?? null },
    // NOT a lifecycle event, and labelled so. `updatedAt` moves on ANY write — an allocation, a
    // note edit, a fulfillment write-back. Calling it "Last changed" is the whole truth about it.
    { key: "updated", label: "Last changed", at: salesOrder?.updatedAtMillis ?? null },
  ].filter((e) => e.at != null);
}

// ═════════════════════════════════════════ ATTENTION (NS pattern 3)

export const SEVERITY = Object.freeze({ BLOCKING: "BLOCKING", ATTENTION: "ATTENTION" });

/**
 * THE ATTENTION BLOCK — "renders nothing when clean" (NS pattern 3).
 *
 * Deterministic, derived from facts EOS already holds, and NOT presented as intelligence. Each
 * item states a plain-language fact rather than a rule name.
 *
 * A terminal order raises nothing. Attention on a closed or cancelled sale is noise that trains
 * people to ignore the band — the same rule the Work Order follows.
 */
export function salesOrderAttention(salesOrder) {
  if (!salesOrder) return [];
  const state = salesOrder.state;
  if (state === "CLOSED" || state === "CANCELLED") return [];

  const items = [];
  const q = summariseLines(salesOrder.lines);

  if (q.lineCount === 0) {
    items.push({
      key: "no-lines",
      severity: SEVERITY.BLOCKING,
      fact: "This order has no lines. There is nothing to allocate, fulfil or bill.",
    });
  }

  // WHY THE ORDER SHOWS NO TOTAL, said once, here. The header renders the money; this states the
  // reason it is absent, so a reader is never left interpreting a dash.
  if (salesOrder.pricingState === "UNPRICED" && q.lineCount > 0) {
    items.push({
      key: "unpriced",
      severity: SEVERITY.BLOCKING,
      fact: "No line carries a price. This order cannot be billed until it is priced.",
    });
  } else if (salesOrder.pricingState === "PARTIALLY_PRICED") {
    const n = typeof salesOrder.unpricedLineCount === "number" ? salesOrder.unpricedLineCount : null;
    items.push({
      key: "partly-priced",
      severity: SEVERITY.ATTENTION,
      fact: n != null
        ? `${n} line${n === 1 ? "" : "s"} carry no price, so this order has no total.`
        : "Some lines carry no price, so this order has no total.",
    });
  }

  if (state === "IN_FULFILLMENT" && q.lineCount > 0 && !q.anyAllocated) {
    items.push({
      key: "nothing-allocated",
      severity: SEVERITY.ATTENTION,
      fact: "This order is in fulfillment and nothing has been allocated yet.",
    });
  }

  return items;
}

// ═════════════════════════════════════════ LINEAGE (NS-P1, R09)

/**
 * The chain edges this Sales Order genuinely has.
 *
 * Same honest-reference contract as the Work Order: RESOLVED carries a governed reference,
 * UNRESOLVED means the relationship is real and its reference could not be resolved, ABSENT means
 * there is no relationship. The document id is NEVER returned as a label under any of the three
 * (DECISIONS #106, R03).
 *
 * THE AGREEMENT EDGE IS ALWAYS UNRESOLVED OR ABSENT TODAY. `sourceAgreementId` is projected, and
 * no read resolves a Sales Agreement to a reference. Naming the entity and stating the absence is
 * the contract; printing the id is the defect this rule exists to forbid.
 */
export const EDGE = Object.freeze({ RESOLVED: "RESOLVED", UNRESOLVED: "UNRESOLVED", ABSENT: "ABSENT" });

const OPPORTUNITY_REFERENCE = /^OPP-\d{4}-\d{6}$/;
const WORK_ORDER_REFERENCE = /^WO-\d{4}-\d{6}$/;

export function salesOrderLineage(salesOrder) {
  const edges = [];

  const oppId = salesOrder?.sourceOpportunityId ?? null;
  const oppRef = salesOrder?.sourceOpportunityNumber ?? null;
  if (!oppId) {
    edges.push({ key: "opportunity", label: "Opportunity", state: EDGE.ABSENT });
  } else if (typeof oppRef === "string" && OPPORTUNITY_REFERENCE.test(oppRef)) {
    edges.push({ key: "opportunity", label: "Opportunity", state: EDGE.RESOLVED, reference: oppRef, targetId: oppId });
  } else {
    edges.push({ key: "opportunity", label: "Opportunity", state: EDGE.UNRESOLVED, targetId: oppId });
  }

  const agreementId = salesOrder?.sourceAgreementId ?? null;
  edges.push(
    agreementId
      ? { key: "agreement", label: "Sales agreement", state: EDGE.UNRESOLVED, targetId: agreementId }
      : { key: "agreement", label: "Sales agreement", state: EDGE.ABSENT },
  );

  const workOrders = Array.isArray(salesOrder?.serviceWorkOrders) ? salesOrder.serviceWorkOrders : [];
  if (workOrders.length === 0) {
    edges.push({ key: "workOrders", label: "Work orders", state: EDGE.ABSENT });
  } else {
    for (const wo of workOrders) {
      const ref = wo?.workOrderNumber ?? null;
      edges.push(
        typeof ref === "string" && WORK_ORDER_REFERENCE.test(ref)
          ? { key: `workOrder:${wo.workOrderId}`, label: "Work order", state: EDGE.RESOLVED, reference: ref, targetId: wo.workOrderId }
          : { key: `workOrder:${wo.workOrderId}`, label: "Work order", state: EDGE.UNRESOLVED, targetId: wo.workOrderId },
      );
    }
  }

  return edges;
}

/**
 * The single header derivation — everything the record header states, in one object.
 *
 * Assembled here rather than in the component so that "the state" is one value used by the header,
 * the spine and the attention rules, and cannot drift between them.
 */
export function salesOrderHeader(salesOrder) {
  if (!salesOrder) return null;
  const state = salesOrder.state ?? null;
  const reference = typeof salesOrder.salesOrderNumber === "string" && salesOrder.salesOrderNumber.trim()
    ? salesOrder.salesOrderNumber.trim()
    : null;
  return {
    reference,
    channel: salesOrder.salesChannel ?? null,
    customerPO: salesOrder.customerPO ?? null,
    stateWords: salesOrderStateWords(state),
    stateSentence: salesOrderStateSentence(state),
    stateTone: salesOrderStateTone(state),
    rawState: state,
    isTerminal: state === "CLOSED" || state === "CANCELLED",
    isCancelled: state === "CANCELLED",
  };
}
