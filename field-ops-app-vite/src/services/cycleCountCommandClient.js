// Cycle Count -- thin httpsCallable transport for the A1 SHEET / LINE command family and the A4 durable
// reads (functions/src/cycleCount/cycleCountSheetCallables.ts, Decision #179). Builds nothing and decides
// nothing: request shaping is domain/cycleCountCommandRequest.js, and every call is re-authorized server-side.
//
// The v1 single-part callables (createCycleCount / submitCycleCount / ...) are gone from the backend; this
// client does not name them.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const CYCLE_COUNT_CALLABLES = Object.freeze({
  createSheet: "createCycleCountSheet",
  openLine: "openCycleCountLine",
  submitLine: "submitCycleCountLine",
  reconcileLine: "reconcileCycleCountLine",
  cancelLine: "cancelCycleCountLine",
  cancelSheet: "cancelCycleCountSheet",
  closeSheet: "closeCycleCountSheet",
  listSheets: "listCycleCountSheets",
  getSheet: "getCycleCountSheet",
  // TECHNICIAN MOBILE FLOW: "which truck is mine?" -- reuses the SAME governed truck-assignment
  // resolver Transfer discovery uses (readAssignedMobileLocation); a narrow projection of the
  // caller's own already-governed assignment, not a new authority. Requires the SAME counter
  // capability pair (create + submit) the client's own scanWorkflows.js gate uses.
  getAssignedMobileLocation: "getCycleCountAssignedMobileLocation",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const cycleCountCommandClient = Object.freeze({
  createCycleCountSheet: (request) => call(CYCLE_COUNT_CALLABLES.createSheet, request),
  openCycleCountLine: (request) => call(CYCLE_COUNT_CALLABLES.openLine, request),
  submitCycleCountLine: (request) => call(CYCLE_COUNT_CALLABLES.submitLine, request),
  reconcileCycleCountLine: (request) => call(CYCLE_COUNT_CALLABLES.reconcileLine, request),
  cancelCycleCountLine: (request) => call(CYCLE_COUNT_CALLABLES.cancelLine, request),
  cancelCycleCountSheet: (request) => call(CYCLE_COUNT_CALLABLES.cancelSheet, request),
  closeCycleCountSheet: (request) => call(CYCLE_COUNT_CALLABLES.closeSheet, request),
  listCycleCountSheets: (request = {}) => call(CYCLE_COUNT_CALLABLES.listSheets, request),
  getCycleCountSheet: (request) => call(CYCLE_COUNT_CALLABLES.getSheet, request),
  getCycleCountAssignedMobileLocation: () => call(CYCLE_COUNT_CALLABLES.getAssignedMobileLocation, {}),
});
