"use strict";
// Receiving Location Authority -- I-LA3: INERT, READ-ONLY warehouse-governance verifier (spec §4). PURE
// and DETERMINISTIC: given the live warehouse set (each bound to its Firestore document id), it categorizes
// every record using the merged shared §3A validator and reports SANITIZED counts + per-category hashes
// only -- never a raw unexpected field, credential, token, actor PII, or secret. A governed record must
// carry no legacy `active` and must have its stored id equal to its document id (both enforced by the
// shared validator). The verifier NEVER writes; the operator CLI publishes evidence atomically only after
// every check passes (no report directory on failure).
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWarehouseGovernance = verifyWarehouseGovernance;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const governedWarehouseValidation_js_1 = require("./governedWarehouseValidation.js");
const warehouseGovernanceMigration_js_1 = require("./warehouseGovernanceMigration.js");
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
// Hash of a category's sorted id set -- proves membership without exposing raw records.
function idSetHash(ids) { return sha256(canonicalJson([...ids].sort())); }
function verifyWarehouseGovernance(records) {
    const cat = { governed: [], legacy: [], ambiguous: [], malformed: [] };
    const activePresent = [];
    const identityMismatch = [];
    for (const r of records) {
        const id = r.warehouseId;
        // Independent structural flags (a record may be flagged AND non-governed).
        if (isPlainObject(r.data) && hasOwn(r.data, "active"))
            activePresent.push(id);
        if (isPlainObject(r.data) && typeof r.data.id === "string" && r.data.id !== id)
            identityMismatch.push(id);
        if ((0, governedWarehouseValidation_js_1.validateGovernedWarehouse)(r.data, id).valid) {
            cat.governed.push(id);
            continue;
        }
        if (!isPlainObject(r.data)) {
            cat.malformed.push(id);
            continue;
        }
        const c = (0, warehouseGovernanceMigration_js_1.classifyWarehouse)(id, r.data);
        if (c.category === "DERIVE")
            cat.legacy.push(id);
        else
            cat.ambiguous.push(id); // AMBIGUOUS (contradiction / malformed status)
    }
    const total = records.length;
    const pass = cat.governed.length === total && activePresent.length === 0 && identityMismatch.length === 0;
    return {
        total,
        pass,
        counts: {
            governed: cat.governed.length,
            legacy: cat.legacy.length,
            ambiguous: cat.ambiguous.length,
            malformed: cat.malformed.length,
            activePresent: activePresent.length,
            identityMismatch: identityMismatch.length,
        },
        fingerprints: {
            legacy: idSetHash(cat.legacy),
            ambiguous: idSetHash(cat.ambiguous),
            malformed: idSetHash(cat.malformed),
            activePresent: idSetHash(activePresent),
            identityMismatch: idSetHash(identityMismatch),
        },
    };
}
//# sourceMappingURL=warehouseGovernanceVerifier.js.map