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

// The receipts / durable artifact a resolved execution profile is actually CAPABLE of proving. This is the
// bridge between PRE-execution authorization (what capability the grant carries) and POST-execution proof
// (which receipts a completed worker can present). A task can never be required to prove a receipt its GRANTED
// profile has no capability to produce — that is the #868 deadlock: a READ_ONLY_VERIFY *request* downgraded to
// a READ_ONLY_ANALYSIS *grant* was still required to present a `tests` receipt it was never authorized to run.
// Kept in lock-step with executionProfiles.mjs's per-profile allowlists (READ tools only; VERIFY adds test
// commands; PATCH adds worktree write; INTEGRATION adds branch push + PR).
export const PROFILE_PROVABLE = Object.freeze({
  READ_ONLY_ANALYSIS: Object.freeze({ receipts: Object.freeze([]), artifact: "NONE" }),
  READ_ONLY_VERIFY: Object.freeze({ receipts: Object.freeze(["tests"]), artifact: "NONE" }),
  PATCH_PRODUCER: Object.freeze({ receipts: Object.freeze(["tests"]), artifact: "PATCH" }),
  GOVERNED_INTEGRATION: Object.freeze({ receipts: Object.freeze(["tests"]), artifact: "PULL_REQUEST" }),
});

// Privilege ordering (least → most) for the request-vs-grant comparison below. Local copy (not imported) so the
// pure completion module has no dependency on the profile/wake layer; asserted equal to executionProfiles.mjs's
// PROFILE_RANK by a regression test.
const CONTRACT_PROFILE_RANK = Object.freeze({ READ_ONLY_ANALYSIS: 0, READ_ONLY_VERIFY: 1, PATCH_PRODUCER: 2, GOVERNED_INTEGRATION: 3 });
const MUTATING_CLASSES = Object.freeze(["PATCH_PRODUCER", "GOVERNED_INTEGRATION"]);

/**
 * deriveEffectiveContract — reconcile the REQUESTED completion contract against the RESOLVED (granted) profile.
 *
 * The receipts/artifact/verifier a task must PROVE are a function of the authority it was actually GRANTED to
 * run under, not merely what it requested. This separates PRE-execution authorization (the grant) from
 * POST-execution proof (receipts validated by classifyCompletion AFTER the worker runs).
 *
 * Fail-closed / no-widening / #840-preserving rules:
 *   • A MUTATING request (PATCH_PRODUCER / GOVERNED_INTEGRATION) resolved BELOW its class still fails closed —
 *     its deliverable is a mutation it now cannot produce, so it keeps the FULL requested contract (PATCH +
 *     tests + verifier) and a read-only run can never satisfy it (BLOCKED_EXECUTION / AWAITING_ARTIFACTIZATION,
 *     never COMPLETE). This is exactly the #840 invariant — a downgraded implementation task must NOT collapse
 *     into a completable analysis.
 *   • Otherwise the contract follows the GRANT's provable envelope, intersected with the request: a task proves
 *     only receipts/artifacts its resolved profile can actually run — never MORE (no widening), and never a
 *     receipt it was not authorized to produce (this unblocks the read-only #868/#864 case).
 *
 * @param {object} requested        normalized requested contract (from normalizeExecutionContract)
 * @param {string} resolvedProfile  the GRANTED profile the worker actually ran under (profileDecision.profile)
 * @returns {{taskClass, expectedArtifactClass, requiredExecutionReceipts, verifierRequired, downgradeBlocked}}
 */
