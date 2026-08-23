// TRANSFERS — through the real command family, with real authorization.
//
// ============================ THE LIFECYCLE, AS THE DOMAIN DEFINES IT ============================
//
//   createTransferOrder    (none)     -> REQUESTED     inventory.transfer.create
//   dispatchTransferOrder  REQUESTED  -> IN_TRANSIT    inventory.transfer.dispatch    stages TRANSFER_OUT
//   receiveTransferOrder   IN_TRANSIT -> COMPLETED     inventory.transfer.receive     stages TRANSFER_IN
//   cancelTransferOrder    REQUESTED  -> CANCELLED     inventory.transfer.cancel      no movement yet
//
// DISPATCH AND RECEIVE ARE SEPARATE ACTS, and the gap between them is the interesting part. Stock
// leaves the origin at dispatch and arrives at the destination at receipt, so between those two
// moments it is at NEITHER location. A company total computed by summing locations is therefore
// LOWER while a transfer is in transit -- not because anything was lost, but because in-transit is a
// real place the location sum does not model.
//
// That is recorded rather than smoothed over: company conservation is a property of the COMPLETED
// lifecycle, not of every instant within it.
//
// ============================ NO SHORTCUT EXISTS HERE ============================
//
// The command owns the movement. It calls stageOperationalMovement itself and writes the
// transfer_orders record itself, so a fixture that wanted to "just set the balances" would be
// writing the ledger directly -- which the applier boundary forbids and Rules deny.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const {
  createTransferOrderProduction, dispatchTransferOrderProduction,
  receiveTransferOrderProduction, cancelTransferOrderProduction,
} = await import(L("functions/lib/inventoryTransfer/transferCommandComposition.js"));
const { makeResolveTransferPermissionThroughTxn, resolveTransferPartThroughTxn, stageTransferAuditEvent } =
  await import(L("functions/lib/inventoryTransfer/transferCallableWiring.js"));
const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { loadPrincipalIndex, currentActivations } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const FIXED_NOW = new Date("2026-08-22T16:00:00.000Z");

/**
 * The REAL permission resolver, with this environment's activation supplied.
 *
 * makeResolveTransferPermissionThroughTxn reads GCLOUD_PROJECT to find its activation set, and the
 * emulator process is not a deployed Functions runtime -- so rather than setting GCLOUD_PROJECT to a
 * project this is not (which would be lying about the environment to obtain authority), the same
 * reads and the same resolver are performed with the activation set the registry resolves FOR
 * demo-certworld. Every governed check -- role, scope, condition, accessVersion -- is untouched.
 */
function makeCertResolver(db, capability) {
  return async function resolve(txn, actorId) {
    if (typeof actorId !== "string" || actorId.trim() === "") return false;
    const userSnap = await txn.get(db.collection("users").doc(actorId));
    const assignmentsSnap = await txn.get(
      db.collection("roleAssignments").where("principalUid", "==", actorId).where("status", "==", "active"),
    );
    const accessVersion = userSnap.exists ? (userSnap.data()?.accessVersion ?? 0) : 0;
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const out = resolveEffectivePermission({
      permissionId: capability, assignments, roles: ROLE_CATALOG,
      currentAccessVersion: accessVersion, target: GLOBAL_TARGET,
      activationOverrides: currentActivations(),
    });
    return out.decision === "ALLOW";
  };
}

function depsFor(db, uid, capability) {
  return {
    db,
    actor: { kind: "USER", id: uid },
    authorize: (txn, actorId) => makeCertResolver(db, capability)(txn, actorId),
    resolvePart: (txn, partId) => resolveTransferPartThroughTxn(txn, db, partId),
    stageAudit: (txn, audit) => stageTransferAuditEvent(txn, audit),
    now: () => FIXED_NOW,
  };
}

const ACTIONS = {
  create: { run: createTransferOrderProduction, capability: "inventory.transfer.create" },
  dispatch: { run: dispatchTransferOrderProduction, capability: "inventory.transfer.dispatch" },
  receive: { run: receiveTransferOrderProduction, capability: "inventory.transfer.receive" },
  cancel: { run: cancelTransferOrderProduction, capability: "inventory.transfer.cancel" },
};

/**
 * Perform one transfer action as a named employee.
 *
 * A refusal is a RESULT, not a crash: half of what this pass proves is that the service says no.
 */
export async function transferAs(db, employeeId, action, request) {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(`unknown transfer action ${action}`);
  const principalIndex = await loadPrincipalIndex(db);
  const uid = principalIndex.get(employeeId);
  if (!uid) throw new Error(`${employeeId} has no principal -- cannot act`);
  try {
    const outcome = await spec.run(request, depsFor(db, uid, spec.capability));
    return { ok: true, action, actorEmployeeId: employeeId, actorUid: uid, outcome };
  } catch (err) {
    return {
      ok: false, action, actorEmployeeId: employeeId, actorUid: uid,
      code: err?.code ?? err?.constructor?.name ?? "?",
      message: err?.message ?? String(err),
    };
  }
}

/** Authoritative on-hand at ONE location, summed exactly as the transfer command sums it. */
export async function onHandAt(db, partId, location) {
  const snap = await db.collection("inventory_transactions").where("partId", "==", partId).get();
  let onHand = 0;
  for (const doc of snap.docs) {
    const v = doc.data();
    if (v.location?.type !== location.type || v.location?.locationId !== location.locationId) continue;
    if (v.type === "RECEIVED" || v.type === "RETURNED" || v.type === "TRANSFER_IN") onHand += Number(v.quantity);
    else if (v.type === "TRANSFER_OUT" || v.type === "SCRAPPED") onHand -= Number(v.quantity);
    else if (v.type === "ADJUSTED") onHand += Number(v.quantity);
  }
  return onHand;
}

/** Everything a transfer assertion needs, read back rather than assumed. */
export async function transferSnapshot(db, partId, origin, destination) {
  const { allLedgerRows, warehouseByPart, mobileByPart } =
    await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));
  const rows = await allLedgerRows(db);
  return {
    partId,
    origin: await onHandAt(db, partId, origin),
    destination: await onHandAt(db, partId, destination),
    // Company as the LOCATION SUM. Deliberately this and not "everything the company owns": the
    // difference between them IS the in-transit quantity, and naming it company hides that.
    companyByLocation: (warehouseByPart(rows, null).get(partId) ?? 0) + (mobileByPart(rows).get(partId) ?? 0),
    warehouseAvailable: warehouseByPart(rows, new Set(["wh-main"])).get(partId) ?? 0,
  };
}

export async function readTransfer(db, transferOrderId) {
  const snap = await db.collection("transfer_orders").doc(transferOrderId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}
