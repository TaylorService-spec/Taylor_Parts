// EPIC 7 -- EXECUTION INTELLIGENCE LAYER (CANONICAL, LOCKED)
//
// This module is the single source of truth for all execution
// analytics. All downstream systems (Epic 8+) MUST depend on these
// functions -- do not duplicate this logic elsewhere. Its three core
// functions (getTechnicianExecutionStats, normalizeQtyUsed,
// getWorkOrderExecutionSummary) are a frozen contract: behavior,
// signatures, and read-access characteristics do not change without a
// deliberate, explicit revision of this module itself.
//
// Epic 7 -- Inventory + Execution Analytics Foundation. A READ +
// AGGREGATION LAYER only -- nothing in this file writes anywhere.
// Every read here is one-shot, never a live subscription, per this
// epic's Step 6 -- this is analytics, not a live board.
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
// Read-access note: getWorkOrderExecutionSummary() and getTechnicianExecutionStats() (own figures) work for a
// technician on their own assignment and for the office. getInventoryConsumptionSnapshot() and
// getTechnicianVolumeBreakdown() are OFFICE aggregates -- the server refuses a caller without
// workOrder.record.read held unconditionally. Do not wire either of those two into a technician-facing screen.
//
// WORK ORDER CUTOVER STATUS (completed 2026-09-30 -- a DELIBERATE, EXPLICIT REVISION of this module's
// contract, per the Owner ruling "replace the three remaining Firestore Work Order aggregate reads with
// PostgreSQL queries over the active, non-quarantined Work Order set"). Nothing here reads Firestore now:
//   * getWorkOrderExecutionSummary() reads the governed detail (readWorkOrder);
//   * getTechnicianExecutionStats() / getInventoryConsumptionSnapshot() / getTechnicianVolumeBreakdown() call the
//     governed aggregates (readTechnicianExecutionStats / readWorkOrderConsumptionSnapshot /
//     readTechnicianVolumeBreakdown, functions/src/eosOps/workOrderAnalytics.ts), computed SERVER-side over the
//     active Work Order set with the definitions below kept.
// What changed, and why each is not a choice about the surface:
//   * a technician is an EMPLOYEE id (never a fieldops_technicians id). getTechnicianExecutionStats() with no
//     argument reads the CALLER'S OWN figures -- the server resolves the Employee from the login's link;
//   * "parts consumed" is recorded execution ACTUALS (no stock moves on the governed route);
//   * the two office aggregates need workOrder.record.read held unconditionally -- the server refuses anyone
//     else (FORBIDDEN), exactly where firestore.rules used to refuse the unfiltered scan.
// Failures THROW WorkOrderApiError (code = client category, reason = server code); a screen renders them through
// domain/workOrderOutcome.js. There is no fallback of any kind.
import {
  getWorkOrder,
  readTechnicianExecutionStats,
  readWorkOrderConsumptionSnapshot,
  readTechnicianVolumeBreakdown,
} from "../services/workOrderService";
import type { InventorySnapshotItem, ExecutionLogEntry } from "../types/workOrder";

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
  const wo = await getWorkOrder(workOrderId);
  if (!wo) return null;

  const partsUsed = normalizeQtyUsed(wo.inventorySnapshot);
  const executionLog = sortLogOldestFirst(wo.executionLog);

  return {
    workOrderId,
    totalPartsUsed: partsUsed.reduce((sum, p) => sum + p.quantity, 0),
    partsUsed,
    executionNotes: executionLog.map((entry) => entry.note),
    executionLog,
    lastUpdated: wo.lastUpdated?.toMillis?.() ?? wo.updatedAt?.toMillis?.() ?? null,
  };
}

