// Provider-neutral EOS worker adapter — Cortex provider bindings.
//
// Two modes share this one adapter:
//   - READ_ONLY_PILOT: unchanged (see runReadOnlyProviderPilot/persistPilotResult below).
//   - PATCH_PRODUCER: a second, tightly bounded mode that may propose deterministic, hash-bound
//     source patches ONLY for the company-level `TaylorService-spec/project-keystone` EOS Control
//     Center workstream, and only under approved Control Center paths (CONTROL_CENTER_PATH_PREFIX).
//     A proposed patch is never applied by this adapter — it is persisted as a governed EOS
//     result/patch artifact, exactly like a READ_ONLY_PILOT result, only after an existing Verifier
//     PASS bound to the exact request/result/patch identity. Integration (applying/merging a
//     proposed patch into project-keystone) remains a separate governed step using the existing
//     integration authority (agentManager.planIntegrationBacklog / DelegationCharter §8.3-§8.6) —
//     this adapter has no apply/merge/deploy/route/authorize surface.
//
// This is an execution adapter only: no queue, scheduling, approval, mutation, or integration authority.

import { createHash } from "node:crypto";
import { createAgentResult, validateAgentResult } from "./agentResult.mjs";
import { validateAgentRequest } from "./agentRequest.mjs";
import { buildContentAddressedResult, stableJson } from "./workIntake.mjs";
import { createVerificationRequest, deriveVerdict } from "./verifierAgent.mjs";
import { resolveExecutionProfile } from "./executionProfiles.mjs";

export const CORTEX_PILOT_MODE = "READ_ONLY_PILOT";
export const CORTEX_PATCH_PRODUCER_MODE = "PATCH_PRODUCER";

// The exact approved path boundary for the future project-keystone Control Center pilot: only
// binding.project === KEYSTONE_PROJECT && binding.repo === KEYSTONE_REPO, and only request
// allowedSurfaces that live under CONTROL_CENTER_PATH_PREFIX, are ever eligible for PATCH_PRODUCER.
export const KEYSTONE_PROJECT = "project-keystone";
export const KEYSTONE_REPO = "TaylorService-spec/project-keystone";
export const CONTROL_CENTER_PATH_PREFIX = "control-center/";

const digest = (value) => createHash("sha256").update(Buffer.from(stableJson(value), "utf8")).digest("hex");
const subset = (items, allowed) => items.every((item) => allowed.includes(item));

const PATCH_CHANGE_TYPES = Object.freeze(["ADD", "MODIFY", "DELETE"]);
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/;
const CREDENTIAL_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:api|secret)[_-]?key\s*[:=]|password\s*[:=]/i;

// Fail-closed validation of one proposed patch entry. Never writes anything; a caller only ever
// learns whether an entry is admissible. Every rejection reason is a distinct, matchable string so
// tests can assert on the exact invariant that tripped.
function validatePatchEntry(entry, allowedSurfaces) {
  if (!entry || typeof entry !== "object") return "malformed patch entry";
  const { path, changeType, encoding, content, sha256 } = entry;
  if (typeof path !== "string" || !path) return "patch entry path is required";
  if (ABSOLUTE_PATH.test(path)) return `patch entry path must be repo-relative, not absolute: ${path}`;
  if (path.includes("\0") || path.split(/[\\/]/).includes("..")) return `patch entry path traverses outside its scope: ${path}`;
  if (entry.symlink === true || typeof entry.linkTarget === "string") return `patch entry declares a symlink escape, which is not permitted: ${path}`;
  if (!path.startsWith(CONTROL_CENTER_PATH_PREFIX)) return `patch entry path is outside the approved Control Center surface (${CONTROL_CENTER_PATH_PREFIX}): ${path}`;
  if (!allowedSurfaces.includes(path)) return `patch entry proposes an undeclared file outside the request's allowed surfaces: ${path}`;
  if (!PATCH_CHANGE_TYPES.includes(changeType)) return `patch entry changeType must be one of ${PATCH_CHANGE_TYPES.join("/")}: ${path}`;
  if (changeType === "DELETE") return null;
  if (encoding !== "utf8") return `patch entry content must be deterministic utf8 text, not a binary payload: ${path}`;
  if (typeof content !== "string") return `patch entry content must be a string: ${path}`;
  if (CREDENTIAL_PATTERN.test(content)) return `patch entry content appears to contain credential material: ${path}`;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return `patch entry sha256 must be 64 lowercase hex characters: ${path}`;
  const actualSha256 = createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
  if (actualSha256 !== sha256) return `patch entry hash does not match its content (tampered or malformed): ${path}`;
  return null;
}

