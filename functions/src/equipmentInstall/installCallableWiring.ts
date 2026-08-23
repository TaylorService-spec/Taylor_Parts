// The production seams for installSerializedAsset: real authorization, real audit.
//
// Mirrors receivingCallableWiring / transferCallableWiring exactly. The point of a separate wiring
// module is that the command core stays free of Firestore-shaped authorization: it asks a question
// and this decides how the answer is found.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { isValidAccessVersionValue } from "../access/compactClaims.js";
import { stageAuditEvent } from "../access/auditEventWriter.js";
import type { Role } from "../types/access.js";
import type { InstallAuditInput } from "./installSerializedAssetCommand.js";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const INSTALL_ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

// Read THROUGH the transaction so a concurrent revocation conflicts the commit rather than being
// missed. equipment.install is registered active:false, so this denies for everyone until the
// environment activates it AND a Role grant exists -- both, never either.
export function makeResolveInstallPermissionThroughTxn(capability: string) {
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
      roles: INSTALL_ROLE_CATALOG,
      currentAccessVersion: accessVersion,
      target: GLOBAL_TARGET,
      activationOverrides: resolveRuntimeCapabilityOverrides(),
    });
    return result.decision === "ALLOW";
  };
}

// One audit event per installation, carrying what the act actually did -- including where the unit
// came from, which is the only record of its prior custody once the asset is INSTALLED.
export function stageInstallAuditEvent(txn: Transaction, a: InstallAuditInput): void {
  const summary = `installSerializedAsset ${a.serializedAssetId} (serial ${a.serialNo}) `
    + `from ${a.priorState}@${a.priorLocationId} -> equipment ${a.equipmentId} `
    + `for account ${a.accountId} at ${a.locationId}`;
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: "installSerializedAsset",
    targetType: "equipment",
    targetId: a.equipmentId,
    outcome: "applied",
    summary: summary.slice(0, 500),
  });
}