export interface TechnicianExecutionStats {
  /** The EOS Employee these figures describe. */
  employeeId: string;
  displayName: string | null;
  totalWorkOrdersCompleted: number;
  totalPartsConsumed: number;
  averageCompletionTimeMs: number | null;
  /**
   * WHY THE AVERAGE IS ABSENT, when it is. "No job has both timestamps yet" and "a job's
   * timestamps contradict the lifecycle" are different facts, and a bare null cannot tell them
   * apart. Counted, never rendered as a duration.
   *
   * `missing` counts COMPLETED Work Orders outside the eligible duration population -- the one
   * this service has always defined as "only where both timestamps exist". Averaging over that
   * population is authorised, but it means "Avg. Job Duration" can describe fewer jobs than the
   * completion count beside it. That gap is COUNTED rather than silent.
   */
  completionEvidence: { valid: number; inverted: number; missing: number };
  workOrderVolumeByStatus: Record<string, number>;
}

// 2. getTechnicianExecutionStats(employeeId?) -- the governed aggregate, definitions unchanged:
//   * the population is the Employee's Work Orders on an OPEN governed assignment (the current assignee, as
//     Firestore's assignedTechId was);
//   * "Completed" is judged by whether completedAt was ever set (a Work Order since CLOSED still counts);
//   * averageCompletionTimeMs = mean(completedAt - workStartedAt) over Work Orders carrying both -- and ONE
//     inverted pair withdraws the whole figure (null), never abs(), never a clamp, never a swap;
//   * completionEvidence counts valid / inverted / completed-without-a-start.
// No employeeId: the caller's OWN figures.
export async function getTechnicianExecutionStats(employeeId?: string | null): Promise<TechnicianExecutionStats> {
  const s = await readTechnicianExecutionStats(employeeId ?? null);
  return {
    employeeId: s.employeeId,
    displayName: s.displayName ?? null,
    totalWorkOrdersCompleted: Number(s.totalWorkOrdersCompleted ?? 0),
    totalPartsConsumed: Number(s.totalPartsConsumed ?? 0),
    // A negative figure is contradictory evidence, not a duration: it is never passed through.
    averageCompletionTimeMs:
      typeof s.averageCompletionTimeMs === "number" && Number.isFinite(s.averageCompletionTimeMs) && s.averageCompletionTimeMs >= 0
        ? s.averageCompletionTimeMs
        : null,
    completionEvidence: {
      valid: Number(s.completionEvidence?.valid ?? 0),
      inverted: Number(s.completionEvidence?.inverted ?? 0),
      missing: Number(s.completionEvidence?.missing ?? 0),
    },
    workOrderVolumeByStatus: { ...(s.workOrderVolumeByStatus ?? {}) },
  };
}

export interface PartConsumption {
  partId: string;
  totalQuantityUsed: number;
  frequency: number; // number of distinct Work Orders that used this part
}

export interface InventoryConsumptionSnapshot {
  parts: PartConsumption[]; // sorted most-consumed first (ties by partId)
  mostConsumedPartId: string | null;
}

// 3. getInventoryConsumptionSnapshot() -- OFFICE ONLY (workOrder.record.read held unconditionally). Recorded
// execution actuals per Part across the active Work Order set: total used and the number of Work Orders.
export async function getInventoryConsumptionSnapshot(): Promise<InventoryConsumptionSnapshot> {
  const r = await readWorkOrderConsumptionSnapshot();
  const parts = (Array.isArray(r?.parts) ? r.parts : []).map((p) => ({
    partId: String(p.partId), totalQuantityUsed: Number(p.totalQuantityUsed), frequency: Number(p.frequency),
  }));
  return { parts, mostConsumedPartId: r?.mostConsumedPartId ?? parts[0]?.partId ?? null };
}

export interface TechnicianWorkOrderVolume {
  /** The EOS Employee. */
  employeeId: string;
  displayName: string | null;
  /** Not yet completed (no completedAt) -- which includes a CANCELLED one, as it always did. */
  activeCount: number;
  completedCount: number;
}

// Supports "busiest technicians" -- OFFICE ONLY, same gate as the consumption snapshot. One governed read, not
// one per technician.
export async function getTechnicianVolumeBreakdown(): Promise<TechnicianWorkOrderVolume[]> {
  const items = await readTechnicianVolumeBreakdown();
  return items.map((t) => ({
    employeeId: String(t.employeeId), displayName: t.displayName ?? null,
    activeCount: Number(t.activeCount), completedCount: Number(t.completedCount),
  }));
}
