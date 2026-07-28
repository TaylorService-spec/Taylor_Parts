// D1 pure Equipment Model contracts. No Firebase, I/O, or installed-asset linkage.
export const MODEL_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "INACTIVE", "RETIRED"]);
export const MODEL_ALIAS_TYPES = Object.freeze(["MANUFACTURER_MODEL", "HISTORICAL_MODEL", "SOURCE_MODEL"]);
const MODEL_FIELDS = new Set(["equipmentModelId","manufacturerId","manufacturerName","modelNumber","displayName","family","subtype","revision","status","sourceAuthority","version"]);
const MODEL_ALIAS_FIELDS = new Set(["aliasType","manufacturerId","rawValue","equipmentModelId","aliasKey"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
// Deterministic UTF-16 code-unit ordering. Normalized identity and serial tokens are ASCII
// contracts, so ordering must never depend on host locale (unlike String.prototype.localeCompare).
const asciiCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function normalizeIdentityText(v) { return typeof v === "string" ? v.normalize("NFKC").trim().replace(/\s+/g, " ") : ""; }
export function normalizeIdentityKey(v) { return normalizeIdentityText(v).toUpperCase(); }
export function normalizeManufacturerId(v) { return normalizeIdentityKey(v).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, ""); }
export function normalizeModelNumber(v) { return normalizeIdentityKey(v); }
export function buildEquipmentModelId(manufacturerId, modelNumber) {
  const m = normalizeManufacturerId(manufacturerId), n = normalizeModelNumber(modelNumber).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return m && n ? `${m}--${n}` : "";
}
// Canonical Equipment Model ID contract, shared by validateEquipmentModel and
// validateEquipmentModelAlias. A value is canonical only when it is already the exact,
// deterministic `manufacturer--model` string buildEquipmentModelId() would produce — split on
// the single "--" separator and round-trip through the builder. This rejects lowercase,
// surrounding/embedded whitespace, Unicode/non-ASCII, missing manufacturer/model segments,
// and repeated/empty separators, and never silently normalizes a malformed id into validity.
export function isCanonicalEquipmentModelId(v) {
  if (typeof v !== "string") return false;
  const parts = v.split("--");
  return parts.length === 2 && buildEquipmentModelId(parts[0], parts[1]) === v;
}
export function normalizeEquipmentModel(input) {
  if (!plain(input)) return null;
  const manufacturerId = normalizeManufacturerId(input.manufacturerId);
  const modelNumber = normalizeModelNumber(input.modelNumber);
  return {
    equipmentModelId: normalizeIdentityText(input.equipmentModelId) || buildEquipmentModelId(manufacturerId, modelNumber),
    manufacturerId, manufacturerName: normalizeIdentityText(input.manufacturerName), modelNumber,
    displayName: normalizeIdentityText(input.displayName), family: normalizeIdentityText(input.family) || null,
    subtype: normalizeIdentityText(input.subtype) || null, revision: normalizeIdentityText(input.revision) || null,
    status: normalizeIdentityKey(input.status), sourceAuthority: normalizeIdentityText(input.sourceAuthority), version: input.version,
  };
}
export function validateEquipmentModel(input) {
  if (!plain(input)) return { valid: false, value: null, reason: "not_object" };
  if (Object.keys(input).some((k) => !MODEL_FIELDS.has(k))) return { valid: false, value: null, reason: "unknown_field" };
  const value = normalizeEquipmentModel(input);
  // Check the RAW stored id (derive it only when absent) — never the whitespace-normalized copy —
  // so a noncanonical stored id cannot be silently normalized into validity.
  const expectedId = buildEquipmentModelId(value.manufacturerId, value.modelNumber);
  const rawId = input.equipmentModelId === undefined ? expectedId : input.equipmentModelId;
  if (!isCanonicalEquipmentModelId(rawId) || rawId !== expectedId) return { valid: false, value, reason: "id_invalid" };
  value.equipmentModelId = rawId;
  for (const [field, reason] of [["manufacturerId","manufacturer_id_invalid"],["manufacturerName","manufacturer_name_invalid"],["modelNumber","model_number_invalid"],["displayName","display_name_invalid"],["sourceAuthority","source_authority_invalid"]]) {
    if (!value[field]) return { valid: false, value, reason };
  }
  if (!MODEL_STATUSES.includes(value.status)) return { valid: false, value, reason: "status_invalid" };
  if (!Number.isInteger(value.version) || value.version < 1) return { valid: false, value, reason: "version_invalid" };
  return { valid: true, value, reason: null };
}
export function normalizeModelAliasKey(record) {
  const { aliasType, manufacturerId, rawValue } = plain(record) ? record : {};
  const type = normalizeIdentityKey(aliasType), manufacturer = normalizeManufacturerId(manufacturerId), alias = normalizeIdentityKey(rawValue);
  return MODEL_ALIAS_TYPES.includes(type) && manufacturer && alias ? `${type}|${manufacturer}|${alias}` : "";
}
// Control (Cc: NUL, C0/C1, DEL), format (Cf: zero-width, bidi overrides, soft hyphen, BOM) and
// line/paragraph separators (Zl/Zp). NFKC preserves all of these and normalizeIdentityKey does not
// strip them, so a canonical stored key must reject them outright.
const ALIAS_KEY_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const ALIAS_KEY_MAX = 512;
// Is `v` EXACTLY the alias key normalizeModelAliasKey derives from its own three segments? This is the
// single authoritative predicate for a stored/persisted aliasKey (the D1 analogue of
// isCanonicalEquipmentModelId). Round-tripping proves NFKC-stability, uppercasing, whitespace
// collapsing, a known aliasType, and a canonical manufacturerId in one check. Alias VALUES may legally
// contain "|" (aliasType and manufacturerId provably cannot), so the key is split on its FIRST TWO
// separators only.
export function isCanonicalModelAliasKey(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > ALIAS_KEY_MAX || ALIAS_KEY_FORBIDDEN.test(v)) return false;
  const i = v.indexOf("|");
  if (i < 0) return false;
  const j = v.indexOf("|", i + 1);
  if (j < 0) return false;
  return normalizeModelAliasKey({ aliasType: v.slice(0, i), manufacturerId: v.slice(i + 1, j), rawValue: v.slice(j + 1) }) === v;
}
// Strict pure contract for one model-alias record. Malformed input yields an explicit,
// structured invalid reason — it is never silently dropped.
export function validateEquipmentModelAlias(input) {
  if (!plain(input)) return { valid: false, value: null, reason: "not_object" };
  if (Object.keys(input).some((k) => !MODEL_ALIAS_FIELDS.has(k))) return { valid: false, value: null, reason: "unknown_field" };
  const aliasType = normalizeIdentityKey(input.aliasType);
  if (!MODEL_ALIAS_TYPES.includes(aliasType)) return { valid: false, value: null, reason: "alias_type_invalid" };
  const manufacturerId = normalizeManufacturerId(input.manufacturerId);
  if (!manufacturerId) return { valid: false, value: null, reason: "manufacturer_id_invalid" };
  const aliasValue = normalizeIdentityKey(input.rawValue);
  if (!aliasValue) return { valid: false, value: null, reason: "alias_value_invalid" };
  const equipmentModelId = input.equipmentModelId;
  if (!isCanonicalEquipmentModelId(equipmentModelId)) return { valid: false, value: null, reason: "equipment_model_id_invalid" };
  const aliasKey = normalizeModelAliasKey({ aliasType, manufacturerId, rawValue: aliasValue });
  if (!aliasKey) return { valid: false, value: null, reason: "alias_key_invalid" };
  if (input.aliasKey !== undefined && normalizeIdentityText(input.aliasKey) !== aliasKey) return { valid: false, value: null, reason: "alias_key_mismatch" };
  return { valid: true, value: { aliasType, manufacturerId, aliasValue, aliasKey, equipmentModelId }, reason: null };
}
// Conflict analysis is fail-visible: every malformed record is surfaced as a structured
// invalid entry (never silently skipped), so a bad record cannot masquerade as a clean result
// or conceal a genuine cross-owner conflict. A result is "clean" only when both arrays are empty.
export function detectModelAliasConflicts(records = []) {
  if (!Array.isArray(records)) return { conflicts: [], invalid: [{ index: -1, reason: "not_array" }] };
  const owners = new Map(), invalid = [];
  records.forEach((record, index) => {
    const v = validateEquipmentModelAlias(record);
    if (!v.valid) { invalid.push({ index, reason: v.reason }); return; }
    if (!owners.has(v.value.aliasKey)) owners.set(v.value.aliasKey, new Set());
    owners.get(v.value.aliasKey).add(v.value.equipmentModelId);
  });
  const conflicts = [...owners]
    .filter(([, ids]) => ids.size > 1)
    .sort(([a], [b]) => asciiCompare(a, b))
    .map(([aliasKey, ids]) => ({ aliasKey, equipmentModelIds: [...ids].sort(asciiCompare) }));
  return { conflicts, invalid };
}
export function validateSerialScheme(s) {
  if (!plain(s)) return { valid: false, reason: "not_object" };
  if (Object.keys(s).some((k) => !["schemeId","manufacturerId","normalizerVersion","tokenPattern","ordering"].includes(k))) return { valid: false, reason: "unknown_field" };
  const schemeId = normalizeIdentityKey(s.schemeId), manufacturerId = normalizeManufacturerId(s.manufacturerId);
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(schemeId)) return { valid: false, reason: "scheme_id_invalid" };
  if (!manufacturerId || !Number.isInteger(s.normalizerVersion) || s.normalizerVersion < 1) return { valid: false, reason: "scheme_metadata_invalid" };
  if (s.ordering !== "LEXICOGRAPHIC") return { valid: false, reason: "ordering_invalid" };
  try { if (typeof s.tokenPattern !== "string" || !s.tokenPattern || !new RegExp(s.tokenPattern)) throw new Error(); } catch { return { valid: false, reason: "token_pattern_invalid" }; }
  return { valid: true, reason: null, value: { schemeId, manufacturerId, normalizerVersion: s.normalizerVersion, tokenPattern: s.tokenPattern, ordering: s.ordering } };
}
export function normalizeSerialToken(raw, scheme) {
  const s = validateSerialScheme(scheme);
  if (!s.valid || typeof raw !== "string") return null;
  const token = normalizeIdentityKey(raw).replace(/\s+/g, "");
  return new RegExp(s.value.tokenPattern).test(token) ? token : null;
}
export function validateSerialRange({ start = null, end = null, scheme } = {}) {
  const a = start === null ? null : normalizeSerialToken(start, scheme), b = end === null ? null : normalizeSerialToken(end, scheme);
  if ((start !== null && a === null) || (end !== null && b === null)) return { valid: false, reason: "bound_invalid" };
  if (a === null && b === null) return { valid: false, reason: "empty_range" };
  if (a && b && asciiCompare(a, b) > 0) return { valid: false, reason: "range_reversed" };
  return { valid: true, reason: null, value: { start: a, end: b, schemeId: normalizeIdentityKey(scheme.schemeId), normalizerVersion: scheme.normalizerVersion } };
}
