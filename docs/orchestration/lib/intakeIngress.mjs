// Intake ingress — turn a resolved, hash-verified governed intake artifact into an ingress EVENT for the
// EXISTING selector + Wake Supervisor, with two fail-closed gates in front of any execution:
//
//   1. INTAKE-STATE GATE (assessIntakeExecution): a governance-stage gate that is INDEPENDENT of the
//      selector. DISCOVERY / DESIGN_STAGING / EOS_READY may enter the selector for repo-safe work but
//      MUST NOT execute; only EXECUTION_AUTHORIZED with an independent AUTHORIZED authorization and no
//      protected boundary may execute. "EOS_READY must not silently equal execution authority."
//   2. CAPABILITY SEAM (assessCapability): does the work need a paid capability (e.g. OPENAI_REVIEW), and
//      is it available? The broker is INJECTED and is only ever asked "do you have capability X?" — it is
//      NOT a credential store and this module never sees, requests, or handles a secret. When no broker is
//      wired (the current state — the EOS Secret Broker is not present), the paid capability is
//      NEEDS_ACTIVATION and the paid path is BLOCKED; staging / read-only paths never consult it.
//
// Pure: resolver bytes, the selector function, and `now` are injected. It resolves, gates, projects, and
// summarizes into a status artifact. It does NOT execute a worker and creates no second queue/selector.

import { resolveWorkIntake, intakeToWorkItem } from "./workIntake.mjs";
import { selectNextWork } from "./selectNextWork.mjs";
import { buildIntakeStatus, deriveStatusState } from "./intakeStatus.mjs";

// Capabilities the EOS Secret Broker would gate. Only OPENAI_REVIEW exists today (the paid GPT reviewer).
export const CAPABILITIES = Object.freeze(["OPENAI_REVIEW"]);

/**
 * Governance-stage execution gate. Fail-closed and independent of the selector: an unauthorized stage can
 * never be reported as executable, no matter what the selector decides.
 * @returns {{ mayEnterSelector, mayExecute, ownerRequired, reason }}
 */
export function assessIntakeExecution(artifact) {
  const status = artifact && artifact.status;
  const auth = artifact && artifact.authority && artifact.authority.authorizationState;
  const protectedBoundary = artifact && artifact.authority && artifact.authority.protectedBoundary;
  const ownerRequired = auth === "OWNER_REQUIRED";
  const mayExecute = status === "EXECUTION_AUTHORIZED" && auth === "AUTHORIZED" && protectedBoundary == null;
  let reason;
  if (mayExecute) reason = "EXECUTION_AUTHORIZED with independent AUTHORIZED authorization and no protected boundary";
  else if (ownerRequired) reason = "OWNER_REQUIRED — an Owner decision gates progress";
  else if (status === "EOS_READY") reason = "EOS_READY is selector-eligible but is NOT execution authority";
  else if (status === "DESIGN_STAGING") reason = "DESIGN_STAGING — design only, must not execute";
  else if (status === "DISCOVERY") reason = "DISCOVERY — investigation only, must not execute";
  else if (status === "EXECUTION_AUTHORIZED") reason = "EXECUTION_AUTHORIZED but authorization is not independently AUTHORIZED (or carries a protected boundary) — refused";
  else reason = "unknown intake status — refused";
  return Object.freeze({ mayEnterSelector: true, mayExecute, ownerRequired, reason });
}

/**
 * Capability availability seam. NEVER returns, requests, or handles a secret — only availability. It
 * accepts EITHER the merged EOS Secret Broker (#790: `credentialStatus(name) => { credentialAvailable }`,
 * which returns `secretValue: "REDACTED"` and never the key) OR a minimal `{ hasCapability(name) }` shim
 * (used in tests). A null/absent broker means the capability is not activated (fail-closed). Availability
 * is necessary but NOT sufficient to spend: the actual paid call still passes the broker's
 * `withCredential` authorization + budget + replay gates at invocation.
 * @returns {{ name, available, state, reason }}
 */
