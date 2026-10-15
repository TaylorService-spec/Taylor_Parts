"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTruckId = parseTruckId;
exports.parseLocationId = parseLocationId;
exports.parseWarehouseId = parseWarehouseId;
exports.parseEmployeeId = parseEmployeeId;
exports.isTruckStatus = isTruckStatus;
exports.isReactivationStatus = isReactivationStatus;
exports.validateCreateInput = validateCreateInput;
// EI Truck Registry -- functions-side pure validation of write INPUT. Mirrors the frontend
// pure contract field-ops-app-vite/src/domain/truckRegistry.js (per-record shape + the 1:1
// link), kept as an independent functions-side authority (same split as partMaster's
// validation.ts vs the app's domain). No firebase, no reads, never throws; returns
// { valid, value } | { valid:false, errors }.
const types_1 = require("./types");
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
// Identifiers: non-empty, trimmed, bounded, no whitespace-only or control chars. Deliberately
// permissive on charset (ids are opaque business/inventory keys), but strict on emptiness and
// a sane length ceiling so a malformed id can never become a document key.
const ID_MAX = 200;
const LABEL_MAX = 300;
const isId = (v) => isNonEmptyString(v) && v.length <= ID_MAX && v === v.trim();
// The governed read contract (domain/truckRegistry.js) REQUIRES a non-empty displayLabel on
// both records and a non-empty vehicleNumber on the truck -- composeTruckFleet drops any record
// missing them. So the write path requires them too (Codex PR #512 P2).
const isRequiredLabel = (v) => isNonEmptyString(v) && v.length <= LABEL_MAX;
function parseTruckId(v) {
    return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "truckId", code: "invalid" }] };
}
function parseLocationId(v) {
    return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "locationId", code: "invalid" }] };
}
function parseWarehouseId(v) {
    return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "homeWarehouseId", code: "invalid" }] };
}
function parseEmployeeId(v) {
    return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "employeeId", code: "invalid" }] };
}
function isTruckStatus(v) {
    return typeof v === "string" && types_1.TRUCK_STATUSES.includes(v);
}
function isReactivationStatus(v) {
    return typeof v === "string" && types_1.REACTIVATION_STATUSES.includes(v);
}
function validateCreateInput(raw) {
    const errors = [];
    const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const truckId = data.truckId;
    const locationId = data.locationId;
    const homeWarehouseId = data.homeWarehouseId;
    if (!isId(truckId))
        errors.push({ path: "truckId", code: "invalid" });
    if (!isId(locationId))
        errors.push({ path: "locationId", code: "invalid" });
    if (!isId(homeWarehouseId))
        errors.push({ path: "homeWarehouseId", code: "invalid" });
    const status = data.status === undefined ? "ACTIVE" : data.status;
    if (!isTruckStatus(status))
        errors.push({ path: "status", code: "invalid" });
    let assignedDriverEmployeeId = null;
    if (data.assignedDriverEmployeeId !== undefined && data.assignedDriverEmployeeId !== null) {
        if (!isId(data.assignedDriverEmployeeId))
            errors.push({ path: "assignedDriverEmployeeId", code: "invalid" });
        else
            assignedDriverEmployeeId = data.assignedDriverEmployeeId;
    }
    // displayLabel and vehicleNumber are REQUIRED, non-empty (the read contract drops records
    // without them). displayLabel is written to BOTH the truck and its MOBILE Location.
    if (!isRequiredLabel(data.displayLabel))
        errors.push({ path: "displayLabel", code: "invalid" });
    if (!isRequiredLabel(data.vehicleNumber))
        errors.push({ path: "vehicleNumber", code: "invalid" });
    if (errors.length > 0)
        return { valid: false, errors };
    const displayLabel = data.displayLabel;
    const vehicleNumber = data.vehicleNumber;
    return {
        valid: true,
        value: {
            location: { locationId: locationId, type: "MOBILE", displayLabel },
            truck: {
                truckId: truckId,
                locationId: locationId,
                homeWarehouseId: homeWarehouseId,
                status: status,
                assignedDriverEmployeeId,
                displayLabel,
                vehicleNumber,
            },
        },
    };
}
//# sourceMappingURL=validation.js.map