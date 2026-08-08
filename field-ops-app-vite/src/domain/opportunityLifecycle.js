// Sales Opportunity — PURE domain (no I/O; unit-tested). The ratified single commercial lifecycle + a
// pipeline projection + honest attention derivation. Opportunity is PRE-COMMITMENT: nothing here (or
// downstream of it) creates warehouse demand, inventory movement, Work Orders, or invoices. A solution line
// references the PRODUCT/MODEL/PART, never a serialized asset. Domain STATE VOCABULARY maps to the shared
// SEMANTIC TONE (Wave-0) so every surface renders opportunity state consistently.

// Ratified lifecycle (one shared set for National Accounts and Retail — channel is context, not a fork).
export const OPPORTUNITY_STAGES = ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"];
export const OPPORTUNITY_OUTCOMES = ["WON", "LOST"];
export const SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL"];

const STAGE_LABEL = {
  IDENTIFIED: "Identified", QUALIFYING: "Qualifying", SOLUTION: "Solution",
  QUOTING: "Quoting", CUSTOMER_REVIEW: "Customer review", DECISION: "Decision",
};
const OUTCOME_LABEL = { WON: "Won", LOST: "Lost" };
const CHANNEL_LABEL = { NATIONAL_ACCOUNTS: "National Accounts", RETAIL: "Retail" };

export const stageLabel = (s) => STAGE_LABEL[s] ?? s ?? "—";
export const channelLabel = (c) => CHANNEL_LABEL[c] ?? c ?? "—";

// The human commercial-state label + its shared SEMANTIC TONE. Closed opportunities read by outcome; active
// ones by stage (DECISION draws attention — a commitment decision is pending).
export function commercialState(opp) {
  if (opp.outcome === "WON") return { label: OUTCOME_LABEL.WON, tone: "positive", closed: true };
  if (opp.outcome === "LOST") return { label: OUTCOME_LABEL.LOST, tone: "muted", closed: true };
  const tone = opp.stage === "DECISION" ? "attention" : "info";
  return { label: stageLabel(opp.stage), tone, closed: false };
}

const dayMs = 24 * 60 * 60 * 1000;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Honest attention derivation from the fields we actually have (no fabricated CRM signals). An opportunity
// that is closed (WON/LOST) needs no attention. Reasons: no next action; expected close overdue or imminent;
// a decision is pending. Returns [{ kind, tone, label }].
export function deriveAttention(opp, nowMillis) {
  if (opp.outcome === "WON" || opp.outcome === "LOST") return [];
  const out = [];
  if (!opp.nextAction || String(opp.nextAction).trim().length === 0) {
    out.push({ kind: "NO_NEXT_ACTION", tone: "attention", label: "No next action" });
  }
  const close = num(opp.expectedCloseAt);
  if (close != null && nowMillis != null) {
    if (close < nowMillis) out.push({ kind: "CLOSE_OVERDUE", tone: "attention", label: "Expected close is overdue" });
    else if (close - nowMillis <= 7 * dayMs) out.push({ kind: "CLOSE_SOON", tone: "info", label: "Closing within a week" });
  }
  if (opp.stage === "DECISION") out.push({ kind: "DECISION_PENDING", tone: "attention", label: "Awaiting customer decision" });
  return out;
}

// One pipeline row (projection). Customer name is resolved from an injected name map (canonical Account
// authority later); falls back to the opportunity's own snapshot then its accountId — never a raw id shown
// as the primary label if a name is resolvable.
export function buildPipelineRow(opp, { nowMillis = null, accountNameById = {} } = {}) {
  const attention = deriveAttention(opp, nowMillis);
  const worstTone = attention.some((a) => a.tone === "attention") ? "attention" : attention.length ? "info" : null;
  return {
    id: opp.id ?? opp.opportunityId ?? null,
    customerName: accountNameById[opp.accountId] ?? opp.customerName ?? opp.accountId ?? "—",
    accountId: opp.accountId ?? null,
    channel: opp.salesChannel ?? null,
    stage: opp.stage ?? null,
    outcome: opp.outcome ?? null,
    commercial: commercialState(opp),
    expectedValue: num(opp.expectedValue),
    expectedCloseAt: num(opp.expectedCloseAt),
    nextAction: opp.nextAction ?? null,
    need: opp.need ?? null,
    lines: Array.isArray(opp.lines) ? opp.lines : [],
    ownerEmployeeId: opp.ownerEmployeeId ?? null,
    attention,
    attentionTone: worstTone,
  };
}

// Lifecycle TRANSITION graph (read-side mirror of the write authority in functions/src/opportunity/
// opportunityLifecycle.ts — kept in sync so the UI only ever offers actions the governed command will
// accept). Minimal + defensible: advance forward by exactly one stage; LOST from any open stage; WON only
// from DECISION; a closed opportunity offers nothing. This is UI GUIDANCE only — the server re-validates and
// is the authority; no write happens here.
export function nextStage(stage) {
  const i = OPPORTUNITY_STAGES.indexOf(stage);
  return i >= 0 && i < OPPORTUNITY_STAGES.length - 1 ? OPPORTUNITY_STAGES[i + 1] : null;
}

// The legal next actions for an opportunity: { advanceTo: <stage|null>, outcomes: [<WON?>, <LOST?>] }.
export function allowedActions(opp) {
  if (opp?.outcome === "WON" || opp?.outcome === "LOST") return { advanceTo: null, outcomes: [] };
  const stage = opp?.stage;
  return {
    advanceTo: nextStage(stage),
    outcomes: stage === "DECISION" ? ["WON", "LOST"] : ["LOST"],
  };
}

// The pipeline/work-queue view model for the Sales workspace. Active (open) opportunities are the work;
// closed ones are counted but not the queue. Sorted attention-first, then by nearest expected close.
export function buildOpportunityPipeline(opportunities = [], { nowMillis = null, accountNameById = {} } = {}) {
  const rows = opportunities.map((o) => buildPipelineRow(o, { nowMillis, accountNameById }));
  const open = rows.filter((r) => !r.commercial.closed);
  open.sort((a, b) => {
    const aAtt = a.attentionTone === "attention" ? 0 : 1;
    const bAtt = b.attentionTone === "attention" ? 0 : 1;
    if (aAtt !== bAtt) return aAtt - bAtt;
    return (a.expectedCloseAt ?? Infinity) - (b.expectedCloseAt ?? Infinity);
  });
  const stageCounts = {};
  for (const s of OPPORTUNITY_STAGES) stageCounts[s] = open.filter((r) => r.stage === s).length;
  return {
    rows: open,
    all: rows,
    stageCounts,
    counts: {
      open: open.length,
      needsAttention: open.filter((r) => r.attentionTone === "attention").length,
      won: rows.filter((r) => r.outcome === "WON").length,
      lost: rows.filter((r) => r.outcome === "LOST").length,
    },
  };
}
