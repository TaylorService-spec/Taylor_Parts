// EOS completion-semantic gate — provider/process success is NECESSARY but NOT SUFFICIENT for COMPLETE.
//
// The coupled runtime defects #834/#835/#836/#837 all shared one root cause: EOS treated "the Claude process
// exited cleanly with a `result` field" as COMPLETE. This pure classifier derives the terminal status from
// STRUCTURED evidence instead, and is fail-closed: missing or uncertain evidence NEVER yields COMPLETE.
// Worker free-text (`workerClaimsComplete`) may corroborate but is never the sole classifier.

export const COMPLETION_STATES = Object.freeze([
  "COMPLETE",
  "BLOCKED_EXECUTION",         // required execution capability/receipts unavailable (#834)
  "AWAITING_ARTIFACTIZATION",  // implementation exists but the required governed artifact/patch/PR is absent (#835)
  "RETURN_FOR_CORRECTION",     // verifier failed, turn ceiling hit, or criteria not fully evidenced (#836/#837)
  "OWNER_ACTION_REQUIRED",     // an Owner decision gates completion
  "ESCALATE",                  // an unresolvable/contradictory state — hand to a human
]);

// Runtime termination states the wake layer reports. Only NORMAL is eligible for COMPLETE.
export const RUNTIME_TERMINATION = Object.freeze([
  "NORMAL",
  "MAX_TURNS_EXHAUSTED",       // hit the configured (now bounded) turn ceiling
  "TIMEOUT",
  "SPAWN_FAILURE",
  "PROCESS_ERROR",
]);

// Durable artifact classes a task may be REQUIRED to produce before it can be COMPLETE.
export const ARTIFACT_CLASSES = Object.freeze(["NONE", "ANALYSIS_REPORT", "PATCH", "PULL_REQUEST"]);

const deny = (state, reason) => Object.freeze({ state, complete: false, reason });

/**
 * classifyCompletion — the single completion-semantic authority.
 *
 * @param {object} e
 * @param {boolean}  e.processSucceeded          clean exit + parseable result (necessary, not sufficient)
 * @param {string}   [e.runtimeTermination]      RUNTIME_TERMINATION; defaults "NORMAL"
 * @param {boolean|null} [e.executionCapable]    were the required Bash/test/worker capabilities AVAILABLE? (#834)
 * @param {string[]} [e.requiredExecutionReceipts]  receipts this task class REQUIRES (e.g. ["tests","build"])
 * @param {string[]} [e.executionReceipts]       receipts actually present
 * @param {string}   [e.expectedArtifactClass]   ARTIFACT_CLASSES; what durable artifact this task must produce
 * @param {string[]} [e.producedArtifacts]       artifact classes actually produced & durable
 * @param {string|null} [e.verifierResult]       "PASS" | "FAIL" | "REJECT" | null (not run / not required)
 * @param {boolean}  [e.verifierRequired]        whether a PASS verifier is required for COMPLETE
 * @param {boolean}  [e.ownerActionRequired]
 * @param {boolean}  [e.workerClaimsComplete]    corroboration ONLY — never sufficient alone
 * @returns {{state, complete, reason}}
 */
