// LEGACY INVENTORY TRANSACTION -> eos_ops PHYSICAL MOVEMENT: the MAPPING CONTRACT.
//
// MIGRATION_ONLY. Sibling of inventoryWriterCapabilityCensus.ts / inventoryCapabilityGrantMigration.ts:
// pure, no Firebase, no Firestore, no Postgres connection, no `pg` client, no clock, no randomness.
// This module IMPORTS NOTHING AND WRITES NOTHING. It transforms exactly one legacy
// `inventory_transactions` row DTO into either
//
//   (A) a validated CANDIDATE eos_ops.inventory_movements row, or
//   (B) an explicit, typed REFUSAL carrying enough non-secret evidence for a reject bucket.
//
// It NEVER returns undefined/null as an implicit reject: every input yields one or the other.
// Reading the source store, writing Postgres, the reject-bucket table itself, tenant resolution and
// the cutover are all OUT OF SCOPE and deliberately absent.
//
// ============================ WHY A SEPARATE MAPPING BOUNDARY ============================
//
// The legacy ledger and the target table disagree in three places, and each disagreement is a way to
// silently corrupt a balance if the import "just copies the quantity":
//
//   1. QUANTITY SIGN. The legacy row's `quantity` uses THREE different conventions depending on the
//      movement type's `direction` (operationalMovementTypes.ts MOVEMENT_DIRECTION):
//        · IN      -> an UNSIGNED POSITIVE magnitude whose balance effect is POSITIVE
//        · OUT     -> an UNSIGNED POSITIVE magnitude whose balance effect is NEGATIVE
//        · SIGNED  -> the balance effect ITSELF, already carrying its own sign
//      `eos_ops.inventory_movements.quantity_delta` has ONE convention: the signed physical balance
//      effect. So `quantity_delta = source.quantity` is correct for exactly one of the three and
//      wrong (sign-flipped) or double-negated for the others. The sign authority here is
//      inventoryLedger/locationOnHand.ts MOVEMENT_SIGN -- imported, never restated.
//
//   2. VOCABULARY WIDTH. The legacy ledger holds TWO disjoint families in one collection. The
//      operational/physical family (OPERATIONAL_MOVEMENT_TYPES) and the commitment family
//      (LEGACY_TRANSACTION_TYPES = RESERVED / RELEASED / CONSUMED, owned by inventoryService.ts).
//      `ops_movement_type` covers only the first. See the commitment boundary section below.
//
//   3. ENUM WIDTH. `PART_TRACKING_MODES` is NONE | SERIAL | LOT but `ops_tracking_mode` is NONE |
//      SERIAL; `INVENTORY_LOCATION_TYPES` is WAREHOUSE | BIN | MOBILE | VENDOR | CUSTOMER | VIRTUAL
//      but `ops_location_type` is WAREHOUSE | BIN | MOBILE. Every value in the difference must be an
//      explicit refusal, never a coerced "closest" value.
//
// ============================ THE COMMITMENT BOUNDARY (HARD) ============================
//
// RESERVED / RELEASED / CONSUMED are COMMITMENT events, not physical movement, and they must not
// reach `inventory_movements`. Mechanical evidence, not doctrine:
//
//   · operationalMovementTypes.ts declares LEGACY_TRANSACTION_TYPES "deliberately DISJOINT" from
//     OPERATIONAL_MOVEMENT_TYPES, "so `type` alone distinguishes the two ledger families".
//   · locationOnHand.ts MOVEMENT_SIGN has no key for any of the three, so isPhysicalMovementType()
//     is false for all three and signedQuantity() returns 0 -- they move no physical stock, by
//     construction, in the ONE place the platform decides a movement's balance effect.
//   · inventoryService.ts's writeLedgerEntry() writes them as `{ workOrderId, partId, type,
//     quantity }` with NO `location`, NO `sourceObject`, NO `trackingMode` and NO schemaVersion --
//     they cannot even satisfy the location/tracking NOT NULL columns of the target table.
//
// The commitment CONSUMED versus PHYSICAL work-order consumption is the one that actually needs
// proving, because both come from a Work Order and both mean "used":
//
//   · commitment CONSUMED is written by inventoryService.ts consumeParts() as
//     `writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "CONSUMED", quantity: actual })`.
//     Location-less. It CLOSES a reservation; inventoryService.ts's own header records that it is
//     "not a physical removal" and that nothing removes consumed stock from physical on-hand.
//   · physical consumption is a DIFFERENT type, WORK_ORDER_CONSUMPTION, written by
//     workOrderConsumption/consumptionMovement.ts buildConsumptionMovement(), which carries a
//     `location`, a `sourceObject` of type WORK_ORDER, and a SIGNED quantity. Its own header says in
//     as many words: "NOT named CONSUMED ... naming this the same thing would collapse two facts
//     that must remain separable -- one reconciles a promise, this one moves stock."
//
// So the discriminator is the TYPE STRING ITSELF, and it is total: `CONSUMED` is always commitment,
// `WORK_ORDER_CONSUMPTION` is always physical. No heuristic on `sourceObject` or `location` is
// needed or used.
//
// ============================ PART ID ============================
//
// `part_id` is the canonical `parts` document id (Part.partId) and nothing else -- never a
// partsCatalog id, an alias, a manufacturer number, a display SKU or a spreadsheet name. Note that
// the commitment writer above stores `partId: item.sku`, which is exactly why this mapper must not
// trust a legacy part field blindly.
//
// This module does NOT own canonicalization and deliberately does NOT invent a second
// canonicalization algorithm. It takes a single INJECTED seam, `PartIdAuthority`, whose DEFAULT is
// the canonical contract from `partIdContract.ts` (`canonicalPartIdAuthority`). An import run that
// injects nothing therefore still gets canonical validation -- shape-only is NOT the production
// default. `shapeOnlyPartIdAuthority` remains exported for tests and specialised callers that
// deliberately want document-id shape checking without the canonical contract.

