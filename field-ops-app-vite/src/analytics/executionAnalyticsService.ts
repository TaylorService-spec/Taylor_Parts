// Epic 7 -- Inventory + Execution Analytics Foundation. A READ +
// AGGREGATION LAYER only -- nothing in this file writes anywhere.
// Every read here uses getDoc/getDocs (one-shot), never onSnapshot,
// per this epic's Step 6 -- this is analytics, not a live board.
//
// Not a transactional inventory system: this only reads and
// summarizes execution data already written by Epic 6.3's
// updateWorkOrderExecutionData Cloud Function
// (qtyUsed/executionLog/lastUpdated) and the real lifecycle timestamps
// transitionWorkOrder() already writes (workStartedAt/completedAt).
// Nothing here calls transitionWorkOrder() or
// updateWorkOrderExecutionData(), touches transitionEngine.ts, or
// introduces a new Cloud Function.
//
// Correction from the epic brief: there is no separate `executionNotes`
// field anywhere in the WorkOrder schema -- Phase 6.3 deliberately
// chose a single append-only `executionLog[]` (arrayUnion) over a
// second overwritable string field, specifically for concurrency
// safety (see docs/CLAUDE_CONTEXT.md rule 10 /
// docs/architecture/SYSTEM_AUTHORITIES.md's execution-data row).
// "executionNotes" below is therefore derived FROM executionLog (each
// entry's `.note`), not a distinct field being read.
//
// Read-access note: getWorkOrderExecutionSummary() (single-document
// getDoc) works for both technician (their own assignment) and
// admin/dispatcher roles, per firestore.rules' per-document
// isOwnTechnician() check. getTechnicianExecutionStats() uses the same
// assignedTechId-scoped query pattern as PT-002's
// subscribeAssignedWorkOrders() (one-shot here, not live), so it also
// works for a technician viewing their own stats.
// getInventoryConsumptionSnapshot() and getTechnicianVolumeBreakdown()
// do an UNFILTERED full-collection read -- per firestore.rules, that
// only succeeds for admin/dispatcher roles (isAdminOrDispatcher()
// doesn't depend on resource.data, so it's provable for every
// document; a technician's isOwnTechnician() check depends on
// per-document data an unfiltered query doesn't constrain, so Firestore
// rejects the whole query for that role -- same reasoning documented
// on subscribeAssignedWorkOrders()'s header comment). Do not wire
// either of those two into a technician-facing screen.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
import type { WorkOrder, InventorySnapshotItem, ExecutionLogEntry } from "../types/workOrder";

export interface NormalizedPartUsage {
  partId: string;
  quantity: number;
}

// Step 3 -- required normalization helper. inventorySnapshot items key
// usage by `sku` (see types/workOrder.ts's InventorySnapshotItem) --
// there is no `partId` field anywhere in that schema. This maps
// sku -> partId purely as an analytics-facing naming choice (matching
// the epic brief's requested output shape); it is not a schema change,
// no new field is added or read that doesn't already exist. Only items
// with qtyUsed > 0 are included -- an item with no usage yet
// contributes nothing to analytics.
export function normalizeQtyUsed(inventorySnapshot: InventorySnapshotItem[] = []): NormalizedPartUsage[] {
  return inventorySnapshot
    .filter((item) => (item.qtyUsed ?? 0) > 0)
    .map((item) => ({ partId: item.sku, quantity: item.qtyUsed ?? 0 }));
}

function sortLogOldestFirst(log: ExecutionLogEntry[] = []): ExecutionLogEntry[] {
  return [...log].sort((a, b) => (a.at?.toMillis?.() ?? 0) - (b.at?.toMillis?.() ?? 0));
}

export interface WorkOrderExecutionSummary {
  workOrderId: string;
  totalPartsUsed: number;
  partsUsed: NormalizedPartUsage[];
  executionNotes: string[]; // derived from executionLog -- see header comment
  executionLog: ExecutionLogEntry[]; // full timeline, oldest first
  lastUpdated: number | null; // epoch ms, null if never touched by updateWorkOrderExecutionData
}

// 1. getWorkOrderExecutionSummary(workOrderId)
export async function getWorkOrderExecutionSummary(workOrderId: string): Promise<WorkOrderExecutionSummary | null> {
  const snap = await getDoc(doc(db, WORK_ORDERS_COLLECTION, workOrderId));
  if (!snap.exists()) return null;

  const wo = snap.data() as WorkOrder;
  const partsUsed = normalizeQtyUsed(wo.inventorySnapshot);
  const executionLog = sortLogOldestFirst(wo.executionLog);

  return {
    workOrderId,
    totalPartsUsed: partsUsed.reduce((sum, p) => sum + p.quantity, 0),
    partsUsed,
    executionNotes: executionLog.map((entry) => entry.note),
    executionLog,
    lastUpdated: wo.lastUpdated?.toMillis?.() ?? null,
  };
}

