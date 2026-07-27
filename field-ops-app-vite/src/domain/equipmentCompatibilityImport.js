// D3 pure import DRY-RUN tooling for governed Equipment Model + Part–Equipment Compatibility
// ingest (architecture §9–§11). There is NO apply/execute mode. This module never initializes any
// Firebase Admin/client SDK and performs no Firestore, Auth, network, deployment, or production
// access, and no file I/O. Callers pass already-DECODED JavaScript strings (input files stay
// read-only) plus EXPLICIT authority snapshots; the module only analyzes and returns a sanitized,
// zero-write plan. All normalization/validation is delegated to the merged D1 (Equipment Model) and
// D2 (Compatibility) contracts — no competing implementation, no invented data.
//
// UTF-8 scope: because the input is an already-decoded string, this parser rejects the Unicode
// REPLACEMENT CHARACTER (U+FFFD) and other disallowed decoded characters, but it CANNOT certify that
// the original byte stream was valid UTF-8. Byte-level UTF-8 validation must occur at the later
// governed file-reading boundary before decoding; D3 performs no file I/O.
import { detectModelAliasConflicts, isCanonicalEquipmentModelId, validateEquipmentModel, validateEquipmentModelAlias } from "./equipmentModel.js";
import { sha256Hex, validateCompatibility, validateCompatibilitySource, analyzeCompatibilityEvidenceByRelationship } from "./equipmentCompatibility.js";

const asciiCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Strict plain-object test: rejects arrays, Dates, class instances, Maps, and any prototype other
// than Object.prototype or null, so governed snapshot maps and configs cannot smuggle exotic shapes.
const plain = (v) => v !== null && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const isHex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);           // governed SHA-256 fingerprint
// Documented sentinel a caller sets as an existing-record snapshot value when it intentionally has
// no fingerprint (ID-only). It is modeled — never implicit null — and always yields a blocking
// existing_comparison_unavailable entry, even when no imported record overlaps that id.
export const EXISTING_COMPARISON_UNAVAILABLE = "existing_comparison_unavailable";
const isCompatId = (v) => typeof v === "string" && /^cmp_[0-9a-f]{64}$/.test(v);
const isSourceId = (v) => typeof v === "string" && /^src_[0-9a-f]{64}$/.test(v);
// True if the text contains any disallowed control char: C0 (except TAB/LF/CR), DEL (U+007F), or the
// full C1 range (U+0080–U+009F). Normal Unicode text above U+009F is preserved.
const hasDisallowedControl = (s) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c === 127 || (c >= 128 && c <= 159)) return true;
  }
  return false;
};

export const DEFAULT_LIMITS = Object.freeze({ maxFileChars: 1_000_000, maxRows: 10_000, maxFieldChars: 2_048, maxErrorRefs: 200 });
// Governed hard maxima; a caller-supplied limit above these is rejected fail-closed.
export const LIMIT_MAXIMA = Object.freeze({ maxFileChars: 20_000_000, maxRows: 200_000, maxFieldChars: 65_536, maxErrorRefs: 50_000 });

// Strict limits validator (fail-closed). Exact allowed keys only; each provided value must be a
// finite positive safe integer within its governed maximum; maxErrorRefs may not exceed maxRows.
export function validateLimits(limits) {
  if (limits === undefined) return { ok: true, limits: { ...DEFAULT_LIMITS } };
  if (!plain(limits)) return { ok: false, code: "limits_not_object" };
  const allowed = Object.keys(DEFAULT_LIMITS);
  for (const k of Object.keys(limits)) if (!allowed.includes(k)) return { ok: false, code: "unknown_limit_key" };
  const merged = { ...DEFAULT_LIMITS };
  for (const k of allowed) {
    if (limits[k] === undefined) continue;
    const v = limits[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) return { ok: false, code: `limit_${k}_invalid` };
    if (v > LIMIT_MAXIMA[k]) return { ok: false, code: `limit_${k}_exceeds_maximum` };
    merged[k] = v;
  }
  if (merged.maxErrorRefs > merged.maxRows) return { ok: false, code: "limit_maxErrorRefs_exceeds_rows" };
  return { ok: true, limits: merged };
}

