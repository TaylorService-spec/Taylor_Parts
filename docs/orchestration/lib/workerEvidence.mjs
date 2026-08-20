// Extract a worker's STRUCTURED completion evidence from its free-text result.
//
// WHY THIS EXISTS: `classifyCompletion` decides COMPLETE from `evidence.receipts`. The wake returns the
// worker's output as a STRING (`result: parsed.result` — the `claude -p` envelope's text), so the previous
// `typeof wake.result === "object" && wake.result.evidence` check could never be true. The gate therefore
// demanded receipts that were structurally unreadable, and NO worker could ever complete a task requiring
// them — proven by feeding the real path a worker emitting a perfect evidence block and still getting
// BLOCKED_EXECUTION. This module is the missing receiving end.
//
// It deliberately mirrors findingSchema.extractFindings: one fenced block with a dedicated tag, total and
// fail-closed, and a `found` flag that distinguishes a TRUSTWORTHY extraction from an extraction FAILURE.
// A dedicated `eos-evidence` tag (not a bare ```json fence) means a worker quoting example JSON in its prose
// can never be mistaken for its actual evidence.
//
// Pure: no fs/network/clock. Never throws.

const EVIDENCE_BLOCK = /```eos-evidence\s*\n([\s\S]*?)\n```/;

// The empty, fully fail-closed evidence shape: proves nothing, so the gate blocks exactly as it does today.
const EMPTY = Object.freeze({ receipts: Object.freeze([]), artifacts: Object.freeze([]), executionCapable: null, toolPermissionBlocked: false, verifier: null });

const miss = (reason) => Object.freeze({ found: false, evidence: EMPTY, reason });

const strings = (v) => Object.freeze(Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0) : []);

/**
 * Extract structured completion evidence from a worker's result text.
 *
 *   - no block             → { found:false, evidence:EMPTY, reason:"no eos-evidence block" }
 *   - block but bad JSON   → { found:false, evidence:EMPTY, reason:"invalid JSON in eos-evidence block" }
 *   - block without object → { found:false, evidence:EMPTY, reason:"eos-evidence block must be a JSON object" }
 *   - block parses         → { found:true,  evidence:{...normalized} }
 *
 * A failed extraction returns EMPTY evidence, which the completion gate treats exactly as it treats a silent
 * worker: BLOCKED_EXECUTION. Extraction can therefore only ever ADD provable evidence — it can never loosen
 * the gate, and a malformed block is never read as a clean result.
 *
 * `receipts`/`artifacts` are filtered to non-empty strings, so a malformed entry cannot smuggle in a claim.
 * The gate independently re-validates every receipt against the task's contract afterwards.
 */
export function extractWorkerEvidence(content = "") {
  const text = typeof content === "string" ? content : "";
  const m = EVIDENCE_BLOCK.exec(text);
  if (!m) return miss("no eos-evidence block");

  let parsed;
  try { parsed = JSON.parse(m[1]); }
  catch { return miss("invalid JSON in eos-evidence block"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return miss("eos-evidence block must be a JSON object");

  // Accept either a bare evidence object or one wrapped as { evidence: {...} } — the contract shows the
  // wrapped form, and a worker that emits the inner object alone is being honest in an equivalent way.
  const e = (parsed.evidence && typeof parsed.evidence === "object" && !Array.isArray(parsed.evidence)) ? parsed.evidence : parsed;

  return Object.freeze({
    found: true,
    evidence: Object.freeze({
      receipts: strings(e.receipts),
      artifacts: strings(e.artifacts),
      // Tri-state on purpose: `null` means "the worker did not say", which the gate treats as unproven
      // rather than as a positive claim of capability.
      executionCapable: typeof e.executionCapable === "boolean" ? e.executionCapable : null,
      toolPermissionBlocked: e.toolPermissionBlocked === true,
      verifier: typeof e.verifier === "string" ? e.verifier : null,
    }),
  });
}