export async function runReadOnlyProviderPilot({ request, binding, envelope, providerRun, clock }) {
  const reject = (reason, kind = "REJECTED") => Object.freeze({ ok: false, kind, reason });
  const requestErrors = validateAgentRequest(request || {});
  if (requestErrors.length) return reject(`invalid AgentRequest: ${requestErrors.join("; ")}`);
  if (request.mutating) return reject("READ_ONLY_PILOT forbids mutating requests");
  if (binding?.mode !== CORTEX_PILOT_MODE) return reject("Cortex provider is not in READ_ONLY_PILOT mode");
  if (envelope?.requestId !== request.requestId) return reject("requestId binding mismatch");
  if (envelope?.project !== binding.project || envelope?.repo !== binding.repo) return reject("project/repo binding mismatch");
  if (!subset(request.allowedSurfaces, binding.allowedSurfaces || [])) return reject("request contains a disallowed surface");
  if (!binding.eligibleProviders?.includes(envelope?.provider) || !binding.eligibleModels?.includes(envelope?.model)) return reject("provider/model is not eligible");
  if (!Number.isFinite(envelope?.budget?.maxCostUsd) || envelope.budget.maxCostUsd <= 0 || envelope.budget.maxCostUsd > binding.maxCostUsd) return reject("budget envelope rejected");
  if (!Number.isInteger(envelope?.capacity?.maxConcurrent) || envelope.capacity.maxConcurrent < 1 || envelope.capacity.available !== true) return reject("capacity envelope rejected");
  if (typeof providerRun !== "function") return reject("provider unavailable", "UNAVAILABLE");

  let raw;
  try { raw = await providerRun(Object.freeze({ request, project: envelope.project, repo: envelope.repo, provider: envelope.provider, model: envelope.model, allowedScope: Object.freeze([...request.allowedSurfaces]), budget: Object.freeze({ ...envelope.budget }), capacity: Object.freeze({ ...envelope.capacity }) })); }
  catch (error) { return reject(`provider unavailable: ${error?.message || "unknown"}`, "UNAVAILABLE"); }
  if (!raw || typeof raw.executionId !== "string" || !raw.executionId || typeof raw.summary !== "string" || !Array.isArray(raw.findings) || !Array.isArray(raw.evidence) || raw.mutated === true) return reject("malformed or mutation-bearing provider result");
  const evidencePaths = raw.evidence.map((item) => typeof item === "string" ? item : item?.path).filter(Boolean);
  if (evidencePaths.length !== raw.evidence.length || !subset(evidencePaths, request.allowedSurfaces)) return reject("provider evidence contains a disallowed surface");

  const completedAt = clock();
  const resultId = `${request.requestId}:cortex:${digest(raw).slice(0, 16)}`;
  const evidencePointer = `result://${request.requestId}`;
  const receiptBase = { requestId: request.requestId, project: envelope.project, repo: envelope.repo, provider: envelope.provider, model: envelope.model, mode: CORTEX_PILOT_MODE, allowedScope: [...request.allowedSurfaces], budget: { ...envelope.budget }, capacity: { ...envelope.capacity }, providerExecutionId: raw.executionId, completedAt, evidencePointer };
  const receipt = Object.freeze({ ...receiptBase, sha256: digest(receiptBase) });
  const result = createAgentResult({ resultId, requestId: request.requestId, routedBackTo: request.requestedByWorkstream, status: "COMPLETE", verdict: raw.verdict || "NOT_APPLICABLE", findings: raw.findings, evidence: [...raw.evidence, { pointer: evidencePointer, receiptSha256: receipt.sha256 }], metrics: raw.metrics || {}, provider: envelope.provider, model: envelope.model, executionReceipt: receipt });
  const resultErrors = validateAgentResult(result);
  if (resultErrors.length) return reject(`malformed AgentResult: ${resultErrors.join("; ")}`);
  const source = { requestId: request.requestId, sha256: digest(request), relatedRefs: { issues: [], pullRequests: [] } };
  const durable = buildContentAddressedResult({ request: source, outputBytes: stableJson(result), summary: raw.summary, createdAt: completedAt, artifactRefs: [{ executionReceiptSha256: receipt.sha256 }] });
  return Object.freeze({ ok: true, result, receipt, durable });
}

