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

// P1.2 (Sales->Cash fulfillment spine) -- a governed, quantity+kind-bearing reference from a Work Order back
// to the Sales Order line that demanded it. Replaces the earlier bare `string[]` of refs (which lost qty/kind
// at the WO<->SO seam, blocking P1.1's per-line fulfilledQty write-back from ever matching the right line).
// `orderedQty`/`allocatedQty` are a snapshot taken at WO-creation time (not live-synced) -- purely so the WO's
// parts plan has real planned quantities to seed from; the Sales Order document remains the sole live source
// of truth for those fields going forward.
export interface SalesOrderLineRef {
  ref: string;
  kind: string;
  orderedQty: number;
  allocatedQty: number;
}

export interface WorkOrder {
  id: string;
  woNumber: string; // WO-2026-000001

  status: WorkOrderStatus;

  priority: Priority;
  severity?: Severity;

  type: WorkOrderType;

  customerId: string;
  locationId: string;

  // Cycle 7 demand-lineage link (see fulfillment/coordinatedVisit.ts's header comment). Optional: only Work
  // Orders created through the Sales Order -> Service seam (createServiceForSalesOrder) carry these.
  salesOrderId?: string;
  salesOrderLineRefs?: SalesOrderLineRef[];

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

  // WO Parts Planning Phase 2 -- set by setWorkOrderPartsPlan when the planned parts change. A SEPARATE
  // field again (not lastUpdated/updatedAt) so it's unambiguous which Cloud Function last touched the doc.
  partsPlanUpdatedAt?: Timestamp;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InventorySnapshotItem {
  sku: string;
  // Canonical Part identity (Phase 2). Additive/optional: legacy items may carry only `sku`. The governed
  // planning producer (setWorkOrderPartsPlan) writes BOTH `partId` (the projection/plan identity) and `sku`
  // (= the canonical Part internalPartNumber, kept so execution capture, which matches on `sku`, is unaffected -- never sku = partId). See docs/design/wo-parts-plan-command.md.
  partId?: string;
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
