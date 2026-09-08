// THE ENTITY REGISTRY — every declared EntityDefinition, in one place.
//
// ════════════════════ WHY THIS DID NOT EXIST BEFORE ════════════════════
//
// Twenty-nine definitions across thirty-five files, and every consumer imported the one it wanted
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
import { stockLocationEntity } from "./definitions/stockLocation.js";
import { supplierEntity } from "./definitions/supplier.js";
import { supplierCatalogItemEntity } from "./definitions/supplierCatalogItem.js";
import { transferOrderEntity } from "./definitions/transferOrder.js";
import { truckEntity } from "./definitions/truck.js";
import { warehouseEntity } from "./definitions/warehouse.js";
import { workOrderEntity } from "./definitions/workOrder.js";

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
  stockLocationEntity,
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
