// Descriptive bin registry + put-away — thin httpsCallable transport. Structure mirrors
// services/transferCommandClient.js: it builds nothing, it just invokes the named onCall export.
//
// Every bin and placement capability is registered `active: false` and granted to NO Role, so today
// every real call resolves `permission-denied` server-side. This client does not hide that; the
// surface renders the refusal as a refusal, never as a fabricated success and never as "no bins".
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const BIN_CALLABLES = Object.freeze({
  create: "createBin",
  // BIN-P1: correcting a rack's code keeps the same stable binId, so nothing that referenced the
  // bin has to be updated. Same manage capability as create and retire.
  rename: "renameBin",
  deactivate: "deactivateBin",
  reactivate: "reactivateBin",
  // The HUMAN-CODE resolve, scoped to one warehouse.
  resolve: "resolveBin",
  // The MACHINE-TOKEN resolve. A scanned label carries the stable binId, which identifies one bin
  // globally — so this is the only path that can honestly answer WRONG_WAREHOUSE.
  resolveToken: "resolveBinToken",
  list: "listBins",
  putAway: "recordPutAway",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const binCommandClient = Object.freeze({
  createBin: (request) => call(BIN_CALLABLES.create, request),
  deactivateBin: (request) => call(BIN_CALLABLES.deactivate, request),
  reactivateBin: (request) => call(BIN_CALLABLES.reactivate, request),
  renameBin: (request) => call(BIN_CALLABLES.rename, request),
  resolveBin: (request) => call(BIN_CALLABLES.resolve, request),
  resolveBinToken: (request) => call(BIN_CALLABLES.resolveToken, request),
  listBins: (request) => call(BIN_CALLABLES.list, request),
  recordPutAway: (request) => call(BIN_CALLABLES.putAway, request),
});
