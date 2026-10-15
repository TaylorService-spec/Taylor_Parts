"use strict";
// BIN REGISTRY — bin identity, racking structure, and code derivation. PURE: no Firestore, no I/O.
//
// ============================ A BIN DESCRIBES; THE WAREHOUSE OWNS ============================
//
// DECISIONS #116, as amended by #160 / ADR-014. The warehouse remains the inventory custody
// authority. Under the approved roll-up model a BIN will eventually become an authoritative physical
// position beneath its warehouse — but NOT in BIN-P1. Today a bin is still descriptive.
//
// The invariant that protects: PUTTING STOCK INTO A BIN MUST NOT REMOVE IT FROM WAREHOUSE ON-HAND OR
// AVAILABLE. Every governed authority — availability, receiving, transfer, cycle count — counts a
// movement only at `type === "WAREHOUSE"` (and sometimes MOBILE), and BIN-P1 changes none of them.
//
// So this module still does NOT:
//   • carry a quantity, a balance, a reservation or any stock figure;
//   • establish a hierarchy that anything rolls up through.
//
// It DOES now produce a canonical `{ type: "BIN", locationId: binId }` reference — but only as a
// SCAN CANDIDATE for the shared identity boundary (see resolveBinFromToken). That is not custody:
// `makeResolveTransferLocationActive` still returns false for BIN, so no movement command will
// accept one. A test asserts that separation, because the reference existing is exactly the shape
// that could otherwise leak into custody math.
//
// ============================ THE HUMAN CODE IS NOT THE IDENTITY ============================
//
// Decision #160 ruling O-3. Before BIN-P1 the document id WAS the human code
// (`bin_{warehouseId}__{code}`), so correcting a mislabelled rack produced a different document and
// orphaned its placement history.
//
// Now:
//   binId           bin_<sha256(idempotencyKey)>  immutable, opaque, server-derived
//   code            derived from the structured racking attributes by an injected formatter
//   bin_code_claims reserves a code to a binId, permanently, HELD then SUPERSEDED
//
// The id derives from a caller-supplied request NONCE rather than being random, which keeps
// createBin replay-safe — the same discipline cycleCountDocId / Receiving / Transfer already use —
// while severing identity from every business attribute.
//
// ============================ WIDTH IS A RENDERING, NOT AN IDENTITY ============================
//
// `bay` and `position` are INTEGERS. A two-digit bay and a one-digit bay are the same bay, so the
// unresolved client question (one digit or two) is a formatter setting and never a schema
// migration. Nothing here stores a display width, and nothing encodes an odd/even generation
// policy: position 2 is exactly as valid as 1 or 3. Initial odd-number generation is BIN-P3's.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BIN_CODE_FORMAT = exports.BIN_CLAIM_STATES = exports.BIN_CLAIM_SCHEMA_VERSION = exports.BIN_SCHEMA_VERSION = exports.BIN_STATUSES = void 0;
exports.deriveBinId = deriveBinId;
exports.deriveBinClaimId = deriveBinClaimId;
exports.fingerprintBinCreate = fingerprintBinCreate;
exports.toBinCreateIdentity = toBinCreateIdentity;
exports.formatBinCode = formatBinCode;
exports.normalizeBinCode = normalizeBinCode;
exports.isSafeIdSegment = isSafeIdSegment;
exports.validateBinDraft = validateBinDraft;
exports.validateBinRenameDraft = validateBinRenameDraft;
exports.resolveBinFromClaim = resolveBinFromClaim;
exports.resolveBinFromToken = resolveBinFromToken;
const node_crypto_1 = require("node:crypto");
/** A bin is active or retired. Retiring keeps history readable; nothing is ever deleted. */
exports.BIN_STATUSES = ["ACTIVE", "INACTIVE"];
/** The stored schema this module reads and writes. A v1 record fails closed; there is no dual reader. */
exports.BIN_SCHEMA_VERSION = 2;
exports.BIN_CLAIM_SCHEMA_VERSION = 1;
/** A code claim is either the bin's current code, or one it used to hold. Neither is ever released. */
exports.BIN_CLAIM_STATES = ["HELD", "SUPERSEDED"];
/**
 * Bin codes as they appear on a warehouse label: letters, digits, and the separators people
 * actually paint on racking. No spaces after normalization, and nothing that could be mistaken for
 * a path segment or an id delimiter.
 */
