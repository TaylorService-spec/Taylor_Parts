// THE ENTITY REGISTRY — every declared EntityDefinition, in one place.
//
// ════════════════════ WHY THIS DID NOT EXIST BEFORE ════════════════════
//
// Twenty-eight definitions across thirty-five files, and every consumer imported the one it wanted
// by name. That is fine when a page needs one entity. It stops being fine the moment something
// needs to answer a question ABOUT the model rather than about a record -- "which objects exist",
// "what fields does Customer have", "which fields are reportable" -- because each such consumer
// then assembles its own list, and the lists drift.
//
// The Administration Objects and Roles & Permissions surfaces both ask exactly that kind of
// question, so the list is stated once here.
//
// ════════════════════ WHAT THIS IS NOT ════════════════════
//
// NOT a second field-metadata model. It re-exports the SAME frozen definitions the definition files
// already export; nothing is redefined, reshaped or copied. Adding an entity means adding one
// import and one array entry, and forgetting to is caught by the coverage test.
//
// NOT the policy store. These are DESIGN-TIME declarations of shipped fields. The run-time,
// tenant-owned governance record -- who may read a field, whether it is custom, its lifecycle --
// lives in EOS storage (functions/src/adminPolicy). This registry is what SEEDS the system objects
// and system fields there, and what an Administration screen renders while the store is being
// stood up.
import { accountEntity } from "./definitions/account.js";
import { contactEntity } from "./definitions/contact.js";
import { employeeEntity } from "./definitions/employee.js";
import { equipmentEntity } from "./definitions/equipment.js";
import { equipmentModelEntity } from "./definitions/equipmentModel.js";
import { inventoryActionEntity } from "./definitions/inventoryAction.js";
import { inventoryTransactionEntity } from "./definitions/inventoryTransaction.js";
import { invoiceEntity } from "./definitions/invoice.js";
import { locationEntity } from "./definitions/location.js";
import { manufacturerEntity } from "./definitions/manufacturer.js";
import { mobileLocationEntity } from "./definitions/mobileLocation.js";
import { opportunityEntity } from "./definitions/opportunity.js";
import { partEntity } from "./definitions/part.js";
import { partAliasEntity } from "./definitions/partAlias.js";
import { paymentEntity } from "./definitions/payment.js";
import { purchaseOrderEntity } from "./definitions/purchaseOrder.js";
import { purchaseOrderVoidEntity } from "./definitions/purchaseOrderVoid.js";
import { receivingOrderEntity } from "./definitions/receivingOrder.js";
import { reorderRequestEntity } from "./definitions/reorderRequest.js";
import { salesAgreementEntity } from "./definitions/salesAgreement.js";
import { salesOrderEntity } from "./definitions/salesOrder.js";
import { salesTerritoryEntity } from "./definitions/salesTerritory.js";
import { supplierEntity } from "./definitions/supplier.js";
import { supplierCatalogItemEntity } from "./definitions/supplierCatalogItem.js";
import { transferOrderEntity } from "./definitions/transferOrder.js";
import { truckEntity } from "./definitions/truck.js";
import { warehouseEntity } from "./definitions/warehouse.js";
import { workOrderEntity } from "./definitions/workOrder.js";

// ════════════════════ stockLocation IS NOT HERE, AND THAT IS THE RULING ════════════════════
//
// OWNER RULING, 2026-09-12: `stock_locations` IS RETIRED AS AN OPERATIONAL AUTHORITY. The ownership
// backfill was applied and measured 5/5 RESOLVED post-backfill; the client operational read and the
// old producers were removed (BIN-P2R, Decision #160 / ADR-014); Warehouse/BIN authority has its
// PostgreSQL destination; the obsolete composite index was removed and STAYS removed.
//
// Registering it here made it an ACTIVE object surface: the Administration Objects screen offered
// it, and the admin-policy seed created field-level policy rows for six fields of a collection no
// principal can reach -- there is no `match /stock_locations/` block in either governed Rules copy,
// no query anywhere in functions/src or field-ops-app-vite/src, and no writer. An administrator
// could configure access to something nothing can read.
//
// The historical record is preserved where it belongs and is NOT a live runtime dependency:
// the executed backfill evidence (functions/src/ownership/ownershipBackfillRules.ts's rule and its
// AUTHORIZED_WRITE_CAPS entry, reachable only from scripts), the ownership matrix/derivation rows,
// the retired-authority label on `warehouse.stockLocation.read` in the capability catalog, the
// sb-evidence captures, and field-ops-app-vite/test/stockLocationSurfaceRetired.test.jsx, which
// holds the surface deleted rather than emptied.
//
// Canonical end state: HISTORICAL / RETIRED, not ACTIVE OPERATIONAL LIST AUTHORITY.

/** Every declared entity, alphabetically by id so the Objects screen has a stable order. */
export const ENTITY_REGISTRY = Object.freeze([
  accountEntity,
  contactEntity,
  employeeEntity,
  equipmentEntity,
  equipmentModelEntity,
  inventoryActionEntity,
  inventoryTransactionEntity,
  invoiceEntity,
  locationEntity,
  manufacturerEntity,
  mobileLocationEntity,
  opportunityEntity,
  partEntity,
  partAliasEntity,
  paymentEntity,
  purchaseOrderEntity,
  purchaseOrderVoidEntity,
  receivingOrderEntity,
  reorderRequestEntity,
  salesAgreementEntity,
  salesOrderEntity,
  salesTerritoryEntity,
  supplierEntity,
  supplierCatalogItemEntity,
  transferOrderEntity,
  truckEntity,
  warehouseEntity,
  workOrderEntity,
]);

/** One entity by its id, or null. Never throws -- an unknown id is a question, not a fault. */
export const findEntityById = (entityId) =>
  ENTITY_REGISTRY.find((entity) => entity.id === entityId) ?? null;

/** One entity by the Firestore collection it declares, or null. */
export const findEntityByCollection = (collection) =>
  ENTITY_REGISTRY.find((entity) => entity.collection === collection) ?? null;

/**
 * The fields an Administration surface should OFFER for an entity.
 *
 * `displayable: false` fields are declared so their meaning and gaps are recorded, but they are not
 * offered as columns -- and a permissions grid is a column list. Showing them would invite an
 * administrator to configure access to something no surface can render.
 */
export const displayableFields = (entity) =>
  (entity?.fields ?? []).filter((field) => field.displayable !== false);

/** Total declared fields across the registry. Used by the coverage test and the Objects header. */
export const totalDeclaredFields = () =>
  ENTITY_REGISTRY.reduce((sum, entity) => sum + (entity.fields?.length ?? 0), 0);
