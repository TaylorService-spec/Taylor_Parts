"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogSnapshotError = exports.CERTIFICATION_PROVENANCE_VALUE = exports.CERTIFICATION_MARKER_FIELD = exports.SNAPSHOT_VERSION = exports.SNAPSHOT_FORMAT = void 0;
exports.certificationExclusionReason = certificationExclusionReason;
exports.parseCatalogSnapshot = parseCatalogSnapshot;
exports.timestampToIsoMicros = timestampToIsoMicros;
exports.canonicalizePart = canonicalizePart;
exports.canonicalizeEquipmentModel = canonicalizeEquipmentModel;
exports.canonicalDigest = canonicalDigest;
exports.censusCatalogSnapshot = censusCatalogSnapshot;
// The CATALOG SNAPSHOT -- the legacy Firestore `parts` and `equipment_models` documents, as a file, and the pure
// census / canonicalization the one-time copy runs on it (functions/scripts/catalogCutover.js).
//
// ════════════════════ WHY A FILE ════════════════════
//
// The copy tool never loads a Firebase module. The Firestore read is a separate, read-only export step
// (the operator snapshot export in functions/scripts, never imported by runtime code) that writes this file; census, copy and verify consume it. So the
// PostgreSQL side of the cutover is Firebase-free by construction, and the exact bytes that were copied are a
// durable, hashable artifact rather than a moment in a live collection.
//
// ════════════════════ THE FORMAT (version 1) ════════════════════
//
//   { "format": "EOS_CATALOG_SNAPSHOT", "version": 1,
//     "source": { "firebaseProjectId": "<project>", "exportedAt": "<ISO>" },
//     "parts":            [ { "id": "<document id>", "data": { ...document fields } }, ... ],
//     "equipmentModels":  [ { "id": "<document id>", "data": { ...document fields } }, ... ] }
//
// A Firestore Timestamp is encoded as { "$timestamp": { "seconds": <int>, "nanoseconds": <int 0..999999999> } }.
// Any other non-JSON Firestore value is refused at export.
//
// ════════════════════ WHAT "CANONICAL" MEANS ════════════════════
//
// Exactly what the Firestore repository adapters read back, because that is what every Firestore reader sees:
//   Part            partMasterRepository.ts#partFromFirestore -- data.partId === doc id, validatePart, readMeta
//   Equipment Model equipmentModelRepository.ts#modelFromFirestore -- data.equipmentModelId === doc id, canonical id,
//                   validateEquipmentModel, repository.ts#readMeta (updatedAt >= createdAt)
// A document either side refuses is INVALID here too and blocks the copy. Nothing is repaired or defaulted.
const node_crypto_1 = require("node:crypto");
const validation_1 = require("../partMaster/validation");
const equipmentModel_1 = require("../equipmentCompatibility/domain/equipmentModel");
const catalogRows_1 = require("./catalogRows");
exports.SNAPSHOT_FORMAT = "EOS_CATALOG_SNAPSHOT";
exports.SNAPSHOT_VERSION = 1;
/**
 * How a Certification fixture is EXPLICITLY identified -- never guessed from an id or a name.
 *   * the `certificationWorld` marker every markered certification record carries
 *     (functions/scripts/certificationWorld/manifest.mjs MARKER_FIELD; `parts` and `equipment_models` are markered
 *     groups -- only `warehouses` is markerless, certificationWorld.mjs expectedRecords);
 *   * `dataProvenance: "SYNTHETIC_CERTIFICATION_FACT"` (certificationWorld/data/partsCatalog.mjs).
 *
 * OWNER RULING (2026-09-14): Certification stays frozen. Identified fixtures are ALWAYS excluded from the operational
 * catalog copy -- there is no option that includes them -- and are never used as seed truth. Their counts, ids and
 * exclusion reason are carried in the census / copy / verify evidence instead.
 */
