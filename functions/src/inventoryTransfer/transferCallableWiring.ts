// Enterprise Inventory Phase 4 -- the REAL production seams the transfer callables wire into the
// merged services. Mirrors receivingCallableWiring.ts. Nothing here is granted: every
// inventory.transfer.* capability is registered-but-UNGRANTED (active: false, no compatibility Role
// holds it), so the governed resolver denies every principal until a separate grant + activation gate.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { isValidAccessVersionValue } from "../access/compactClaims.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import type { Role } from "../types/access.js";
import { stageAuditEvent } from "../access/auditEventWriter.js";
import { buildFirestorePartRepository } from "../partMaster/partMasterRepository.js";
import type { PartId } from "../partMaster/types.js";
import type { ResolvedTransferPart, TransferAuditInput } from "./transferOrderCommand.js";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const TRANSFER_ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

export function makeResolveTransferPermissionThroughTxn(capability: string) {
  return async function resolve(txn: Transaction, db: Firestore, actorId: string): Promise<boolean> {
    if (typeof actorId !== "string" || actorId.trim() === "") return false;
    const userSnap = await txn.get(db.collection(USERS_COLLECTION).doc(actorId));
    const assignmentsSnap = await txn.get(
      db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", actorId).where("status", "==", "active"),
    );
    let accessVersion = 0;
    if (userSnap.exists) {
      const av = (userSnap.data() ?? {}).accessVersion;
      if (av !== undefined && av !== null) {
        if (!isValidAccessVersionValue(av)) return false;
        accessVersion = av as number;
      }
    }
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[];
    const result = resolveEffectivePermission({
      permissionId: capability,
      assignments,
      roles: TRANSFER_ROLE_CATALOG,
      currentAccessVersion: accessVersion,
      target: GLOBAL_TARGET,
    });
    return result.decision === "ALLOW";
  };
}

function controlTypeToTrackingMode(controlType: string): string {
  switch (controlType) {
    case "STANDARD":
      return "NONE";
    case "SERIALIZED":
      return "SERIAL";
    case "LOT":
      return "LOT";
    default:
      return "LOT";
  }
}

export async function resolveTransferPartThroughTxn(txn: Transaction, db: Firestore, partId: string): Promise<ResolvedTransferPart | null> {
  const stored = await buildFirestorePartRepository(db).getById(txn, partId as PartId);
  if (!stored) return null;
  return {
    partId: stored.part.partId,
    trackingMode: controlTypeToTrackingMode(stored.part.controlType),
    active: stored.part.status === "ACTIVE",
  };
}

export function stageTransferAuditEvent(txn: Transaction, a: TransferAuditInput): void {
  const serials = typeof a.serialCount === "number" ? `, ${a.serialCount} serial(s)` : "";
  const summary = `${a.action} qty ${a.quantity} of part ${a.partId}: ${a.origin.type}:${a.origin.locationId} -> ${a.destination.type}:${a.destination.locationId}${serials}`.slice(0, 500);
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: a.action,
    targetType: "transferOrder",
    targetId: a.transferOrderId,
    outcome: "applied",
    summary,
  });
}