// Reuses the governed work-intake result locations. The injected store receives only the two
// content-addressed artifacts; this adapter cannot write source, backlog, approval, or integration state.
export function persistPilotResult({ request, result, durable, verificationRequest, verifierResult, store }) {
  const requestErrors = validateAgentRequest(request || {});
  const resultErrors = validateAgentResult(result || {});
  const verificationErrors = validateAgentRequest(verificationRequest || {});
  const verifierErrors = validateAgentResult(verifierResult || {});
  if (requestErrors.length || resultErrors.length || verificationErrors.length || verifierErrors.length) throw new Error("matching valid Verifier PASS is required before persistence");
  if (result.requestId !== request.requestId || verifierResult.requestId !== verificationRequest.requestId) throw new Error("verification identity mismatch");
  const expectedVerification = createVerificationRequest({ requestId: verificationRequest.requestId, workerRequest: request, workerResult: result, priority: verificationRequest.priority, correctionCount: verificationRequest.correctionCount || 0, retryAllowance: verificationRequest.retryAllowance, modelTier: verificationRequest.modelTier });
  if (verificationRequest.purpose !== expectedVerification.purpose || stableJson(verificationRequest.allowedSurfaces) !== stableJson(expectedVerification.allowedSurfaces) || stableJson(verificationRequest.scope) !== stableJson(expectedVerification.scope)) throw new Error("verification is not bound to this request/result identity");
  if (deriveVerdict(verifierResult) !== "PASS") throw new Error("Verifier PASS is required before persistence");
  if (durable?.manifest?.requestId !== result.requestId || durable?.content?.toString("utf8") !== stableJson(result)) throw new Error("durable result identity mismatch");
  if (!durable?.contentLocation?.startsWith("docs/orchestration/work-intake/results/") || !durable?.manifestLocation?.startsWith("docs/orchestration/work-intake/results/")) throw new Error("invalid durable EOS result paths");
  if (typeof store?.write !== "function") throw new Error("durable result store is unavailable");
  store.write(durable.contentLocation, durable.content);
  store.write(durable.manifestLocation, Buffer.from(`${JSON.stringify(durable.manifest, null, 2)}\n`, "utf8"));
  return Object.freeze({ contentLocation: durable.contentLocation, manifestLocation: durable.manifestLocation, sha256: durable.manifest.sha256 });
}

