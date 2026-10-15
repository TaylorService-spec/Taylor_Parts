"use strict";
// SCANNED IDENTIFIER -> PART. The trusted read service behind barcode/alias lookup.
//
// ============================ WHY THIS EXISTS AT ALL ============================
//
// `resolvePartAlias` answers "is THIS VALUE registered as THIS TYPE?" -- it takes a declared
// aliasType because the alias document id is derived from (type, normalized value). That is exactly
// right for administration, where the administrator knows which kind of identifier they are
// registering.
//
// A SCAN DOES NOT CARRY ITS TYPE. A barcode wedge hands over "0037000112345" with no statement of
// whether that is a UPC, a GTIN, a supplier SKU or a legacy code. Something has to decide which
// types the value could be and ask about each.
//
// That decision is made HERE, server-side, once. The alternative -- letting the client try several
// types -- would put a matching algorithm in the browser, where it could disagree with the server
// about what a scan means, and would leak the alias namespace one round trip at a time.
//
// ============================ NO SECOND MATCHER ============================
//
// Every individual question is still `resolvePartAlias`, unchanged. Normalization is still
// `normalizeIdentifier` / `deriveAliasDocId`, unchanged. This file adds NO parsing, NO pattern
// matching, NO fuzzy comparison and NO alias store of its own: it chooses which existing questions
// to ask and how to combine the answers. If the two disagreed about what a value normalizes to, the
// scanner and the administrator would see different worlds -- which is the failure the Phase A
// scan-to-test probe was built to prevent, and it stays prevented because there is still one
// normalizer.
//
// ============================ FAIL CLOSED ============================
//
// Two registered identifiers pointing at DIFFERENT Parts is AMBIGUOUS, never a pick. An identifier
// that is registered but switched off is INACTIVE, never NOT_FOUND. A value that no type can even
// normalize is MALFORMED, never NOT_FOUND. Each of those calls for a different fix, so none of them
// is collapsed into another.
Object.defineProperty(exports, "__esModule", { value: true });
exports.candidateAliasTypes = void 0;
exports.resolveScannedPartIdentifier = resolveScannedPartIdentifier;
const firestore_1 = require("firebase-admin/firestore");
const partAliasCommands_js_1 = require("./partAliasCommands.js");
const partAliasScanCore_js_1 = require("./partAliasScanCore.js");
// The five outcomes, the candidate-type rule and the fan-out itself now live in the PURE
// `partAliasScanCore.ts`, so the PostgreSQL Catalog authority shares them without importing
// Firebase. Re-exported here so every existing caller and test keeps its import path.
var partAliasScanCore_js_2 = require("./partAliasScanCore.js");
Object.defineProperty(exports, "candidateAliasTypes", { enumerable: true, get: function () { return partAliasScanCore_js_2.candidateAliasTypes; } });
async function resolveScannedPartIdentifier(input, deps) {
    // An empty identifier is MALFORMED before anything is read. Resolving the Firestore handle first
    // would make a pure input check depend on an initialized app.
    const raw = typeof input?.rawValue === "string" ? input.rawValue.trim() : "";
    if (raw.length === 0)
        return { result: "MALFORMED", detail: "identifier value must be a non-empty string" };
    const resolver = deps?.resolver ?? partAliasCommands_js_1.resolvePartAlias;
    const db = deps?.db ?? (0, firestore_1.getFirestore)();
    return (0, partAliasScanCore_js_1.resolveScannedIdentifierWith)((probe) => resolver({
        aliasType: probe.aliasType,
        rawValue: probe.rawValue,
        ...(probe.manufacturerId !== undefined ? { manufacturerId: probe.manufacturerId } : {}),
    }, { db }), input);
}
//# sourceMappingURL=partAliasScanResolver.js.map