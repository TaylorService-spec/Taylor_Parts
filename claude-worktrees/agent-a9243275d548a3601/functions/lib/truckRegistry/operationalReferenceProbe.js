"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERENCE_AUTHORITIES = exports.REFERENCE_AUTHORITY_KEYS = void 0;
exports.boundedReferenceQuery = boundedReferenceQuery;
exports.aggregateReferenceStates = aggregateReferenceStates;
exports.buildReferenceCrosswalk = buildReferenceCrosswalk;
exports.buildOperationalReferenceProbe = buildOperationalReferenceProbe;
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
// The PRODUCTION registry against main @ 0794557. Every authority is currently unverifiable (see the
// module reconciliation); each documents its candidate collection(s) and the exact blocker.
exports.REFERENCE_AUTHORITIES = [
    unverifiable("serializedAssets", "Serialized assets / installed equipment carried on the truck", "no serialized-asset-on-truck persistence; `equipment` is customer-location-keyed (locationId -> locations/{id}), never a mobile_locations/{id}"),
    unverifiable("partsStock", "Parts / stock inventory held on the truck", "`stock_locations` is warehouseId+partId-keyed; truck (MOBILE-location) stock is not modeled"),
    unverifiable("transferOrders", "Transfer orders to/from the truck's MOBILE location", "`transfer_orders` is warehouse->warehouse (fromWarehouseId/toWarehouseId); no MOBILE-location/truck field"),
    unverifiable("transferLines", "SERIAL transfer lines referencing the truck's MOBILE location", "no persisted transfer_lines collection keyed by a MOBILE location/truck exists (EI-P1b/c contracts are pure/unpersisted)"),
    unverifiable("ledgerEvents", "Inventory ledger / transaction events at the truck's MOBILE location", "`inventory_transactions` is workOrderId+partId-keyed and location-blind; no MOBILE-location/truck field"),
    unverifiable("custodyAssignmentHistory", "Truck custody / assignment history records", "no truck custody/assignment-history collection exists; the current driver link is checked conclusively in-command"),
    unverifiable("receiving", "Receiving records against the truck", "no receiving collection keyed by a MOBILE location/truck exists on the current schema"),
    unverifiable("reconciliation", "Reconciliation records for the truck's inventory", "no reconciliation collection keyed by a MOBILE location/truck exists on the current schema"),
    unverifiable("cycleCount", "Cycle-count records for the truck", "no cycle-count collection keyed by a MOBILE location/truck exists on the current schema"),
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