// THE PER-OPERATION ACCESS MAP -- what the SERVER requires of a session for each operation a page may ask, stated ONCE.
//
// WHY THIS EXISTS. The server decides every operation inside its own command (`requireCapability(actor, KEY)` and company / scope reach).
// There is no central table, so the browser kept a hand-written PARTIAL copy of the decisions (field-ops-app-vite/src/access/partsReadGates.js,
// sessionAccess.js). Every operation missing from that copy became a background 403 on a page that had no business asking (UAT 2026-10-23:
// listEmployees, listWorkOrders, listPartAliases, listLegacyInventoryActionNotes).
//
// HOW IT STAYS TRUE. Every capability below is the exported constant the command itself checks, imported from the command's own module --
// never a retyped string. A renamed or re-keyed constant changes this table; the generated client file then drifts and
// `node scripts/generateOperationAccessMap.mjs --check` (CI) fails until it is regenerated and reviewed. The catalog reads are taken whole from
// the transport's own table (CATALOG_READ_REQUIREMENTS). functions/test/operationAccessMap.test.mjs proves, against the real commands, that
// each row is the check the command applies.
//
// WHAT IT DOES NOT DO. It grants nothing and the server re-decides every call. It states the CAPABILITY (and experience-surface) layer only:
// operating-company reach, record assignment and grant conditions are decided per call by the server and are not visible to the browser. A
// session that passes this map can still be refused for those reasons; a session that fails it is certain to be refused, which is the only
// thing a page needs in order not to ask.
import { CATALOG_READ_REQUIREMENTS } from "../catalogMaster/catalogHttp.js";
import { INVENTORY_ON_HAND_READ, RECEIPT_READ, SUPPLIER_READ, WAREHOUSE_READ } from "./partsReads.js";
import { REORDER_CREATE_MANUAL, REORDER_READ } from "./reorderLifecycleCommands.js";
import { SUPPLIER_TERMS_READ_CAPABILITY } from "./partSupplierTerms.js";
import { LEGACY_NOTES_READ_CAPABILITY } from "./legacyInventoryActionNotes.js";
import { EMPLOYEE_RECORD_READ } from "../eosWorkforce/reads/employeeDirectoryReads.js";
import { WORK_ORDER_RECORD_READ } from "./workOrderRecordRead.js";
import { EXPERIENCE_SURFACE_KEYS } from "./experienceAuthority.js";

export interface OperationAccess {
  /** EVERY one of these capabilities. Empty = any signed-in principal (a self read, or a read the command guards section by section). */
  readonly allOf: readonly string[];
  /** AT LEAST ONE of these, in addition to allOf. Omitted = no alternative set. */
  readonly anyOf?: readonly string[];
  /**
   * The EOS experience surface (resolveMyExperienceContext) the caller must be granted. When present the SURFACE is the decision: it already
   * embeds allOf plus the Operational Scope (or protected reach) the command applies, which no capability list can state.
   */
  readonly surface?: string;
}

const catalog = (operation: keyof typeof CATALOG_READ_REQUIREMENTS): OperationAccess => ({ allOf: CATALOG_READ_REQUIREMENTS[operation] });
const holds = (...allOf: string[]): OperationAccess => ({ allOf });
const SELF: OperationAccess = { allOf: [] };

export const OPERATION_ACCESS: Readonly<Record<string, OperationAccess>> = Object.freeze({
  // ── Catalog (catalogHttp.ts CATALOG_READ_REQUIREMENTS, whole) ───────────────────────────────────────────────────────────────────────────
  readPart: catalog("readPart"),
  readPartsByIds: catalog("readPartsByIds"),
  searchParts: catalog("searchParts"),
  countParts: catalog("countParts"),
  listEquipmentModels: catalog("listEquipmentModels"),
  // The identifier ADMINISTRATION list: catalog.read AND catalog.manage. inventory.catalog.alias.read is resolve-only and does not open it.
  listPartAliases: catalog("listPartAliases"),
  probePartAlias: catalog("probePartAlias"),
  lookupScannedPart: catalog("lookupScannedPart"),
  listManufacturers: catalog("listManufacturers"),
  getManufacturer: catalog("getManufacturer"),
  searchManufacturers: catalog("searchManufacturers"),

  // ── Stock (partsReads.ts) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  readInventoryOnHand: holds(INVENTORY_ON_HAND_READ),
  readInventoryMovements: holds(INVENTORY_ON_HAND_READ),
  readPartBalance: holds(INVENTORY_ON_HAND_READ),
  listReceipts: holds(RECEIPT_READ),
  readReceipt: holds(RECEIPT_READ),
  listSuppliers: holds(SUPPLIER_READ),
  // Default input (companyWide not set). `companyWide: true` asks a different set (transfer-order read) and is not a Parts-page read.
  listInventoryWarehouses: { allOf: [], anyOf: [WAREHOUSE_READ, INVENTORY_ON_HAND_READ] },
  // No capability key at all: the command applies the caller's operating-company reach only.
  listReceivableSupplierPurchaseOrders: SELF,
  listPartSupplierItems: holds(SUPPLIER_TERMS_READ_CAPABILITY),
  listLegacyInventoryActionNotes: holds(LEGACY_NOTES_READ_CAPABILITY),

  // ── Reorder (reorderLifecycleCommands.ts) ───────────────────────────────────────────────────────────────────────────────────────────────
  // The QUEUE: reorder.request.read AND the REORDER_QUEUE Operational Scope, which is exactly the surface inventory.reorderQueue.
  readReorderQueue: { allOf: [REORDER_READ], surface: "inventory.reorderQueue" },
  // The OWN reach (records assigned to the caller's Employee) and the by-id reads need only reorder.request.read; reach is decided per record.
  readMyAssignedReorders: holds(REORDER_READ),
  readReorderRequest: holds(REORDER_READ),
  readReorderPurchaseOrders: holds(REORDER_READ),
  listReorderWarehouseOptions: holds(REORDER_CREATE_MANUAL),

  // ── Other domains the Parts pages touch ─────────────────────────────────────────────────────────────────────────────────────────────────
  listEmployees: holds(EMPLOYEE_RECORD_READ),
  listWorkOrders: holds(WORK_ORDER_RECORD_READ),

  // ── Self reads: any signed-in principal; each guards its own sections or answers only for the caller ────────────────────────────────────
  resolveMyCapabilities: SELF,
  resolveMyExperienceContext: SELF,
  readMyEmployeeProfile: SELF,
  readMyWorkOrderCapabilities: SELF,
  readMyWork: SELF,
  listWorkflowWork: SELF,
  // Name resolution for ids the page already holds (workspace API): any reader of the record kinds that show them.
  resolveEmployeeDisplayNames: SELF,
  resolvePrincipalDisplayNames: SELF,
});

for (const [operation, row] of Object.entries(OPERATION_ACCESS)) {
  if (row.surface !== undefined && !EXPERIENCE_SURFACE_KEYS.includes(row.surface)) {
    throw new Error(`operationAccessMap: ${operation} names the surface "${row.surface}", which is not an experience surface`);
  }
}
