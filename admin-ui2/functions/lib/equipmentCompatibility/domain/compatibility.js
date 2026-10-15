"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTHORITATIVE_AUTHORITIES = exports.AUTHORITY_TYPES = exports.AUTHORITY_RANK = exports.OBSERVED_CLAIMS = exports.CONFIDENCE_LEVELS = exports.VERIFICATION_STATES = exports.APPLICABILITY_KINDS = exports.REJECTED_COMPATIBILITY_TYPES = exports.COMPATIBILITY_TYPES = void 0;
exports.isValidPartId = isValidPartId;
exports.isIsoDate = isIsoDate;
exports.isIsoDateTime = isIsoDateTime;
exports.sha256Hex = sha256Hex;
exports.validateApplicability = validateApplicability;
exports.buildCompatibilityUniquenessKey = buildCompatibilityUniquenessKey;
exports.buildCompatibilityId = buildCompatibilityId;
exports.isCanonicalCompatibilityId = isCanonicalCompatibilityId;
exports.isCanonicalCompatibilitySourceId = isCanonicalCompatibilitySourceId;
exports.validateCompatibility = validateCompatibility;
exports.detectCompatibilityCollisions = detectCompatibilityCollisions;
exports.validateCompatibilitySource = validateCompatibilitySource;
exports.detectCompatibilitySourceCollisions = detectCompatibilitySourceCollisions;
exports.analyzeCompatibilityEvidence = analyzeCompatibilityEvidence;
exports.analyzeCompatibilityEvidenceByRelationship = analyzeCompatibilityEvidenceByRelationship;
// D4 server MIRROR of the merged D2 pure Part–Equipment Compatibility contracts
// (field-ops-app-vite/src/domain/equipmentCompatibility.js). Behavioral parity enforced by
// functions/test/equipmentCompatibilityDomainParity.test.mjs. Pure: no Firebase, persistence, I/O.
const equipmentModel_1 = require("./equipmentModel");
exports.COMPATIBILITY_TYPES = Object.freeze(["DIRECT_FIT", "APPROVED_ALTERNATE", "OPTIONAL_ACCESSORY", "CONSUMABLE"]);
exports.REJECTED_COMPATIBILITY_TYPES = Object.freeze(["SUPERSEDED_BY", "REPLACED_PART", "PM_KIT_COMPONENT", "SERIAL_RANGE_SPECIFIC", "UNIVERSAL", "UNKNOWN_REQUIRES_REVIEW"]);
exports.APPLICABILITY_KINDS = Object.freeze(["ALL_SERIALS", "SERIAL_RANGE", "MODEL_REVISION", "UNRESOLVED"]);
exports.VERIFICATION_STATES = Object.freeze(["UNVERIFIED", "IN_REVIEW", "VERIFIED", "REJECTED", "CONFLICT"]);
exports.CONFIDENCE_LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH"]);
exports.OBSERVED_CLAIMS = Object.freeze(["SUPPORTS", "CONTRADICTS", "INCONCLUSIVE"]);
exports.AUTHORITY_RANK = Object.freeze({
    MANUFACTURER: 100, SERVICE_BULLETIN: 90, AUTHORIZED_DISTRIBUTOR: 80,
    INTERNAL_VERIFIED: 70, WORK_ORDER_OBSERVATION: 40, RESELLER: 20, OTHER: 10,
});
exports.AUTHORITY_TYPES = Object.freeze(Object.keys(exports.AUTHORITY_RANK));
exports.AUTHORITATIVE_AUTHORITIES = Object.freeze(["MANUFACTURER", "SERVICE_BULLETIN", "AUTHORIZED_DISTRIBUTOR", "INTERNAL_VERIFIED"]);
const TUPLE_VERSION = 1;
const COMPAT_FIELDS = new Set(["equipmentModelId", "partId", "compatibilityType", "assembly", "installationPosition", "quantityRequired", "applicability", "effectiveFrom", "effectiveTo", "sourceSummary", "confidenceLevel", "verificationStatus", "notes", "version", "compatibilityId", "uniquenessKey"]);
const APPLICABILITY_FIELDS = new Set(["kind", "serialScheme", "serialRangeStart", "serialRangeEnd", "modelRevision"]);
const SOURCE_FIELDS = new Set(["sourceId", "compatibilityId", "authorityType", "sourceReference", "sourceVersion", "observedClaim", "contentFingerprint", "capturedAt", "capturedBy", "notes"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const asciiCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nullableText = (v) => { const t = (0, equipmentModel_1.normalizeIdentityText)(v); return t || null; };
function isValidPartId(v) { return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v); }
function isIsoDate(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return false;
    const [y, m, d] = v.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1)
        return false;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
function isIsoDateTime(v) {
    if (typeof v !== "string")
        return false;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(v);
    return !!m && isIsoDate(m[1]) && +m[2] < 24 && +m[3] < 60 && +m[4] < 60;
}
// Deterministic opaque ID (pure SHA-256; browser-safe port, no crypto import — parity with client).
const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
const utf8Bytes = (str) => Array.from(new TextEncoder().encode(str));
function sha256Hex(str) {
    const bytes = utf8Bytes(str), bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56)
        bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    for (let i = 3; i >= 0; i--)
        bytes.push((hi >>> (i * 8)) & 0xff);
    for (let i = 3; i >= 0; i--)
        bytes.push((lo >>> (i * 8)) & 0xff);
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
        for (let i = 16; i < 64; i++) {
            const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
            const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + ((rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0) + (((e & f) ^ (~e & g)) >>> 0) + K[i] + w[i]) >>> 0;
            const t2 = (((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0) + (((a & b) ^ (a & c) ^ (b & c)) >>> 0)) >>> 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        h = [(h[0] + a) >>> 0, (h[1] + b) >>> 0, (h[2] + c) >>> 0, (h[3] + d) >>> 0, (h[4] + e) >>> 0, (h[5] + f) >>> 0, (h[6] + g) >>> 0, (h[7] + hh) >>> 0];
    }
    return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
function validateApplicability(input, schemes = {}) {
    if (!plain(input))
        return { valid: false, value: null, reason: "not_object" };
    if (Object.keys(input).some((k) => !APPLICABILITY_FIELDS.has(k)))
        return { valid: false, value: null, reason: "unknown_field" };
    const kind = (0, equipmentModel_1.normalizeIdentityKey)(input.kind);
    if (!exports.APPLICABILITY_KINDS.includes(kind))
        return { valid: false, value: null, reason: "kind_invalid" };
    const base = { kind, serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null };
    if (kind === "ALL_SERIALS" || kind === "UNRESOLVED") {
        if (input.serialScheme != null || input.serialRangeStart != null || input.serialRangeEnd != null || input.modelRevision != null) {
            return { valid: false, value: null, reason: "fields_must_be_null" };
        }
        return { valid: true, value: base, reason: null };
    }
    if (kind === "MODEL_REVISION") {
        if (input.serialScheme != null || input.serialRangeStart != null || input.serialRangeEnd != null)
            return { valid: false, value: null, reason: "serial_fields_must_be_null" };
        const modelRevision = (0, equipmentModel_1.normalizeIdentityKey)(input.modelRevision);
        if (!modelRevision)
            return { valid: false, value: null, reason: "model_revision_invalid" };
        return { valid: true, value: { ...base, modelRevision }, reason: null };
    }
    if (input.modelRevision != null)
        return { valid: false, value: null, reason: "model_revision_must_be_null" };
    const schemeKey = (0, equipmentModel_1.normalizeIdentityKey)(input.serialScheme);
    if (!schemeKey)
        return { valid: false, value: null, reason: "serial_scheme_required" };
    const scheme = schemes[schemeKey];
    if (!scheme || !(0, equipmentModel_1.validateSerialScheme)(scheme).valid)
        return { valid: false, value: null, reason: "serial_scheme_unresolved" };
    const range = (0, equipmentModel_1.validateSerialRange)({ start: input.serialRangeStart ?? null, end: input.serialRangeEnd ?? null, scheme });
    if (!range.valid)
        return { valid: false, value: null, reason: `serial_range_${range.reason}` };
    return { valid: true, value: { kind, serialScheme: schemeKey, serialRangeStart: range.value.start, serialRangeEnd: range.value.end, modelRevision: null }, reason: null };
}
function applicabilityTuple(a) { return [a.kind, a.serialScheme, a.serialRangeStart, a.serialRangeEnd, a.modelRevision]; }
function buildCompatibilityUniquenessKey(t) {
    return JSON.stringify([TUPLE_VERSION, t.equipmentModelId, t.partId, t.compatibilityType, t.assembly ?? null, t.installationPosition ?? null, applicabilityTuple(t.applicability)]);
}
function buildCompatibilityId(uniquenessKey) { return `cmp_${sha256Hex(uniquenessKey)}`; }
// Authoritative shape predicates for the two opaque D2 identities. Any consumer that must recognise a
// stored/persisted compatibility or source ID uses these — never a private re-statement of the format.
function isCanonicalCompatibilityId(v) { return typeof v === "string" && /^cmp_[0-9a-f]{64}$/.test(v); }
function isCanonicalCompatibilitySourceId(v) { return typeof v === "string" && /^src_[0-9a-f]{64}$/.test(v); }
function validateCompatibility(input, { serialSchemes = {} } = {}) {
    if (!plain(input))
        return { valid: false, value: null, reason: "not_object" };
    if (Object.keys(input).some((k) => !COMPAT_FIELDS.has(k)))
        return { valid: false, value: null, reason: "unknown_field" };
    if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(input.equipmentModelId))
        return { valid: false, value: null, reason: "equipment_model_id_invalid" };
    if (!isValidPartId(input.partId))
        return { valid: false, value: null, reason: "part_id_invalid" };
    const compatibilityType = (0, equipmentModel_1.normalizeIdentityKey)(input.compatibilityType);
    if (!exports.COMPATIBILITY_TYPES.includes(compatibilityType))
        return { valid: false, value: null, reason: "compatibility_type_invalid" };
    const app = validateApplicability(input.applicability ?? {}, serialSchemes);
    if (!app.valid)
        return { valid: false, value: null, reason: `applicability_${app.reason}` };
    const confidenceLevel = (0, equipmentModel_1.normalizeIdentityKey)(input.confidenceLevel);
    if (!exports.CONFIDENCE_LEVELS.includes(confidenceLevel))
        return { valid: false, value: null, reason: "confidence_level_invalid" };
    const verificationStatus = (0, equipmentModel_1.normalizeIdentityKey)(input.verificationStatus);
    if (!exports.VERIFICATION_STATES.includes(verificationStatus))
        return { valid: false, value: null, reason: "verification_status_invalid" };
    if (app.value.kind === "UNRESOLVED" && verificationStatus === "VERIFIED")
        return { valid: false, value: null, reason: "unresolved_cannot_be_verified" };
    const quantityRequired = input.quantityRequired ?? null;
    if (quantityRequired !== null && (!Number.isInteger(quantityRequired) || quantityRequired < 1))
        return { valid: false, value: null, reason: "quantity_required_invalid" };
    const effectiveFrom = input.effectiveFrom ?? null, effectiveTo = input.effectiveTo ?? null;
    if (effectiveFrom !== null && !isIsoDate(effectiveFrom))
        return { valid: false, value: null, reason: "effective_from_invalid" };
    if (effectiveTo !== null && !isIsoDate(effectiveTo))
        return { valid: false, value: null, reason: "effective_to_invalid" };
    if (effectiveFrom !== null && effectiveTo !== null && asciiCompare(effectiveFrom, effectiveTo) > 0)
        return { valid: false, value: null, reason: "effective_range_reversed" };
    if (!Number.isInteger(input.version) || input.version < 1)
        return { valid: false, value: null, reason: "version_invalid" };
    const tuple = {
        equipmentModelId: input.equipmentModelId, partId: input.partId, compatibilityType,
        assembly: nullableText(input.assembly), installationPosition: nullableText(input.installationPosition), applicability: app.value,
    };
    const uniquenessKey = buildCompatibilityUniquenessKey(tuple);
    const compatibilityId = buildCompatibilityId(uniquenessKey);
    if (input.uniquenessKey !== undefined && input.uniquenessKey !== uniquenessKey)
        return { valid: false, value: null, reason: "uniqueness_key_mismatch" };
    if (input.compatibilityId !== undefined && input.compatibilityId !== compatibilityId)
        return { valid: false, value: null, reason: "compatibility_id_mismatch" };
    const value = {
        ...tuple, compatibilityId, uniquenessKey,
        quantityRequired, effectiveFrom, effectiveTo, sourceSummary: nullableText(input.sourceSummary),
        confidenceLevel, verificationStatus, notes: nullableText(input.notes), version: input.version,
    };
    return { valid: true, value, reason: null };
}
function detectCompatibilityCollisions(records = [], opts = {}) {
    if (!Array.isArray(records))
        return { collisions: [], duplicates: [], invalid: [{ index: -1, reason: "not_array" }] };
    const byId = new Map(), invalid = [];
    records.forEach((record, index) => {
        const v = validateCompatibility(record, opts);
        if (!v.valid) {
            invalid.push({ index, reason: v.reason });
            return;
        }
        if (!byId.has(v.value.compatibilityId))
            byId.set(v.value.compatibilityId, []);
        byId.get(v.value.compatibilityId).push({ index, value: v.value });
    });
    const collisions = [], duplicates = [];
    for (const [compatibilityId, group] of byId) {
        if (group.length < 2)
            continue;
        const canonical = JSON.stringify(group[0].value);
        (group.every((g) => JSON.stringify(g.value) === canonical) ? duplicates : collisions)
            .push({ compatibilityId, indexes: group.map((g) => g.index).sort((a, b) => a - b) });
    }
    const byKey = (x) => x.compatibilityId;
    return { collisions: collisions.sort((a, b) => asciiCompare(byKey(a), byKey(b))), duplicates: duplicates.sort((a, b) => asciiCompare(byKey(a), byKey(b))), invalid };
}
function validateCompatibilitySource(input) {
    if (!plain(input))
        return { valid: false, value: null, reason: "not_object" };
    if (Object.keys(input).some((k) => !SOURCE_FIELDS.has(k)))
        return { valid: false, value: null, reason: "unknown_field" };
    if (!isCanonicalCompatibilityId(input.compatibilityId))
        return { valid: false, value: null, reason: "compatibility_id_invalid" };
    const authorityType = (0, equipmentModel_1.normalizeIdentityKey)(input.authorityType);
    if (!exports.AUTHORITY_TYPES.includes(authorityType))
        return { valid: false, value: null, reason: "authority_type_invalid" };
    const sourceReference = (0, equipmentModel_1.normalizeIdentityText)(input.sourceReference);
    if (!sourceReference)
        return { valid: false, value: null, reason: "source_reference_invalid" };
    const observedClaim = (0, equipmentModel_1.normalizeIdentityKey)(input.observedClaim);
    if (!exports.OBSERVED_CLAIMS.includes(observedClaim))
        return { valid: false, value: null, reason: "observed_claim_invalid" };
    if (typeof input.contentFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.contentFingerprint))
        return { valid: false, value: null, reason: "content_fingerprint_invalid" };
    if (!isIsoDateTime(input.capturedAt))
        return { valid: false, value: null, reason: "captured_at_invalid" };
    const capturedBy = (0, equipmentModel_1.normalizeIdentityText)(input.capturedBy);
    if (!capturedBy)
        return { valid: false, value: null, reason: "captured_by_invalid" };
    const value = { compatibilityId: input.compatibilityId, authorityType, sourceReference, sourceVersion: nullableText(input.sourceVersion), observedClaim, contentFingerprint: input.contentFingerprint, capturedAt: input.capturedAt, capturedBy, notes: nullableText(input.notes) };
    const sourceId = `src_${sha256Hex(JSON.stringify([value.compatibilityId, value.authorityType, value.sourceReference, value.sourceVersion, value.contentFingerprint]))}`;
    if (input.sourceId !== undefined && input.sourceId !== sourceId)
        return { valid: false, value: null, reason: "source_id_mismatch" };
    value.sourceId = sourceId;
    return { valid: true, value, reason: null };
}
function detectCompatibilitySourceCollisions(records = []) {
    if (!Array.isArray(records))
        return { collisions: [], duplicates: [], invalid: [{ index: -1, reason: "not_array" }] };
    const byId = new Map(), invalid = [];
    records.forEach((record, index) => {
        const v = validateCompatibilitySource(record);
        if (!v.valid) {
            invalid.push({ index, reason: v.reason });
            return;
        }
        if (!byId.has(v.value.sourceId))
            byId.set(v.value.sourceId, []);
        byId.get(v.value.sourceId).push({ index, value: v.value });
    });
    const collisions = [], duplicates = [];
    for (const [sourceId, group] of byId) {
        if (group.length < 2)
            continue;
        const canonical = JSON.stringify(group[0].value);
        (group.every((g) => JSON.stringify(g.value) === canonical) ? duplicates : collisions)
            .push({ sourceId, indexes: group.map((g) => g.index).sort((a, b) => a - b) });
    }
    const byKey = (x) => x.sourceId;
    return { collisions: collisions.sort((a, b) => asciiCompare(byKey(a), byKey(b))), duplicates: duplicates.sort((a, b) => asciiCompare(byKey(a), byKey(b))), invalid };
}
function analyzeValidatedEvidence(values, compatibilityId) {
    const supporting = [], contradicting = [], inconclusive = [];
    const buckets = { SUPPORTS: supporting, CONTRADICTS: contradicting, INCONCLUSIVE: inconclusive };
    for (const v of values)
        buckets[v.observedClaim].push(v);
    const order = (list) => [...list].sort((a, b) => (exports.AUTHORITY_RANK[b.authorityType] - exports.AUTHORITY_RANK[a.authorityType]) || asciiCompare(a.sourceId, b.sourceId));
    const s = order(supporting), c = order(contradicting);
    const hasConflict = s.length > 0 && c.length > 0;
    const authoritativeSupport = s.some((e) => exports.AUTHORITATIVE_AUTHORITIES.includes(e.authorityType));
    let recommendedStatus;
    if (hasConflict)
        recommendedStatus = "CONFLICT";
    else if (s.length > 0)
        recommendedStatus = authoritativeSupport ? "SUPPORTS_AUTHORITATIVE" : "SUPPORTS_EVIDENCE_ONLY";
    else if (c.length > 0)
        recommendedStatus = "CONTRADICTED";
    else if (inconclusive.length > 0)
        recommendedStatus = "INCONCLUSIVE";
    else
        recommendedStatus = "NO_EVIDENCE";
    return { compatibilityId: compatibilityId ?? null, recommendedStatus, hasConflict, authoritativeSupport, supporting: s, contradicting: c, inconclusive, strongestSupport: s[0]?.authorityType ?? null, strongestContradiction: c[0]?.authorityType ?? null, mixedRelationships: false };
}
function analyzeCompatibilityEvidence(records = [], { expectedCompatibilityId = null } = {}) {
    if (!Array.isArray(records))
        return { ...analyzeValidatedEvidence([], expectedCompatibilityId), invalid: [{ index: -1, reason: "not_array" }] };
    const invalid = [], valid = [];
    records.forEach((record, index) => {
        const v = validateCompatibilitySource(record);
        if (!v.valid) {
            invalid.push({ index, reason: v.reason });
            return;
        }
        valid.push({ index, value: v.value });
    });
    const bySortedIndex = (a, b) => a.index - b.index;
    let target = expectedCompatibilityId;
    if (target == null) {
        const distinct = [...new Set(valid.map((v) => v.value.compatibilityId))];
        if (distinct.length > 1)
            return { ...analyzeValidatedEvidence([], null), mixedRelationships: true, recommendedStatus: "MIXED_RELATIONSHIPS", compatibilityIds: distinct.sort(asciiCompare), invalid: invalid.sort(bySortedIndex) };
        target = distinct[0] ?? null;
    }
    const matched = [];
    for (const v of valid) {
        if (target != null && v.value.compatibilityId !== target)
            invalid.push({ index: v.index, reason: "compatibility_id_mismatch" });
        else
            matched.push(v.value);
    }
    return { ...analyzeValidatedEvidence(matched, target), invalid: invalid.sort(bySortedIndex) };
}
function analyzeCompatibilityEvidenceByRelationship(records = []) {
    if (!Array.isArray(records))
        return { relationships: [], invalid: [{ index: -1, reason: "not_array" }] };
    const invalid = [], groups = new Map();
    records.forEach((record, index) => {
        const v = validateCompatibilitySource(record);
        if (!v.valid) {
            invalid.push({ index, reason: v.reason });
            return;
        }
        if (!groups.has(v.value.compatibilityId))
            groups.set(v.value.compatibilityId, []);
        groups.get(v.value.compatibilityId).push(v.value);
    });
    const relationships = [...groups].sort(([a], [b]) => asciiCompare(a, b)).map(([compatibilityId, list]) => analyzeValidatedEvidence(list, compatibilityId));
    return { relationships, invalid: invalid.sort((a, b) => a.index - b.index) };
}
//# sourceMappingURL=compatibility.js.map