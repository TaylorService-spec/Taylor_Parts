import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// Supplier Catalog Item — A-ENTITY-CATALOG-DEFINITIONS. Describes the Epic 5 Procurement +
// Supplier Management `supplier_catalog` collection (functions/src/constants/collections.ts's
// SUPPLIER_CATALOG_COLLECTION, functions/src/supplierService.ts, functions/src/types/
// procurement.ts's SupplierCatalogItem, mirrored client-side as
// field-ops-app-vite/src/services/operationsQueries.ts's RawSupplierCatalogItem). A LISTING: one
// supplier's price and availability for one part number, nothing more.
//
// NOT PART_SUPPLIER_ITEMS. This program's task framing warns against absorbing pricing or
// supplier-item concerns that live elsewhere — but `supplier_catalog` genuinely IS the record
// that carries this listing's own price and availability; that is the whole of what it stores,
// not a borrowed concern from `part_supplier_items` (functions/src/partMaster/
// partSupplierItems.ts, INV-1 Phase 1 PR 1.4, ADR-008). The two are separate, non-overlapping
// collections from separate eras: part_supplier_items is the ADR-008 normalized successor,
// trusted-writer-only and fully client-closed (`allow read, write: if false`, firestore.rules);
// supplier_catalog is the older Epic 5 record this definition actually describes, admin/
// dispatcher-readable, admin-provisioned. Neither has a migration or reconciliation path to the
// other recorded anywhere in this repository. No partSupplierItem EntityDefinition exists in this
// program to register a relationship against even if one were warranted — see
// REGISTRATION_PENDING.
//
// NO WRITE PATH EXISTS ANYWHERE IN THIS REPOSITORY. functions/src/supplierService.ts's own header
// is explicit: "Read-only. No writes live here; suppliers/catalog items are provisioned by an
// admin (console or Admin SDK)... not a live vendor integration, just internal reference data."
// A full grep of functions/src and field-ops-app-vite/src for SUPPLIER_CATALOG_COLLECTION finds
// exactly three call sites, all reads: getSupplierCatalog, findBestSupplierForPart
// (supplierService.ts), and fetchSupplierCatalog (operationsQueries.ts). The only writer found
// anywhere is functions/scripts/seedOperationsDemoData.js, a one-off local demo-data script run
// directly against a live project with real credentials via the Admin SDK — not a governed
// command, not deployed, not part of any live workflow. This collection is therefore READ-live
// (Operations.jsx's ProcurementPanel genuinely queries it) but WRITE-dormant: the same "real
// reads, no live writer" honesty this program's collections have recorded before, just inverted
// from the more common "write path exists, nothing reads it yet" shape.
//
// READ IS CLIENT_DIRECT, THE SAME POSTURE AS SUPPLIER AND PURCHASE_ORDERS. firestore.rules'
// `supplier_catalog/{catalogItemId}`: "allow read: if isAdminOrDispatcher(); allow create, update,
// delete: if false" — a role check, not a capability, and the exact sibling posture
// `suppliers/{supplierId}` and `purchase_orders/{purchaseOrderId}` both carry immediately above
// it in the same Epic 5 Rules block. No `supplier_catalog.read` (or similar) exists anywhere in
// the capability catalog. readCapability is therefore null, the same finding supplier.js already
// records for its own sibling collection.
//
// NO STORED FIELD IS A HUMAN NAME OR A BUSINESS REFERENCE. The stored shape (SupplierCatalogItem,
// functions/src/types/procurement.ts) is exactly `{ id, supplierId, partId, unitPrice, available
// }` — five fields, none of them a human-typed label or a server-allocated reference number. This
// is a listing, not a named record: what identifies it to a person is "this supplier's price for
// this part", a composed fact across two foreign keys, not a single field a renderer could point
// at. Nominating either foreign key as identity would repeat the exact anti-pattern
// inventoryTransaction.js's header names as rejected by the Owner's ruling (A-IDENTITY-MODES) --
// a shared, non-unique value standing in for identity is a category, not a name. identity.mode is
// therefore declared SYSTEM_ONLY explicitly (never derived -- resolveIdentityMode,
// entityDefinition.js). A surface that needs to describe one of these rows to a human must compose
// a description from supplierId + partId + unitPrice, the same restraint
// inventoryTransaction.js's own header prescribes for its ledger rows.
//
// NO PROVENANCE IS STORED AT ALL. Unlike every governed INV-1 collection (part.js, supplier.js,
// equipmentModel.js, manufacturer.js), this Epic 5 record carries no version, no createdAt/
// createdBy, no updatedAt/updatedBy -- the stored type and every real document
// (seedOperationsDemoData.js's own catalogItems literals) have exactly the five fields named
// above and nothing else. None of the four provenance fields is declared here; declaring them
// would assert a write-time guarantee this collection's own type never made.
export const supplierCatalogItemEntity = makeEntityDefinition({
  id: "supplierCatalogItem",
  label: "Supplier Catalog Item",
  labelPlural: "Supplier Catalog Items",
  collection: "supplier_catalog",
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher), not by a capability. Recorded as null rather
  // than invented -- see the header.
  readCapability: null,
  // SYSTEM_ONLY, explicitly declared -- never derived. See the file header for why neither
  // foreign key qualifies as a name or a reference.
  identity: makeIdentity({ mode: "SYSTEM_ONLY" }),
  description:
    "A single supplier's price and availability listing for one part number (Epic 5 Procurement). " +
    "Read-live (Operations.jsx's ProcurementPanel); write-dormant -- the only writer found anywhere " +
    "is a one-off local admin seed script, not a governed command. See the file header.",
  fields: [
    // The document id, declared rather than left implicit -- the same shape part.js's partId and
    // supplier.js's supplierId take. Not part of identity (SYSTEM_ONLY has none) and not
    // filterable or sortable.
    makeFieldDefinition({
      id: "catalogItemId",
      entityId: "supplierCatalogItem",
      label: "Catalog Item ID",
      type: "ID",
      description: "The Firestore document id, also written into the document body as `id` (SupplierCatalogItem.id / RawSupplierCatalogItem.id). No repository-level enforcement checks the two agree (unlike part.js's partId or manufacturer.js's manufacturerId) -- this collection has no repository layer at all, only direct Admin-SDK reads.",
    }),
    // supplierId genuinely IS the suppliers/{supplierId} document id -- supplierService.ts's
    // findBestSupplierForPart looks it up directly (`suppliersById.get(item.supplierId)`) and
    // seedOperationsDemoData.js's seed data uses the real supplier doc ids ("sup-a"/"sup-b").
    // "supplier" is a registered entity in this program (definitions/supplier.js), so this is a
    // real, resolvable REFERENCE -- not a plain string the way part.js's primaryManufacturerId
    // stayed before manufacturer.js existed.
    makeFieldDefinition({
      id: "supplierId",
      entityId: "supplierCatalogItem",
      label: "Supplier",
      type: "REFERENCE",
      referenceTo: "supplier",
      filterable: true,
      operators: ["EQUALS"],
      description: "The suppliers/{supplierId} document id this listing belongs to. findBestSupplierForPart (supplierService.ts) resolves it directly against the suppliers collection.",
    }),
    // partId is NOT upgraded to a REFERENCE. seedOperationsDemoData.js's own seed values
    // ("TST-1003", "TST-1015", "TST-1031", drawn from data/partsCatalog.ts) are legacy SKU
    // strings, not Part Master's canonical partId (functions/src/partMaster -- the identity
    // ADR-008/#106 settled, where the document id IS the identity, enforced at read by
    // partFromFirestore). ADR-008's sku-grandfathering resolver (partReferenceCompatibility.ts,
    // referenced by workOrderSnapshotCompatibility.ts) exists PRECISELY because a legacy sku
    // string is not automatically a Part Master partId -- it is a flag-guarded, best-effort
    // RESOLUTION, not a stored identity guarantee this collection's own data carries. Asserting
    // REFERENCE here would claim every stored partId value resolves cleanly into the `part`
    // entity's identity space, which nothing in this collection's write path (a one-off seed
    // script, no validation, no Part Master lookup) establishes.
    makeFieldDefinition({
      id: "partId",
      entityId: "supplierCatalogItem",
      label: "Part",
      type: "STRING",
      filterable: true,
      operators: ["EQUALS"],
      description: "A legacy SKU/part-number string. NOT verified against Part Master's canonical partId identity space -- see the file header. Stays a plain STRING rather than a REFERENCE to `part` until that resolution is established, not merely asserted.",
    }),
    // A plain number with NO currency field beside it -- the exact gap opportunity.js's own
    // expectedValue already records. Declaring CURRENCY_MINOR would assert minor-unit integer
    // storage the type (functions/src/types/procurement.ts's `unitPrice: number`,
    // seedOperationsDemoData.js's literal 245.0/42.5 decimal dollar values) does not have.
    makeFieldDefinition({
      id: "unitPrice",
      entityId: "supplierCatalogItem",
      label: "Unit Price",
      type: "NUMBER",
      sortable: true,
      description: "Stored as a plain decimal-dollar number, no currency field, no minor-unit encoding. NOT CURRENCY_MINOR -- see the file header. Do not render a currency symbol the data does not justify beyond USD assumed by convention.",
    }),
    makeFieldDefinition({
      id: "available",
      entityId: "supplierCatalogItem",
      label: "Available",
      type: "BOOLEAN",
      filterable: true,
      operators: ["EQUALS"],
      description: "Required on every stored record (findBestSupplierForPart filters on it directly: `.where(\"available\", \"==\", true)`) -- the one real backend query this collection's own service code already runs.",
    }),
  ],
  // No relationships declared. The supplierId edge is already expressed as the supplierId
  // REFERENCE field above -- a relationships[] entry would duplicate that same edge, not add a
  // new one. See the file header for why partId stays a plain string rather than a second edge.
});

// No list view is declared. Operations.jsx's ProcurementPanel already renders this collection
// today, but through fetchSupplierCatalog's raw unbounded getDocs result directly (the same
// "not a client-writable-shape" caveat operationsQueries.ts's own comment names for the
// Reorder Requests/PO diagnostics reads), not through this metadata contract -- a definition is
// not a surface, the same restraint every other *.js in this program applies. Declaring one here
// would additionally have to invent a filter set: the only real predicate the backend service
// code runs (findBestSupplierForPart's compound partId+available equality query) is a
// server-side helper, not a client list query, and the one live client read
// (fetchSupplierCatalog) is unfiltered and unbounded end to end -- declaring INDEX filters would
// promise combinations no query this collection actually serves has ever run.
