"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERENCE_AUTHORITIES = exports.REFERENCE_AUTHORITY_KEYS = void 0;
exports.boundedReferenceQuery = boundedReferenceQuery;
exports.aggregateReferenceStates = aggregateReferenceStates;
exports.buildReferenceCrosswalk = buildReferenceCrosswalk;
exports.buildOperationalReferenceProbe = buildOperationalReferenceProbe;
const collections_js_1 = require("../constants/collections.js");
const mobileLocationPresenceProbe_js_1 = require("../inventoryLedger/mobileLocationPresenceProbe.js");
// The canonical set of governed operational-reference authorities that must ALL be conclusively CLEAR
// before a truck + its MOBILE location may be hard-deleted. Adding an authority here that has no
// registered descriptor makes the probe return UNKNOWN (runtime completeness) AND fails the coverage
// test -- so a new governed reference authority can never silently leave the probe incomplete.
exports.REFERENCE_AUTHORITY_KEYS = [
    "serializedAssets",
    "partsStock",
    "transferOrders",
    "transferLines",
    "ledgerEvents",
    "custodyAssignmentHistory",
    "receiving",
    "reconciliation",
    "cycleCount",
    "rma",
    "scrap",
];
// A bounded (limit 1) equality query helper for FUTURE authorities that DO carry a MOBILE-location/
// truck-indexed field. Single-field equality uses the automatic single-field index -- NO composite
// index is required. `txn.get(query)` participates in the transaction, so a concurrently-written
// referencing doc conflicts the commit. Any failure -> UNKNOWN (fail closed).
async function boundedReferenceQuery(ctx, buildQuery) {
    try {
        const snap = await ctx.txn.get(buildQuery(ctx.db).limit(1));
        return snap.empty ? "CLEAR" : "REFERENCED";
    }
    catch {
        return "UNKNOWN"; // permission/config/index/transport failure -> inconclusive -> fail closed
    }
}
// A "not conclusively verifiable on the current schema" authority: no MOBILE-location/truck-indexed
// persisted reference exists, so it can only fail closed (UNKNOWN) -- never CLEAR. When the governed
// persistence ships, replace `check` with a real boundedReferenceQuery and set verifiableNow=true.
function unverifiable(key, description, blocker) {
    return { key, description, verifiableNow: false, blocker, check: async () => "UNKNOWN" };
}
// A NOW-provable authority backed by a real bounded (equality + limit, no orderBy, no composite
// index) query. Wraps the check so a throw/malformed read fails closed to UNKNOWN (mirrors
// `unverifiable`'s shape) rather than trusting the underlying probe's own try/catch alone.
function verifiable(key, description, check) {
    return {
        key,
        description,
        verifiableNow: true,
        check: async (ctx) => {
            try {
                const state = await check(ctx);
                return state === "CLEAR" || state === "REFERENCED" || state === "UNKNOWN" ? state : "UNKNOWN";
            }
            catch {
                return "UNKNOWN";
            }
        },
    };
}
// Adapt a presence result (PRESENT/ABSENT/UNKNOWN) to a reference result (REFERENCED/CLEAR/UNKNOWN) --
// the two probe families ask the same underlying "does anything exist" question with different vocab.
function presenceToReference(state) {
    if (state === "PRESENT")
        return "REFERENCED";
    if (state === "ABSENT")
        return "CLEAR";
    return "UNKNOWN";
}
// transfer_orders references either endpoint by `origin.locationId` / `destination.locationId`
// (both queryable scalars). REFERENCED if EITHER endpoint ever named this location, regardless of
// the order's status -- delete-safety asks "has this location ever appeared in transfer history,"
// not "is a transfer currently active." Two equality-only queries, no composite index.
async function checkTransferOrderReference(ctx) {
    const coll = ctx.db.collection(collections_js_1.TRANSFER_ORDERS_COLLECTION);
    const origin = await boundedReferenceQuery(ctx, () => coll.where("origin.locationId", "==", ctx.locationId));
    if (origin === "REFERENCED")
        return "REFERENCED";
    const destination = await boundedReferenceQuery(ctx, () => coll.where("destination.locationId", "==", ctx.locationId));
    if (destination === "REFERENCED")
        return "REFERENCED";
    if (origin === "UNKNOWN" || destination === "UNKNOWN")
        return "UNKNOWN";
    return "CLEAR";
}
// The PRODUCTION registry against main @ c1e30971 (post Enterprise Inventory Phase 4). Five
// authorities are now real, conclusive checks; six remain unverifiable (see the module
// reconciliation above for exactly why each of the six cannot yet be answered).
exports.REFERENCE_AUTHORITIES = [
    verifiable("serializedAssets", "Serialized assets currently or ever custodied at the truck's MOBILE location", (ctx) => (0, mobileLocationPresenceProbe_js_1.probeSerializedAssetsReferencedAtLocation)(ctx.txn, ctx.db, ctx.locationId).then(presenceToReference)),
    verifiable("partsStock", "Parts / stock inventory movement recorded against the truck's MOBILE location. PROVABLY " +
        "CO-EXTENSIVE with `ledgerEvents` on the current schema -- no MOBILE-indexed stock document " +
        "exists separately from the ledger (`stock_locations` stays warehouseId-keyed), so this check " +
        "is intentionally the identical ledger-location query, not a duplicated authority.", (ctx) => (0, mobileLocationPresenceProbe_js_1.probeLedgerReferencedAtLocation)(ctx.txn, ctx.db, ctx.locationId).then(presenceToReference)),
    verifiable("transferOrders", "Transfer orders whose origin or destination is the truck's MOBILE location (any status, ever)", checkTransferOrderReference),
    verifiable("transferLines", "SERIAL transfer-line membership referencing the truck's MOBILE location. PROVABLY CO-EXTENSIVE " +
        "with `transferOrders` on the current schema -- SERIAL membership is embedded on the " +
        "transfer_orders document (`serialNumbers[]`), not a separate transfer_lines collection " +
        "(transferOrderTypes.ts: Phase 4 accepts the full serial set at CREATE time), so this check is " +
        "intentionally the identical transfer_orders query, not a duplicated authority.", checkTransferOrderReference),
    verifiable("ledgerEvents", "Inventory ledger / operational-movement events recorded at the truck's MOBILE location", (ctx) => (0, mobileLocationPresenceProbe_js_1.probeLedgerReferencedAtLocation)(ctx.txn, ctx.db, ctx.locationId).then(presenceToReference)),
    unverifiable("custodyAssignmentHistory", "Truck custody / assignment HISTORY records (past assignments, not the current one)", "only the CURRENT driver assignment is modeled (trucks/{id}.assignedDriverEmployeeId), checked conclusively in-command, separately from this probe; no past-assignment-history collection exists"),
    unverifiable("receiving", "Receiving records against the truck", "no receiving collection keyed by a MOBILE location/truck exists on the current schema"),
    unverifiable("reconciliation", "Reconciliation records for the truck's inventory", "no reconciliation collection keyed by a MOBILE location/truck exists on the current schema"),
    unverifiable("cycleCount", "Cycle-count records for the truck", "no cycle-count collection keyed by a MOBILE location/truck exists on the current schema (also out of scope for this change)"),
    unverifiable("rma", "RMA / return records referencing the truck", "no RMA collection keyed by a MOBILE location/truck exists on the current schema"),
    unverifiable("scrap", "Scrap / disposal records referencing the truck", "no scrap collection keyed by a MOBILE location/truck exists on the current schema"),
];
// Pure aggregation: REFERENCED dominates; otherwise any UNKNOWN (or an empty/short set) forces
// UNKNOWN; CLEAR only when every state is CLEAR.
function aggregateReferenceStates(states) {
    if (states.length === 0)
        return "UNKNOWN";
    if (states.includes("REFERENCED"))
        return "REFERENCED";
    if (states.every((s) => s === "CLEAR"))
        return "CLEAR";
    return "UNKNOWN";
}
// Sanitized-for-review crosswalk of the current authorities (keys/descriptions/blockers). NOT a
// client response -- it documents coverage + the fail-closed blockers for the PR/audit.
function buildReferenceCrosswalk(authorities = exports.REFERENCE_AUTHORITIES) {
    return authorities.map((a) => ({ key: a.key, description: a.description, verifiableNow: a.verifiableNow, blocker: a.blocker ?? null }));
}
// Build the production OperationalReferenceProbe. Runtime completeness: if the provided authorities do
// not cover EVERY REFERENCE_AUTHORITY_KEY (a governed authority was added to the enum but not wired),
// the probe fails closed (UNKNOWN) rather than risk a CLEAR that skipped an authority. Every
// authority.check is additionally wrapped so any throw / non-enum result -> UNKNOWN.
function buildOperationalReferenceProbe(resources, authorities = exports.REFERENCE_AUTHORITIES) {
    const covered = new Set(authorities.map((a) => a.key));
    const complete = exports.REFERENCE_AUTHORITY_KEYS.every((k) => covered.has(k));
    return async ({ truckId, locationId }, txn) => {
        if (!complete)
            return "UNKNOWN"; // an enumerated authority is unwired -> never CLEAR
        const states = [];
        for (const authority of authorities) {
            let state;
            try {
                state = await authority.check({ db: resources.db, txn, truckId, locationId });
            }
            catch {
                state = "UNKNOWN"; // any authority error -> fail closed
            }
            if (state !== "REFERENCED" && state !== "CLEAR" && state !== "UNKNOWN")
                state = "UNKNOWN"; // malformed -> fail closed
            states.push(state);
            if (state === "REFERENCED")
                return "REFERENCED"; // short-circuit on a definite match
        }
        return aggregateReferenceStates(states);
    };
}
//# sourceMappingURL=operationalReferenceProbe.js.map