// Part IDs are pre-existing stable SKU-like identifiers; treated as opaque tokens, never rewritten.
export function isValidPartId(v) { return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v); }

// Strict snapshot-shape validator (fail-closed). Exact allowed keys; partIds an array of valid part
// ids; serialSchemes a plain object; existingModelAliases an array; each existing-record map a plain
// object whose KEYS are the canonical identity for that authority. Fingerprint VALUES are not checked
// here — a malformed fingerprint is handled per-record as existing_comparison_unavailable, not a hard
// config error. Snapshot values are never surfaced in the report.
export function validateSnapshots(snapshots) {
  if (!plain(snapshots)) return { ok: false, code: "snapshots_not_object" };
  const allowed = ["partIds", "serialSchemes", "existingEquipmentModels", "existingModelAliases", "existingCompatibility", "existingSources"];
  for (const k of Object.keys(snapshots)) if (!allowed.includes(k)) return { ok: false, code: "unknown_snapshot_key" };
  if (snapshots.partIds !== undefined && (!Array.isArray(snapshots.partIds) || !snapshots.partIds.every(isValidPartId))) return { ok: false, code: "snapshot_partIds_invalid" };
  if (snapshots.serialSchemes !== undefined && !plain(snapshots.serialSchemes)) return { ok: false, code: "snapshot_serialSchemes_invalid" };
  if (snapshots.existingModelAliases !== undefined && !Array.isArray(snapshots.existingModelAliases)) return { ok: false, code: "snapshot_existingModelAliases_invalid" };
  // Every existing-record map is validated as a WHOLE: plain object, canonical keys, and every value
  // either a governed lowercase 64-hex fingerprint or the explicit unavailable sentinel. Malformed,
  // uppercase, short, empty, non-string, array, object, or implicit-null values fail closed here —
  // they are never silently ignored or later mistaken for a collision. Snapshot values are not echoed.
  const mapCheck = (field, keyValid, code) => {
    const o = snapshots[field];
    if (o === undefined) return null;
    if (!plain(o)) return code;
    for (const [k, v] of Object.entries(o)) if (!keyValid(k) || !(isHex64(v) || v === EXISTING_COMPARISON_UNAVAILABLE)) return code;
    return null;
  };
  const bad = mapCheck("existingEquipmentModels", isCanonicalEquipmentModelId, "snapshot_existingEquipmentModels_invalid")
    || mapCheck("existingCompatibility", isCompatId, "snapshot_existingCompatibility_invalid")
    || mapCheck("existingSources", isSourceId, "snapshot_existingSources_invalid");
  return bad ? { ok: false, code: bad } : { ok: true };
}

