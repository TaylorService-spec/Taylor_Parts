// INV-CONVERGENCE-E C2 -- pure PartDetail composition + ledger identity selection.
//
// The governed identity/metadata source for a single Inventory > Parts detail page.
// C2 re-points, TOGETHER, the two things PartDetail derived from static data:
//   1. the `getCatalogItem(partId)` metadata lookup, and
//   2. the `t.partId === partId` ledger filter (+ the healthEntries lookup),
// so that page metadata and page stock position are always resolved from the SAME
// governed identity. Re-pointing one without the other is what would allow a page
// to show canonical metadata beside a differently-keyed ledger, so the contract
// (docs/implementation-plans/inv-convergence-e-shadow-read-and-convergence.md,
// Stage C / C2) requires both in one unit.
//
// The composition reuses the SAME governed path as C1: the live canonical `parts`
// read composed with the static compatibility catalog through buildPartsWorkspace(),
// via the shared composeGovernedPartsWorkspace() guard in partsCatalogView.js. No
// second Parts source is introduced and no new query surface is added -- the static
// catalog remains the compatibility INPUT, canonical `parts` remains authoritative.
//
// Pure: no Firebase, no network, no React, no clock/random, no input mutation.
// Fail-closed: a denied / unavailable / malformed / incomplete canonical read yields
// a BLOCKED_* with part:null -- NEVER a silent static fallback, never a partial page,
// and never the pre-existing "Unknown part" copy (which would misreport an
// infrastructure failure as a bad part id).
//
// Governance: docs/architecture/inventory-parts-authority-contract.md; DECISIONS
// #43-#46. Commercial + availability fields (cost, price, reorderThreshold,
// warehouseQty) intentionally remain STATIC_FALLBACK until UD-3/UD-4 ship their
// authorities -- C2 does not change their values or their provenance.
import { composeGovernedPartsWorkspace } from "./partsCatalogView.js";

/** PartDetail composition states. READY only when the governed composition is fully
 * accounted AND the requested partId resolves to exactly one composed Part. */
export const PART_DETAIL_STATES = Object.freeze([
  "READY",
  "NOT_FOUND",
  "BLOCKED_PERMISSION",
  "BLOCKED_UNAVAILABLE",
  "BLOCKED_INCOMPLETE_INPUT",
]);

/** True when the status is any BLOCKED_* state (an infrastructure/governance stop,
 * distinct from NOT_FOUND, which is a legitimate "no such part id"). */
export function isPartDetailBlocked(status) {
  return (
    status === "BLOCKED_PERMISSION" ||
    status === "BLOCKED_UNAVAILABLE" ||
    status === "BLOCKED_INCOMPLETE_INPUT"
  );
}

/**
 * Build the PartDetail view model for one part id.
 *
 * @param {object} input
 * @param {{ status: string, rows?: Array }} input.canonicalRead  see composeGovernedPartsWorkspace.
 * @param {Array} input.staticCatalog  the static compatibility catalog (PARTS_CATALOG).
 * @param {string} input.partId  the route param (=== sku === canonical partId).
 * @returns {{ status: string, part: object|null, meta: object }}
 *   READY  -> part = { partId, sku, internalPartNumber, name, description, category, unit,
 *                      status, controlType, stockingClass, manufacturerId,
 *                      manufacturerPartNumber, oemStatus, cost, price, reorderThreshold,
 *                      warehouseQty, identityState, provenance }
 *   others -> part = null.
 */
