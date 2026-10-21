// THE SESSION'S ACTION GATES, ANSWERED BY EOS WHERE EOS IS THE SOURCE. Firebase exit F1 (DECISIONS #244).
//
// Before F1, a handful of screens asked the Firebase-era legacy role (`users/{uid}.role` in {admin, dispatcher,
// technician}) or `employees/{id}.operationalRoles` whether to OFFER an action, while the action itself is enforced by
// an EOS command on an EOS capability. In an environment that declares an EOS API the legacy role is no longer read at
// all (AuthContext resolves `role = null`), so each of those offers is re-expressed here as the EOS capability the
// server already applies: the offer follows the server.
//
// Where no EOS API is declared (EOS_SESSION_SOURCE false) `eosSource` is false, every gate returns its LEGACY answer
// unchanged, and nothing here reads a capability. The choice is a compile-time constant -- there is no runtime fallback.
//
// The provider lives in App.jsx; a screen rendered without one (a unit test, an error boundary) gets the default
// below: not EOS-sourced, holds nothing -- which is the legacy path.
import { createContext, useContext } from "react";

export const NO_SESSION_ACCESS = Object.freeze({
  eosSource: false,
  /** true once the caller's EOS capability answer has settled (ready OR failed). */
  settled: false,
  holds: () => false,
  /** Is this EOS experience SURFACE granted to the caller? (the experience context, access/experienceContext.js) */
  grantsSurface: () => false,
  reload: () => {},
});

export const SessionAccessContext = createContext(NO_SESSION_ACCESS);
export const useSessionAccess = () => useContext(SessionAccessContext) ?? NO_SESSION_ACCESS;

/**
 * The F1 gates, each as the EOS capabilities the SERVER applies to the action it offers. ANY-OF.
 * Keep this the single place a legacy-role gate is re-expressed; test/sessionAccessGates.test.mjs pins it.
 */
export const SESSION_GATE_KEYS = Object.freeze({
  // G1 Dispatch Board renders. The board's EOS door (service.dispatch) is earned by dispatch; schedule and dispatch are
  // separate board controls (#2116), so holding either lets the person in and each control still checks its own key.
  dispatchBoard: Object.freeze(["workOrder.lifecycle.dispatch", "workOrder.lifecycle.schedule"]),
  // G2 Jobs > New Work Order (the same key the route in App.jsx uses).
  workOrderCreate: Object.freeze(["workOrder.create"]),
  // G5 Account governed-field pencils (paymentTerms, taxStatus) -- the authority eosCrm/accountAuthority.ts applies.
  accountGovernedFields: Object.freeze(["customer.governedField.write"]),
  // G6 Request Reorder (manual quantity).
  reorderManual: Object.freeze(["reorder.request.create.manual"]),
  // G7 Scan > technician Work Order workflow: the capability the work-execution commands apply.
  workExecution: Object.freeze(["workOrder.execution.record"]),
  // Receiving > Recent Receipts > Correct (B3-x): the capability both receipt-correction commands enforce. Registered, granted to nobody by default.
  receiptCorrect: Object.freeze(["inventory.receipt.correct"]),
  // UAT RO-01 (READ gates, not action gates): the capability a screen's AUTOMATIC mount read requires of the server. A screen that fires
  // such a read for a principal who does not hold the capability takes a 403 on every load, so the read is not fired and the panel says so.
  // Parts Catalog / Part detail -> Manufacturer names (catalogHttp listManufacturers: inventory.catalog.read AND inventory.manufacturer.read).
  manufacturerRead: Object.freeze(["inventory.manufacturer.read"]),
  // Parts Catalog -> the person's OWN assigned Reorders (readMyAssignedReorders: reorder.request.read ONLY, the OWN reach; no REORDER_QUEUE scope).
  reorderRead: Object.freeze(["reorder.request.read"]),
  // Receiving -> supplier names (partsReads listSuppliers: supplier.record.read).
  supplierRead: Object.freeze(["supplier.record.read"]),
});

/**
 * Gates answered by an EOS experience SURFACE rather than a bare capability. G3, the Reorder-queue notifications: the governed
 * Reorder reads behind the bell require reorder.request.read AND the REORDER_QUEUE Operational Scope (or, for the
 * Administrator, protected-standing reach), which is exactly the surface inventory.reorderQueue
 * (eosOps/experienceAuthority.ts). Holding reorder.request.read alone is refused by the server, so it must not show the bell.
 * `reorder.request.read.queue`, the F1-0 parity candidate, is SUPERSEDED and held by no Role.
 */
export const SESSION_GATE_SURFACES = Object.freeze({
  reorderQueue: "inventory.reorderQueue",
});

/** The Work Order office actions of the transition engine, and the EOS capability that authorises each (G4). */
export const WORK_ORDER_ACTION_CAPABILITY = Object.freeze({
  MarkReady: "workOrder.lifecycle.ready",
  Unschedule: "workOrder.lifecycle.schedule",
  Schedule: "workOrder.lifecycle.schedule",
  Dispatch: "workOrder.lifecycle.dispatch",
  Close: "workOrder.lifecycle.close",
  Cancel: "workOrder.lifecycle.cancel",
});

/**
 * One decision: the EOS capabilities when EOS is the source, the legacy answer otherwise.
 * `legacy` is a VALUE the caller computed exactly as it always did -- it is not evaluated here.
 */
export function sessionDecision(access, gateKeys, legacy) {
  if (!access?.eosSource) return legacy;
  return gateKeys.some((key) => access.holds(key) === true);
}

/** One decision on an EOS SURFACE: the surface grant when EOS is the source, the legacy answer otherwise. */
export function sessionSurfaceDecision(access, surfaceKey, legacy) {
  if (!access?.eosSource) return legacy;
  return typeof access.grantsSurface === "function" && access.grantsSurface(surfaceKey) === true;
}

/**
 * The `role` the Scan workflows should be given for the technician Work Order journey. The journey's server rule is a
 * Work Order execution rule; under EOS that is the `workOrder.execution.record` capability (F1 gate G7), not a role
 * name. Returns "technician" for a holder so the existing `role !== "technician"` mirror in access/scanWorkflows.js and
 * domain/scanActions.js reads one unchanged value -- the legacy role itself is untouched where EOS is not the source.
 */
export function scanJourneyRole(access, legacyRole) {
  if (!access?.eosSource) return legacyRole;
  return access.holds("workOrder.execution.record") === true ? "technician" : null;
}