import {
  LEGACY_TRANSACTION_TYPES,
  MOVEMENT_DIRECTION,
  OPERATIONAL_MOVEMENT_TYPES,
  INVENTORY_LOCATION_TYPES,
  PART_TRACKING_MODES,
  type OperationalMovementType,
} from "../../inventoryLedger/operationalMovementTypes.js";
import { MOVEMENT_SIGN, isPhysicalMovementType } from "../../inventoryLedger/locationOnHand.js";
import { isOperatingCompanyIdShape } from "../../ownership/operatingCompanyAuthority.js";
import { requireCanonicalPartId } from "./partIdContract.js";

// ---------------------------------------------------------------------------------------------
// Target vocabulary (mirrors migrations/1757808000000_eos-ops-foundation.sql, which this module
// must not and does not modify -- the schema is owned elsewhere).
// ---------------------------------------------------------------------------------------------

/** `ops_tracking_mode` -- NARROWER than PART_TRACKING_MODES, which also has LOT. */
export const OPS_TRACKING_MODES = ["NONE", "SERIAL"] as const;
export type OpsTrackingMode = (typeof OPS_TRACKING_MODES)[number];

/** `ops_location_type` -- PHYSICAL ONLY, narrower than INVENTORY_LOCATION_TYPES. */
export const OPS_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE"] as const;
export type OpsLocationType = (typeof OPS_LOCATION_TYPES)[number];

/**
 * `ops_movement_type`. Identical to OPERATIONAL_MOVEMENT_TYPES; the test proves the two sets are
 * equal rather than trusting this list, so a future movement type cannot be silently unmappable.
 */
export type OpsMovementType = OperationalMovementType;

/**
 * Legacy location types that EXIST in the source vocabulary but are not physical-import-legal,
 * i.e. INVENTORY_LOCATION_TYPES minus OPS_LOCATION_TYPES. Computed, not hand-listed, so widening
 * either vocabulary cannot leave a stale hole here.
 */
export const NON_PHYSICAL_LOCATION_TYPES: ReadonlySet<string> = new Set(
  INVENTORY_LOCATION_TYPES.filter((t) => !(OPS_LOCATION_TYPES as readonly string[]).includes(t)),
);

// ---------------------------------------------------------------------------------------------
// Refusal taxonomy
// ---------------------------------------------------------------------------------------------

/**
 * Stable refusal codes. STABLE means a reject-bucket row written today still reads correctly after
 * this file changes, so codes are never renamed or reused for a different meaning.
 *
 * Every code below is justified by a specific source fact; the justification is on the code.
 */
