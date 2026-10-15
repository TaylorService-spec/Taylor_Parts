"use strict";
// BIN REGISTRY — the trusted command service.
//
// Admin-SDK only. `bins`, `bin_code_claims` and `bin_placements` have no firestore.rules match
// block, so all three are DENY-ALL to every client including admin — the same posture `part_aliases`
// uses, and the reason no Rules change was needed to add them: a callable runs on the Admin SDK,
// which Rules do not govern.
//
// ============================ IT CREATES PLACES, NOT STOCK ============================
//
// DECISIONS #116, as amended by #160 / ADR-014 for the FUTURE roll-up model. These commands write
// bin IDENTITY and nothing else. No ledger event, no quantity, no location reference a movement
// command would accept — `makeResolveTransferLocationActive` still returns false for BIN. Creating,
// renaming, retiring or reviving a bin cannot change a single balance, and a test asserts the module
// never imports the ledger or a movement type.
//
// ============================ IDENTITY IS NOT THE CODE ============================
//
// Decision #160 ruling O-3. The document id is `deriveBinId(idempotencyKey)` — opaque, immutable,
// and independent of warehouse, area, aisle, bay, position, code and formatter. Correcting a
// mislabelled rack is now a RENAME that keeps the same `binId`, so placement history survives it.
//
// Derived-from-the-nonce rather than random is what keeps create replay-safe: a warehouse worker
// scanning the same label twice must not be punished with a duplicate bin. A fingerprint over the
// request-derived create identity turns "same key, different intent" into an explicit conflict
// instead of a silent `unchanged` over somebody else's bin.
//
// ============================ RESERVATIONS ARE PERMANENT ============================
//
// `bin_code_claims/{warehouseId}__{code}` reserves a canonical code to ONE binId, created with
// `txn.create` so a competing claim fails the transaction atomically — no query-then-write, which
// could race. A rename marks the old claim SUPERSEDED and it stays reserved to the same bin
// FOREVER: that is what stops a stale printed label from one day resolving to a different physical
// shelf. Deactivation releases nothing. P1 has no release command at all.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIN_LIST_LIMIT = exports.BinMalformedStoredRecordError = exports.BinClaimIntegrityError = exports.BinCodeReservedError = exports.BinIdempotencyConflictError = exports.BinNotFoundError = exports.BinUnauthorizedError = exports.BinInvalidError = exports.BIN_READ_CAPABILITY = exports.BIN_MANAGE_CAPABILITY = exports.BIN_CODE_CLAIMS_COLLECTION = exports.BINS_COLLECTION = void 0;
exports.createBin = createBin;
exports.renameBin = renameBin;
exports.setBinStatus = setBinStatus;
exports.resolveBinCode = resolveBinCode;
exports.resolveBinToken = resolveBinToken;
exports.listBinsForWarehouse = listBinsForWarehouse;
const collections_js_1 = require("../constants/collections.js");
const binRegistry_js_1 = require("./binRegistry.js");
exports.BINS_COLLECTION = "bins";
exports.BIN_CODE_CLAIMS_COLLECTION = "bin_code_claims";
exports.BIN_MANAGE_CAPABILITY = "inventory.location.bin.manage";
exports.BIN_READ_CAPABILITY = "inventory.location.bin.read";
class BinInvalidError extends Error {
}
exports.BinInvalidError = BinInvalidError;
class BinUnauthorizedError extends Error {
}
exports.BinUnauthorizedError = BinUnauthorizedError;
class BinNotFoundError extends Error {
}
exports.BinNotFoundError = BinNotFoundError;
/** Same idempotencyKey, different create intent. Never an `unchanged` over the existing bin. */
class BinIdempotencyConflictError extends Error {
}
exports.BinIdempotencyConflictError = BinIdempotencyConflictError;
/** The target code is HELD or SUPERSEDED by a different bin. */
class BinCodeReservedError extends Error {
}
exports.BinCodeReservedError = BinCodeReservedError;
/** A rename's own claim is missing, points elsewhere, or is in the wrong state. Never repaired. */
class BinClaimIntegrityError extends Error {
}
exports.BinClaimIntegrityError = BinClaimIntegrityError;
/** A stored bin or claim failed its own coherence check. Fail closed; never normalize into validity. */
class BinMalformedStoredRecordError extends Error {
}
exports.BinMalformedStoredRecordError = BinMalformedStoredRecordError;
const policyOf = (deps) => deps.codeFormat ?? binRegistry_js_1.DEFAULT_BIN_CODE_FORMAT;
/** Fail-closed read of a stored bin into the fields the commands need. Never normalizes. */
function readBinOrThrow(binId, data) {
    const d = data ?? {};
    if (d.schemaVersion !== binRegistry_js_1.BIN_SCHEMA_VERSION) {
        // A v1 record fails closed rather than being read. The environment gate proved both sandbox and
        // production hold zero bins, so there is nothing to translate and no dual-version reader.
        throw new BinMalformedStoredRecordError(`stored bin ${binId} has schemaVersion ${String(d.schemaVersion)}`);
    }
    const str = (k) => (typeof d[k] === "string" && d[k] !== "" ? d[k] : null);
    const int = (k) => (typeof d[k] === "number" && Number.isInteger(d[k]) ? d[k] : null);
    const warehouseId = str("warehouseId");
    const area = str("area");
    const aisle = str("aisle");
    const code = str("code");
    const idempotencyKey = str("idempotencyKey");
    const fingerprint = str("fingerprint");
    const bay = int("bay");
    const position = int("position");
    const version = int("version");
    const status = d.status === "ACTIVE" || d.status === "INACTIVE" ? d.status : null;
    if (warehouseId === null || area === null || aisle === null || code === null || idempotencyKey === null
        || fingerprint === null || bay === null || position === null || version === null || status === null) {
        throw new BinMalformedStoredRecordError(`stored bin ${binId} is unreadable`);
    }
    return { warehouseId, area, aisle, bay, position, code, status, version, idempotencyKey, fingerprint };
}
/**
 * Create a bin, or return the one that already exists.
 *
 * REPLAY vs CONFLICT. The id derives from the caller's idempotencyKey, so a retry addresses the same
 * document. What that document means is decided by the fingerprint over the request-derived create
 * identity: equal is a replay and writes nothing; different is a CONFLICT and writes nothing either.
 * Returning `unchanged` for a different intent would quietly hand the caller somebody else's bin.
 *
 * It does NOT revive a retired bin. Retiring is a deliberate act, and quietly undoing it because
 * someone re-sent a create would erase that decision without anyone seeing it.
 */
