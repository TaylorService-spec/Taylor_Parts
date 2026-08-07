// Manufacturer -- the injectable CLIENT SEAM for the three trusted Manufacturer write callables.
// Deliberately THIN (mirrors partMasterCommandClient.js): builds the EXACT payload each callable expects
// and invokes it via httpsCallable, so `firebase` stays out of the unit tests and ALL outcome mapping
// stays in the pure domain (domain/manufacturerWrite.js). Server-derived identity: actorUid is taken ONLY
// from request.auth.uid inside each callable -- NEVER part of any payload here. ONE Manufacturer authority.
//
// NOT-DEPLOYED / FAIL-CLOSED: callables are exported from functions/src/index.ts (frozen public names) but
// NOT deployed and NO capability granted. This client is only invoked when the write-readiness seam
// (config/manufacturerWriteReadiness.js) is true; useManufacturerWrite guarantees ZERO invocations while
// readiness is false. No runtime probing.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const MANUFACTURER_CALLABLES = Object.freeze({
  create: "createManufacturer",
  update: "updateManufacturer",
  changeStatus: "changeManufacturerStatus",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const manufacturerCommandClient = Object.freeze({
  createManufacturer: ({ idempotencyKey, manufacturerId, name }) => call(MANUFACTURER_CALLABLES.create, { idempotencyKey, manufacturerId, name }),
  updateManufacturer: ({ idempotencyKey, manufacturerId, expectedVersion, name }) => call(MANUFACTURER_CALLABLES.update, { idempotencyKey, manufacturerId, expectedVersion, name }),
  changeManufacturerStatus: ({ idempotencyKey, manufacturerId, expectedVersion, newStatus }) => call(MANUFACTURER_CALLABLES.changeStatus, { idempotencyKey, manufacturerId, expectedVersion, newStatus }),
});
