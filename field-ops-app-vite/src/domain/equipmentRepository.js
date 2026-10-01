import { createEquipmentWith, updateEquipmentWith } from "./equipmentWrites.js";
import { equipmentApiClient, notifyEquipmentChanged, toEquipmentView } from "../services/equipmentApiClient.js";

// THE EQUIPMENT WRITE PATH IS THE GOVERNED POSTGRESQL REGISTER (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01).
//
// The pure orchestration (equipmentWrites.js: ownership proven, governed fields refused, status rules, no write when
// invalid) is unchanged and still runs FIRST; only the store it writes through moved -- from the Firestore `equipment`
// collection to POST /operations/equipment (createEquipment / updateEquipment), authorized server-side by
// equipment.record.manage. Firestore Equipment is FROZEN: nothing here can write it (no dual write).
//
// What the governed command needs that the Firestore document never carried is STATED, never inferred:
//   operatingCompanyId   the create's governed company choice (listEquipmentOperatingCompanies)
//   equipmentModelId     the catalog Equipment Model (optional) -- free-text manufacturer / model is not a model authority
//   idempotencyKey       one per create attempt, so a retried submit cannot register a machine twice
//   expectedVersion      the version the edit was made against (before.version), so two edits cannot both win

/** Map a governed refusal onto the shape equipmentSaveErrorMessage already explains, without leaking a code path. */
function storeError(res) {
  const err = new Error(res.message || "the Equipment register refused the write");
  err.code = res.code === "FORBIDDEN" ? "permission-denied"
    : res.code === "CONFLICT" ? "aborted"
      : res.code === "NOT_FOUND" ? "not-found"
        : res.code === "INVALID_INPUT" || res.code === "PRECONDITION_FAILED" ? "failed-precondition" : "unavailable";
  err.reason = res.reason ?? null;
  return err;
}

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `eq-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** The EOS store for one create: the payload equipmentWrites built, plus the governed facts stated by the caller. */
function createStore({ operatingCompanyId, equipmentModelId, idempotencyKey }, client) {
  return {
    async add(payload) {
      const input = {
        operatingCompanyId, accountId: payload.accountId, customerLocationId: payload.locationId, name: payload.name,
        idempotencyKey: idempotencyKey ?? newKey(),
      };
      if (equipmentModelId) input.equipmentModelId = equipmentModelId;
      for (const [from, to] of [["serialNumber", "serialNumber"], ["assetTag", "assetTag"], ["installedDate", "installedOn"],
        ["warrantyExpiresDate", "warrantyExpiresOn"], ["notes", "notes"]]) {
        if (payload[from] !== null && payload[from] !== undefined) input[to] = payload[from];
      }
      const res = await client.call("createEquipment", input);
      if (!res.ok) throw storeError(res);
      notifyEquipmentChanged();
      return toEquipmentView(res.result.equipment);
    },
  };
}

function updateStore({ expectedVersion, equipmentModelId, reason }, client) {
  return {
    async update(id, payload) {
      const changes = {};
      for (const [from, to] of [["name", "name"], ["serialNumber", "serialNumber"], ["assetTag", "assetTag"], ["installedDate", "installedOn"],
        ["warrantyExpiresDate", "warrantyExpiresOn"], ["notes", "notes"], ["status", "status"]]) {
        if (Object.prototype.hasOwnProperty.call(payload, from)) changes[to] = payload[from];
      }
      if (equipmentModelId !== undefined) changes.equipmentModelId = equipmentModelId;
      const res = await client.call("updateEquipment", { equipmentId: id, expectedVersion, changes, ...(reason ? { reason } : {}) });
      if (!res.ok) throw storeError(res);
      notifyEquipmentChanged();
      return toEquipmentView(res.result.equipment);
    },
  };
}

/** `options`: { location, operatingCompanyId, equipmentModelId?, idempotencyKey?, client? }. */
export function createEquipment(values, options = {}) {
  if (!options.operatingCompanyId) {
    return Promise.resolve({ ok: false, errors: { operatingCompanyId: "Select an operating company." },
      message: "Check the highlighted fields and try again. Nothing was saved." });
  }
  return createEquipmentWith(createStore(options, options.client ?? equipmentApiClient), values, { location: options.location }, Date.now());
}

/** `options`: { before (the record as loaded, with its version), equipmentModelId?, reason?, client? }. */
export function updateEquipment(id, values, options = {}) {
  const store = updateStore({ expectedVersion: options.before?.version, equipmentModelId: options.equipmentModelId, reason: options.reason },
    options.client ?? equipmentApiClient);
  const modelChanged = options.equipmentModelId !== undefined && options.equipmentModelId !== (options.before?.equipmentModelId ?? null);
  return updateEquipmentWith(store, id, values, { before: options.before }, Date.now()).then((result) => {
    // The model is a governed reference the free-text edit diff never carries: a model-only edit is still an edit.
    if (!result?.noop || !modelChanged) return result;
    return store.update(id, {}).then((equipment) => ({ ok: true, equipment }),
      (err) => ({ ok: false, errors: {}, message: err?.message || "Could not save this equipment. Nothing was saved." }));
  });
}

export {
  moveEquipment,
  retireEquipment,
  reactivateEquipment,
} from "./equipmentWrites.js";
