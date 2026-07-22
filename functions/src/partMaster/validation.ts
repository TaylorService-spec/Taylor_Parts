// INV-1 Phase 1, PR 1.1 -- pure validators/parsers for the Part Master
// domain (ADR-008; Decision #40). Non-throwing structured Results; issues
// reported in deterministic field order. Zero persistence assumptions.

import { ALIAS_STATUSES, ALIAS_TYPES, CONTROL_TYPES, PART_STATUSES, RELATIONSHIP_TYPES, STOCKING_CLASSES } from "./types";
import type {
  AliasType,
  ControlType,
  InternalPartNumber,
  ManufacturerId,
  Part,
  PartAlias,
  PartFlags,
  PartId,
  PartRelationship,
  PartStatus,
  Result,
  StockingClass,
  ValidationIssue,
} from "./types";
import { normalizeIdentifier } from "./normalization";
import { isUnitCode, parseQuantity, UNIT_DEFINITIONS } from "./units";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/; // opaque internal IDs (grandfathered skus like TST-1001 conform)
const MAX_NAME_LENGTH = 200;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function issue(path: string, code: ValidationIssue["code"], message: string): ValidationIssue {
  return { code, path, message };
}
function fail<T>(errors: ValidationIssue[]): Result<T> {
  return { valid: false, errors };
}

function parseInternalId<T extends string>(path: string, value: unknown): Result<T> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail([issue(path, "REQUIRED", `${path} must be a non-empty string`)]);
  }
  const trimmed = value.trim();
  if (!ID_PATTERN.test(trimmed)) {
    return fail([issue(path, "INVALID_FORMAT", `${path} must match ${String(ID_PATTERN)}`)]);
  }
  return { valid: true, value: trimmed as T };
}

export const parsePartId = (value: unknown): Result<PartId> => parseInternalId<PartId>("partId", value);
export const parseManufacturerId = (value: unknown): Result<ManufacturerId> => parseInternalId<ManufacturerId>("manufacturerId", value);

/** internalPartNumber: human-readable, governed, normalized via INTERNAL_PN rules. */
export function parseInternalPartNumber(value: unknown): Result<InternalPartNumber> {
  if (typeof value !== "string") {
    return fail([issue("internalPartNumber", "REQUIRED", "internalPartNumber must be a string")]);
  }
  const normalized = normalizeIdentifier("INTERNAL_PN", value);
  if (!normalized.valid) return normalized;
  return { valid: true, value: normalized.value as InternalPartNumber };
}

function isEnum<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Part validation (descriptive authority only -- see types.ts header)
// ---------------------------------------------------------------------------
export interface PartInput {
  readonly partId: unknown;
  readonly internalPartNumber: unknown;
  readonly name: unknown;
  readonly description?: unknown;
  readonly category?: unknown;
  readonly status: unknown;
  readonly stockingUnit: unknown;
  readonly controlType: unknown;
  readonly stockingClass: unknown;
  readonly flags?: unknown;
  readonly manufacturerId?: unknown;
  readonly manufacturerPartNumber?: unknown;
  readonly oemStatus?: unknown;
}

const DEFAULT_FLAGS: PartFlags = { expiryTracked: false, consumable: false, returnableCore: false };

