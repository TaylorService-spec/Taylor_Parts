// Work Order Engine v1.2 -- canonical client-side types.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this repo)
// at functions/src/types/workOrder.ts. If either file changes, change the
// other to match.
//
// Timestamps come back from Firestore reads as client-SDK Timestamp
// instances (call .toDate()/.toMillis() to use them) -- they are written
// server-side only, by transitionWorkOrder.ts/createWorkOrder.ts via
// admin.firestore.FieldValue.serverTimestamp(), never by the client.
import type { Timestamp } from "firebase/firestore";

export type WorkOrderStatus =
  | "CREATED"
  | "READY_TO_DISPATCH"
  | "SCHEDULED"
  | "DISPATCHED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "WORK_IN_PROGRESS"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELLED";

export type Priority = 1 | 2 | 3 | 4;
// 1 = Emergency, 2 = High, 3 = Normal, 4 = Low

export type Severity =
  | "EQUIPMENT_DOWN"
  | "PARTIAL_OPERATION"
  | "COSMETIC"
  | "PREVENTIVE";

export type WorkOrderType =
  | "SERVICE_CALL"
  | "PM"
  | "INSTALL"
  | "WARRANTY"
  | "INSPECTION";

// Actions are the vocabulary transitionWorkOrder() accepts -- never a raw
// target status. Used only for typing workOrderService.ts's call
// signatures here; the permission matrix itself is not re-implemented in
// this file (that duplication is scoped to domain/workOrderWorkflow.js /
// functions/src/transitionEngine.ts only).
export type ActionName =
  | "MarkReady"
  | "Schedule"
  | "Dispatch"
  | "Accept"
  | "Travel"
  | "Arrive"
  | "WorkStart"
  | "Complete"
  | "Close"
  | "Cancel";

export interface WorkOrder {
  id: string;
  woNumber: string; // WO-2026-000001

  status: WorkOrderStatus;

  priority: Priority;
  severity?: Severity;

  type: WorkOrderType;

  customerId: string;
  locationId: string;

  assignedTechId?: string;

  // Planning (mutable)
  scheduledStart?: Timestamp;
  scheduledEnd?: Timestamp;
  scheduledTechId?: string;

  // Execution (immutable once set)
  dispatchedAt?: Timestamp;
  acceptedAt?: Timestamp;
  enRouteAt?: Timestamp;
  arrivedAt?: Timestamp;
  workStartedAt?: Timestamp;
  completedAt?: Timestamp;
  closedAt?: Timestamp;

  // Service data
  complaint?: string;
  diagnosis?: string;
  resolution?: string;
  laborHours?: number;

  // Epic 1.1 Inventory Visual Layer: optional, non-authoritative,
  // purely descriptive. NOT validated or enforced by
  // createWorkOrder()/transitionWorkOrder() (neither Cloud Function
  // reads or writes this field) -- read-only UI enrichment showing
  // what parts are planned/used for this WO, nothing more. No
  // inventory transactions, stock deduction, or warehouse authority
  // are implied. See data/partsCatalog.ts for the (also static,
  // non-authoritative) SKU -> name/category/cost reference table.
  inventorySnapshot?: InventorySnapshotItem[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InventorySnapshotItem {
  sku: string;
  name?: string;

  // Planned usage (dispatch planning).
  qtyPlanned?: number;

  // Actual usage -- future phase only, can remain empty/absent for now.
  qtyUsed?: number;

  // Optional metadata, UI only.
  category?: string;
  notes?: string;
}