// PATCH_PRODUCER: same shape as runReadOnlyProviderPilot, but eligible only for the exact
// project-keystone Control Center binding, and the provider may propose file changes only as
// deterministic/hash-bound patch entries under CONTROL_CENTER_PATH_PREFIX. Nothing here applies a
// patch — it only ever produces a proposed, hash-bound artifact for governed persistence below.
export async function runCortexPatchProducer({ request, binding, envelope, providerRun, clock }) {
  const reject = (reason, kind = "REJECTED") => Object.freeze({ ok: false, kind, reason });
  const requestErrors = validateAgentRequest(request || {});
  if (requestErrors.length) return reject(`invalid AgentRequest: ${requestErrors.join("; ")}`);
  if (!request.mutating) return reject("PATCH_PRODUCER requires a request explicitly scoped as mutating (proposal-only)");
  if (binding?.mode !== CORTEX_PATCH_PRODUCER_MODE) return reject("Cortex provider is not in PATCH_PRODUCER mode");
  if (binding.project !== KEYSTONE_PROJECT || binding.repo !== KEYSTONE_REPO) return reject("PATCH_PRODUCER is eligible only for the project-keystone Control Center binding");
  if (envelope?.requestId !== request.requestId) return reject("requestId binding mismatch");
  if (envelope?.project !== binding.project || envelope?.repo !== binding.repo) return reject("project/repo binding mismatch");
  if (!request.allowedSurfaces.length || !request.allowedSurfaces.every((surface) => surface.startsWith(CONTROL_CENTER_PATH_PREFIX))) return reject("request must be explicitly scoped to approved Control Center paths");
  if (!subset(request.allowedSurfaces, binding.allowedSurfaces || [])) return reject("request contains a disallowed surface");
  if (!binding.eligibleProviders?.includes(envelope?.provider) || !binding.eligibleModels?.includes(envelope?.model)) return reject("provider/model is not eligible");
  if (!Number.isFinite(envelope?.budget?.maxCostUsd) || envelope.budget.maxCostUsd <= 0 || envelope.budget.maxCostUsd > binding.maxCostUsd) return reject("budget envelope rejected");
  if (!Number.isInteger(envelope?.capacity?.maxConcurrent) || envelope.capacity.maxConcurrent < 1 || envelope.capacity.available !== true) return reject("capacity envelope rejected");
  // The execution profile is a GOVERNED grant, never self-selected by the request/worker (see
  // executionProfiles.mjs). PATCH_PRODUCER company work requires a resolved, GRANTED PATCH_PRODUCER
  // profile bound into the envelope — an unauthorized or missing grant fails closed, same as an
  // unauthorized project/repo binding.
  const executionProfile = resolveExecutionProfile(envelope?.executionProfileGrant || {});
  if (!executionProfile.granted || executionProfile.profile !== CORTEX_PATCH_PRODUCER_MODE) return reject(`execution profile not authorized: ${executionProfile.reason}`);
  if (typeof providerRun !== "function") return reject("provider unavailable", "UNAVAILABLE");

  let raw;
  try { raw = await providerRun(Object.freeze({ request, project: envelope.project, repo: envelope.repo, provider: envelope.provider, model: envelope.model, allowedScope: Object.freeze([...request.allowedSurfaces]), budget: Object.freeze({ ...envelope.budget }), capacity: Object.freeze({ ...envelope.capacity }) })); }
  catch (error) { return reject(`provider unavailable: ${error?.message || "unknown"}`, "UNAVAILABLE"); }
  if (!raw || typeof raw.executionId !== "string" || !raw.executionId || typeof raw.summary !== "string" || !Array.isArray(raw.findings) || !Array.isArray(raw.evidence) || raw.mutated === true) return reject("malformed or mutation-bearing provider result");
  const evidencePaths = raw.evidence.map((item) => typeof item === "string" ? item : item?.path).filter(Boolean);
  if (evidencePaths.length !== raw.evidence.length || !subset(evidencePaths, request.allowedSurfaces)) return reject("provider evidence contains a disallowed surface");
  if (!raw.patch || !Array.isArray(raw.patch.entries) || raw.patch.entries.length === 0) return reject("PATCH_PRODUCER result must propose at least one deterministic, hash-bound patch entry");
  for (const entry of raw.patch.entries) {
    const entryError = validatePatchEntry(entry, request.allowedSurfaces);
    if (entryError) return reject(entryError);
  }

  const completedAt = clock();
  const patchEntries = raw.patch.entries.map((entry) => Object.freeze({ ...entry }));
  const patchSha256 = digest(patchEntries);
  const resultId = `${request.requestId}:cortex-patch:${digest(raw).slice(0, 16)}`;
  const evidencePointer = `result://${request.requestId}`;
  const receiptBase = { requestId: request.requestId, project: envelope.project, repo: envelope.repo, provider: envelope.provider, model: envelope.model, mode: CORTEX_PATCH_PRODUCER_MODE, executionProfile: executionProfile.profile, allowedScope: [...request.allowedSurfaces], budget: { ...envelope.budget }, capacity: { ...envelope.capacity }, providerExecutionId: raw.executionId, completedAt, evidencePointer, patchSha256, applied: false };
  const receipt = Object.freeze({ ...receiptBase, sha256: digest(receiptBase) });
  const patchEvidence = patchEntries.map((entry) => ({ path: entry.path, changeType: entry.changeType, sha256: entry.sha256 || null }));
  const result = createAgentResult({ resultId, requestId: request.requestId, routedBackTo: request.requestedByWorkstream, status: "COMPLETE", verdict: raw.verdict || "NOT_APPLICABLE", findings: raw.findings, evidence: [...raw.evidence, ...patchEvidence, { pointer: evidencePointer, receiptSha256: receipt.sha256 }], metrics: raw.metrics || {}, provider: envelope.provider, model: envelope.model, executionReceipt: receipt, patch: Object.freeze({ entries: patchEntries, sha256: patchSha256, applied: false }) });
  const resultErrors = validateAgentResult(result);
  if (resultErrors.length) return reject(`malformed AgentResult: ${resultErrors.join("; ")}`);
  const source = { requestId: request.requestId, sha256: digest(request), relatedRefs: { issues: [], pullRequests: [] } };
  const durable = buildContentAddressedResult({ request: source, outputBytes: stableJson(result), summary: raw.summary, createdAt: completedAt, artifactRefs: [{ executionReceiptSha256: receipt.sha256 }, { patchSha256 }] });
  return Object.freeze({ ok: true, result, receipt, durable });
}