export function validatePart(input: PartInput): Result<Part> {
  const errors: ValidationIssue[] = [];

  const partId = parsePartId(input.partId);
  if (!partId.valid) errors.push(...partId.errors);
  const ipn = parseInternalPartNumber(input.internalPartNumber);
  if (!ipn.valid) errors.push(...ipn.errors);

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    errors.push(issue("name", "REQUIRED", "name is required"));
  } else if (input.name.trim().length > MAX_NAME_LENGTH) {
    errors.push(issue("name", "OUT_OF_RANGE", `name exceeds ${MAX_NAME_LENGTH} characters`));
  }
  if (!isEnum(PART_STATUSES, input.status)) {
    errors.push(issue("status", "INVALID_ENUM", `status must be one of ${PART_STATUSES.join("/")}`));
  }
  if (!isUnitCode(input.stockingUnit)) {
    errors.push(issue("stockingUnit", "INVALID_ENUM", "stockingUnit must be a known unit code"));
  }
  if (!isEnum(CONTROL_TYPES, input.controlType)) {
    errors.push(issue("controlType", "INVALID_ENUM", `controlType must be one of ${CONTROL_TYPES.join("/")}`));
  }
  if (!isEnum(STOCKING_CLASSES, input.stockingClass)) {
    errors.push(issue("stockingClass", "INVALID_ENUM", `stockingClass must be one of ${STOCKING_CLASSES.join("/")}`));
  }

  let flags: PartFlags = DEFAULT_FLAGS;
  if (input.flags !== undefined) {
    const f = input.flags as Record<string, unknown>;
    if (
      f === null ||
      typeof f !== "object" ||
      typeof f.expiryTracked !== "boolean" ||
      typeof f.consumable !== "boolean" ||
      typeof f.returnableCore !== "boolean"
    ) {
      errors.push(issue("flags", "INVALID_FORMAT", "flags must be { expiryTracked, consumable, returnableCore } booleans"));
    } else {
      flags = { expiryTracked: f.expiryTracked, consumable: f.consumable, returnableCore: f.returnableCore };
    }
  }

  // Combination rules (spec §6; serial/lot behavior stays descriptive/inert):
  const controlType = input.controlType as ControlType;
  const stockingClass = input.stockingClass as StockingClass;
  if (isEnum(CONTROL_TYPES, controlType) && isEnum(STOCKING_CLASSES, stockingClass)) {
    if (flags.expiryTracked && controlType !== "LOT" && controlType !== "SERIALIZED_LOT") {
      errors.push(issue("flags.expiryTracked", "INVALID_COMBINATION", "expiry tracking requires LOT or SERIALIZED_LOT control"));
    }
    if (stockingClass === "SERVICE" && controlType !== "STANDARD") {
      errors.push(issue("stockingClass", "INVALID_COMBINATION", "SERVICE items carry no inventory control beyond STANDARD"));
    }
    if (stockingClass !== "STOCKED" && (flags.consumable || flags.returnableCore)) {
      errors.push(issue("flags", "INVALID_COMBINATION", "consumable/returnableCore apply only to STOCKED parts"));
    }
  }

  if (input.manufacturerPartNumber !== undefined && input.manufacturerId === undefined) {
    errors.push(issue("manufacturerId", "CONFLICTING_FIELDS", "manufacturerPartNumber requires manufacturerId"));
  }
  let manufacturerId: ManufacturerId | undefined;
  if (input.manufacturerId !== undefined) {
    const m = parseManufacturerId(input.manufacturerId);
    if (!m.valid) errors.push(...m.errors);
    else manufacturerId = m.value;
  }

  if (errors.length > 0 || !partId.valid || !ipn.valid) return fail(errors);
  return {
    valid: true,
    value: {
      partId: partId.value,
      internalPartNumber: ipn.value,
      name: (input.name as string).trim(),
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(typeof input.category === "string" ? { category: input.category } : {}),
      status: input.status as PartStatus,
      stockingUnit: input.stockingUnit as Part["stockingUnit"],
      controlType,
      stockingClass,
      flags,
      ...(manufacturerId !== undefined ? { manufacturerId } : {}),
      ...(typeof input.manufacturerPartNumber === "string" ? { manufacturerPartNumber: input.manufacturerPartNumber } : {}),
      ...(isEnum(["OEM", "AFTERMARKET", "UNKNOWN"] as const, input.oemStatus) ? { oemStatus: input.oemStatus } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Alias validation
// ---------------------------------------------------------------------------
export function validatePartAlias(input: {
  readonly aliasType: unknown;
  readonly rawValue: unknown;
  readonly partId: unknown;
  readonly status?: unknown;
  readonly source?: unknown;
  readonly manufacturerId?: unknown;
  readonly effectiveFrom?: unknown;
  readonly effectiveTo?: unknown;
}): Result<PartAlias> {
  const errors: ValidationIssue[] = [];
  if (!isEnum(ALIAS_TYPES, input.aliasType)) {
    return fail([issue("aliasType", "INVALID_ENUM", `aliasType must be one of ${ALIAS_TYPES.join("/")}`)]);
  }
  const partId = parsePartId(input.partId);
  if (!partId.valid) errors.push(...partId.errors);

  let manufacturerId: ManufacturerId | undefined;
  if (input.manufacturerId !== undefined) {
    const m = parseManufacturerId(input.manufacturerId);
    if (!m.valid) errors.push(...m.errors);
    else manufacturerId = m.value;
  }
  const normalized = normalizeIdentifier(input.aliasType as AliasType, String(input.rawValue ?? ""), manufacturerId);
  if (!normalized.valid) errors.push(...normalized.errors);

  const status = input.status === undefined ? "ACTIVE" : input.status;
  if (!isEnum(ALIAS_STATUSES, status)) errors.push(issue("status", "INVALID_ENUM", "status must be ACTIVE or INACTIVE"));

  for (const [path, v] of [["effectiveFrom", input.effectiveFrom], ["effectiveTo", input.effectiveTo]] as const) {
    if (v !== undefined && (typeof v !== "string" || !ISO_DATE_PATTERN.test(v))) {
      errors.push(issue(path, "INVALID_FORMAT", `${path} must be an ISO date (YYYY-MM-DD)`));
    }
  }
  if (
    typeof input.effectiveFrom === "string" &&
    typeof input.effectiveTo === "string" &&
    ISO_DATE_PATTERN.test(input.effectiveFrom) &&
    ISO_DATE_PATTERN.test(input.effectiveTo) &&
    input.effectiveFrom > input.effectiveTo
  ) {
    errors.push(issue("effectiveTo", "INVALID_DATE_RANGE", "effectiveTo must not precede effectiveFrom"));
  }

  if (errors.length > 0 || !partId.valid || !normalized.valid) return fail(errors);
  return {
    valid: true,
    value: {
      aliasType: input.aliasType as AliasType,
      rawValue: String(input.rawValue),
      normalizedValue: normalized.value,
      partId: partId.value,
      status: status as PartAlias["status"],
      source: typeof input.source === "string" && input.source.length > 0 ? input.source : "manual",
      ...(manufacturerId !== undefined ? { manufacturerId } : {}),
      ...(typeof input.effectiveFrom === "string" ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(typeof input.effectiveTo === "string" ? { effectiveTo: input.effectiveTo } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Relationship validation (SUPERSEDED_BY / SUBSTITUTE / KIT_COMPONENT)
// ---------------------------------------------------------------------------
export function validatePartRelationship(input: {
  readonly fromPartId: unknown;
  readonly toPartId: unknown;
  readonly relationshipType: unknown;
  readonly status?: unknown;
  readonly reasonCode: unknown;
  readonly effectiveFrom?: unknown;
  readonly effectiveTo?: unknown;
  readonly componentQuantity?: unknown;
  readonly componentUnit?: unknown;
}): Result<PartRelationship> {
  const errors: ValidationIssue[] = [];
  if (!isEnum(RELATIONSHIP_TYPES, input.relationshipType)) {
    return fail([issue("relationshipType", "INVALID_ENUM", `relationshipType must be one of ${RELATIONSHIP_TYPES.join("/")}`)]);
  }
  const from = parsePartId(input.fromPartId);
  const to = parsePartId(input.toPartId);
  if (!from.valid) errors.push(...from.errors.map((e) => ({ ...e, path: "fromPartId" })));
  if (!to.valid) errors.push(...to.errors.map((e) => ({ ...e, path: "toPartId" })));
  if (from.valid && to.valid && from.value === to.value) {
    errors.push(issue("toPartId", "INVALID_COMBINATION", "a part cannot relate to itself"));
  }
  if (typeof input.reasonCode !== "string" || input.reasonCode.trim().length === 0) {
    errors.push(issue("reasonCode", "REQUIRED", "reasonCode is required"));
  }
  if (
    typeof input.effectiveFrom === "string" &&
    typeof input.effectiveTo === "string" &&
    input.effectiveFrom > input.effectiveTo
  ) {
    errors.push(issue("effectiveTo", "INVALID_DATE_RANGE", "effectiveTo must not precede effectiveFrom"));
  }

  const isKit = input.relationshipType === "KIT_COMPONENT";
  if (isKit) {
    if (!isUnitCode(input.componentUnit)) {
      errors.push(issue("componentUnit", "REQUIRED", "KIT_COMPONENT requires a componentUnit"));
    } else if (typeof input.componentQuantity !== "string") {
      errors.push(issue("componentQuantity", "REQUIRED", "KIT_COMPONENT requires a componentQuantity"));
    } else {
      const qty = parseQuantity(input.componentUnit, input.componentQuantity);
      if (!qty.valid) errors.push(...qty.errors.map((e) => ({ ...e, path: "componentQuantity" })));
      else if (qty.value.scaled <= 0n) {
        errors.push(issue("componentQuantity", "OUT_OF_RANGE", "component quantity must be positive"));
      }
    }
  } else if (input.componentQuantity !== undefined || input.componentUnit !== undefined) {
    errors.push(issue("componentQuantity", "CONFLICTING_FIELDS", "component fields are valid only for KIT_COMPONENT"));
  }

  if (errors.length > 0) return fail(errors);
  return {
    valid: true,
    value: {
      fromPartId: (from as { value: PartId }).value,
      toPartId: (to as { value: PartId }).value,
      relationshipType: input.relationshipType as PartRelationship["relationshipType"],
      status: input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      reasonCode: (input.reasonCode as string).trim(),
      ...(typeof input.effectiveFrom === "string" ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(typeof input.effectiveTo === "string" ? { effectiveTo: input.effectiveTo } : {}),
      ...(isKit ? { componentQuantity: input.componentQuantity as string, componentUnit: input.componentUnit as PartRelationship["componentUnit"] } : {}),
    },
  };
}

export { UNIT_DEFINITIONS };
