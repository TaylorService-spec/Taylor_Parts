// Canonical FACT-BASED review invocation — the single payload builder both DRY and LIVE consume for an
// ordinary bounded app-level review. "Facts travel, story stays home": the paid API receives a narrow
// QUESTION + concise REQUIREMENT + IMPLEMENTATION/SOURCE FACTS + DETERMINISTIC EVIDENCE + small RAW
// excerpts + PROVENANCE — NOT the full operating model, not the whole diff, not transcripts.
//
// This exists because the legacy live path (openaiReviewProvider.buildReviewInvocation) inlines the
// ENTIRE governing-authority document (~4.9k tok) plus the FULL diff (~2.7k tok). That builder stays for
// review classes that legitimately need expanded context; ordinary bounded reviews route through HERE.
//
// The token accounting is computed over the EXACT strings that become the transmitted messages, plus the
// structured-output schema, so the per-category breakdown reconciles with the provider's measured input
// tokens. Pure; zero-dependency beyond the shared token estimator and the content-addressed hash.

import { estTokens } from "./openaiReviewProvider.mjs";
import { FEED_CATEGORIES } from "./reviewFacts.mjs";

// The independent-reviewer instruction. Identical intent to the legacy builder's system text — the
// reviewer authorizes nothing and returns only the structured result.
export const REVIEW_SYSTEM_TEXT =
  "You are an INDEPENDENT architecture/check-and-balance reviewer for EOS. Reason only about correctness, " +
  "independence, and governance. You do NOT authorize anything; a protected action is never yours to approve. " +
  "Judge ONLY from the facts, requirement, evidence, and excerpts provided. Return ONLY the structured result fields requested.";

const RETURN_INSTRUCTION =
  "Return fields: verdict (CONCUR|CONCUR_WITH_CORRECTION|NONCONCUR_ESCALATE|EVIDENCE_REQUIRED|NEEDS_OWNER), " +
  "conclusion, corrections[], evidenceRefs[], ownerDecisionRequired(bool).";

const asLines = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter(Boolean);
const refLine = (r) => `- ${r.artifactId || r.id || "artifact"}${r.sha256 ? ` @${String(r.sha256).slice(0, 12)}` : ""}`;

/**
 * The ONE canonical review feed object. Every field is a compact fact list or a small excerpt — never a
 * whole file. artifactRefs are content-addressed references (identity only), never inlined substance.
 */
export function buildCanonicalReviewFeed({
  reviewId,
  question = "",
  requirement = "",
  implementationFacts = [],
  sourceFacts = [],
  deterministicEvidence = [],
  rawEvidence = [],
  provenance = null,
  artifactRefs = [],
} = {}) {
  if (!reviewId) throw new Error("buildCanonicalReviewFeed: reviewId required");
  if (!question) throw new Error("buildCanonicalReviewFeed: a narrow question is required");
  return Object.freeze({
    reviewId,
    question: String(question),
    requirement: String(requirement || ""),
    implementationFacts: asLines(implementationFacts),
    sourceFacts: asLines(sourceFacts),
    deterministicEvidence: asLines(deterministicEvidence),
    rawEvidence: asLines(rawEvidence),
    provenance: provenance || null,
    artifactRefs: [...artifactRefs],
  });
}

// The ordered user-message sections, each mapped to a benchmark token category. Rendering a section to ""
// (empty) means it contributes no tokens — an honest zero, not a hidden cost.
function feedSections(feed) {
  const provText = feed.provenance ? `Provenance: ${JSON.stringify(feed.provenance)}` : "";
  const refText = feed.artifactRefs.length ? `Artifact references:\n${feed.artifactRefs.map(refLine).join("\n")}` : "";
  return [
    { category: "question", text: `QUESTION (one independent decision): ${feed.question}` },
    { category: "facts", text: feed.requirement ? `REQUIREMENT (expected behavior): ${feed.requirement}` : "" },
    { category: "facts", text: feed.implementationFacts.length ? `IMPLEMENTATION FACTS (what changed):\n${feed.implementationFacts.map((s) => `- ${s}`).join("\n")}` : "" },
    { category: "authority", text: feed.sourceFacts.length ? `SOURCE FACTS (material authority only):\n${feed.sourceFacts.map((s) => `- ${s}`).join("\n")}` : "" },
    { category: "deterministicEvidence", text: feed.deterministicEvidence.length ? `DETERMINISTIC EVIDENCE (test/CI outcomes):\n${feed.deterministicEvidence.map((s) => `- ${s}`).join("\n")}` : "" },
    { category: "rawSource", text: feed.rawEvidence.length ? `RAW EVIDENCE (minimal excerpts only):\n${feed.rawEvidence.join("\n\n")}` : "" },
    { category: "provenance", text: [provText, refText].filter(Boolean).join("\n") },
  ];
}

/**
 * Assemble the user message from the canonical feed. Returns the text AND the per-section pieces, so the
 * token breakdown is computed from the SAME strings that are transmitted (no pre-transform measurement).
 */
export function assembleFactUserText(feed) {
  const sections = feedSections(feed).filter((s) => s.text);
  return { text: sections.map((s) => s.text).join("\n\n"), sections };
}

