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
// IDENTITY (canonical): `partId` and `sku` are DISTINCT governed identifiers.
//   partId  -> canonical Part Master identity (the parts/{partId} doc).
//   sku     -> a compatibility/display identifier that MUST equal the canonical Part's `internalPartNumber`
//              (kept so the live updateWorkOrderExecutionData, which matches by `sku`, is unaffected).
// We NEVER fabricate `sku = partId` and NEVER infer `partId == sku`. sku is resolved from Part Master; if a
// canonical Part or its internalPartNumber cannot be resolved, the command FAILS CLOSED.
//
// Authorization is a NEW governed capability `workOrder.parts.plan` (permissionCatalog, active:false =>
// fail-closed for everyone until a separate Owner grant). NOT a role/device/UI check. Readiness is NEVER a
// prerequisite. Structural pattern mirrors updateWorkOrderExecutionData.ts: onCall + one runTransaction
// doing read-verify-write. Export != deploy; register != grant.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { WORK_ORDERS_COLLECTION } from "../constants/collections";
import { PARTS_COLLECTION } from "../partMaster/partMasterRepository";
import { TERMINAL_STATUSES } from "../transitionEngine";
import type { WorkOrder, InventorySnapshotItem, WorkOrderStatus } from "../types/workOrder";

export const PLAN_CAPABILITY = "workOrder.parts.plan";

export interface PartsPlanLine {
  partId: string;
  name?: string;
  qtyPlanned: number;
}

export interface SetWorkOrderPartsPlanInput {
  workOrderId: string;
  plan: PartsPlanLine[];
}

// The canonical resolution of one partId against Part Master. `found` = the parts/{partId} doc exists;
// `sku` = its `internalPartNumber` (null when the field is missing/invalid). Never fabricated.
export interface ResolvedPart {
  found: boolean;
  sku: string | null;
}
export type PartResolver = (partId: string) => ResolvedPart;

// A typed, framework-independent error so the PURE core stays testable without the callable runtime; the
// callable maps `code` to the right HttpsError. Only INVALID is a bad request; every other code is a
// governed precondition failure (fail-closed).
export type PartsPlanErrorCode =
  | "INVALID"
  | "PART_NOT_FOUND"
  | "SKU_UNRESOLVED"
  | "SKU_CONFLICT"
  | "IDENTITY_AMBIGUOUS"
  | "USED_PART_REMOVAL"
  | "TERMINAL_WORK_ORDER";

export class PartsPlanError extends Error {
  code: PartsPlanErrorCode;
  constructor(code: PartsPlanErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PartsPlanError";
  }
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

// Terminal-status guard (P0.2). A COMPLETED/CLOSED/CANCELLED Work Order is final: there is no
// reservation/consumption effect left to reconcile a rewritten plan against, so silently accepting one would
// misrepresent a finished/dead job. Uses the SAME canonical TERMINAL_STATUSES set as
// updateWorkOrderExecutionData.ts / transitionEngine.ts -- never a locally re-derived list. PURE: takes only
// the status, so it stays testable without the callable/transaction runtime (same rationale as the rest of
// this file's PartsPlanError core).
export function assertPlannable(status: WorkOrderStatus | undefined): void {
  if (status && TERMINAL_STATUSES.has(status)) {
    throw new PartsPlanError(
      "TERMINAL_WORK_ORDER",
      `Cannot change the parts plan on a terminal Work Order (status: ${status}).`,
    );
  }
}

// Validate + normalize the business intent. PURE. Throws PartsPlanError("INVALID") — never a partial plan.
// Note: a client-supplied `sku` is deliberately NOT accepted — sku is resolved canonically from Part Master.
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
    plan.push({ partId, name: isNonEmptyString(line.name) ? line.name.trim() : undefined, qtyPlanned: line.qtyPlanned });
  }
  return { workOrderId: input.workOrderId.trim(), plan };
}

