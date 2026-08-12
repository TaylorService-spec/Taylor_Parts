import { createHash } from "node:crypto";
import { posix } from "node:path";

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export const patchSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function normalize(value) {
  const path = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.includes("../") || path === "..") throw new Error(`unsafe repository path: ${value}`);
  return posix.normalize(path);
}

function regexForGlob(glob) {
  const safe = normalize(glob);
  let out = "^";
  for (let i = 0; i < safe.length; i += 1) {
    const char = safe[i];
    if (char === "*" && safe[i + 1] === "*") { out += ".*"; i += 1; }
    else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

export function pathMatchesScope(path, scope) {
  const normalized = normalize(path);
  return Array.isArray(scope) && scope.some((entry) => {
    try { return regexForGlob(entry).test(normalized); } catch { return false; }
  });
}

export function validatePatchPaths(paths, scope) {
  const normalized = [...new Set(paths.map(normalize))].sort();
  const rejected = normalized.filter((path) => !pathMatchesScope(path, scope));
  return Object.freeze({ ok: rejected.length === 0, paths: Object.freeze(normalized), rejected: Object.freeze(rejected) });
}

export function buildPatchManifest({ requestId, sourceWorkSha256, baseCommit, scope, paths, patchBytes, createdAt, recovery = null }) {
  if (!requestId || !SHA256.test(sourceWorkSha256 || "") || !COMMIT.test(baseCommit || "")) throw new Error("valid request, work hash, and 40-character base commit are required");
  const validation = validatePatchPaths(paths, scope);
  const sha256 = patchSha256(patchBytes);
  const root = `docs/orchestration/work-intake/results/${requestId}`;
  const body = {
    schema: "eos.intake.patch/1", requestId, sourceWorkSha256, baseCommit,
    scope: [...scope], paths: [...validation.paths], scopeValidation: validation.ok ? "PASS" : "REJECTED",
    rejectedPaths: [...validation.rejected], patchLocation: `${root}/${sha256}.patch`, patchSha256: sha256,
    integrationState: validation.ok ? "AWAITING_EXPLICIT_APPROVAL" : "BLOCKED_SCOPE", createdAt,
    recovery,
  };
  const manifestSha = patchSha256(Buffer.from(JSON.stringify(body, null, 2) + "\n"));
  return Object.freeze({ ...body, artifactLocation: `${root}/${manifestSha}.patch.json`, sha256: manifestSha });
}

export function verifyPatchManifest(manifest, patchBytes, { requestId, currentBase = null } = {}) {
  const errors = [];
  if (manifest?.schema !== "eos.intake.patch/1") errors.push("unsupported patch schema");
  if (manifest?.requestId !== requestId) errors.push("requestId mismatch");
  if (!COMMIT.test(manifest?.baseCommit || "")) errors.push("invalid base commit");
  if (currentBase && manifest?.baseCommit !== currentBase) errors.push("stale base commit");
  if (patchSha256(patchBytes) !== manifest?.patchSha256) errors.push("patch hash mismatch");
  const validation = validatePatchPaths(manifest?.paths || [], manifest?.scope || []);
  if (!validation.ok || manifest?.scopeValidation !== "PASS") errors.push("patch paths are outside approved scope");
  if (manifest?.integrationState !== "AWAITING_EXPLICIT_APPROVAL") errors.push("patch is not awaiting explicit approval");
  if (manifest?.artifactLocation && manifest?.sha256) {
    const { artifactLocation: _location, sha256: _sha, ...body } = manifest;
    const expected = patchSha256(Buffer.from(JSON.stringify(body, null, 2) + "\n"));
    if (expected !== manifest.sha256 || !manifest.artifactLocation.endsWith(`/${expected}.patch.json`)) errors.push("manifest hash mismatch");
  } else errors.push("manifest identity is required");
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