export const MAPPING_REFUSAL_CODES = [
  /** The DTO is not an object at all. */
  "INVALID_SOURCE_ROW",
  /** No `type` on the row. A ledger row without a type has no family and no sign. */
  "MISSING_MOVEMENT_TYPE",
  /**
   * RESERVED / RELEASED / CONSUMED. THE hard boundary: commitment lifecycle, not physical movement.
   * Never silently dropped -- an import run must be able to account for every one of these rows.
   */
  "COMMITMENT_EVENT_NOT_PHYSICAL",
  /** A `type` in neither family. FAIL CLOSED: an unknown type has no provable balance effect. */
  "UNKNOWN_MOVEMENT_TYPE",
  /** No governed operating company was supplied by the exporter/crosswalk. Never inferred. */
  "MISSING_OPERATING_COMPANY",
  /** Supplied but not a governed operating-company id shape (operatingCompanyAuthority.ts). */
  "INVALID_OPERATING_COMPANY",
  /** No part identity on the row. */
  "MISSING_PART_ID",
  /** Present but refused by the injected PartIdAuthority. */
  "INVALID_PART_ID",
  /** No `trackingMode`. Historical tracking mode is immutable evidence and is never back-filled. */
  "MISSING_TRACKING_MODE",
  /** A mode outside PART_TRACKING_MODES entirely. */
  "UNKNOWN_TRACKING_MODE",
  /** LOT: a real source mode (PART_TRACKING_MODES) with no `ops_tracking_mode` member. */
  "UNSUPPORTED_TRACKING_MODE",
  /** A bare location id, or a location object with no `type`. A bare id is never assumed WAREHOUSE. */
  "MISSING_LOCATION_TYPE",
  /** A location type in neither vocabulary (this is where EQUIPMENT lands -- see the notes below). */
  "UNKNOWN_LOCATION_TYPE",
  /** VENDOR / CUSTOMER / VIRTUAL: real source types, not physical `ops_location_type` members. */
  "NON_PHYSICAL_LOCATION_TYPE",
  /** A location type with no id. */
  "MISSING_LOCATION_ID",
  /**
   * `direction` disagrees with MOVEMENT_DIRECTION for the row's type. The live deserializer treats
   * this as a malformed stored record (operationalMovementRepository.ts: "stored direction
   * inconsistent with type"), so the mapper does too rather than picking a winner.
   */
  "DIRECTION_TYPE_MISMATCH",
  /**
   * Quantity absent, non-numeric, non-integer (`quantity_delta` is INTEGER), zero where the target's
   * `movement_quantity_nonzero` CHECK forbids it, or non-positive on an IN/OUT magnitude.
   */
  "INVALID_QUANTITY",
  /**
   * A SIGNED-direction type (ADJUSTED / WORK_ORDER_CONSUMPTION) in SERIAL tracking mode. The legacy
   * representation CANNOT express its sign: operationalMovementValidation.ts validateQuantityReason
   * pins every SERIAL row's quantity to exactly 1 before direction is even consulted, and
   * locationOnHand.ts excludes non-NONE rows from all quantity math, so the stored +1 is evidence of
   * a unit, not a balance effect. `ops_movement_type` + `quantity_delta IN (1,-1)` demands a sign the
   * source row does not carry. FAIL CLOSED rather than infer one. (Both live producers of a SERIAL
   * ADJUSTED -- cycleCountCommand.ts and cycleCountSheetCommand.ts -- emit it only for a MISSING
   * serial, i.e. a decrement, but the ROW does not record that, and a mapper must not encode a fact
   * its input does not contain.)
   */
  "SERIAL_SIGN_NOT_RECOVERABLE",
  /** SERIAL mode with no serial number: `movement_serial_matches_tracking` requires one. */
  "MISSING_SERIAL_NUMBER",
  /**
   * NONE mode carrying a serial number. The same CHECK requires serial_number IS NULL, and the
   * schema comment says why: it "would silently claim serial identity for a Part this ledger never
   * tracks that way".
   */
  "SERIAL_NUMBER_NOT_ALLOWED",
  /** `source_kind` / `source_id` are NOT NULL on the target table; provenance is not invented. */
  "MISSING_SOURCE_OBJECT",
  /** `created_by` is NOT NULL on the target table. */
  "MISSING_ACTOR",
  /** `occurred_at` must be the row's real business time in epoch millis, never a default. */
  "INVALID_OCCURRED_AT",
] as const;
export type MappingRefusalCode = (typeof MAPPING_REFUSAL_CODES)[number];

