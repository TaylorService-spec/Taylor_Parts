// Receiving Location Authority -- I-LA C2 / gate I-LA1a: the SHARED, PURE, DETERMINISTIC
// §3A governed-warehouse validator/deserializer (spec: docs/specifications/
// receiving-location-authority-i-la-c2-warehouse-status.md).
//
// This is the single validator that every later consumer runs against the SAME bytes --
// the I-LA3 migration + verifier, the I-LA2 trusted writer, and the I-LA5 Receiving
// resolver -- so "governed" means exactly one thing across the system. It is INERT in
// this gate: nothing imports it at runtime yet (no writer, migration, resolver, Rules).
//
// PURE and DETERMINISTIC: no Firebase app, no persistence, no clock, no I/O. It NEVER
// throws for malformed stored data -- it returns a sanitized result whose `reason` is a
// bounded governed token and never echoes a raw stored value. It never mutates its input.
//
// Timestamp contract: the accepted stored representation is the repository's actual
// Firestore server-timestamp type -- `Timestamp` from firebase-admin/firestore, checked
// with `instanceof`. A look-alike object that merely exposes `.toMillis()` is rejected.

import { Timestamp } from "firebase-admin/firestore";
import { isPlainObject, isNonEmptyString } from "../inventoryLedger/operationalMovementValidation.js";
import {
  WAREHOUSE_STATUSES,
  WAREHOUSE_PROVENANCES,
  type GovernedWarehouse,
  type GovernedWarehouseValidationResult,
} from "../types/warehouse.js";

// The ONLY keys a governed warehouse record may carry. `active` is deliberately absent
// (its presence is a distinct, earlier-checked failure); any other key fails closed.
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "name",
  "location",
  "status",
  "version",
  "updatedAt",
  "updatedBy",
  "provenance",
  "createdAt",
  "createdBy",
  "governanceInitializedAt",
  "governanceInitializedBy",
]);

// Bounded governed failure reasons. Stable tokens (no raw values) so callers/tests can
// assert on them and nothing sensitive leaks into logs.
export const GOVERNED_WAREHOUSE_REASONS = Object.freeze({
  NOT_OBJECT: "not_object",
  ACTIVE_FORBIDDEN: "active_forbidden",
  UNKNOWN_FIELD: "unknown_field",
  ID_INVALID: "id_invalid",
  NAME_INVALID: "name_invalid",
  LOCATION_INVALID: "location_invalid",
  STATUS_INVALID: "status_invalid",
  VERSION_INVALID: "version_invalid",
  UPDATED_AT_INVALID: "updated_at_invalid",
  UPDATED_BY_INVALID: "updated_by_invalid",
  PROVENANCE_INVALID: "provenance_invalid",
  CREATED_PAIR_INCOMPLETE: "created_pair_incomplete",
  CREATED_METADATA_INVALID: "created_metadata_invalid",
  GOVERNANCE_PAIR_INCOMPLETE: "governance_pair_incomplete",
  GOVERNANCE_METADATA_INVALID: "governance_metadata_invalid",
  NATIVE_REQUIRES_CREATED: "native_requires_created",
  NATIVE_FORBIDS_GOVERNANCE_INIT: "native_forbids_governance_init",
  MIGRATED_REQUIRES_GOVERNANCE_INIT: "migrated_requires_governance_init",
} as const);

function fail(reason: string): GovernedWarehouseValidationResult {
  return { valid: false, value: null, reason };
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// A governed version is a whole number >= 1. Rejects zero/negative/fractional/non-finite
// (Number.isInteger is false for NaN/Infinity/fractions) and any non-number type.
function isGovernedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isServerTimestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp;
}

// State of an (atKey, byKey) metadata pair as an own-property pair:
//   "absent"        -- neither own-present
//   "incomplete"    -- exactly one own-present (half pair)
//   "present-valid" -- both own-present, at is a Timestamp AND by is a non-blank string
//   "invalid"       -- both own-present but malformed (bad timestamp or blank/non-string actor)
type PairState = "absent" | "incomplete" | "present-valid" | "invalid";
function pairState(obj: Record<string, unknown>, atKey: string, byKey: string): PairState {
  const hasAt = hasOwn(obj, atKey);
  const hasBy = hasOwn(obj, byKey);
  if (!hasAt && !hasBy) return "absent";
  if (hasAt !== hasBy) return "incomplete";
  if (isServerTimestamp(obj[atKey]) && isNonEmptyString(obj[byKey])) return "present-valid";
  return "invalid";
}