export interface TechnicianExecutionStats {
  technicianId: string;
  totalWorkOrdersCompleted: number;
  totalPartsConsumed: number;
  averageCompletionTimeMs: number | null;
  workOrderVolumeByStatus: Record<string, number>;
}

// 2. getTechnicianExecutionStats(technicianId) -- scoped query, same
// pattern as PT-002's subscribeAssignedWorkOrders(), one-shot instead
// of live. "Completed" is judged by whether completedAt was ever set
// (the Complete action sets it once and it's never cleared), not by
// current status -- a WO that's since been CLOSED by a dispatcher
// still counts as completed by this technician.
// averageCompletionTimeMs uses the real workStartedAt/completedAt
// lifecycle timestamps (already written by transitionWorkOrder(), not
// anything new) -- only over Work Orders where both exist.
export async function getTechnicianExecutionStats(technicianId: string): Promise<TechnicianExecutionStats> {
  const q = query(collection(db, WORK_ORDERS_COLLECTION), where("assignedTechId", "==", technicianId));
  const snap = await getDocs(q);
  const workOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrder);

  const workOrderVolumeByStatus: Record<string, number> = {};
  let totalPartsConsumed = 0;
  let totalWorkOrdersCompleted = 0;
  const completionDurations: number[] = [];

  for (const wo of workOrders) {
    workOrderVolumeByStatus[wo.status] = (workOrderVolumeByStatus[wo.status] ?? 0) + 1;
    totalPartsConsumed += normalizeQtyUsed(wo.inventorySnapshot).reduce((sum, p) => sum + p.quantity, 0);
    if (wo.completedAt) totalWorkOrdersCompleted += 1;
    if (wo.workStartedAt?.toMillis && wo.completedAt?.toMillis) {
      completionDurations.push(wo.completedAt.toMillis() - wo.workStartedAt.toMillis());
    }
  }

  const averageCompletionTimeMs =
    completionDurations.length > 0 ? completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length : null;

  return { technicianId, totalWorkOrdersCompleted, totalPartsConsumed, averageCompletionTimeMs, workOrderVolumeByStatus };
}

export interface PartConsumption {
  partId: string;
  totalQuantityUsed: number;
  frequency: number; // number of distinct Work Orders that used this part
}

export interface InventoryConsumptionSnapshot {
  parts: PartConsumption[]; // sorted most-consumed first
  mostConsumedPartId: string | null;
}

// 3. getInventoryConsumptionSnapshot() -- ADMIN/DISPATCHER ONLY (see
// header comment on why). Full collection scan -- acceptable for a
// one-shot analytics read at this repo's current data scale; see Step 7
// / this file's header for the future server-side-aggregation caveat
// if that changes.
export async function getInventoryConsumptionSnapshot(): Promise<InventoryConsumptionSnapshot> {
  const snap = await getDocs(collection(db, WORK_ORDERS_COLLECTION));
  const totals = new Map<string, { totalQuantityUsed: number; frequency: number }>();

  snap.docs.forEach((d) => {
    const wo = d.data() as WorkOrder;
    for (const { partId, quantity } of normalizeQtyUsed(wo.inventorySnapshot)) {
      const entry = totals.get(partId) ?? { totalQuantityUsed: 0, frequency: 0 };
      entry.totalQuantityUsed += quantity;
      entry.frequency += 1;
      totals.set(partId, entry);
    }
  });

  const parts = [...totals.entries()]
    .map(([partId, v]) => ({ partId, ...v }))
    .sort((a, b) => b.totalQuantityUsed - a.totalQuantityUsed);

  return { parts, mostConsumedPartId: parts[0]?.partId ?? null };
}

export interface TechnicianWorkOrderVolume {
  technicianId: string;
  activeCount: number;
  completedCount: number;
}

// Additional helper beyond the 3 named functions the epic brief
// requested -- supports Step 5's "busiest technicians" without a
// second full-collection scan per technician (which N separate
// getTechnicianExecutionStats() calls would require). Same
// ADMIN/DISPATCHER-ONLY read-access restriction as
// getInventoryConsumptionSnapshot(), same reason.
export async function getTechnicianVolumeBreakdown(): Promise<TechnicianWorkOrderVolume[]> {
  const snap = await getDocs(collection(db, WORK_ORDERS_COLLECTION));
  const byTech = new Map<string, { active: number; completed: number }>();

  snap.docs.forEach((d) => {
    const wo = d.data() as WorkOrder;
    if (!wo.assignedTechId) return;
    const entry = byTech.get(wo.assignedTechId) ?? { active: 0, completed: 0 };
    if (wo.completedAt) entry.completed += 1;
    else entry.active += 1;
    byTech.set(wo.assignedTechId, entry);
  });

  return [...byTech.entries()]
    .map(([technicianId, v]) => ({ technicianId, activeCount: v.active, completedCount: v.completed }))
    .sort((a, b) => b.completedCount - a.completedCount);
}
