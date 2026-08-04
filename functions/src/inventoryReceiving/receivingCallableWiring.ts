// Receiving Phase-2 E1: the REAL production seams the Receiving callables wire into the merged services.
// Repository-only. Everything reads THROUGH the caller's transaction (commit-time consistent). Nothing
// here is granted or deployed; inventory.stock.receive is registered-but-UNGRANTED, so the governed
// resolver denies every principal until a separate grant gate.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { isValidAccessVersionValue } from "../access/compactClaims.js";
import { stageAuditEvent } from "../access/auditEventWriter.js";
import { buildFirestorePartRepository } from "../partMaster/partMasterRepository.js";
import type { PartId } from "../partMaster/types.js";
import type { ReceiveAuditInput, ResolvedPart } from "./receiveInventoryStockCommand.js";

export const RECEIVE_CAPABILITY = "inventory.stock.receive";
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
// A non-scoped (global) governed capability.
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };

// Governed authorization for inventory.stock.receive, read THROUGH the transaction so a concurrent
// revocation conflicts the commit. Reads the actor's active roleAssignments + authoritative accessVersion,
// then runs the merged pure resolver. Returns true only on decision === "ALLOW" (never today: UNGRANTED).
export async function resolveReceivePermissionThroughTxn(txn: Transaction, db: Firestore, actorId: string): Promise<boolean> {
  if (typeof actorId !== "string" || actorId.trim() === "") return false;
  const userSnap = await txn.get(db.collection(USERS_COLLECTION).doc(actorId));
  const assignmentsSnap = await txn.get(
    db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", actorId).where("status", "==", "active"),
  );
  let accessVersion = 0;
  if (userSnap.exists) {
    const av = (userSnap.data() ?? {}).accessVersion;
    if (av !== undefined && av !== null) {
      if (!isValidAccessVersionValue(av)) return false; // malformed access data -> fail closed
      accessVersion = av as number;
    }
  }
  const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[];
  const result = resolveEffectivePermission({
    permissionId: RECEIVE_CAPABILITY,
    assignments,
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: accessVersion,
    target: GLOBAL_TARGET,
  });
  return result.decision === "ALLOW";
}

// First slice is NONE-only; the receiving validator rejects SERIAL/LOT. Map the Part-Master controlType
// vocabulary to the ledger trackingMode vocabulary; anything non-STANDARD becomes a non-NONE mode the
// validator will reject as "tracking mode not supported".
function controlTypeToTrackingMode(controlType: string): string {
  switch (controlType) {
    case "STANDARD": return "NONE";
    case "SERIALIZED": return "SERIAL";
    case "LOT": return "LOT";
    default: return "LOT";
  }
}

// The trusted Part authority, read through the txn: adapt the canonical Part to the command's ResolvedPart
// ({partId, trackingMode, active}). `active` = status === "ACTIVE".
export async function resolveReceivePartThroughTxn(txn: Transaction, db: Firestore, partId: string): Promise<ResolvedPart | null> {
  const stored = await buildFirestorePartRepository(db).getById(txn, partId as PartId);
  if (!stored) return null;
  return {
    partId: stored.part.partId,
    trackingMode: controlTypeToTrackingMode(stored.part.controlType),
    active: stored.part.status === "ACTIVE",
  };
}

// Adapt the command's ReceiveAuditInput to the immutable trusted audit writer, staged on the same txn
// (append-only). Uses the registered "receiveInventoryStock" AuditAction; summary is bounded + sanitized.
export function stageReceiveAuditEvent(txn: Transaction, a: ReceiveAuditInput): void {
  const summary = `Received qty ${a.quantity} of part ${a.partId} into ${a.locationType}:${a.locationId} (reorder ${a.reorderRequestId}, ledger ${a.ledgerEventId})`.slice(0, 500);
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: a.action,
    targetType: "receivingOrder",
    targetId: a.receivingId,
    outcome: "applied",
    summary,
  });
}
