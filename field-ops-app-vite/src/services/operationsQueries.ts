// Operations dashboard -- one-shot reads only (getDocs, not onSnapshot),
// same precedent as firebase/collectionStore.js's list() and
// AuthContext's role lookup. These seven collections are all
// Cloud-Function-only writes (firestore.rules denies create/update/
// delete unconditionally) -- this file never writes to any of them,
// it only reads what an admin/dispatcher is allowed to see.
import { collection, getDocs, Timestamp } from "firebase/firestore";
import { db } from "../firebase/firebase";

const INVENTORY_TRANSACTIONS_COLLECTION = "inventory_transactions";
const STOCK_LOCATIONS_COLLECTION = "stock_locations";
const WAREHOUSES_COLLECTION = "warehouses";
const TRANSFER_ORDERS_COLLECTION = "transfer_orders";
const SUPPLIERS_COLLECTION = "suppliers";
const SUPPLIER_CATALOG_COLLECTION = "supplier_catalog";
const PURCHASE_ORDERS_COLLECTION = "purchase_orders";

export interface RawInventoryTransaction {
  id: string;
  workOrderId: string;
  partId: string;
  type: "RESERVED" | "RELEASED" | "CONSUMED";
  quantity: number;
  timestamp: Timestamp;
}

export interface RawStockLocation {
  id: string;
  warehouseId: string;
  partId: string;
  quantity: number;
  binCode: string;
}

export interface RawWarehouse {
  id: string;
  name: string;
  location: string;
}

export interface RawTransferOrder {
  id: string;
  partId: string;
  quantity: number;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: "REQUESTED" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED";
}

export interface RawSupplier {
  id: string;
  name: string;
  contactEmail: string;
  leadTimeDays: number;
}

export interface RawSupplierCatalogItem {
  id: string;
  supplierId: string;
  partId: string;
  unitPrice: number;
  available: boolean;
}

export interface RawPurchaseOrder {
  id: string;
  supplierId: string;
  status: "DRAFT" | "APPROVED" | "SENT" | "RECEIVED" | "CANCELLED";
  items: { partId: string; quantity: number; unitPrice: number }[];
  totalCost: number;
}

async function listCollection<T>(name: string): Promise<T[]> {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

export const fetchInventoryTransactions = () => listCollection<RawInventoryTransaction>(INVENTORY_TRANSACTIONS_COLLECTION);
export const fetchStockLocations = () => listCollection<RawStockLocation>(STOCK_LOCATIONS_COLLECTION);
export const fetchWarehouses = () => listCollection<RawWarehouse>(WAREHOUSES_COLLECTION);
export const fetchTransferOrders = () => listCollection<RawTransferOrder>(TRANSFER_ORDERS_COLLECTION);
export const fetchSuppliers = () => listCollection<RawSupplier>(SUPPLIERS_COLLECTION);
export const fetchSupplierCatalog = () => listCollection<RawSupplierCatalogItem>(SUPPLIER_CATALOG_COLLECTION);
export const fetchPurchaseOrders = () => listCollection<RawPurchaseOrder>(PURCHASE_ORDERS_COLLECTION);
