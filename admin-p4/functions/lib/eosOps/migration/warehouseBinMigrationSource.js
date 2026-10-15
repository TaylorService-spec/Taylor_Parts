"use strict";
// Migration 008's SOURCE MAPPING and RECONCILIATION — Firestore `warehouses` / `bins` / `bin_code_claims`
// as they exist today, to the `eos_ops` rows that replace them.
//
// PURE: no firebase-admin, no pg, no clock, no I/O. It takes already-read documents and returns
// either a row to insert or a bounded refusal token. That is what makes a reconciliation checkable
// before anything is written, and it is the same posture partIdContract.ts and
// legacyInventoryMovementMapping.ts already take for their own migrations.
//
// ════════════════════ THE ID IS CARRIED, NOT RE-DERIVED ════════════════════
//
// A warehouse's canonical id is its Firestore document id. A bin's is its existing
// `bin_<sha256(nonce)>`. Neither is recomputed here, and there is NO CROSSWALK TABLE, because an id
// that survives the move is an id no future reader has to reconcile. The bin id shape is CHECKED
// (`bin_` + 40 hex, the exact output of binRegistry.ts's `deriveBinId`) rather than trusted: a
// legacy `bin_{warehouseId}__{code}` id from before ruling O-3 must be refused loudly, not carried
// into a schema whose CHECK constraint would reject it at INSERT with a constraint name.
//
// ════════════════════ WHAT IS REFUSED RATHER THAN INVENTED ════════════════════
//
// Migration 007 established the rule this module follows: a missing operating company is a REFUSAL,
// never a default. A `warehouses` document with no `operatingCompanyId` is `company_missing` and
// stops the reconciliation for that row — because the field is explicitly OPTIONAL in the governed
// §3A shape (types/warehouse.ts: "a warehouse without it is a VALID LEGACY GOVERNED WAREHOUSE"), so
// a legacy record is EXPECTED, and the fix is for an Owner to state the company, not for a
// migration to pick one. Nothing here derives a company from a name, a site label, a truck, or a
// homeWarehouseId.
//
// A bin is likewise never given a company of its own: `toBinRow` has no company output at all. Its
// company is its warehouse's, reached through migration 008's composite foreign key.
//
// ════════════════════ WHAT THE CENSUS FOUND, AND WHY THAT MATTERS HERE ════════════════════
//
// The in-repo evidence is that nothing in this repository's business code has ever written
// `stock_locations` (constants/collections.ts removed the constant; types/warehouse.ts records the
// measured divergence), and the only writers left were sandbox seeds, which this packet removes. So
// there is no balance to reconcile — only PLACES. `reconcileLocationSource` therefore reports
// warehouses, bins and claims, and has no quantity in its vocabulary at all.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_BIN_SCHEMA_VERSION = void 0;
exports.toWarehouseRow = toWarehouseRow;
exports.toBinRow = toBinRow;
exports.toBinCodeClaimRow = toBinCodeClaimRow;
exports.reconcileLocationSource = reconcileLocationSource;
const refuse = (refusal) => ({ ok: false, row: null, refusal });
const accept = (row) => ({ ok: true, row, refusal: null });
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** The exact output shape of binRegistry.ts's `deriveBinId`. A pre-O-3 id does not match. */
const OPAQUE_BIN_ID = /^bin_[0-9a-f]{40}$/;
const AREA = /^[A-Z][A-Z0-9_]{0,31}$/;
const AISLE = /^[A-Z]{1,2}$/;
const CODE = /^[A-Z0-9][A-Z0-9.\-_]{0,31}$/;
/** `binRegistry.ts`'s BIN_SCHEMA_VERSION. A v1 record fails closed; there is no dual reader. */
exports.SUPPORTED_BIN_SCHEMA_VERSION = 2;
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const nonBlank = (v) => typeof v === "string" && v.trim() !== "";
/**
 * Map one `warehouses/{id}` document.
 *
 * `isGovernedCompanyId` is INJECTED rather than imported so this module stays free of the
 * ownership authority's own dependencies and so a caller cannot be surprised by which company set
 * was consulted. Membership is the authority layer's answer; this module never guesses it.
 */
