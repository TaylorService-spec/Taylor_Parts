// D1 pure Equipment Model contracts. No Firebase, I/O, or installed-asset linkage.
export const MODEL_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "INACTIVE", "RETIRED"]);
export const MODEL_ALIAS_TYPES = Object.freeze(["MANUFACTURER_MODEL", "HISTORICAL_MODEL", "SOURCE_MODEL"]);
const MODEL_FIELDS = new Set(["equipmentModelId","manufacturerId","manufacturerName","modelNumber","displayName","family","subtype","revision","status","sourceAuthority","version"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export function normalizeIdentityText(v) { return typeof v === "string" ? v.normalize("NFKC").trim().replace(/\s+/g, " ") : ""; }
export function normalizeIdentityKey(v) { return normalizeIdentityText(v).toUpperCase(); }
export function normalizeManufacturerId(v) { return normalizeIdentityKey(v).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, ""); }
export function normalizeModelNumber(v) { return normalizeIdentityKey(v); }
export function buildEquipmentModelId(manufacturerId, modelNumber) {
  const m = normalizeManufacturerId(manufacturerId), n = normalizeModelNumber(modelNumber).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return m && n ? `${m}--${n}` : "";
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
  if (!value.equipmentModelId || value.equipmentModelId !== buildEquipmentModelId(value.manufacturerId, value.modelNumber)) return { valid: false, value, reason: "id_invalid" };
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
export function detectModelAliasConflicts(records = []) {
  if (!Array.isArray(records)) return [];
  const owners = new Map();
  for (const r of records) {
    const key = normalizeModelAliasKey(r), id = normalizeIdentityText(r?.equipmentModelId);
    if (!key || !id) continue;
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(id);
  }
  return [...owners].filter(([, ids]) => ids.size > 1).sort(([a],[b]) => a.localeCompare(b)).map(([aliasKey, ids]) => ({ aliasKey, equipmentModelIds: [...ids].sort() }));
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
  if (a && b && a.localeCompare(b) > 0) return { valid: false, reason: "range_reversed" };
  return { valid: true, reason: null, value: { start: a, end: b, schemeId: normalizeIdentityKey(scheme.schemeId), normalizerVersion: scheme.normalizerVersion } };
}
