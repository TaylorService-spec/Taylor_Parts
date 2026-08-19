// X-INVENTORY-CREATE-EXECUTOR-GRANT-MANIFEST -- pure, local validator for the `inventoryCreateExecutor` grant
// manifest (docs/provisioning/inventoryCreateExecutor-grant-manifest.template.json). Repository-only.
//
// WHAT THIS TOOL IS: an enforcement gate. Owner ruling (2026-08-18): "Do not assign inventoryCreateExecutor
// until its exact recipient and business need are presented. No provisioning or activation writes without a
// dry-run manifest and separate sandbox authorization." This script is what makes that a fact rather than a
// policy statement -- it refuses (throws / exits non-zero) to accept ANY manifest missing a named recipient
// or a stated business need, including the committed template (which is deliberately null in both fields).
//
// WHAT THIS TOOL IS NOT: it never calls Firestore, never calls firebase-admin, and never calls the actual
// trusted-writer grant command (assignApprovedRole, functions/src/access/trustedWriterCommands.ts -- a
// deployed Cloud Function, a separate protected action). Validating a manifest here grants NOTHING. This is
// the gate that must pass BEFORE an authorized operator is even handed a manifest to act on through that
// separate, already-governed command path.
"use strict";

const fs = require("node:fs");

const PLACEHOLDER_PATTERN = /^(tbd|todo|replace[_-]?me|n\/?a|xxx|unknown|pending|fixme)$/i;

function isFilled(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (PLACEHOLDER_PATTERN.test(trimmed)) return false;
  return true;
}

// Pure. No I/O. Throws with a specific field name on the first unfilled required field so a caller can
// report exactly what is missing, never a generic "invalid manifest".
function validateGrantManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest must be a JSON object");
  }
  if (manifest.roleId !== "inventoryCreateExecutor") {
    throw new Error(`manifest.roleId must be exactly "inventoryCreateExecutor"; got ${JSON.stringify(manifest.roleId)}`);
  }
  const recipient = manifest.recipient;
  if (!recipient || typeof recipient !== "object") {
    throw new Error("manifest.recipient must be an object with employeeId, principalUid, displayName");
  }
  if (!isFilled(recipient.employeeId)) {
    throw new Error("manifest.recipient.employeeId is required and must not be null/blank/a placeholder -- name the exact Employee this grant is for");
  }
  if (!isFilled(recipient.principalUid)) {
    throw new Error("manifest.recipient.principalUid is required and must not be null/blank/a placeholder -- name the exact uid assignApprovedRole would target");
  }
  if (!isFilled(recipient.displayName)) {
    throw new Error("manifest.recipient.displayName is required and must not be null/blank/a placeholder");
  }
  if (!isFilled(manifest.businessNeed)) {
    throw new Error("manifest.businessNeed is required and must not be null/blank/a placeholder -- state the specific approved CREATE run this grant serves");
  }
  if (manifest.businessNeed.trim().length < 20) {
    throw new Error("manifest.businessNeed must be a real sentence (>= 20 characters), not a stub");
  }
  if (!isFilled(manifest.approvedBy)) {
    throw new Error("manifest.approvedBy is required and must not be null/blank/a placeholder -- the authorized Owner/admin approving this grant");
  }
  if (!isFilled(manifest.authorizationReference)) {
    throw new Error("manifest.authorizationReference is required -- point at the specific Owner authorization (e.g. a dated ruling or issue) this manifest executes under");
  }
  if (!manifest.scope || manifest.scope.type !== "global") {
    throw new Error('manifest.scope.type must be exactly "global" (the only scope inventoryCreateExecutor is defined against today)');
  }
  return {
    roleId: manifest.roleId,
    recipient: { ...recipient },
    businessNeed: manifest.businessNeed,
    approvedBy: manifest.approvedBy,
    authorizationReference: manifest.authorizationReference,
    scope: { ...manifest.scope },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--manifest") args.manifestPath = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.manifestPath) throw new Error("--manifest is required");
  return args;
}

// No Firebase, no I/O beyond the one local file read -- this never touches any project.
function run(argv, readFileSync = fs.readFileSync) {
  const args = parseArgs(argv);
  const raw = readFileSync(args.manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const validated = validateGrantManifestShape(manifest);
  return validated;
}

module.exports = { validateGrantManifestShape, parseArgs, run, isFilled };

if (require.main === module) {
  try {
    const validated = run(process.argv.slice(2));
    console.log(`VALID grant manifest for roleId="${validated.roleId}" -> principalUid="${validated.recipient.principalUid}" (${validated.recipient.displayName}).`);
    console.log("This validates the MANIFEST only. It does not grant anything -- assignApprovedRole is a separate, deployed, governed command and its own authorization.");
  } catch (err) {
    console.error("REFUSED:", err.message);
    process.exitCode = 1;
  }
}
