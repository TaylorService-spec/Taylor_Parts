// Epic 4 Warehouse + Fulfillment System.
//
// A physical-reality layer on top of the ledger, NOT a second source
// of truth: `inventory_transactions` (Epic 2D) remains the sole
// authority for stock movement; these types model where physical
// stock actually sits (bin-level) and how it moves between physical
// locations, entirely separate from that authority.
import type { Timestamp } from "firebase-admin/firestore";

export interface Warehouse {
  id: string;
  name: string;
  location: string;
}

// Bin-level physical stock. Composite-unique on (warehouseId, partId,
// binCode) -- see warehouseService.ts's doc-id derivation.
export interface StockLocation {
  id: string;
  warehouseId: string;
  partId: string;
  quantity: number;
  binCode: string;
  updatedAt: Timestamp;
}

export type TransferOrderStatus = "REQUESTED" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED";

// Physical movement between warehouses. Never writes
// inventory_transactions -- a transfer moves where stock physically
// sits, not how much of it exists or is reserved/consumed against a
// Work Order.
export interface TransferOrder {
  id: string;
  partId: string;
  quantity: number;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: TransferOrderStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type DiscrepancySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// Output of a read-only comparison between physical stock (StockLocation)
// and ledger-derived expectation -- see warehouseReconciliationService.ts.
// Never triggers a correction; purely informational.
export interface WarehouseDiscrepancy {
  partId: string;
  warehouseId: string;
  expectedQuantity: number;
  actualQuantity: number;
  variance: number;
  severity: DiscrepancySeverity;
}
