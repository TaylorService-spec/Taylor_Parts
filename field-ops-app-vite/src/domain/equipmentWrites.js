import {
  buildEquipmentCreatePayload,
  buildEquipmentEditPayload,
  equipmentOwnershipValid,
  equipmentSaveErrorMessage,
  trustedActionUnavailable,
} from "./equipment.js";

// Issue #232 unit E2 -- the Equipment write ORCHESTRATION, kept pure.
//
// This module deliberately has NO firebase import. The store is injected, which buys
// two things:
//
//  * these rules (fail-closed ownership, governed-field refusal, blocked -> safe copy,
//    thrown error -> safe copy, "no write attempted when invalid") are provable under
//    plain node -- see test/equipmentWrites.test.mjs;
//  * the trusted-writer contracts below live in a module that CANNOT write, so
//    "move/retire/reactivate perform no write" is a structural guarantee rather than
//    a claim needing a reviewer's trust.
//
// domain/equipmentRepository.js binds these to the real Firestore store.

const INVALID_MESSAGE = "Check the highlighted fields and try again. Nothing was saved.";

// Spec §4: an Equipment's Location must belong to its owning Account. The caller
// passes the chosen Location document (it already has it -- see useLocationsForAccount
// / useEquipmentForAccount). If the relationship cannot be PROVEN here, fail closed --
// never write and hope Rules catch it. Rules (E3) enforce this independently.
export async function createEquipmentWith(store, values, { location } = {}, now = 0) {
  const { valid, errors, payload } = buildEquipmentCreatePayload(values, now);
  if (!valid) return { ok: false, errors, message: INVALID_MESSAGE };

  if (!equipmentOwnershipValid(payload, location)) {
    return {
      ok: false,
      errors: { locationId: "Select a location that belongs to this customer." },
      message: INVALID_MESSAGE,
    };
  }

  try {
    const saved = await store.add(payload);
    if (saved?.blocked) return { ok: false, errors: {}, message: equipmentSaveErrorMessage({ blocked: true }) };
    return { ok: true, equipment: saved };
  } catch (err) {
    return { ok: false, errors: {}, message: equipmentSaveErrorMessage(err) };
  }
}

// Ordinary edit: descriptive fields only. Account, Location, status and createdAt can
// never be written here (buildEquipmentEditPayload omits them by construction). If the
// caller actually asked to change one, refuse the whole write loudly -- a dropped move
// reported as success is worse than a refused edit. `before` is required to prove a
// governed field is unchanged; without it the edit fails closed.
export async function updateEquipmentWith(store, id, values, { before = {} } = {}, now = 0) {
  if (typeof id !== "string" || id === "") {
    return { ok: false, errors: {}, message: equipmentSaveErrorMessage(null) };
  }

  const { valid, errors, payload, changedGoverned, unprovableGoverned } =
    buildEquipmentEditPayload(values, before, now);

  if (changedGoverned.length > 0) {
    return {
      ok: false,
      errors: {},
      governedFields: changedGoverned,
      // Safe copy: names the concept, never a field path, code, or document id.
      message: "Customer, location, and status can't be changed here. Nothing was saved.",
    };
  }
  // The caller supplied governed fields but no `before` to prove them unchanged. Still
  // fails closed, but this is OUR bug, not the user's -- so report it generically
  // rather than telling them they attempted something they did not.
  if (unprovableGoverned.length > 0) {
    return {
      ok: false,
      errors: {},
      unprovable: true,
      governedFields: unprovableGoverned,
      message: equipmentSaveErrorMessage(null),
    };
  }
  if (!valid) return { ok: false, errors, message: INVALID_MESSAGE };

  try {
    const saved = await store.update(id, payload);
    if (saved?.blocked) return { ok: false, errors: {}, message: equipmentSaveErrorMessage({ blocked: true }) };
    return { ok: true, equipment: saved };
  } catch (err) {
    return { ok: false, errors: {}, message: equipmentSaveErrorMessage(err) };
  }
}

// ------------------------------------------- trusted-writer seam (contracts) --
// Move / retire / reactivate are trusted-writer, audited actions (Spec §5/§11) gated
// on Issue #15 (Functions undeployed). Each calls the seam, finds it unavailable, and
// says so: no client-direct fallback, no optimistic success, nothing simulated. When
// #15 resolves these bodies become httpsCallable(...) invocations (E19/E20) -- the
// call signatures are fixed now so callers do not change then.

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
