// INV-1 Phase 1, PR 1.1 -- Part Master pure domain barrel. Stable surface
// only: types, enums, parsers, normalization, unit conversion, validators.
// No persistence adapters, no Firebase types, no callable/HTTP surface.
// NOTE: exporting here is NOT deployment -- nothing in this module is wired
// into functions/src/index.ts or any runtime path.
export * from "./types";
export { normalizeIdentifier, validateGs1CheckDigit, buildAliasKey } from "./normalization";
export { UNIT_DEFINITIONS, isUnitCode, parseQuantity, validateConversionFactor, convertQuantity } from "./units";
export {
  parsePartId,
  parseManufacturerId,
  parseInternalPartNumber,
  validatePart,
  validatePartAlias,
  validatePartRelationship,
} from "./validation";
export type { PartInput } from "./validation";