// Validate/deserialize an untrusted stored value into a governed §3A warehouse record.
// Returns a sanitized result; never throws for data reasons; never mutates `input`.
export function validateGovernedWarehouse(input: unknown): GovernedWarehouseValidationResult {
  if (!isPlainObject(input)) return fail(GOVERNED_WAREHOUSE_REASONS.NOT_OBJECT);

  // `active` is forbidden regardless of value (true/false/null/undefined-own-property).
  if (hasOwn(input, "active")) return fail(GOVERNED_WAREHOUSE_REASONS.ACTIVE_FORBIDDEN);
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) return fail(GOVERNED_WAREHOUSE_REASONS.UNKNOWN_FIELD);
  }

  // Base identity fields.
  if (!isNonEmptyString(input.id)) return fail(GOVERNED_WAREHOUSE_REASONS.ID_INVALID);
  if (!isNonEmptyString(input.name)) return fail(GOVERNED_WAREHOUSE_REASONS.NAME_INVALID);
  if (!isNonEmptyString(input.location)) return fail(GOVERNED_WAREHOUSE_REASONS.LOCATION_INVALID);

  // Governed envelope.
  if (typeof input.status !== "string" || !(WAREHOUSE_STATUSES as readonly string[]).includes(input.status)) {
    return fail(GOVERNED_WAREHOUSE_REASONS.STATUS_INVALID);
  }
  if (!isGovernedVersion(input.version)) return fail(GOVERNED_WAREHOUSE_REASONS.VERSION_INVALID);
  if (!isServerTimestamp(input.updatedAt)) return fail(GOVERNED_WAREHOUSE_REASONS.UPDATED_AT_INVALID);
  if (!isNonEmptyString(input.updatedBy)) return fail(GOVERNED_WAREHOUSE_REASONS.UPDATED_BY_INVALID);
  if (typeof input.provenance !== "string" || !(WAREHOUSE_PROVENANCES as readonly string[]).includes(input.provenance)) {
    return fail(GOVERNED_WAREHOUSE_REASONS.PROVENANCE_INVALID);
  }

  // Provenance metadata pairs (§3A.1). Pair-shape failures are reported before the
  // provenance-coherence checks so a half/malformed pair never masquerades as a
  // provenance-model violation.
  const createdState = pairState(input, "createdAt", "createdBy");
  if (createdState === "incomplete") return fail(GOVERNED_WAREHOUSE_REASONS.CREATED_PAIR_INCOMPLETE);
  if (createdState === "invalid") return fail(GOVERNED_WAREHOUSE_REASONS.CREATED_METADATA_INVALID);

  const governanceState = pairState(input, "governanceInitializedAt", "governanceInitializedBy");
  if (governanceState === "incomplete") return fail(GOVERNED_WAREHOUSE_REASONS.GOVERNANCE_PAIR_INCOMPLETE);
  if (governanceState === "invalid") return fail(GOVERNED_WAREHOUSE_REASONS.GOVERNANCE_METADATA_INVALID);

  // Exactly one coherent provenance model (§3A.1).
  if (input.provenance === "NATIVE") {
    if (createdState !== "present-valid") return fail(GOVERNED_WAREHOUSE_REASONS.NATIVE_REQUIRES_CREATED);
    if (governanceState !== "absent") return fail(GOVERNED_WAREHOUSE_REASONS.NATIVE_FORBIDS_GOVERNANCE_INIT);
  } else {
    // MIGRATED: governance pair required; created pair is absent OR present-valid (both
    // already excluded above).
    if (governanceState !== "present-valid") return fail(GOVERNED_WAREHOUSE_REASONS.MIGRATED_REQUIRES_GOVERNANCE_INIT);
  }

  // Deterministic sanitized reconstruction: a fresh object in fixed key order carrying
  // exactly the governed fields present. Never mutates `input`; never echoes extra keys.
  const value: GovernedWarehouse = {
    id: input.id,
    name: input.name,
    location: input.location,
    status: input.status as GovernedWarehouse["status"],
    version: input.version,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
    provenance: input.provenance as GovernedWarehouse["provenance"],
  };
  if (createdState === "present-valid") {
    value.createdAt = input.createdAt as Timestamp;
    value.createdBy = input.createdBy as string;
  }
  if (governanceState === "present-valid") {
    value.governanceInitializedAt = input.governanceInitializedAt as Timestamp;
    value.governanceInitializedBy = input.governanceInitializedBy as string;
  }
  return { valid: true, value, reason: null };
}