/**
 * A refusal, shaped for a future reject bucket: the source row's identity, a stable reason code, a
 * short human detail, and a small map of OBSERVED tokens for triage.
 *
 * `observed` holds only vocabulary-level tokens the mapper actually looked at (a type name, a
 * tracking mode, a location type). It never carries the whole source row, so a reject-bucket row
 * cannot become an uncontrolled copy of source data.
 */
export interface MappingRefusal {
  readonly code: MappingRefusalCode;
  readonly sourceTransactionId: string | null;
  readonly detail: string;
  readonly observed: Readonly<Record<string, string>>;
}

/** A validated candidate `eos_ops.inventory_movements` row. Nothing here is written by this module. */
export interface OpsMovementCandidate {
  /** The legacy row's id, retained as provenance. Null when the DTO carried none. */
  readonly sourceTransactionId: string | null;
  /**
   * The governed operating company, supplied EXPLICITLY by the exporter/crosswalk. Never derived
   * from a warehouse, truck, employee or homeWarehouseId. Carried as a key rather than a tenant id:
   * the tenant_id/company crosswalk is a separate authority this lane does not own.
   */
  readonly operatingCompanyKey: string;
  readonly partId: string;
  readonly trackingMode: OpsTrackingMode;
  readonly locationType: OpsLocationType;
  readonly locationId: string;
  readonly movementType: OpsMovementType;
  /** SIGNED physical balance effect. See the sign table in this file's header. */
  readonly quantityDelta: number;
  readonly serialNumber: string | null;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly idempotencyKey: string | null;
  /** Business event time, epoch millis. */
  readonly occurredAt: number;
}

export type MappingResult =
  | { readonly mapped: true; readonly candidate: OpsMovementCandidate; readonly refusal: null }
  | { readonly mapped: false; readonly candidate: null; readonly refusal: MappingRefusal };

/** The legacy row DTO. Everything is `unknown`: this is untrusted historical data, not a typed value. */
export interface LegacyInventoryTransactionRow {
  readonly id?: unknown;
  readonly type?: unknown;
  /** "IN" | "OUT" | "SIGNED" | absent. Absent is normal: legacy commitment rows never carried one. */
  readonly direction?: unknown;
  readonly partId?: unknown;
  readonly trackingMode?: unknown;
  readonly quantity?: unknown;
  /** `{ type, locationId }` on an operational row; absent on a commitment row. */
  readonly location?: unknown;
  readonly serialNo?: unknown;
  readonly sourceObject?: unknown;
  /** `{ kind, id }`. Its `id` becomes `created_by`, which is NOT NULL on the target table. */
  readonly actor?: unknown;
  readonly idempotencyKey?: unknown;
  readonly occurredAt?: unknown;
  /**
   * Supplied by the exporter/crosswalk as explicit governed company authority. It is an INPUT to the
   * mapping, not something the mapper resolves.
   */
  readonly operatingCompanyKey?: unknown;
  readonly [extra: string]: unknown;
}

// ---------------------------------------------------------------------------------------------
// The injected Part-id seam
// ---------------------------------------------------------------------------------------------

export type PartIdResolution =
  | { readonly ok: true; readonly partId: string }
  | { readonly ok: false; readonly code: "MISSING_PART_ID" | "INVALID_PART_ID"; readonly detail: string };

export type PartIdAuthority = (value: unknown) => PartIdResolution;

/**
 * The DEFAULT seam: DOCUMENT-ID SHAPE ONLY, and deliberately no more.
 *
 * It is NOT a canonicalization algorithm and must never grow into one -- there is exactly one
 * canonical Part-id authority in this platform and this is the hole it plugs into. What it checks is
 * only what a Firestore document id can be at all, plus a conservative whitespace guard, because the
 * values this must keep out (a display SKU, a manufacturer number, a spreadsheet name) characteristically
 * contain spaces or slashes:
 *
 *   · a non-empty string;
 *   · no surrounding whitespace (an untrimmed id is a spreadsheet artifact, not an id);
 *   · no internal whitespace;
 *   · no "/" (a document id cannot contain a path separator);
 *   · not "." or ".." and not of the reserved __...__ form;
 *   · at most 1500 bytes.
 *
 * Anything that passes is only SHAPE-plausible; it is NOT proven canonical. This is NOT the
 * mapper's default -- `canonicalPartIdAuthority` is. Kept exported for tests and specialised
 * callers that deliberately want shape-only checking.
 */
