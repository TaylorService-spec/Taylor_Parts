// Enterprise Inventory Phase 4 -- thin httpsCallable transport for the Transfer command family.
// Mirrors services/truckRegistryCommandClient.js: builds nothing itself (request shaping lives in
// domain/transferCommandRequest.js), just invokes the named onCall export. Every
// inventory.transfer.* capability is registered `active: false` and granted to NO Role, so today
// every real call resolves `permission-denied` server-side -- this client does not hide that; the
// hook below surfaces it as an honest status, never a fabricated success.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const TRANSFER_CALLABLES = Object.freeze({
  create: "createTransferOrder",
  dispatch: "dispatchTransferOrder",
  receive: "receiveTransferOrder",
  cancel: "cancelTransferOrder",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const transferCommandClient = Object.freeze({
  createTransferOrder: (request) => call(TRANSFER_CALLABLES.create, request),
  dispatchTransferOrder: (request) => call(TRANSFER_CALLABLES.dispatch, request),
  receiveTransferOrder: (request) => call(TRANSFER_CALLABLES.receive, request),
  cancelTransferOrder: (request) => call(TRANSFER_CALLABLES.cancel, request),
});
