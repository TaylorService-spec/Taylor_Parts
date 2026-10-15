"use strict";
// ALIAS IDENTITY -- the pure derivation, extracted.
//
// EXTRACTED, NOT REWRITTEN. `encodeAliasDocId` and `deriveAliasDocId` moved verbatim out of
// `partAliasRepository.ts`, which imports `firebase-admin/firestore` for its Timestamp handling. The
// PostgreSQL Catalog authority derives the SAME identity and must not carry a Firebase dependency to
// reach it -- `catalogMaster` is proved Firebase-free by a runtime probe, and that proof is worth
// more than the convenience of importing the repository.
//
// The derivation itself is the uniqueness rule: `<aliasType>__<normalizedValue>`, percent-encoding
// the two characters a Firestore document id cannot carry from our normalization charsets ("%" then
// "/"). A second implementation would mean the same barcode resolved to two different identities
// depending on which store answered.
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeAliasDocId = encodeAliasDocId;
exports.deriveAliasDocId = deriveAliasDocId;
const normalization_1 = require("./normalization");
/** Storage-safe deterministic alias document id from the normalization key. */
function encodeAliasDocId(aliasKey) {
    return aliasKey.replace(/%/g, "%25").replace(/\//g, "%2F");
}
/**
 * Derive the storage id for (type, raw value, scope) through the SINGLE normalization + key
 * authority. Returns null when the value is not a well-formed identifier for that type.
 */
function deriveAliasDocId(aliasType, rawValue, manufacturerId) {
    const normalized = (0, normalization_1.normalizeIdentifier)(aliasType, rawValue, manufacturerId);
    if (!normalized.valid)
        return null;
    const key = (0, normalization_1.buildAliasKey)(aliasType, normalized.value);
    if (!key.valid)
        return null;
    return { docId: encodeAliasDocId(key.value), normalizedValue: normalized.value };
}
//# sourceMappingURL=partAliasIdentity.js.map