"use strict";
// Receiving Location Authority -- I-LA3: INERT, UNEXPORTED warehouse-governance migration core
// (spec: docs/specifications/receiving-location-authority-i-la-c2-warehouse-status.md §4). PURE and
// DETERMINISTIC classification + planning + manifest validation + the execute staging that turns legacy
// warehouses into governed §3A MIGRATED records THROUGH an injected transaction/store seam. NOT exported
// from functions/src/index.ts; no callable; no production read/write here (the operator CLI wires real
// deps lazily and is dry-run by default). Governed by the merged shared §3A validator.
//
// Contract highlights (§4): dry-run is the default; execute re-reads live state and recomputes each
// pre-state fingerprint before any write, failing closed on ANY drift; unambiguous legacy records follow
// the ratified status-derivation matrix; contradictory/malformed records require an exact Owner-authored
// resolution-manifest entry; migrated records get the complete MIGRATED envelope (status, version 1,
// updatedAt/By, provenance MIGRATED, governanceInitializedAt/By), preserve an authentic createdAt/By pair
// only when both are valid (never fabricated), and drop legacy `active` in the same trusted write;
// already-governed records are byte-stable no-ops; reruns are idempotent; stop on the first integrity
// failure with no partial migration.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WarehouseMigrationError = exports.MIGRATION_INITIAL_VERSION = void 0;
exports.warehouseGovernanceFingerprint = warehouseGovernanceFingerprint;
exports.classifyWarehouse = classifyWarehouse;
exports.planMigration = planMigration;
exports.validateResolutionManifest = validateResolutionManifest;
exports.buildMigratedRecord = buildMigratedRecord;
exports.executeMigration = executeMigration;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const governedWarehouseValidation_js_1 = require("./governedWarehouseValidation.js");
const warehouse_js_1 = require("../types/warehouse.js");
exports.MIGRATION_INITIAL_VERSION = 1;
class WarehouseMigrationError extends Error {
    code;
    constructor(code, message) { super(message); this.code = code; this.name = new.target.name; }
}
exports.WarehouseMigrationError = WarehouseMigrationError;
// -------- pure helpers (local canonical hash; opaque + deterministic) --------
function canonicalJson(value) {
    if (value instanceof firestore_1.Timestamp)
        return `T:${value.toMillis()}`;
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const rec = value;
        return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function sha256(value) { return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex"); }
function isPlainObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function isNonBlank(v) { return typeof v === "string" && v.trim() !== ""; }
// A sanitized, deterministic pre-state fingerprint over the WHOLE stored record (an opaque hash -- no raw
// field value is ever exposed). Any drift to the document changes the fingerprint, so a manifest authored
// against a prior state fails closed at execute.
function warehouseGovernanceFingerprint(data) {
    return sha256(canonicalJson(data));
}
// Deterministic classification of a single stored record against the §4 matrix. `data` is the raw stored
// document; `warehouseId` is its Firestore document id.
function classifyWarehouse(warehouseId, data) {
    const fingerprint = warehouseGovernanceFingerprint(data);
    // Already a governed §3A record (bound to its doc id) -> byte-stable no-op.
    if ((0, governedWarehouseValidation_js_1.validateGovernedWarehouse)(data, warehouseId).valid) {
        return { warehouseId, category: "GOVERNED", derivedStatus: null, fingerprint };
    }
    if (!isPlainObject(data))
        return { warehouseId, category: "AMBIGUOUS", derivedStatus: null, fingerprint };
    const statusPresent = hasOwn(data, "status");
    const statusValid = typeof data.status === "string" && warehouse_js_1.WAREHOUSE_STATUSES.includes(data.status);
    const activeFalse = data.active === false;
    const activeTrueOrAbsent = data.active === true || !hasOwn(data, "active");
    // Malformed status present (not in enum) -> ambiguous (manifest required).
    if (statusPresent && !statusValid)
        return { warehouseId, category: "AMBIGUOUS", derivedStatus: null, fingerprint };
    // Missing status -> derive from legacy active.
    if (!statusPresent) {
        return { warehouseId, category: "DERIVE", derivedStatus: activeFalse ? "INACTIVE" : "ACTIVE", fingerprint };
    }
    // Valid status present. Contradictions require a manifest.
    const s = data.status;
    if ((s === "ACTIVE" && activeFalse) || (s === "INACTIVE" && data.active === true)) {
        return { warehouseId, category: "AMBIGUOUS", derivedStatus: null, fingerprint };
    }
    void activeTrueOrAbsent;
    // Valid status, non-contradictory (active absent, or active consistent) -> derive that status.
    return { warehouseId, category: "DERIVE", derivedStatus: s, fingerprint };
}
// Dry-run plan: classify the WHOLE live set deterministically. Pure; no writes.
function planMigration(live, pins) {
    if (!isNonBlank(pins.projectId) || !isNonBlank(pins.governedCommit))
        throw new WarehouseMigrationError("INVALID_INPUT", "projectId/governedCommit must be pinned");
    const seen = new Set();
    const classified = [];
    for (const item of live) {
        if (!isNonBlank(item.warehouseId))
            throw new WarehouseMigrationError("INVALID_INPUT", "warehouseId invalid");
        if (seen.has(item.warehouseId))
            throw new WarehouseMigrationError("INVALID_INPUT", "duplicate warehouseId in live set");
        seen.add(item.warehouseId);
        classified.push(classifyWarehouse(item.warehouseId, item.data));
    }
    const ambiguous = classified.filter((c) => c.category === "AMBIGUOUS");
    const counts = {
        total: classified.length,
        governed: classified.filter((c) => c.category === "GOVERNED").length,
        derive: classified.filter((c) => c.category === "DERIVE").length,
        ambiguous: ambiguous.length,
    };
    return { projectId: pins.projectId, governedCommit: pins.governedCommit, classified, ambiguous, counts };
}
// Validate an Owner manifest against a plan's ambiguous set. Fails closed on missing / extra / duplicate /
// invalid-status / wrong-project / wrong-commit / stale-prestate entries.
function validateResolutionManifest(manifest, plan) {
    const bad = (reason) => ({ valid: false, resolved: new Map(), reason });
    if (!isPlainObject(manifest))
        return bad("manifest_not_object");
    if (manifest.projectId !== plan.projectId)
        return bad("wrong_project");
    if (manifest.governedCommit !== plan.governedCommit)
        return bad("wrong_commit");
    if (!Array.isArray(manifest.entries))
        return bad("entries_not_array");
    const ambiguousById = new Map(plan.ambiguous.map((a) => [a.warehouseId, a]));
    const resolved = new Map();
    for (const entry of manifest.entries) {
        if (!isPlainObject(entry) || !isNonBlank(entry.warehouseId))
            return bad("entry_malformed");
        const id = entry.warehouseId;
        if (resolved.has(id))
            return bad("duplicate_entry");
        const target = ambiguousById.get(id);
        if (!target)
            return bad("extra_entry"); // an entry for a non-ambiguous (or unknown) id
        if (typeof entry.intendedStatus !== "string" || !warehouse_js_1.WAREHOUSE_STATUSES.includes(entry.intendedStatus))
            return bad("invalid_status");
        if (entry.preStateFingerprint !== target.fingerprint)
            return bad("stale_prestate");
        resolved.set(id, entry.intendedStatus);
    }
    // Every ambiguous record must have an entry.
    for (const a of plan.ambiguous)
        if (!resolved.has(a.warehouseId))
            return bad("missing_entry");
    return { valid: true, resolved, reason: null };
}
// Build the full governed §3A MIGRATED record for a legacy document. Preserves an authentic createdAt/By
// pair ONLY when both are valid (never fabricated); adds governanceInitializedAt/By; drops legacy `active`.
function buildMigratedRecord(warehouseId, data, status, ctx) {
    const ts = firestore_1.Timestamp.fromMillis(ctx.nowMillis);
    const record = {
        id: warehouseId,
        name: isPlainObject(data) && isNonBlank(data.name) ? data.name : "",
        location: isPlainObject(data) && isNonBlank(data.location) ? data.location : "",
        status,
        version: exports.MIGRATION_INITIAL_VERSION,
        updatedAt: ts,
        updatedBy: ctx.actorId,
        provenance: "MIGRATED",
        governanceInitializedAt: ts,
        governanceInitializedBy: ctx.actorId,
    };
    if (isPlainObject(data) && data.createdAt instanceof firestore_1.Timestamp && isNonBlank(data.createdBy)) {
        record.createdAt = data.createdAt;
        record.createdBy = data.createdBy;
    }
    return record;
}
// EXECUTE the migration bound to a dry-run `plan`. Binds to the COMPLETE live warehouse set inside the
// caller's transaction: (1) validates the manifest against the ambiguous set; (2) re-reads the WHOLE set
// and requires its exact id-set to match the planned set -- a record added or deleted since dry-run fails
// closed (LIVE_SET_DRIFT); (3) recomputes + compares the fingerprint of EVERY planned record, GOVERNED
// included, so a governed record that changed after planning fails closed (STALE_PRESTATE); (4) builds +
// self-validates every proposed record; and only after the complete set passes does it stage any write.
// GOVERNED records are byte-stable no-ops (fingerprint-checked but not restaged). Stops on the first
// failure (throws) -- the caller's transaction makes it all-or-nothing.
async function executeMigration(args) {
    if (!isNonBlank(args.actorId))
        throw new WarehouseMigrationError("INVALID_INPUT", "actorId invalid");
    const nowMillis = args.now().getTime();
    // (1) Whole-set manifest validation before ANY write: the manifest must exactly resolve the ambiguous set.
    const manifestCheck = validateResolutionManifest(args.manifest, args.plan);
    if (args.plan.ambiguous.length > 0 || (isPlainObject(args.manifest) && Array.isArray(args.manifest.entries) && args.manifest.entries.length > 0)) {
        if (!manifestCheck.valid)
            throw new WarehouseMigrationError("MANIFEST_INVALID", `manifest invalid: ${manifestCheck.reason}`);
    }
    // (2) Re-read the COMPLETE live set through the txn and require an exact id-set match with the plan.
    const liveMap = new Map();
    for (const w of await args.store.readAll()) {
        if (!isNonBlank(w.warehouseId))
            throw new WarehouseMigrationError("INVALID_INPUT", "live warehouseId invalid");
        if (liveMap.has(w.warehouseId))
            throw new WarehouseMigrationError("INVALID_INPUT", "duplicate warehouseId in live set");
        liveMap.set(w.warehouseId, w.data);
    }
    const planIds = new Set(args.plan.classified.map((c) => c.warehouseId));
    if (liveMap.size !== planIds.size)
        throw new WarehouseMigrationError("LIVE_SET_DRIFT", "live warehouse set changed since dry-run");
    for (const id of planIds)
        if (!liveMap.has(id))
            throw new WarehouseMigrationError("LIVE_SET_DRIFT", "planned warehouse missing from live set");
    // (3) Recompute + compare the fingerprint of EVERY planned record (GOVERNED included).
    for (const c of args.plan.classified) {
        if (warehouseGovernanceFingerprint(liveMap.get(c.warehouseId)) !== c.fingerprint) {
            throw new WarehouseMigrationError("STALE_PRESTATE", "live pre-state changed since dry-run");
        }
    }
    // (4) Build + self-validate all proposed records BEFORE staging any write.
    const toStage = [];
    const skippedGoverned = [];
    for (const c of args.plan.classified) {
        if (c.category === "GOVERNED") {
            skippedGoverned.push(c.warehouseId);
            continue;
        }
        const status = c.category === "DERIVE" ? c.derivedStatus : manifestCheck.resolved.get(c.warehouseId);
        if (status === undefined)
            throw new WarehouseMigrationError("AMBIGUOUS_UNRESOLVED", "ambiguous record has no resolution");
        const record = buildMigratedRecord(c.warehouseId, liveMap.get(c.warehouseId), status, { actorId: args.actorId, nowMillis });
        if (!(0, governedWarehouseValidation_js_1.validateGovernedWarehouse)(record, c.warehouseId).valid)
            throw new WarehouseMigrationError("MIGRATION_INTEGRITY", "built record is not governed");
        toStage.push({ id: c.warehouseId, record });
    }
    // (5) Stage only after the COMPLETE set has passed.
    for (const s of toStage)
        args.store.stage(s.id, s.record);
    return { migrated: toStage.map((s) => s.id), skippedGoverned, counts: { migrated: toStage.length, skippedGoverned: skippedGoverned.length } };
}
//# sourceMappingURL=warehouseGovernanceMigration.js.map