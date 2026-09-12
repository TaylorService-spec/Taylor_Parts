import {
  intakeDigest, isWorkIntakeId, resolveWorkIntake, stableJson, sha256Bytes, workPointer, statusPointer, resultPointer,
} from "../../../docs/orchestration/lib/workIntake.mjs";

const BASE = "docs/orchestration/work-intake";

/**
 * THE identifier chokepoint for this boundary.
 *
 * A requestId arriving here is a string a remote caller typed, and every use of it downstream is
 * string interpolation into a GitHub REST path. `../..` in that string does not fail -- URL
 * normalization silently resolves it, and the request goes out, with this service's token, to a
 * DIFFERENT GitHub resource than the one the tool claims to read. `#` drops the `?ref=` pin into a
 * fragment; a literal `?ref=` overrides it. None of those are the artifact the pointer names.
 *
 * So the id is checked against the canonical work-intake rule -- `isWorkIntakeId`, the same one the
 * artifact validator and the review-authorization contract use -- BEFORE a path exists, and it is
 * checked here rather than only in the tool schema, so a second caller of the store cannot skip it.
 * Nothing is sanitized or rewritten: an id that is not canonical is refused, because quietly
 * repairing an identifier at an external boundary is how a wrong id reaches a ledger looking right.
 */
export function assertIntakeRequestId(requestId) {
  if (!isWorkIntakeId(requestId)) {
    throw new Error("requestId must be a stable 3-80 character uppercase work-intake identifier");
  }
  return requestId;
}

export const intakeLocation = (requestId) => `${BASE}/${assertIntakeRequestId(requestId)}.work.json`;
export const resultDirectory = (requestId) => `${BASE}/results/${assertIntakeRequestId(requestId)}`;

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