async function createBin(request, deps) {
    return deps.db.runTransaction(async (txn) => {
        if (!(await deps.authorize(txn, deps.actor.id, exports.BIN_MANAGE_CAPABILITY)))
            throw new BinUnauthorizedError();
        // The warehouse set is read INSIDE the transaction: a bin created against a warehouse that is
        // being removed concurrently would otherwise commit into nowhere.
        const warehouseSnap = await txn.get(deps.db.collection(collections_js_1.WAREHOUSES_COLLECTION));
        const knownWarehouseIds = new Set(warehouseSnap.docs.map((d) => d.id));
        const validated = (0, binRegistry_js_1.validateBinDraft)(request, knownWarehouseIds, policyOf(deps));
        if (!validated.valid)
            throw new BinInvalidError(validated.reason);
        const value = validated.value;
        const binId = (0, binRegistry_js_1.deriveBinId)(value.idempotencyKey);
        const requestFingerprint = (0, binRegistry_js_1.fingerprintBinCreate)((0, binRegistry_js_1.toBinCreateIdentity)(value));
        const binRef = deps.db.collection(exports.BINS_COLLECTION).doc(binId);
        const claimRef = deps.db.collection(exports.BIN_CODE_CLAIMS_COLLECTION).doc((0, binRegistry_js_1.deriveBinClaimId)(value.warehouseId, value.code));
        const [existing, existingClaim] = await Promise.all([txn.get(binRef), txn.get(claimRef)]);
        if (existing.exists) {
            const stored = readBinOrThrow(binId, existing.data());
            // Recompute from the stored record's OWN identity and check it against its stored fingerprint
            // before trusting either. A record that disagrees with itself is a data fault, not a replay.
            if ((0, binRegistry_js_1.fingerprintBinCreate)((0, binRegistry_js_1.toBinCreateIdentity)(stored)) !== stored.fingerprint) {
                throw new BinMalformedStoredRecordError(`stored bin ${binId} fingerprint does not match its stored value`);
            }
            if (stored.fingerprint !== requestFingerprint) {
                throw new BinIdempotencyConflictError("idempotencyKey was already used for a different bin");
            }
            return { outcome: "unchanged", binId, warehouseId: stored.warehouseId, code: stored.code, status: stored.status };
        }
        // A code already spoken for — HELD or SUPERSEDED — belongs to its bin permanently.
        if (existingClaim.exists) {
            throw new BinCodeReservedError(`code ${value.code} is already reserved in ${value.warehouseId}`);
        }
        const now = deps.now();
        // txn.create, not set: if a competing transaction claims this code between the read and the
        // commit, this one fails rather than overwriting the reservation.
        txn.create(claimRef, {
            binId,
            warehouseId: value.warehouseId,
            code: value.code,
            claimState: "HELD",
            claimedAt: now,
            claimedBy: deps.actor.id,
            schemaVersion: binRegistry_js_1.BIN_CLAIM_SCHEMA_VERSION,
        });
        txn.create(binRef, {
            warehouseId: value.warehouseId,
            area: value.area,
            aisle: value.aisle,
            bay: value.bay,
            position: value.position,
            code: value.code,
            name: value.name,
            status: value.status,
            version: 1,
            schemaVersion: binRegistry_js_1.BIN_SCHEMA_VERSION,
            idempotencyKey: value.idempotencyKey,
            fingerprint: requestFingerprint,
            createdAt: now,
            createdBy: deps.actor.id,
            updatedAt: now,
            updatedBy: deps.actor.id,
        });
        return { outcome: "created", binId, warehouseId: value.warehouseId, code: value.code, status: value.status };
    });
}
/**
 * Correct a bin's physical identity — the rack was mislabelled, or the racking was renumbered.
 *
 * `binId` NEVER CHANGES. That is the whole point of BIN-P1: every `bin_placement`, and later every
 * ledger and cycle-count reference, keeps pointing at the same bin through a rename.
 *
 * The old claim is VERIFIED, never repaired. A missing or wrong claim means the reservation index
 * and the bin disagree about reality, and silently fixing that would destroy the evidence of
 * whatever caused it.
 *
 * Permitted on an INACTIVE bin: correcting a mislabelled retired rack is legitimate, and a bin has
 * no custody, so it changes no availability. Status is untouched.
 */
