// The browser's route to the governed PostgreSQL Equipment register (Controller EQUIPMENT ACTIVATION AUTHORIZED,
// 2026-10-01).
//
//   browser -> THIS -> POST /operations/equipment (EOS trusted API, functions/src/eosOps/equipmentOperations.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// and never browser -> Firestore `equipment`. There is no fallback of any kind: a refused or failed read or command is
// returned as a value the screen renders. Read authority is decided by the SERVER, per record (operational readers see
// the register; a seller only its channel's customers; a Technician only the Equipment of an assigned Work Order) --
// nothing here filters for authority.
//
// The transport, the failure categories and the configuration seam are the Work Order client's (workOrderApiClient.js),
// reused rather than restated.
import { workOrderFailureCategory } from "./workOrderApiClient.js";

const loadAdminClient = () => import("./adminPolicyApiClient.js");

export const EQUIPMENT_ROUTE = "/operations/equipment";

/** Mirrors the server's EQUIPMENT_READ_OPERATIONS. */
export const EQUIPMENT_READ_OPERATIONS = Object.freeze([
  "listEquipment",
  "readEquipment",
  "readWorkOrderEquipment",
  "listAvailableEquipmentUnits",
  "listEquipmentOperatingCompanies",
]);

/** Mirrors the remaining keys of the server's EOS_EQUIPMENT_OPERATIONS. Installation is NOT here: it is the Work Order's. */
export const EQUIPMENT_COMMAND_OPERATIONS = Object.freeze(["createEquipment", "updateEquipment"]);

const OPERATIONS = new Set([...EQUIPMENT_READ_OPERATIONS, ...EQUIPMENT_COMMAND_OPERATIONS]);
export const isEquipmentOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

/** The server's list bound (EQUIPMENT_LIST_MAX_LIMIT). */
export const EQUIPMENT_LIST_MAX = 200;

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/**
 * Call one named Equipment read or command. Returns `{ ok: true, result, operation }` or
 * `{ ok: false, code, reason, status, message }`. Never throws. `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl.
 */
export async function callEquipmentApi(operation, input = undefined, options = {}) {
  if (!isEquipmentOperation(operation)) return failure("UNKNOWN_OPERATION", `"${operation}" is not an Equipment operation`);
  let admin = null;
  if (options.baseUrl === undefined || !options.getIdToken) {
    try { admin = await loadAdminClient(); } catch { admin = null; }
  }
  let rawBase;
  try {
    rawBase = options.baseUrl === undefined ? (admin ? admin.policyApiBaseUrl() : null) : options.baseUrl;
  } catch {
    rawBase = null;
  }
  const base = typeof rawBase === "string" && rawBase.trim().length > 0 ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");
  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : admin ? admin.currentIdToken() : null);
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Equipment register");
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");
  let response;
  try {
    response = await doFetch(`${base}${EQUIPMENT_ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}),
      },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "the Equipment register could not be reached");
  }
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.ok && body && body.ok === true) return Object.freeze({ ok: true, operation, result: body.result });
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(workOrderFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Equipment register returned ${response.status}`,
    { reason: serverCode, status: response.status });
}

/** The injectable seam hooks and repositories take. */
export const equipmentApiClient = Object.freeze({ call: callEquipmentApi });

// ─────────────────────────────── change notification ───────────────────────────────
//
// The Firestore listeners pushed changes; the governed register is read on demand. A successful create / update / install
// notifies here, and every mounted register read re-reads -- the same "refreshed, never a stale copy" posture the Work
// Order service takes.
const listeners = new Set();
export function onEquipmentChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyEquipmentChanged() {
  for (const l of [...listeners]) {
    try { l(); } catch { /* one listener never blocks another */ }
  }
}

// ─────────────────────────────── the view the screens render ───────────────────────────────

/**
 * The EOS register record, in the field names the Equipment screens already render. `locationId` is the CRM customer
 * site (never an inventory location); dates are YYYY-MM-DD; `createdAt` / `updatedAt` are epoch millis.
 */
export function toEquipmentView(record) {
  if (!record || typeof record !== "object") return null;
  const ms = (iso) => (typeof iso === "string" ? Date.parse(iso) : null);
  return Object.freeze({
    id: record.id,
    name: record.name,
    status: record.status,
    accountId: record.accountId,
    accountName: record.accountName ?? null,
    locationId: record.customerLocation?.id ?? null,
    locationName: record.customerLocationName ?? null,
    operatingCompanyKey: record.operatingCompanyKey ?? null,
    equipmentModelId: record.equipmentModelId ?? null,
    serialNumber: record.serialNumber ?? null,
    assetTag: record.assetTag ?? null,
    installedDate: record.installedOn ?? null,
    warrantyExpiresDate: record.warrantyExpiresOn ?? null,
    notes: record.notes ?? null,
    installedFrom: record.installedFrom ?? null,
    version: record.version ?? 1,
    createdAt: ms(record.createdAt),
    updatedAt: ms(record.updatedAt),
  });
}
