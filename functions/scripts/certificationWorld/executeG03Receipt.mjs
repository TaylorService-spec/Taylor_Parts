#!/usr/bin/env node
// G03 RECEIVING LIFECYCLE — through the real canonical receiving command, with real authorization.
//
// ============================ NO STUB, NO ADMIN, NO DIRECT WRITE ============================
//
// authorize is resolveReceivePermissionThroughTxn, read inside the command's own transaction, so a
// concurrent revocation conflicts the commit. resolvePart is the real Part authority. The audit
// event is staged by the real stager. The only thing this script supplies is WHICH EMPLOYEE is
// acting -- which is exactly the decision a receiving clerk makes when they scan a delivery.
//
// The actor is an ordinary receiving clerk. Not the Admin, not a SYSTEM id, not the Owner. If this
// employee is not authorized, the receipt does not happen and the lifecycle stops -- which is the
// entire point of doing it this way rather than granting the fixture a way through.
//
// ============================ WHY QUANTITY IS DERIVED, NOT TYPED ============================
//
// The partial quantity is computed from the world's own numbers under stated constraints, so the
// evidence cannot be accused of having picked a number that made the story work. The constraints
// are business ones: a partial receipt must leave the job still short, or it is not a partial in any
// sense that matters to the scenario.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { receiveInventoryStockProduction } =
  await import(L("functions/lib/inventoryReceiving/receiveInventoryStockComposition.js"));
const { resolveReceivePermissionThroughTxn, resolveReceivePartThroughTxn, stageReceiveAuditEvent } =
  await import(L("functions/lib/inventoryReceiving/receivingCallableWiring.js"));
const { loadPrincipalIndex, resolveCapability, RECEIVE } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));
const { CERT_RECEIVERS } = await import(L("functions/scripts/certificationWorld/data/purchasingPlan.mjs"));

/** The governed warehouse the certification world receives into. */
export const RECEIVING_LOCATION = Object.freeze({ type: "WAREHOUSE", locationId: "wh-main" });
/** Pinned so a rebuild produces identical timestamps. */
const FIXED_NOW = new Date("2026-08-22T15:00:00.000Z");

/**
 * Run one receipt as a named employee, through the production composition.
 *
 * Returns the outcome or the governed refusal. A refusal is a RESULT here, not a crash: several
 * steps of this lifecycle exist specifically to prove that the service says no.
 */
export async function receiveAs(db, employeeId, request) {
  const principalIndex = await loadPrincipalIndex(db);
  const uid = principalIndex.get(employeeId);
  if (!uid) throw new Error(`${employeeId} has no principal -- cannot act`);
  try {
    const outcome = await receiveInventoryStockProduction(request, {
      db,
      actor: { kind: "USER", id: uid },
      authorize: (txn, actorId, capability) => resolveReceivePermissionThroughTxn(txn, db, actorId, capability),
      resolvePart: (txn, partId) => resolveReceivePartThroughTxn(txn, db, partId),
      stageAudit: (txn, audit) => stageReceiveAuditEvent(txn, audit),
      now: () => FIXED_NOW,
    });
    return { ok: true, actorEmployeeId: employeeId, actorUid: uid, outcome };
  } catch (err) {
    return { ok: false, actorEmployeeId: employeeId, actorUid: uid,
      code: err?.code ?? err?.constructor?.name ?? "?", message: err?.message ?? String(err) };
  }
}

/** The receiving clerk on duty, proven to hold the capability before being asked to act. */
export async function pickReceiver(db) {
  const principalIndex = await loadPrincipalIndex(db);
  for (const employeeId of CERT_RECEIVERS) {
    const cap = await resolveCapability(db, principalIndex, employeeId, RECEIVE);
    if (cap.allowed) return { employeeId, uid: cap.uid, roles: cap.roles };
  }
  throw new Error("no certification receiver resolves inventory.stock.receive -- refusing to substitute an Admin");
}

export function buildReceiptRequest({ purchaseOrderId, lineId, partId, quantity, idempotencyKey }) {
  // expectedQuantity is NOT sent. The server derives what was outstanding; a caller that states its
  // own limit is stating the thing the limit exists to constrain.
  return {
    source: { type: "PURCHASE_ORDER", purchaseOrderId },
    receivingLocation: { ...RECEIVING_LOCATION },
    lines: [{ lineId, partId, receivedQuantity: quantity }],
    idempotencyKey,
  };
}
