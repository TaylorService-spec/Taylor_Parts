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

  // ── Phase G: outcomes that only a registered IDENTIFIER can produce ──────────────────────────
  ALIAS_INACTIVE: "ALIAS_INACTIVE",   // registered, deliberately switched off — NOT "never registered"
  ALIAS_DENIED: "ALIAS_DENIED",       // identifier resolution refused — says nothing about the part
  ALIAS_UNAVAILABLE: "ALIAS_UNAVAILABLE", // identifier lookup not switched on / unreachable here
  ALIAS_PART_UNREADABLE: "ALIAS_PART_UNREADABLE", // the identifier resolved; the Part it names did not
  CONFLICT: "CONFLICT",       // the code IS a part and ALSO an identifier for a different part
});

/**
 * How the resolved Part was reached. Shown because a warehouse user who scanned a box and got a
 * Part back should be able to see that it matched the SUPPLIER'S SKU rather than a UPC — without
 * that, a mis-registered identifier stays invisible until it causes a wrong receipt.
 */
export const MATCHED_BY = Object.freeze({
  PART_CODE: "PART_CODE",
  IDENTIFIER: "IDENTIFIER",
});

/** The alias-resolution vocabulary the server returns, mirrored so the client never invents one. */
export const ALIAS_RESULT = Object.freeze({
  FOUND: "FOUND",
  INACTIVE: "INACTIVE",
  AMBIGUOUS: "AMBIGUOUS",
  NOT_FOUND: "NOT_FOUND",
  MALFORMED: "MALFORMED",
});

/** The transport's own "switched off" status — a different fact from a permission denial. */
export const ALIAS_NOT_READY = "transport-not-ready";

/**
 * The ten registered identifier types, in the operator's words.
 *
 * MIRRORS functions/src/partMaster/types.ts ALIAS_TYPES exactly — one label per type, no extras and
 * no omissions. A type with no label would render as a raw enum next to a scan result, which is the
 * moment an operator most needs plain language.
 */
