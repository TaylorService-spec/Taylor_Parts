"use strict";
// Enterprise Inventory Phase 4 -- shared path-safety guard, mirrored verbatim from
// receivingLocationResolver.ts's isSafeDocumentIdSegment (same invariant, same reasoning: a locationId
// must be a single safe Firestore document-id segment BEFORE any document reference is constructed).
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafeDocumentIdSegment = isSafeDocumentIdSegment;
const MAX_DOC_ID_BYTES = 1500;
function isSafeDocumentIdSegment(id) {
    if (typeof id !== "string" || id.trim() === "")
        return false;
    if (id.includes("/"))
        return false;
    if (id === "." || id === "..")
        return false;
    if (/^__.*__$/.test(id))
        return false;
    if (Buffer.byteLength(id, "utf8") > MAX_DOC_ID_BYTES)
        return false;
    return true;
}
//# sourceMappingURL=transferDocIdGuard.js.map