const BIN_CODE_PATTERN = /^[A-Z0-9][A-Z0-9.\-_]{0,31}$/;
const AREA_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const AISLE_PATTERN = /^[A-Z]{1,2}$/;
const MAX_BIN_NAME = 120;
const MAX_BAY = 9999;
const MAX_POSITION = 99999;
const invalid = (reason) => ({ valid: false, value: null, reason });
// ═══════════════════════════════════ identity ═══════════════════════════════════
/**
 * The stable, opaque bin identity.
 *
 * Derived from the caller's request nonce, NOT from any business attribute — so a legitimate code
 * correction, an area rename, or a change of display width all leave it untouched. Callers may
 * never supply it; `validateBinDraft` rejects a request carrying one rather than ignoring it.
 */
function deriveBinId(idempotencyKey) {
    return `bin_${(0, node_crypto_1.createHash)("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}`;
}
/**
 * The deterministic id of a code reservation.
 *
 * Two claims on the same code in the same warehouse ARE the same document, so a duplicate cannot be
 * created — there is nowhere for a second one to go. A uniqueness CHECK could race; a derived id
 * cannot. The same discipline part_aliases already uses.
 */
function deriveBinClaimId(warehouseId, code) {
    return `binclaim_${warehouseId}__${code}`;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = value;
        return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
/**
 * The create fingerprint: replay iff equal, conflict iff not.
 *
 * The DERIVED CODE and the FORMATTER POLICY are deliberately absent, and that exclusion is
 * load-bearing. The code is a function of the structured attributes and the policy, so including it
 * would couple replay detection to formatter configuration — and the first bay-width change would
 * turn every legitimate create replay into an idempotency conflict. The structured attributes are
 * the identity; the code is a rendering of it.
 *
 * `name` is absent for the same class of reason: it is descriptive metadata explicitly never used
 * for matching, so correcting a typo in a rack description must not turn a retry into a conflict.
 */
function fingerprintBinCreate(identity) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalJson(identity)).digest("hex").slice(0, 16);
}
/** Extracts exactly the create-identity fields from a stored bin. Never pass the whole record. */
function toBinCreateIdentity(stored) {
    return {
        warehouseId: stored.warehouseId,
        area: stored.area,
        aisle: stored.aisle,
        bay: stored.bay,
        position: stored.position,
        idempotencyKey: stored.idempotencyKey,
    };
}
exports.DEFAULT_BIN_CODE_FORMAT = Object.freeze({
    bayWidth: 2,
    positionWidth: 3,
    separator: "-",
});
/** `A` + bay 1 + position 3 -> `A01-003`. `AA` + 1 + 3 -> `AA01-003`. */
function formatBinCode(attrs, policy = exports.DEFAULT_BIN_CODE_FORMAT) {
    const bay = String(attrs.bay).padStart(policy.bayWidth, "0");
    const position = String(attrs.position).padStart(policy.positionWidth, "0");
    const code = `${attrs.aisle}${bay}${policy.separator}${position}`;
    if (!BIN_CODE_PATTERN.test(code))
        return invalid("code_invalid");
    return { valid: true, value: code, reason: null };
}
/**
 * Normalize a scanned or typed bin code to its canonical form.
 *
 * Collapses whitespace and upper-cases — a label reading "a01-003" and one reading "A01-003" are the
 * same physical rack, and treating them as two bins would split a shelf in half in the data.
 *
 * NO other coercion: a code with unsupported characters is rejected rather than stripped, because
 * silently deleting a character produces a code that will never match the label on the wall.
 */
function normalizeBinCode(raw) {
    if (typeof raw !== "string")
        return invalid("code_required");
    const originalCode = raw.trim();
    if (originalCode === "")
        return invalid("code_required");
    const code = originalCode.replace(/\s+/g, "").toUpperCase();
    if (!BIN_CODE_PATTERN.test(code))
        return invalid("code_invalid");
    return { valid: true, value: { code, originalCode }, reason: null };
}
/** Warehouse ids and bin ids are used as document-id segments, so they must be safe as one. */
function isSafeIdSegment(value) {
    return typeof value === "string"
        && value.trim() !== ""
        && value.length <= 128
        && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}
