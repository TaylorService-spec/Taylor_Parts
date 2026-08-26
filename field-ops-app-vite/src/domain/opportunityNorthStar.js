import {
  OPPORTUNITY_STAGES,
  STAGE_LABEL,
  OUTCOME_LABEL,
  CHANNEL_LABEL,
  stageProgress,
  allowedActions,
  deriveAttention,
} from "./opportunityLifecycle.js";

// THE OPPORTUNITY, DERIVED ONCE.
//
// ════════════════════ WHY THIS FILE EXISTS (NS-P4) ════════════════════
//
// Fourth family in the North Star migration, and the first that is not a recomposition. The first
// three took a page that already existed, already had its data and already had its authority, and
// re-composed it. An Opportunity had no page: it existed only as the selected row of a pipeline
// somebody had already loaded, with no per-id read and therefore no URL. The migration ledger
// stopped here and asked for a decision rather than absorbing the scope change.
//
// So this layer sits over a NEW governed read (`getOpportunityContext`) and an existing, unchanged
// commercial lifecycle. It adds no vocabulary of its own: stage words, channel words, outcome
// words, legality and attention all come from `opportunityLifecycle.js`, which the pipeline already
// consumes. That is the entire point — if this file re-derived "which stage is current" the record
// page and the pipeline row would be free to disagree about one deal, which is the NS-P4 defect
// this whole programme exists to remove.
//
// PURE. No React, no Firestore, no clock beyond an injected `nowMillis`.
//
// ════════════════════ WHAT IS DELIBERATELY ABSENT, AND WHY ════════════════════
//
// NO PROBABILITY, NO WEIGHTED VALUE, NO FORECAST. `expectedValue` is a plain number the salesperson
// typed, with no currency field beside it and no stage-probability anywhere in the engine. A
// weighted pipeline figure is the single most tempting number to invent on a sales record and there
// is nothing behind it: multiplying a typed number by a probability nobody stored would produce a
// forecast presented with the authority of a system that computed it. The metadata definition
// already records the narrower half of this ("do not render a currency symbol the data does not
// justify") and it is honoured here.
//
// NO STAGE TIMES EXCEPT CLOSE (ND-12). An Opportunity document stores `createdAt`, `updatedAt` and
// — on an outcome transition only — `closedAt`. It records nothing about when it entered
// Qualifying, or how long it sat in Quoting. So the band states a time at exactly two stages, and
// says so in words at the others rather than borrowing `updatedAt`, which moves on any write of any
// kind. This is the same rule ND-8 established for the Sales Order, reached from the same evidence.

export const OPPORTUNITY_STAGE_LABEL = STAGE_LABEL;

/**
 * STATE IN WORDS (NS R04). The composition never prints `CUSTOMER_REVIEW`.
 *
 * A closed Opportunity reads by OUTCOME and an open one by STAGE — the reading `commercialState()`
 * already applies for every pipeline row. Returns null on a value neither vocabulary recognises, so
 * an unplaceable state is reported as unplaceable rather than echoed back as though it were a word.
 */
export function opportunityStateWords(opportunity) {
  const outcome = opportunity?.outcome ?? null;
  if (outcome) return OUTCOME_LABEL[outcome] ?? null;
  const stage = opportunity?.stage ?? null;
  return stage ? (STAGE_LABEL[stage] ?? null) : null;
}

/**
 * STATE AS A SENTENCE — the treatment P1v2 ruled for the Work Order and family 2 followed.
 *
 * Every clause is DERIVED FROM THE ENGINE'S OWN GUARDS rather than written as copy:
 *
 *   open, not DECISION — `allowedActions` offers exactly one forward stage, so the sentence names
 *                        the stage the record can actually reach next. Nothing else is legal.
 *   DECISION           — `allowedActions` offers WON and LOST here and only here; the deal is
 *                        waiting on the customer, which is what the stage means.
 *   WON / LOST         — terminal. A closed deal is not waiting on anything, and padding it into a
 *                        clause for symmetry would be writing prose rather than stating fact.
 */