// The AUTHORITATIVE merge. PURE (Part Master resolution is injected). Computes the new inventorySnapshot
// from the current one + the validated plan, deriving each item's canonical sku from Part Master.
//
// Fail-closed identity rules (Owner-ratified):
//   - Every plan line's partId MUST resolve to a canonical Part (found) with a valid internalPartNumber
//     (the sku). Otherwise FAIL CLOSED (PART_NOT_FOUND / SKU_UNRESOLVED). Never fabricate sku = partId.
//   - Match an existing row by canonical partId, OR a LEGACY (partId-less) row whose sku === canonical sku.
//     More than one match => IDENTITY_AMBIGUOUS (fail closed; never silently choose or duplicate).
//   - A partId-identified row whose stored sku disagrees with the canonical internalPartNumber =>
//     SKU_CONFLICT (fail closed; never silently "fix" an inconsistent governed record).
//   - On match: preserve the row (qtyUsed + unrelated fields), backfill canonical partId, set sku to the
//     canonical internalPartNumber, update qtyPlanned. A prior sku is retained only because it was proven
//     equal to the canonical sku (that is how the legacy row matched); it is never retained arbitrarily.
//   - A currently-planned part with recorded usage cannot be un-planned (USED_PART_REMOVAL).
export function applyPartsPlan(
  current: InventorySnapshotItem[] | undefined,
  plan: PartsPlanLine[],
  resolvePart: PartResolver,
): InventorySnapshotItem[] {
  const existing = Array.isArray(current) ? current : [];

  // 1) Resolve canonical sku for every plan line up front; fail closed on any unresolved identity.
  const canonicalSku = new Map<string, string>();
  for (const line of plan) {
    const r = resolvePart(line.partId);
    if (!r.found) throw new PartsPlanError("PART_NOT_FOUND", `No canonical Part record for partId "${line.partId}".`);
    if (!isNonEmptyString(r.sku)) throw new PartsPlanError("SKU_UNRESOLVED", `Canonical Part "${line.partId}" has no valid internalPartNumber.`);
    canonicalSku.set(line.partId, r.sku.trim());
  }

  // 2) Removal-guard: an existing planned part NOT represented in the new plan cannot be dropped if it has
  //    recorded usage. "Represented" = same partId, or a legacy (partId-less) row whose sku equals a
  //    canonical sku in the plan.
  const planPartIds = new Set(plan.map((p) => p.partId));
  const planSkus = new Set([...canonicalSku.values()]);
  for (const it of existing) {
    const represented = (it.partId && planPartIds.has(it.partId)) || (!it.partId && planSkus.has(it.sku));
    if (!represented && (it.qtyUsed ?? 0) > 0) {
      throw new PartsPlanError("USED_PART_REMOVAL", `Cannot remove planned part "${it.partId ?? it.sku}" — it already has recorded usage.`);
    }
  }

  // 3) Build the next snapshot from the plan, matching + merging each line against existing rows.
  return plan.map((line) => {
    const sku = canonicalSku.get(line.partId) as string;
    const matches = existing.filter(
      (it) => (it.partId ? it.partId === line.partId : it.sku === sku),
    );
    if (matches.length > 1) {
      throw new PartsPlanError("IDENTITY_AMBIGUOUS", `Ambiguous existing identity for partId "${line.partId}" — refuse to guess.`);
    }
    const prev = matches[0];
    if (prev && prev.partId === line.partId && isNonEmptyString(prev.sku) && prev.sku !== sku) {
      throw new PartsPlanError("SKU_CONFLICT", `Stored sku for partId "${line.partId}" conflicts with the canonical internalPartNumber.`);
    }

    const item: InventorySnapshotItem = {
      ...(prev ?? {}),
      partId: line.partId, // backfill / set canonical identity
      sku, // canonical internalPartNumber — NEVER partId
      qtyPlanned: line.qtyPlanned,
    };
    if (line.name !== undefined) item.name = line.name;
    return item; // qtyUsed + unrelated fields carried through the spread; planning never writes them
  });
}

function mapError(err: unknown): HttpsError {
  if (err instanceof PartsPlanError) {
    return new HttpsError(err.code === "INVALID" ? "invalid-argument" : "failed-precondition", err.message);
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
  const partsCol = db.collection(PARTS_COLLECTION);
  const distinctPartIds = [...new Set(input.plan.map((l) => l.partId))];

  try {
    const plannedCount = await db.runTransaction(async (tx) => {
      // All reads BEFORE any write (Firestore transaction rule): the WO + every referenced Part.
      const [woSnap, ...partSnaps] = await Promise.all([
        tx.get(woRef),
        ...distinctPartIds.map((id) => tx.get(partsCol.doc(id))),
      ]);
      if (!woSnap.exists) throw new HttpsError("not-found", `No Work Order with id ${input.workOrderId}`);

      const resolved = new Map<string, ResolvedPart>();
      distinctPartIds.forEach((id, i) => {
        const s = partSnaps[i];
        if (!s.exists) {
          resolved.set(id, { found: false, sku: null });
        } else {
          const ipn = (s.data() as { internalPartNumber?: unknown }).internalPartNumber;
          resolved.set(id, { found: true, sku: typeof ipn === "string" && ipn.trim().length > 0 ? ipn.trim() : null });
        }
      });

      const wo = woSnap.data() as WorkOrder;
      assertPlannable(wo.status);
      const nextSnapshot = applyPartsPlan(wo.inventorySnapshot, input.plan, (id) => resolved.get(id) ?? { found: false, sku: null });

      // ONLY inventorySnapshot + a planning timestamp. Never status, assignment, reservation, or usage.
      tx.update(woRef, { inventorySnapshot: nextSnapshot, partsPlanUpdatedAt: FieldValue.serverTimestamp() });
      return nextSnapshot.length;
    });

    return { success: true as const, workOrderId: input.workOrderId, plannedCount };
  } catch (err) {
    throw mapError(err);
  }
});
