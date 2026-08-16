// EI Truck Registry -- the REAL, fail-closed cross-collection OperationalReferenceProbe injected
// into deleteTruckCreatedInErrorCallable. It answers "is this truck or its MOBILE location
// referenced by ANY governed operational history?" across every required authority, participating
// in the deletion transaction (all reads through the injected txn, before any delete/tombstone).
//
// AGGREGATION (fail-closed): REFERENCED if ANY authority matches; else UNKNOWN if ANY authority is
// inconclusive (an error, a malformed result, or -- on the CURRENT schema -- an authority that has
// no MOBILE-location/truck-indexed persisted reference to query); else CLEAR only when EVERY
// required authority is conclusively CLEAR.
//
// CURRENT-SCHEMA RECONCILIATION, ROUND 2 (Enterprise Inventory Phase 5, reconciled against Phase 4 /
// PR #1032's Transfer operating authority): FIVE of the eleven governed authorities are now
// CONCLUSIVELY verifiable and wired to real checks below --
//   * serializedAssets -- serialized_assets.currentLocationId is a queryable scalar (equality; the
//     automatic single-field index applies), kept in sync with custody at Transfer receive/completion;
//   * ledgerEvents      -- inventory_transactions (schemaVersion 2 operational records) carries a
//     queryable `location: { type, locationId }` map, written by the Transfer command's TRANSFER_OUT/
//     TRANSFER_IN effects and by Receiving;
//   * partsStock        -- on the current schema there is NO MOBILE-indexed stock document separate
//     from the ledger (`stock_locations` stays warehouseId-keyed); a truck's parts-stock reference is
//     therefore PROVABLY CO-EXTENSIVE with `ledgerEvents` and is checked with the identical query,
//     documented here rather than silently duplicated as a "different" authority;
//   * transferOrders    -- `transfer_orders.origin.locationId` / `.destination.locationId` are
//     queryable scalars (equality on either endpoint);
//   * transferLines      -- SERIAL transfer membership is embedded on the `transfer_orders` document
//     itself (`serialNumbers[]`) rather than a separate transfer_lines collection (transferOrderTypes.ts's
//     own header: Phase 4 accepts the full serial set at CREATE time instead of building an incremental
//     membership collection) -- so this authority is ALSO provably co-extensive with `transferOrders`
//     and is checked with the identical query.
//
// The remaining SIX authorities are still genuinely UNPROVABLE on the current schema -- no persisted
// collection carries a MOBILE-location/truck-indexed reference for any of them:
//   * custodyAssignmentHistory -- only the truck's CURRENT driver assignment is modeled
//     (trucks/{id}.assignedDriverEmployeeId); PAST assignment history is not persisted anywhere, and
//     the current-assignment check already happens conclusively in-command (deleteTruckCreatedInError),
//     separately from this probe -- so this authority remains UNKNOWN here on purpose (it is not a
//     redundant re-check of the in-command guard, it is a different, unmodeled question: "has this
//     truck ever had prior custody history").
//   * receiving, reconciliation, cycleCount, rma, scrap -- no collection keyed by a MOBILE location or
//     truck exists for any of these on the current schema (cycleCount is explicitly out of scope for
//     this change too).
// So the AGGREGATE probe result for a delete is still NECESSARILY UNKNOWN today (aggregateReferenceStates
// treats any UNKNOWN as inconclusive) -- five authorities becoming individually provable does not by
// itself make a delete provable; it narrows exactly which authorities remain the blocker. We NEVER
// treat absent/unmodeled persistence as CLEAR.
//
// No collection name, document data, or query detail leaks past the trust boundary: the callable maps
// the probe's UNKNOWN/REFERENCED to a sanitized failed-precondition. The crosswalk here is a code +
// review artifact, not a client response.
import type { Firestore, Transaction, Query } from "firebase-admin/firestore";
import { TRANSFER_ORDERS_COLLECTION } from "../constants/collections.js";
import {
  probeSerializedAssetsReferencedAtLocation,
  probeLedgerReferencedAtLocation,
} from "../inventoryLedger/mobileLocationPresenceProbe.js";
import type { OperationalReferenceState } from "./truckRegistryCommands";

// The canonical set of governed operational-reference authorities that must ALL be conclusively CLEAR
// before a truck + its MOBILE location may be hard-deleted. Adding an authority here that has no
// registered descriptor makes the probe return UNKNOWN (runtime completeness) AND fails the coverage
// test -- so a new governed reference authority can never silently leave the probe incomplete.
export const REFERENCE_AUTHORITY_KEYS = [
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
] as const;
export type ReferenceAuthorityKey = (typeof REFERENCE_AUTHORITY_KEYS)[number];