function normalizeAttributes(draft) {
    if (typeof draft.area !== "string")
        return invalid("area_invalid");
    const area = draft.area.trim().replace(/\s+/g, "_").toUpperCase();
    if (!AREA_PATTERN.test(area))
        return invalid("area_invalid");
    if (typeof draft.aisle !== "string")
        return invalid("aisle_invalid");
    const aisle = draft.aisle.trim().replace(/\s+/g, "").toUpperCase();
    if (!AISLE_PATTERN.test(aisle))
        return invalid("aisle_invalid");
    // Integers, not formatted strings: "01" and 1 are the same bay, and only one of them is a number.
    if (typeof draft.bay !== "number" || !Number.isInteger(draft.bay) || draft.bay < 0 || draft.bay > MAX_BAY) {
        return invalid("bay_invalid");
    }
    if (typeof draft.position !== "number" || !Number.isInteger(draft.position) || draft.position < 0 || draft.position > MAX_POSITION) {
        return invalid("position_invalid");
    }
    return { valid: true, value: { area, aisle, bay: draft.bay, position: draft.position }, reason: null };
}
function normalizeName(raw) {
    if (raw === undefined || raw === null)
        return { valid: true, value: null, reason: null };
    if (typeof raw !== "string")
        return invalid("name_invalid");
    const trimmed = raw.trim();
    if (trimmed.length > MAX_BIN_NAME)
        return invalid("name_too_long");
    return { valid: true, value: trimmed === "" ? null : trimmed, reason: null };
}
/**
 * Validate a bin CREATE request against the warehouses that actually exist.
 *
 * SCOPE VALIDATION IS NOT OPTIONAL: a bin in a warehouse that does not exist is a place nobody can
 * go, and it would accept put-aways forever without anyone noticing.
 *
 * A caller-supplied `binId` is REFUSED rather than ignored. Ignoring it would let a caller believe
 * it had chosen an identity that the server silently replaced.
 */
function validateBinDraft(input, knownWarehouseIds, policy = exports.DEFAULT_BIN_CODE_FORMAT) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return invalid("not_object");
    const draft = input;
    if (draft.binId !== undefined)
        return invalid("bin_id_not_accepted");
    if (draft.code !== undefined)
        return invalid("code_not_accepted");
    if (!isSafeIdSegment(draft.warehouseId))
        return invalid("warehouse_invalid");
    if (!knownWarehouseIds.has(draft.warehouseId))
        return invalid("warehouse_unknown");
    if (typeof draft.idempotencyKey !== "string" || draft.idempotencyKey.trim() === "") {
        return invalid("idempotency_key_invalid");
    }
    const attrs = normalizeAttributes(draft);
    if (!attrs.valid)
        return invalid(attrs.reason);
    const name = normalizeName(draft.name);
    if (!name.valid)
        return invalid(name.reason);
    const code = formatBinCode(attrs.value, policy);
    if (!code.valid)
        return invalid(code.reason);
    return {
        valid: true,
        reason: null,
        value: {
            warehouseId: draft.warehouseId,
            area: attrs.value.area,
            aisle: attrs.value.aisle,
            bay: attrs.value.bay,
            position: attrs.value.position,
            code: code.value,
            name: name.value,
            status: "ACTIVE",
            idempotencyKey: draft.idempotencyKey,
        },
    };
}
/** Validate the new physical attributes for a RENAME. No warehouse move, no identity, no status. */
function validateBinRenameDraft(input, policy = exports.DEFAULT_BIN_CODE_FORMAT) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return invalid("not_object");
    const draft = input;
    if (draft.warehouseId !== undefined)
        return invalid("warehouse_not_movable");
    if (draft.code !== undefined)
        return invalid("code_not_accepted");
    if (draft.status !== undefined)
        return invalid("status_not_accepted");
    const attrs = normalizeAttributes(draft);
    if (!attrs.valid)
        return invalid(attrs.reason);
    const code = formatBinCode(attrs.value, policy);
    if (!code.valid)
        return invalid(code.reason);
    let name;
    if (draft.name !== undefined) {
        const n = normalizeName(draft.name);
        if (!n.valid)
            return invalid(n.reason);
        name = n.value;
    }
    return { valid: true, reason: null, value: { ...attrs.value, code: code.value, name } };
}
function readStoredBin(bin, expectedWarehouseId) {
    if (bin.schemaVersion !== exports.BIN_SCHEMA_VERSION)
        return { result: "MALFORMED", detail: "stored schemaVersion invalid" };
    const warehouseId = typeof bin.warehouseId === "string" ? bin.warehouseId : "";
    const code = typeof bin.code === "string" ? bin.code : "";
    if (warehouseId === "" || code === "")
        return { result: "MALFORMED", detail: "stored bin is unreadable" };
    if (warehouseId !== expectedWarehouseId)
        return { result: "MALFORMED", detail: "stored bin warehouse disagrees" };
    const status = exports.BIN_STATUSES.includes(bin.status) ? bin.status : null;
    // An unrecognized status fails closed as INACTIVE rather than being treated as usable: a bin whose
    // state cannot be read is not a bin anyone should be told to put stock into.
    if (status !== "ACTIVE")
        return { result: "INACTIVE", code };
    return { result: "OK", code };
}
/**
 * Resolve a scanned or typed code within one warehouse, from an already-read claim and bin.
 *
 * PURE — the caller supplies both records, so this is the same decision whether it runs inside a
 * command's transaction or in a read service, and the two can never disagree.
 *
 * A SUPERSEDED code resolves to its ORIGINAL bin and reports the bin's CURRENT canonical code, so a
 * caller can tell an operator the label is outdated. It never resolves to a different bin: a
 * superseded claim is permanently reserved, so no other bin can be holding that code.
 */
