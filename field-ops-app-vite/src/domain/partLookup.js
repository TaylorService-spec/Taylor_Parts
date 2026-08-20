// LOOKUP-ONLY SCANNING — what a scan can truthfully tell you. PURE: no I/O, no JSX, no transport.
//
// ============================ LOOKUP NEVER MOVES INVENTORY ============================
//
// This module returns a description and nothing else. It has no command, no quantity input, no
// action list, and no writer. `resolveScannedIdentity` already refuses to return actions on
// principle ("scanning resolves IDENTITY, scanning does NOT determine AUTHORITY"); this preserves
// that by never introducing one.
//
// ============================ ONE RESOLVER, ONE READ ============================
//
// Identity resolution is the EXISTING `resolveScannedIdentity` over the EXISTING
// `buildScanCandidates`, whose CATALOG scope was written when the scanner was built and has had no
// consumer until now. The catalog itself is the EXISTING `fetchPartMasterList` — the same one-shot
// authorized `parts` read PartsList, PartDetail, Receiving and the Work Order plan editor all use.
// No second scanner, no second Part service, no second registry, no scanner-only projection.
//
// ============================ THE AUTHORITY IS THE READ ============================
//
// There is NO Part-read capability in the permission catalog; `parts` is governed exclusively by
// firestore.rules (admin/dispatcher, or an ACTIVE employee holding the PARTS_MANAGER or
// WAREHOUSE_MANAGER operational role). So eligibility here is not predicted from a role name and not
// gated on an invented capability — the governed read is attempted and ITS answer is the authority.
// A refusal comes back as DENIED and is displayed as a refusal, never as an absence.
//
// ============================ WHAT A LOOKUP CANNOT SAY YET ============================
//
// Serialized-asset identity, location display and stock balances are each governed by a capability
// that is registered `active: false`, which denies regardless of grant. Rather than omit those rows
// (which would read as "this part has none") or fill them (which would be invented), each is carried
// as an explicit field state naming why it is missing. See FIELD_STATE below.

import { resolveScannedIdentity, SCAN_RESOLUTION } from "./scannedIdentity.js";
import { buildScanCandidates, CANDIDATE_SCOPE, notFoundReason } from "./scanCandidates.js";

/**
 * The outcome of one lookup attempt.
 *
 * DENIED and READ_FAILED are separate from NOT_FOUND on purpose, and separate from each other: "you
 * may not read the catalog", "the catalog could not be read", and "the catalog was read and holds no
 * such code" are three different problems with three different owners.
 */
export const LOOKUP_STATE = Object.freeze({
  IDLE: "IDLE",               // nothing scanned yet
  LOADING: "LOADING",         // the governed read is in flight
  RESOLVED: "RESOLVED",       // exactly one governed record matched
  NOT_FOUND: "NOT_FOUND",     // the catalog was readable and matched nothing
  AMBIGUOUS: "AMBIGUOUS",     // matched more than one governed record
  INVALID: "INVALID",         // not a usable token at all
  DENIED: "DENIED",           // the governed read refused this caller
  READ_FAILED: "READ_FAILED", // the read did not complete — NOT an empty result
});

/**
 * Why a single field has no value. A field is NEVER simply omitted when it is expected to exist:
 * an absent row reads as "this part has none", which is a claim.
 */
export const FIELD_STATE = Object.freeze({
  KNOWN: "KNOWN",                           // an authoritative value
  UNKNOWN: "UNKNOWN",                       // authority read, value absent or unrecognized
  CAPABILITY_INACTIVE: "CAPABILITY_INACTIVE", // governing capability registered but inert
  NO_GOVERNED_READ: "NO_GOVERNED_READ",     // nothing in the repository can answer this yet
});

/**
 * Capabilities that would have to be ACTIVATED before the corresponding rows could carry a value.
 * Named here so the reason is one fact in one place, and so a test can assert we did not quietly
 * start rendering a row whose capability is still inert.
 *
 * NOT a grant list and NOT a request: activation is an Owner decision recorded in
 * docs/product/inventory-scanner-program-state.md.
 */
export const INERT_LOOKUP_CAPABILITIES = Object.freeze({
  SERIALIZED_ASSET: "inventory.serializedAsset.read",
  LOCATION_DISPLAY: "inventory.location.display.read",
});

/**
 * Part Master `controlType` -> the ledger `trackingMode` vocabulary, FOR DISPLAY.
 *
 * DELIBERATELY NOT the server-side mapping in receivingCallableWiring.ts. That one ends
 * `default: return "LOT"` so an unrecognized controlType lands on a value its validator rejects —
 * correct for a command that must fail closed, and wrong here, because a lookup would then TELL a
 * warehouse operator that an unrecognized part is lot-tracked. It also maps the Part Master's real
 * `SERIALIZED_LOT` control type to "LOT", losing the serialization half.
 *
 * Display fails closed by saying UNKNOWN, which is the honest answer, rather than by picking a value
 * that happens to be safe for a validator.
 */
export function trackingModeForDisplay(controlType) {
  switch (controlType) {
    case "STANDARD": return "NONE";
    case "SERIALIZED": return "SERIAL";
    case "LOT": return "LOT";
    // SERIALIZED_LOT is a real Part Master control type with no single ledger tracking mode, and
    // anything else is unrecognized. Both are UNKNOWN rather than a guess.
    default: return null;
  }
}

const field = (label, state, value = null, detail = null) =>
  Object.freeze({ label, state, value, detail });

const known = (label, value) => field(label, FIELD_STATE.KNOWN, value);

/**
 * The rows a resolved Part lookup displays.
 *
 * Every row is either an authoritative value from the governed Part projection or an explicit
 * statement of why there is none. Nothing is computed from something it is not.
 */
