"use strict";
// Issue #325 / ADR-007 D-FN -- server-side TypeScript PORT of the
// Customer Reporting lane's governed report catalog
// (field-ops-app-vite/src/domain/reporting/reportCatalog.js, unit F1).
//
// Not a byte-mirror (client is plain JS, this is TypeScript with an
// added `collection` accessor used only server-side) -- but every
// objectId/fieldId/readCapability/collection/dataType/operators/
// sensitivity value below is REQUIRED to match the client catalog
// exactly (functions/test/reportCatalogParity.test.mjs proves this by
// importing the client's actual .js file via a relative path and
// diffing the two structurally -- no shared/monorepo tooling exists in
// this repo, so this is the established "duplicate and prove parity"
// convention, same as every access/ mirror pair, applied here
// unidirectionally: the server needs its own copy of what the client
// (Customer's lane) already owns and ships).
//
// PURE data + accessors. No firebase-admin import, no read path, no
// authorization decision -- this file only says what a field/object/
// relationship IS, never whether a given runner may see it (that is
// reportExecutionService.ts, calling functions/src/access/
// resolveEffectivePermission.ts for the readCapability declared here).
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPORT_RELATIONSHIPS = exports.REPORT_FIELDS = exports.REPORT_OBJECTS = void 0;
exports.getReportObject = getReportObject;
exports.getReportField = getReportField;
exports.relationshipsFrom = relationshipsFrom;
exports.objectsWithPopulatedFields = objectsWithPopulatedFields;
function obj(objectId, label, collection, activationWave, fieldsPopulated, extra = {}) {
    return Object.freeze({
        objectId,
        label,
        collection,
        activationWave,
        objectReadCapability: `report.${objectId}.read`,
        fieldsPopulated,
        ...extra,
    });
}
exports.REPORT_OBJECTS = Object.freeze([
    obj("customer", "Customer", "accounts", 1, true),
    obj("contact", "Contact", "contacts", 1, true),
    obj("location", "Location", "locations", 1, true),
    obj("equipment", "Equipment", "equipment", 1, true),
    obj("job", "Job", "fieldops_jobs", 2, false),
    obj("workOrder", "Work Order", "fieldops_wos", 2, false),
    obj("technician", "Technician", "fieldops_technicians", 2, false),
    obj("serviceHistory", "Service History", null, 2, false, { derivedFrom: "fieldops_wos" }),
    obj("reorderRequest", "Reorder Request", "reorder_requests", 3, false),
    obj("purchaseOrder", "Purchase Order", "reorder_purchase_orders", 3, false),
    obj("inventoryAction", "Inventory Action", "inventory_actions", 3, false),
    obj("employee", "Employee", "employees", 4, false),
]);
function f(objectId, field, label, dataType, operators, sensitivity, capabilityGroup, extra = {}) {
    return Object.freeze({
        fieldId: `${objectId}.${field}`,
        objectId,
        label,
        dataType,
        sensitivity,
        operators: Object.freeze([...operators]),
        readCapability: `report.${objectId}.field.${capabilityGroup}.read`,
        ...extra,
    });
}
const CUSTOMER_FIELDS = [
    f("customer", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
    f("customer", "status", "Status", "enum", ["filter", "group"], "standard", "status"),
    f("customer", "relationshipTypes", "Relationship types", "list", ["filter", "group"], "standard", "relationshipTypes"),
    f("customer", "billingAddress.street", "Billing street", "string", ["filter", "sort"], "standard", "billingAddress"),
    f("customer", "billingAddress.city", "Billing city", "string", ["filter", "sort", "group"], "standard", "billingAddress"),
    f("customer", "billingAddress.state", "Billing state", "string", ["filter", "sort", "group"], "standard", "billingAddress"),
    f("customer", "billingAddress.zip", "Billing ZIP", "string", ["filter", "sort", "group"], "standard", "billingAddress"),
    f("customer", "tags", "Tags", "list", ["filter", "group"], "standard", "tags"),
    f("customer", "customerNumber", "Customer #", "string", ["filter", "sort"], "standard", "externalIds"),
    f("customer", "erpId", "ERP ID", "string", ["filter"], "standard", "externalIds"),
    f("customer", "accountingId", "Accounting ID", "string", ["filter"], "standard", "externalIds"),
    f("customer", "legacyId", "Legacy ID", "string", ["filter"], "standard", "externalIds"),
    f("customer", "notes", "Notes", "string", [], "security-text", "notes"),
    f("customer", "createdAt", "Created", "date", ["filter", "sort", "group"], "standard", "createdAt"),
    f("customer", "paymentTerms", "Payment terms", "enum", ["filter", "group"], "governed", "paymentTerms"),
    f("customer", "taxStatus", "Tax status", "enum", ["filter", "group"], "governed", "taxStatus"),
    f("customer", "defaultCurrency", "Default currency", "string", ["filter", "group"], "commercial", "commercialProfile"),
    f("customer", "purchaseOrderRequired", "PO required", "boolean", ["filter", "group"], "commercial", "commercialProfile"),
    f("customer", "invoiceDeliveryMethod", "Invoice delivery", "enum", ["filter", "group"], "commercial", "commercialProfile"),
    f("customer", "billingContact", "Billing contact", "reference", ["filter"], "standard", "billingContact", { referenceTo: "contact" }),
    f("customer", "accountOwner", "Account owner", "reference", ["filter", "group"], "employee", "accountOwner", { referenceTo: "employee" }),
];
const CONTACT_FIELDS = [
    f("contact", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
    f("contact", "email", "Email", "string", ["filter", "sort"], "standard", "email"),
    f("contact", "phone", "Phone", "string", ["filter"], "standard", "phone"),
    f("contact", "role", "Role", "string", ["filter", "group"], "standard", "role"),
    f("contact", "accountId", "Customer", "reference", ["filter", "group"], "standard", "customer", { referenceTo: "customer" }),
];
const LOCATION_FIELDS = [
    f("location", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
    f("location", "address.street", "Street", "string", ["filter", "sort", "group"], "standard", "address"),
    f("location", "address.city", "City", "string", ["filter", "sort", "group"], "standard", "address"),
    f("location", "address.state", "State", "string", ["filter", "sort", "group"], "standard", "address"),
    f("location", "address.zip", "ZIP", "string", ["filter", "sort", "group"], "standard", "address"),
    f("location", "accessNotes", "Access notes", "string", [], "security-text", "accessNotes"),
    f("location", "accountId", "Customer", "reference", ["filter", "group"], "standard", "customer", { referenceTo: "customer" }),
];
const EQUIPMENT_FIELDS = [
    f("equipment", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
    f("equipment", "status", "Status", "enum", ["filter", "group"], "standard", "status"),
    f("equipment", "manufacturer", "Manufacturer", "string", ["filter", "sort", "group"], "standard", "identity"),
    f("equipment", "model", "Model", "string", ["filter", "sort", "group"], "standard", "identity"),
    f("equipment", "serialNumber", "Serial number", "string", ["filter", "sort", "group"], "standard", "identity"),
    f("equipment", "assetTag", "Asset tag", "string", ["filter", "sort", "group"], "standard", "identity"),
    f("equipment", "installedDate", "Installed", "date", ["filter", "sort", "group"], "standard", "dates"),
    f("equipment", "warrantyExpiresDate", "Warranty expires", "date", ["filter", "sort", "group"], "standard", "dates"),
    f("equipment", "notes", "Notes", "string", [], "standard", "notes"),
    f("equipment", "accountId", "Customer", "reference", ["filter", "group"], "standard", "customer", { referenceTo: "customer" }),
    f("equipment", "locationId", "Location", "reference", ["filter", "group"], "standard", "location", { referenceTo: "location" }),
    f("equipment", "createdAt", "Created", "date", ["filter", "sort", "group"], "standard", "createdAt"),
];
exports.REPORT_FIELDS = Object.freeze([
    ...CUSTOMER_FIELDS,
    ...CONTACT_FIELDS,
    ...LOCATION_FIELDS,
    ...EQUIPMENT_FIELDS,
]);
function rel(fromObjectId, toObjectId, viaField, cardinality) {
    const viaFieldId = `${fromObjectId}.${viaField}`;
    return Object.freeze({
        relationshipId: `${fromObjectId}->${toObjectId}`,
        fromObjectId,
        toObjectId,
        viaField: viaFieldId,
        cardinality,
        traversalCapability: exports.REPORT_FIELDS.find((x) => x.fieldId === viaFieldId)?.readCapability ?? null,
        hop: 1,
    });
}
exports.REPORT_RELATIONSHIPS = Object.freeze([
    rel("equipment", "location", "locationId", "one"),
    rel("equipment", "customer", "accountId", "one"),
    rel("contact", "customer", "accountId", "one"),
    rel("location", "customer", "accountId", "one"),
    rel("customer", "contact", "billingContact", "one"),
    rel("customer", "employee", "accountOwner", "one"),
]);
function getReportObject(objectId) {
    return exports.REPORT_OBJECTS.find((o) => o.objectId === objectId) ?? null;
}
function getReportField(fieldId) {
    return exports.REPORT_FIELDS.find((x) => x.fieldId === fieldId) ?? null;
}
function relationshipsFrom(objectId) {
    return exports.REPORT_RELATIONSHIPS.filter((r) => r.fromObjectId === objectId);
}
function objectsWithPopulatedFields() {
    return exports.REPORT_OBJECTS.filter((o) => o.fieldsPopulated);
}
//# sourceMappingURL=reportCatalog.js.map