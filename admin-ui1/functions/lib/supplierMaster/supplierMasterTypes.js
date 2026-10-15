"use strict";
// Supplier Master (S2) -- shared types for the governed Supplier business object.
// Spec: docs/architecture/supplier-master-architecture.md (DECISIONS #78). Supplier is a
// catalog-governed reference object (like Part/Manufacturer); it OWNS the supplierId space that
// the governed part_supplier_items authority already references. `status` is the authority; a
// legacy `active` field is FORBIDDEN on a governed record (same discipline as governed warehouses).
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPLIER_OPTIONAL_STRING_FIELDS = exports.SUPPLIER_ID_PATTERN = exports.SUPPLIER_STATUSES = void 0;
exports.SUPPLIER_STATUSES = ["ACTIVE", "INACTIVE"];
// supplierId conforms to the internal governed id pattern already used by part_supplier_items
// (functions/src/partMaster/partSupplierItems.ts SUPPLIER_ID_PATTERN) -- storage-safe by
// construction and tenant-prefixable.
exports.SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Optional business fields the current business needs. Each, when present, must be a non-blank
// string (no speculative ERP structure). paymentTermsRef is a label/reference, not a terms engine.
exports.SUPPLIER_OPTIONAL_STRING_FIELDS = [
    "vendorNumber",
    "contactName",
    "phone",
    "email",
    "address",
    "paymentTermsRef",
    "notes",
];
//# sourceMappingURL=supplierMasterTypes.js.map