async function renameBin(request, deps) {
    const draft = (request ?? {});
    const binId = typeof draft.binId === "string" ? draft.binId : "";
    if (!(0, binRegistry_js_1.isSafeIdSegment)(binId))
        throw new BinInvalidError("bin_reference_invalid");
    const validated = (0, binRegistry_js_1.validateBinRenameDraft)(draft, policyOf(deps));
    if (!validated.valid)
        throw new BinInvalidError(validated.reason);
    const next = validated.value;
    return deps.db.runTransaction(async (txn) => {
        if (!(await deps.authorize(txn, deps.actor.id, exports.BIN_MANAGE_CAPABILITY)))
            throw new BinUnauthorizedError();
        const binRef = deps.db.collection(exports.BINS_COLLECTION).doc(binId);
        const snap = await txn.get(binRef);
        if (!snap.exists)
            throw new BinNotFoundError();
        const stored = readBinOrThrow(binId, snap.data());
        // Renaming to the code the bin already holds is a no-op. It must NOT try to create the claim it
        // already owns, which would fail against its own reservation.
        if (next.code === stored.code) {
            return { outcome: "unchanged", binId, warehouseId: stored.warehouseId, code: stored.code, status: stored.status };
        }
        const oldClaimRef = deps.db.collection(exports.BIN_CODE_CLAIMS_COLLECTION).doc((0, binRegistry_js_1.deriveBinClaimId)(stored.warehouseId, stored.code));
        const newClaimRef = deps.db.collection(exports.BIN_CODE_CLAIMS_COLLECTION).doc((0, binRegistry_js_1.deriveBinClaimId)(stored.warehouseId, next.code));
        const [oldClaim, newClaim] = await Promise.all([txn.get(oldClaimRef), txn.get(newClaimRef)]);
        if (!oldClaim.exists)
            throw new BinClaimIntegrityError("the bin's current code has no reservation");
        const oc = oldClaim.data() ?? {};
        if (oc.binId !== binId)
            throw new BinClaimIntegrityError("the current code is reserved to a different bin");
        if (oc.warehouseId !== stored.warehouseId)
            throw new BinClaimIntegrityError("the current reservation is in a different warehouse");
        if (oc.code !== stored.code)
            throw new BinClaimIntegrityError("the current reservation names a different code");
        if (oc.claimState !== "HELD")
            throw new BinClaimIntegrityError("the current reservation is not HELD");
        if (newClaim.exists)
            throw new BinCodeReservedError(`code ${next.code} is already reserved in ${stored.warehouseId}`);
        const now = deps.now();
        txn.create(newClaimRef, {
            binId,
            warehouseId: stored.warehouseId,
            code: next.code,
            claimState: "HELD",
            claimedAt: now,
            claimedBy: deps.actor.id,
            schemaVersion: binRegistry_js_1.BIN_CLAIM_SCHEMA_VERSION,
        });
        // The old code stays reserved to THIS bin, forever. A stale label therefore still resolves to
        // the right shelf, and no other bin can ever take that code.
        txn.update(oldClaimRef, { claimState: "SUPERSEDED", supersededAt: now, supersededBy: deps.actor.id });
        txn.update(binRef, {
            area: next.area,
            aisle: next.aisle,
            bay: next.bay,
            position: next.position,
            code: next.code,
            ...(next.name === undefined ? {} : { name: next.name }),
            version: stored.version + 1,
            updatedAt: now,
            updatedBy: deps.actor.id,
        });
        return { outcome: "updated", binId, warehouseId: stored.warehouseId, code: next.code, status: stored.status };
    });
}
/**
 * Retire or revive a bin.
 *
 * NOTHING IS EVER DELETED. A retired bin stays readable so a put-away recorded against it last year
 * still resolves to a place with a name, rather than to a dangling id.
 *
 * DEACTIVATION RELEASES NO CODE. Both the HELD claim and every SUPERSEDED one stay reserved to this
 * bin, so retiring a rack can never free its code for a different physical shelf. Reactivation
 * therefore reclaims nothing — there was never anything to reclaim.
 */
