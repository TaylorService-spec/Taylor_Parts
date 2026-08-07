// Sales Opportunity — PURE lifecycle authority (framework-independent; unit-tested). This is the WRITE-side
// authority for the ratified Opportunity lifecycle; the field-ops domain/opportunityLifecycle.js mirrors the
// SAME stage vocabulary for read/UI affordance, but this module is where legal transitions are decided for a
// governed write. No Firestore, no firebase-functions imports here.
//
// Ratified single lifecycle (both channels): IDENTIFIED -> QUALIFYING -> SOLUTION -> QUOTING ->
// CUSTOMER_REVIEW -> DECISION -> (WON | LOST). Opportunity is PRE-COMMITMENT: nothing here creates inventory
// movement, warehouse demand, Work Orders, or invoices. Solution lines reference PRODUCT/MODEL/PART, never a
// serialized Equipment asset (serialized allocation happens downstream of WON -> Sales Order -> fulfillment).

export const OPPORTUNITY_STAGES = [
  "IDENTIFIED",
  "QUALIFYING",
  "SOLUTION",
  "QUOTING",
  "CUSTOMER_REVIEW",
  "DECISION",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_OUTCOMES = ["WON", "LOST"] as const;
export type OpportunityOutcome = (typeof OPPORTUNITY_OUTCOMES)[number];

export const SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

// Solution line kinds — product-level commercial intent ONLY. A serialized Equipment asset is deliberately
// NOT a valid line kind (that identity is assigned during fulfillment, not while selling).
export const OPPORTUNITY_LINE_KINDS = ["EQUIPMENT_MODEL", "PART", "SERVICE"] as const;
export type OpportunityLineKind = (typeof OPPORTUNITY_LINE_KINDS)[number];

export function isStage(v: unknown): v is OpportunityStage {
  return typeof v === "string" && (OPPORTUNITY_STAGES as readonly string[]).includes(v);
}
export function isOutcome(v: unknown): v is OpportunityOutcome {
  return typeof v === "string" && (OPPORTUNITY_OUTCOMES as readonly string[]).includes(v);
}
export function isChannel(v: unknown): v is SalesChannel {
  return typeof v === "string" && (SALES_CHANNELS as readonly string[]).includes(v);
}

// The MINIMAL, defensible transition graph (kept intentionally small — reopening/reversing a closed
// opportunity, or skipping stages, are lifecycle-CHANGE decisions that require a new Owner decision, so they
// are NOT permitted here):
//   - advance forward by EXACTLY one stage (IDENTIFIED->QUALIFYING->...->DECISION);
//   - LOST may be set from ANY open stage (a deal can be lost at any point);
//   - WON may be set ONLY from DECISION (a commitment follows a decision);
//   - a closed opportunity (WON|LOST) accepts NO further transition.
export function nextStage(stage: OpportunityStage): OpportunityStage | null {
  const i = OPPORTUNITY_STAGES.indexOf(stage);
  return i >= 0 && i < OPPORTUNITY_STAGES.length - 1 ? OPPORTUNITY_STAGES[i + 1] : null;
}

export interface OpportunityTransitionState {
  stage: OpportunityStage;
  outcome?: OpportunityOutcome | null;
}

export type TransitionIntent =
  | { kind: "ADVANCE"; toStage: OpportunityStage }
  | { kind: "OUTCOME"; outcome: OpportunityOutcome };

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: "ALREADY_CLOSED" | "ILLEGAL_TRANSITION" | "OUTCOME_REQUIRES_DECISION" | "INVALID" };

// Pure legality check for a single transition. Returns a discriminated result; the command/callable maps the
// code to an error. Never throws.
export function checkTransition(state: OpportunityTransitionState, intent: TransitionIntent): TransitionCheck {
  if (!isStage(state.stage)) return { ok: false, code: "INVALID" };
  if (state.outcome === "WON" || state.outcome === "LOST") return { ok: false, code: "ALREADY_CLOSED" };

  if (intent.kind === "ADVANCE") {
    if (!isStage(intent.toStage)) return { ok: false, code: "INVALID" };
    const expected = nextStage(state.stage);
    if (expected === null || intent.toStage !== expected) return { ok: false, code: "ILLEGAL_TRANSITION" };
    return { ok: true };
  }
  if (intent.kind === "OUTCOME") {
    if (!isOutcome(intent.outcome)) return { ok: false, code: "INVALID" };
    if (intent.outcome === "LOST") return { ok: true }; // lost from any open stage
    // WON requires being at DECISION
    if (state.stage !== "DECISION") return { ok: false, code: "OUTCOME_REQUIRES_DECISION" };
    return { ok: true };
  }
  return { ok: false, code: "INVALID" };
}
