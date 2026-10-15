"use strict";
// INV-1 Phase 1, PR 1.1 -- pure validators/parsers for the Part Master
// domain (ADR-008; Decision #40). Non-throwing structured Results; issues
// reported in deterministic field order. Zero persistence assumptions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNIT_DEFINITIONS = exports.parseManufacturerId = exports.parsePartId = void 0;
exports.parseInternalPartNumber = parseInternalPartNumber;
exports.validatePart = validatePart;
exports.validatePartAlias = validatePartAlias;
exports.validatePartRelationship = validatePartRelationship;
const types_1 = require("./types");
const normalization_1 = require("./normalization");
const units_1 = require("./units");
Object.defineProperty(exports, "UNIT_DEFINITIONS", { enumerable: true, get: function () { return units_1.UNIT_DEFINITIONS; } });
// Canonical equipment-model identity predicate — the SINGLE source of truth for the equipmentModelId format
// (reused, never re-stated), so a Part's equipment-model FK can only be a well-formed canonical id.
const equipmentModel_1 = require("../equipmentCompatibility/domain/equipmentModel");
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/; // opaque internal IDs (grandfathered skus like TST-1001 conform)
const MAX_NAME_LENGTH = 200;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function issue(path, code, message) {
    return { code, path, message };
}
function fail(errors) {
    return { valid: false, errors };
}
function parseInternalId(path, value) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return fail([issue(path, "REQUIRED", `${path} must be a non-empty string`)]);
    }
    const trimmed = value.trim();
    if (!ID_PATTERN.test(trimmed)) {
        return fail([issue(path, "INVALID_FORMAT", `${path} must match ${String(ID_PATTERN)}`)]);
    }
    return { valid: true, value: trimmed };
}
const parsePartId = (value) => parseInternalId("partId", value);
exports.parsePartId = parsePartId;
const parseManufacturerId = (value) => parseInternalId("manufacturerId", value);
exports.parseManufacturerId = parseManufacturerId;
/** internalPartNumber: human-readable, governed, normalized via INTERNAL_PN rules. */
function parseInternalPartNumber(value) {
    if (typeof value !== "string") {
        return fail([issue("internalPartNumber", "REQUIRED", "internalPartNumber must be a string")]);
    }
    const normalized = (0, normalization_1.normalizeIdentifier)("INTERNAL_PN", value);
    if (!normalized.valid)
        return normalized;
    return { valid: true, value: normalized.value };
}
function isEnum(list, value) {
    return typeof value === "string" && list.includes(value);
}
const DEFAULT_FLAGS = { expiryTracked: false, consumable: false, returnableCore: false };
function validatePart(input) {
    const errors = [];
    const partId = (0, exports.parsePartId)(input.partId);
    if (!partId.valid)
        errors.push(...partId.errors);
    const ipn = parseInternalPartNumber(input.internalPartNumber);
    if (!ipn.valid)
        errors.push(...ipn.errors);
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
        errors.push(issue("name", "REQUIRED", "name is required"));
    }
    else if (input.name.trim().length > MAX_NAME_LENGTH) {
        errors.push(issue("name", "OUT_OF_RANGE", `name exceeds ${MAX_NAME_LENGTH} characters`));
    }
    if (!isEnum(types_1.PART_STATUSES, input.status)) {
        errors.push(issue("status", "INVALID_ENUM", `status must be one of ${types_1.PART_STATUSES.join("/")}`));
    }
    if (!(0, units_1.isUnitCode)(input.stockingUnit)) {
        errors.push(issue("stockingUnit", "INVALID_ENUM", "stockingUnit must be a known unit code"));
    }
    if (!isEnum(types_1.CONTROL_TYPES, input.controlType)) {
        errors.push(issue("controlType", "INVALID_ENUM", `controlType must be one of ${types_1.CONTROL_TYPES.join("/")}`));
    }
    if (!isEnum(types_1.STOCKING_CLASSES, input.stockingClass)) {
        errors.push(issue("stockingClass", "INVALID_ENUM", `stockingClass must be one of ${types_1.STOCKING_CLASSES.join("/")}`));
    }
    let flags = DEFAULT_FLAGS;
    if (input.flags !== undefined) {
        const f = input.flags;
        if (f === null ||
            typeof f !== "object" ||
            typeof f.expiryTracked !== "boolean" ||
            typeof f.consumable !== "boolean" ||
            typeof f.returnableCore !== "boolean") {
            errors.push(issue("flags", "INVALID_FORMAT", "flags must be { expiryTracked, consumable, returnableCore } booleans"));
        }
        else {
            flags = { expiryTracked: f.expiryTracked, consumable: f.consumable, returnableCore: f.returnableCore };
        }
    }
    // Combination rules (spec §6; serial/lot behavior stays descriptive/inert):
    const controlType = input.controlType;
    const stockingClass = input.stockingClass;
    if (isEnum(types_1.CONTROL_TYPES, controlType) && isEnum(types_1.STOCKING_CLASSES, stockingClass)) {
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
    // Equipment-model link (Option A) — whole-unit guardrail + canonical FK. wholeUnit is the EXPLICIT
    // classification; equipmentModelId is never allowed to imply it.
    let wholeUnit = false;
    if (input.wholeUnit !== undefined) {
        if (typeof input.wholeUnit !== "boolean") {
            errors.push(issue("wholeUnit", "INVALID_FORMAT", "wholeUnit must be a boolean"));
        }
        else {
            wholeUnit = input.wholeUnit;
        }
    }
    let equipmentModelId;
    if (input.equipmentModelId !== undefined) {
        if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(input.equipmentModelId)) {
            errors.push(issue("equipmentModelId", "INVALID_FORMAT", "equipmentModelId must be a canonical equipment_models id"));
        }
        else {
            equipmentModelId = input.equipmentModelId;
        }
    }
    // Guardrail combinations: the FK is valid ONLY on a declared whole-unit Part; a whole-unit Part must be
    // serialized and is never a SERVICE part. (Never infer whole-unit from equipmentModelId — Owner §4.)
    if (equipmentModelId !== undefined && wholeUnit !== true) {
        errors.push(issue("equipmentModelId", "INVALID_COMBINATION", "equipmentModelId is valid only on a whole-unit Part (set wholeUnit=true)"));
    }
    if (wholeUnit === true) {
        if (controlType !== "SERIALIZED" && controlType !== "SERIALIZED_LOT") {
            errors.push(issue("wholeUnit", "INVALID_COMBINATION", "a whole-unit Part must be SERIALIZED or SERIALIZED_LOT"));
        }
        if (stockingClass === "SERVICE") {
            errors.push(issue("wholeUnit", "INVALID_COMBINATION", "a SERVICE part cannot be a whole-unit Part"));
        }
    }
    if (input.manufacturerPartNumber !== undefined && input.manufacturerId === undefined) {
        errors.push(issue("manufacturerId", "CONFLICTING_FIELDS", "manufacturerPartNumber requires manufacturerId"));
    }
    let manufacturerId;
    if (input.manufacturerId !== undefined) {
        const m = (0, exports.parseManufacturerId)(input.manufacturerId);
        if (!m.valid)
            errors.push(...m.errors);
        else
            manufacturerId = m.value;
    }
    if (errors.length > 0 || !partId.valid || !ipn.valid)
        return fail(errors);
    return {
        valid: true,
        value: {
            partId: partId.value,
            internalPartNumber: ipn.value,
            name: input.name.trim(),
            ...(typeof input.description === "string" ? { description: input.description } : {}),
            ...(typeof input.category === "string" ? { category: input.category } : {}),
            status: input.status,
            stockingUnit: input.stockingUnit,
            controlType,
            stockingClass,
            flags,
            ...(manufacturerId !== undefined ? { manufacturerId } : {}),
            ...(typeof input.manufacturerPartNumber === "string" ? { manufacturerPartNumber: input.manufacturerPartNumber } : {}),
            ...(isEnum(["OEM", "AFTERMARKET", "UNKNOWN"], input.oemStatus) ? { oemStatus: input.oemStatus } : {}),
            ...(wholeUnit ? { wholeUnit: true } : {}),
            ...(equipmentModelId !== undefined ? { equipmentModelId } : {}),
        },
    };
}
// ---------------------------------------------------------------------------
// Alias validation
// ---------------------------------------------------------------------------
function validatePartAlias(input) {
    const errors = [];
    if (!isEnum(types_1.ALIAS_TYPES, input.aliasType)) {
        return fail([issue("aliasType", "INVALID_ENUM", `aliasType must be one of ${types_1.ALIAS_TYPES.join("/")}`)]);
    }
    const partId = (0, exports.parsePartId)(input.partId);
    if (!partId.valid)
        errors.push(...partId.errors);
    let manufacturerId;
    if (input.manufacturerId !== undefined) {
        const m = (0, exports.parseManufacturerId)(input.manufacturerId);
        if (!m.valid)
            errors.push(...m.errors);
        else
            manufacturerId = m.value;
    }
    const normalized = (0, normalization_1.normalizeIdentifier)(input.aliasType, String(input.rawValue ?? ""), manufacturerId);
    if (!normalized.valid)
        errors.push(...normalized.errors);
    const status = input.status === undefined ? "ACTIVE" : input.status;
    if (!isEnum(types_1.ALIAS_STATUSES, status))
        errors.push(issue("status", "INVALID_ENUM", "status must be ACTIVE or INACTIVE"));
    for (const [path, v] of [["effectiveFrom", input.effectiveFrom], ["effectiveTo", input.effectiveTo]]) {
        if (v !== undefined && (typeof v !== "string" || !ISO_DATE_PATTERN.test(v))) {
            errors.push(issue(path, "INVALID_FORMAT", `${path} must be an ISO date (YYYY-MM-DD)`));
        }
    }
    if (typeof input.effectiveFrom === "string" &&
        typeof input.effectiveTo === "string" &&
        ISO_DATE_PATTERN.test(input.effectiveFrom) &&
        ISO_DATE_PATTERN.test(input.effectiveTo) &&
        input.effectiveFrom > input.effectiveTo) {
        errors.push(issue("effectiveTo", "INVALID_DATE_RANGE", "effectiveTo must not precede effectiveFrom"));
    }
    if (errors.length > 0 || !partId.valid || !normalized.valid)
        return fail(errors);
    return {
        valid: true,
        value: {
            aliasType: input.aliasType,
            rawValue: String(input.rawValue),
            normalizedValue: normalized.value,
            partId: partId.value,
            status: status,
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
function validatePartRelationship(input) {
    const errors = [];
    if (!isEnum(types_1.RELATIONSHIP_TYPES, input.relationshipType)) {
        return fail([issue("relationshipType", "INVALID_ENUM", `relationshipType must be one of ${types_1.RELATIONSHIP_TYPES.join("/")}`)]);
    }
    const from = (0, exports.parsePartId)(input.fromPartId);
    const to = (0, exports.parsePartId)(input.toPartId);
    if (!from.valid)
        errors.push(...from.errors.map((e) => ({ ...e, path: "fromPartId" })));
    if (!to.valid)
        errors.push(...to.errors.map((e) => ({ ...e, path: "toPartId" })));
    if (from.valid && to.valid && from.value === to.value) {
        errors.push(issue("toPartId", "INVALID_COMBINATION", "a part cannot relate to itself"));
    }
    if (typeof input.reasonCode !== "string" || input.reasonCode.trim().length === 0) {
        errors.push(issue("reasonCode", "REQUIRED", "reasonCode is required"));
    }
    if (typeof input.effectiveFrom === "string" &&
        typeof input.effectiveTo === "string" &&
        input.effectiveFrom > input.effectiveTo) {
        errors.push(issue("effectiveTo", "INVALID_DATE_RANGE", "effectiveTo must not precede effectiveFrom"));
    }
    const isKit = input.relationshipType === "KIT_COMPONENT";
    if (isKit) {
        if (!(0, units_1.isUnitCode)(input.componentUnit)) {
            errors.push(issue("componentUnit", "REQUIRED", "KIT_COMPONENT requires a componentUnit"));
        }
        else if (typeof input.componentQuantity !== "string") {
            errors.push(issue("componentQuantity", "REQUIRED", "KIT_COMPONENT requires a componentQuantity"));
        }
        else {
            const qty = (0, units_1.parseQuantity)(input.componentUnit, input.componentQuantity);
            if (!qty.valid)
                errors.push(...qty.errors.map((e) => ({ ...e, path: "componentQuantity" })));
            else if (qty.value.scaled <= 0n) {
                errors.push(issue("componentQuantity", "OUT_OF_RANGE", "component quantity must be positive"));
            }
        }
    }
    else if (input.componentQuantity !== undefined || input.componentUnit !== undefined) {
        errors.push(issue("componentQuantity", "CONFLICTING_FIELDS", "component fields are valid only for KIT_COMPONENT"));
    }
    if (errors.length > 0)
        return fail(errors);
    return {
        valid: true,
        value: {
            fromPartId: from.value,
            toPartId: to.value,
            relationshipType: input.relationshipType,
            status: input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
            reasonCode: input.reasonCode.trim(),
            ...(typeof input.effectiveFrom === "string" ? { effectiveFrom: input.effectiveFrom } : {}),
            ...(typeof input.effectiveTo === "string" ? { effectiveTo: input.effectiveTo } : {}),
            ...(isKit ? { componentQuantity: input.componentQuantity, componentUnit: input.componentUnit } : {}),
        },
    };
}
//# sourceMappingURL=validation.js.map