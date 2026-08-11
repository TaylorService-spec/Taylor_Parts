import {
  intakeDigest, resolveWorkIntake, stableJson, sha256Bytes, workPointer, statusPointer, resultPointer,
} from "../../../docs/orchestration/lib/workIntake.mjs";

const BASE = "docs/orchestration/work-intake";
export const intakeLocation = (requestId) => `${BASE}/${requestId}.work.json`;

export function buildIntake(input, auth, now = new Date().toISOString()) {
  if (input.status === "EXECUTION_AUTHORIZED" || input.authorizationState === "AUTHORIZED") {
    throw new Error("authenticated intake cannot grant execution authority; use the governed Owner authorization path");
  }
  const artifact = {
    requestId: input.requestId,
    title: input.title,
    intent: input.intent,
    scope: input.scope,
    contextScope: input.contextScope,
    source: {
      producer: "ChatGPT authenticated MCP",
      provenance: input.provenance,
      authenticatedSubject: auth.subject,
      oauthClientId: auth.clientId,
    },
    status: input.status,
    authority: {
      authorizationState: input.authorizationState,
      basis: input.authorityBasis,
      ...(input.protectedBoundary ? { protectedBoundary: input.protectedBoundary } : {}),
      ...(input.ownerQuestion ? { ownerQuestion: input.ownerQuestion } : {}),
    },
    artifactLocation: intakeLocation(input.requestId),
    sha256: "",
    createdAt: now,
    updatedAt: now,
    relatedRefs: { issues: input.issueRefs || [], pullRequests: [] },
  };
  artifact.sha256 = intakeDigest(artifact);
  resolveWorkIntake({ requestId: artifact.requestId, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact) });
  return Object.freeze(artifact);
}

export function serializeArtifact(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function verifyResultManifest(manifest) {
  const { artifactLocation: _location, sha256, ...payload } = manifest || {};
  if (!sha256 || sha256Bytes(Buffer.from(stableJson(payload), "utf8")) !== sha256) throw new Error("result manifest hash mismatch");
  if (manifest.pointer !== resultPointer(manifest.requestId)) throw new Error("result manifest pointer mismatch");
  return manifest;
}

export function compactSubmitResponse(artifact, refs) {
  return { submit: workPointer(artifact.requestId), status: statusPointer(artifact.requestId), requestId: artifact.requestId, location: artifact.artifactLocation, sha256: artifact.sha256, ...refs };
}
