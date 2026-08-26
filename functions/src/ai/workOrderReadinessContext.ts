import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getCallerContext } from "../callerContext";
import { WORK_ORDERS_COLLECTION, INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import {
  INVENTORY_BALANCE_READ_CAPABILITY,
  type PartBalanceProjection,
} from "../inventory/partBalanceReadService";
import { readPartBalances } from "../inventory/partBalanceBatchReadService";
import { buildFirestorePartRepository } from "../partMaster/partMasterRepository";
import { isSerialTracked } from "../partMaster/controlTypeTrackingMode";
import type { PartId } from "../partMaster/types";
import { openWorkOrderReserved } from "../fulfillment/fulfillmentAvailability";
import {
  assertWorkOrderContextReadable,
  resolveWorkOrderContextAccess,
  sanitizeWorkOrderFacts,
  type WorkOrderContextActor,
} from "./workOrderContext";
import { strongestReadinessProcurementStatus } from "./workOrderReadinessSources";
import { AIError } from "./types";

const REORDER_REQUESTS_COLLECTION = "reorder_requests";

export interface WorkOrderReadinessSourceLine {
  readonly name: string | null;
  readonly sku: string | null;
  readonly qtyPlanned: number;
  readonly qtyUsed: number;
  readonly reservedForJob: number;
  readonly warehouse: Readonly<{ status: "KNOWN"; available: number } | { status: "UNKNOWN" } | { status: "UNAVAILABLE" }>;
  readonly truck: Readonly<{ status: "UNAVAILABLE" }>;
  readonly procurement: Readonly<{ status: "PENDING" | "ORDERED" | "RECEIVED" | "NONE" }>;
}

export interface WorkOrderReadinessContextResult {
  readonly schemaVersion: 1;
  readonly subject: ReturnType<typeof sanitizeWorkOrderFacts>["subject"];
  readonly plannedParts: readonly WorkOrderReadinessSourceLine[];
  readonly capabilities: Readonly<{
    warehouse: boolean;
    truckInventory: false;
    purchasing: boolean;
    // Mirrors ONLY the existing READY reorder-create branch in firestore.rules. It creates no
    // capability and grants nothing; the eventual client write is still independently rechecked.
    requestReorder: boolean;
  }>;
  readonly limitations: readonly string[];
}

interface PlannedInternalLine {
  readonly partId: string | null;
  readonly name: string | null;
  readonly sku: string | null;
  readonly qtyPlanned: number;
  readonly qtyUsed: number;
}

export interface WorkOrderReadinessContextDependencies {
  readonly loadCaller: (uid: string) => Promise<{ role: string | null; technicianId: string | null }>;
  readonly loadWorkOrder: (workOrderId: string) => Promise<Record<string, unknown> | null>;
  readonly resolveInventoryBalanceAccess: (uid: string) => Promise<boolean>;
  readonly loadBalances: (partIds: readonly string[]) => Promise<readonly PartBalanceProjection[]>;
  readonly loadReservationRows: (workOrderId: string) => Promise<readonly Record<string, unknown>[]>;
  readonly loadReorderRows: (workOrderId: string) => Promise<readonly Record<string, unknown>[]>;
}

export async function assembleWorkOrderReadinessContext(
  input: { principalUid: string; workOrderId: string },
  deps: WorkOrderReadinessContextDependencies,
): Promise<WorkOrderReadinessContextResult> {
  const caller = await deps.loadCaller(input.principalUid);
  const workOrder = await deps.loadWorkOrder(input.workOrderId);
  if (!workOrder) throw new HttpsError("not-found", "No such work order.");

  const actor: WorkOrderContextActor = {
    authenticated: true,
    role: caller.role,
    technicianId: caller.technicianId,
  };
  assertWorkOrderContextReadable(actor, {
    assignedTechId: typeof workOrder.assignedTechId === "string" ? workOrder.assignedTechId : null,
  });

  let inventoryBalanceReadable = false;
  try {
    inventoryBalanceReadable = await deps.resolveInventoryBalanceAccess(input.principalUid);
  } catch {
    inventoryBalanceReadable = false;
  }

  const access = resolveWorkOrderContextAccess({
    actor,
    workOrder: {
      assignedTechId: typeof workOrder.assignedTechId === "string" ? workOrder.assignedTechId : null,
    },
    capabilityDecisions: {
      [INVENTORY_BALANCE_READ_CAPABILITY]: inventoryBalanceReadable,
    },
  });

  // Reorder Request client-read authority is broad only for admin/dispatcher. Other roles have
  // request-specific predicates, so a server-side WO query could over-return for them. Until a
  // dedicated governed procurement read exists, only this exact broad Rules branch is mirrored.
  const procurementReadable = caller.role === "admin" || caller.role === "dispatcher";

  // EXISTING ACTION ELIGIBILITY, NOT A NEW AUTHORITY. The READY reorder-request create branch in
  // firestore.rules is admin/dispatcher-only. Exposing that boolean lets intelligence decide whether
  // the already-existing requestReorderForRecommendation action may be PROPOSED. If a human accepts,
  // firestore.rules evaluates the write again from current user state; this boolean is never trusted
  // as authorization by the write path.
  const requestReorderEligible = caller.role === "admin" || caller.role === "dispatcher";

  const internalPlan = plannedLines(workOrder);
  const canonicalPartIds = [...new Set(internalPlan
    .map((line) => line.partId)
    .filter((value): value is string => typeof value === "string" && value.length > 0))];

  const [balances, reservationRows, reorderRows] = await Promise.all([
    access.inventoryBalanceReadable && canonicalPartIds.length > 0
      ? deps.loadBalances(canonicalPartIds)
      : Promise.resolve([]),
    access.inventoryBalanceReadable && canonicalPartIds.length > 0
      ? deps.loadReservationRows(input.workOrderId)
      : Promise.resolve([]),
    procurementReadable && canonicalPartIds.length > 0
      ? deps.loadReorderRows(input.workOrderId)
      : Promise.resolve([]),
  ]);

  const balanceByPart = new Map(balances.map((balance) => [balance.partId, balance]));
  const reservationsByPart = groupRowsByPartId(reservationRows);
  const reordersByPart = groupRowsByPartId(reorderRows);

  const plannedParts = internalPlan.map((line): WorkOrderReadinessSourceLine => {
    const balance = line.partId ? balanceByPart.get(line.partId) : undefined;
    const reservation = line.partId
      ? openWorkOrderReserved((reservationsByPart.get(line.partId) ?? []) as Array<{ type: string; quantity: number; workOrderId?: string }>)
      : 0;
    const procurement = line.partId && procurementReadable
      ? strongestReadinessProcurementStatus((reordersByPart.get(line.partId) ?? []).map((row) => row.status))
      : "NONE";

    return Object.freeze({
      name: line.name,
      sku: line.sku,
      qtyPlanned: line.qtyPlanned,
      qtyUsed: line.qtyUsed,
      reservedForJob: reservation,
      warehouse: warehouseDimension(balance, access.inventoryBalanceReadable),
      // No authoritative MOBILE/truck quantity source exists yet. This is a capability absence,
      // never a guessed zero.
      truck: Object.freeze({ status: "UNAVAILABLE" as const }),
      procurement: Object.freeze({ status: procurement }),
    });
  });

  const facts = sanitizeWorkOrderFacts(workOrder);
  const limitations = [
    ...access.limitations,
    ...(procurementReadable ? [] : ["PROCUREMENT_READ_NOT_AUTHORIZED"]),
    "TRUCK_INVENTORY_UNAVAILABLE",
  ];

  return Object.freeze({
    schemaVersion: 1 as const,
    subject: facts.subject,
    plannedParts: Object.freeze(plannedParts),
    capabilities: Object.freeze({
      warehouse: access.inventoryBalanceReadable,
      truckInventory: false as const,
      purchasing: procurementReadable,
      requestReorder: requestReorderEligible,
    }),
    limitations: Object.freeze(limitations),
  });
}

function plannedLines(workOrder: Record<string, unknown>): PlannedInternalLine[] {
  const snapshot = Array.isArray(workOrder.inventorySnapshot)
    ? workOrder.inventorySnapshot as Array<Record<string, unknown>>
    : [];
  return snapshot
    .filter((line) => positiveNumber(line.qtyPlanned) > 0)
    .map((line) => ({
      partId: cleanString(line.partId),
      name: cleanString(line.name),
      sku: cleanString(line.sku),
      qtyPlanned: positiveNumber(line.qtyPlanned),
      qtyUsed: positiveNumber(line.qtyUsed),
    }));
}

function groupRowsByPartId(rows: readonly Record<string, unknown>[]) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const partId = cleanString(row.partId);
    if (!partId) continue;
    const current = grouped.get(partId) ?? [];
    current.push(row);
    grouped.set(partId, current);
  }
  return grouped;
}

