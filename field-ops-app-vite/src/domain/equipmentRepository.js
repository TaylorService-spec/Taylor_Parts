import { EQUIPMENT_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import {
  buildEquipmentCreatePayload,
  buildEquipmentEditPayload,
  equipmentOwnershipValid,
  equipmentSaveErrorMessage,
  trustedActionUnavailable,
} from "./equipment";

// Issue #232 unit E2 -- the Equipment write path.
//
// Two deliberate shapes here:
//
// 1. create / ordinary edit are CLIENT-DIRECT writes (Spec §11), routed through
//    makeCollectionStore -> lib/firebaseSafe.js so demo/panic mode blocks them like
//    every other write in the app. Production Rules currently DENY the equipment
//    collection outright: until E3's Rules are separately merged AND deployed these
//    calls fail closed with safe copy, which is the correct behaviour, not a bug.
//
// 2. move / retire / reactivate are trusted-writer, audited actions gated on Issue
//    #15 (Functions are undeployed). They are declared here as CONTRACTS ONLY --
//    they call the trusted-writer seam, find it unavailable, and say so. There is no
//    client-direct fallback, no optimistic success, and nothing simulated: a caller
//    can never mistake "unavailable" for "done".
//
// Unlike the older domain repositories (locations.js) these functions RESOLVE to a
// result object instead of throwing/returning the raw store result. That is required
// by E2: a raw Firebase error must never reach a caller, so the mapping to safe copy
// happens once, here, rather than being re-implemented at each call site.

export const equipmentStore = makeCollectionStore(EQUIPMENT_COLLECTION);

const INVALID_MESSAGE = "Check the highlighted fields and try again. Nothing was saved.";

// Spec §4: an Equipment's Location must belong to its owning Account. The caller
// passes the chosen Location document (it already has it -- see
// useLocationsForAccount / useEquipmentForAccount); if it cannot be produced, the
// relationship is UNPROVEN and we fail closed rather than write and hope Rules catch
// it. Rules (E3) enforce this independently.
export async function createEquipment(values, { location } = {}) {
  const { valid, errors, payload } = buildEquipmentCreatePayload(values, Date.now());
  if (!valid) return { ok: false, errors, message: INVALID_MESSAGE };

  if (!equipmentOwnershipValid(payload, location)) {
    return {
      ok: false,
      errors: { locationId: "Select a location that belongs to this customer." },
      message: INVALID_MESSAGE,
    };
  }

  try {
    const saved = await equipmentStore.add(payload);
    if (saved?.blocked) return { ok: false, errors: {}, message: equipmentSaveErrorMessage({ blocked: true }) };
    return { ok: true, equipment: saved };
  } catch (err) {
    return { ok: false, errors: {}, message: equipmentSaveErrorMessage(err) };
  }
}

// Ordinary edit: descriptive fields only. Account, Location, status and createdAt are
// dropped by buildEquipmentEditPayload, so they cannot change here even by accident.
// If the caller actually ASKED to change one, that is a programming error against the
// governed model -- refuse the whole write loudly instead of silently saving a
// partial edit that looks like it succeeded.
export async function updateEquipment(id, values, { before = {} } = {}) {
  if (typeof id !== "string" || id === "") {
    return { ok: false, errors: {}, message: equipmentSaveErrorMessage(null) };
  }

  const { valid, errors, payload, changedGoverned } = buildEquipmentEditPayload(values, before, Date.now());

  if (changedGoverned.length > 0) {
    return {
      ok: false,
      errors: {},
      governedFields: changedGoverned,
      // Safe copy: names the concept, never a field path, code, or document id.
      message: "Customer, location, and status can't be changed here. Nothing was saved.",
    };
  }
  if (!valid) return { ok: false, errors, message: INVALID_MESSAGE };

  try {
    const saved = await equipmentStore.update(id, payload);
    if (saved?.blocked) return { ok: false, errors: {}, message: equipmentSaveErrorMessage({ blocked: true }) };
    return { ok: true, equipment: saved };
  } catch (err) {
    return { ok: false, errors: {}, message: equipmentSaveErrorMessage(err) };
  }
}

// ------------------------------------------- trusted-writer seam (contracts) --
// Each returns the same unavailable result and performs NO write. When Issue #15 is
// resolved these bodies become httpsCallable(...) invocations (E19/E20) -- the call
// signature is fixed now so callers do not change then.

export async function moveEquipment(/* id, { toLocationId, reason } */) {
  return trustedActionUnavailable("equipment.move");
}

export async function retireEquipment(/* id, { reason } */) {
  return trustedActionUnavailable("equipment.retire");
}

export async function reactivateEquipment(/* id, { reason } */) {
  return trustedActionUnavailable("equipment.reactivate");
}

// Every lifecycle transition -- including ACTIVE<->INACTIVE -- routes through the
// trusted seam under this authorization. Spec §3 contemplates a plain client path for
// ACTIVE<->INACTIVE; that is deliberately NOT implemented in E2 (the conservative
// direction: no lifecycle write exists yet to get wrong). E10 decides it.
export async function setEquipmentStatus(/* id, nextStatus */) {
  return trustedActionUnavailable("equipment.setStatus");
}
