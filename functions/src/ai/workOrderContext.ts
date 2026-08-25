import { AIError } from "./types";
import { INVENTORY_BALANCE_READ_CAPABILITY } from "../inventory/partBalanceReadService";

/**
 * SERVER-SIDE WORK ORDER CONTEXT AUTHORITY.
 *
 * This module does not call a model and does not read Firestore. It defines the exact authority a
 * trusted Work Order context assembler must enforce before reading anything with Admin SDK.
 *
 * Why a separate gate is necessary: Admin SDK bypasses firestore.rules. Therefore a future context
 * callable cannot simply "read the Work Order on the server" and assume the browser's Rules would
 * have allowed it. It must reproduce the existing Work Order read predicate before assembling facts.
 *
 * Existing firestore.rules authority, mirrored exactly:
 *   admin / dispatcher -> any fieldops_wos document
 *   technician         -> only when users/{uid}.technicianId == workOrder.assignedTechId
 *   everyone else      -> denied
 *
 * No `workOrder.read` capability exists in the current permission catalog. This module deliberately
 * does NOT invent one under an AI namespace. If the platform later introduces a governed Work Order
 * read capability, this is the seam to replace under its own authority decision.
 */

export type WorkOrderContextRole = "admin" | "dispatcher" | "technician" | string | null;

export interface WorkOrderContextActor {
  readonly authenticated: boolean;
  readonly role: WorkOrderContextRole;
  readonly technicianId: string | null;
}

export interface WorkOrderContextRecord {
  readonly assignedTechId?: string | null;
}

export interface WorkOrderContextAccess {
  readonly workOrderReadable: true;
  /** Inventory enrichment is a SECOND authority; Work Order visibility never implies it. */
  readonly inventoryBalanceReadable: boolean;
  readonly limitations: readonly string[];
}

/**
 * Prove the caller may read this Work Order under the same predicate as firestore.rules.
 * Throws before downstream context sources are consulted.
 */
export function assertWorkOrderContextReadable(
  actor: WorkOrderContextActor,
  workOrder: WorkOrderContextRecord,
): void {
  if (!actor.authenticated) {
    throw new AIError("AI_CAPABILITY_DENIED", "The caller is not authorized to read this Work Order.");
  }

  if (actor.role === "admin" || actor.role === "dispatcher") return;

  if (
    actor.role === "technician"
    && typeof actor.technicianId === "string"
    && actor.technicianId.length > 0
    && typeof workOrder.assignedTechId === "string"
    && workOrder.assignedTechId === actor.technicianId
  ) return;

  throw new AIError("AI_CAPABILITY_DENIED", "The caller is not authorized to read this Work Order.");
}

/**
 * Compose source-level authority after Work Order visibility is proven.
 *
 * Crucial rule: reading a Work Order does NOT grant inventory.balance.read. If the caller lacks that
 * existing capability, balance facts are omitted and the downstream readiness projection remains
 * UNKNOWN. AI is not an authority amplifier.
 */
export function resolveWorkOrderContextAccess(params: {
  readonly actor: WorkOrderContextActor;
  readonly workOrder: WorkOrderContextRecord;
  readonly capabilityDecisions?: Readonly<Record<string, boolean>>;
}): WorkOrderContextAccess {
  assertWorkOrderContextReadable(params.actor, params.workOrder);

  const inventoryBalanceReadable =
    params.capabilityDecisions?.[INVENTORY_BALANCE_READ_CAPABILITY] === true;

  return Object.freeze({
    workOrderReadable: true as const,
    inventoryBalanceReadable,
    limitations: Object.freeze(
      inventoryBalanceReadable ? [] : ["INVENTORY_BALANCE_NOT_AUTHORIZED"],
    ),
  });
}

/**
 * Model-safe/source-safe projection of the Work Order itself.
 *
 * Raw Firestore ids are intentionally absent. The internal assembler may use partId/customerId/etc.
 * to join governed sources, but those join keys do not cross the intelligence boundary merely
 * because they were useful to the server.
 */
export function sanitizeWorkOrderFacts(workOrder: Record<string, unknown>) {
  const snapshot = Array.isArray(workOrder.inventorySnapshot)
    ? workOrder.inventorySnapshot as Array<Record<string, unknown>>
    : [];

  return Object.freeze({
    schemaVersion: 1,
    subject: Object.freeze({
      type: "WORK_ORDER" as const,
      reference: cleanString(workOrder.woNumber),
      status: cleanString(workOrder.status),
      typeLabel: cleanString(workOrder.type),
      priority: cleanString(workOrder.priority),
    }),
    partsPlan: Object.freeze(snapshot
      .filter((line) => positiveNumber(line.qtyPlanned) > 0)
      .map((line) => Object.freeze({
        name: cleanString(line.name),
        sku: cleanString(line.sku),
        qtyPlanned: positiveNumber(line.qtyPlanned),
      }))),
  });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
