// Production seams for acquireSerializedAsset: real authorization, the real Part authority, the real
// governed-warehouse resolver, real audit.
//
// The location resolver is REUSED, not rewritten. Receiving already answers "is this an active
// governed warehouse" through makeResolveWarehouseLocationActive, and an acquisition that accepted a
// location receiving would reject would be a second, weaker answer to a question one authority
// already owns.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { isValidAccessVersionValue } from "../access/compactClaims.js";
import { stageAuditEvent } from "../access/auditEventWriter.js";
import { makeResolveWarehouseLocationActive } from "../inventoryReceiving/receivingLocationResolver.js";
import { resolveReceivePartThroughTxn } from "../inventoryReceiving/receivingCallableWiring.js";
import type { Role } from "../types/access.js";
import type { AcquireAuditInput, ResolvedAcquirePart } from "./acquireSerializedAssetCommand.js";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const ACQUIRE_ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

export function makeResolveAcquirePermissionThroughTxn(capability: string) {
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
      roles: ACQUIRE_ROLE_CATALOG,
      currentAccessVersion: accessVersion,
      target: GLOBAL_TARGET,
      activationOverrides: resolveRuntimeCapabilityOverrides(),
    });
    return result.decision === "ALLOW";
  };
}

// The Part authority receiving already uses, adapted to this command's shape. Reusing it is what
// guarantees "SERIAL" means the same thing on both paths.
export async function resolveAcquirePartThroughTxn(
  txn: Transaction, db: Firestore, partId: string,
): Promise<ResolvedAcquirePart | null> {
  return resolveReceivePartThroughTxn(txn, db, partId);
}

// A company location, resolved by the governed-warehouse validator receiving uses. A customer's
// location can never satisfy it, which is the property that matters here: a unit is not installed
// merely by being acquired.
export function makeResolveAcquireLocationActive(db: Firestore) {
  const resolveWarehouse = makeResolveWarehouseLocationActive(db);
  return async function resolveLocationActive(txn: Transaction, locationId: string): Promise<boolean> {
    return resolveWarehouse(txn, { type: "WAREHOUSE", locationId });
  };
}

// Distinguishable from a receipt at a glance, and in a query.
export function stageAcquireAuditEvent(txn: Transaction, a: AcquireAuditInput): void {
  const note = a.provenanceNote ? ` -- ${a.provenanceNote}` : "";
  const summary = `acquireSerializedAsset ${a.serialNo} (part ${a.partId}) into ${a.locationId} `
    + `as ${a.reason}, no purchase order${note}`;
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: "acquireSerializedAsset",
    targetType: "serializedAsset",
    targetId: a.serializedAssetId,
    outcome: "applied",
    summary: summary.slice(0, 500),
  });
}
