// Equipment MODEL catalog list and writes, through the GOVERNED RENDER CATALOG API (PERM-UI).
//
//   browser -> services/catalogApiClient.js -> POST /operations/catalog -> eos_ops.equipment_models
//
// The server decides who may: createEquipmentModel / updateEquipmentModel need equipment.model.manage
// (functions/src/catalogMaster/postgresEquipmentModelWriter.ts); the list needs inventory.catalog.read. Nothing here decides
// authority, and there is no fallback to Firebase: a refused or failed call is a value the screen renders.
import { catalogApiClient } from "./catalogApiClient.js";

const OUTCOME_BY_CODE = Object.freeze({
  FORBIDDEN: { kind: "denied", message: "You are not authorized to change equipment models." },
  NOT_SIGNED_IN: { kind: "denied", message: "You must be signed in." },
  INVALID_INPUT: { kind: "invalid", message: "Some fields are missing or invalid. Check the form and try again." },
  NOT_FOUND: { kind: "notFound", message: "That model no longer exists. Reload the list." },
  CONFLICT: { kind: "conflict", message: "This model changed since you loaded it, or it already exists with different details. Reload and retry." },
  PRECONDITION_FAILED: { kind: "invalid", message: "Nothing to change: those values are already saved." },
});

/** The Catalog API's answer as the outcome the screen shows. Pure; never invents a success. */
export function equipmentModelWriteOutcome(res) {
  if (res?.ok) return res.result?.replayed ? { kind: "replayed", message: "Already saved (no change)." } : { kind: "applied", message: "Saved." };
  return OUTCOME_BY_CODE[res?.code] ?? { kind: "error", message: "The request could not be completed. Try again." };
}

/** The tenant's models: { ok:true, models } or { ok:false, denied }. Never throws. */
export async function listEquipmentModelsForAdmin({ client = catalogApiClient } = {}) {
  try {
    const res = await client.call("listEquipmentModels", {});
    if (!res?.ok || !Array.isArray(res.result?.models)) return { ok: false, denied: res?.code === "FORBIDDEN" };
    return { ok: true, models: res.result.models, truncated: res.result.nextCursor != null };
  } catch {
    return { ok: false, denied: false };
  }
}

const write = async (client, operation, input) => {
  try { return equipmentModelWriteOutcome(await client.call(operation, input)); } catch { return equipmentModelWriteOutcome(null); }
};

export const equipmentModelCommands = Object.freeze({
  create: (model, { client = catalogApiClient } = {}) => write(client, "createEquipmentModel", { model }),
  update: ({ equipmentModelId, expectedVersion, changes }, { client = catalogApiClient } = {}) =>
    write(client, "updateEquipmentModel", { equipmentModelId, expectedVersion, changes }),
});
