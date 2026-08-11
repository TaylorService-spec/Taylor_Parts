// Fact-based GPT feed — the minimizer that keeps paid API context small. "DO NOT SEARCH WHEN YOU CAN
// ADDRESS. DO NOT RESEND WHEN YOU CAN REFERENCE." Claude spends SUBSCRIPTION tokens on discovery and
// produces classified FACTS; only the minimal set necessary for independent judgment enters the paid
// API context, as compact statements + artifact references (never whole files, transcripts, or the
// operating model). Pure — token estimates are labeled estimates, never fabricated.

const estTokens = (s) => Math.ceil((typeof s === "string" ? s : JSON.stringify(s || "")).length / 4);

// Provenance tier of a fact. GPT may rely on DETERMINISTIC/SOURCE for material decisions; it must NOT be
// asked to trust CLAUDE_ANALYSIS alone for a material decision (analysis needs a deterministic/source anchor).
export const FACT_KINDS = Object.freeze(["DETERMINISTIC_FACT", "SOURCE_FACT", "CLAUDE_ANALYSIS"]);

// The seven token categories the benchmark accounts for.
export const FEED_CATEGORIES = Object.freeze(["protocol", "question", "facts", "authority", "deterministicEvidence", "rawSource", "provenance"]);

/**
 * A single fact for the feed. `materialDecision` answers the required filter: "what review decision could
 * become incorrect if this fact were omitted?" — a fact with no material answer is excluded by minimize().
 * `ref` optionally points at a durable artifact carrying the substance (so the feed sends a reference).
 */
export function makeFact({ kind, statement, materialDecision = null, ref = null, category = "facts" } = {}) {
  if (!FACT_KINDS.includes(kind)) throw new Error(`makeFact: unknown kind ${kind}`);
  if (!FEED_CATEGORIES.includes(category)) throw new Error(`makeFact: unknown category ${category}`);
  return Object.freeze({ kind, statement: String(statement || ""), materialDecision: materialDecision || null, ref: ref || null, category });
}

/**
 * Keep only facts that are material (change some review decision if omitted). Drops non-material facts and
 * flags any material decision that rests on CLAUDE_ANALYSIS with no DETERMINISTIC/SOURCE anchor.
 * @returns {{ kept, excluded, unanchoredAnalysis }}
 */
export function minimizeFacts(facts = []) {
  const kept = [];
  const excluded = [];
  for (const f of facts || []) {
    if (!f.materialDecision) { excluded.push({ statement: f.statement, reason: "no material decision would change if omitted" }); continue; }
    kept.push(f);
  }
  // A material decision supported ONLY by analysis (no deterministic/source fact sharing that decision) is
  // flagged — GPT should not be asked to trust it alone.
  const anchored = new Set(kept.filter((f) => f.kind !== "CLAUDE_ANALYSIS").map((f) => f.materialDecision));
  const unanchoredAnalysis = kept.filter((f) => f.kind === "CLAUDE_ANALYSIS" && !anchored.has(f.materialDecision))
    .map((f) => ({ statement: f.statement, materialDecision: f.materialDecision }));
  return { kept, excluded, unanchoredAnalysis };
}

/**
 * Build the compact paid-API feed: a narrow question + the minimized facts (statement or reference) +
 * artifact references. Excludes by construction: whole files, transcripts, the operating model, unchanged
 * authority, and process narrative. Returns the feed + a per-category token breakdown estimate.
 */
export function buildFactFeed({ questionId, ask, verdictVocab = ["YES", "NO", "EVIDENCE_REQUIRED", "OWNER_REQUIRED"], facts = [], authorityRefs = [], provenance = null, protocolVersion = "review-feed/1.0.0" } = {}) {
  const { kept, excluded, unanchoredAnalysis } = minimizeFacts(facts);
  // A fact rides as a reference when it has a durable artifact ref; else as a compact statement.
  const factLines = kept.map((f) => (f.ref ? { kind: f.kind, ref: f.ref } : { kind: f.kind, statement: f.statement }));
  const feed = {
    protocol: protocolVersion,
    question: { questionId, ask, verdictVocab },
    facts: factLines,
    authority: authorityRefs,     // references to unchanged authority artifacts, not the authority text
    provenance,
  };
  const breakdown = {
    protocol: estTokens(feed.protocol),
    question: estTokens(feed.question),
    facts: estTokens(kept.filter((f) => !f.ref).map((f) => f.statement).join("\n")),
    authority: estTokens(authorityRefs),
    deterministicEvidence: estTokens(kept.filter((f) => f.kind === "DETERMINISTIC_FACT").map((f) => f.statement).join("\n")),
    rawSource: estTokens(kept.filter((f) => f.category === "rawSource").map((f) => f.statement).join("\n")),
    provenance: estTokens(provenance),
  };
  breakdown.totalEstimate = FEED_CATEGORIES.reduce((s, c) => s + (breakdown[c] || 0), 0);
  return { feed, breakdown, excludedCount: excluded.length, excluded, unanchoredAnalysis };
}

export { estTokens as estimateFeedTokens };