// Exact header allowlists per architecture-defined package. Unknown, missing, or duplicate headers
// are rejected. Market listings are EVIDENCE-ONLY QUARANTINE and never produce authoritative output.
export const IMPORT_PACKAGES = Object.freeze({
  EQUIPMENT_MASTER: ["equipmentModelId", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status", "sourceAuthority", "version"],
  EQUIPMENT_MODEL_ALIASES: ["aliasType", "manufacturerId", "rawValue", "equipmentModelId"],
  EQUIPMENT_PART_COMPATIBILITY: ["equipmentModelId", "partId", "compatibilityType", "assembly", "installationPosition", "quantityRequired", "applicabilityKind", "serialScheme", "serialRangeStart", "serialRangeEnd", "modelRevision", "effectiveFrom", "effectiveTo", "sourceSummary", "confidenceLevel", "verificationStatus", "notes", "version"],
  COMPATIBILITY_SOURCES: ["compatibilityId", "authorityType", "sourceReference", "sourceVersion", "observedClaim", "contentFingerprint", "capturedAt", "capturedBy", "notes"],
  MARKET_LISTINGS: ["listingId", "marketplace", "claimedManufacturer", "claimedModel", "claimedPartRef", "listingUrl", "capturedAt"],
});

// Deterministic equivalence fingerprint of a validated record's normalized value. Callers build the
// existing-authority snapshots with the SAME function so imported vs existing records can be compared
// for exact equivalence without the caller shipping raw content into the report.
export function recordFingerprint(value) { return sha256Hex(JSON.stringify(value)); }

// ---------------------------------------------------------------------------
// Sensitive-data scan (never reproduces the matched value — line + code only).
// Legitimate 64-hex content fingerprints are NOT flagged; credentials/PII are.
// ---------------------------------------------------------------------------
const SENSITIVE_PATTERNS = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  // Separated 3-3-4 grouping (optional country code / parens). Deliberately requires the two
  // separators so ISO dates/timestamps (4-2-2, colon-delimited) and hex fingerprints never match.
  ["phone", /(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/],
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
// Strict CSV parsing (bounds + normalized line endings + decoded-char sanity).
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
// `decoded_replacement_char` means a U+FFFD was present in the ALREADY-DECODED string — this is not a
// byte-level UTF-8 certification (see the module header note).
export function parseCsv(text, header, limits = DEFAULT_LIMITS) {
  if (typeof text !== "string") return { headerError: "not_a_string" };
  if (text.length > limits.maxFileChars) return { headerError: "file_too_large" };
  if (text.includes("�")) return { headerError: "decoded_replacement_char" };
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

// Identity analysis across BOTH in-batch and existing-authority records. existing is a Map
// id -> fingerprint. An overlapping id whose existing fingerprint is not a governed lowercase 64-hex
// SHA-256 fails closed as comparison-unavailable (never a fabricated duplicate/collision).
function classifyIdentity(imported, existing) {
  const byId = new Map();
  for (const r of imported) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  const collisions = [], duplicates = [], unavailable = [];
  for (const [id, group] of byId) {
    const lines = group.map((g) => g.line).sort((a, b) => a - b);
    const hasExisting = existing.has(id);
    const existingFp = hasExisting ? existing.get(id) : undefined;
    if (hasExisting && !isHex64(existingFp)) { unavailable.push({ id, lines }); continue; }
    const fpSet = new Set(group.map((g) => g.fp));
    if (hasExisting) fpSet.add(existingFp);
    if (fpSet.size > 1) collisions.push({ id, lines, existing: hasExisting });
    else if (group.length >= 2 || hasExisting) duplicates.push({ id, lines, existing: hasExisting });
  }
  const s = (a, b) => asciiCompare(a.id, b.id);
  return { collisions: collisions.sort(s), duplicates: duplicates.sort(s), unavailable: unavailable.sort(s) };
}

// Full per-entity analysis. validateSnapshots guarantees every existing value is a 64-hex
// fingerprint or the explicit unavailable sentinel. Sentinel ids are ALWAYS surfaced as
// comparison-unavailable (with any overlapping import lines) and are excluded from equivalence
// comparison; the remaining fingerprinted records drive collision/duplicate detection.
function analyzeEntity(imported, existingMap) {
  const sentinelIds = new Set(), available = new Map();
  for (const [id, v] of existingMap) { if (v === EXISTING_COMPARISON_UNAVAILABLE) sentinelIds.add(id); else available.set(id, v); }
  const linesById = new Map();
  for (const r of imported) { if (!linesById.has(r.id)) linesById.set(r.id, []); linesById.get(r.id).push(r.line); }
  const { collisions, duplicates } = classifyIdentity(imported.filter((r) => !sentinelIds.has(r.id)), available);
  const unavailable = [...sentinelIds].sort(asciiCompare).map((id) => ({ id, lines: (linesById.get(id) || []).slice().sort((a, b) => a - b) }));
  return { collisions, duplicates, unavailable };
}

const toFpMap = (o) => { const m = new Map(); if (plain(o)) for (const [k, v] of Object.entries(o)) m.set(k, v); return m; };
const bound = (arr, max, cmp) => { const sorted = [...arr].sort(cmp); return { items: sorted.slice(0, max), truncated: Math.max(0, sorted.length - max) }; };
// Bound a nested `lines` array inside a report entry (deterministic ascending), exposing the full
// pre-truncation count and the nested truncation count; never retains anything but line numbers.
const boundLinesEntry = (e, max) => { const b = bound(e.lines, max, (a, z) => a - z); return { ...e, lines: b.items, lineCount: e.lines.length, linesTruncated: b.truncated }; };
// Bound the nested owner/member list of an alias conflict (canonical opaque model ids only).
const boundAliasConflict = (c, max) => { const b = bound(c.equipmentModelIds, max, asciiCompare); return { aliasKey: c.aliasKey, equipmentModelIds: b.items, ownerCount: c.equipmentModelIds.length, ownersTruncated: b.truncated }; };
// Bound a top-level array AND map each surviving entry through a nested bounder.
const boundEntries = (arr, max, cmp, nest) => { const b = bound(arr, max, cmp); return { items: b.items.map((e) => nest(e, max)), truncated: b.truncated }; };

function emptyReport(status, extra = {}) {
  return {
    dryRun: true, applyable: false, status, counts: {},
    errors: [], unresolved: [], invalidAliases: [],
    collisions: { equipmentModels: [], modelAliasConflicts: [], compatibility: [], sources: [] },
    existingComparisonUnavailable: { equipmentModels: [], compatibility: [], sources: [] },
    duplicatesIdempotent: { equipmentModels: 0, compatibility: 0, sources: 0 },
    conflicts: [], reviewReasons: [], quarantine: { marketListings: 0, authoritative: false },
    sensitive: { clean: true, findings: [] }, staged: null,
    truncated: { errors: 0, unresolved: 0, invalidAliases: 0, sensitive: 0, equipmentModelCollisions: 0, modelAliasConflicts: 0, compatibilityCollisions: 0, sourceCollisions: 0, unavailableEquipmentModels: 0, unavailableCompatibility: 0, unavailableSources: 0, conflicts: 0 },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Dry-run planner. Returns a sanitized, deterministic, zero-write report.
// ---------------------------------------------------------------------------
export function dryRunEquipmentCompatibilityImport({ packages = {}, snapshots = {}, limits = {} } = {}) {
  const limCheck = validateLimits(limits);
  if (!limCheck.ok) return emptyReport("BLOCKED", { configError: limCheck.code });
  const snapCheck = validateSnapshots(snapshots);
  if (!snapCheck.ok) return emptyReport("BLOCKED", { configError: snapCheck.code });
  const lim = limCheck.limits;

  const errors = [], unresolved = [], sensitive = [];
  const partIds = new Set(Array.isArray(snapshots.partIds) ? snapshots.partIds : []);
  const serialSchemes = plain(snapshots.serialSchemes) ? snapshots.serialSchemes : {};
  const existingModels = toFpMap(snapshots.existingEquipmentModels);
  const existingCompat = toFpMap(snapshots.existingCompatibility);
  const existingSources = toFpMap(snapshots.existingSources);
  const existingAliases = Array.isArray(snapshots.existingModelAliases) ? snapshots.existingModelAliases : [];

  const pushErr = (pkg, line, field, code) => errors.push({ package: pkg, line, field, code });
  const counts = {};

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

  // Market listings: parsed + scanned + counted, then QUARANTINED — evidence-only, requiring review.
  // They never create models, relationships, sources, verification, or staged ids.
  let marketListings = 0;
  if (packages.MARKET_LISTINGS !== undefined) {
    scanSensitive(packages.MARKET_LISTINGS, "MARKET_LISTINGS").forEach((f) => sensitive.push(f));
    const parsed = parseCsv(packages.MARKET_LISTINGS, IMPORT_PACKAGES.MARKET_LISTINGS, lim);
    if (parsed.headerError) pushErr("MARKET_LISTINGS", 1, null, parsed.headerError);
    else { parsed.rowErrors.forEach((e) => pushErr("MARKET_LISTINGS", e.line, e.field, e.code)); marketListings = parsed.records.length; }
  }

  // Reference resolution against explicit snapshots + in-batch valid records.
  const batchModelIds = new Set(models.map((m) => m.value.equipmentModelId));
  const knownModelIds = new Set([...existingModels.keys(), ...batchModelIds]);
  for (const a of aliases) if (!knownModelIds.has(a.value.equipmentModelId)) unresolved.push({ package: "EQUIPMENT_MODEL_ALIASES", line: a.line, ref: "equipmentModelId", code: "equipment_model_unresolved" });
  for (const c of compat) {
    if (!knownModelIds.has(c.value.equipmentModelId)) unresolved.push({ package: "EQUIPMENT_PART_COMPATIBILITY", line: c.line, ref: "equipmentModelId", code: "equipment_model_unresolved" });
    if (!partIds.has(c.value.partId)) unresolved.push({ package: "EQUIPMENT_PART_COMPATIBILITY", line: c.line, ref: "partId", code: "part_unresolved" });
  }
  const batchCompatIds = new Set(compat.map((c) => c.value.compatibilityId));
  const knownCompatIds = new Set([...existingCompat.keys(), ...batchCompatIds]);
  for (const s of sources) if (!knownCompatIds.has(s.value.compatibilityId)) unresolved.push({ package: "COMPATIBILITY_SOURCES", line: s.line, ref: "compatibilityId", code: "compatibility_unresolved" });

  // Identity analysis vs BOTH in-batch and existing authority (equivalence-aware, fail-closed).
  const modelIdentity = analyzeEntity(models.map((m) => ({ line: m.line, id: m.value.equipmentModelId, fp: recordFingerprint(m.value) })), existingModels);
  const compatIdentity = analyzeEntity(compat.map((c) => ({ line: c.line, id: c.value.compatibilityId, fp: recordFingerprint(c.value) })), existingCompat);
  const sourceIdentity = analyzeEntity(sources.map((s) => ({ line: s.line, id: s.value.sourceId, fp: recordFingerprint(s.value) })), existingSources);

  // Alias ownership conflicts include existing authority aliases. Malformed aliases (from either the
  // imported package or the existing snapshot) are retained as sanitized invalids — never dropped —
  // and are blocking. Refs distinguish imported-package LINE from existing-snapshot INDEX; raw alias
  // values are never surfaced.
  const batchAliasRecords = aliases.map((a) => ({ aliasType: a.value.aliasType, manufacturerId: a.value.manufacturerId, rawValue: a.value.aliasValue, equipmentModelId: a.value.equipmentModelId }));
  const aliasResult = detectModelAliasConflicts([...batchAliasRecords, ...existingAliases]);
  const aliasConflicts = aliasResult.conflicts;
  const invalidAliases = aliasResult.invalid.map(({ index, reason }) => (
    index < batchAliasRecords.length ? { source: "batch", ref: aliases[index].line, reason } : { source: "existing", ref: index - batchAliasRecords.length, reason }
  ));

  // Source precedence + evidence-conflict reporting (reseller/WO stay non-authoritative in D2).
  const evidence = analyzeCompatibilityEvidenceByRelationship(sources.map((s) => s.value)).relationships;
  const conflicts = evidence.filter((r) => r.recommendedStatus === "CONFLICT").map((r) => ({ compatibilityId: r.compatibilityId, strongestSupport: r.strongestSupport, strongestContradiction: r.strongestContradiction }));

  // Status uses COMPLETE pre-truncation collections so display bounding can never flip the result.
  const unavailableCount = modelIdentity.unavailable.length + compatIdentity.unavailable.length + sourceIdentity.unavailable.length;
  const collisionCount = modelIdentity.collisions.length + compatIdentity.collisions.length + sourceIdentity.collisions.length + aliasConflicts.length;
  const hasBlocking = errors.length > 0 || unresolved.length > 0 || collisionCount > 0 || unavailableCount > 0 || sensitive.length > 0 || invalidAliases.length > 0;
  const reviewReasons = [];
  if (conflicts.length > 0) reviewReasons.push("evidence_conflict");
  if (marketListings > 0) reviewReasons.push("market_listings_require_review");
  const status = hasBlocking ? "BLOCKED" : reviewReasons.length > 0 ? "REVIEW_REQUIRED" : "READY";

  // No partial apply: the staged opaque-id summary is populated ONLY when status is exactly READY.
  const staged = status === "READY" ? {
    equipmentModelIds: [...batchModelIds].sort(asciiCompare),
    modelAliasKeys: [...new Set(aliases.map((a) => a.value.aliasKey))].sort(asciiCompare),
    compatibilityIds: [...batchCompatIds].sort(asciiCompare),
    sourceIds: [...new Set(sources.map((s) => s.value.sourceId))].sort(asciiCompare),
  } : null;

  // Deterministically bound every report collection for display; status/staged already decided above.
  const M = lim.maxErrorRefs;
  const refCmp = (a, b) => asciiCompare(a.package, b.package) || a.line - b.line || asciiCompare(a.code, b.code);
  const idCmp = (a, b) => asciiCompare(a.id, b.id);
  const bErrors = bound(errors, M, refCmp), bUnresolved = bound(unresolved, M, refCmp);
  const bSensitive = bound(sensitive, M, refCmp);
  const bModelCol = boundEntries(modelIdentity.collisions, M, idCmp, boundLinesEntry), bCompatCol = boundEntries(compatIdentity.collisions, M, idCmp, boundLinesEntry), bSourceCol = boundEntries(sourceIdentity.collisions, M, idCmp, boundLinesEntry);
  const bAliasConf = boundEntries(aliasConflicts, M, (a, b) => asciiCompare(a.aliasKey, b.aliasKey), boundAliasConflict);
  const bInvalidAlias = bound(invalidAliases, M, (a, b) => asciiCompare(a.source, b.source) || a.ref - b.ref || asciiCompare(a.reason, b.reason));
  const bUnModel = boundEntries(modelIdentity.unavailable, M, idCmp, boundLinesEntry), bUnCompat = boundEntries(compatIdentity.unavailable, M, idCmp, boundLinesEntry), bUnSource = boundEntries(sourceIdentity.unavailable, M, idCmp, boundLinesEntry);
  const bConflicts = bound(conflicts, M, (a, b) => asciiCompare(a.compatibilityId, b.compatibilityId));

  return {
    dryRun: true, applyable: false, status,
    counts: { ...counts, quarantinedMarketListings: marketListings },
    errors: bErrors.items, unresolved: bUnresolved.items, invalidAliases: bInvalidAlias.items,
    collisions: { equipmentModels: bModelCol.items, modelAliasConflicts: bAliasConf.items, compatibility: bCompatCol.items, sources: bSourceCol.items },
    existingComparisonUnavailable: { equipmentModels: bUnModel.items, compatibility: bUnCompat.items, sources: bUnSource.items },
    duplicatesIdempotent: { equipmentModels: modelIdentity.duplicates.length, compatibility: compatIdentity.duplicates.length, sources: sourceIdentity.duplicates.length },
    conflicts: bConflicts.items, reviewReasons,
    quarantine: { marketListings, authoritative: false },
    sensitive: { clean: sensitive.length === 0, findings: bSensitive.items },
    staged,
    truncated: {
      errors: bErrors.truncated, unresolved: bUnresolved.truncated, invalidAliases: bInvalidAlias.truncated, sensitive: bSensitive.truncated,
      equipmentModelCollisions: bModelCol.truncated, modelAliasConflicts: bAliasConf.truncated, compatibilityCollisions: bCompatCol.truncated, sourceCollisions: bSourceCol.truncated,
      unavailableEquipmentModels: bUnModel.truncated, unavailableCompatibility: bUnCompat.truncated, unavailableSources: bUnSource.truncated, conflicts: bConflicts.truncated,
    },
  };
}
