// Sales Opportunity — PURE domain (no I/O; unit-tested). The ratified single commercial lifecycle + a
// pipeline projection + honest attention derivation. Opportunity is PRE-COMMITMENT: nothing here (or
// downstream of it) creates warehouse demand, inventory movement, Work Orders, or invoices. A solution line
// references the PRODUCT/MODEL/PART, never a serialized asset. Domain STATE VOCABULARY maps to the shared
// SEMANTIC TONE (Wave-0) so every surface renders opportunity state consistently.

// Ratified lifecycle (one shared set for National Accounts and Retail — channel is context, not a fork).
export const OPPORTUNITY_STAGES = ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"];
export const OPPORTUNITY_OUTCOMES = ["WON", "LOST"];
// Commercial Coverage (#15) ratified minimum channels — STRATEGIC_ACCOUNTS added. This list is the seam a
// later increment sources from configurable ref data (docs/assessments/commercial-coverage-territory-authority-
// model.md); channelOptions() (UI select) + the governed write validators read from it, so a value widens both.
export const SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"];

// Exported so the metadata layer sources ONE vocabulary rather than minting a second.
// The Work Order status split (#1141) is what this avoids: labels private to one module
// become labels copied into the next one, and then the two drift.
export const STAGE_LABEL = {
  IDENTIFIED: "Identified", QUALIFYING: "Qualifying", SOLUTION: "Solution",
  QUOTING: "Quoting", CUSTOMER_REVIEW: "Customer review", DECISION: "Decision",
};
export const OUTCOME_LABEL = { WON: "Won", LOST: "Lost" };
export const CHANNEL_LABEL = { NATIONAL_ACCOUNTS: "National Accounts", RETAIL: "Retail", STRATEGIC_ACCOUNTS: "Strategic Accounts" };

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
// authority later), then the opportunity's own snapshot. It does NOT fall back to accountId.
//
// It used to. The comment here read "never a raw id shown as the primary label IF A NAME IS RESOLVABLE",
// and that escape clause was the defect: DECISIONS #106 has no such clause. A missing name is not
// permission to display a record id. This was not hypothetical -- `accountNameById` is `{}` for every
// governed read (mapOpportunityReadResult hard-codes it), and `customerName` only exists on fixtures, so
// real data in this column meant a raw document id in front of a user. Unresolved now renders the em dash,
// which is honest and makes the missing resolution VISIBLE rather than disguising it as a value.
export function buildPipelineRow(opp, { nowMillis = null, accountNameById = {} } = {}) {
  const attention = deriveAttention(opp, nowMillis);
  const worstTone = attention.some((a) => a.tone === "attention") ? "attention" : attention.length ? "info" : null;
  return {
    id: opp.id ?? opp.opportunityId ?? null,
    customerName: accountNameById[opp.accountId] ?? opp.customerName ?? "—",
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
    // The Sales Order back-link (Owner-ratified 2026-08-15: "Preserve Opportunity -> Sales Order
    // lineage visibly"). Was previously written server-side but never projected through to the UI --
    // the exact "coordination invisibility" finding from the gap audit.
    salesOrderId: opp.salesOrderId ?? null,
    // THE VERSION, carried so an edit can prove which copy it started from. updateOpportunity
    // rejects any caller that cannot; without this the governed edit command is unreachable
    // from this surface no matter what else is wired.
    //
    // `?? 0` is the contract, not a fallback dressed up as one: the command reads a missing
    // current version AS 0, so echoing 0 for a record that has none is the honest statement
    // "I loaded the version-less copy" -- and it still fails the check if someone else edits
    // in between, because that write gives the record a real version.
    updatedAtMillis: num(opp.updatedAtMillis) ?? 0,
    // Record timestamps. The Record section rendered "not recorded" for every Opportunity ever
    // shown, because these were never projected -- not because the data was missing.
    createdAt: num(opp.createdAtMillis),
    updatedAt: num(opp.updatedAtMillis),
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

// Chevron progression status for one stage step, relative to an opportunity's current stage.
export const STAGE_PROGRESS_STATUS = Object.freeze({ COMPLETE: "complete", CURRENT: "current", FUTURE: "future" });

// The persistent lifecycle-chevron VIEW MODEL for one opportunity: an ordered stage list (each carrying its
// progression status) plus an optional terminal outcome badge. PURE projection, no React — the presentational
// chevron component (shared/ui/LifecycleChevrons.jsx) knows nothing about Opportunity; this is where the
// Opportunity-specific reading of "which stages are done" lives, kept separate from allowedActions (which
// decides what is LEGAL to click next).
export function stageProgress(opp) {
  const stage = opp?.stage;
  const outcome = opp?.outcome ?? null;
  const reachedIdx = OPPORTUNITY_STAGES.indexOf(stage);
  const stages = OPPORTUNITY_STAGES.map((s, i) => {
    let status;
    if (reachedIdx < 0) status = STAGE_PROGRESS_STATUS.FUTURE;
    else if (i < reachedIdx) status = STAGE_PROGRESS_STATUS.COMPLETE;
    else if (i === reachedIdx) status = outcome != null ? STAGE_PROGRESS_STATUS.COMPLETE : STAGE_PROGRESS_STATUS.CURRENT;
    else status = STAGE_PROGRESS_STATUS.FUTURE;
    return { key: s, label: stageLabel(s), status };
  });
  const terminal =
    outcome === "WON" ? { key: "WON", label: OUTCOME_LABEL.WON, tone: "positive" }
    : outcome === "LOST" ? { key: "LOST", label: OUTCOME_LABEL.LOST, tone: "muted" }
    : null;
  return { stages, terminal };
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
    // The OPERATIONAL queue: open work, attention-first. Unchanged, and still the default.
    rows: open,
    // Every opportunity, closed ones included. Already built and already sorted-into by `rows`;
    // the history views below FILTER this rather than deriving a second pipeline.
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

// ════════════════════ HISTORY IS BROWSEABLE, WITHOUT DILUTING THE QUEUE ════════════════════
//
// THE DEFECT THIS CLOSES. `rows` is open work only, and the table renders `rows`. WON and LOST
// contributed to the summary tiles and to nothing else, so a closed opportunity could not be opened
// at all. In sandbox that meant 0 open / 7 WON / 1 LOST and NO reachable Opportunity detail
// anywhere -- taking the Sales Order lineage link and the Sales Agreement panel down with it.
//
// The fix is a VIEW over facts that already exist. `all` is the same array of the same rows built
// by the same derivation; selecting a view filters it. Nothing here re-derives stage, attention or
// closure, because a second derivation is how two screens come to disagree about one deal.
//
// OPEN STAYS THE DEFAULT. The pipeline is a work queue first; history is somewhere you go.

export const OPPORTUNITY_VIEW = Object.freeze({
  OPEN: "open",
  WON: "won",
  LOST: "lost",
  ALL: "all",
});

export const OPPORTUNITY_VIEW_LABEL = Object.freeze({
  open: "Open",
  won: "Won",
  lost: "Lost",
  all: "All",
});

/** Unknown or absent input resolves to the operational default rather than throwing at a router. */
export function normalizeOpportunityView(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.values(OPPORTUNITY_VIEW).includes(v) ? v : OPPORTUNITY_VIEW.OPEN;
}

/**
 * The rows one view shows, and — when there are none — WHICH emptiness it is.
 *
 * The four empty states are genuinely different facts: a quiet queue, a business that has never won
 * anything, one that has never lost anything, and one with no opportunities at all. Collapsing them
 * into "nothing here" tells a new tenant their data failed to load and tells an established one
 * their pipeline is broken.
 */
export function selectOpportunityView(pipeline, view) {
  const v = normalizeOpportunityView(view);
  const all = pipeline?.all ?? [];
  const rows =
    v === OPPORTUNITY_VIEW.OPEN ? (pipeline?.rows ?? [])
    : v === OPPORTUNITY_VIEW.WON ? all.filter((r) => r.outcome === "WON")
    : v === OPPORTUNITY_VIEW.LOST ? all.filter((r) => r.outcome === "LOST")
    : all;

  // "No opportunities at all" outranks the per-view answer: telling somebody they have no WON deals
  // when they have no deals of any kind describes the wrong problem.
  const emptyReason = rows.length > 0 ? null : all.length === 0 ? "none" : v;
  return { view: v, rows, emptyReason };
}

/** The sentence for an empty view. Exported so the copy is tested rather than inspected. */
export const OPPORTUNITY_EMPTY_TEXT = Object.freeze({
  none: "No opportunities yet.",
  open: "No open opportunities. Switch to Won or Lost to see closed ones.",
  won: "No opportunities have been won yet.",
  lost: "No opportunities have been lost.",
  all: "No opportunities yet.",
});
