import { createEquipmentWith, updateEquipmentWith } from "./equipmentWrites.js";
import { submitCreateEquipment, submitUpdateEquipment } from "../services/equipmentWriteClient.js";

// Issue #232 unit E2 -- the Equipment write path, bound to the trusted commands.
//
// Thin on purpose, and it stays thin: every ORCHESTRATION rule lives in the pure, injectable core
// in ./equipmentWrites.js (node-tested), and this file only supplies the transport and the clock.
//
// ============================ WHAT MOVED ============================
//
// The store is gone. `createEquipment` and `updateEquipment` were the last client-direct governed
// business writes in the application: `makeCollectionStore` composed a document and sent it to
// Firestore with firestore.rules as the only real check.
//
// The AUTHORITY now lives in functions/src/equipment/equipmentWriteCommands.ts, which enforces the
// complete contract independently:
//
//   create   the writable-key allowlist, name and optional-field validation, ACTIVE on create, and
//            the CROSS-DOCUMENT proof that the Location belongs to the Account -- read from
//            `locations/{locationId}` server-side, never from the Location object the browser holds;
//   update   the CHANGED-KEY allowlist (not the document's key set), validation of the resulting
//            values, and the ACTIVE<->INACTIVE transition guard against the STORED status.
//
// ============================ WHAT DID NOT MOVE ============================
//
// The pure core still runs first, and that is deliberate rather than redundant. It produces the
// four distinct answers this surface renders -- invalid / malformed / noop / refusedStatus /
// unprovable / governed -- each with its own safe copy, and turning a round trip into a sentence a
// person can act on is worth a local check. It is UX, not security: the server reaches the same
// conclusions from the stored record and refuses independently.
//
// `before` and `location` remain in the client API for exactly that reason. Neither is sent as
// authority, and the server ignores both: it loads its own stored Equipment and its own Location.
//
// The trusted-writer contracts (move / retire / reactivate) are re-exported unchanged from the pure
// core -- they are declared in a module with no firebase import at all, so they cannot write even
// by accident. Retire and reactivate remain UNAVAILABLE here: they are lifecycle actions, and the
// ordinary update command has no authority to perform either.

/**
 * A store-shaped adapter over the trusted commands.
 *
 * The pure core takes an injected `store` with `add`/`update`, which is what made its rules
 * provable under plain node. Keeping that seam and swapping what sits behind it means the core --
 * and its tests -- are untouched by this migration.
 */
const commandStore = {
  add: (data) => submitCreateEquipment(data),
  update: (id, data) => submitUpdateEquipment(id, data),
};

export function createEquipment(values, options = {}) {
  return createEquipmentWith(commandStore, values, options, Date.now());
}

export function updateEquipment(id, values, options = {}) {
  return updateEquipmentWith(commandStore, id, values, options, Date.now());
}

export {
  moveEquipment,
  retireEquipment,
  reactivateEquipment,
} from "./equipmentWrites.js";