export function opportunityStateSentence(opportunity) {
  const words = opportunityStateWords(opportunity);
  if (!words) return null;
  if (opportunity?.outcome) return words;
  if (opportunity?.stage === "DECISION") return `${words} — awaiting the customer's decision`;
  const { advanceTo } = allowedActions(opportunity);
  if (advanceTo) return `${words} — next stage ${STAGE_LABEL[advanceTo] ?? advanceTo}`;
  return words;
}

/** Tone, so colour and word always agree. Never colour alone (NS R04). */
export function opportunityStateTone(opportunity) {
  if (opportunity?.outcome === "WON") return "positive";
  if (opportunity?.outcome === "LOST") return "negative";
  if (opportunity?.stage === "DECISION") return "attention";
  return "info";
}

/**
 * THE LIFECYCLE SPINE (NS-P1).
 *
 * A pass-through to `stageProgress`, and that is the whole design. `stageProgress` already returns
 * the exact shape `LifecycleBand` consumes — ordered steps carrying complete/current/future, plus
 * an optional terminal badge — because `LifecycleChevrons` (the pipeline-row rendering of the same
 * progression) was built against it first. Adding a second Opportunity-specific spine function here
 * would create precisely the drift NS-P4 forbids: two answers to "where is this deal".
 *
 * `unrecognised` is the one thing added, and it is a REPORT rather than a rule: a stage the
 * vocabulary cannot place must be visible as unplaceable, not silently drawn as step one.
 */
export function opportunitySpine(opportunity) {
  const { stages, terminal } = stageProgress(opportunity);
  const stage = opportunity?.stage ?? null;
  return {
    steps: stages,
    terminal,
    unrecognised: stage != null && !OPPORTUNITY_STAGES.includes(stage),
  };
}

const NO_STAGE_TIME =
  "No time is recorded for this stage — an Opportunity stores when it was created, when it was last changed, and when it closed.";

/**
 * ONE LINE OF FACT for whichever spine stage the reader opened.
 *
 * ════════════════════ THE HONEST PART (ND-12) ════════════════════
 *
 * Exactly TWO stages can state a time, and neither is borrowed:
 *
 *   Identified — `createdAtMillis`. An Opportunity is created AT Identified, always; the pure
 *                builder admits no other starting stage, so the creation time IS this stage's time.
 *   Decision   — `closedAtMillis`, and ONLY once the deal has closed. WON and LOST are both reached
 *                from Decision, so the close time is the time this stage ended. On an open deal the
 *                stage has not ended and no time is claimed.
 *
 * Every other stage says so in words. What those stages CAN say is deal fact the record genuinely
 * holds — what is being sold — and that is what a reader opening a stage actually wants. Stated as
 * counts, never as a percentage complete: a percentage implies a schedule, and there is none here.
 *
 * @param opportunity the READY view model from opportunityView
 * @param stepKey     one of OPPORTUNITY_STAGES
 * @param formatWhen  injected formatter (this file stays pure and unaware of display formatting)
 * @returns { tone, lead, fact } — tone is "complete" | "current" | "future"
 */