export function assessCapability({ name, broker = null } = {}) {
  if (!CAPABILITIES.includes(name)) return { name, available: false, state: "UNKNOWN_CAPABILITY", reason: `unknown capability ${name}` };
  let has = false;
  try {
    if (broker && typeof broker.credentialStatus === "function") {
      // The merged Secret Broker — availability only (credentialStatus never exposes the key).
      has = broker.credentialStatus(name).credentialAvailable === true;
    } else if (broker && typeof broker.hasCapability === "function") {
      has = broker.hasCapability(name) === true;
    } else {
      return { name, available: false, state: "NEEDS_ACTIVATION", reason: "no capability broker wired — the EOS Secret Broker is not present; the paid capability is unavailable" };
    }
  } catch { has = false; }
  return has ? { name, available: true, state: "AVAILABLE", reason: "capability available via broker (availability only — withCredential still gates the spend)" }
    : { name, available: false, state: "NEEDS_ACTIVATION", reason: `capability ${name} is not available from the broker` };
}

/**
 * Ingest one hash-pinned intake artifact into the existing orchestration stack. Resolves + verifies (via
 * #789's resolveWorkIntake — fail-closed on any id/location/hash mismatch), applies the intake-state gate,
 * projects into the existing selector, assesses any required paid capability, and returns a compact status
 * artifact. It does NOT execute; execution is a separate step gated by `gate.mayExecute` AND capability
 * availability.
 *
 * @param {object} p
 * @param {string} p.requestId @param {string} p.location @param {string} p.sha256 @param {Buffer|string} p.bytes
 * @param {string} [p.now] ISO timestamp (injected — no wall clock here)
 * @param {string[]} [p.requiresCapabilities] paid capabilities this work would need at execution
 * @param {object} [p.capabilityBroker] injected broker ({ hasCapability }) — null when not wired
 * @param {object|null} [p.worker] worker outcome to reflect ({ phase }) — null for a resolve-only ingest
 * @param {Function} [p.selectFn] selector (defaults to the real selectNextWork)
 * @returns {{ artifact, gate, item, selection, capabilities, blockedByCapability, status }}
 */
export function ingestIntake({
  requestId, location, sha256, bytes, sourceCommit = null,
  now, requiresCapabilities = [], capabilityBroker = null, worker = null,
  selectFn = selectNextWork,
} = {}) {
  if (!now) throw new Error("ingestIntake: an injected `now` ISO timestamp is required");
  const artifact = resolveWorkIntake({ requestId, location, sha256, bytes }); // fail-closed on mismatch
  const gate = assessIntakeExecution(artifact);
  const item = intakeToWorkItem(artifact, { sourceCommit });
  const selection = selectFn([item]);

  // Capabilities are only material once execution is permitted; a staged/read-only item never blocks on them.
  const capabilities = gate.mayExecute ? requiresCapabilities.map((name) => assessCapability({ name, broker: capabilityBroker })) : [];
  const blockedByCapability = capabilities.some((c) => c.available === false);

  const capabilitySummary = capabilities.length ? { available: !blockedByCapability } : null;
  const state = deriveStatusState({
    intakeStatus: artifact.status,
    authorizationState: artifact.authority.authorizationState,
    selectionDecision: selection && selection.decision,
    worker,
    capability: capabilitySummary,
  });

  const status = buildIntakeStatus({
    requestId: artifact.requestId,
    state,
    currentWork: gate.mayExecute ? (blockedByCapability ? "awaiting paid capability activation" : "authorized — awaiting worker") : gate.reason,
    activeWorker: worker && worker.name ? worker.name : null,
    startedAt: worker && worker.startedAt ? worker.startedAt : null,
    updatedAt: now,
    ownerActionRequired: gate.ownerRequired,
    ownerQuestion: gate.ownerRequired ? (artifact.authority.ownerQuestion || item.ownerQuestion || "Owner decision required") : null,
    costToDateUsd: worker && worker.costToDateUsd ? worker.costToDateUsd : 0,
    workArtifact: { location: artifact.artifactLocation, sha256: artifact.sha256 },
    resultRef: worker && worker.resultRef ? worker.resultRef : null,
    provenance: { producer: artifact.source.producer, provenance: artifact.source.provenance, sourceCommit: sourceCommit || null },
  });

  return Object.freeze({ artifact, gate, item, selection, capabilities, blockedByCapability, status });
}
