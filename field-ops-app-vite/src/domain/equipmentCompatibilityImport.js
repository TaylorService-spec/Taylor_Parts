// D3 pure import DRY-RUN tooling for governed Equipment Model + Part–Equipment Compatibility
// ingest (architecture §9–§11). There is NO apply/execute mode. This module never initializes any
// Firebase Admin/client SDK and performs no Firestore, Auth, network, deployment, or production
// access. Callers pass already-decoded file CONTENTS as strings (input files stay read-only) plus
// EXPLICIT authority snapshots; the module only analyzes and returns a sanitized, zero-write plan.
// All normalization/validation is delegated to the merged D1 (Equipment Model) and D2
// (Compatibility) contracts — no competing implementation, no invented data.
import { detectModelAliasConflicts, validateEquipmentModel, validateEquipmentModelAlias } from "./equipmentModel.js";
import { analyzeCompatibilityEvidenceByRelationship, detectCompatibilityCollisions, detectCompatibilitySourceCollisions, validateCompatibility, validateCompatibilitySource } from "./equipmentCompatibility.js";

const asciiCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// True if the text contains any C0/C1/DEL control char other than TAB, LF, or CR (which are valid
// CSV structure). Implemented as a code-point scan to avoid a control-character regex literal.
const hasDisallowedControl = (s) => {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if ((c < 9 || (c > 9 && c < 10) || (c > 10 && c < 13) || (c > 13 && c < 32) || c === 127)) return true; }
  return false;
};

export const DEFAULT_LIMITS = Object.freeze({ maxFileChars: 1_000_000, maxRows: 10_000, maxFieldChars: 2_048, maxErrorRefs: 200 });

// Exact header allowlists per architecture-defined package. Unknown, missing, or duplicate headers
// are rejected. Market listings are EVIDENCE-ONLY QUARANTINE and never produce authoritative output.
export const IMPORT_PACKAGES = Object.freeze({
  EQUIPMENT_MASTER: ["equipmentModelId", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status", "sourceAuthority", "version"],
  EQUIPMENT_MODEL_ALIASES: ["aliasType", "manufacturerId", "rawValue", "equipmentModelId"],
  EQUIPMENT_PART_COMPATIBILITY: ["equipmentModelId", "partId", "compatibilityType", "assembly", "installationPosition", "quantityRequired", "applicabilityKind", "serialScheme", "serialRangeStart", "serialRangeEnd", "modelRevision", "effectiveFrom", "effectiveTo", "sourceSummary", "confidenceLevel", "verificationStatus", "notes", "version"],
  COMPATIBILITY_SOURCES: ["compatibilityId", "authorityType", "sourceReference", "sourceVersion", "observedClaim", "contentFingerprint", "capturedAt", "capturedBy", "notes"],
  MARKET_LISTINGS: ["listingId", "marketplace", "claimedManufacturer", "claimedModel", "claimedPartRef", "listingUrl", "capturedAt"],
});

// ---------------------------------------------------------------------------
// Sensitive-data scan (never reproduces the matched value — line + code only).
// Legitimate 64-hex content fingerprints are NOT flagged; credentials/PII are.
// ---------------------------------------------------------------------------
const SENSITIVE_PATTERNS = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["phone", /(?:\+?\d[\d ().-]{8,}\d)/],
  ["credential_keyword", /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret|bearer)\b/i],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{20,}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/],
];
export function scanSensitive(text, packageName = "") {
  const findings = [];
  if (typeof text !== "string") return findings;
  text.split("\n").forEach((line, i) => {
    for (const [code, re] of SENSITIVE_PATTERNS) if (re.test(line)) findings.push({ package: packageName, line: i + 1, code });
  });
  return findings.sort((a, b) => a.line - b.line || asciiCompare(a.code, b.code));
}

// ---------------------------------------------------------------------------
// Strict CSV parsing (bounds + normalized line endings + UTF-8 sanity).
// ---------------------------------------------------------------------------
function splitCsvLine(line, maxFieldChars) {
  const fields = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') { if (cur !== "") return { error: "quote_in_unquoted_field" }; inQ = true; }
    else if (ch === ",") { if (cur.length > maxFieldChars) return { error: "field_too_long" }; fields.push(cur); cur = ""; }
    else cur += ch;
  }
  if (inQ) return { error: "unbalanced_quote" };
  if (cur.length > maxFieldChars) return { error: "field_too_long" };
  fields.push(cur);
  return { fields };
}