export function describePartLookup(part) {
  if (!part || typeof part !== "object") return Object.freeze([]);

  const rows = [
    known("Part number", part.internalPartNumber),
    known("Part ID", part.partId),
    known("Name", part.name),
  ];

  // Description and category are optional on a valid Part. Empty means the Part Master holds none —
  // that IS the authoritative answer, so it is UNKNOWN rather than a fabricated dash.
  rows.push(
    part.description
      ? known("Description", part.description)
      : field("Description", FIELD_STATE.UNKNOWN, null, "No description on the Part record."),
  );
  rows.push(
    part.category
      ? known("Category", part.category)
      : field("Category", FIELD_STATE.UNKNOWN, null, "No category on the Part record."),
  );

  rows.push(known("Catalog status", part.status));
  rows.push(known("Control type", part.controlType));
  rows.push(known("Stocking class", part.stockingClass));
  rows.push(known("Stocking unit", part.stockingUnit));

  const mode = trackingModeForDisplay(part.controlType);
  rows.push(
    mode
      ? known("Tracking", mode)
      : field(
          "Tracking",
          FIELD_STATE.UNKNOWN,
          null,
          `Control type ${part.controlType} does not map to a single tracking mode.`,
        ),
  );

  // ── Rows that exist so their absence is not read as a value ────────────────────────────────────
  rows.push(
    field(
      "Serialized units",
      FIELD_STATE.CAPABILITY_INACTIVE,
      null,
      "Serialized asset lookup is built but not switched on.",
    ),
  );
  rows.push(
    field(
      "Location",
      FIELD_STATE.CAPABILITY_INACTIVE,
      null,
      "Location display is built but not switched on.",
    ),
  );
  // NOT a capability problem: no governed stock-balance read exists for a client at all. Saying
  // "not switched on" would imply one is waiting behind a switch.
  rows.push(
    field(
      "On hand",
      FIELD_STATE.NO_GOVERNED_READ,
      null,
      "Stock balances are not available to look up yet.",
    ),
  );

  return Object.freeze(rows.map(Object.freeze));
}

/**
 * Run one lookup.
 *
 * @param catalogResult the result of the governed `parts` read, exactly as fetchPartMasterList
 *                      returns it: { ok:true, parts, invalid } or { ok:false, code }.
 * @param token         the raw scanned or typed value.
 *
 * Returns { state, token, part, rows, candidates, message } — never throws, never partially applies
 * a state. `part` and `rows` are populated only in RESOLVED.
 */
export function buildPartLookup({ catalogResult, token } = {}) {
  const base = { token: typeof token === "string" ? token.trim() : "", part: null, rows: Object.freeze([]), candidates: Object.freeze([]) };

  // An unusable token is INVALID before anything else — there is no point spending a read on it, and
  // reporting a read problem for a typo would send the user to the wrong person.
  if (!base.token) {
    return Object.freeze({ ...base, state: LOOKUP_STATE.IDLE, message: null });
  }

  if (!catalogResult || typeof catalogResult !== "object") {
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.READ_FAILED,
      message: "The part catalog could not be read, so nothing can be looked up right now.",
    });
  }

  if (catalogResult.ok !== true) {
    // A REFUSAL IS NOT AN ABSENCE, and a failure is not a refusal.
    return catalogResult.code === "permission-denied"
      ? Object.freeze({
          ...base,
          state: LOOKUP_STATE.DENIED,
          message: "You are not authorized to look up parts. An administrator can grant catalog access.",
        })
      : Object.freeze({
          ...base,
          state: LOOKUP_STATE.READ_FAILED,
          message: "The part catalog could not be read, so nothing can be looked up right now.",
        });
  }

  const parts = Array.isArray(catalogResult.parts) ? catalogResult.parts : [];

  // The candidate set carries BOTH canonical Part Master codes: the internal part number is what is
  // printed on a shelf label, and the partId is what the system calls it. Both are the Part's own
  // governed identifiers — neither is manufactured here.
  const candidates = buildScanCandidates({
    catalogParts: parts.map((p) => ({ partId: p.partId, sku: p.internalPartNumber })),
  });

  const identity = resolveScannedIdentity(base.token, candidates);

  if (identity.resolutionState === SCAN_RESOLUTION.INVALID) {
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.INVALID,
      message: "That code couldn’t be read. Try scanning again, or type it in.",
    });
  }

  if (identity.resolutionState === SCAN_RESOLUTION.NOT_FOUND) {
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.NOT_FOUND,
      // The EXISTING scoped-search copy. CATALOG scope is allowed to say the catalog holds no match,
      // because the whole readable catalog was searched — but it still says nothing about existence
      // beyond it.
      message: notFoundReason(CANDIDATE_SCOPE.CATALOG, identity.tokenShape),
    });
  }

  if (identity.resolutionState === SCAN_RESOLUTION.AMBIGUOUS) {
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.AMBIGUOUS,
      candidates: Object.freeze((identity.candidates ?? []).map(Object.freeze)),
      message: "That code matches more than one governed record. It cannot be resolved to one part.",
    });
  }

  // RESOLVED. Only a PART can be resolved here: the candidate set contains parts only, because no
  // other entity has a governed catalog-wide read this caller is known to hold.
  const part = parts.find((p) => p.partId === identity.entityId) ?? null;
  if (!part) {
    // Defensive: the resolver matched an id the catalog does not contain. That is incoherent rather
    // than empty, and is reported as a failed read rather than as a part with no fields.
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.READ_FAILED,
      message: "That code resolved to a record that could not be read back.",
    });
  }

  return Object.freeze({
    ...base,
    state: LOOKUP_STATE.RESOLVED,
    part,
    rows: describePartLookup(part),
    message: null,
  });
}