function warehouseDimension(balance: PartBalanceProjection | undefined, enabled: boolean) {
  if (!enabled) return Object.freeze({ status: "UNAVAILABLE" as const });
  if (!balance || balance.available.state !== "KNOWN" || typeof balance.available.value !== "number") {
    return Object.freeze({ status: "UNKNOWN" as const });
  }
  return Object.freeze({ status: "KNOWN" as const, available: Math.max(0, balance.available.value) });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function realDependencies(db: Firestore): WorkOrderReadinessContextDependencies {
  return {
    loadCaller: (uid) => getCallerContext(uid),
    loadWorkOrder: async (workOrderId) => {
      const snap = await db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId).get();
      return snap.exists ? (snap.data() as Record<string, unknown>) : null;
    },
    resolveInventoryBalanceAccess: async (uid) => {
      const { decisions } = await resolveEffectiveAccess({
        principalUid: uid,
        permissionIds: [INVENTORY_BALANCE_READ_CAPABILITY],
      }, { db });
      return decisions[INVENTORY_BALANCE_READ_CAPABILITY] === true;
    },
    loadBalances: async (partIds) => {
      const repository = buildFirestorePartRepository(db);
      const stored = await Promise.all(partIds.map((id) => repository.getById(null, id as PartId)));
      const serialTrackedByPartId = new Map<string, boolean>(
        stored
          .map((record, i) => record === null ? null : [partIds[i], isSerialTracked(record.part.controlType)] as const)
          .filter((entry): entry is readonly [string, boolean] => entry !== null),
      );
      return readPartBalances(db, partIds, serialTrackedByPartId);
    },
    loadReservationRows: async (workOrderId) => {
      const snap = await db.collection(INVENTORY_TRANSACTIONS_COLLECTION)
        .where("workOrderId", "==", workOrderId)
        .get();
      return snap.docs.map((doc) => doc.data() as Record<string, unknown>);
    },
    loadReorderRows: async (workOrderId) => {
      const snap = await db.collection(REORDER_REQUESTS_COLLECTION)
        .where("workOrderId", "==", workOrderId)
        .get();
      return snap.docs.map((doc) => doc.data() as Record<string, unknown>);
    },
  };
}

export const getWorkOrderReadinessContext = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const workOrderId = cleanString((request.data as { workOrderId?: unknown } | null)?.workOrderId);
  if (!workOrderId) throw new HttpsError("invalid-argument", "workOrderId is required.");

  try {
    const db = getFirestore();
    return await assembleWorkOrderReadinessContext(
      { principalUid: request.auth.uid, workOrderId },
      realDependencies(db),
    );
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof AIError && err.code === "AI_CAPABILITY_DENIED") {
      throw new HttpsError("permission-denied", "You are not authorized to read this Work Order.");
    }
    console.error("[getWorkOrderReadinessContext] failed", err);
    throw new HttpsError("internal", "The readiness context could not be assembled.");
  }
});