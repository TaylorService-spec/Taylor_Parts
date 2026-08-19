import { EQUIPMENT_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { createEquipmentWith, updateEquipmentWith } from "./equipmentWrites.js";

// Issue #232 unit E2 -- the Equipment write path, bound to Firestore.
//
// Thin on purpose: every rule lives in the pure, injectable core in
// ./equipmentWrites.js (node-tested), and this file only supplies the real store and
// the clock. Writes route through makeCollectionStore -> lib/firebaseSafe.js, so
// demo/panic mode blocks them like every other write in the app.
//
// firestore.rules (match /equipment/{equipmentId}) PERMITS admin/dispatcher read, create, and
// update -- it does not deny the collection outright (see equipment.js's own comments, which
// already treat Rules (E3) as live enforcement, not a future gate). The remaining question for
// any given environment is deployment status of firestore.rules there, not what the Rules say.
//
// The trusted-writer contracts (move / retire / reactivate) are
// re-exported unchanged from the pure core -- they are declared in a module with no
// firebase import at all, so they cannot write even by accident. See Issue #15.

export const equipmentStore = makeCollectionStore(EQUIPMENT_COLLECTION);

export function createEquipment(values, options = {}) {
  return createEquipmentWith(equipmentStore, values, options, Date.now());
}

export function updateEquipment(id, values, options = {}) {
  return updateEquipmentWith(equipmentStore, id, values, options, Date.now());
}

export {
  moveEquipment,
  retireEquipment,
  reactivateEquipment,
} from "./equipmentWrites.js";