function resolveBinFromClaim(rawCode, expectedWarehouseId, claim, bin) {
    const normalized = normalizeBinCode(rawCode);
    if (!normalized.valid)
        return { result: "MALFORMED", detail: normalized.reason };
    if (claim === null)
        return { result: "NOT_FOUND" };
    const binId = typeof claim.binId === "string" ? claim.binId : "";
    const claimWarehouse = typeof claim.warehouseId === "string" ? claim.warehouseId : "";
    const claimCode = typeof claim.code === "string" ? claim.code : "";
    const claimState = exports.BIN_CLAIM_STATES.includes(claim.claimState)
        ? claim.claimState
        : null;
    if (binId === "" || claimWarehouse === "" || claimCode === "" || claimState === null) {
        return { result: "MALFORMED", detail: "stored claim is unreadable" };
    }
    // A claim filed under another warehouse's key is a data fault, not a wrong-building answer: the
    // caller looked this claim up BY warehouse, so the two cannot legitimately disagree.
    if (claimWarehouse !== expectedWarehouseId)
        return { result: "MALFORMED", detail: "claim warehouse disagrees with its key" };
    if (bin === null)
        return { result: "MALFORMED", detail: "claim points at a bin that does not exist" };
    const check = readStoredBin(bin, expectedWarehouseId);
    if (check.result === "MALFORMED")
        return { result: "MALFORMED", detail: check.detail };
    if (check.result === "INACTIVE")
        return { result: "INACTIVE", binId, warehouseId: expectedWarehouseId, code: check.code };
    if (claimState === "SUPERSEDED") {
        return { result: "FOUND_SUPERSEDED_CODE", binId, warehouseId: expectedWarehouseId, code: check.code, supersededCode: claimCode };
    }
    return { result: "FOUND", binId, warehouseId: expectedWarehouseId, code: check.code };
}
function resolveBinFromToken(rawToken, activeWarehouseId, bin) {
    if (!isSafeIdSegment(rawToken) || !String(rawToken).startsWith("bin_")) {
        return { result: "MALFORMED", detail: "token is not a bin identity" };
    }
    const binId = rawToken;
    if (bin === null)
        return { result: "NOT_FOUND" };
    if (bin.schemaVersion !== exports.BIN_SCHEMA_VERSION)
        return { result: "MALFORMED", detail: "stored schemaVersion invalid" };
    const warehouseId = typeof bin.warehouseId === "string" ? bin.warehouseId : "";
    const code = typeof bin.code === "string" ? bin.code : "";
    if (warehouseId === "" || code === "")
        return { result: "MALFORMED", detail: "stored bin is unreadable" };
    // Wrong building is answered BEFORE status: telling an operator a bin is retired when they are
    // simply at the wrong site would send them looking for a replacement shelf that is not the problem.
    if (warehouseId !== activeWarehouseId)
        return { result: "WRONG_WAREHOUSE", binId, warehouseId };
    const status = exports.BIN_STATUSES.includes(bin.status) ? bin.status : null;
    if (status !== "ACTIVE")
        return { result: "INACTIVE", binId, warehouseId, code };
    return { result: "FOUND", binId, warehouseId, code, location: { type: "BIN", locationId: binId } };
}
//# sourceMappingURL=binRegistry.js.map