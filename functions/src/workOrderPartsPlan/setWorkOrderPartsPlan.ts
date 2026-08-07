// WO Parts Planning — Phase 2: the DEDICATED GOVERNED PLANNED PRODUCER.
//
// Business action: "plan these parts for this Work Order." A deliberately separate callable from
// transitionWorkOrder (planning is an operational decision that happens BEFORE dispatch and changes
// independently of lifecycle transitions) and from updateWorkOrderExecutionData (which owns qtyUsed). It is
// NOT a generic persistence API — the intent is the governed business action, not "update an array".
//
// INVARIANT: PLAN PARTS != RESERVE PARTS != USE PARTS. This command writes ONLY qtyPlanned (+ the part
// identity + a planning timestamp) on WorkOrder.inventorySnapshot[]. It never reserves, consumes, moves,
// procures, or touches qtyUsed / required / returned / equipment authority. Reservation stays with the
// existing DISPATCHED -> reserveParts trigger; this command deliberately does NOT call triggerInventoryEffects.
//
// Authorization is a NEW governed capability `workOrder.parts.plan` (permissionCatalog, active:false =>
// fail-closed for everyone until a separate Owner grant). NOT a role/device/UI check. Readiness is NEVER a
// prerequisite: planning produces information the readiness projection consumes; readiness is a derived
// result, not an authorization gate.
//
// Structural pattern mirrors updateWorkOrderExecutionData.ts: onCall + a single runTransaction doing
// read-verify-write, touching only inventorySnapshot. firestore.rules already denies all direct client
// writes to fieldops_wos, so this is a Cloud Function, not a client write. Export != deploy; register != grant.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { WORK_ORDERS_COLLECTION } from "../constants/collections";
import type { WorkOrder, InventorySnapshotItem } from "../types/workOrder";

export const PLAN_CAPABILITY = "workOrder.parts.plan";

export interface PartsPlanLine {
  partId: string;
  sku?: string;
  name?: string;
  qtyPlanned: number;
}

export interface SetWorkOrderPartsPlanInput {
  workOrderId: string;
  plan: PartsPlanLine[];
}

