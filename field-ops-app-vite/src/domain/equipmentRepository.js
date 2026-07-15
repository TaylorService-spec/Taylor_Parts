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
// Production Rules currently DENY the equipment collection outright: until E3's Rules
// are separately merged AND deployed, create/edit fail closed with safe copy. That is
// the correct behaviour under this authorization, not a defect.
//
// The trusted-writer contracts (move / retire / reactivate / setStatus) are
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
  setEquipmentStatus,
} from "./equipmentWrites.js";
