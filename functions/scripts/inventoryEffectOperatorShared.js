// INV-1 Phase 0, PR 0.2 -- shared helpers for the inventory-effect
// operator tools (auditInventoryEffects.js / retryInventoryEffects.js).
//
// Deliberately Phase-0-focused (per the PR 0.2 authorization: "Do not
// over-engineer a general CLI framework"). No Firebase import here --
// everything in this file is pure/local-filesystem so both scripts'
// safety logic is unit-testable without credentials or an emulator.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_PROJECT_ID = "taylor-parts";
const SCRIPT_VERSION = "inv1-phase0-pr02";

class InvalidInvocationError extends Error {}

// ---------------------------------------------------------------------------
// CLI parsing -- tiny, flag-oriented, deterministic. Supports:
//   --flag value | --flag=value | bare --flag (boolean true)
// Repeatable flags collect into arrays when listed in `repeatable`.
// ---------------------------------------------------------------------------
function parseCliArgs(argv, { repeatable = [] } = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new InvalidInvocationError(`Unexpected positional argument: ${token}`);
    }
    let key;
    let value;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      key = token.slice(2, eq);
      value = token.slice(eq + 1);
    } else {
      key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i++;
      } else {
        value = true; // bare boolean flag
      }
    }
    if (repeatable.includes(key)) {
      if (!Array.isArray(args[key])) args[key] = [];
      if (value === true) {
        throw new InvalidInvocationError(`--${key} requires a value`);
      }
      args[key].push(value);
    } else if (key in args) {
      throw new InvalidInvocationError(`Duplicate flag: --${key}`);
    } else {
      args[key] = value;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Project safety. Same convention family as auditLegacyJobTechnicianData.js:
// no default project, explicit confirmation, checked BEFORE any Firebase
// initialization. The Owner-specified shape --confirm-project <id> must
// exactly match --project-id <id>; production never runs implicitly.
// ---------------------------------------------------------------------------
function assertProjectConfirmation(args) {
  const projectId = args["project-id"];
  const confirm = args["confirm-project"];
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new InvalidInvocationError(
      "--project-id <id> is required (no default project, ever)."
    );
  }
  if (typeof confirm !== "string" || confirm.length === 0) {
    throw new InvalidInvocationError(
      "--confirm-project <id> is required and must exactly match --project-id."
    );
  }
  if (confirm !== projectId) {
    throw new InvalidInvocationError(
      `--confirm-project (${confirm}) does not match --project-id (${projectId}); refusing to run.`
    );
  }
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || null;
  return {
    projectId,
    isProduction: projectId === PRODUCTION_PROJECT_ID && !emulatorHost,
    emulatorHost,
  };
}

// ---------------------------------------------------------------------------
// Canonical JSON: recursively key-sorted so artifacts are byte-deterministic
// for identical logical content (checksums become meaningful).
// ---------------------------------------------------------------------------
function canonicalJson(value) {
  return JSON.stringify(sortValue(value), null, 2) + "\n";
}
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Evidence artifact writing (docs/governance/audit-artifact-standard.md):
// operator-specified output directory, canonical JSON files, a
// checksums.sha256 manifest, and a basic sensitive-value scan result.
// Local filesystem ONLY -- never Firestore.
// ---------------------------------------------------------------------------
const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"private_key"/i,
  /AIza[0-9A-Za-z_-]{20,}/, // Google API key shape
  /Bearer [A-Za-z0-9._-]{20,}/,
  /client_secret/i,
];

function scanSensitive(text) {
  return SENSITIVE_PATTERNS.filter((re) => re.test(text)).map((re) => String(re));
}

function writeEvidenceArtifacts(outputDir, files) {
  fs.mkdirSync(outputDir, { recursive: true });
  const checksumLines = [];
  const sensitiveFindings = {};
  for (const [name, value] of Object.entries(files)) {
    const text = typeof value === "string" ? value : canonicalJson(value);
    fs.writeFileSync(path.join(outputDir, name), text, "utf8");
    checksumLines.push(`${sha256Hex(text)}  ${name}`);
    const hits = scanSensitive(text);
    if (hits.length > 0) sensitiveFindings[name] = hits;
  }
  const sensitiveReport =
    Object.keys(sensitiveFindings).length === 0
      ? "CLEAN: no sensitive-value pattern matched any artifact\n"
      : `FINDINGS:\n${canonicalJson(sensitiveFindings)}`;
  fs.writeFileSync(path.join(outputDir, "sensitive-scan.txt"), sensitiveReport, "utf8");
  checksumLines.push(`${sha256Hex(sensitiveReport)}  sensitive-scan.txt`);
  fs.writeFileSync(
    path.join(outputDir, "checksums.sha256"),
    checksumLines.join("\n") + "\n",
    "utf8"
  );
  return {
    written: [...Object.keys(files), "sensitive-scan.txt", "checksums.sha256"],
    sensitiveClean: Object.keys(sensitiveFindings).length === 0,
  };
}

// ---------------------------------------------------------------------------
// Retry-batch input validation/normalization (used by retryInventoryEffects
// and its tests). Pure. Duplicates are deterministically de-duplicated and
// reported, never silently dropped.
// ---------------------------------------------------------------------------
function normalizeRetryBatch(rawEntries, triggerStates) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new InvalidInvocationError(
      "Retry input must be a non-empty JSON array of { workOrderId, state } objects."
    );
  }
  const seen = new Set();
  const pairs = [];
  const duplicates = [];
  const invalid = [];
  for (const entry of rawEntries) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.workOrderId !== "string" ||
      entry.workOrderId.length === 0 ||
      typeof entry.state !== "string"
    ) {
      invalid.push({ entry, reason: "MALFORMED_ENTRY" });
      continue;
    }
    const extraKeys = Object.keys(entry).filter((k) => k !== "workOrderId" && k !== "state");
    if (extraKeys.length > 0) {
      invalid.push({ entry, reason: "UNEXPECTED_KEYS", extraKeys });
      continue;
    }
    if (!triggerStates.includes(entry.state)) {
      invalid.push({ entry, reason: "UNSUPPORTED_STATE" });
      continue;
    }
    const key = `${entry.workOrderId}::${entry.state}`;
    if (seen.has(key)) {
      duplicates.push({ workOrderId: entry.workOrderId, state: entry.state });
      continue;
    }
    seen.add(key);
    pairs.push({ workOrderId: entry.workOrderId, state: entry.state });
  }
  return { pairs, duplicates, invalid };
}

module.exports = {
  PRODUCTION_PROJECT_ID,
  SCRIPT_VERSION,
  InvalidInvocationError,
  parseCliArgs,
  assertProjectConfirmation,
  canonicalJson,
  sha256Hex,
  scanSensitive,
  writeEvidenceArtifacts,
  normalizeRetryBatch,
};
