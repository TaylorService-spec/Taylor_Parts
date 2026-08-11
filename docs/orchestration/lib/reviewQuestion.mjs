// Narrow-question + compact-result contract. A normal review result is tiny: { verdict, findingRefs }.
// Findings ride as REFERENCES to durable finding artifacts, not a large narrative response. Verdict
// vocabulary is deliberately narrow. Pure; fail-closed on a malformed result.

export const REVIEW_QUESTION_VERDICTS = Object.freeze(["YES", "NO", "EVIDENCE_REQUIRED", "OWNER_REQUIRED"]);

/** A narrow question the paid API answers with one verdict. `ask` is a single decision, not an essay. */
export function makeNarrowQuestion({ questionId, ask, verdictVocab = REVIEW_QUESTION_VERDICTS } = {}) {
  if (!questionId) throw new Error("makeNarrowQuestion: questionId required");
  if (!ask || typeof ask !== "string") throw new Error("makeNarrowQuestion: a single-decision `ask` string is required");
  return Object.freeze({ questionId, ask, verdictVocab: [...verdictVocab] });
}

/**
 * Normalize + validate a compact provider result. Shape: { verdict ∈ vocab, findingRefs: [artifactRef] }.
 * Anything else the model returns is dropped; an unknown/missing verdict FAILS CLOSED (never a default pass).
 * @returns {{ ok:true, result } | { ok:false, failureKind:"MALFORMED_RESULT", reason }}
 */
export function structureCompactResult(raw = {}, { verdictVocab = REVIEW_QUESTION_VERDICTS } = {}) {
  if (!raw || typeof raw !== "object") return { ok: false, failureKind: "MALFORMED_RESULT", reason: "no result body" };
  if (!verdictVocab.includes(raw.verdict)) return { ok: false, failureKind: "MALFORMED_RESULT", reason: `verdict must be one of ${verdictVocab.join("/")}` };
  const findingRefs = Array.isArray(raw.findingRefs)
    ? raw.findingRefs.filter((r) => r && typeof r.sha256 === "string" && typeof r.artifactId === "string")
    : [];
  return { ok: true, result: Object.freeze({ verdict: raw.verdict, findingRefs }) };
}

/** Map a narrow verdict to the loop's disposition — YES=consumable pass, NO/EVIDENCE_REQUIRED=work, OWNER=gate. */
export function verdictDisposition(verdict) {
  switch (verdict) {
    case "YES": return { pass: true, disposition: "CONSUMED", ownerGate: false, needsWork: false };
    case "NO": return { pass: false, disposition: "NEEDS_WORK", ownerGate: false, needsWork: true };
    case "EVIDENCE_REQUIRED": return { pass: false, disposition: "EVIDENCE_REQUIRED", ownerGate: false, needsWork: true };
    case "OWNER_REQUIRED": return { pass: false, disposition: "NEEDS_OWNER", ownerGate: true, needsWork: false };
    default: return { pass: false, disposition: "HELD", ownerGate: false, needsWork: false };
  }
}
