// Work Order Engine v1.2 -- canonical server-side types.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this repo)
// at field-ops-app-vite/src/types/workOrder.ts. If either file changes,
// change the other to match.
//
// Timestamps are real Firestore Timestamps (written via
// admin.firestore.FieldValue.serverTimestamp() in transitionWorkOrder.ts/
// createWorkOrder.ts, not client Date.now()) -- this is what makes the
// spec's "immutable timestamps" requirement actually enforceable: the
// server clock, not a client-suppliable value, decides when a transition
// happened.
import type { Timestamp } from "firebase-admin/firestore";

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
// target status -- so permission/transition validation always goes through
// one lookup table (transitionEngine.ts's ACTION_TO_STATUS/ACTION_PERMISSIONS)
// instead of a client being able to name an arbitrary status directly.
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

  // Execution (immutable once set -- only transitionWorkOrder() writes these)
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
  // purely descriptive -- NOT read or written by createWorkOrder()/
  // transitionWorkOrder() (neither validates or enforces it). Mirrored
  // at field-ops-app-vite/src/types/workOrder.ts.
  inventorySnapshot?: InventorySnapshotItem[];

  // Epic 6 Phase 6.3 Field Execution Capture: optional, additive,
  // non-lifecycle -- written ONLY by updateWorkOrderExecutionData.ts,
  // never by createWorkOrder()/transitionWorkOrder(). executionLog is
  // append-only (Firestore arrayUnion -- inherently concurrency-safe,
  // no read-modify-write race). lastUpdated is deliberately a SEPARATE
  // field from `updatedAt` above (which transitionWorkOrder() owns) so
  // it's always unambiguous which Cloud Function touched a document
  // most recently.
  executionLog?: ExecutionLogEntry[];
  lastUpdated?: Timestamp;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InventorySnapshotItem {
  sku: string;
  name?: string;
  qtyPlanned?: number;
  qtyUsed?: number;
  category?: string;
  notes?: string;
}

// Epic 6 Phase 6.3 -- one entry in WorkOrder.executionLog. `at` is a
// concrete Timestamp.now() value, not FieldValue.serverTimestamp() --
// Firestore does not allow serverTimestamp() sentinels inside
// arrayUnion() array elements. Still server-computed (this runs
// Admin-SDK-side), not client-supplied, so it isn't spoofable.
export interface ExecutionLogEntry {
  note: string;
  at: Timestamp;
  byTechnicianId: string;
}
