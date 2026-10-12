import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// Supplier Catalog Item = PART SUPPLIER TERMS: the procurement terms ONE Supplier offers for ONE Part, in PostgreSQL
// (eos_ops.supplier_catalog_items, migration 1758499200000), maintained by the governed command layer
// functions/src/eosOps/partSupplierTerms.ts on /operations/inventory (listPartSupplierItems, createPartSupplierItem,
// updatePartSupplierItem, setPartSupplierItemStatus, setPreferredPartSupplierItem) and rendered by Part Detail's
// "Suppliers & Terms" section.
//
// REALIGNED (SUP-1 governed field groups, 2026-10-11). This definition used to describe the Epic 5 Firestore
// `supplier_catalog` listing ({ id, supplierId, partId, unitPrice, available }) -- a write-dormant demo collection whose
// last reader (Operations.jsx's ProcurementPanel) is Firebase-retirement inventory, not a governed Object. The Object key
// `supplierCatalogItem` is the one Administration governs, and the capabilities registered on it (inventory.catalog.cost.*,
// migration 1764530000000) govern THIS table's fields, so the field list is now the table's columns -- the record
// Administration's Objects / FieldTable describes is the record those capabilities actually protect.
//
// GOVERNED FIELD GROUPS. cost, currency, contractStart and contractEnd are the COMMERCIAL group: sensitivity
// CONFIDENTIAL, read only with inventory.catalog.read + inventory.catalog.cost.read, set with .cost.create, changed with
// .cost.edit (functions/src/eosOps/governedFieldGroups.ts evaluates them; the server withholds them from every response a
// caller cannot read). Everything else is governed by the record gates: inventory.catalog.manage (read / create / edit /
// preferred) and inventory.catalog.activate (status).
//
// IDENTITY. The key is (partId, supplierId) -- a composed fact across two references, never a name; SYSTEM_ONLY, declared
// explicitly. NO operating-company field: the table carries none, so operating-company isolation is not supported for this
// Object; tenant isolation is the boundary.
//
// No list view and no index list: the only read is one Part's terms (a bounded per-Part read), not a filterable list.
const COMMERCIAL = "CONFIDENTIAL";

export const supplierCatalogItemEntity = makeEntityDefinition({
  id: "supplierCatalogItem",
  label: "Supplier Catalog Item",
  labelPlural: "Supplier Catalog Items",
  collection: "supplier_catalog_items",
  readVia: "EOS_API",
  readCapability: "inventory.catalog.manage",
  identity: makeIdentity({ mode: "SYSTEM_ONLY" }),
  description:
    "Part Supplier Terms: one supplier's procurement terms for one Part (eos_ops.supplier_catalog_items), maintained " +
    "through the governed /operations/inventory commands. Cost, currency and the contract window are the COMMERCIAL " +
    "field group (inventory.catalog.cost.read / .create / .edit). See the file header.",
  fields: [
    makeFieldDefinition({ id: "supplierId", entityId: "supplierCatalogItem", label: "Supplier", type: "REFERENCE", referenceTo: "supplier",
      description: "The supplier offering these terms (eos_ops.suppliers). Half of the record's key." }),
    makeFieldDefinition({ id: "partId", entityId: "supplierCatalogItem", label: "Part", type: "REFERENCE", referenceTo: "part",
      description: "The canonical Part these terms are for (eos_ops.parts). Half of the record's key." }),
    makeFieldDefinition({ id: "supplierSku", entityId: "supplierCatalogItem", label: "Supplier SKU", type: "STRING",
      description: "The supplier's own part number (max 120)." }),
    makeFieldDefinition({ id: "cost", entityId: "supplierCatalogItem", label: "Unit Cost", type: "NUMBER", sensitivity: COMMERCIAL,
      description: "Unit cost as a decimal (NUMERIC(19,4)), in `currency`. COMMERCIAL field group: inventory.catalog.read + inventory.catalog.cost.read to see it." }),
    makeFieldDefinition({ id: "currency", entityId: "supplierCatalogItem", label: "Currency", type: "STRING", sensitivity: COMMERCIAL,
      description: "ISO 4217 code of the unit cost. COMMERCIAL field group." }),
    makeFieldDefinition({ id: "leadTimeDays", entityId: "supplierCatalogItem", label: "Lead Time (days)", type: "NUMBER",
      description: "Days from order to receipt, 0..3650." }),
    makeFieldDefinition({ id: "minOrderQty", entityId: "supplierCatalogItem", label: "Minimum Order Quantity", type: "NUMBER",
      description: "Optional positive decimal." }),
    makeFieldDefinition({ id: "orderMultiple", entityId: "supplierCatalogItem", label: "Order Multiple", type: "NUMBER",
      description: "Optional positive decimal." }),
    makeFieldDefinition({ id: "purchaseUnit", entityId: "supplierCatalogItem", label: "Purchase Unit", type: "STRING",
      description: "The unit the supplier sells in, in the stocking unit's family; travels with its conversion." }),
    makeFieldDefinition({ id: "conversionToStockingUnit", entityId: "supplierCatalogItem", label: "Conversion to Stocking Unit", type: "STRING",
      description: "{ numerator, denominator }: stocking units per purchase unit (two positive integers in the table)." }),
    makeFieldDefinition({ id: "contractStart", entityId: "supplierCatalogItem", label: "Contract Start", type: "DATE", sensitivity: COMMERCIAL,
      description: "Optional start of the contract window. COMMERCIAL field group." }),
    makeFieldDefinition({ id: "contractEnd", entityId: "supplierCatalogItem", label: "Contract End", type: "DATE", sensitivity: COMMERCIAL,
      description: "Optional end of the contract window (never before its start). COMMERCIAL field group." }),
    makeFieldDefinition({ id: "availability", entityId: "supplierCatalogItem", label: "Availability", type: "ENUM",
      enumValues: ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"], enumLabels: { AVAILABLE: "Available", UNAVAILABLE: "Unavailable", UNKNOWN: "Unknown" },
      description: "The supplier's stated availability." }),
    makeFieldDefinition({ id: "preferred", entityId: "supplierCatalogItem", label: "Preferred", type: "BOOLEAN",
      description: "THE preferred supplier for the Part (at most one per Part; only ACTIVE terms)." }),
    makeFieldDefinition({ id: "status", entityId: "supplierCatalogItem", label: "Terms Status", type: "ENUM",
      enumValues: ["ACTIVE", "INACTIVE"], enumLabels: { ACTIVE: "Terms Active", INACTIVE: "Terms Inactive" },
      description: "Deactivated, never deleted (inventory.catalog.activate)." }),
    makeFieldDefinition({ id: "lastVerifiedAt", entityId: "supplierCatalogItem", label: "Last Verified", type: "TIMESTAMP",
      description: "When the terms were last confirmed with the supplier." }),
  ],
});
