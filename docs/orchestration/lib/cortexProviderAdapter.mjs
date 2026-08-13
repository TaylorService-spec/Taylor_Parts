// Provider-neutral EOS worker adapter — Cortex READ_ONLY_PILOT binding.
// This is an execution adapter only: no queue, scheduling, approval, mutation, or integration authority.

import { createHash } from "node:crypto";
import { createAgentResult, validateAgentResult } from "./agentResult.mjs";
import { validateAgentRequest } from "./agentRequest.mjs";
import { buildContentAddressedResult, stableJson } from "./workIntake.mjs";
import { createVerificationRequest, deriveVerdict } from "./verifierAgent.mjs";

export const CORTEX_PILOT_MODE = "READ_ONLY_PILOT";
const digest = (value) => createHash("sha256").update(Buffer.from(stableJson(value), "utf8")).digest("hex");
const subset = (items, allowed) => items.every((item) => allowed.includes(item));

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