export function shapeOnlyPartIdAuthority(value: unknown): PartIdResolution {
  if (value === undefined || value === null) return { ok: false, code: "MISSING_PART_ID", detail: "no part identity on the row" };
  if (typeof value !== "string") return { ok: false, code: "INVALID_PART_ID", detail: "part identity is not a string" };
  if (value === "") return { ok: false, code: "MISSING_PART_ID", detail: "part identity is empty" };
  if (value.trim() === "") return { ok: false, code: "MISSING_PART_ID", detail: "part identity is blank" };
  if (value.trim() !== value) return { ok: false, code: "INVALID_PART_ID", detail: "part identity carries surrounding whitespace" };
  if (/\s/.test(value)) return { ok: false, code: "INVALID_PART_ID", detail: "part identity contains whitespace" };
  if (value.includes("/")) return { ok: false, code: "INVALID_PART_ID", detail: "part identity contains a path separator" };
  if (value === "." || value === "..") return { ok: false, code: "INVALID_PART_ID", detail: "part identity is a relative path token" };
  if (/^__.*__$/.test(value)) return { ok: false, code: "INVALID_PART_ID", detail: "part identity uses the reserved __id__ form" };
  if (Buffer.byteLength(value, "utf8") > 1500) return { ok: false, code: "INVALID_PART_ID", detail: "part identity exceeds the document-id length limit" };
  return { ok: true, partId: value };
}

/**
 * Adapter for a THROWING canonical authority of the `requireCanonicalPartId(value): string` shape.
 *
 * This is the integration point named in the header: it exists so adopting the canonical authority
 * is a one-line injection at the call site rather than an edit to this module's logic.
 */
export function adaptThrowingPartIdAuthority(require_: (value: unknown) => string): PartIdAuthority {
  return (value: unknown): PartIdResolution => {
    if (value === undefined || value === null || value === "") {
      return { ok: false, code: "MISSING_PART_ID", detail: "no part identity on the row" };
    }
    try {
      const partId = require_(value);
      if (typeof partId !== "string" || partId === "") {
        return { ok: false, code: "INVALID_PART_ID", detail: "canonical authority returned no part id" };
      }
      return { ok: true, partId };
    } catch (error) {
      const detail = error instanceof Error && typeof error.message === "string" ? error.message : "canonical authority refused the part id";
      return { ok: false, code: "INVALID_PART_ID", detail };
    }
  };
}

/**
 * The DEFAULT Part-id authority for this mapper: the canonical contract shipped by
 * `partIdContract.ts` (ruling R1 -- part_id IS the `parts` document id). This module still owns
 * no canonicalization of its own; it delegates. A caller may inject a different authority for
 * tests or a specialised run, but the default is canonical, so an import run cannot accidentally
 * receive shape-only validation.
 */
export const canonicalPartIdAuthority: PartIdAuthority = (value) => {
  // Shape gate FIRST -- it owns two things the canonical contract does not express, and this
  // composes the two EXISTING authorities rather than inventing a third:
  //   1. MISSING_PART_ID vs INVALID_PART_ID. requireCanonicalPartId refuses both as one condition,
  //      but the reject bucket must tell an absent identity apart from a malformed one.
  //   2. Firestore RESERVED document-id forms. `__name__` satisfies the Part business-key grammar
  //      (letters/digits/underscore/hyphen) yet can never name a real `parts` document, so the
  //      canonical contract alone accepts it. Verified mechanically, not assumed.
  const shape = shapeOnlyPartIdAuthority(value);
  if (!shape.ok) return shape;
  return adaptThrowingPartIdAuthority(requireCanonicalPartId)(value);
};