// A typed, framework-independent error so the PURE core stays testable without the callable runtime; the
// callable maps `code` to the right HttpsError.
export class PartsPlanError extends Error {
  code: "INVALID" | "USED_PART_REMOVAL";
  constructor(code: "INVALID" | "USED_PART_REMOVAL", message: string) {
    super(message);
    this.code = code;
    this.name = "PartsPlanError";
  }
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

// Validate + normalize the business intent. PURE. Throws PartsPlanError("INVALID") — never a partial plan.
export function validatePartsPlan(raw: unknown): SetWorkOrderPartsPlanInput {
  const input = raw as Partial<SetWorkOrderPartsPlanInput> | null;
  if (!input || typeof input !== "object") throw new PartsPlanError("INVALID", "Request data must be an object.");
  if (!isNonEmptyString(input.workOrderId)) throw new PartsPlanError("INVALID", "workOrderId is required.");
  if (!Array.isArray(input.plan)) throw new PartsPlanError("INVALID", "plan must be a list.");

  const seen = new Set<string>();
  const plan: PartsPlanLine[] = [];
  for (const raw2 of input.plan) {
    const line = raw2 as Partial<PartsPlanLine> | null;
    if (!line || typeof line !== "object") throw new PartsPlanError("INVALID", "Each plan line must be an object.");
    if (!isNonEmptyString(line.partId)) throw new PartsPlanError("INVALID", "Each plan line requires a partId.");
    const partId = line.partId.trim();
    if (seen.has(partId)) throw new PartsPlanError("INVALID", `Duplicate partId "${partId}" in plan.`);
    if (!isPositiveInt(line.qtyPlanned)) throw new PartsPlanError("INVALID", "Each plan line requires a positive integer qtyPlanned.");
    seen.add(partId);
    plan.push({
      partId,
      sku: isNonEmptyString(line.sku) ? line.sku.trim() : undefined,
      name: isNonEmptyString(line.name) ? line.name.trim() : undefined,
      qtyPlanned: line.qtyPlanned,
    });
  }
  return { workOrderId: input.workOrderId.trim(), plan };
}

const itemKey = (it: InventorySnapshotItem): string => it.partId ?? it.sku;

// The AUTHORITATIVE merge. PURE. Computes the new inventorySnapshot from the current one + the validated
// plan. Writes ONLY qtyPlanned/identity; PRESERVES qtyUsed and other fields for kept parts; BLOCKS removing
// a part that already has recorded usage. `resolveSku` optionally maps a partId to its canonical SKU
// (Part Master); when absent the item keeps its prior sku, else falls back to the partId.
export function applyPartsPlan(
  current: InventorySnapshotItem[] | undefined,
  plan: PartsPlanLine[],
  resolveSku?: (partId: string) => string | undefined,
): InventorySnapshotItem[] {
  const existing = Array.isArray(current) ? current : [];
  const byKey = new Map<string, InventorySnapshotItem>();
  for (const it of existing) {
    const k = itemKey(it);
    if (k) byKey.set(k, it);
  }
  const planKeys = new Set(plan.map((p) => p.partId));

  // Invariant: a currently-planned part that already has usage cannot be un-planned.
  for (const it of existing) {
    const k = itemKey(it);
    if (k && !planKeys.has(k) && (it.qtyUsed ?? 0) > 0) {
      throw new PartsPlanError("USED_PART_REMOVAL", `Cannot remove planned part "${k}" — it already has recorded usage.`);
    }
  }

  return plan.map((line) => {
    const prev = byKey.get(line.partId);
    const sku = line.sku ?? resolveSku?.(line.partId) ?? prev?.sku ?? line.partId;
    const next: InventorySnapshotItem = {
      ...(prev ?? {}),
      partId: line.partId,
      sku,
      qtyPlanned: line.qtyPlanned,
    };
    if (line.name !== undefined) next.name = line.name;
    // qtyUsed and any other prior fields are carried through the spread above — planning never writes them.
    return next;
  });
}

function mapError(err: unknown): HttpsError {
  if (err instanceof PartsPlanError) {
    return new HttpsError(err.code === "USED_PART_REMOVAL" ? "failed-precondition" : "invalid-argument", err.message);
  }
  if (err instanceof HttpsError) return err;
  return new HttpsError("internal", "Could not set the parts plan.");
}

export const setWorkOrderPartsPlan = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  // Fail-closed capability check. A throwing resolver is treated as a denial (never an allow).
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: request.auth.uid, permissionIds: [PLAN_CAPABILITY] });
    allowed = decisions[PLAN_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to plan parts for a Work Order.");

  let input: SetWorkOrderPartsPlanInput;
  try {
    input = validatePartsPlan(request.data);
  } catch (err) {
    throw mapError(err);
  }

  const db = getFirestore();
  const woRef = db.collection(WORK_ORDERS_COLLECTION).doc(input.workOrderId);

  try {
    const plannedCount = await db.runTransaction(async (tx) => {
      const snap = await tx.get(woRef);
      if (!snap.exists) throw new HttpsError("not-found", `No Work Order with id ${input.workOrderId}`);
      const wo = snap.data() as WorkOrder;

      const nextSnapshot = applyPartsPlan(wo.inventorySnapshot, input.plan);
      // ONLY inventorySnapshot + a planning timestamp. Never status, assignment, reservation, or usage.
      tx.update(woRef, { inventorySnapshot: nextSnapshot, partsPlanUpdatedAt: FieldValue.serverTimestamp() });
      return nextSnapshot.length;
    });

    return { success: true as const, workOrderId: input.workOrderId, plannedCount };
  } catch (err) {
    throw mapError(err);
  }
});