export function opportunityStageDetail(opportunity, stepKey, formatWhen) {
  const label = STAGE_LABEL[stepKey] ?? null;
  if (!label) return null;

  const spine = opportunitySpine(opportunity);
  const step = spine.steps.find((s) => s.key === stepKey) ?? null;
  const tone = step?.status === "complete" ? "complete" : step?.status === "current" ? "current" : "future";
  const when = (v) => (typeof formatWhen === "function" ? formatWhen(v ?? null) : null);
  const lineCount = Array.isArray(opportunity?.lines) ? opportunity.lines.length : 0;
  const linePhrase = lineCount === 0
    ? "No solution lines have been recorded."
    : `${lineCount} solution line${lineCount === 1 ? "" : "s"} recorded.`;

  if (stepKey === "IDENTIFIED") {
    const created = when(opportunity?.createdAtMillis);
    return {
      tone,
      lead: label,
      fact: created
        ? `Opportunity created ${created}. ${linePhrase}`
        : `No creation time is recorded. ${linePhrase}`,
    };
  }

  if (stepKey === "DECISION") {
    const outcomeWords = opportunity?.outcome ? (OUTCOME_LABEL[opportunity.outcome] ?? null) : null;
    if (outcomeWords) {
      const closed = when(opportunity?.closedAtMillis);
      return {
        tone,
        lead: label,
        fact: closed
          ? `${outcomeWords} ${closed}. ${linePhrase}`
          : `${outcomeWords}, but no close time is recorded. ${linePhrase}`,
      };
    }
    return { tone, lead: label, fact: `The customer's decision is outstanding. ${NO_STAGE_TIME}` };
  }

  if (stepKey === "SOLUTION" || stepKey === "QUOTING") {
    return { tone, lead: label, fact: `${linePhrase} ${NO_STAGE_TIME}` };
  }

  // IDENTIFIED and DECISION are handled above; QUALIFYING and CUSTOMER_REVIEW land here. Neither
  // has a stored fact of its own, so the honest answer is the whole answer.
  return { tone, lead: label, fact: NO_STAGE_TIME };
}

// ═════════════════════════════════════════ ATTENTION (NS pattern 3)

export const SEVERITY = Object.freeze({ BLOCKING: "BLOCKING", ATTENTION: "ATTENTION" });

// The plain-language rendering of each reason `deriveAttention` already produces. The KINDS are
// that authority's, not this file's; an unmapped kind still renders, using the reason's own label,
// so a reason added upstream can never silently vanish from the band.
const ATTENTION_FACT = Object.freeze({
  NO_NEXT_ACTION: "No next action is recorded. Nobody knows what happens next on this deal.",
  CLOSE_OVERDUE: "The expected close date has passed.",
});

// ALREADY STATED ONCE, HIGHER UP THE PAGE (NS-P4).
//
// `deriveAttention` raises DECISION_PENDING for exactly one condition — stage === "DECISION" — and
// the record header's state sentence says "Decision — awaiting the customer's decision" for exactly
// the same condition. On this page the two would ALWAYS fire together, so admitting it to the band
// would state one fact twice within a hundred pixels: the deduplication the grammar calls "most of
// the perceived calm".
//
// It stays in `deriveAttention` untouched, because the PIPELINE ROW has no state sentence and there
// the reason is the only thing carrying it. This is a composition rule about one surface, not a
// change to the derivation — which is why it is expressed as a filter here rather than an edit
// there.
const STATED_IN_THE_HEADER = new Set(["DECISION_PENDING"]);

/**
 * THE ATTENTION BLOCK — "renders nothing when clean" (NS pattern 3).
 *
 * ════════════════════ IT DOES NOT RE-DERIVE ════════════════════
 *
 * `deriveAttention` in opportunityLifecycle.js is the existing authority on what needs attention on
 * an Opportunity, and the pipeline already sorts by it. This function CONSUMES it and adds only the
 * facts a record page can state that a table row cannot — it does not compute "overdue" a second
 * time. A second derivation is how two screens come to disagree about one deal.
 *
 * ════════════════════ INFORMATIONAL ITEMS ARE DROPPED, ON PURPOSE ════════════════════
 *
 * `deriveAttention` returns tone "attention" and tone "info"; the only "info" item is "Closing
 * within a week", which is true and is not a call to act. The grammar is explicit that the
 * attention block is not for informational status — "the moment it carries things that are merely
 * true, it stops meaning something needs you". So info-toned items do not enter the band. The fact
 * is not lost: the expected close date is stated in the record header, where it belongs.
 *
 * ════════════════════ THE BLOCKERS COME FROM THE ENGINE'S OWN GUARDS ════════════════════
 *
 * `buildTransitionPatch` refuses WON when there are no lines (NO_LINES) or when any line lacks a
 * positive integer qty (LINE_QTY_REQUIRED_FOR_WON). Those are BLOCKING here because they are
 * blocking there — the page states a refusal the engine will make, rather than inventing a rule of
 * its own or letting a reader discover it by pressing a button.
 *
 * A CLOSED OPPORTUNITY RAISES NOTHING. `deriveAttention` already returns [] for WON/LOST, and the
 * blockers below are gated on the same fact: attention on a closed deal is noise that trains people
 * to ignore the band.
 */
