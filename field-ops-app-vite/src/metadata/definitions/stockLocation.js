import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";

// Stock Location — A-ENTITY-INVENTORY-MOVEMENT-DEFINITIONS. Describes the `stock_locations`
// collection (Epic 4 Warehouse + Fulfillment; functions/src/types/warehouse.ts's StockLocation:
// {id, warehouseId, partId, quantity, binCode, updatedAt}) — a bin-level quantity record, one
// document per (warehouseId, partId, binCode) triple (functions/src/warehouseService.ts's
// stockLocationDocId(): `${warehouseId}__${partId}__${binCode}`).
//
// NOTHING IN THIS REPOSITORY WRITES stock_locations TODAY — IT IS A SEEDED, DEAD-CODE-BACKED
// PROJECTION, NOT A LIVE-WRITTEN COLLECTION. functions/src/warehouseService.ts's
// updateStockLocation()/completeTransferOrder()/createTransferOrder()/getWarehouseStock() are
// the only code in this repository that reads or writes this collection by name, and none of
// them is called from anywhere else in functions/src (grep confirms zero callers outside that
// file and its own tests) — not exported from functions/src/index.ts, no callable, dead code.
// The Owner-ratified 2026-08-17 fulfillment-availability decision names this explicitly:
// functions/src/fulfillment/fulfillmentAvailability.ts's own header — "Nothing in the codebase
// ever WRITES stock_locations -- it is a seeded legacy projection" — and replaced it as the
// Sales Order availability source with a ledger-derived computation (sumLedgerEligibleOnHand()
// over inventory_transactions) for exactly this reason: stock_locations diverged from real
// receiving activity in both directions in the sandbox (a part with 3 genuinely received units
// showing 0; a part with 0 genuine receipts showing 40). The only thing that actually populates
// this collection today is functions/scripts/seedOperationsDemoData.js, a fixture script, not
// application code. Every field below is grounded in that seed script plus the (unreachable)
// TypeScript StockLocation type they agree on — not in any live governed writer, because none
// exists to observe.
//
// PROVENANCE: ONLY updatedAt EXISTS IN THE SCHEMA, AND EVEN IT HAS NO LIVE WRITER. The
// StockLocation type carries no createdAt/createdBy/updatedBy at all — updatedAt is the only
// provenance-shaped field anywhere in this contract, and both places that ever set it
// (warehouseService.ts's dead FieldValue.serverTimestamp() and the seed script's hardcoded
// `now`) are outside any governed write path. Declared because it is a real field in the type
// and the seed data; not claimed as a live-enforced invariant the way part.js's createdAt/
// createdBy is.
//
// readVia stays CLIENT_DIRECT because the read path is real even though the write path is
// not: the only LIVE consumer of this collection is services/operationsQueries.ts's
// fetchStockLocations() (a plain, unbounded, unfiltered `getDocs`, read by
// modules/operations/Operations.jsx), gated entirely by firestore.rules — never a callable.
//
// READ PATH: CLIENT_DIRECT, GATED BY ROLE/RELATIONSHIP, NEVER BY A CAPABILITY THAT ACTUALLY
// EVALUATES. firestore.rules' `stock_locations/{stockLocationId}` admits isAdminOrDispatcher()
// OR isAssignedToWarehouse(resource.data.warehouseId) — the identical shape warehouse.js
// records for the `warehouses` collection itself. `warehouse.stockLocation.read` DOES exist in
// the real capability catalog (functions/src/access/permissionCatalog.ts: "Read a
// stock_locations record (bin-level quantity within a warehouse)."), but exactly as
// inventoryTransaction.js's identical finding for `inventory.transaction.read`: nothing
// evaluates this id to authorize the actual Firestore read — no callable stands between the
// client and this collection, Rules alone gate it, and the catalog id lives in the separate,
// unconsumed governed-effective-access mirror. readCapability stays null.
//
// IDENTITY IS A nameField ONLY: binCode. Not server-allocated (a plain caller-supplied string
// on the dead writer's input, and a hand-authored literal in the seed script — "A1", "B3",
// etc.) — the same not-server-allocated reasoning purchaseOrder.js gives for
// externalPoNumber — so it is nameField, never referenceField. There is no other candidate:
// the document id is a derived composite key, not a human-typed one.
//
// warehouseId AND partId ARE REFERENCE FIELDS TO THE REGISTERED `warehouse` (warehouse.js) AND
// `part` (part.js) ENTITIES. Both targets are registered in this program, unlike
// purchaseOrder.js's supplierName (no `supplier` entity exists) — the edges can actually be
// validated.
//
// quantity IS A PLAIN UNIT COUNT, NEVER NEGATIVE, NEVER MONEY. The one guard the dead write
// path enforces (applyStockDelta()'s `current + deltaQuantity < 0` throw) and the seed data
// (0..12) agree: this is a bin-level physical unit count, not a monetary amount.
//
// NO RELATIONSHIPS ARE DECLARED. The one real parent edge (Warehouse -> its Stock Locations)
// belongs on `warehouse`, not here — warehouse.js's own header already records it as
// REGISTRATION_PENDING (stock_locations named explicitly) rather than declaring it from this
// side, which would duplicate the edge on the wrong entity.
export const stockLocationEntity = makeEntityDefinition({
  id: "stockLocation",
  label: "Stock Location",
  labelPlural: "Stock Locations",
  collection: "stock_locations",
  readVia: "CLIENT_DIRECT",
  // A matching capability id exists in the catalog but nothing evaluates it on this read
  // path — see the header. Recorded as null rather than invented.
  readCapability: null,
  identity: makeIdentity({ nameField: "binCode" }),
  description:
    "A bin-level quantity record within a Warehouse — one document per (warehouseId, partId, binCode). " +
    "Seeded only; no live writer exists in this repository today — see the file header.",
  fields: [
    // Written into the document body by both the dead app writer and the seed script (both
    // set `id` equal to the doc id), but nothing validates that equality since neither is a
    // live governed path. Declared as its own field, the same shape part.js's partId takes,
    // without the live enforcement claim part.js can make.
    makeFieldDefinition({
      id: "id",
      entityId: "stockLocation",
      label: "Stock Location ID",
      type: "ID",
      description: "The Firestore document id, also written into the document body by the dead writer and the seed script. Nothing live enforces the two stay equal.",
    }),
    makeFieldDefinition({
      id: "warehouseId",
      entityId: "stockLocation",
      label: "Warehouse",
      type: "REFERENCE",
      referenceTo: "warehouse",
      filterable: true,
      operators: ["EQUALS"],
      description: "The Warehouse this bin belongs to. Part of the deterministic doc id (stockLocationDocId()).",
    }),
    makeFieldDefinition({
      id: "partId",
      entityId: "stockLocation",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The Part stocked at this bin. Part of the deterministic doc id. Not filtered — no live query narrows by partId alone.",
    }),
    makeFieldDefinition({
      id: "binCode",
      entityId: "stockLocation",
      label: "Bin",
      type: "STRING",
      sortable: true,
      description: "The human-facing bin code (e.g. \"A1\"). Caller-supplied, not server-allocated. The identity.nameField half of identity — see the file header.",
    }),
    makeFieldDefinition({
      id: "quantity",
      entityId: "stockLocation",
      label: "Quantity",
      type: "NUMBER",
      description: "A bin-level unit count, never negative (the dead write path's own guard), never a monetary amount.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "stockLocation",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "The only provenance-shaped field this schema has — see the file header. No createdAt/createdBy/updatedBy exist anywhere in this collection's type.",
    }),
  ],
  // No relationships declared — see the file header.
});

