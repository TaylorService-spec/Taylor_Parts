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

  // 3. WAKE — the EXISTING Wake Supervisor. Injected runner/lease. Spawns zero on any refusal.
  const wake = executeWake({
    item: { ...item, purpose: item.purpose, scope: item.scope, modelTier: item.modelTier, workstream: item.workstream },
    ctx: { triggerKind: "AUTOMATIC_TRIGGER", ...wakeCtx },
    contextPackageFn, processRunner, lease, resolveModel,
    sourceCommit, sourceFreshness: wakeCtx.sourceFreshness ?? "CURRENT",
  });

  if (wake.outcome !== "SPAWNED_COMPLETED") {
    // A refusal/hold/failure is NEVER completed work.
    const failed = wake.outcome === "SPAWNED_FAILED";
    return Object.freeze({
      disposition: failed ? "FAILED" : "HELD", executed: wake.spawned === true, gate, item, capabilities, wake,
      status: statusFor({ artifact, state: failed ? "FAILED" : "READY", currentWork: wake.reason || wake.failureDetail || wake.failureKind || "not triggered", costCapacity: createCostCapacityTelemetry({ providerCapacityUsage: wakeCtx.providerCapacityUsage || {}, budgetStopReason: wake.budgetStopReason || null }), now }),
    });
  }

  // 4. COMPLETE — persist the worker output as the existing content-addressed result + a COMPLETE status.
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
  return Object.freeze({ disposition: "COMPLETE", executed: true, gate, item, capabilities, wake, status, result: Object.freeze({ ...result, index }), reviewReady });
}
