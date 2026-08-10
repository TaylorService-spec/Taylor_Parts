// Claude↔ChatGPT exchange ledger (compact, NOT a transcript store).
//
// Owner principle: durable exchange prioritizes the CONCLUSION + rationale + pointers, not the
// conversation. Each record captures the request/question, context REFERENCES (not pasted
// context), each AI's position, evidence references, a verdict, a durable conclusion,
// responsibility, the Owner requirement it serves, disposition, and provenance. Detailed
// conversation may be REFERENCED as evidence, never inlined wholesale.
//
// TODAY these exchanges are Owner-relayed (the Owner is the Claude↔ChatGPT conduit); the live
// bridge remains a FUTURE_SEAM. `ownerRelayed` records that honestly — an exchange that
// required Owner copy/paste is a context/orchestration defect to drive toward zero, not hidden.
//
// Pure: schema + validation + projection. No I/O, no clock.

// Verdicts an exchange can carry (superset of REVIEW_VERDICTS with EVIDENCE_REQUIRED).
export const EXCHANGE_VERDICTS = Object.freeze([
  "CONCUR", "CONCUR_WITH_CORRECTION", "NONCONCUR_ESCALATE", "EVIDENCE_REQUIRED", "NEEDS_OWNER", "AUTO_RESOLVED",
]);
export const EXCHANGE_DISPOSITIONS = Object.freeze(["OPEN", "RESOLVED", "ESCALATED", "SUPERSEDED"]);

const DEFAULTS = Object.freeze({
  direction: "CLAUDE_TO_CHATGPT", contextRefs: [], evidenceRefs: [], claudePosition: null,
  chatgptPosition: null, verdict: null, conclusion: null, responsibility: null,
  ownerRequirement: null, disposition: "OPEN", ownerRelayed: true, provenance: null,
});

export function createAiExchange(input = {}) {
  const e = { ...DEFAULTS, ...input };
  e.contextRefs = [...(e.contextRefs || [])];
  e.evidenceRefs = [...(e.evidenceRefs || [])];
  return Object.freeze(e);
}

export function validateAiExchange(e) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  need(!!e.exchangeId, "exchangeId is required");
  need(!!e.question, "question is required (the request the exchange resolves)");
  need(e.verdict == null || EXCHANGE_VERDICTS.includes(e.verdict), `verdict, when present, must be one of ${EXCHANGE_VERDICTS.join("/")}`);
  need(EXCHANGE_DISPOSITIONS.includes(e.disposition), `disposition must be one of ${EXCHANGE_DISPOSITIONS.join("/")}`);
  need(typeof e.ownerRelayed === "boolean", "ownerRelayed must be boolean (relayed exchanges are a context defect to reduce, tracked honestly)");
  // Guard the "compact, not a transcript" principle: positions are summaries, not dumps.
  const tooLong = (s) => typeof s === "string" && s.length > 1200;
  need(!tooLong(e.claudePosition) && !tooLong(e.chatgptPosition), "positions must be COMPACT summaries (reference the transcript as evidence, do not inline it)");
  return errors;
}

/**
 * Project AI-governance from the exchange ledger. Available only when real exchanges exist;
 * otherwise the caller keeps the honest {available:false} gap. Counts by verdict + awaiting +
 * Owner-relay + the invariant authorityExpansions:0. Records are the compact exchanges, never
 * transcripts.
 */
export function projectAiGovernance(exchanges = [], { ownerRelayCount = null } = {}) {
  const list = exchanges || [];
  if (list.length === 0) {
    return { available: false, reason: "no Claude↔ChatGPT exchange records yet.", ownerRelayCount };
  }
  const byVerdict = {};
  for (const v of EXCHANGE_VERDICTS) byVerdict[v] = 0;
  let awaiting = 0, relayed = 0;
  for (const e of list) {
    if (e.verdict && byVerdict[e.verdict] != null) byVerdict[e.verdict]++;
    if (!e.verdict || e.disposition === "OPEN") awaiting++;
    if (e.ownerRelayed) relayed++;
  }
  return {
    available: true,
    total: list.length,
    byVerdict,
    awaiting,
    ownerRelayedCount: relayed, // exchanges that still required the Owner as conduit (drive → 0)
    ownerRelayCount,
    authorityExpansions: 0,     // MUST remain 0 — governance evidence, not a cosmetic number
    exchanges: list.map((e) => ({
      exchangeId: e.exchangeId, direction: e.direction, question: e.question,
      verdict: e.verdict ?? null, disposition: e.disposition, conclusion: e.conclusion ?? null,
      ownerRelayed: e.ownerRelayed, contextRefs: e.contextRefs, evidenceRefs: e.evidenceRefs,
    })),
  };
}
