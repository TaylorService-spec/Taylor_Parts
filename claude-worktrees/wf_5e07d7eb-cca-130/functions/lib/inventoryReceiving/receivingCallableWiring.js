"use strict";
// Receiving Phase-2 E1: the REAL production seams the Receiving callables wire into the merged services.
// Repository-only. Everything reads THROUGH the caller's transaction (commit-time consistent). Nothing
// here is granted or deployed; inventory.stock.receive is registered-but-UNGRANTED, so the governed
// resolver denies every principal until a separate grant gate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECEIVE_CAPABILITY = void 0;
exports.resolveReceivePermissionThroughTxn = resolveReceivePermissionThroughTxn;
exports.resolveReceivePartThroughTxn = resolveReceivePartThroughTxn;
exports.stageReceiveAuditEvent = stageReceiveAuditEvent;
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
exports.RECEIVE_CAPABILITY = "inventory.stock.receive";
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
// A non-scoped (global) governed capability.
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
// The CANONICAL governed role catalog is the merge of the compatibility roles (admin/dispatcher/technician)
// and the governed business roles (owner, managers, ...), exactly as effectiveAccessFeed resolves. A
// principal may hold ANY governed role, so resolution must know all of them -- e.g. the Owner-ratified
// OWNER role (owner >= admin) holds inventory.stock.receive by composition and must resolve ALLOW.
const RECEIVE_ROLE_CATALOG = { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
// Governed authorization for inventory.stock.receive, read THROUGH the transaction so a concurrent
// revocation conflicts the commit. Reads the actor's active roleAssignments + authoritative accessVersion,
// then runs the merged pure resolver. Returns true only on decision === "ALLOW" (never today: UNGRANTED).
async function resolveReceivePermissionThroughTxn(txn, db, actorId) {
    if (typeof actorId !== "string" || actorId.trim() === "")
        return false;
    const userSnap = await txn.get(db.collection(USERS_COLLECTION).doc(actorId));
    const assignmentsSnap = await txn.get(db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", actorId).where("status", "==", "active"));
    let accessVersion = 0;
    if (userSnap.exists) {
        const av = (userSnap.data() ?? {}).accessVersion;
        if (av !== undefined && av !== null) {
            if (!(0, compactClaims_js_1.isValidAccessVersionValue)(av))
                return false; // malformed access data -> fail closed
            accessVersion = av;
        }
    }
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const result = (0, resolveEffectivePermission_js_1.resolveEffectivePermission)({
        permissionId: exports.RECEIVE_CAPABILITY,
        assignments,
        roles: RECEIVE_ROLE_CATALOG,
        currentAccessVersion: accessVersion,
        target: GLOBAL_TARGET,
    });
    return result.decision === "ALLOW";
}
// Map the Part-Master controlType vocabulary to the ledger trackingMode vocabulary. NONE and SERIAL are
// both accepted by the receiving validator (Wave 7); LOT and any unrecognized controlType resolve to a
// mode the validator rejects as "tracking mode not supported" -- fail closed on the unknown.
function controlTypeToTrackingMode(controlType) {
    switch (controlType) {
        case "STANDARD": return "NONE";
        case "SERIALIZED": return "SERIAL";
        case "LOT": return "LOT";
        default: return "LOT";
    }
}
// The trusted Part authority, read through the txn: adapt the canonical Part to the command's ResolvedPart
// ({partId, trackingMode, active}). `active` = status === "ACTIVE".
async function resolveReceivePartThroughTxn(txn, db, partId) {
    const stored = await (0, partMasterRepository_js_1.buildFirestorePartRepository)(db).getById(txn, partId);
    if (!stored)
        return null;
    return {
        partId: stored.part.partId,
        trackingMode: controlTypeToTrackingMode(stored.part.controlType),
        active: stored.part.status === "ACTIVE",
    };
}
// Adapt the command's ReceiveAuditInput to the immutable trusted audit writer, staged on the same txn
// (append-only). Uses the registered "receiveInventoryStock" AuditAction; summary is bounded + sanitized.
function stageReceiveAuditEvent(txn, a) {
    // SERIAL receipts additionally record how many Serialized Assets were activated. The serial NUMBERS
    // themselves are deliberately not written into the summary: they are already durably recorded on the
    // receiving order, the ledger events and the assets, and the audit summary is a bounded, sanitized
    // line rather than a second copy of inventory identity.
    const serials = typeof a.serialCount === "number" ? `, ${a.serialCount} serialized asset(s)` : "";
    const summary = `Received qty ${a.quantity} of part ${a.partId} into ${a.locationType}:${a.locationId} (reorder ${a.reorderRequestId}, ledger ${a.ledgerEventId}${serials})`.slice(0, 500);
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: a.action,
        targetType: "receivingOrder",
        targetId: a.receivingId,
        outcome: "applied",
        summary,
    });
}
//# sourceMappingURL=receivingCallableWiring.js.map