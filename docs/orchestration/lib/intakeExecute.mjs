// Intake EXECUTION driver — carries an EXECUTION_AUTHORIZED intake through the EXISTING Wake Supervisor to
// content-addressed result persistence and a COMPLETE status, with no second execution mechanism. It is the
// bridge between the intake ingress (#792) and the guarded wake (executeWake): resolve is already done; this
// applies the fail-closed gates, wakes ONE worker via the injected Wake Supervisor, and turns the worker's
// output into the existing content-addressed result + a COMPLETE status carrying the resultRef.
//
// Fail-closed order (spawns ZERO until all pass):
//   intake-state gate (only EXECUTION_AUTHORIZED + independent AUTHORIZED + no protected boundary) →
//   capability seam (paid capability must be AVAILABLE; no broker ⇒ BLOCKED, never a fabricated result) →
//   executeWake (the existing readiness/provenance/context/model/lease/spawn gates) →
//   content-addressed result + COMPLETE status.
//
// Pure except for injected I/O: processRunner, lease, and contextPackageFn are injected (a mock worker in
// tests; the real guarded spawn in the runtime). No live model call happens here.

import { intakeToWorkItem, buildContentAddressedResult } from "./workIntake.mjs";
import { executeWake } from "./wakeExecute.mjs";
import { assessIntakeExecution, assessCapability } from "./intakeIngress.mjs";
import { buildIntakeStatus, buildResultIndex, buildReviewReady } from "./intakeStatus.mjs";
import { createCostCapacityTelemetry } from "./costCapacity.mjs";
import { classifyCompletion, completionStateToStatus, normalizeExecutionContract, deriveEffectiveContract } from "./completionSemantics.mjs";
import { resolveExecutionProfile } from "./executionProfiles.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function statusFor({ artifact, state, currentWork, activeWorker = null, costCapacity = createCostCapacityTelemetry(), ownerQuestion = null, resultRef = null, startedAt = null, now }) {
  return buildIntakeStatus({
    requestId: artifact.requestId, state, currentWork, activeWorker, startedAt, updatedAt: now,
    ownerActionRequired: state === "OWNER_REQUIRED", ownerQuestion: state === "OWNER_REQUIRED" ? (ownerQuestion || "Owner decision required") : null,
    costCapacity, workArtifact: { location: artifact.artifactLocation, sha256: artifact.sha256 }, resultRef,
    provenance: { producer: artifact.source.producer, provenance: artifact.source.provenance },
  });
}

/**
 * Execute one already-resolved intake artifact. Returns the terminal disposition + the artifacts to persist
 * (a status always; a content-addressed result + index only on COMPLETE). Never fabricates a result: a
 * refusal (not executable / blocked / wake-failed) yields a status ONLY.
 *
 * @param {object} p
 * @param {object} p.artifact          a resolved, hash-verified intake artifact (from resolveWorkIntake)
 * @param {string} p.now               ISO timestamp (injected)
 * @param {string[]} [p.requiresCapabilities]  paid capabilities the work needs (e.g. ["OPENAI_REVIEW"])
 * @param {object|null} [p.capabilityBroker]   injected broker ({ hasCapability }) — null when unwired
 * @param {object} p.processRunner     injected Wake Supervisor process runner (mock worker in tests)
 * @param {object} p.lease             injected execution lease
 * @param {Function} p.contextPackageFn  the shared C-7 package builder
 * @param {object} [p.wakeCtx]         readiness ctx { governor, network, budgetRemainingUsd, sourceFreshness }
 * @param {string} [p.summary]         result summary (1-1200 chars)
 * @returns {{ disposition, executed, gate, item, capabilities, wake?, status, result? }}
 */