// Returns { headerError } OR { header, records:[{line, values}], rowErrors:[{line, field, code}] }.
export function parseCsv(text, header, limits = DEFAULT_LIMITS) {
  if (typeof text !== "string") return { headerError: "not_a_string" };
  if (text.length > limits.maxFileChars) return { headerError: "file_too_large" };
  if (text.includes("�")) return { headerError: "invalid_utf8" };
  if (text.charCodeAt(0) === 0xfeff) return { headerError: "bom_not_allowed" };
  if (hasDisallowedControl(text)) return { headerError: "control_characters" };
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) return { headerError: "invalid_line_ending" };
  const lines = normalized.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop(); // trailing newline
  if (lines.length === 0) return { headerError: "empty_file" };
  const head = splitCsvLine(lines[0], limits.maxFieldChars);
  if (head.error) return { headerError: head.error };
  const seen = new Set();
  for (const h of head.fields) { if (seen.has(h)) return { headerError: "duplicate_header" }; seen.add(h); }
  if (head.fields.length !== header.length || !header.every((h) => seen.has(h))) return { headerError: "header_mismatch" };
  if (lines.length - 1 > limits.maxRows) return { headerError: "too_many_rows" };
  const records = [], rowErrors = [];
  for (let r = 1; r < lines.length; r++) {
    const line = r + 1;
    if (lines[r] === "") { rowErrors.push({ line, field: null, code: "blank_row" }); continue; }
    const parsed = splitCsvLine(lines[r], limits.maxFieldChars);
    if (parsed.error) { rowErrors.push({ line, field: null, code: parsed.error }); continue; }
    if (parsed.fields.length !== head.fields.length) { rowErrors.push({ line, field: null, code: "column_count_mismatch" }); continue; }
    const values = {};
    head.fields.forEach((h, i) => { values[h] = parsed.fields[i]; });
    records.push({ line, values });
  }
  return { header: head.fields, records, rowErrors };
}

// ---------------------------------------------------------------------------
// Row → domain-record assembly (values are strings; typed fields are coerced
// ONLY structurally — an unparseable number stays a string so the strict D1/D2
// validator rejects it; unknown optional text becomes null, never invented).
// ---------------------------------------------------------------------------
const orNull = (s) => (typeof s === "string" && s.trim() !== "" ? s : null);
const intOrRaw = (s) => { const t = (s ?? "").trim(); return /^-?\d+$/.test(t) ? Number(t) : (t === "" ? null : s); };

function assembleCompatibility(v) {
  return {
    equipmentModelId: v.equipmentModelId, partId: v.partId, compatibilityType: v.compatibilityType,
    assembly: orNull(v.assembly), installationPosition: orNull(v.installationPosition), quantityRequired: intOrRaw(v.quantityRequired),
    applicability: { kind: v.applicabilityKind, serialScheme: orNull(v.serialScheme), serialRangeStart: orNull(v.serialRangeStart), serialRangeEnd: orNull(v.serialRangeEnd), modelRevision: orNull(v.modelRevision) },
    effectiveFrom: orNull(v.effectiveFrom), effectiveTo: orNull(v.effectiveTo), sourceSummary: orNull(v.sourceSummary),
    confidenceLevel: v.confidenceLevel, verificationStatus: v.verificationStatus, notes: orNull(v.notes), version: intOrRaw(v.version),
  };
}
function assembleSource(v) {
  return { compatibilityId: v.compatibilityId, authorityType: v.authorityType, sourceReference: v.sourceReference, sourceVersion: orNull(v.sourceVersion), observedClaim: v.observedClaim, contentFingerprint: v.contentFingerprint, capturedAt: v.capturedAt, capturedBy: v.capturedBy, notes: orNull(v.notes) };
}
function assembleModel(v) {
  return { equipmentModelId: v.equipmentModelId, manufacturerId: v.manufacturerId, manufacturerName: v.manufacturerName, modelNumber: v.modelNumber, displayName: v.displayName, family: orNull(v.family), subtype: orNull(v.subtype), revision: orNull(v.revision), status: v.status, sourceAuthority: v.sourceAuthority, version: intOrRaw(v.version) };
}

