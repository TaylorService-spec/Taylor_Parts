import { sha256Bytes, stableJson } from "./workIntake.mjs";

const SAFE_ID = /^[A-Z0-9][A-Z0-9._-]{2,79}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const verifiedArtifacts = new WeakSet();

export const authorizationPointer = (reviewId) => `authorization://${reviewId}`;
export const reviewAuthorizationDigest = (artifact) => {
  const { sha256: _omitted, ...canonical } = artifact || {};
  return sha256Bytes(Buffer.from(stableJson(canonical), "utf8"));
};

export function validateReviewAuthorization(a) {
  const errors = [];
  const need = (condition, message) => { if (!condition) errors.push(message); };
  need(a && typeof a === "object", "authorization artifact is required");
  if (!a || typeof a !== "object") return errors;
  need(SAFE_ID.test(a.workId || "") && SAFE_ID.test(a.reviewId || ""), "workId and reviewId must be stable uppercase identifiers");
  need(a.capability === "OPENAI_REVIEW", "capability must be OPENAI_REVIEW");
  need(["AUTHORIZED", "UNAUTHORIZED"].includes(a.authorizationState), "work authorization state is invalid");
  need(["AUTHORIZED", "UNAUTHORIZED"].includes(a.budgetAuthorizationState), "budget authorization state is invalid");
  need(typeof a.maxSpendUsd === "number" && Number.isFinite(a.maxSpendUsd) && a.maxSpendUsd > 0, "maxSpendUsd must be positive and finite");
  need(GIT_SHA.test(a.sourceCommit || ""), "sourceCommit must be an exact Git SHA");
  need(typeof a.provenance === "string" && a.provenance.length > 0, "provenance is required");
  need(typeof a.authorizedBy?.subject === "string" && typeof a.authorizedBy?.oauthClientId === "string", "authenticated authorizer provenance is required");
  need(a.artifactLocation === `docs/orchestration/work-intake/authorizations/${a.workId}/${a.reviewId}.authorization.json`, "authorization artifact location mismatch");
  need(SHA256.test(a.sha256 || ""), "sha256 is required");
  return errors;
}

export function buildReviewAuthorization(input, auth, now = new Date().toISOString()) {
  const payload = {
    workId: input.workId, reviewId: input.reviewId, capability: "OPENAI_REVIEW",
    authorizationState: input.authorizationState || "AUTHORIZED", budgetAuthorizationState: input.budgetAuthorizationState || "AUTHORIZED", maxSpendUsd: input.maxSpendUsd,
    sourceCommit: input.sourceCommit, provenance: input.provenance,
    authorizedBy: { subject: auth.subject, oauthClientId: auth.clientId }, createdAt: now,
    artifactLocation: `docs/orchestration/work-intake/authorizations/${input.workId}/${input.reviewId}.authorization.json`, sha256: "",
  };
  payload.sha256 = reviewAuthorizationDigest(payload);
  const errors = validateReviewAuthorization(payload);
  if (errors.length) throw new Error(errors.join("; "));
  return Object.freeze(payload);
}

export function resolveReviewAuthorization({ workId, reviewId, location, sha256, bytes }) {
  let artifact;
  try { artifact = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes)); }
  catch { throw new Error("invalid review authorization JSON"); }
  const errors = validateReviewAuthorization(artifact);
  if (errors.length) throw new Error(errors.join("; "));
  if (artifact.workId !== workId || artifact.reviewId !== reviewId || artifact.artifactLocation !== location || artifact.sha256 !== sha256 || reviewAuthorizationDigest(artifact) !== sha256) throw new Error("review authorization ID/location/hash mismatch");
  const resolved = Object.freeze({ ...artifact });
  verifiedArtifacts.add(resolved);
  return resolved;
}

export const isVerifiedReviewAuthorization = (artifact) => Boolean(artifact && verifiedArtifacts.has(artifact));
export const serializeReviewAuthorization = (artifact) => `${JSON.stringify(artifact, null, 2)}\n`;