export function opportunityAttention(opportunity, nowMillis = null) {
  if (!opportunity) return [];
  if (opportunity.outcome === "WON" || opportunity.outcome === "LOST") return [];

  const items = [];
  const lines = Array.isArray(opportunity.lines) ? opportunity.lines : [];

  // A qty is a positive integer to the engine, and anything else blocks WON forever — there is no
  // reopen path once a deal closes, and createSalesOrderFromOpportunity fails closed on such a line.
  const qtyless = lines.filter((l) => !(Number.isInteger(l?.qty) && l.qty > 0)).length;

  if (lines.length === 0) {
    items.push({
      key: "no-lines",
      severity: SEVERITY.BLOCKING,
      fact: "This opportunity has no solution lines. It cannot be won until it says what is being sold.",
    });
  } else if (qtyless > 0) {
    items.push({
      key: "line-qty-missing",
      severity: SEVERITY.BLOCKING,
      fact: `${qtyless} solution line${qtyless === 1 ? " carries" : "s carry"} no quantity. A line without a quantity cannot be won, and winning is irreversible.`,
    });
  }

  for (const reason of deriveAttention(opportunity, nowMillis)) {
    if (reason.tone !== "attention") continue; // informational status does not belong here
    if (STATED_IN_THE_HEADER.has(reason.kind)) continue; // one fact, one rendering
    items.push({
      key: reason.kind,
      severity: SEVERITY.ATTENTION,
      fact: ATTENTION_FACT[reason.kind] ?? reason.label,
    });
  }

  return items;
}

// ═════════════════════════════════════════ LINEAGE (NS-P1, R09)

/**
 * The chain edges this Opportunity genuinely has.
 *
 * Same honest-reference contract as families 1 and 2: RESOLVED carries a governed reference,
 * UNRESOLVED means the relationship is real and its reference could not be resolved, ABSENT means
 * there is no relationship. The document id is NEVER returned as a label under any of the three
 * (DECISIONS #106, R03).
 *
 * THE ACCOUNT EDGE IS A NAME rather than a coded reference: an Account's identity is its name, and
 * the read resolves it server-side under the server's authority. UNRESOLVED here is a real and
 * ordinary outcome, not an error — and it still never degrades to the accountId.
 *
 * THE AGREEMENT EDGE IS ALWAYS UNRESOLVED OR ABSENT, exactly as it is on the Sales Order (ND-9):
 * `salesAgreementId` is projected and no read resolves a Sales Agreement to a reference. Naming the
 * entity and stating the absence is the contract; printing the id is the defect the rule forbids.
 */
export const EDGE = Object.freeze({ RESOLVED: "RESOLVED", UNRESOLVED: "UNRESOLVED", ABSENT: "ABSENT" });

const SALES_ORDER_REFERENCE = /^SO-\d{4}-\d{6}$/;

export function opportunityLineage(opportunity) {
  const edges = [];

  const accountId = opportunity?.accountId ?? null;
  const accountName = opportunity?.accountName ?? null;
  if (!accountId) {
    edges.push({ key: "account", label: "Customer", state: EDGE.ABSENT });
  } else if (accountName) {
    edges.push({ key: "account", label: "Customer", state: EDGE.RESOLVED, reference: accountName, targetId: accountId });
  } else {
    edges.push({ key: "account", label: "Customer", state: EDGE.UNRESOLVED, targetId: accountId });
  }

  const salesOrderId = opportunity?.salesOrderId ?? null;
  const salesOrderNumber = opportunity?.salesOrderNumber ?? null;
  if (!salesOrderId) {
    edges.push({ key: "salesOrder", label: "Sales order", state: EDGE.ABSENT });
  } else if (typeof salesOrderNumber === "string" && SALES_ORDER_REFERENCE.test(salesOrderNumber)) {
    edges.push({ key: "salesOrder", label: "Sales order", state: EDGE.RESOLVED, reference: salesOrderNumber, targetId: salesOrderId });
  } else {
    edges.push({ key: "salesOrder", label: "Sales order", state: EDGE.UNRESOLVED, targetId: salesOrderId });
  }

  const agreementId = opportunity?.salesAgreementId ?? null;
  edges.push(
    agreementId
      ? { key: "agreement", label: "Sales agreement", state: EDGE.UNRESOLVED, targetId: agreementId }
      : { key: "agreement", label: "Sales agreement", state: EDGE.ABSENT },
  );

  return edges;
}