// ---------------------------------------------------------------------------
// Dry-run planner. Returns a sanitized, deterministic, zero-write report.
// ---------------------------------------------------------------------------
export function dryRunEquipmentCompatibilityImport({ packages = {}, snapshots = {}, limits = {} } = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const errors = [], unresolved = [], sensitive = [];
  const partIds = new Set(Array.isArray(snapshots.partIds) ? snapshots.partIds : []);
  const snapModelIds = new Set(Array.isArray(snapshots.equipmentModelIds) ? snapshots.equipmentModelIds : []);
  const existingCompatibilityIds = new Set(Array.isArray(snapshots.existingCompatibilityIds) ? snapshots.existingCompatibilityIds : []);
  const serialSchemes = plain(snapshots.serialSchemes) ? snapshots.serialSchemes : {};

  const pushErr = (pkg, line, field, code) => errors.push({ package: pkg, line, field, code });
  const counts = {};

  // Generic package parse + per-row validation. Returns validated records with their line numbers.
  const process = (pkg, header, assemble, validate) => {
    const text = packages[pkg];
    if (text === undefined) return [];
    scanSensitive(text, pkg).forEach((f) => sensitive.push(f));
    const parsed = parseCsv(text, header, lim);
    if (parsed.headerError) { pushErr(pkg, 1, null, parsed.headerError); counts[pkg] = { rows: 0, valid: 0 }; return []; }
    parsed.rowErrors.forEach((e) => pushErr(pkg, e.line, e.field, e.code));
    const valid = [];
    for (const rec of parsed.records) {
      const res = validate(assemble(rec.values));
      if (!res.valid) pushErr(pkg, rec.line, null, res.reason);
      else valid.push({ line: rec.line, value: res.value });
    }
    counts[pkg] = { rows: parsed.records.length, valid: valid.length };
    return valid;
  };

  const models = process("EQUIPMENT_MASTER", IMPORT_PACKAGES.EQUIPMENT_MASTER, assembleModel, validateEquipmentModel);
  const aliases = process("EQUIPMENT_MODEL_ALIASES", IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES, (v) => v, (v) => validateEquipmentModelAlias({ aliasType: v.aliasType, manufacturerId: v.manufacturerId, rawValue: v.rawValue, equipmentModelId: v.equipmentModelId }));
  const compat = process("EQUIPMENT_PART_COMPATIBILITY", IMPORT_PACKAGES.EQUIPMENT_PART_COMPATIBILITY, assembleCompatibility, (v) => validateCompatibility(v, { serialSchemes }));
  const sources = process("COMPATIBILITY_SOURCES", IMPORT_PACKAGES.COMPATIBILITY_SOURCES, assembleSource, validateCompatibilitySource);

  // Market listings: parsed + scanned + counted, then QUARANTINED. They can never create or activate
  // a model or establish verified compatibility, so they are never resolved into the plan.
  let marketListings = 0;
  if (packages.MARKET_LISTINGS !== undefined) {
    scanSensitive(packages.MARKET_LISTINGS, "MARKET_LISTINGS").forEach((f) => sensitive.push(f));
    const parsed = parseCsv(packages.MARKET_LISTINGS, IMPORT_PACKAGES.MARKET_LISTINGS, lim);
    if (parsed.headerError) pushErr("MARKET_LISTINGS", 1, null, parsed.headerError);
    else { parsed.rowErrors.forEach((e) => pushErr("MARKET_LISTINGS", e.line, e.field, e.code)); marketListings = parsed.records.length; }
  }

  // Reference resolution against explicit snapshots + in-batch valid models/compatibility.
  // Aliases cannot create models; sources cannot create relationships — an unresolved reference is a
  // visible error, never an invented identity.
  const batchModelIds = new Set(models.map((m) => m.value.equipmentModelId));
  const knownModelIds = new Set([...snapModelIds, ...batchModelIds]);
  for (const a of aliases) if (!knownModelIds.has(a.value.equipmentModelId)) unresolved.push({ package: "EQUIPMENT_MODEL_ALIASES", line: a.line, ref: "equipmentModelId", code: "equipment_model_unresolved" });
  for (const c of compat) {
    if (!knownModelIds.has(c.value.equipmentModelId)) unresolved.push({ package: "EQUIPMENT_PART_COMPATIBILITY", line: c.line, ref: "equipmentModelId", code: "equipment_model_unresolved" });
    if (!partIds.has(c.value.partId)) unresolved.push({ package: "EQUIPMENT_PART_COMPATIBILITY", line: c.line, ref: "partId", code: "part_unresolved" });
  }
  const batchCompatIds = new Set(compat.map((c) => c.value.compatibilityId));
  const knownCompatIds = new Set([...existingCompatibilityIds, ...batchCompatIds]);
  for (const s of sources) if (!knownCompatIds.has(s.value.compatibilityId)) unresolved.push({ package: "COMPATIBILITY_SOURCES", line: s.line, ref: "compatibilityId", code: "compatibility_unresolved" });

  // Duplicate / collision / alias-conflict analysis (deterministic, via D1/D2 contracts).
  const modelDup = detectModelDuplicates(models);
  // detectModelAliasConflicts re-validates raw alias records, so reconstruct the raw shape
  // (rawValue) from the normalized D1 value rather than passing the validated value object.
  const aliasConflicts = detectModelAliasConflicts(aliases.map((a) => ({ aliasType: a.value.aliasType, manufacturerId: a.value.manufacturerId, rawValue: a.value.aliasValue, equipmentModelId: a.value.equipmentModelId }))).conflicts;
  const compatCollisions = detectCompatibilityCollisions(compat.map((c) => c.value), { serialSchemes });
  const sourceCollisions = detectCompatibilitySourceCollisions(sources.map((s) => s.value));

  // Source precedence + evidence-conflict reporting (reseller/WO stay non-authoritative in D2).
  const evidence = analyzeCompatibilityEvidenceByRelationship(sources.map((s) => s.value)).relationships;
  const conflicts = evidence.filter((r) => r.recommendedStatus === "CONFLICT").map((r) => ({ compatibilityId: r.compatibilityId, strongestSupport: r.strongestSupport, strongestContradiction: r.strongestContradiction }));

  const hasBlocking = errors.length > 0 || unresolved.length > 0 || modelDup.collisions.length > 0 ||
    aliasConflicts.length > 0 || compatCollisions.collisions.length > 0 || sourceCollisions.collisions.length > 0;
  const status = hasBlocking ? "BLOCKED" : conflicts.length > 0 ? "REVIEW_REQUIRED" : "READY";

  // No partial apply: staged identity summary is populated ONLY when nothing blocks the whole batch.
  // Even then it is never applied (D3 has no apply mode) — it is an opaque-id summary for review.
  const staged = hasBlocking ? null : {
    equipmentModelIds: [...batchModelIds].sort(asciiCompare),
    modelAliasKeys: [...new Set(aliases.map((a) => a.value.aliasKey))].sort(asciiCompare),
    compatibilityIds: [...batchCompatIds].sort(asciiCompare),
    sourceIds: [...new Set(sources.map((s) => s.value.sourceId))].sort(asciiCompare),
  };

  const boundedErrors = sanitizeRefs(errors, lim.maxErrorRefs, (a, b) => asciiCompare(a.package, b.package) || a.line - b.line || asciiCompare(a.code, b.code));
  const boundedUnresolved = sanitizeRefs(unresolved, lim.maxErrorRefs, (a, b) => asciiCompare(a.package, b.package) || a.line - b.line || asciiCompare(a.code, b.code));

  return {
    dryRun: true, applyable: false, status,
    counts: { ...counts, quarantinedMarketListings: marketListings },
    errors: boundedErrors.refs, errorsTruncated: boundedErrors.truncated,
    unresolved: boundedUnresolved.refs, unresolvedTruncated: boundedUnresolved.truncated,
    collisions: {
      equipmentModels: modelDup.collisions.map((x) => ({ equipmentModelId: x.equipmentModelId, lines: x.lines })).sort((a, b) => asciiCompare(a.equipmentModelId, b.equipmentModelId)),
      modelAliasConflicts: aliasConflicts,
      compatibility: compatCollisions.collisions,
      sources: sourceCollisions.collisions,
    },
    duplicatesIdempotent: {
      equipmentModels: modelDup.duplicates.length, compatibility: compatCollisions.duplicates.length, sources: sourceCollisions.duplicates.length,
    },
    conflicts: conflicts.sort((a, b) => asciiCompare(a.compatibilityId, b.compatibilityId)),
    quarantine: { marketListings, authoritative: false },
    sensitive: { clean: sensitive.length === 0, findings: sensitive.sort((a, b) => asciiCompare(a.package, b.package) || a.line - b.line || asciiCompare(a.code, b.code)) },
    staged,
  };
}

// Group valid models by id; identical repeats are idempotent duplicates, differing content is a collision.
function detectModelDuplicates(models) {
  const byId = new Map();
  for (const m of models) { if (!byId.has(m.value.equipmentModelId)) byId.set(m.value.equipmentModelId, []); byId.get(m.value.equipmentModelId).push(m); }
  const collisions = [], duplicates = [];
  for (const [equipmentModelId, group] of byId) {
    if (group.length < 2) continue;
    const canonical = JSON.stringify(group[0].value);
    const lines = group.map((g) => g.line).sort((a, b) => a - b);
    (group.every((g) => JSON.stringify(g.value) === canonical) ? duplicates : collisions).push({ equipmentModelId, lines });
  }
  return { collisions, duplicates };
}

function sanitizeRefs(refs, max, cmp) {
  const sorted = [...refs].sort(cmp);
  return { refs: sorted.slice(0, max), truncated: Math.max(0, sorted.length - max) };
}
