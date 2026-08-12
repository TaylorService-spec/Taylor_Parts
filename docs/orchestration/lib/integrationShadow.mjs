import { createHash } from "node:crypto";
import { planIntegrationBacklog } from "./agentManager.mjs";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

function projectionView(plan) {
  return {
    orderedRequestIds: plan.ordered.map((item) => item.requestId),
    nextByTarget: Object.fromEntries(Object.entries(plan.nextByTarget).map(([key, item]) => [key, item.requestId])),
    conflicts: plan.ordered.filter((item) => item.overlappingPaths.length).map((item) => ({ requestId: item.requestId, paths: item.overlappingPaths })),
    blockers: plan.blocked.map((item) => ({ requestId: item.requestId, blocker: item.blocker })),
    waitingOnGates: plan.blocked.filter((item) => item.verificationState !== "PASS" || item.scopeState !== "PASS" || item.hashState !== "PASS" || item.approvalState !== "APPROVED").map((item) => ({
      requestId: item.requestId,
      verification: item.verificationState,
      scope: item.scopeState,
      hash: item.hashState,
      approval: item.approvalState,
    })),
  };
}

// Provider-neutral input. A Cortex-compatible observer may recommend an ordering, but receives no
// mutation, approval, dispatch, or integration capability and is never on the Claude/EOS path.
export function buildShadowInput(backlog) {
  return deepFreeze({ mode: "READ_ONLY_SHADOW", backlog: clone(backlog), capabilities: { mutateBacklog: false, authorize: false, integrate: false, routeClaude: false } });
}

export function computeAgentManagerRecommendation(backlog) {
  if (backlog?.schema !== "agent-manager.integration-backlog/1" || !Array.isArray(backlog.items)) throw new Error("invalid durable integration backlog");
  return projectionView(planIntegrationBacklog(clone(backlog.items)));
}

export function buildShadowStatus({ backlog, shadowRecommendation = null, generatedAt, sourceCommit }) {
  const authoritative = computeAgentManagerRecommendation(backlog);
  const candidate = shadowRecommendation == null ? null : clone(shadowRecommendation);
  const agreement = candidate == null ? "NOT_EVALUATED" : (JSON.stringify(candidate) === JSON.stringify(authoritative) ? "MATCH" : "DISAGREEMENT");
  const body = {
    schema: "agent-manager.integration-shadow-status/1",
    mode: "READ_ONLY_SHADOW",
    provider: "PROVIDER_NEUTRAL",
    availability: candidate == null ? "UNAVAILABLE" : "AVAILABLE",
    sourceCommit,
    generatedAt,
    backlogSha256: digest(backlog),
    agentManager: authoritative,
    shadowRecommendation: candidate,
    agreement,
    disagreementEvidence: agreement === "DISAGREEMENT" ? { agentManager: authoritative, shadow: candidate } : null,
    capabilities: { mutateBacklog: false, authorize: false, integrate: false, applyPatch: false, routeClaude: false },
  };
  return Object.freeze({ ...body, sha256: digest(body) });
}

export function verifyShadowStatus(status) {
  const { sha256, ...body } = status || {};
  return status?.schema === "agent-manager.integration-shadow-status/1" && status?.mode === "READ_ONLY_SHADOW" && digest(body) === sha256 && Object.values(status.capabilities || {}).every((value) => value === false);
}
