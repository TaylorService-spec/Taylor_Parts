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
exports.candidateAliasTypes = candidateAliasTypes;
exports.resolveScannedPartIdentifier = resolveScannedPartIdentifier;
const firestore_1 = require("firebase-admin/firestore");
const partAliasCommands_js_1 = require("./partAliasCommands.js");
const types_js_1 = require("./types.js");
/**
 * Which alias types a bare scanned value could be.
 *
 * All of them EXCEPT MANUFACTURER_PN, which normalizeIdentifier() requires a manufacturer scope for
 * (`${manufacturerId}|${value}`) and which therefore cannot be resolved from a bare scan. When the
 * caller supplies a manufacturerId it is included; when they do not, it is not a candidate rather
 * than an error, because "you did not tell me the manufacturer" is not a property of the scan.
 *
 * Types whose normalizer rejects the value simply return MALFORMED for that type and drop out --
 * scanning a 12-digit number does not "fail" as a UPC and also "fail" as a LEGACY code; it is
 * asked about as both and answers for itself. That is why per-type MALFORMED is not an error here,
 * and why an OVERALL malformed verdict requires every candidate type to have rejected it.
 */
function candidateAliasTypes(hasManufacturerScope) {
    return types_js_1.ALIAS_TYPES.filter((t) => t !== "MANUFACTURER_PN" || hasManufacturerScope);
}
async function resolveScannedPartIdentifier(input, deps) {
    const raw = typeof input?.rawValue === "string" ? input.rawValue.trim() : "";
    if (raw.length === 0)
        return { result: "MALFORMED", detail: "identifier value must be a non-empty string" };
    const resolver = deps?.resolver ?? partAliasCommands_js_1.resolvePartAlias;
    const db = deps?.db ?? (0, firestore_1.getFirestore)();
    const manufacturerId = typeof input?.manufacturerId === "string" && input.manufacturerId.length > 0
        ? input.manufacturerId
        : undefined;
    const types = candidateAliasTypes(manufacturerId !== undefined);
    const found = [];
    const inactive = [];
    let anyTypeAccepted = false;
    const malformedDetails = [];
    for (const aliasType of types) {
        const outcome = await resolver({ aliasType, rawValue: raw, ...(manufacturerId !== undefined ? { manufacturerId } : {}) }, { db });
        switch (outcome.result) {
            case "FOUND":
                anyTypeAccepted = true;
                found.push({ partId: outcome.partId, aliasType: outcome.aliasType, aliasId: outcome.aliasId });
                break;
            case "INACTIVE":
                anyTypeAccepted = true;
                inactive.push({ partId: outcome.partId, aliasType: outcome.aliasType, aliasId: outcome.aliasId });
                break;
            case "NOT_FOUND":
                // The value normalizes as this type; nothing is registered under it. That still means the
                // value is WELL-FORMED for at least one type, which is what separates NOT_FOUND from
                // MALFORMED overall.
                anyTypeAccepted = true;
                break;
            case "MALFORMED":
                malformedDetails.push(`${aliasType}: ${outcome.detail}`);
                break;
            case "CONFLICT":
                // Reserved and structurally unreachable under the unique-doc-id contract. If it ever does
                // occur, it is a stored-data conflict and must surface as one, not be swallowed.
                return { result: "MALFORMED", detail: `alias conflict: ${outcome.detail}` };
        }
    }
    // ACTIVE registrations win over inactive ones, but only where they agree on the Part.
    const distinctFound = [...new Map(found.map((f) => [f.partId, f])).values()];
    if (distinctFound.length === 1) {
        const one = distinctFound[0];
        return { result: "FOUND", partId: one.partId, aliasType: one.aliasType, aliasId: one.aliasId };
    }
    if (distinctFound.length > 1) {
        return {
            result: "AMBIGUOUS",
            matches: distinctFound.map((f) => ({ partId: f.partId, aliasType: f.aliasType })),
        };
    }
    // Nothing active. A registered-but-switched-off identifier is reported as exactly that: telling
    // the operator it was never registered would send them to create a duplicate of a record that
    // someone deliberately retired.
    const distinctInactive = [...new Map(inactive.map((i) => [i.partId, i])).values()];
    if (distinctInactive.length === 1) {
        const one = distinctInactive[0];
        return { result: "INACTIVE", partId: one.partId, aliasType: one.aliasType, aliasId: one.aliasId };
    }
    if (distinctInactive.length > 1) {
        return {
            result: "AMBIGUOUS",
            matches: distinctInactive.map((i) => ({ partId: i.partId, aliasType: i.aliasType })),
        };
    }
    // Well-formed for at least one type and registered under none of them.
    if (anyTypeAccepted)
        return { result: "NOT_FOUND" };
    // Every candidate type rejected the value outright.
    return {
        result: "MALFORMED",
        detail: malformedDetails.length > 0 ? "not a recognizable identifier for any registered type" : "no candidate identifier type",
    };
}
//# sourceMappingURL=partAliasScanResolver.js.map