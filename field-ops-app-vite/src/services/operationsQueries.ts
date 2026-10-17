// FIREBASE-ONLY LEGACY READS -- one-shot getDocs, never onSnapshot, never a write.
//
// Firebase exit F2-remainder (2026-10-17): everything here that had a governed EOS read was moved or deleted.
//   * The Reorder / Procurement reads moved to services/operationsReorderReads.ts (no Firebase import).
//   * The Firestore `transfer_orders` / `suppliers` / `purchase_orders` readers and the generic bounded page reader were
//     DELETED: nothing in the app called them (Inventory > Transfers reads EOS listTransferOrders through
//     hooks/useTransferOrders.js; Suppliers reads EOS listSuppliers; the Operations Procurement panel reads the Reorder
//     purchase orders).
//
// What remains is read ONLY where Firebase is still the sole source (production has no EOS API), and by two consumers:
//   fetchWarehouses            Administration > Warehouse Racking (the bin planner, which writes Firestore `bins`; F6).
//                              Unreachable where EOS is the session source: its inventory.location.bin.* capabilities have
//                              no EOS key (access/eosCapabilityAccess.js FIREBASE_IDS_WITHOUT_EOS_TWIN) and the screen is a
//                              declared navigation gap.
//   fetchInventoryTransactions the parts shadow-parity diagnostic (route retired where EOS is the session source, F1 G8).
import { collection, getDocs, Timestamp } from "firebase/firestore";
import { db } from "../firebase/firebase";

const INVENTORY_TRANSACTIONS_COLLECTION = "inventory_transactions";
const WAREHOUSES_COLLECTION = "warehouses";

export interface RawInventoryTransaction {
  id: string;
  workOrderId: string;
  partId: string;
  type: "RESERVED" | "RELEASED" | "CONSUMED";
  quantity: number;
  timestamp: Timestamp;
}

export interface RawWarehouse {
  id: string;
  name: string;
  location: string;
  status?: string; // governed §3A status (ACTIVE/INACTIVE); present at runtime
}

async function listCollection<T>(name: string): Promise<T[]> {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

// DELIBERATELY UNBOUNDED, and it must not quietly acquire a cap: the diagnostic NETS this ledger, and a total computed over a
// truncated input is not "partial" -- it is WRONG, presented as complete.
export const fetchInventoryTransactions = () => listCollection<RawInventoryTransaction>(INVENTORY_TRANSACTIONS_COLLECTION);
export const fetchWarehouses = () => listCollection<RawWarehouse>(WAREHOUSES_COLLECTION);
