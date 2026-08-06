// Supplier Master (S2) -- the SHARED, PURE, DETERMINISTIC governed-Supplier validator/deserializer.
// Spec: docs/architecture/supplier-master-architecture.md (DECISIONS #78). It mirrors the §3A
// governed-warehouse validator's discipline (functions/src/warehouseGovernance/
// governedWarehouseValidation.ts): the ONE validator every later consumer (the S2 trusted writer,
// S3 read model, S4 migration/verifier) runs against the SAME bytes, so "governed Supplier" means
// exactly one thing. INERT in this gate -- nothing imports it at runtime yet.
//
// PURE: no Firebase app, no persistence, no clock, no I/O. NEVER throws for malformed stored data;
// returns a sanitized result whose `reason` is a bounded token that never echoes a raw stored value;
// never mutates input. Timestamps are the repository's real firebase-admin `Timestamp` (instanceof).
// Identity binding: the stored `id` must equal the `expectedSupplierId` (the document id read from).

import { Timestamp } from "firebase-admin/firestore";
import { isPlainObject, isNonEmptyString } from "../inventoryLedger/operationalMovementValidation.js";
import {
  SUPPLIER_STATUSES,
  SUPPLIER_ID_PATTERN,
  SUPPLIER_OPTIONAL_STRING_FIELDS,
  type GovernedSupplier,
  type GovernedSupplierValidationResult,
} from "./supplierMasterTypes.js";

// The ONLY keys a governed supplier record may carry. `active` is deliberately absent (its presence
// is a distinct, earlier-checked failure); any other key fails closed.
const ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  "id",
  "name",
  "normalizedKey",
  "status",
  "version",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  ...SUPPLIER_OPTIONAL_STRING_FIELDS,
]);

// Bounded governed failure reasons -- stable tokens (no raw values leak).
export const GOVERNED_SUPPLIER_REASONS = Object.freeze({
  EXPECTED_ID_INVALID: "expected_id_invalid",
  NOT_OBJECT: "not_object",
  ACTIVE_FORBIDDEN: "active_forbidden",
  UNKNOWN_FIELD: "unknown_field",
  ID_INVALID: "id_invalid",
  ID_PATTERN_INVALID: "id_pattern_invalid",
  ID_MISMATCH: "id_mismatch",
  NAME_INVALID: "name_invalid",
  NORMALIZED_KEY_INVALID: "normalized_key_invalid",
  STATUS_INVALID: "status_invalid",
  VERSION_INVALID: "version_invalid",
  CREATED_AT_INVALID: "created_at_invalid",
  CREATED_BY_INVALID: "created_by_invalid",
  UPDATED_AT_INVALID: "updated_at_invalid",
  UPDATED_BY_INVALID: "updated_by_invalid",
  OPTIONAL_FIELD_INVALID: "optional_field_invalid",
} as const);

function fail(reason: string): GovernedSupplierValidationResult {
  return { valid: false, value: null, reason };
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isGovernedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isServerTimestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp;
}

// Deterministic normalization used for dedup DETECTION (never an auto-merge key): lowercase, trim,
// collapse internal whitespace, strip characters that aren't alphanumerics or single spaces. Shared
// so the trusted writer and any dedup check compute the SAME key. Pure.
export function normalizeSupplierName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Validate/deserialize an untrusted stored value into a governed Supplier record, binding the stored
// `id` to `expectedSupplierId` (the document id read from). Sanitized result; never throws for data
// reasons; never mutates input.
export function validateGovernedSupplier(
  input: unknown,
  expectedSupplierId: unknown,
): GovernedSupplierValidationResult {
  if (!isNonEmptyString(expectedSupplierId)) return fail(GOVERNED_SUPPLIER_REASONS.EXPECTED_ID_INVALID);
  if (!isPlainObject(input)) return fail(GOVERNED_SUPPLIER_REASONS.NOT_OBJECT);

  // `active` is forbidden regardless of value; unknown keys fail closed.
  if (hasOwn(input, "active")) return fail(GOVERNED_SUPPLIER_REASONS.ACTIVE_FORBIDDEN);
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) return fail(GOVERNED_SUPPLIER_REASONS.UNKNOWN_FIELD);
  }

  // Identity + document-id binding.
  if (!isNonEmptyString(input.id)) return fail(GOVERNED_SUPPLIER_REASONS.ID_INVALID);
  if (!SUPPLIER_ID_PATTERN.test(input.id)) return fail(GOVERNED_SUPPLIER_REASONS.ID_PATTERN_INVALID);
  if (input.id !== expectedSupplierId) return fail(GOVERNED_SUPPLIER_REASONS.ID_MISMATCH);
  if (!isNonEmptyString(input.name)) return fail(GOVERNED_SUPPLIER_REASONS.NAME_INVALID);
  if (!isNonEmptyString(input.normalizedKey)) return fail(GOVERNED_SUPPLIER_REASONS.NORMALIZED_KEY_INVALID);

  // Governed envelope.
  if (typeof input.status !== "string" || !(SUPPLIER_STATUSES as readonly string[]).includes(input.status)) {
    return fail(GOVERNED_SUPPLIER_REASONS.STATUS_INVALID);
  }
  if (!isGovernedVersion(input.version)) return fail(GOVERNED_SUPPLIER_REASONS.VERSION_INVALID);
  if (!isServerTimestamp(input.createdAt)) return fail(GOVERNED_SUPPLIER_REASONS.CREATED_AT_INVALID);
  if (!isNonEmptyString(input.createdBy)) return fail(GOVERNED_SUPPLIER_REASONS.CREATED_BY_INVALID);
  if (!isServerTimestamp(input.updatedAt)) return fail(GOVERNED_SUPPLIER_REASONS.UPDATED_AT_INVALID);
  if (!isNonEmptyString(input.updatedBy)) return fail(GOVERNED_SUPPLIER_REASONS.UPDATED_BY_INVALID);

  // Optional business fields: when own-present, each must be a non-blank string.
  for (const field of SUPPLIER_OPTIONAL_STRING_FIELDS) {
    if (hasOwn(input, field) && !isNonEmptyString(input[field])) {
      return fail(GOVERNED_SUPPLIER_REASONS.OPTIONAL_FIELD_INVALID);
    }
  }

  // Rebuild from validated fields (no unknown key can ride along), preserving only present optionals.
  const value: GovernedSupplier = {
    id: input.id,
    name: input.name,
    normalizedKey: input.normalizedKey,
    status: input.status as GovernedSupplier["status"],
    version: input.version,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };
  for (const field of SUPPLIER_OPTIONAL_STRING_FIELDS) {
    if (hasOwn(input, field)) value[field] = input[field] as string;
  }
  return { valid: true, value, reason: null };
}
