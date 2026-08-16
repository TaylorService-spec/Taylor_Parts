// Enterprise Inventory -- Cycle Count operating authority: thin httpsCallable transport for the
// cycle count command family. Mirrors services/transferCommandClient.js exactly: builds nothing
// itself (request shaping lives in domain/cycleCountCommandRequest.js), just invokes the named onCall
// export. Every inventory.cycleCount.* capability is registered `active: false` and granted to NO
// Role, so today every real call resolves `permission-denied` server-side -- this client does not
// hide that; the hook layer surfaces it as an honest status, never a fabricated success.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const CYCLE_COUNT_CALLABLES = Object.freeze({
  create: "createCycleCount",
  submit: "submitCycleCount",
  reconcile: "reconcileCycleCount",
  cancel: "cancelCycleCount",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const cycleCountCommandClient = Object.freeze({
  createCycleCount: (request) => call(CYCLE_COUNT_CALLABLES.create, request),
  submitCycleCount: (request) => call(CYCLE_COUNT_CALLABLES.submit, request),
  reconcileCycleCount: (request) => call(CYCLE_COUNT_CALLABLES.reconcile, request),
  cancelCycleCount: (request) => call(CYCLE_COUNT_CALLABLES.cancel, request),
});