function toWarehouseRow(documentId, document, isGovernedCompanyId) {
    if (!nonBlank(documentId) || !SAFE_SEGMENT.test(documentId))
        return refuse("document_id_invalid");
    if (!isRecord(document))
        return refuse("not_object");
    if (document.id !== documentId)
        return refuse("id_mismatch");
    if (!nonBlank(document.name))
        return refuse("name_missing");
    // The governed record's free-text `location`. Renamed on the way in so nothing downstream reads it
    // as a reference to another row.
    if (!nonBlank(document.location))
        return refuse("site_label_missing");
    if (document.status !== "ACTIVE" && document.status !== "INACTIVE")
        return refuse("status_invalid");
    if (document.provenance !== "NATIVE" && document.provenance !== "MIGRATED")
        return refuse("provenance_invalid");
    // R-18 / the Owner ruling: never inferred, never defaulted. An absent field is a legacy record and
    // is a REFUSAL to migrate, not a licence to choose.
    if (document.operatingCompanyId === undefined || document.operatingCompanyId === null)
        return refuse("company_missing");
    if (!isGovernedCompanyId(document.operatingCompanyId))
        return refuse("company_invalid");
    return accept({
        id: documentId,
        operatingCompanyKey: document.operatingCompanyId,
        name: document.name,
        siteLabel: document.location,
        status: document.status,
        provenance: document.provenance,
    });
}
/** Map one `bins/{binId}` document. `knownWarehouseIds` are the warehouse rows already accepted. */
function toBinRow(documentId, document, knownWarehouseIds) {
    if (!nonBlank(documentId))
        return refuse("document_id_invalid");
    // Loud, not silent: a legacy `bin_{warehouseId}__{code}` id is exactly the thing ruling O-3
    // replaced, and carrying one would reintroduce a code-shaped identity.
    if (!OPAQUE_BIN_ID.test(documentId))
        return refuse("bin_id_not_opaque");
    if (!isRecord(document))
        return refuse("not_object");
    if (document.schemaVersion !== exports.SUPPORTED_BIN_SCHEMA_VERSION)
        return refuse("schema_version_unsupported");
    if (!nonBlank(document.warehouseId))
        return refuse("warehouse_missing");
    if (!knownWarehouseIds.has(document.warehouseId))
        return refuse("warehouse_unknown");
    if (typeof document.area !== "string" || !AREA.test(document.area))
        return refuse("racking_invalid");
    if (typeof document.aisle !== "string" || !AISLE.test(document.aisle))
        return refuse("racking_invalid");
    if (!Number.isInteger(document.bay) || document.bay < 0)
        return refuse("racking_invalid");
    if (!Number.isInteger(document.position) || document.position < 0)
        return refuse("racking_invalid");
    if (typeof document.code !== "string" || !CODE.test(document.code))
        return refuse("code_missing");
    if (!nonBlank(document.idempotencyKey))
        return refuse("document_id_invalid");
    if (document.status !== "ACTIVE" && document.status !== "INACTIVE")
        return refuse("status_invalid");
    return accept({
        id: documentId,
        warehouseId: document.warehouseId,
        area: document.area,
        aisle: document.aisle,
        bay: document.bay,
        position: document.position,
        code: document.code,
        name: nonBlank(document.name) ? document.name : null,
        status: document.status,
        idempotencyKey: document.idempotencyKey,
    });
}
/** Map one `bin_code_claims/{warehouseId}__{code}` document. The claim's key is its natural key. */
function toBinCodeClaimRow(document, knownBinIds) {
    if (!isRecord(document))
        return refuse("not_object");
    if (!nonBlank(document.warehouseId))
        return refuse("warehouse_missing");
    if (typeof document.code !== "string" || !CODE.test(document.code))
        return refuse("code_missing");
    if (!nonBlank(document.binId) || !OPAQUE_BIN_ID.test(document.binId))
        return refuse("bin_id_not_opaque");
    if (!knownBinIds.has(document.binId))
        return refuse("claim_bin_unknown");
    if (document.claimState !== "HELD" && document.claimState !== "SUPERSEDED")
        return refuse("claim_state_invalid");
    return accept({
        warehouseId: document.warehouseId,
        code: document.code,
        binId: document.binId,
        claimState: document.claimState,
    });
}
/**
 * Reconcile a whole source read against what would be written.
 *
 * Deliberately reports REFUSALS rather than dropping them. A migration that quietly skipped the
 * warehouses whose operating company nobody had stated would leave every bin under them orphaned
 * and every movement at them unattributable, and the run would still say "done".
 */
function reconcileLocationSource(input) {
    const tally = (rows) => ({
        read: rows.length,
        mapped: rows.filter((r) => r.ok).length,
        refused: rows.filter((r) => !r.ok).map((r) => r.refusal),
    });
    const acceptedBins = input.bins.filter((b) => b.ok).map((b) => b.row);
    const heldByBin = new Set(input.claims
        .filter((c) => c.ok)
        .filter((c) => c.row.claimState === "HELD")
        .map((c) => c.row.binId));
    const binsWithoutHeldClaim = acceptedBins.filter((b) => !heldByBin.has(b.id)).map((b) => b.id);
    const warehouses = tally(input.warehouses);
    const bins = tally(input.bins);
    const claims = tally(input.claims);
    const balanced = warehouses.refused.length === 0
        && bins.refused.length === 0
        && claims.refused.length === 0
        && binsWithoutHeldClaim.length === 0;
    return { warehouses, bins, claims, binsWithoutHeldClaim, balanced };
}
//# sourceMappingURL=warehouseBinMigrationSource.js.map