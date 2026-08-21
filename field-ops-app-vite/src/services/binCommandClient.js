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
  deactivate: "deactivateBin",
  reactivate: "reactivateBin",
  resolve: "resolveBin",
  list: "listBins",
  putAway: "recordPutAway",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const binCommandClient = Object.freeze({
  createBin: (request) => call(BIN_CALLABLES.create, request),
  deactivateBin: (request) => call(BIN_CALLABLES.deactivate, request),
  reactivateBin: (request) => call(BIN_CALLABLES.reactivate, request),
  resolveBin: (request) => call(BIN_CALLABLES.resolve, request),
  listBins: (request) => call(BIN_CALLABLES.list, request),
  recordPutAway: (request) => call(BIN_CALLABLES.putAway, request),
});