exports.CERTIFICATION_MARKER_FIELD = "certificationWorld";
exports.CERTIFICATION_PROVENANCE_VALUE = "SYNTHETIC_CERTIFICATION_FACT";
/** The exclusion reason for a document, or null when it is not an identified Certification fixture. */
function certificationExclusionReason(data) {
    if (Object.prototype.hasOwnProperty.call(data, exports.CERTIFICATION_MARKER_FIELD))
        return "CERTIFICATION_FIXTURE_EXCLUDED:certificationWorld-marker";
    if (data.dataProvenance === exports.CERTIFICATION_PROVENANCE_VALUE)
        return "CERTIFICATION_FIXTURE_EXCLUDED:dataProvenance";
    return null;
}
/** The fields partToFirestore / modelToFirestore write. Everything else on a document is not master data. */
const PART_STORED_FIELDS = new Set([
    "partId", "internalPartNumber", "name", "description", "category", "status", "stockingUnit", "controlType", "stockingClass",
    "flags", "primaryManufacturerId", "primaryManufacturerPartNumber", "oemStatus", "wholeUnit", "equipmentModelId",
    "version", "createdAt", "createdBy", "updatedAt", "updatedBy",
]);
const MODEL_STORED_FIELDS = new Set([
    "equipmentModelId", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision",
    "status", "sourceAuthority", "version", "createdAt", "createdBy", "updatedAt", "updatedBy",
]);
const MAX_ACTOR = 128;
class CatalogSnapshotError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CatalogSnapshotError";
    }
}
exports.CatalogSnapshotError = CatalogSnapshotError;
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
/** Structural parse. Content problems are census findings, not parse errors. */
function parseCatalogSnapshot(json) {
    if (!isPlain(json) || json.format !== exports.SNAPSHOT_FORMAT || json.version !== exports.SNAPSHOT_VERSION) {
        throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", `not an ${exports.SNAPSHOT_FORMAT} version ${exports.SNAPSHOT_VERSION} file`);
    }
    const source = json.source;
    if (!isPlain(source) || typeof source.firebaseProjectId !== "string" || source.firebaseProjectId === "" || typeof source.exportedAt !== "string") {
        throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", "source.firebaseProjectId and source.exportedAt are required");
    }
    const docs = (name) => {
        const list = json[name];
        if (!Array.isArray(list))
            throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name} must be a list`);
        return list.map((d, i) => {
            if (!isPlain(d) || typeof d.id !== "string" || !isPlain(d.data)) {
                throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name}[${i}] must be { id, data }`);
            }
            return { id: d.id, data: d.data };
        });
    };
    return { source: { firebaseProjectId: source.firebaseProjectId, exportedAt: source.exportedAt }, parts: docs("parts"), equipmentModels: docs("equipmentModels") };
}
function readTimestamp(v) {
    if (!isPlain(v) || Object.keys(v).length !== 1 || !isPlain(v.$timestamp))
        return null;
    const { seconds, nanoseconds } = v.$timestamp;
    if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999_999_999)
        return null;
    if (Object.keys(v.$timestamp).length !== 2)
        return null;
    return { seconds: seconds, nanoseconds: nanoseconds };
}
/** A timestamp as the canonical microsecond ISO string, and whether sub-microsecond digits were dropped. */
function timestampToIsoMicros(t) {
    const ms = t.seconds * 1000 + Math.floor(t.nanoseconds / 1_000_000);
    const base = new Date(ms).toISOString().slice(0, 19);
    const micros = String(Math.floor(t.nanoseconds / 1000)).padStart(6, "0");
    return { iso: `${base}.${micros}Z`, truncated: t.nanoseconds % 1000 !== 0 };
}
const compareTs = (a, b) => (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds);
function readMeta(data, requireOrder) {
    const created = readTimestamp(data.createdAt), updated = readTimestamp(data.updatedAt);
    if (!Number.isInteger(data.version) || data.version < 1)
        return "META_VERSION_INVALID";
    if (created === null || updated === null)
        return "META_TIMESTAMP_INVALID";
    const actor = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_ACTOR;
    if (!actor(data.createdBy) || !actor(data.updatedBy))
        return "META_ACTOR_INVALID";
    if (requireOrder && compareTs(updated, created) < 0)
        return "META_UPDATED_BEFORE_CREATED";
    const c = timestampToIsoMicros(created), u = timestampToIsoMicros(updated);
    return { version: data.version, createdAt: c.iso, updatedAt: u.iso, truncated: Number(c.truncated) + Number(u.truncated) };
}
function canonicalizePart(doc) {
    const d = doc.data;
    if (d.partId !== doc.id)
        return { ok: false, reason: "IDENTITY_MISMATCH" };
    const v = (0, validation_1.validatePart)({
        partId: d.partId, internalPartNumber: d.internalPartNumber, name: d.name, description: d.description, category: d.category,
        status: d.status, stockingUnit: d.stockingUnit, controlType: d.controlType, stockingClass: d.stockingClass, flags: d.flags,
        manufacturerId: d.primaryManufacturerId, manufacturerPartNumber: d.primaryManufacturerPartNumber, oemStatus: d.oemStatus,
        wholeUnit: d.wholeUnit, equipmentModelId: d.equipmentModelId,
    });
    if (!v.valid)
        return { ok: false, reason: `DOMAIN_INVALID:${v.errors.map((e) => `${e.path}:${e.code}`).join(",")}` };
    // parsePartId trims; partFromFirestore compares the untrimmed doc id first, so a padded id never reaches here.
    if (v.value.partId !== doc.id)
        return { ok: false, reason: "IDENTITY_NOT_CANONICAL" };
    const meta = readMeta(d, false); // partMasterRepository.readMeta imposes no created/updated order
    if (typeof meta === "string")
        return { ok: false, reason: meta };
    return { ok: true, record: (0, catalogRows_1.canonicalPartOf)(v.value, meta), truncatedTimestamps: meta.truncated };
}
function canonicalizeEquipmentModel(doc) {
    const d = doc.data;
    if (d.equipmentModelId !== doc.id)
        return { ok: false, reason: "IDENTITY_MISMATCH" };
    if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(doc.id))
        return { ok: false, reason: "IDENTITY_NOT_CANONICAL" };
    const v = (0, equipmentModel_1.validateEquipmentModel)({
        equipmentModelId: d.equipmentModelId, manufacturerId: d.manufacturerId, manufacturerName: d.manufacturerName,
        modelNumber: d.modelNumber, displayName: d.displayName, family: d.family, subtype: d.subtype, revision: d.revision,
        status: d.status, sourceAuthority: d.sourceAuthority, version: d.version,
    });
    if (!v.valid)
        return { ok: false, reason: `DOMAIN_INVALID:${v.reason}` };
    const meta = readMeta(d, true);
    if (typeof meta === "string")
        return { ok: false, reason: meta };
    const m = v.value;
    return {
        ok: true,
        truncatedTimestamps: meta.truncated,
        record: {
            id: m.equipmentModelId, manufacturerId: m.manufacturerId, manufacturerName: m.manufacturerName, modelNumber: m.modelNumber,
            displayName: m.displayName, family: m.family, subtype: m.subtype, revision: m.revision, status: m.status,
            sourceAuthority: m.sourceAuthority, version: meta.version, createdAt: meta.createdAt, updatedAt: meta.updatedAt,
        },
    };
}
const asciiSort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const countInto = (bag, key) => { bag[key] = (bag[key] ?? 0) + 1; };
const sortedBag = (bag) => Object.fromEntries(Object.entries(bag).sort(([a], [b]) => asciiSort(a, b)));
function canonicalDigest(catalog) {
    const h = (0, node_crypto_1.createHash)("sha256");
    for (const m of catalog.equipmentModels)
        h.update(JSON.stringify(catalogRows_1.EQUIPMENT_MODEL_FIELDS.map((f) => m[f])) + "\n");
    h.update("--parts--\n");
    for (const p of catalog.parts)
        h.update(JSON.stringify(catalogRows_1.PART_FIELDS.map((f) => p[f])) + "\n");
    return h.digest("hex");
}
function censusCatalogSnapshot(snapshot) {
    const invalid = [];
    const duplicates = [];
    const blockers = [];
    let truncated = 0;
    const excludedCounts = { parts: 0, equipmentModels: 0 };
    const excluded = [];
    const provenance = [];
    const nonMaster = { parts: {}, equipmentModels: {} };
    const statuses = { parts: {}, equipmentModels: {} };
    const select = (docs, kind, storedFields, bag, canonicalize) => {
        const seen = new Map();
        for (const d of docs)
            seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
        for (const [id, n] of seen)
            if (n > 1)
                duplicates.push({ kind, id, reason: `DUPLICATE_CANONICAL_IDENTITY:${n}` });
        const out = [];
        for (const d of docs) {
            const exclusion = certificationExclusionReason(d.data);
            if (exclusion !== null) {
                excludedCounts[bag] += 1;
                excluded.push({ kind, id: d.id, reason: exclusion });
                continue;
            }
            for (const f of Object.keys(d.data))
                if (!storedFields.has(f))
                    countInto(nonMaster[bag], f);
            const c = canonicalize(d);
            if (!c.ok) {
                invalid.push({ kind, id: d.id, reason: c.reason });
                continue;
            }
            countInto(statuses[bag], c.record.status);
            truncated += c.truncatedTimestamps;
            if ((seen.get(d.id) ?? 0) > 1)
                continue;
            out.push(c.record);
            const actor = (v) => (typeof v === "string" ? v : null);
            provenance.push({ kind, id: d.id, legacyCreatedBy: actor(d.data.createdBy), legacyUpdatedBy: actor(d.data.updatedBy) });
        }
        return out.sort((a, b) => asciiSort(a.id, b.id));
    };
    const equipmentModels = select(snapshot.equipmentModels, "equipment_model", MODEL_STORED_FIELDS, "equipmentModels", canonicalizeEquipmentModel);
    const parts = select(snapshot.parts, "part", PART_STORED_FIELDS, "parts", canonicalizePart);
    // A Part's equipment-model FK must resolve INSIDE what is being copied (assertEquipmentModelExists, at copy time).
    const modelIds = new Set(equipmentModels.map((m) => m.id));
    const missingReferences = parts
        .filter((p) => p.equipmentModelId !== null && !modelIds.has(p.equipmentModelId))
        .map((p) => ({ kind: "part", id: p.id, reason: `EQUIPMENT_MODEL_NOT_IN_SNAPSHOT:${p.equipmentModelId}` }));
    const skuDisagrees = snapshot.parts.filter((d) => d.data.sku !== undefined && d.data.sku !== d.id).map((d) => d.id).sort(asciiSort);
    const byIpn = new Map();
    for (const p of parts)
        byIpn.set(p.internalPartNumber, [...(byIpn.get(p.internalPartNumber) ?? []), p.id]);
    const duplicateIpns = [...byIpn].filter(([, ids]) => ids.length > 1).map(([internalPartNumber, partIds]) => ({ internalPartNumber, partIds })).sort((a, b) => asciiSort(a.internalPartNumber, b.internalPartNumber));
    const partIds = new Set(snapshot.parts.map((d) => d.id));
    const crossKind = [...new Set(snapshot.equipmentModels.map((d) => d.id))].filter((id) => partIds.has(id)).sort(asciiSort);
    if (invalid.length > 0)
        blockers.push("INVALID_SOURCE_RECORDS");
    if (duplicates.length > 0)
        blockers.push("DUPLICATE_CANONICAL_IDENTITY");
    if (missingReferences.length > 0)
        blockers.push("MISSING_REFERENCES");
    const catalog = { parts, equipmentModels };
    const census = {
        source: snapshot.source,
        counts: { parts: snapshot.parts.length, equipmentModels: snapshot.equipmentModels.length },
        certificationExcluded: { counts: excludedCounts, records: excluded.sort((a, b) => asciiSort(`${a.kind}|${a.id}`, `${b.kind}|${b.id}`)) },
        selected: { parts: parts.length, equipmentModels: equipmentModels.length },
        invalid: invalid.sort((a, b) => asciiSort(`${a.kind}|${a.id}`, `${b.kind}|${b.id}`)),
        duplicateIdentities: duplicates.sort((a, b) => asciiSort(`${a.kind}|${a.id}`, `${b.kind}|${b.id}`)),
        missingReferences,
        statusDistribution: { parts: sortedBag(statuses.parts), equipmentModels: sortedBag(statuses.equipmentModels) },
        nonMasterFields: { parts: sortedBag(nonMaster.parts), equipmentModels: sortedBag(nonMaster.equipmentModels) },
        skuDisagreesWithPartId: skuDisagrees,
        duplicateInternalPartNumbers: duplicateIpns,
        crossKindIdentities: crossKind,
        truncatedTimestamps: truncated,
        blockers,
        copyReady: blockers.length === 0,
        canonicalDigest: canonicalDigest(catalog),
    };
    provenance.sort((a, b) => asciiSort(`${a.kind}|${a.id}`, `${b.kind}|${b.id}`));
    return { census, catalog, legacyActorProvenance: provenance };
}
//# sourceMappingURL=catalogSnapshot.js.map