async function setBinStatus(request, status, deps) {
    const draft = (request ?? {});
    const binId = typeof draft.binId === "string" ? draft.binId : "";
    const warehouseId = typeof draft.warehouseId === "string" ? draft.warehouseId : "";
    const rawCode = draft.code;
    return deps.db.runTransaction(async (txn) => {
        if (!(await deps.authorize(txn, deps.actor.id, exports.BIN_MANAGE_CAPABILITY)))
            throw new BinUnauthorizedError();
        let ref;
        if ((0, binRegistry_js_1.isSafeIdSegment)(binId)) {
            ref = deps.db.collection(exports.BINS_COLLECTION).doc(binId);
        }
        else {
            // Compatibility with the existing scan-first flow: a human code plus its warehouse still
            // reaches a bin, through the reservation index rather than a derived id.
            const normalized = (0, binRegistry_js_1.normalizeBinCode)(rawCode);
            if (warehouseId === "" || !normalized.valid)
                throw new BinInvalidError("bin_reference_invalid");
            const claimSnap = await txn.get(deps.db.collection(exports.BIN_CODE_CLAIMS_COLLECTION).doc((0, binRegistry_js_1.deriveBinClaimId)(warehouseId, normalized.value.code)));
            if (!claimSnap.exists)
                throw new BinNotFoundError();
            const claimedBinId = (claimSnap.data() ?? {}).binId;
            if (typeof claimedBinId !== "string" || !(0, binRegistry_js_1.isSafeIdSegment)(claimedBinId)) {
                throw new BinMalformedStoredRecordError("stored claim does not name a bin");
            }
            ref = deps.db.collection(exports.BINS_COLLECTION).doc(claimedBinId);
        }
        const snap = await txn.get(ref);
        if (!snap.exists)
            throw new BinNotFoundError();
        const stored = readBinOrThrow(ref.id, snap.data());
        if (stored.status === status) {
            // Already there. Reporting `unchanged` rather than failing keeps a retry harmless.
            return { outcome: "unchanged", binId: ref.id, warehouseId: stored.warehouseId, code: stored.code, status };
        }
        const now = deps.now();
        txn.update(ref, { status, version: stored.version + 1, updatedAt: now, updatedBy: deps.actor.id });
        return { outcome: "updated", binId: ref.id, warehouseId: stored.warehouseId, code: stored.code, status };
    });
}
/**
 * Resolve one scanned or typed HUMAN CODE within a warehouse. READ-ONLY.
 *
 * Gated on the READ capability, not the manage one: an operator putting stock away needs to check
 * that a bin is real, and giving them that check should not also let them create and retire racking.
 *
 * This path can never answer WRONG_WAREHOUSE — see resolveBinFromClaim.
 */
