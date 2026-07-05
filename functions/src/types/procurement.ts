// Epic 5 Procurement + Supplier Management System.
//
// A planning + orchestration layer between analytics (Epic 3) and
// real-world ordering -- NOT a vendor integration layer. No field here
// is ever populated from a live external HTTP call; contactEmail is
// operator-entered reference data, not an integration endpoint.
import type { Timestamp } from "firebase-admin/firestore";

export interface Supplier {
  id: string;
  name: string;
  contactEmail: string;
  leadTimeDays: number;
}

export interface SupplierCatalogItem {
  id: string;
  supplierId: string;
  partId: string;
  unitPrice: number;
  available: boolean;
}

export type PurchaseOrderStatus = "DRAFT" | "APPROVED" | "SENT" | "RECEIVED" | "CANCELLED";

export interface PurchaseOrderLineItem {
  partId: string;
  quantity: number;
  unitPrice: number;
}

// createdAt/updatedAt stored as Firestore Timestamp, not the `number`
// (epoch ms) in the epic's originally specified shape -- kept
// consistent with every other Firestore-stored entity in this codebase
// (WorkOrder, InventoryTransaction, StockLocation all use Timestamp).
// A `number`-based pure/analytics representation would live in a
// separate normalizer if a future caller ever needs one, same pattern
// as ledgerNormalizer.ts for the inventory ledger.
export interface PurchaseOrder {
  id: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderLineItem[];
  totalCost: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Input from Epic 3 -- read-only signal, never written by this epic.
export interface ProcurementRecommendation {
  partId: string;
  recommendedQuantity: number;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  source: "EPIC3_ANALYTICS";
}
