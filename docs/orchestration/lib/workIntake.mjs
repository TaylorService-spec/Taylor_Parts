// Governed Owner/ChatGPT work intake — pure contract + bridge projection.
//
// This is an ingress adapter to the EXISTING selector/Wake Supervisor contracts. It is not a
// backlog, queue, selector, scheduler, authority, or execution mechanism. I/O stays in the runner.

import { createHash } from "node:crypto";

export const INTAKE_STATUS = Object.freeze([
  "DISCOVERY", "DESIGN_STAGING", "EOS_READY", "EXECUTION_AUTHORIZED",
]);
export const AUTHORIZATION_STATE = Object.freeze([
  "UNAUTHORIZED", "REPO_SAFE", "OWNER_REQUIRED", "AUTHORIZED",
]);
export const RESULT_STATUS = Object.freeze(["COMPLETE", "FAILED"]);

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REPO_LOCATION = /^docs\/orchestration\/work-intake\/[A-Za-z0-9._/-]+$/;

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// `sha256` is the digest of the canonical envelope with that one self-referential field omitted.
export function intakeDigest(artifact) {
  const { sha256: _omitted, ...payload } = artifact || {};
  return sha256Bytes(Buffer.from(stableJson(payload), "utf8"));
}

export function validateWorkIntake(a) {
  const errors = [];
  const need = (condition, message) => { if (!condition) errors.push(message); };
  need(a && typeof a === "object" && !Array.isArray(a), "artifact must be an object");
  if (!a || typeof a !== "object") return errors;
  need(typeof a.requestId === "string" && /^[A-Z0-9][A-Z0-9._-]{2,79}$/.test(a.requestId), "requestId must be a stable 3-80 character uppercase identifier");
  need(typeof a.title === "string" && a.title.trim().length > 0, "title is required");
  need(typeof a.intent === "string" && a.intent.trim().length > 0, "intent is required");
  need(Array.isArray(a.scope) && a.scope.length > 0 && a.scope.every((v) => typeof v === "string" && v.length > 0), "scope must be a non-empty string array");
  need(Array.isArray(a.contextScope) && a.contextScope.length > 0 && a.contextScope.every((v) => typeof v === "string" && v.length > 0), "contextScope must be a non-empty C-7 scope-tag array");
  need(a.source && typeof a.source === "object" && typeof a.source.producer === "string" && typeof a.source.provenance === "string", "source.producer and source.provenance are required");
  need(INTAKE_STATUS.includes(a.status), `status must be one of ${INTAKE_STATUS.join("/")}`);
  need(a.authority && AUTHORIZATION_STATE.includes(a.authority.authorizationState), `authority.authorizationState must be one of ${AUTHORIZATION_STATE.join("/")}`);
  need(typeof a.authority?.basis === "string" && a.authority.basis.length > 0, "authority.basis is required");
  need(typeof a.artifactLocation === "string" && REPO_LOCATION.test(a.artifactLocation) && !a.artifactLocation.includes(".."), "artifactLocation must be a safe repo-relative work-intake path");
  need(typeof a.sha256 === "string" && SHA256.test(a.sha256), "sha256 must be 64 lowercase hex characters");
  need(typeof a.createdAt === "string" && ISO_DATE.test(a.createdAt), "createdAt must be an ISO-8601 UTC timestamp");
  need(typeof a.updatedAt === "string" && ISO_DATE.test(a.updatedAt), "updatedAt must be an ISO-8601 UTC timestamp");
  need(!a.createdAt || !a.updatedAt || Date.parse(a.updatedAt) >= Date.parse(a.createdAt), "updatedAt must not precede createdAt");
  need(a.relatedRefs && Array.isArray(a.relatedRefs.issues) && Array.isArray(a.relatedRefs.pullRequests), "relatedRefs.issues and relatedRefs.pullRequests must be arrays");
  if (a.status === "EXECUTION_AUTHORIZED") {
    need(a.authority?.authorizationState === "AUTHORIZED", "EXECUTION_AUTHORIZED requires authority.authorizationState AUTHORIZED");
    need(a.authority?.protectedBoundary == null, "EXECUTION_AUTHORIZED cannot carry a protectedBoundary");
  }
  if (a.authority?.authorizationState === "OWNER_REQUIRED") {
    need(typeof a.authority.ownerQuestion === "string" && a.authority.ownerQuestion.length > 0, "OWNER_REQUIRED requires authority.ownerQuestion");
  }
  return errors;
}