async function resolveBinCode(db, rawCode, warehouseId) {
    const normalized = (0, binRegistry_js_1.normalizeBinCode)(rawCode);
    if (!normalized.valid)
        return { result: "MALFORMED", detail: normalized.reason };
    if (!(0, binRegistry_js_1.isSafeIdSegment)(warehouseId))
        return { result: "MALFORMED", detail: "warehouse reference invalid" };
    const claimSnap = await db.collection(exports.BIN_CODE_CLAIMS_COLLECTION).doc((0, binRegistry_js_1.deriveBinClaimId)(warehouseId, normalized.value.code)).get();
    if (!claimSnap.exists)
        return { result: "NOT_FOUND" };
    const claim = claimSnap.data() ?? {};
    const binId = typeof claim.binId === "string" ? claim.binId : "";
    if (!(0, binRegistry_js_1.isSafeIdSegment)(binId))
        return { result: "MALFORMED", detail: "stored claim does not name a bin" };
    const binSnap = await db.collection(exports.BINS_COLLECTION).doc(binId).get();
    return (0, binRegistry_js_1.resolveBinFromClaim)(rawCode, warehouseId, claim, binSnap.exists ? (binSnap.data() ?? null) : null);
}
/**
 * Resolve a scanned MACHINE TOKEN — the stable binId — against the operator's warehouse. READ-ONLY.
 *
 * This is the governed lookup the shared scan boundary deliberately does NOT perform:
 * `resolveScannedIdentity` is pure and matches only candidates its caller already read. The trusted
 * resolver produces the canonical `{ type: "BIN", locationId }` candidate; the pure matcher never
 * fetches it. That separation is why no client-direct `bins` read and no cross-warehouse preload
 * exists anywhere in this path.
 */
async function resolveBinToken(db, rawToken, activeWarehouseId) {
    if (!(0, binRegistry_js_1.isSafeIdSegment)(activeWarehouseId))
        return { result: "MALFORMED", detail: "warehouse reference invalid" };
    if (!(0, binRegistry_js_1.isSafeIdSegment)(rawToken) || !String(rawToken).startsWith("bin_")) {
        return { result: "MALFORMED", detail: "token is not a bin identity" };
    }
    const snap = await db.collection(exports.BINS_COLLECTION).doc(rawToken).get();
    return (0, binRegistry_js_1.resolveBinFromToken)(rawToken, activeWarehouseId, snap.exists ? (snap.data() ?? null) : null);
}
/** Every bin in one warehouse, for a picker. Bounded: racking is finite, but not unbounded. */
exports.BIN_LIST_LIMIT = 500;
async function listBinsForWarehouse(db, warehouseId) {
    // Reads `bins`, never `bin_code_claims`. The reservation index is a uniqueness and history
    // mechanism, not a bin catalog: listing from it would surface superseded codes as if they were
    // places, and would make a supporting index look like a second Location authority.
    const snap = await db.collection(exports.BINS_COLLECTION)
        .where("warehouseId", "==", warehouseId)
        .limit(exports.BIN_LIST_LIMIT + 1)
        .get();
    const docs = snap.docs.slice(0, exports.BIN_LIST_LIMIT);
    return {
        // A malformed stored bin is EXCLUDED rather than rendered as a blank row an operator might scan.
        bins: docs
            .map((d) => {
            const data = d.data() ?? {};
            if (data.schemaVersion !== binRegistry_js_1.BIN_SCHEMA_VERSION)
                return null;
            if (typeof data.code !== "string" || data.code === "")
                return null;
            if (typeof data.area !== "string" || typeof data.aisle !== "string")
                return null;
            if (!Number.isInteger(data.bay) || !Number.isInteger(data.position))
                return null;
            return {
                binId: d.id,
                code: data.code,
                name: typeof data.name === "string" ? data.name : null,
                status: (data.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"),
                area: data.area,
                aisle: data.aisle,
                bay: data.bay,
                position: data.position,
            };
        })
            .filter((b) => b !== null),
        truncated: snap.docs.length > exports.BIN_LIST_LIMIT,
    };
}
//# sourceMappingURL=binCommands.js.map