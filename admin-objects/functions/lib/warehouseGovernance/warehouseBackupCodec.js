"use strict";
// EI Phase-2 Receiving -- Gate E2-V: LOSSLESS, PURE typed backup/restore codec for the `warehouses`
// collection. The Gate-E2 migration (I-LA3) commits governed §3A records over legacy documents in ONE
// transaction, then verifies AFTER commit -- so a post-commit verification failure can leave committed
// records with no usable rollback unless a byte/semantic-faithful pre-migration snapshot exists. Plain
// JSON.stringify over Firestore documents is NOT lossless (a Timestamp does not round-trip), so this
// module encodes every stored value into an explicit typed envelope and decodes it back to the exact
// Firestore type, or FAILS CLOSED on any value it cannot round-trip. No I/O here: the operator CLI
// (warehouseBackupRestoreCli.js) supplies the Admin-SDK read/write seams.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RESTORE_TXN_BYTES = exports.MAX_RESTORE_TXN_WRITES = exports.WarehouseBackupError = void 0;
exports.encodeValue = encodeValue;
exports.decodeValue = decodeValue;
exports.snapshotHash = snapshotHash;
exports.liveSetContentHash = liveSetContentHash;
exports.assertRestorableSnapshot = assertRestorableSnapshot;
exports.encodeSnapshot = encodeSnapshot;
exports.validateSnapshotShape = validateSnapshotShape;
exports.decodeSnapshot = decodeSnapshot;
exports.planRestore = planRestore;
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
class WarehouseBackupError extends Error {
    code;
    constructor(code, message) { super(message); this.name = "WarehouseBackupError"; this.code = code; }
}
exports.WarehouseBackupError = WarehouseBackupError;
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function encodeValue(value, pathHint = "$") {
    if (value === null)
        return null;
    if (typeof value === "boolean" || typeof value === "string")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new WarehouseBackupError("UNSUPPORTED_VALUE", `non-finite number at ${pathHint}`);
        // Firestore int64 values outside JS's safe-integer range may already be rounded when read through the
        // default Admin SDK number representation; writing them back would silently corrupt. Reject them (a
        // full int64 codec would need an explicit BigInt envelope, out of scope here). Non-integer doubles
        // round-trip through JSON exactly and are allowed.
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
            throw new WarehouseBackupError("UNSUPPORTED_VALUE", `integer outside safe range (possible int64 rounding) at ${pathHint}`);
        }
        return value;
    }
    if (value instanceof firestore_1.Timestamp) {
        return { __fsType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    if (Array.isArray(value))
        return value.map((v, i) => encodeValue(v, `${pathHint}[${i}]`));
    if (isPlainObject(value)) {
        const out = {};
        for (const k of Object.keys(value)) {
            if (k.startsWith("__fsType"))
                throw new WarehouseBackupError("RESERVED_KEY", `reserved key "${k}" at ${pathHint}`);
            out[k] = encodeValue(value[k], `${pathHint}.${k}`);
        }
        return out;
    }
    // undefined, bigint, symbol, function, Buffer, GeoPoint, DocumentReference, class instances -> fail closed.
    throw new WarehouseBackupError("UNSUPPORTED_VALUE", `unsupported value type (${typeof value}) at ${pathHint}`);
}
function isEncodedTimestamp(v) {
    return isPlainObject(v) && v.__fsType === "timestamp"
        && Number.isInteger(v.seconds)
        && Number.isInteger(v.nanoseconds);
}
function decodeValue(value, pathHint = "$") {
    if (value === null || typeof value === "boolean" || typeof value === "string")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new WarehouseBackupError("CORRUPT_SNAPSHOT", `non-finite number at ${pathHint}`);
        if (Number.isInteger(value) && !Number.isSafeInteger(value))
            throw new WarehouseBackupError("CORRUPT_SNAPSHOT", `unsafe integer at ${pathHint}`);
        return value;
    }
    if (Array.isArray(value))
        return value.map((v, i) => decodeValue(v, `${pathHint}[${i}]`));
    if (isEncodedTimestamp(value))
        return new firestore_1.Timestamp(value.seconds, value.nanoseconds);
    if (isPlainObject(value)) {
        if ("__fsType" in value)
            throw new WarehouseBackupError("CORRUPT_SNAPSHOT", `malformed typed envelope at ${pathHint}`);
        const out = {};
        for (const k of Object.keys(value))
            out[k] = decodeValue(value[k], `${pathHint}.${k}`);
        return out;
    }
    throw new WarehouseBackupError("CORRUPT_SNAPSHOT", `undecodable value at ${pathHint}`);
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const rec = value;
        return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function snapshotHash(snapshot) {
    // Hash the whole envelope canonically -- stable across key ordering; binds identity + content + pins.
    return (0, node_crypto_1.createHash)("sha256").update(canonicalJson(snapshot)).digest("hex");
}
// Content-only fingerprint of a COMPLETE live set: the sorted [{warehouseId, encoded}] pairs, WITHOUT the
// project/commit pins. Used to bind a rollback to an exact expected-current-state (post-migration) hash so
// the restore fails closed if ANY document content changed since that state was approved (not just added/
// deleted ids). encodeValue enforces round-trippability, so this hash also rejects unrestorable values.
function liveSetContentHash(live) {
    const seen = new Set();
    const pairs = live.map((d) => {
        if (typeof d.warehouseId !== "string" || d.warehouseId.trim() === "")
            throw new WarehouseBackupError("INVALID_INPUT", "blank warehouseId");
        if (seen.has(d.warehouseId))
            throw new WarehouseBackupError("INVALID_INPUT", `duplicate warehouseId ${d.warehouseId}`);
        seen.add(d.warehouseId);
        if (!isPlainObject(d.data))
            throw new WarehouseBackupError("UNSUPPORTED_VALUE", `warehouse ${d.warehouseId} data is not a map`);
        return { warehouseId: d.warehouseId, encoded: encodeValue(d.data, `$(${d.warehouseId})`) };
    });
    pairs.sort((a, b) => (a.warehouseId < b.warehouseId ? -1 : a.warehouseId > b.warehouseId ? 1 : 0));
    return (0, node_crypto_1.createHash)("sha256").update(canonicalJson(pairs)).digest("hex");
}
// A restore commits every captured doc in ONE Firestore transaction. Firestore caps a transaction at 500
// document writes and ~10 MiB request size; a snapshot that cannot be restored atomically must fail closed
// at BACKUP time (never leave the operator with an un-restorable rollback artifact).
exports.MAX_RESTORE_TXN_WRITES = 500;
exports.MAX_RESTORE_TXN_BYTES = 9_000_000; // safety margin under the ~10 MiB transaction request limit
function assertRestorableSnapshot(snapshot, byteLength) {
    if (snapshot.capturedCount > exports.MAX_RESTORE_TXN_WRITES) {
        throw new WarehouseBackupError("UNRESTORABLE", `captured ${snapshot.capturedCount} docs exceeds the ${exports.MAX_RESTORE_TXN_WRITES}-write single-transaction limit`);
    }
    if (byteLength > exports.MAX_RESTORE_TXN_BYTES) {
        throw new WarehouseBackupError("UNRESTORABLE", `snapshot ${byteLength} bytes exceeds the ${exports.MAX_RESTORE_TXN_BYTES}-byte single-transaction limit`);
    }
}
function assertPins(projectId, governedCommit) {
    if (projectId !== "taylor-parts")
        throw new WarehouseBackupError("INVALID_INPUT", "projectId must be taylor-parts");
    if (!/^[0-9a-f]{40}$/.test(governedCommit))
        throw new WarehouseBackupError("INVALID_INPUT", "governedCommit must be a 40-hex commit");
}
function encodeSnapshot(live, pins) {
    assertPins(pins.projectId, pins.governedCommit);
    const docs = {};
    const ids = [];
    for (const d of live) {
        if (typeof d.warehouseId !== "string" || d.warehouseId.trim() === "")
            throw new WarehouseBackupError("INVALID_INPUT", "blank warehouseId in live set");
        if (Object.prototype.hasOwnProperty.call(docs, d.warehouseId))
            throw new WarehouseBackupError("INVALID_INPUT", `duplicate warehouseId ${d.warehouseId}`);
        if (!isPlainObject(d.data))
            throw new WarehouseBackupError("UNSUPPORTED_VALUE", `warehouse ${d.warehouseId} data is not a map`);
        docs[d.warehouseId] = encodeValue(d.data, `$(${d.warehouseId})`);
        ids.push(d.warehouseId);
    }
    ids.sort();
    return { kind: "warehouse-backup", projectId: pins.projectId, governedCommit: pins.governedCommit, capturedCount: ids.length, docIds: ids, docs };
}
function validateSnapshotShape(snapshot) {
    if (!isPlainObject(snapshot))
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "snapshot is not an object");
    const s = snapshot;
    if (s.kind !== "warehouse-backup")
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "wrong snapshot kind");
    if (typeof s.projectId !== "string" || typeof s.governedCommit !== "string")
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "missing pins");
    assertPins(s.projectId, s.governedCommit);
    if (!Array.isArray(s.docIds) || !isPlainObject(s.docs))
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "missing docIds/docs");
    const ids = s.docIds;
    if (!ids.every((x) => typeof x === "string"))
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "docIds not all strings");
    const sorted = [...ids].sort();
    if (canonicalJson(ids) !== canonicalJson(sorted))
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "docIds not sorted-canonical");
    const docKeys = Object.keys(s.docs).sort();
    if (canonicalJson(docKeys) !== canonicalJson(sorted))
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "docs keys != docIds");
    if (s.capturedCount !== ids.length)
        throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "capturedCount != docIds length");
    return s;
}
// Decode the snapshot back to real Firestore-typed documents (validated shape first).
function decodeSnapshot(snapshot) {
    const validated = validateSnapshotShape(snapshot);
    return validated.docIds.map((id) => ({ warehouseId: id, data: decodeValue(validated.docs[id], `$(${id})`) }));
}
function planRestore(snapshot, live, pins) {
    const validated = validateSnapshotShape(snapshot);
    if (pins.projectId !== validated.projectId)
        return fail("project_mismatch");
    if (pins.governedCommit !== validated.governedCommit)
        return fail("commit_mismatch");
    const liveIds = new Set();
    for (const d of live) {
        if (typeof d.warehouseId !== "string" || d.warehouseId.trim() === "")
            return fail("live_blank_id");
        if (liveIds.has(d.warehouseId))
            return fail("live_duplicate_id");
        liveIds.add(d.warehouseId);
    }
    const snapIds = new Set(validated.docIds);
    const added = [...liveIds].filter((id) => !snapIds.has(id)).sort();
    const deleted = [...snapIds].filter((id) => !liveIds.has(id)).sort();
    if (added.length > 0 || deleted.length > 0) {
        return { ok: false, reason: "live_set_drift", added, deleted, changedCount: 0, restoreCount: 0 };
    }
    // Count content changes (the revert target) for evidence -- not blocking.
    const liveById = new Map(live.map((d) => [d.warehouseId, d.data]));
    let changedCount = 0;
    for (const id of validated.docIds) {
        const encodedLive = canonicalJson(encodeValue(liveById.get(id), `$(${id})`));
        if (encodedLive !== canonicalJson(validated.docs[id]))
            changedCount += 1;
    }
    return { ok: true, reason: null, added, deleted, changedCount, restoreCount: validated.docIds.length };
}
function fail(reason) {
    return { ok: false, reason, added: [], deleted: [], changedCount: 0, restoreCount: 0 };
}
//# sourceMappingURL=warehouseBackupCodec.js.map