export function buildPartDetailView(input = {}) {
  const partId = input.partId;

  // 1. Same shared fail-closed guard C1 uses. A blocked canonical read blocks the
  //    detail page BEFORE any identity lookup -- we never fall back to static.
  const composed = composeGovernedPartsWorkspace({
    canonicalRead: input.canonicalRead,
    staticCatalog: input.staticCatalog,
  });
  if (composed.status !== "READY") {
    return { status: composed.status, part: null, meta: composed.meta };
  }

  // 2. Malformed route identity is incomplete input, not "unknown part".
  if (typeof partId !== "string" || partId.length === 0) {
    return {
      status: "BLOCKED_INCOMPLETE_INPUT",
      part: null,
      meta: { reason: "part id missing or malformed" },
    };
  }

  // 3. Resolve by composed key (key === sku === canonical partId). The adapter has
  //    already rejected duplicate skus/partIds upstream, so this is unambiguous.
  const row = composed.ws.rows.find((r) => r.key === partId);
  if (!row) {
    return { status: "NOT_FOUND", part: null, meta: { partId } };
  }

  const val = (k) => (row.fields[k] ? row.fields[k].value : null);
  const src = (k) => (row.fields[k] ? row.fields[k].source : null);

  return {
    status: "READY",
    // The resolved identity. Every downstream ledger/workflow key on the page is
    // taken from `partId` below -- NOT from the raw route param -- so metadata and
    // ledger cannot diverge.
    part: {
      partId: val("partId"),
      sku: row.key,
      // ND-26 (Owner, 2026-08-30). internalPartNumber is the HUMAN-FACING Part Number; partId is the
      // immutable document/routing key. They are different strings by contract -- internalPartNumber
      // is mutable under governance, and its prior value is backfilled as a historical alias when it
      // changes. They are carried side by side, and never one under the other's name.
      //
      // Null when the canonical row does not carry it (an approved STATIC_ONLY_EXCLUDED sku has no
      // canonical document at all). A caller must render the absence, not substitute the key.
      internalPartNumber: val("internalPartNumber"),
      name: val("name"),
      description: val("description"),
      category: val("category"),
      // Classification, in stored values. The WORDS are partVocabulary's job; a view model that
      // carried labels would be a second vocabulary.
      status: val("status"),
      controlType: val("controlType"),
      stockingClass: val("stockingClass"),
      // Manufacturer identity, not a manufacturer NAME: resolving the id to a name needs the
      // manufacturer catalogue read, which is a different authority and a different read.
      manufacturerId: val("manufacturerId"),
      manufacturerPartNumber: val("manufacturerPartNumber"),
      oemStatus: val("oemStatus"),
      // canonical-preferred stocking unit (normalized code, e.g. "EACH"), replacing
      // the raw static token (e.g. "ea"). Canonical is authoritative on divergence.
      unit: val("stockingUnit"),
      // commercial + baseline: unchanged STATIC_FALLBACK values (UD-3/UD-4 pending).
      cost: val("cost"),
      price: val("price"),
      reorderThreshold: val("reorderThreshold"),
      warehouseQty: val("warehouseQty"),
      identityState: row.identityState,
      provenance: {
        internalPartNumber: src("internalPartNumber"),
        name: src("name"),
        description: src("description"),
        category: src("category"),
        status: src("status"),
        controlType: src("controlType"),
        stockingClass: src("stockingClass"),
        manufacturerId: src("manufacturerId"),
        manufacturerPartNumber: src("manufacturerPartNumber"),
        oemStatus: src("oemStatus"),
        unit: src("stockingUnit"),
        cost: src("cost"),
        price: src("price"),
        reorderThreshold: src("reorderThreshold"),
        warehouseQty: src("warehouseQty"),
      },
    },
    meta: composed.meta,
  };
}

/** Max ledger rows rendered in the Recent Transactions card (pre-C2 behavior). */
export const RECENT_TRANSACTION_LIMIT = 20;

/**
 * Select this part's ledger slice by the RESOLVED governed identity.
 *
 * This is the second half of the C2 re-point: the filter predicate and the health
 * lookup are keyed on `resolvedPartId` (from buildPartDetailView().part.partId),
 * not on the raw route param. Behavior is otherwise byte-identical to pre-C2
 * (same equality test, same sort, same 20-row cap) so no ledger, usage-history, or
 * reorder behavior changes.
 *
 * Fail-closed: a null/absent resolvedPartId (BLOCKED or NOT_FOUND) yields an empty
 * slice and null health -- never an unfiltered or mis-keyed ledger.
 *
 * @returns {{ transactions: Array, health: object|null }}
 */
export function selectPartLedger(input = {}) {
  const resolvedPartId = input.resolvedPartId;
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const healthEntries = Array.isArray(input.healthEntries) ? input.healthEntries : [];

  if (typeof resolvedPartId !== "string" || resolvedPartId.length === 0) {
    return { transactions: [], health: null };
  }

  return {
    transactions: transactions
      .filter((t) => t && t.partId === resolvedPartId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, RECENT_TRANSACTION_LIMIT),
    health: healthEntries.find((entry) => entry && entry.partId === resolvedPartId) ?? null,
  };
}

/** Explicit, non-empty BLOCKED copy for the detail page. Mirrors the C1 PartsList
 * wording so the two Inventory > Parts surfaces read consistently. */
export function partDetailBlockedMessage(status) {
  if (status === "BLOCKED_PERMISSION") {
    return "You do not have access to the canonical Parts catalog. Contact an administrator if you believe this is an error.";
  }
  if (status === "BLOCKED_UNAVAILABLE") {
    return "The canonical Parts catalog is currently unavailable. Try again later.";
  }
  // BLOCKED_INCOMPLETE_INPUT
  return "This part could not be verified against the canonical source, so its details are not shown (unverified part details are never displayed). Try again later.";
}
