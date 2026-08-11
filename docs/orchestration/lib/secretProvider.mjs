// EOS credential capability broker. Raw secret material never appears in status, errors, logs,
// artifacts, or MCP. The only secret-bearing boundary is the synchronous trusted callback.

import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { inspect } from "node:util";
import { isVerifiedReviewAuthorization } from "./reviewAuthorization.mjs";

export const SECRET_FAILURE = Object.freeze({
  NOT_CONFIGURED: "SECRET_NOT_CONFIGURED",
  DECRYPT_FAILED: "SECRET_DECRYPT_FAILED",
  UNSUPPORTED: "UNSUPPORTED_PLATFORM",
  NOT_ALLOWED: "CAPABILITY_NOT_ALLOWED",
  WORK_UNAUTHORIZED: "WORK_NOT_AUTHORIZED",
  BUDGET_UNAUTHORIZED: "BUDGET_NOT_AUTHORIZED",
  EXPOSURE_BLOCKED: "SECRET_EXPOSURE_BLOCKED",
  EXECUTION_FAILED: "CAPABILITY_EXECUTION_FAILED",
});

export const CAPABILITIES = Object.freeze({
  OPENAI_REVIEW: Object.freeze({ credentialId: "eos-openai-review", secretName: "OPENAI_API_KEY" }),
});

export class SecretBrokerError extends Error {
  constructor(code) { super(code); this.name = "SecretBrokerError"; this.code = code; }
}

const fail = (code) => { throw new SecretBrokerError(code); };
const safeName = (value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value);

export function defaultSecretRoot(env = process.env) {
  const root = env.LOCALAPPDATA;
  if (!root) fail(SECRET_FAILURE.UNSUPPORTED);
  return join(root, "EOS", "secrets");
}

export function validateCapabilityGrant(capability, grant = {}) {
  if (!CAPABILITIES[capability]) fail(SECRET_FAILURE.NOT_ALLOWED);
  if (!isVerifiedReviewAuthorization(grant) || grant.capability !== capability || grant.authorizationState !== "AUTHORIZED" || !grant.workId || !grant.reviewId || !/^[0-9a-f]{40}$/.test(grant.sourceCommit || "") || !grant.provenance) {
    fail(SECRET_FAILURE.WORK_UNAUTHORIZED);
  }
  if (grant.budgetAuthorizationState !== "AUTHORIZED" || typeof grant.maxSpendUsd !== "number" || !Number.isFinite(grant.maxSpendUsd) || grant.maxSpendUsd <= 0) {
    fail(SECRET_FAILURE.BUDGET_UNAUTHORIZED);
  }
  return Object.freeze({ ...grant });
}

function encodedPowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function resolveDpapiSecret(secretName, { platform = process.platform, secretRoot = defaultSecretRoot(), spawn = spawnSync } = {}) {
  if (platform !== "win32") fail(SECRET_FAILURE.UNSUPPORTED);
  if (!safeName(secretName)) fail(SECRET_FAILURE.NOT_ALLOWED);
  const path = join(secretRoot, `${secretName}.dpapi`);
  if (!existsSync(path)) fail(SECRET_FAILURE.NOT_CONFIGURED);
  const script = `$ErrorActionPreference='Stop';try{Add-Type -AssemblyName System.Security;$p=[IO.File]::ReadAllBytes($env:EOS_SECRET_PATH);$e=[Text.Encoding]::UTF8.GetBytes($env:EOS_SECRET_ENTROPY);$b=[Security.Cryptography.ProtectedData]::Unprotect($p,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($b));[Array]::Clear($b,0,$b.Length)}catch{exit 23}`;
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShell(script)], {
    encoding: "buffer", windowsHide: true, env: { ...process.env, EOS_SECRET_PATH: path, EOS_SECRET_ENTROPY: `EOS:secret:${secretName}:v1` }, maxBuffer: 1024 * 1024,
  });
  if (child.status !== 0 || !child.stdout?.length) fail(SECRET_FAILURE.DECRYPT_FAILED);
  let decoded;
  try {
    decoded = Buffer.from(child.stdout.toString("ascii"), "base64");
    const value = decoded.toString("utf8");
    if (!value) fail(SECRET_FAILURE.DECRYPT_FAILED);
    return value;
  } finally {
    child.stdout?.fill(0); child.stderr?.fill(0); decoded?.fill(0);
  }
}

function containsSecret(value, secret, seen = new WeakSet()) {
  if (typeof value === "string") return value.includes(secret);
  if (Buffer.isBuffer(value)) return value.includes(Buffer.from(secret));
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Error && containsSecret(value.message, secret, seen)) return true;
  if (value instanceof Map) return [...value.entries()].some(([key, item]) => containsSecret(key, secret, seen) || containsSecret(item, secret, seen));
  if (value instanceof Set) return [...value].some((item) => containsSecret(item, secret, seen));
  if (Object.values(value).some((item) => containsSecret(item, secret, seen))) return true;
  try { return inspect(value).includes(secret); } catch { return false; }
}

export function createSecretBroker({ platform = process.platform, secretRoot, resolveSecret = resolveDpapiSecret, logger = () => {} } = {}) {
  const root = secretRoot ?? (() => { try { return defaultSecretRoot(); } catch { return null; } })();
  const credentialStatus = (capability) => {
    const mapping = CAPABILITIES[capability];
    if (!mapping) fail(SECRET_FAILURE.NOT_ALLOWED);
    const available = platform === "win32" && Boolean(root) && existsSync(join(root, `${mapping.secretName}.dpapi`)) && statSync(join(root, `${mapping.secretName}.dpapi`)).size > 0;
    return Object.freeze({ capability, credentialAvailable: available, credentialId: mapping.credentialId, secretValue: "REDACTED" });
  };
  const withCredential = async (capability, authorizedInvocation, callback) => {
    const mapping = CAPABILITIES[capability];
    if (!mapping) fail(SECRET_FAILURE.NOT_ALLOWED);
    const grant = validateCapabilityGrant(capability, authorizedInvocation);
    if (typeof callback !== "function") fail(SECRET_FAILURE.NOT_ALLOWED);
    logger({ event: "CREDENTIAL_USE_STARTED", capability, workId: grant.workId, reviewId: grant.reviewId, credentialId: mapping.credentialId });
    let secret;
    try {
      try { secret = await resolveSecret(mapping.secretName, { platform, secretRoot: root }); }
      catch (error) { if (error instanceof SecretBrokerError) throw error; fail(SECRET_FAILURE.DECRYPT_FAILED); }
      let result;
      try { result = await callback(secret); }
      catch { fail(SECRET_FAILURE.EXECUTION_FAILED); }
      if (containsSecret(result, secret)) fail(SECRET_FAILURE.EXPOSURE_BLOCKED);
      logger({ event: "CREDENTIAL_USE_COMPLETED", capability, workId: grant.workId, reviewId: grant.reviewId, credentialId: mapping.credentialId });
      return result;
    } finally {
      secret = null;
    }
  };
  return Object.freeze({ credentialStatus, withCredential });
}

export const credentialStatus = (capability) => createSecretBroker().credentialStatus(capability);
export const withCredential = (capability, authorizedInvocation, callback) => createSecretBroker().withCredential(capability, authorizedInvocation, callback);