/**
 * The Stock Location registry index. No standalone route renders this yet — a definition is
 * not a surface, the same restraint part.index/warehouse.index/purchaseOrder.index apply.
 *
 * warehouseId IS THE ONE DECLARED FILTER — the one real (if dead) query this collection was
 * ever built to serve (warehouseService.ts's getWarehouseStock(): `.where("warehouseId", "==",
 * warehouseId)`), and the natural way a future Warehouse detail page would scope this list to
 * one site. defaultSort is binCode ASC, catalog order matching part.index's own
 * internalPartNumber ASC idiom — this collection has no activity-order field worth preferring
 * over it (updatedAt has no live writer to make "recently changed" a meaningful ordering).
 */
export const stockLocationIndexList = makeListViewDefinition({
  id: "stockLocation.index",
  entityId: "stockLocation",
  label: "Stock Locations",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "warehouseId" }),
    makeColumn({ fieldId: "binCode", sortable: true }),
    makeColumn({ fieldId: "partId" }),
    makeColumn({ fieldId: "quantity" }),
    makeColumn({ fieldId: "updatedAt", sortable: true }),
  ],
  filters: [makeFilter({ fieldId: "warehouseId", operators: ["EQUALS"] })],
  defaultSort: [makeSort({ fieldId: "binCode", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
  ],
});
