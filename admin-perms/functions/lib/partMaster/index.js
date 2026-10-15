"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePartRelationship = exports.validatePartAlias = exports.validatePart = exports.parseInternalPartNumber = exports.parseManufacturerId = exports.parsePartId = exports.convertQuantity = exports.validateConversionFactor = exports.parseQuantity = exports.isUnitCode = exports.UNIT_DEFINITIONS = exports.buildAliasKey = exports.validateGs1CheckDigit = exports.normalizeIdentifier = void 0;
// INV-1 Phase 1, PR 1.1 -- Part Master pure domain barrel. Stable surface
// only: types, enums, parsers, normalization, unit conversion, validators.
// No persistence adapters, no Firebase types, no callable/HTTP surface.
// NOTE: exporting here is NOT deployment -- nothing in this module is wired
// into functions/src/index.ts or any runtime path.
__exportStar(require("./types"), exports);
var normalization_1 = require("./normalization");
Object.defineProperty(exports, "normalizeIdentifier", { enumerable: true, get: function () { return normalization_1.normalizeIdentifier; } });
Object.defineProperty(exports, "validateGs1CheckDigit", { enumerable: true, get: function () { return normalization_1.validateGs1CheckDigit; } });
Object.defineProperty(exports, "buildAliasKey", { enumerable: true, get: function () { return normalization_1.buildAliasKey; } });
var units_1 = require("./units");
Object.defineProperty(exports, "UNIT_DEFINITIONS", { enumerable: true, get: function () { return units_1.UNIT_DEFINITIONS; } });
Object.defineProperty(exports, "isUnitCode", { enumerable: true, get: function () { return units_1.isUnitCode; } });
Object.defineProperty(exports, "parseQuantity", { enumerable: true, get: function () { return units_1.parseQuantity; } });
Object.defineProperty(exports, "validateConversionFactor", { enumerable: true, get: function () { return units_1.validateConversionFactor; } });
Object.defineProperty(exports, "convertQuantity", { enumerable: true, get: function () { return units_1.convertQuantity; } });
var validation_1 = require("./validation");
Object.defineProperty(exports, "parsePartId", { enumerable: true, get: function () { return validation_1.parsePartId; } });
Object.defineProperty(exports, "parseManufacturerId", { enumerable: true, get: function () { return validation_1.parseManufacturerId; } });
Object.defineProperty(exports, "parseInternalPartNumber", { enumerable: true, get: function () { return validation_1.parseInternalPartNumber; } });
Object.defineProperty(exports, "validatePart", { enumerable: true, get: function () { return validation_1.validatePart; } });
Object.defineProperty(exports, "validatePartAlias", { enumerable: true, get: function () { return validation_1.validatePartAlias; } });
Object.defineProperty(exports, "validatePartRelationship", { enumerable: true, get: function () { return validation_1.validatePartRelationship; } });
//# sourceMappingURL=index.js.map