/**
 * THE MILESTONE LIST — what the record actually records, and nothing else.
 *
 * Shape matches `workOrderTimeline` and `salesOrderTimeline` so the shared renderer can consume any
 * of the three without knowing which family it is drawing.
 */
export function opportunityTimeline(opportunity) {
  return [
    { key: "created", label: "Opportunity created", at: opportunity?.createdAtMillis ?? null },
    // A REAL lifecycle event, unlike the other two: `closedAt` is written by the outcome transition
    // and by nothing else, so it means what it says. Gated on the outcome as well as on the value,
    // so a stray timestamp on an open record can never present itself as a close.
    {
      key: "closed",
      label: opportunity?.outcome === "WON" ? "Won" : opportunity?.outcome === "LOST" ? "Lost" : "Closed",
      at: opportunity?.outcome ? (opportunity?.closedAtMillis ?? null) : null,
    },
    // NOT a lifecycle event, and labelled so. `updatedAt` moves on ANY write — a stage advance, a
    // field correction, a line edit. Calling it "Last changed" is the whole truth about it.
    { key: "updated", label: "Last changed", at: opportunity?.updatedAtMillis ?? null },
  ].filter((e) => e.at != null);
}

/**
 * The single header derivation — everything the record header states, in one object.
 *
 * Assembled here rather than in the component so that "the state" is one value used by the header,
 * the spine and the attention rules, and cannot drift between them.
 */
export function opportunityHeader(opportunity) {
  if (!opportunity) return null;
  return {
    reference: opportunity.opportunityNumber ?? null,
    // Channel in WORDS. `CHANNEL_LABEL` is the one vocabulary; an unrecognised channel returns null
    // rather than leaking `STRATEGIC_ACCOUNTS` into a sentence (R04).
    channelWords: opportunity.salesChannel ? (CHANNEL_LABEL[opportunity.salesChannel] ?? null) : null,
    stateWords: opportunityStateWords(opportunity),
    stateSentence: opportunityStateSentence(opportunity),
    stateTone: opportunityStateTone(opportunity),
    isClosed: opportunity.outcome === "WON" || opportunity.outcome === "LOST",
    isWon: opportunity.outcome === "WON",
  };
}

/**
 * THE EXPECTED VALUE, RENDERED HONESTLY — a number with no currency, said as such.
 *
 * `expectedValue` is stored as a plain number and the document has NO currency field. Rendering it
 * with a "$" would assert a unit nobody stored, and rendering it as minor units would be worse
 * still: the metadata definition says so in as many words. So the figure is grouped for legibility
 * and carries a title explaining exactly what it is and is not. NULL IS NOT ZERO: an opportunity
 * with no expected value shows no number at all, because a zero would read as a worthless deal
 * rather than an unestimated one.
 *
 * @param formatNumber injected group-formatter, so this file holds no locale knowledge
 */
export function opportunityValueDisplay(opportunity, formatNumber) {
  const value = opportunity?.expectedValue ?? null;
  if (value == null) {
    return { text: null, title: "No expected value has been recorded for this opportunity." };
  }
  const shown = typeof formatNumber === "function" ? formatNumber(value) : String(value);
  return {
    text: `Expected value ${shown}`,
    title: "Stored as a plain number with no currency recorded. It is an estimate entered by the owner, not a quoted or committed price.",
  };
}
