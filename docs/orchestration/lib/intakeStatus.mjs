// Durable, compact intake STATUS artifact — the deterministic, ChatGPT-readable projection of where an
// intake request stands. It closes the gap left by the #789 work-intake bridge: `work://` (the request)
// and `result://` (the content-addressed result) existed, but `status://` had no artifact.
//
// The whole point is READBACK WITHOUT SEARCH: `status://<requestId>` resolves to ONE deterministic repo
// path derivable from the requestId alone, and that single status artifact carries the pointer to the
// content-addressed result once it exists. So a GitHub read connector, given only a requestId, can fetch
// status (and from it, result) with no repository-wide search.
//
// This is a projection/summary — NOT a second state store, queue, selector, or telemetry dump. It
// summarizes the existing selector decision + worker outcome; detailed evidence stays referenced.

import { stableJson, sha256Bytes, statusPointer, resultPointer, workPointer } from "./workIntake.mjs";

// Compact operational states a reader (Owner via ChatGPT) needs. Distinct from INTAKE_STATUS (the request's
// governance stage) and from the worker's internal lifecycle — this is the summarized "where is it".
export const STATUS_STATE = Object.freeze([
  "STAGED",        // accepted + resolved, but not executable (DISCOVERY / DESIGN_STAGING)
  "READY",         // selector-eligible; EOS_READY or authorized-and-waiting — NOT yet executing
  "ACTIVE",        // a worker is running
  "REVIEWING",     // independent review in progress
  "CORRECTING",    // addressing review corrections
  "BLOCKED",       // a required capability/dependency is unavailable (e.g. paid capability not activated)
  "OWNER_REQUIRED", // an Owner decision gates progress
  "COMPLETE",      // finished; resultRef resolves
  "FAILED",        // terminated without a usable result
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ID = /^[A-Z0-9][A-Z0-9._-]{2,79}$/;

const STATUS_DIR = "docs/orchestration/work-intake/status";
const RESULT_DIR = "docs/orchestration/work-intake/results";

/** Deterministic status artifact path — derivable from the requestId ALONE (no hash, no search). */
export function statusLocation(requestId) {
  if (!ID.test(requestId || "")) throw new Error("statusLocation: invalid requestId");
  return `${STATUS_DIR}/${requestId}.status.json`;
}

/** Deterministic result INDEX path — a stable pointer to the latest content-addressed result manifest. */
export function resultIndexLocation(requestId) {
  if (!ID.test(requestId || "")) throw new Error("resultIndexLocation: invalid requestId");
  return `${RESULT_DIR}/${requestId}/latest.result.json`;
}

/** Parse a `status://<id>` or `result://<id>` pointer to its deterministic repo path (+ the sibling paths). */
export function resolvePointer(pointer) {
  const m = /^(status|result|work):\/\/([A-Z0-9][A-Z0-9._-]{2,79})$/.exec(pointer || "");
  if (!m) throw new Error(`resolvePointer: not a work/status/result pointer: ${pointer}`);
  const [, kind, requestId] = m;
  const location = kind === "status" ? statusLocation(requestId)
    : kind === "result" ? resultIndexLocation(requestId)
    : `docs/orchestration/work-intake/${requestId}.work.json`;
  return Object.freeze({ kind, requestId, location, statusLocation: statusLocation(requestId), resultIndexLocation: resultIndexLocation(requestId) });
}

/**
 * Derive the compact STATUS_STATE from the request's governance stage + the selector decision + an optional
 * worker/capability outcome. Fail-closed: an unauthorized stage is never reported as executing.
 * @param {{ intakeStatus, authorizationState, selectionDecision?, worker?, capability? }} p
 *   worker: { phase: "ACTIVE"|"REVIEWING"|"CORRECTING"|"COMPLETE"|"FAILED" } | null
 *   capability: { available: boolean } | null  (a required paid capability, if any)
 */
export function deriveStatusState({ intakeStatus, authorizationState, selectionDecision = null, worker = null, capability = null } = {}) {
  if (authorizationState === "OWNER_REQUIRED") return "OWNER_REQUIRED";
  if (worker && worker.phase) {
    if (["ACTIVE", "REVIEWING", "CORRECTING", "COMPLETE", "FAILED"].includes(worker.phase)) return worker.phase;
  }
  if (capability && capability.available === false) return "BLOCKED";
  if (intakeStatus === "DISCOVERY" || intakeStatus === "DESIGN_STAGING") return "STAGED";
  if (intakeStatus === "EOS_READY") return "READY";
  if (intakeStatus === "EXECUTION_AUTHORIZED") return "READY"; // authorized but no worker started yet
  return "STAGED";
}

/**
 * Build the durable status artifact. Compact by contract: it summarizes, it does not dump telemetry —
 * detailed evidence is referenced via artifactRefs/resultRef. The `sha256` is the digest of the canonical
 * envelope with the self-referential `sha256` omitted (same discipline as the work + result artifacts).
 * @returns a frozen status manifest whose `artifactLocation` is the deterministic status path.
 */
export function buildIntakeStatus({
  requestId,
  state,
  currentWork = null,
  activeWorker = null,
  startedAt = null,
  updatedAt,
  ownerActionRequired = false,
  ownerQuestion = null,
  costToDateUsd = 0,
  artifactRefs = [],
  resultRef = null,
  workArtifact = null,
  provenance = null,
} = {}) {
  if (!ID.test(requestId || "")) throw new Error("buildIntakeStatus: invalid requestId");
  if (!STATUS_STATE.includes(state)) throw new Error(`buildIntakeStatus: unknown state ${state}`);
  if (!ISO_DATE.test(updatedAt || "")) throw new Error("buildIntakeStatus: updatedAt must be ISO-8601 UTC");
  if (startedAt && !ISO_DATE.test(startedAt)) throw new Error("buildIntakeStatus: startedAt must be ISO-8601 UTC");
  if (ownerActionRequired && !ownerQuestion) throw new Error("buildIntakeStatus: ownerActionRequired needs an ownerQuestion");
  if (state === "COMPLETE" && !resultRef) throw new Error("buildIntakeStatus: COMPLETE requires a resultRef");

  const base = {
    schema: "eos.intake.status/1",
    requestId,
    pointer: statusPointer(requestId),
    work: workPointer(requestId),
    result: resultPointer(requestId),
    state,
    currentWork: currentWork || null,
    activeWorker: activeWorker || null,
    startedAt: startedAt || null,
    updatedAt,
    ownerActionRequired: ownerActionRequired === true,
    ownerQuestion: ownerActionRequired ? ownerQuestion : null,
    costToDateUsd: Number(costToDateUsd) || 0,
    // references only — never inlined substance
    workArtifact: workArtifact ? { location: workArtifact.location, sha256: workArtifact.sha256 } : null,
    resultRef: resultRef ? { location: resultRef.location, sha256: resultRef.sha256, pointer: resultPointer(requestId) } : null,
    artifactRefs: [...artifactRefs],
    provenance: provenance || null,
  };
  const sha256 = sha256Bytes(Buffer.from(stableJson(base), "utf8"));
  return Object.freeze({ ...base, artifactLocation: statusLocation(requestId), sha256 });
}

/** Verify a status artifact's self-hash — fail-closed readback, same contract as the work/result artifacts. */
export function verifyIntakeStatus(status) {
  if (!status || typeof status !== "object") return { ok: false, reason: "not an object" };
  const { sha256, artifactLocation, ...base } = status;
  const recomputed = sha256Bytes(Buffer.from(stableJson(base), "utf8"));
  if (recomputed !== sha256) return { ok: false, reason: `hash mismatch (${recomputed} != ${sha256})` };
  if (artifactLocation !== statusLocation(status.requestId)) return { ok: false, reason: "artifactLocation is not the deterministic status path" };
  return { ok: true };
}

/**
 * Build the deterministic result-index pointer (results/<id>/latest.result.json) that points at the exact
 * content-addressed manifest. Lets `result://<id>` resolve without knowing the content hash. Not a second
 * store — a one-line index into the existing content-addressed result.
 */
export function buildResultIndex({ requestId, manifestLocation, manifestSha256, contentLocation = null, updatedAt }) {
  if (!ID.test(requestId || "")) throw new Error("buildResultIndex: invalid requestId");
  if (!ISO_DATE.test(updatedAt || "")) throw new Error("buildResultIndex: updatedAt must be ISO-8601 UTC");
  const base = { schema: "eos.intake.result-index/1", requestId, pointer: resultPointer(requestId), manifestLocation, manifestSha256, contentLocation: contentLocation || null, updatedAt };
  const sha256 = sha256Bytes(Buffer.from(stableJson(base), "utf8"));
  return Object.freeze({ ...base, artifactLocation: resultIndexLocation(requestId), sha256 });
}
