"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRM_ACTIVITY_TYPES = void 0;
exports.isCrmActivityType = isCrmActivityType;
exports.CRM_ACTIVITY_TYPES = ["SALES_NOTE", "CALL", "MEETING", "RELATIONSHIP", "GENERAL"];
function isCrmActivityType(value) {
    return typeof value === "string" && exports.CRM_ACTIVITY_TYPES.includes(value);
}
//# sourceMappingURL=crmActivityTypes.js.map