export interface MappingDeps {
  /** Defaults to `canonicalPartIdAuthority` (the R1 contract). Inject only to override it. */
  readonly partIdAuthority?: PartIdAuthority;
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

const OPERATIONAL_TYPE_SET: ReadonlySet<string> = new Set<string>(OPERATIONAL_MOVEMENT_TYPES);
const COMMITMENT_TYPE_SET: ReadonlySet<string> = new Set<string>(LEGACY_TRANSACTION_TYPES);
const SOURCE_TRACKING_MODE_SET: ReadonlySet<string> = new Set<string>(PART_TRACKING_MODES);
const OPS_TRACKING_MODE_SET: ReadonlySet<string> = new Set<string>(OPS_TRACKING_MODES);
const OPS_LOCATION_TYPE_SET: ReadonlySet<string> = new Set<string>(OPS_LOCATION_TYPES);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A short, non-secret token for `observed`. Truncated so a diagnostic can never carry a payload. */
function token(value: unknown): string {
  if (typeof value === "string") return value.length > 64 ? `${value.slice(0, 64)}…` : value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return Array.isArray(value) ? "array" : typeof value;
}

function refuse(
  code: MappingRefusalCode,
  sourceTransactionId: string | null,
  detail: string,
  observed: Record<string, string> = {},
): MappingResult {
  return { mapped: false, candidate: null, refusal: { code, sourceTransactionId, detail, observed: Object.freeze({ ...observed }) } };
}

/**
 * The SIGN DECISION, and the only place one is made.
 *
 * `rule` comes from locationOnHand.ts MOVEMENT_SIGN -- the platform's single sign authority -- so
 * this function decides HOW a source quantity is normalized, never WHICH WAY a movement points.
 */
function normalizeQuantityDelta(
  type: OpsMovementType,
  trackingMode: OpsTrackingMode,
  rawQuantity: unknown,
): { readonly ok: true; readonly delta: number } | { readonly ok: false; readonly code: MappingRefusalCode; readonly detail: string } {
  const rule = MOVEMENT_SIGN[type];
  if (typeof rawQuantity !== "number" || !Number.isFinite(rawQuantity)) {
    return { ok: false, code: "INVALID_QUANTITY", detail: "quantity is not a finite number" };
  }
  if (!Number.isInteger(rawQuantity)) {
    return { ok: false, code: "INVALID_QUANTITY", detail: "quantity_delta is an INTEGER column; a fractional quantity has no representation" };
  }

  if (trackingMode === "SERIAL") {
    // A SERIAL row is one unit of evidence. Its stored quantity is pinned to 1 by the live validator
    // and carries no sign, so the sign must come from the movement's own direction -- and a SIGNED
    // direction therefore has none to give.
    if (rawQuantity !== 1) {
      return { ok: false, code: "INVALID_QUANTITY", detail: "a SERIAL row records exactly one unit; its quantity must be 1" };
    }
    if (rule === "SIGNED") {
      return { ok: false, code: "SERIAL_SIGN_NOT_RECOVERABLE", detail: "a SIGNED movement in SERIAL mode does not record its direction in the source row" };
    }
    return { ok: true, delta: rule === "PLUS" ? 1 : -1 };
  }

  if (rule === "SIGNED") {
    // ALREADY the balance effect. Applying a second sign here is the double-negation this contract
    // exists to prevent: a positive correction would become a second decrement.
    if (rawQuantity === 0) {
      return { ok: false, code: "INVALID_QUANTITY", detail: "a signed movement of zero violates movement_quantity_nonzero" };
    }
    return { ok: true, delta: rawQuantity };
  }

  // IN / OUT rows are UNSIGNED POSITIVE magnitudes by contract. A non-positive one is malformed;
  // taking its absolute value would let a corrupt negative receipt manufacture stock.
  if (rawQuantity <= 0) {
    return { ok: false, code: "INVALID_QUANTITY", detail: "an IN/OUT movement carries an unsigned positive magnitude" };
  }
  return { ok: true, delta: rule === "PLUS" ? rawQuantity : -rawQuantity };
}

// ---------------------------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------------------------

/**
 * Map ONE legacy inventory transaction to a candidate movement or a typed refusal.
 *
 * DETERMINISTIC and SIDE-EFFECT FREE: same input -> same output, always; the input row is never
 * mutated; nothing is read from or written to any store, clock or environment.
 */
export function mapLegacyInventoryMovement(row: unknown, deps: MappingDeps = {}): MappingResult {
  if (!isPlainRecord(row)) {
    return refuse("INVALID_SOURCE_ROW", null, "the source row is not an object", { received: token(row) });
  }
  const sourceTransactionId = text(row.id);

  // ---- 1. family + type. FIRST, so a commitment row is always reported as a commitment row rather
  // than as whatever else it happens to be missing.
  const rawType = row.type;
  const typeText = text(rawType);
  if (typeText === null) {
    return refuse("MISSING_MOVEMENT_TYPE", sourceTransactionId, "the row carries no movement type", { type: token(rawType) });
  }
  if (COMMITMENT_TYPE_SET.has(typeText)) {
    return refuse(
      "COMMITMENT_EVENT_NOT_PHYSICAL",
      sourceTransactionId,
      "commitment lifecycle event: it reconciles a promise against availability and moves no physical stock",
      { type: typeText, family: "COMMITMENT" },
    );
  }
  if (!OPERATIONAL_TYPE_SET.has(typeText) || !isPhysicalMovementType(typeText)) {
    return refuse("UNKNOWN_MOVEMENT_TYPE", sourceTransactionId, "the movement type is in neither the physical nor the commitment vocabulary", { type: typeText });
  }
  const movementType = typeText as OpsMovementType;

  // ---- 2. operating company: EXPLICIT governed authority only.
  const rawCompany = row.operatingCompanyKey;
  if (rawCompany === undefined || rawCompany === null || rawCompany === "") {
    return refuse("MISSING_OPERATING_COMPANY", sourceTransactionId, "no governed operating company was supplied; it is never inferred from a warehouse, truck, employee or home warehouse", { type: movementType });
  }
  if (!isOperatingCompanyIdShape(rawCompany)) {
    return refuse("INVALID_OPERATING_COMPANY", sourceTransactionId, "the supplied operating company is not a governed operating-company id", { operatingCompanyKey: token(rawCompany) });
  }
  const operatingCompanyKey = rawCompany;

  // ---- 3. part id, through the injected authority.
  const partIdAuthority = deps.partIdAuthority ?? canonicalPartIdAuthority;
  const part = partIdAuthority(row.partId);
  if (!part.ok) {
    return refuse(part.code, sourceTransactionId, part.detail, { partId: token(row.partId) });
  }

  // ---- 4. tracking mode: historical evidence, read from the ROW. Current Part.controlType is never
  // consulted -- rewriting a historical row's tracking mode from today's catalog would restate the
  // past.
  const rawMode = row.trackingMode;
  const modeText = text(rawMode);
  if (modeText === null) {
    return refuse("MISSING_TRACKING_MODE", sourceTransactionId, "the row carries no tracking mode and one is never back-filled from the current Part", { type: movementType });
  }
  if (!SOURCE_TRACKING_MODE_SET.has(modeText)) {
    return refuse("UNKNOWN_TRACKING_MODE", sourceTransactionId, "the tracking mode is outside the source tracking vocabulary", { trackingMode: modeText });
  }
  if (!OPS_TRACKING_MODE_SET.has(modeText)) {
    return refuse("UNSUPPORTED_TRACKING_MODE", sourceTransactionId, "a real source tracking mode with no ops_tracking_mode member; it is refused, never collapsed into NONE", { trackingMode: modeText });
  }
  const trackingMode = modeText as OpsTrackingMode;

  // ---- 5. location: physical only, and always a TYPED location.
  const rawLocation = row.location;
  if (!isPlainRecord(rawLocation)) {
    // A bare location id (a string) is the common legacy shape and is REFUSED: assuming WAREHOUSE
    // for it would invent custody the row never stated.
    return refuse("MISSING_LOCATION_TYPE", sourceTransactionId, "the row has no typed location; a bare location id is never assumed to be a warehouse", { location: token(rawLocation) });
  }
  const rawLocationType = rawLocation.type;
  const locationTypeText = text(rawLocationType);
  if (locationTypeText === null) {
    return refuse("MISSING_LOCATION_TYPE", sourceTransactionId, "the location carries no type", { locationType: token(rawLocationType) });
  }
  if (!OPS_LOCATION_TYPE_SET.has(locationTypeText)) {
    // NON_PHYSICAL: a real source location type with no physical ops_location_type member.
    // UNKNOWN: not a source location type at all. EQUIPMENT lands here -- it is NOT a member of
    // INVENTORY_LOCATION_TYPES anywhere in this codebase, so there is nothing to "downgrade"; it is
    // simply not a location a physical movement can name.
    const code: MappingRefusalCode = NON_PHYSICAL_LOCATION_TYPES.has(locationTypeText) ? "NON_PHYSICAL_LOCATION_TYPE" : "UNKNOWN_LOCATION_TYPE";
    return refuse(code, sourceTransactionId, "the location type is not a physical ops_location_type", { locationType: locationTypeText });
  }
  const locationId = text(rawLocation.locationId);
  if (locationId === null) {
    return refuse("MISSING_LOCATION_ID", sourceTransactionId, "the location carries no id", { locationType: locationTypeText });
  }
  const locationType = locationTypeText as OpsLocationType;

  // ---- 6. serial identity, per movement_serial_matches_tracking.
  const serialNumber = text(row.serialNo);
  if (trackingMode === "SERIAL" && serialNumber === null) {
    return refuse("MISSING_SERIAL_NUMBER", sourceTransactionId, "a SERIAL row must name the unit it moved", { type: movementType });
  }
  if (trackingMode === "NONE" && serialNumber !== null) {
    return refuse("SERIAL_NUMBER_NOT_ALLOWED", sourceTransactionId, "a NONE-mode row must not claim serial identity", { type: movementType });
  }

  // ---- 7. direction coherence, then the sign.
  const expectedDirection = MOVEMENT_DIRECTION[movementType];
  const rawDirection = row.direction;
  if (rawDirection !== undefined && rawDirection !== null && rawDirection !== expectedDirection) {
    return refuse("DIRECTION_TYPE_MISMATCH", sourceTransactionId, "the row's stored direction disagrees with its movement type", {
      type: movementType,
      direction: token(rawDirection),
      expectedDirection,
    });
  }
  const quantity = normalizeQuantityDelta(movementType, trackingMode, row.quantity);
  if (!quantity.ok) {
    return refuse(quantity.code, sourceTransactionId, quantity.detail, { type: movementType, trackingMode, quantity: token(row.quantity) });
  }

  // ---- 8. provenance. source_kind / source_id / created_by are NOT NULL on the target table, and a
  // migration must not invent any of them.
  //
  // The source-object TYPE is deliberately NOT re-validated against MOVEMENT_SOURCE_TYPE here:
  // `source_kind` is free TEXT on the target table, and re-litigating a historical row's provenance
  // vocabulary is a different decision than mapping its balance effect.
  const rawSource = row.sourceObject;
  const sourceKind = isPlainRecord(rawSource) ? text(rawSource.type) : null;
  const sourceId = isPlainRecord(rawSource) ? text(rawSource.id) : null;
  if (sourceKind === null || sourceId === null) {
    return refuse("MISSING_SOURCE_OBJECT", sourceTransactionId, "the row names no source object and provenance is never invented", { type: movementType });
  }

  const actorId = isPlainRecord(row.actor) ? text((row.actor as Record<string, unknown>).id) : null;
  if (actorId === null) {
    return refuse("MISSING_ACTOR", sourceTransactionId, "the row names no actor; created_by is NOT NULL and is never invented", { type: movementType });
  }

  const occurredAt = row.occurredAt;
  if (typeof occurredAt !== "number" || !Number.isInteger(occurredAt) || occurredAt <= 0) {
    return refuse("INVALID_OCCURRED_AT", sourceTransactionId, "occurred_at must be the row's real business time in epoch millis", { occurredAt: token(occurredAt) });
  }

  const candidate: OpsMovementCandidate = Object.freeze({
    sourceTransactionId,
    operatingCompanyKey,
    partId: part.partId,
    trackingMode,
    locationType,
    locationId,
    movementType,
    quantityDelta: quantity.delta,
    serialNumber,
    sourceKind,
    sourceId,
    idempotencyKey: text(row.idempotencyKey),
    occurredAt,
  });
  return { mapped: true, candidate, refusal: null };
}

/**
 * Map a batch. Order-preserving and total: the output has exactly one entry per input, so a caller
 * can always account for every source row it read.
 */
export function mapLegacyInventoryMovements(rows: readonly unknown[], deps: MappingDeps = {}): readonly MappingResult[] {
  return (rows ?? []).map((row) => mapLegacyInventoryMovement(row, deps));
}

/** Split a mapped batch into the candidates an importer would insert and the reject-bucket evidence. */
export function partitionMappingResults(results: readonly MappingResult[]): {
  readonly candidates: readonly OpsMovementCandidate[];
  readonly refusals: readonly MappingRefusal[];
} {
  const candidates: OpsMovementCandidate[] = [];
  const refusals: MappingRefusal[] = [];
  for (const result of results) {
    if (result.mapped) candidates.push(result.candidate);
    else refusals.push(result.refusal);
  }
  return { candidates, refusals };
}