export function runIntakeExecution({
  artifact, sourceCommit = null, now,
  requiresCapabilities = [], capabilityBroker = null,
  processRunner, lease, contextPackageFn, wakeCtx = {}, resolveModel,
  summary = "EOS intake worker completed",
} = {}) {
  if (!ISO_DATE.test(now || "")) throw new Error("runIntakeExecution: an injected ISO `now` is required");
  const gate = assessIntakeExecution(artifact);
  const item = intakeToWorkItem(artifact, { sourceCommit });

  // 1. Not executable — STAGED / READY / OWNER_REQUIRED. No wake, no result.
  if (!gate.mayExecute) {
    const state = gate.ownerRequired ? "OWNER_REQUIRED"
      : artifact.status === "EOS_READY" ? "READY" : "STAGED";
    return Object.freeze({ disposition: state, executed: false, gate, item, capabilities: [], status: statusFor({ artifact, state, currentWork: gate.reason, ownerQuestion: item.ownerQuestion, now }) });
  }

  // 2. Paid capability required but unavailable → BLOCKED. Never fabricate a result.
  const capabilities = requiresCapabilities.map((name) => assessCapability({ name, broker: capabilityBroker }));
  if (capabilities.some((c) => c.available === false)) {
    const blocked = capabilities.filter((c) => !c.available).map((c) => c.name).join(", ");
    return Object.freeze({ disposition: "BLOCKED", executed: false, gate, item, capabilities, status: statusFor({ artifact, state: "BLOCKED", currentWork: `awaiting capability activation: ${blocked}`, now }) });
  }

  // Governed, least-privilege execution profile (fail-closed to READ_ONLY_ANALYSIS). The REQUEST is the intake
  // execution contract's task class (worker/request-authored — can only ever request, never self-escalate);
  // the GRANT is the AUTHORIZED intake's authority envelope (`authorizedExecutionProfile`, set by the governed
  // authorization process). An unauthorized/unknown escalation never widens authority — it fails closed.
  const profileDecision = resolveExecutionProfile({
    requestedProfile: normalizeExecutionContract(artifact.execution).taskClass,
    authorizedProfile: artifact.authority?.authorizationState === "AUTHORIZED" ? (artifact.authority.authorizedExecutionProfile ?? null) : null,
  });

  // The effective completion contract is derived ONCE, BEFORE the wake, and is the single source of truth for
  // both halves of the seam: it tells the worker which structured receipts to return, and it is the same object
  // classifyCompletion judges the returned evidence against below. Deriving it once is the point — when the
  // worker's instructions and the gate's expectations came from separate places, they silently diverged and
  // correct work blocked as "required execution receipts missing".
  const requestedContract = normalizeExecutionContract(artifact.execution);
  const execContract = deriveEffectiveContract({ requested: requestedContract, resolvedProfile: profileDecision.profile });

  // 3. WAKE — the EXISTING Wake Supervisor. Injected runner/lease. Spawns zero on any refusal.
  const wake = executeWake({
    item: { ...item, purpose: item.purpose, scope: item.scope, modelTier: item.modelTier, workstream: item.workstream },
    ctx: { triggerKind: "AUTOMATIC_TRIGGER", ...wakeCtx },
    contextPackageFn, processRunner, lease, resolveModel,
    sourceCommit, sourceFreshness: wakeCtx.sourceFreshness ?? "CURRENT",
    executionProfile: profileDecision.profile,
    executionContract: execContract,
  });

  const heldTelemetry = () => createCostCapacityTelemetry({ providerCapacityUsage: wakeCtx.providerCapacityUsage || {}, budgetStopReason: wake.budgetStopReason || null });

  // A pre-spawn refusal/hold NEVER ran a worker — READY/HELD, unchanged.
  if (wake.spawned !== true) {
    return Object.freeze({
      disposition: "HELD", executed: false, gate, item, capabilities, wake, profileDecision,
      status: statusFor({ artifact, state: "READY", currentWork: wake.reason || wake.failureDetail || wake.failureKind || "not triggered", costCapacity: heldTelemetry(), now }),
    });
  }

  // A worker actually RAN → the COMPLETION-SEMANTIC GATE decides. Provider/process success is necessary but
  // NOT sufficient (the #834/#835/#836/#837 root cause). Evidence is STRUCTURED; worker free-text never
  // classifies. The task's completion contract comes from the intake artifact's optional `execution` block
  // (safe READ_ONLY_ANALYSIS defaults), and durable artifacts are what the runtime actually produced.
  // The REQUESTED completion contract (from the intake execution block) is reconciled against the RESOLVED
  // grant the worker actually ran under (#868 fix): a task can never be required to prove a receipt/artifact its
  // granted profile has no capability to produce, and a downgraded MUTATING task still fails closed (#840). This
  // is the pre-execution-authorization ↔ post-execution-proof seam — classifyCompletion below still validates
  // the receipts AFTER the worker ran; it just validates the ones the grant could actually produce.
  // requestedContract/execContract were derived above the wake — the SAME contract the worker was handed.
  // The wake parses the worker's structured evidence out of its result TEXT and hands it over directly.
  // (The old shape read wake.result.evidence, but wake.result is a string — that check could never be true,
  // so no worker could ever satisfy a receipts requirement. The object form is still honoured for any
  // caller that injects an already-structured result.)
  // Extracted evidence wins ONLY when the wake actually found a block; otherwise fall through to an
  // already-structured result. The wake always sets `workerEvidence` (empty when nothing was found), so
  // keying on `workerEvidenceFound` is what keeps the structured-result path alive instead of shadowing it.
  const workerEvidence = wake.workerEvidenceFound === true && wake.workerEvidence && typeof wake.workerEvidence === "object"
    ? wake.workerEvidence
    : ((wake.result && typeof wake.result === "object" && wake.result.evidence && typeof wake.result.evidence === "object") ? wake.result.evidence : {});
  const completion = classifyCompletion({
    processSucceeded: wake.outcome === "SPAWNED_COMPLETED",
    runtimeTermination: wake.runtimeTermination || (wake.outcome === "SPAWNED_COMPLETED" ? "NORMAL" : "PROCESS_ERROR"),
    // A worker that reports its required tools were permission-blocked (the #840 signal, e.g. an implementation
    // task launched under READ_ONLY_ANALYSIS) is NOT execution-capable → BLOCKED_EXECUTION, never COMPLETE.
    executionCapable: workerEvidence.toolPermissionBlocked === true ? false : (typeof workerEvidence.executionCapable === "boolean" ? workerEvidence.executionCapable : null),
    requiredExecutionReceipts: execContract.requiredExecutionReceipts,
    executionReceipts: Array.isArray(workerEvidence.receipts) ? workerEvidence.receipts : [],
    expectedArtifactClass: execContract.expectedArtifactClass,
    // The current runtime only produces a content-addressed ANALYSIS_REPORT; a worker may declare additional
    // durable artifacts it produced (PATCH / PULL_REQUEST) — until PATCH_PRODUCER is activated, it won't, so
    // an implementation task correctly resolves to AWAITING_ARTIFACTIZATION.
    producedArtifacts: ["ANALYSIS_REPORT", ...(Array.isArray(workerEvidence.artifacts) ? workerEvidence.artifacts : [])],
    verifierResult: typeof workerEvidence.verifier === "string" ? workerEvidence.verifier : null,
    verifierRequired: execContract.verifierRequired,
  });

  if (!completion.complete) {
    // NEVER COMPLETE, NEVER a fabricated result. A hard process failure keeps its FAILED disposition for
    // continuity; every other insufficient outcome maps to its durable completion status (BLOCKED_EXECUTION /
    // AWAITING_ARTIFACTIZATION / CORRECTING / OWNER_REQUIRED).
    const hardFailure = wake.outcome === "SPAWNED_FAILED" && wake.failureKind !== "MAX_TURNS_EXHAUSTED";
    const disposition = hardFailure ? "FAILED" : completion.state;
    const state = hardFailure ? "FAILED" : completionStateToStatus(completion.state);
    return Object.freeze({
      disposition, executed: true, gate, item, capabilities, wake, completion, profileDecision, execContract,
      status: statusFor({ artifact, state, currentWork: completion.reason || wake.failureDetail || wake.failureKind || "not completed", costCapacity: heldTelemetry(), now }),
    });
  }

  // 4. COMPLETE — only now, with the completion-semantic gate satisfied: persist the content-addressed result.
  const outputBytes = Buffer.from(typeof wake.result === "string" ? wake.result : JSON.stringify(wake.result), "utf8");
  const result = buildContentAddressedResult({ request: artifact, outputBytes, status: "COMPLETE", summary, createdAt: now });
  const index = buildResultIndex({ requestId: artifact.requestId, manifestLocation: result.manifestLocation, manifestSha256: result.manifest.sha256, contentLocation: result.contentLocation, updatedAt: now });
  const status = statusFor({
    artifact, state: "COMPLETE", currentWork: "completed", activeWorker: item.workstream,
    costCapacity: wake.costCapacity, resultRef: { location: result.manifestLocation, sha256: result.manifest.sha256 }, now,
  });
  // The completion SIGNAL: point ChatGPT at the content-addressed result to retrieve from GitHub. `commit`
  // is null here — the landing commit is not known until the write-back is committed — so retrieval falls to
  // the default-branch HEAD; a curated/pre-committed artifact can carry an explicit commit when emitted.
  const reviewReady = buildReviewReady({ requestId: artifact.requestId, artifact: result.contentLocation, commit: null });
  return Object.freeze({ disposition: "COMPLETE", executed: true, gate, item, capabilities, wake, completion, profileDecision, execContract, status, result: Object.freeze({ ...result, index }), reviewReady });
}