export function classifyCompletion(e = {}) {
  const {
    processSucceeded = false,
    runtimeTermination = "NORMAL",
    executionCapable = null,
    requiredExecutionReceipts = [],
    executionReceipts = [],
    expectedArtifactClass = "NONE",
    producedArtifacts = [],
    verifierResult = null,
    verifierRequired = false,
    ownerActionRequired = false,
  } = e;

  if (!RUNTIME_TERMINATION.includes(runtimeTermination)) {
    return deny("ESCALATE", `unknown runtimeTermination "${runtimeTermination}" — fail closed`);
  }

  // An Owner decision supersedes everything else.
  if (ownerActionRequired) return deny("OWNER_ACTION_REQUIRED", "an Owner decision gates completion");

  // #836/#837: the run hit the configured (now bounded) turn ceiling → fail closed, never COMPLETE.
  if (runtimeTermination === "MAX_TURNS_EXHAUSTED") {
    return deny("RETURN_FOR_CORRECTION", "runtime hit the configured bounded turn ceiling — fail closed, not COMPLETE");
  }
  // Any other abnormal termination is a blocked execution, never completed work.
  if (runtimeTermination !== "NORMAL") {
    return deny("BLOCKED_EXECUTION", `runtime terminated abnormally (${runtimeTermination})`);
  }

  // Provider/process success is necessary.
  if (processSucceeded !== true) {
    return deny("BLOCKED_EXECUTION", "no successful provider/process result");
  }

  // #834: required execution capability was unavailable, or a required receipt is missing → BLOCKED_EXECUTION.
  if (executionCapable === false) {
    return deny("BLOCKED_EXECUTION", "required execution capability (Bash/test/worker) was unavailable");
  }
  const missing = requiredExecutionReceipts.filter((r) => !executionReceipts.includes(r));
  if (missing.length > 0) {
    return deny("BLOCKED_EXECUTION", `required execution receipts missing: ${missing.join(", ")}`);
  }

  // #835: implementation may exist, but the required governed artifact/patch/PR is absent → AWAITING_ARTIFACTIZATION.
  if (expectedArtifactClass !== "NONE" && !producedArtifacts.includes(expectedArtifactClass)) {
    return deny("AWAITING_ARTIFACTIZATION", `expected durable ${expectedArtifactClass} was not produced`);
  }

  // Verifier gate.
  if (verifierResult === "FAIL" || verifierResult === "REJECT") {
    return deny("RETURN_FOR_CORRECTION", `verifier ${verifierResult}`);
  }
  if (verifierRequired && verifierResult !== "PASS") {
    return deny("RETURN_FOR_CORRECTION", "a PASS verifier is required for this task class but none is present");
  }

  // Positive case: process ok + capable + all required receipts + expected artifact durable + verifier not
  // failing (and PASS when required) + NORMAL termination. This is the ONLY path to COMPLETE.
  return Object.freeze({ state: "COMPLETE", complete: true, reason: "all completion criteria + structured evidence satisfied" });
}

// Normalize an intake artifact's optional `execution` block into the completion contract, with SAFE
// fail-closed defaults: absent ⇒ a pure READ_ONLY_ANALYSIS task (no required receipts, no required artifact,
// no verifier) — the only class that may COMPLETE on process success alone. An implementation/patch task must
// declare its expectedArtifactClass / requiredExecutionReceipts, and until it does it can never false-COMPLETE.
export function normalizeExecutionContract(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  return Object.freeze({
    taskClass: typeof r.taskClass === "string" ? r.taskClass : "READ_ONLY_ANALYSIS",
    expectedArtifactClass: ARTIFACT_CLASSES.includes(r.expectedArtifactClass) ? r.expectedArtifactClass : "NONE",
    requiredExecutionReceipts: Array.isArray(r.requiredExecutionReceipts) ? r.requiredExecutionReceipts.filter((x) => typeof x === "string") : [],
    verifierRequired: r.verifierRequired === true,
  });
}

// Map a completion state to the durable intake STATUS_STATE. COMPLETE is the ONLY state that reports COMPLETE.
export function completionStateToStatus(state) {
  switch (state) {
    case "COMPLETE": return "COMPLETE";
    case "OWNER_ACTION_REQUIRED": return "OWNER_REQUIRED";
    case "AWAITING_ARTIFACTIZATION": return "AWAITING_ARTIFACTIZATION";
    case "BLOCKED_EXECUTION": return "BLOCKED_EXECUTION";
    case "RETURN_FOR_CORRECTION": return "CORRECTING";
    case "ESCALATE": return "OWNER_REQUIRED";
    default: return "FAILED"; // fail closed
  }
}