export interface ReferenceCheckContext {
  db: Firestore;
  txn: Transaction;
  truckId: string;
  locationId: string;
}
export interface ReferenceAuthority {
  key: ReferenceAuthorityKey;
  description: string;
  /** True only when a MOBILE-location/truck-indexed persisted reference exists to query today. */
  verifiableNow: boolean;
  /** Why the authority is not conclusively verifiable on the current schema (when verifiableNow=false). */
  blocker?: string;
  /** Returns REFERENCED / CLEAR / UNKNOWN. MUST fail closed (UNKNOWN) on any inconclusive state. */
  check: (ctx: ReferenceCheckContext) => Promise<OperationalReferenceState>;
}

// A bounded (limit 1) equality query helper for FUTURE authorities that DO carry a MOBILE-location/
// truck-indexed field. Single-field equality uses the automatic single-field index -- NO composite
// index is required. `txn.get(query)` participates in the transaction, so a concurrently-written
// referencing doc conflicts the commit. Any failure -> UNKNOWN (fail closed).
export async function boundedReferenceQuery(ctx: ReferenceCheckContext, buildQuery: (db: Firestore) => Query): Promise<OperationalReferenceState> {
  try {
    const snap = await ctx.txn.get(buildQuery(ctx.db).limit(1));
    return snap.empty ? "CLEAR" : "REFERENCED";
  } catch {
    return "UNKNOWN"; // permission/config/index/transport failure -> inconclusive -> fail closed
  }
}

// A "not conclusively verifiable on the current schema" authority: no MOBILE-location/truck-indexed
// persisted reference exists, so it can only fail closed (UNKNOWN) -- never CLEAR. When the governed
// persistence ships, replace `check` with a real boundedReferenceQuery and set verifiableNow=true.
function unverifiable(key: ReferenceAuthorityKey, description: string, blocker: string): ReferenceAuthority {
  return { key, description, verifiableNow: false, blocker, check: async () => "UNKNOWN" };
}

// A NOW-provable authority backed by a real bounded (equality + limit, no orderBy, no composite
// index) query. Wraps the check so a throw/malformed read fails closed to UNKNOWN (mirrors
// `unverifiable`'s shape) rather than trusting the underlying probe's own try/catch alone.
function verifiable(
  key: ReferenceAuthorityKey,
  description: string,
  check: ReferenceAuthority["check"],
): ReferenceAuthority {
  return {
    key,
    description,
    verifiableNow: true,
    check: async (ctx) => {
      try {
        const state = await check(ctx);
        return state === "CLEAR" || state === "REFERENCED" || state === "UNKNOWN" ? state : "UNKNOWN";
      } catch {
        return "UNKNOWN";
      }
    },
  };
}

// Adapt a presence result (PRESENT/ABSENT/UNKNOWN) to a reference result (REFERENCED/CLEAR/UNKNOWN) --
// the two probe families ask the same underlying "does anything exist" question with different vocab.
function presenceToReference(state: "PRESENT" | "ABSENT" | "UNKNOWN"): OperationalReferenceState {
  if (state === "PRESENT") return "REFERENCED";
  if (state === "ABSENT") return "CLEAR";
  return "UNKNOWN";
}

// transfer_orders references either endpoint by `origin.locationId` / `destination.locationId`
// (both queryable scalars). REFERENCED if EITHER endpoint ever named this location, regardless of
// the order's status -- delete-safety asks "has this location ever appeared in transfer history,"
// not "is a transfer currently active." Two equality-only queries, no composite index.
async function checkTransferOrderReference(ctx: ReferenceCheckContext): Promise<OperationalReferenceState> {
  const coll = ctx.db.collection(TRANSFER_ORDERS_COLLECTION);
  const origin = await boundedReferenceQuery(ctx, () => coll.where("origin.locationId", "==", ctx.locationId));
  if (origin === "REFERENCED") return "REFERENCED";
  const destination = await boundedReferenceQuery(ctx, () => coll.where("destination.locationId", "==", ctx.locationId));
  if (destination === "REFERENCED") return "REFERENCED";
  if (origin === "UNKNOWN" || destination === "UNKNOWN") return "UNKNOWN";
  return "CLEAR";
}

