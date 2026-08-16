// Enterprise Inventory -- Cycle Count operating authority: the REAL production seams the callables wire
// into the merged services. Mirrors transferCallableWiring.ts. Nothing here is granted: every
// inventory.cycleCount.* capability is registered-but-UNGRANTED (active: false, no compatibility Role
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
import type { ResolvedCycleCountPart, CycleCountAuditInput } from "./cycleCountCommand.js";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const CYCLE_COUNT_ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

export function makeResolveCycleCountPermissionThroughTxn(capability: string) {
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
      roles: CYCLE_COUNT_ROLE_CATALOG,
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

export async function resolveCycleCountPartThroughTxn(txn: Transaction, db: Firestore, partId: string): Promise<ResolvedCycleCountPart | null> {
  const stored = await buildFirestorePartRepository(db).getById(txn, partId as PartId);
  if (!stored) return null;
  return {
    partId: stored.part.partId,
    trackingMode: controlTypeToTrackingMode(stored.part.controlType),
    active: stored.part.status === "ACTIVE",
  };
}

export function stageCycleCountAuditEvent(txn: Transaction, a: CycleCountAuditInput): void {
  const varianceText =
    a.variance !== undefined
      ? ` variance ${a.variance}`
      : a.serialVariance !== undefined
        ? ` missing ${a.serialVariance.missing.length}, unexpected ${a.serialVariance.unexpected.length}`
        : "";
  const summary = `${a.action} part ${a.partId} at ${a.location.type}:${a.location.locationId}${varianceText}`.slice(0, 500);
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: a.action,
    targetType: "cycleCount",
    targetId: a.cycleCountId,
    outcome: "applied",
    summary,
  });
}
