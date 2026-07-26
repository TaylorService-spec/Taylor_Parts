"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_PERSONAS = Object.freeze([
  "admin",
  "dispatcher",
  "PARTS_MANAGER",
  "WAREHOUSE_MANAGER",
  "technician",
]);

const OPERATIONS = Object.freeze([
  { id: "parts-list", method: "GET", target: "parts", expected: { allow: [200], deny: [403] } },
  { id: "parts-single", method: "GET", target: "parts/__governed_missing_probe__", expected: { allow: [404], deny: [403] } },
  { id: "parts-create", method: "POST", target: "parts?documentId=__governed_denied_probe__", body: { fields: { probe: { booleanValue: true } } }, expected: { all: [403] } },
  { id: "parts-update", method: "PATCH", target: "parts/__governed_denied_probe__?updateMask.fieldPaths=probe", body: { fields: { probe: { booleanValue: true } } }, expected: { all: [403] } },
  { id: "parts-delete", method: "DELETE", target: "parts/__governed_denied_probe__", expected: { all: [403] } },
  { id: "manufacturers-read", method: "GET", target: "manufacturers", expected: { all: [403] } },
  { id: "manufacturers-write", method: "POST", target: "manufacturers?documentId=__governed_denied_probe__", body: { fields: { probe: { booleanValue: true } } }, expected: { all: [403] } },
  { id: "part-aliases-read", method: "GET", target: "part_aliases", expected: { all: [403] } },
  { id: "part-aliases-write", method: "POST", target: "part_aliases?documentId=__governed_denied_probe__", body: { fields: { probe: { booleanValue: true } } }, expected: { all: [403] } },
  { id: "part-supplier-items-read", method: "GET", target: "part_supplier_items", expected: { all: [403] } },
  { id: "part-supplier-items-write", method: "POST", target: "part_supplier_items?documentId=__governed_denied_probe__", body: { fields: { probe: { booleanValue: true } } }, expected: { all: [403] } },
]);

const ALLOW_PARTS_READ = new Set(["admin", "dispatcher", "PARTS_MANAGER", "WAREHOUSE_MANAGER"]);
const SECRET_PATTERN = /(AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|password|refreshToken|idToken|email)/i;

class VerificationError extends Error {}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new VerificationError("Config must be an object.");
  if (config.projectId !== "taylor-parts") throw new VerificationError("projectId must be exactly taylor-parts.");
  if (config.confirmProject !== config.projectId) throw new VerificationError("confirmProject must exactly match projectId.");
  if (!/^[0-9a-f]{40}$/.test(config.governedCommit || "")) throw new VerificationError("governedCommit must be a full 40-character Git SHA.");
  if (!/^[0-9a-f]{64}$/.test(config.governedRulesSha256 || "")) throw new VerificationError("governedRulesSha256 must be a SHA-256.");
  if (!/^[A-Z][A-Z0-9_]*$/.test(config.webApiKeyEnv || "")) throw new VerificationError("webApiKeyEnv must name an environment variable.");
  const labels = (config.personas || []).map((p) => p.label);
  if (canonicalJson([...labels].sort()) !== canonicalJson([...REQUIRED_PERSONAS].sort())) {
    throw new VerificationError(`personas must contain exactly: ${REQUIRED_PERSONAS.join(", ")}.`);
  }
  for (const persona of config.personas) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(persona.emailEnv || "") || !/^[A-Z][A-Z0-9_]*$/.test(persona.passwordEnv || "")) {
      throw new VerificationError(`Persona ${persona.label} must reference email/password environment variables.`);
    }
  }
  return config;
}

function expectedStatuses(persona, operation) {
  if (operation.expected.all) return operation.expected.all;
  return operation.expected[ALLOW_PARTS_READ.has(persona) ? "allow" : "deny"];
}

function interpretStatus(persona, operation, status) {
  const expected = expectedStatuses(persona, operation);
  return {
    expected,
    pass: expected.includes(status),
    interpretation: status === 200 ? "ALLOW" : status === 404 ? "ALLOW_NOT_FOUND" : status === 403 ? "DENY" : "UNEXPECTED",
  };
}

function normalizeFunctionsInventory(payload) {
  const functions = Array.isArray(payload.functions) ? payload.functions : [];
  return functions.map((fn) => ({
    name: fn.name || "",
    environment: fn.environment || "",
    state: fn.state || "",
    updateTime: fn.updateTime || "",
    build: fn.buildConfig ? {
      entryPoint: fn.buildConfig.entryPoint || "",
      runtime: fn.buildConfig.runtime || "",
    } : {},
    service: fn.serviceConfig ? {
      serviceAccountIdentityHash: fn.serviceConfig.serviceAccountEmail
        ? sha256(fn.serviceConfig.serviceAccountEmail)
        : "",
    } : {},
    eventTrigger: fn.eventTrigger ? {
      eventType: fn.eventTrigger.eventType || "",
      triggerRegion: fn.eventTrigger.triggerRegion || "",
    } : {},
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function verifyDeploymentLog(text) {
  const lower = text.toLowerCase();
  if (!lower.includes("deploying firestore") || !lower.includes("released rules firestore.rules")) {
    throw new VerificationError("Deployment log does not prove a Firestore Rules deployment.");
  }
  const prohibited = ["deploying functions", "deploying hosting", "deploying storage", "deploying extensions"];
  const found = prohibited.filter((needle) => lower.includes(needle));
  if (found.length) throw new VerificationError(`Deployment log includes prohibited scope: ${found.join(", ")}.`);
  return { firestoreRulesOnly: true, deploymentLogSha256: sha256(text) };
}

function extractRulesSource(apiPayload) {
  const files = apiPayload && apiPayload.source && apiPayload.source.files;
  if (!Array.isArray(files) || files.length === 0) throw new VerificationError("Live Rules API response has no source files.");
  const file = files.find((item) => String(item.name || "").endsWith("firestore.rules")) || files[0];
  if (typeof file.content !== "string" || !file.content.startsWith("rules_version")) {
    throw new VerificationError("Extracted live Rules source is empty or malformed.");
  }
  return file.content;
}

function assertEvidenceSecretFree(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (SECRET_PATTERN.test(text)) throw new VerificationError("Potential secret or identity data detected in evidence.");
}

function writeEvidence(outDir, files) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const sums = [];
  for (const [name, value] of Object.entries(files)) {
    assertEvidenceSecretFree(value);
    const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
    const target = path.join(outDir, name);
    fs.writeFileSync(target, text, { mode: 0o600 });
    sums.push(`${sha256(text)}  ${name}`);
  }
  fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), `${sums.sort().join("\n")}\n`, { mode: 0o600 });
}

module.exports = {
  ALLOW_PARTS_READ,
  OPERATIONS,
  REQUIRED_PERSONAS,
  VerificationError,
  assertEvidenceSecretFree,
  canonicalJson,
  expectedStatuses,
  extractRulesSource,
  interpretStatus,
  normalizeFunctionsInventory,
  sha256,
  validateConfig,
  verifyDeploymentLog,
  writeEvidence,
};