/**
 * Build the fact-based invocation from the canonical feed. The returned `invocation` is the EXACT object
 * transmitted (dry inspects it; live sends it). `breakdown` accounts every token category, including the
 * structured-output schema, computed over the transmitted strings — so it reconciles with the measured
 * input tokens rather than reporting zeros.
 * @returns {{ ok:true, invocation, breakdown } | { ok:false, reason }}
 */
export function buildFactBasedInvocation({ feed, model, schema = null, maxOutputTokens = 1500 } = {}) {
  if (!feed || !feed.reviewId) return { ok: false, reason: "buildFactBasedInvocation: a canonical feed is required" };
  if (!model) return { ok: false, reason: "buildFactBasedInvocation: a concrete model is required" };

  const { text: userText, sections } = assembleFactUserText(feed);
  const system = REVIEW_SYSTEM_TEXT;
  const user = `${userText}\n\n${RETURN_INSTRUCTION}`;
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];

  // Per-category token estimate over the SAME strings that are transmitted. protocol = system + the
  // return instruction (framing that is neither a fact nor the question).
  const breakdown = Object.fromEntries(FEED_CATEGORIES.map((c) => [c, 0]));
  breakdown.protocol = estTokens(system) + estTokens(RETURN_INSTRUCTION);
  for (const s of sections) breakdown[s.category] += estTokens(s.text);
  const schemaTokens = schema ? estTokens(JSON.stringify(schema)) : 0;
  breakdown.structuredOutputSchema = schemaTokens;
  breakdown.totalEstimate = FEED_CATEGORIES.reduce((n, c) => n + breakdown[c], 0) + schemaTokens;

  // The messages-only estimate (what buildReviewInvocation reports as inputTokensEstimate). The full
  // input to the provider is messages + schema, tracked as breakdown.totalEstimate.
  const inputTokensEstimate = estTokens(system) + estTokens(user);

  return {
    ok: true,
    invocation: {
      model,
      messages,
      maxOutputTokens,
      responseFormat: "structured_review_result",
      feedMode: "FACT_BASED",
      inputTokensEstimate,
      schemaTokens,
      // A SAFE section map (names + sizes only, never a content dump) for diagnostics/reconciliation.
      sectionBreakdown: sections.map((s) => ({ category: s.category, tokens: estTokens(s.text), bytes: Buffer.byteLength(s.text, "utf8") }))
        .concat([{ category: "protocol", tokens: breakdown.protocol, bytes: Buffer.byteLength(system + RETURN_INSTRUCTION, "utf8") }])
        .concat(schemaTokens ? [{ category: "structuredOutputSchema", tokens: schemaTokens, bytes: Buffer.byteLength(JSON.stringify(schema), "utf8") }] : []),
      artifactRefs: feed.artifactRefs.map((r) => ({ artifactId: r.artifactId || null, sha256: r.sha256 || null })),
    },
    breakdown,
  };
}

/**
 * SAFE diagnostic of the final request — never a key, header, or content dump. Answers "what exact
 * sections made up the input tokens?" with names + byte/token sizes + the artifact refs contributing.
 */
export function describeInvocation(invocation, { endpoint = "https://api.openai.com/v1/responses" } = {}) {
  if (!invocation) return { ok: false, reason: "no invocation" };
  const totalTokens = (invocation.sectionBreakdown || []).reduce((n, s) => n + (s.tokens || 0), 0);
  return {
    ok: true,
    model: invocation.model,
    endpoint,
    feedMode: invocation.feedMode || "UNKNOWN",
    sections: invocation.sectionBreakdown || [],
    schemaTokens: invocation.schemaTokens || 0,
    messagesTokenEstimate: invocation.inputTokensEstimate,
    totalRequestTokenEstimate: totalTokens,
    artifactRefs: invocation.artifactRefs || [],
    // Explicitly NO messages content, NO key, NO headers.
    note: "safe diagnostic — sizes + refs only; no key, headers, message content, or reasoning",
  };
}

/**
 * Reconcile the estimated category total against the provider's measured input tokens. char/4 is a coarse
 * estimator and the provider adds per-message overhead, so exact equality is not expected — a ratio inside
 * `tolerance` is a pass. Documents WHY when it is outside.
 * @returns {{ withinTolerance, ratio, delta, tolerance, note }}
 */
export function reconcileTokens({ estimatedTotal = 0, measuredInputTokens = 0, tolerance = 0.35 } = {}) {
  if (!measuredInputTokens) return { withinTolerance: null, ratio: null, delta: null, tolerance, note: "no measured tokens (dry-run / not yet invoked)" };
  const ratio = estimatedTotal / measuredInputTokens;
  const withinTolerance = Math.abs(1 - ratio) <= tolerance;
  return {
    withinTolerance,
    ratio: Math.round(ratio * 1000) / 1000,
    delta: estimatedTotal - measuredInputTokens,
    tolerance,
    note: withinTolerance
      ? "estimate reconciles with measured input within tolerance (char/4 estimate + provider per-message overhead)"
      : "estimate diverges from measured beyond tolerance — investigate the transmitted payload before trusting the breakdown",
  };
}