// The PRODUCTION registry against main @ c1e30971 (post Enterprise Inventory Phase 4). Five
// authorities are now real, conclusive checks; six remain unverifiable (see the module
// reconciliation above for exactly why each of the six cannot yet be answered).
export const REFERENCE_AUTHORITIES: readonly ReferenceAuthority[] = [
  verifiable(
    "serializedAssets",
    "Serialized assets currently or ever custodied at the truck's MOBILE location",
    (ctx) => probeSerializedAssetsReferencedAtLocation(ctx.txn, ctx.db, ctx.locationId).then(presenceToReference),
  ),
  verifiable(
    "partsStock",
    "Parts / stock inventory movement recorded against the truck's MOBILE location. PROVABLY " +
      "CO-EXTENSIVE with `ledgerEvents` on the current schema -- no MOBILE-indexed stock document " +
      "exists separately from the ledger (`stock_locations` stays warehouseId-keyed), so this check " +
      "is intentionally the identical ledger-location query, not a duplicated authority.",
    (ctx) => probeLedgerReferencedAtLocation(ctx.txn, ctx.db, ctx.locationId).then(presenceToReference),
  ),
  verifiable(
    "transferOrders",
    "Transfer orders whose origin or destination is the truck's MOBILE location (any status, ever)",
    checkTransferOrderReference,
  ),
  verifiable(
    "transferLines",
    "SERIAL transfer-line membership referencing the truck's MOBILE location. PROVABLY CO-EXTENSIVE " +
      "with `transferOrders` on the current schema -- SERIAL membership is embedded on the " +
      "transfer_orders document (`serialNumbers[]`), not a separate transfer_lines collection " +
      "(transferOrderTypes.ts: Phase 4 accepts the full serial set at CREATE time), so this check is " +
      "intentionally the identical transfer_orders query, not a duplicated authority.",
    checkTransferOrderReference,
  ),
  verifiable(
    "ledgerEvents",
    "Inventory ledger / operational-movement events recorded at the truck's MOBILE location",
    (ctx) => probeLedgerReferencedAtLocation(ctx.txn, ctx.db, ctx.locationId).then(presenceToReference),
  ),
  unverifiable("custodyAssignmentHistory", "Truck custody / assignment HISTORY records (past assignments, not the current one)", "only the CURRENT driver assignment is modeled (trucks/{id}.assignedDriverEmployeeId), checked conclusively in-command, separately from this probe; no past-assignment-history collection exists"),
  unverifiable("receiving", "Receiving records against the truck", "no receiving collection keyed by a MOBILE location/truck exists on the current schema"),
  unverifiable("reconciliation", "Reconciliation records for the truck's inventory", "no reconciliation collection keyed by a MOBILE location/truck exists on the current schema"),
  unverifiable("cycleCount", "Cycle-count records for the truck", "no cycle-count collection keyed by a MOBILE location/truck exists on the current schema (also out of scope for this change)"),
  unverifiable("rma", "RMA / return records referencing the truck", "no RMA collection keyed by a MOBILE location/truck exists on the current schema"),
  unverifiable("scrap", "Scrap / disposal records referencing the truck", "no scrap collection keyed by a MOBILE location/truck exists on the current schema"),
];

// Pure aggregation: REFERENCED dominates; otherwise any UNKNOWN (or an empty/short set) forces
// UNKNOWN; CLEAR only when every state is CLEAR.
export function aggregateReferenceStates(states: readonly OperationalReferenceState[]): OperationalReferenceState {
  if (states.length === 0) return "UNKNOWN";
  if (states.includes("REFERENCED")) return "REFERENCED";
  if (states.every((s) => s === "CLEAR")) return "CLEAR";
  return "UNKNOWN";
}

// Sanitized-for-review crosswalk of the current authorities (keys/descriptions/blockers). NOT a
// client response -- it documents coverage + the fail-closed blockers for the PR/audit.
export function buildReferenceCrosswalk(authorities: readonly ReferenceAuthority[] = REFERENCE_AUTHORITIES) {
  return authorities.map((a) => ({ key: a.key, description: a.description, verifiableNow: a.verifiableNow, blocker: a.blocker ?? null }));
}

// Build the production OperationalReferenceProbe. Runtime completeness: if the provided authorities do
// not cover EVERY REFERENCE_AUTHORITY_KEY (a governed authority was added to the enum but not wired),
// the probe fails closed (UNKNOWN) rather than risk a CLEAR that skipped an authority. Every
// authority.check is additionally wrapped so any throw / non-enum result -> UNKNOWN.
export function buildOperationalReferenceProbe(
  resources: { db: Firestore },
  authorities: readonly ReferenceAuthority[] = REFERENCE_AUTHORITIES,
): OperationalReferenceProbeFn {
  const covered = new Set(authorities.map((a) => a.key));
  const complete = REFERENCE_AUTHORITY_KEYS.every((k) => covered.has(k));
  return async ({ truckId, locationId }, txn) => {
    if (!complete) return "UNKNOWN"; // an enumerated authority is unwired -> never CLEAR
    const states: OperationalReferenceState[] = [];
    for (const authority of authorities) {
      let state: OperationalReferenceState;
      try {
        state = await authority.check({ db: resources.db, txn, truckId, locationId });
      } catch {
        state = "UNKNOWN"; // any authority error -> fail closed
      }
      if (state !== "REFERENCED" && state !== "CLEAR" && state !== "UNKNOWN") state = "UNKNOWN"; // malformed -> fail closed
      states.push(state);
      if (state === "REFERENCED") return "REFERENCED"; // short-circuit on a definite match
    }
    return aggregateReferenceStates(states);
  };
}

// Re-declared locally to avoid a circular import of the exact function type from truckRegistryCommands.
type OperationalReferenceProbeFn = (args: { truckId: string; locationId: string }, txn: Transaction) => Promise<OperationalReferenceState>;