export function deriveEffectiveContract({ requested, resolvedProfile } = {}) {
  const req = requested && typeof requested === "object" ? requested : normalizeExecutionContract({});
  const reqClass = req.taskClass || "READ_ONLY_ANALYSIS";
  const resolved = CONTRACT_PROFILE_RANK[resolvedProfile] != null ? resolvedProfile : "READ_ONLY_ANALYSIS";
  const isMutating = MUTATING_CLASSES.includes(reqClass);
  const downgraded = CONTRACT_PROFILE_RANK[resolved] < (CONTRACT_PROFILE_RANK[reqClass] ?? 0);
  const provable = PROFILE_PROVABLE[resolved] || PROFILE_PROVABLE.READ_ONLY_ANALYSIS;

  // The true capability gap: does the request demand a DURABLE MUTATION ARTIFACT (PATCH / PULL_REQUEST) the
  // resolved profile cannot produce? That is the fail-closed line. A demanded mutation artifact the grant can't
  // create means the deliverable is a mutation the read-only run cannot perform — it must NOT collapse into a
  // completable analysis (#834/#835/#840). A request that demands only a RECEIPT (e.g. a READ_ONLY_VERIFY tests
  // receipt) but no durable artifact IS a legitimate read-only subset when downgraded (#864/#868).
  const artifactShortfall = ARTIFACT_CLASSES.indexOf(req.expectedArtifactClass) > ARTIFACT_CLASSES.indexOf(provable.artifact);

  // Preserve #840: keep the FULL requested contract so the read-only run fails closed — it cannot produce the
  // PATCH/receipts it demands. Keyed on the artifact-capability shortfall (real deliverable gap), with the
  // mutating-class check as an explicit belt-and-suspenders for a mutating request resolved below its class.
  if (artifactShortfall || (isMutating && downgraded)) {
    return Object.freeze({
      taskClass: reqClass,
      expectedArtifactClass: req.expectedArtifactClass,
      requiredExecutionReceipts: Object.freeze([...req.requiredExecutionReceipts]),
      verifierRequired: req.verifierRequired,
      downgradeBlocked: true,
    });
  }

  // The grant's provable envelope. Requirements are the request ∩ what the resolved profile can actually run.
  const requiredExecutionReceipts = Object.freeze(req.requiredExecutionReceipts.filter((r) => provable.receipts.includes(r)));
  // Artifact requirement is capped at what the resolved profile can produce (min of requested and provable).
  const expectedArtifactClass =
    ARTIFACT_CLASSES.indexOf(req.expectedArtifactClass) <= ARTIFACT_CLASSES.indexOf(provable.artifact)
      ? req.expectedArtifactClass
      : provable.artifact;
  // A verifier is only meaningfully producible by a profile that can run tests (VERIFY+). Below that, a required
  // verifier would be unsatisfiable — so it is not required of a pure read-only-analysis grant.
  const verifierRequired = req.verifierRequired && provable.receipts.includes("tests");

  return Object.freeze({ taskClass: reqClass, expectedArtifactClass, requiredExecutionReceipts, verifierRequired, downgradeBlocked: false });
}

// Normalize an intake artifact's optional `execution` block into the completion contract, with SAFE
// fail-closed defaults: absent ⇒ a pure READ_ONLY_ANALYSIS task (no required receipts, no required artifact,
// no verifier) — the only class that may COMPLETE on process success alone. An implementation/patch task must
// declare its expectedArtifactClass / requiredExecutionReceipts, and until it does it can never false-COMPLETE.
export function normalizeExecutionContract(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const taskClass = typeof r.taskClass === "string" ? r.taskClass : "READ_ONLY_ANALYSIS";
  // Implementation/patch/integration work carries an automatic completion contract with TEETH: it must
  // produce a durable PATCH, carry test receipts, and pass a verifier — so it can never false-COMPLETE on an
  // ANALYSIS_REPORT even if the intake under-specified the contract (the #840 fix). Explicit fields still win
  // (e.g. a task can require a PULL_REQUEST, or waive the verifier with verifierRequired:false).
  const isImplementation = taskClass === "PATCH_PRODUCER" || taskClass === "GOVERNED_INTEGRATION";
  let expectedArtifactClass = ARTIFACT_CLASSES.includes(r.expectedArtifactClass) ? r.expectedArtifactClass : "NONE";
  if (isImplementation && expectedArtifactClass === "NONE") expectedArtifactClass = "PATCH";
  let requiredExecutionReceipts = Array.isArray(r.requiredExecutionReceipts) ? r.requiredExecutionReceipts.filter((x) => typeof x === "string") : [];
  if (isImplementation && requiredExecutionReceipts.length === 0) requiredExecutionReceipts = ["tests"];
  const verifierRequired = r.verifierRequired === true || (isImplementation && r.verifierRequired !== false);
  return Object.freeze({ taskClass, expectedArtifactClass, requiredExecutionReceipts, verifierRequired });
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