// Reuses the SAME governed work-intake result locations and the SAME Verifier-PASS-before-
// persistence gate as persistPilotResult. The only additional check is a defense-in-depth re-
// validation of every patch entry (path safety, hash binding, no credential/binary content) right
// before persistence. The injected store never receives a patch entry's own path — only the two
// content-addressed EOS result/patch artifacts — so no patch is ever applied, and no source,
// backlog, merge, deploy, Claude-routing, or authorization surface is reachable from here.
export function persistPatchProducerResult({ request, result, durable, verificationRequest, verifierResult, store }) {
  const requestErrors = validateAgentRequest(request || {});
  const resultErrors = validateAgentResult(result || {});
  const verificationErrors = validateAgentRequest(verificationRequest || {});
  const verifierErrors = validateAgentResult(verifierResult || {});
  if (requestErrors.length || resultErrors.length || verificationErrors.length || verifierErrors.length) throw new Error("matching valid Verifier PASS is required before persistence");
  if (!result.patch || !Array.isArray(result.patch.entries) || result.patch.entries.length === 0) throw new Error("PATCH_PRODUCER persistence requires a proposed patch with at least one entry");
  for (const entry of result.patch.entries) {
    const entryError = validatePatchEntry(entry, request.allowedSurfaces);
    if (entryError) throw new Error(`refusing to persist an unsafe patch entry: ${entryError}`);
  }
  if (result.requestId !== request.requestId || verifierResult.requestId !== verificationRequest.requestId) throw new Error("verification identity mismatch");
  const expectedVerification = createVerificationRequest({ requestId: verificationRequest.requestId, workerRequest: request, workerResult: result, priority: verificationRequest.priority, correctionCount: verificationRequest.correctionCount || 0, retryAllowance: verificationRequest.retryAllowance, modelTier: verificationRequest.modelTier });
  if (verificationRequest.purpose !== expectedVerification.purpose || stableJson(verificationRequest.allowedSurfaces) !== stableJson(expectedVerification.allowedSurfaces) || stableJson(verificationRequest.scope) !== stableJson(expectedVerification.scope)) throw new Error("verification is not bound to this request/result/patch identity");
  if (deriveVerdict(verifierResult) !== "PASS") throw new Error("Verifier PASS is required before persistence");
  if (durable?.manifest?.requestId !== result.requestId || durable?.content?.toString("utf8") !== stableJson(result)) throw new Error("durable result identity mismatch");
  if (!durable?.contentLocation?.startsWith("docs/orchestration/work-intake/results/") || !durable?.manifestLocation?.startsWith("docs/orchestration/work-intake/results/")) throw new Error("invalid durable EOS result paths");
  if (typeof store?.write !== "function") throw new Error("durable result store is unavailable");
  store.write(durable.contentLocation, durable.content);
  store.write(durable.manifestLocation, Buffer.from(`${JSON.stringify(durable.manifest, null, 2)}\n`, "utf8"));
  return Object.freeze({ contentLocation: durable.contentLocation, manifestLocation: durable.manifestLocation, sha256: durable.manifest.sha256, patchApplied: false });
}