export function resolveWorkIntake({ requestId, location, sha256, bytes }) {
  if (!SHA256.test(sha256 || "")) throw new Error("resolveWorkIntake: expected sha256 must be 64 lowercase hex characters");
  let artifact;
  try { artifact = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes)); }
  catch (error) { throw new Error(`resolveWorkIntake: invalid JSON (${error.message})`); }
  const errors = validateWorkIntake(artifact);
  if (errors.length) throw new Error(`resolveWorkIntake: invalid artifact: ${errors.join("; ")}`);
  if (artifact.requestId !== requestId) throw new Error(`resolveWorkIntake: requestId mismatch (${artifact.requestId} != ${requestId})`);
  if (artifact.artifactLocation !== location) throw new Error(`resolveWorkIntake: location mismatch (${artifact.artifactLocation} != ${location})`);
  if (artifact.sha256 !== sha256) throw new Error("resolveWorkIntake: pointer hash does not match artifact sha256 field");
  const computed = intakeDigest(artifact);
  if (computed !== sha256) throw new Error(`resolveWorkIntake: hash mismatch (${computed} != ${sha256})`);
  return Object.freeze({ ...artifact, scope: Object.freeze([...artifact.scope]) });
}

export function intakeToWorkItem(artifact, { sourceCommit = null } = {}) {
  const ownerRequired = artifact.authority.authorizationState === "OWNER_REQUIRED";
  const executionAuthorized = artifact.status === "EXECUTION_AUTHORIZED";
  const state = ownerRequired ? "OWNER_DECISION" : "READY";
  return Object.freeze({
    id: artifact.requestId,
    title: artifact.title,
    purpose: artifact.intent,
    scope: [...artifact.contextScope],
    allowedSurfaces: [...artifact.scope],
    state,
    status: state,
    authorized: executionAuthorized,
    protectedBoundary: artifact.authority.protectedBoundary ?? null,
    sha: sourceCommit ?? artifact.sha256,
    artifactLocation: artifact.artifactLocation,
    artifactSha256: artifact.sha256,
    workstream: "EOS_INTAKE",
    modelTier: "standard",
    ownerQuestion: ownerRequired ? artifact.authority.ownerQuestion : null,
  });
}

export const workPointer = (requestId) => `work://${requestId}`;
export const statusPointer = (requestId) => `status://${requestId}`;
export const resultPointer = (requestId) => `result://${requestId}`;

export function buildContentAddressedResult({ request, outputBytes, status = "COMPLETE", summary, createdAt, artifactRefs = [], relatedRefs = null }) {
  if (!RESULT_STATUS.includes(status)) throw new Error(`buildContentAddressedResult: unknown status ${status}`);
  if (!request?.requestId || !request?.sha256) throw new Error("buildContentAddressedResult: resolved request is required");
  if (!ISO_DATE.test(createdAt || "")) throw new Error("buildContentAddressedResult: createdAt must be ISO-8601 UTC");
  if (typeof summary !== "string" || summary.length === 0 || summary.length > 1200) throw new Error("buildContentAddressedResult: summary must be 1-1200 characters");
  const sourceText = Buffer.isBuffer(outputBytes) ? outputBytes.toString("utf8") : String(outputBytes);
  const content = Buffer.from(sourceText.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
  const contentSha256 = sha256Bytes(content);
  const base = `docs/orchestration/work-intake/results/${request.requestId}`;
  const contentLocation = `${base}/${contentSha256}.content.md`;
  const manifestWithoutHash = {
    resultId: `${request.requestId}:${contentSha256.slice(0, 16)}`,
    requestId: request.requestId,
    routedBackTo: "EOS_INTAKE",
    sourceWorkSha256: request.sha256,
    status,
    verdict: "NOT_APPLICABLE",
    disposition: "AWAITING_INTERPRETATION",
    summary,
    contentLocation,
    contentSha256,
    findings: [],
    evidence: [{ artifactLocation: contentLocation, sha256: contentSha256 }, ...artifactRefs],
    questionsRaised: [],
    scenariosDiscovered: [],
    retries: 0,
    contextExpanded: false,
    contaminated: false,
    retracted: false,
    metrics: {},
    relatedRefs: relatedRefs ?? request.relatedRefs,
    createdAt,
    pointer: resultPointer(request.requestId),
  };
  const manifestSha256 = sha256Bytes(Buffer.from(stableJson(manifestWithoutHash), "utf8"));
  const manifestLocation = `${base}/${manifestSha256}.result.json`;
  return Object.freeze({
    content,
    contentLocation,
    manifestLocation,
    manifest: Object.freeze({ ...manifestWithoutHash, artifactLocation: manifestLocation, sha256: manifestSha256 }),
  });
}