export const ALIAS_TYPE_LABEL = Object.freeze({
  INTERNAL_PN: "internal part number",
  MANUFACTURER_PN: "manufacturer part number",
  SUPPLIER_SKU: "supplier SKU",
  UPC: "UPC barcode",
  EAN: "EAN barcode",
  GTIN: "GTIN barcode",
  LEGACY: "legacy code",
  CUSTOMER_REF: "customer reference",
  VENDOR_REF: "vendor reference",
  BARCODE_OTHER: "barcode",
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
 * @param aliasOutcome  the alias transport's answer, exactly as partAliasCallableClient returns
 * it: { result } or { errorStatus, errorDetail }, or null when identifier resolution was not
 * attempted at all.
 * @param token         the raw scanned or typed value.
 *
 * Returns { state, token, part, rows, candidates, message } — never throws, never partially applies
 * a state. `part` and `rows` are populated only in RESOLVED.
 */
export function buildPartLookup({ catalogResult, aliasOutcome = null, token } = {}) {
  const base = {
    token: typeof token === "string" ? token.trim() : "",
    part: null,
    rows: Object.freeze([]),
    candidates: Object.freeze([]),
    /** How the part was reached, when one was. Null in every non-RESOLVED state. */
    matchedBy: null,
    /** The identifier that matched, when it was an alias: { aliasType, partId }. */
    matchedIdentifier: null,
  };

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
    // Not a part code. Phase G: it may still be a REGISTERED IDENTIFIER for one. The identifier
    // answer is consulted ONLY here, so direct part-code lookup is bit-for-bit what it was before,
    // and an identifier failure can never widen into an unrelated part match.
    return lookupFromAlias({
      base,
      parts,
      alias: readAliasResolution(aliasOutcome),
      // The EXISTING scoped-search copy. CATALOG scope is allowed to say the catalog holds no match,
      // because the whole readable catalog was searched — but it still says nothing about existence
      // beyond it.
      directNotFoundMessage: notFoundReason(CANDIDATE_SCOPE.CATALOG, identity.tokenShape),
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

  // RESOLVED BY PART CODE. Only a PART can be resolved here: the candidate set contains parts only,
  // because no other entity has a governed catalog-wide read this caller is known to hold.
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

  // THE CONFLICT CHECK. The same scanned value is this Part's own code AND a registered identifier
  // for a DIFFERENT Part. Preferring one silently would hide a data error inside a confident
  // answer, and whichever we preferred would be wrong half the time.
  const alias = readAliasResolution(aliasOutcome);
  if (alias.kind === "RESULT" && alias.value.result === ALIAS_RESULT.FOUND && alias.value.partId !== part.partId) {
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.CONFLICT,
      candidates: Object.freeze([
        Object.freeze({ entityType: "PART", entityId: part.partId }),
        Object.freeze({ entityType: "PART", entityId: alias.value.partId }),
      ]),
      message:
        "That code is a part number AND a registered identifier for a different part. It cannot be resolved to one part until that is corrected.",
    });
  }

  return Object.freeze({
    ...base,
    state: LOOKUP_STATE.RESOLVED,
    part,
    rows: describePartLookup(part),
    matchedBy: MATCHED_BY.PART_CODE,
    message: null,
  });
}

/**
 * Normalize the transport's answer into one of three kinds, so every caller below reasons about the
 * same three things: we got an answer, we were refused, or we could not ask.
 */
function readAliasResolution(aliasOutcome) {
  if (!aliasOutcome || typeof aliasOutcome !== "object") return { kind: "NOT_ATTEMPTED" };
  if (aliasOutcome.errorStatus === ALIAS_NOT_READY) return { kind: "UNAVAILABLE" };
  if (aliasOutcome.errorStatus === "permission-denied") return { kind: "DENIED" };
  if (typeof aliasOutcome.errorStatus === "string" && aliasOutcome.errorStatus.length > 0) {
    return { kind: "UNAVAILABLE" };
  }
  const value = aliasOutcome.result;
  // A malformed or unrecognized payload is treated as no answer, never as "nothing is registered".
  if (!value || typeof value !== "object" || !Object.values(ALIAS_RESULT).includes(value.result)) {
    return { kind: "UNAVAILABLE" };
  }
  return { kind: "RESULT", value };
}

/**
 * NO DIRECT PART-CODE MATCH. What the registered-identifier answer means on its own.
 *
 * THE RULE THAT MATTERS HERE: an identifier failure NEVER falls back to an unrelated Part. Every
 * branch below either names the Part that identifier actually points to, or reports a failure -- it
 * never widens the search to find something to show.
 */
function lookupFromAlias({ base, parts, alias, directNotFoundMessage }) {
  if (alias.kind === "NOT_ATTEMPTED") {
    return Object.freeze({ ...base, state: LOOKUP_STATE.NOT_FOUND, message: directNotFoundMessage });
  }

  if (alias.kind === "DENIED") {
    // Says nothing about whether the identifier exists. Wording it as an absence would be both a lie
    // and a disclosure decision this screen has no authority to make.
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.ALIAS_DENIED,
      message:
        "That is not a part number, and you are not authorized to look up registered identifiers, so it could not be checked as one.",
    });
  }

  if (alias.kind === "UNAVAILABLE") {
    // The honest version of NOT_FOUND when half the search could not run. A bare "no match" here
    // would tell the operator their barcode is unregistered when it was never checked.
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.ALIAS_UNAVAILABLE,
      message:
        "That is not a part number. Barcode and identifier lookup is not switched on in this environment, so it could not be checked as one either.",
    });
  }

  const value = alias.value;

  if (value.result === ALIAS_RESULT.AMBIGUOUS) {
    const matches = Array.isArray(value.matches) ? value.matches : [];
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.AMBIGUOUS,
      candidates: Object.freeze(matches.map((m) => Object.freeze({ entityType: "PART", entityId: m.partId }))),
      message: "That identifier is registered against more than one part. It cannot be resolved to one.",
    });
  }

  if (value.result === ALIAS_RESULT.INACTIVE) {
    // Registered and deliberately retired. Telling the operator it was never registered would send
    // them to create a duplicate of a record somebody switched off on purpose.
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.ALIAS_INACTIVE,
      candidates: Object.freeze([Object.freeze({ entityType: "PART", entityId: value.partId })]),
      message: "That identifier is registered but no longer active. It used to point to part " + value.partId + ".",
    });
  }

  if (value.result === ALIAS_RESULT.FOUND) {
    const part = parts.find((p) => p.partId === value.partId) ?? null;
    if (!part) {
      // The identifier resolved; the Part it names is not in what this caller could read. That is a
      // DIFFERENT fact from an unregistered identifier, and it names the part rather than pretending
      // the scan found nothing.
      return Object.freeze({
        ...base,
        state: LOOKUP_STATE.ALIAS_PART_UNREADABLE,
        candidates: Object.freeze([Object.freeze({ entityType: "PART", entityId: value.partId })]),
        message: "That identifier points to part " + value.partId + ", which could not be read.",
      });
    }
    return Object.freeze({
      ...base,
      state: LOOKUP_STATE.RESOLVED,
      part,
      rows: describePartLookup(part),
      matchedBy: MATCHED_BY.IDENTIFIER,
      matchedIdentifier: Object.freeze({ aliasType: value.aliasType ?? null, partId: value.partId }),
      message: null,
    });
  }

  // NOT_FOUND or MALFORMED from the identifier resolver: the value is neither a part code nor a
  // registered identifier. One message, because to the operator it is one fact.
  //
  // AND ITS OWN WORDS, not the part-code copy. `directNotFoundMessage` explains the SHAPE of a part
  // code ("part codes look like PRT-1004") — which was right when a part code was the only valid
  // input, and became wrong the moment barcodes were too. Telling someone their perfectly good UPC
  // does not look like a part code is both false and useless.
  return Object.freeze({
    ...base,
    state: LOOKUP_STATE.NOT_FOUND,
    message: "No governed record matches that code, and it is not a registered identifier for one.",
  });
}
