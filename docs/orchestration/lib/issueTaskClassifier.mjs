// Issue → execution-contract classification for Owner-authorized EOS issue intake.
//
// The #840 root cause: the Issue→EOS adapter populated NO execution contract, so governed profile resolution
// defaulted to READ_ONLY_ANALYSIS AND the completion gate had no PATCH/receipt requirement to enforce — an
// implementation task that produced only an ANALYSIS_REPORT became COMPLETE. This module deterministically
// derives the REQUESTED task class (a request, never a grant) so the completion contract has teeth, and is
// fail-closed: ambiguous intent → READ_ONLY_ANALYSIS, and GOVERNED_INTEGRATION is NEVER inferred.
//
// Separation of powers (preserves PR #839's two-key model):
//   - THIS module classifies the REQUEST from issue text/labels (producer side — can only ever request).
//   - authorizedProfileFromLabels() reads the GOVERNED grant from a SEPARATE Owner-applied authorization label
//     (authority side). Issue TEXT never grants authority.

import { PROFILE_NAMES, PROFILE_RANK } from "./executionProfiles.mjs";

function normalizeLabels(labels = []) {
  return (Array.isArray(labels) ? labels : [])
    .map((l) => (typeof l === "string" ? l : l && typeof l === "object" ? l.name : ""))
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

// Explicit REQUEST labels (producer-side task class). These REQUEST a class; they never grant authority.
const TASK_LABELS = Object.freeze({
  "eos-task:analysis": "READ_ONLY_ANALYSIS",
  "eos-task:verify": "READ_ONLY_VERIFY",
  "eos-task:implementation": "PATCH_PRODUCER",
});

// GOVERNED grant labels (authority-side). A separate, Owner-applied label — the ONLY way an intake is granted
// more than the least-privilege default. Integration must be BOTH requested and explicitly authorized.
const GRANT_LABELS = Object.freeze({
  "eos-authorize-verify": "READ_ONLY_VERIFY",
  "eos-authorize-patch": "PATCH_PRODUCER",
  "eos-authorize-integration": "GOVERNED_INTEGRATION",
});

// Deterministic keyword signals. Implementation requires a clear code-change verb bound to a code-ish noun
// (so "fix the typo in the README" is NOT implementation); verification is test/reproduce/lint intent.
const IMPL_RE = /\b(implement|implementation|refactor|hotfix|bug ?fix|code[- ]change|rewrite|wire (?:up|in|into)|add (?:a |an |the )?(?:function|method|endpoint|callable|module|field|column|migration|rule|guard|check|test)|create (?:a |an |the )?(?:function|method|endpoint|callable|module|migration|component|rule)|modify (?:the )?(?:code|function|module|callable|rule|logic)|fix (?:the )?(?:bug|regression|defect|error|crash|failure|code|function|logic|rule|test|callable))\b/i;
const VERIFY_RE = /\b(verify|verification|validate the|run (?:the )?tests?|re-?run (?:the )?tests?|test[- ]only|reproduce|confirm (?:the|that)|lint|typecheck|type-check)\b/i;

/** The completion contract implied by a requested task class (fail-closed teeth for implementation work). */
function contractForTaskClass(taskClass) {
  if (taskClass === "PATCH_PRODUCER" || taskClass === "GOVERNED_INTEGRATION") {
    return { taskClass, expectedArtifactClass: "PATCH", requiredExecutionReceipts: ["tests"], verifierRequired: true };
  }
  if (taskClass === "READ_ONLY_VERIFY") {
    return { taskClass, expectedArtifactClass: "NONE", requiredExecutionReceipts: ["tests"], verifierRequired: false };
  }
  return { taskClass: "READ_ONLY_ANALYSIS", expectedArtifactClass: "NONE", requiredExecutionReceipts: [], verifierRequired: false };
}

/**
 * Classify an issue into a REQUESTED execution contract. Priority: explicit `## Execution` `taskClass:` →
 * explicit `eos-task:*` label → keyword heuristic → fail-closed READ_ONLY_ANALYSIS. Never returns
 * GOVERNED_INTEGRATION (integration is never inferred). Returns the contract plus provenance.
 *
 * @returns {{ taskClass, expectedArtifactClass, requiredExecutionReceipts, verifierRequired, signal, ambiguous, reason }}
 */
export function classifyIssueTaskClass({ title = "", body = "", labels = [] } = {}) {
  const labelSet = new Set(normalizeLabels(labels));
  const text = `${title}\n${body}`;

  // 1. Explicit `## Execution` section declaration: `taskClass: PATCH_PRODUCER`.
  const declared = /(?:^|\n)\s*taskClass\s*:\s*([A-Z_]+)/i.exec(text);
  if (declared) {
    const name = declared[1].toUpperCase();
    if (PROFILE_NAMES.includes(name) && name !== "GOVERNED_INTEGRATION") {
      return finalize(contractForTaskClass(name), "EXPLICIT_DECLARATION", false, `issue declared taskClass ${name}`);
    }
    if (name === "GOVERNED_INTEGRATION") {
      // Integration is never selected via producer declaration — fall through to least privilege.
      return finalize(contractForTaskClass("READ_ONLY_ANALYSIS"), "FAIL_CLOSED", true, "GOVERNED_INTEGRATION is never inferred/requested via issue text");
    }
    // Unknown declared class → fail closed.
    return finalize(contractForTaskClass("READ_ONLY_ANALYSIS"), "FAIL_CLOSED", true, `unknown declared taskClass "${name}" — fail closed`);
  }

  // 2. Explicit request label.
  for (const [label, taskClass] of Object.entries(TASK_LABELS)) {
    if (labelSet.has(label)) return finalize(contractForTaskClass(taskClass), "EXPLICIT_LABEL", false, `label ${label}`);
  }

  // 3. Keyword heuristic (implementation before verify; both before the analysis default).
  if (IMPL_RE.test(text)) return finalize(contractForTaskClass("PATCH_PRODUCER"), "KEYWORD_IMPLEMENTATION", false, "implementation/fix/build/code-change intent detected");
  if (VERIFY_RE.test(text)) return finalize(contractForTaskClass("READ_ONLY_VERIFY"), "KEYWORD_VERIFY", false, "verification/test-only intent detected");

  // 4. Fail-closed default: ambiguous or analysis/design/read-only → READ_ONLY_ANALYSIS.
  return finalize(contractForTaskClass("READ_ONLY_ANALYSIS"), "DEFAULT_LEAST_PRIVILEGE", true, "no clear implementation/verify signal — default to least privilege");
}

function finalize(contract, signal, ambiguous, reason) {
  return Object.freeze({ ...contract, signal, ambiguous, reason });
}

/**
 * The GOVERNED grant derived from Owner-applied authorization labels (authority side). Default is the
 * least-privilege READ_ONLY_ANALYSIS — a higher profile is granted ONLY by an explicit `eos-authorize-*`
 * label. Issue TEXT never contributes here. Returns the highest granted profile present.
 */
export function authorizedProfileFromLabels(labels = []) {
  const set = new Set(normalizeLabels(labels));
  let best = "READ_ONLY_ANALYSIS";
  for (const [label, profile] of Object.entries(GRANT_LABELS)) {
    if (set.has(label) && PROFILE_RANK[profile] > PROFILE_RANK[best]) best = profile;
  }
  return best;
}
