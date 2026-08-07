// Part Master (ADR-009 G2) -- the injectable CLIENT SEAM for the three trusted Part write callables.
// Deliberately THIN (mirrors truckRegistryCommandClient.js / adminPasswordResetClient.js): it builds the
// EXACT request payload each callable expects and invokes it via httpsCallable, so `firebase` stays out
// of the unit tests and ALL outcome mapping stays in the pure domain (domain/partMasterWrite.js).
//
// Server-derived identity: actorUid is taken ONLY from request.auth.uid inside each callable -- it is
// NEVER part of any payload built here. There is ONE Part authority (partMasterCommands); this client
// invokes it, it does not reimplement it.
//
// NOT-DEPLOYED / FAIL-CLOSED: these callables are exported from functions/src/index.ts under their frozen
// public names but are NOT deployed and NO capability is granted. This client is only ever invoked when
// the write-readiness seam (config/partMasterWriteReadiness.js) is true; usePartMasterWrite guarantees
// ZERO invocations while readiness is false. This file performs no runtime probing.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

// onCall export names (functions/src/index.ts), region bound by firebase.js. Frozen public names.
export const PART_MASTER_CALLABLES = Object.freeze({
  create: "createPart",
  update: "updatePart",
  changeStatus: "changePartStatus",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

// Each method sends ONLY the fields its callable reads (see partMasterCallables.ts). idempotencyKey +
// expectedVersion are supplied by the caller (usePartMasterWrite).
export const partMasterCommandClient = Object.freeze({
  createPart: ({ idempotencyKey, part }) => call(PART_MASTER_CALLABLES.create, { idempotencyKey, part }),
  updatePart: ({ idempotencyKey, partId, expectedVersion, changes }) =>
    call(PART_MASTER_CALLABLES.update, { idempotencyKey, partId, expectedVersion, changes }),
  changePartStatus: ({ idempotencyKey, partId, expectedVersion, newStatus }) =>
    call(PART_MASTER_CALLABLES.changeStatus, { idempotencyKey, partId, expectedVersion, newStatus }),
});
