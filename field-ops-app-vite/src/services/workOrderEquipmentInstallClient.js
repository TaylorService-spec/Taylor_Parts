// EQUIPMENT INSTALLATION ON THE GOVERNED INSTALL WORK ORDER (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01,
// OD-1 / OD-2 / OD-5) -- the technician closeout's transport, over the EOS Work Order route:
//
//   listInstallableEquipmentForWorkOrder   the whole units the Work Order's company holds in WAREHOUSE / BIN custody
//   recordWorkOrderEquipmentInstall        ONE server transaction: ledger out of the source, EQUIPMENT custody, the
//                                          Equipment record, the Work Order's equipment_id, the Equipment event
//
// Never Firestore and never a Firebase callable. The server derives customer, site and company from the Work Order and
// decides authority (equipment.install + the ASSIGNED Employee); nothing here re-decides either.
//
// Both answers are returned in the closeout's own shape -- { outcome } or { error: { code, details, message, boundary? } }
// -- so EquipmentInstallCloseout and the offline technician bindings consume them unchanged. A unit is addressed by
// part + serial; `serializedAssetId` is the closeout's opaque handle for that pair, never a Firestore document id.
import { callWorkOrderApi } from "./workOrderApiClient.js";
import { CLOSEOUT_FAILURE } from "../domain/workOrderInstallCloseout.js";
import { WORK_ORDER_BOUNDARY } from "../domain/workOrderOutcome.js";
import { notifyEquipmentChanged } from "./equipmentApiClient.js";

const SEP = "::";
export const unitHandle = (partId, serialNumber) => `${encodeURIComponent(partId)}${SEP}${encodeURIComponent(serialNumber)}`;
export function parseUnitHandle(handle) {
  if (typeof handle !== "string" || !handle.includes(SEP)) return null;
  const [p, s] = handle.split(SEP);
  try {
    const partId = decodeURIComponent(p);
    const serialNumber = decodeURIComponent(s);
    return partId && serialNumber ? { partId, serialNumber } : null;
  } catch {
    return null;
  }
}

/** The server's refusal code -> the closeout's vocabulary (its messages already exist). */
const DETAIL_BY_SERVER_CODE = Object.freeze({
  NOT_ASSIGNED: CLOSEOUT_FAILURE.NOT_ASSIGNED_TECHNICIAN,
  EMPLOYEE_LINK_REQUIRED: CLOSEOUT_FAILURE.NOT_ASSIGNED_TECHNICIAN,
  WORK_ORDER_NOT_INSTALL: CLOSEOUT_FAILURE.WORK_ORDER_NOT_INSTALL_TYPE,
  WORK_ORDER_STATE_INVALID: CLOSEOUT_FAILURE.WORK_ORDER_STATE_INVALID,
  ALREADY_INSTALLED_ELSEWHERE: CLOSEOUT_FAILURE.ASSET_INSTALLED_ELSEWHERE,
  ALREADY_INSTALLED: CLOSEOUT_FAILURE.ASSET_INSTALLED_ELSEWHERE,
  STATUS_NOT_INSTALLABLE: CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE,
  TRUCK_SOURCE_NOT_ACTIVATED: CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE,
  SOURCE_NOT_INSTALLABLE: CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE,
  LEDGER_INTEGRITY: CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE,
  OPERATING_COMPANY_MISMATCH: CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE,
  PART_NOT_WHOLE_UNIT: CLOSEOUT_FAILURE.ASSET_NOT_WHOLE_UNIT,
  PART_NOT_FOUND: CLOSEOUT_FAILURE.ASSET_NOT_FOUND,
  UNIT_NOT_FOUND: CLOSEOUT_FAILURE.ASSET_NOT_FOUND,
  CAPABILITY_MISSING: CLOSEOUT_FAILURE.PERMISSION_DENIED,
});

const TRANSPORT_CODE = Object.freeze({
  FORBIDDEN: "permission-denied", NOT_FOUND: "not-found", INVALID_INPUT: "invalid-argument", CONFLICT: "aborted",
  PRECONDITION_FAILED: "failed-precondition", UNAVAILABLE: "unavailable", UNREACHABLE: "unavailable", INTERNAL: "internal",
  NOT_CONFIGURED: "unavailable", NOT_SIGNED_IN: "unauthenticated", UNAUTHENTICATED: "unauthenticated",
});

function errorFrom(res) {
  if (res.code === "NOT_ACTIVATED") {
    return { code: "failed-precondition", details: "SERIALIZED_INSTALL_NOT_ACTIVATED", boundary: WORK_ORDER_BOUNDARY.SERIALIZED_INSTALL,
      message: res.message ?? "Equipment install is not activated yet." };
  }
  return { code: TRANSPORT_CODE[res.code] ?? "internal", details: DETAIL_BY_SERVER_CODE[res.reason] ?? res.reason ?? null,
    message: res.message ?? "The installation could not be recorded." };
}

/** The units this INSTALL Work Order may install, in the closeout's row shape. */
export async function fetchInstallableEquipmentForWorkOrder({ workOrderId, serialNo }, call = callWorkOrderApi) {
  const res = await call("listInstallableEquipmentForWorkOrder", { workOrderId, ...(serialNo ? { serialNumber: serialNo } : {}) });
  if (!res.ok) return { outcome: null, error: errorFrom(res) };
  const units = (res.result?.units ?? []).map((u) => Object.freeze({
    serializedAssetId: unitHandle(u.partId, u.serialNumber), serialNo: u.serialNumber, partId: u.partId, productName: null,
    currentLocationId: u.locationId, currentLocationType: u.locationType, locationLabel: u.locationLabel ?? null, status: u.status,
  }));
  return { outcome: { workOrder: { id: workOrderId }, units, truncated: res.result?.truncated === true }, error: null };
}

/** Record ONE installation. `equipmentName` defaults to the Part and serial; the server owns everything else. */
export async function recordWorkOrderEquipmentInstall({ workOrderId, serializedAssetId, idempotencyKey, notes, equipmentName }, call = callWorkOrderApi) {
  const unit = parseUnitHandle(serializedAssetId);
  if (!unit) return { outcome: null, error: { code: "failed-precondition", details: CLOSEOUT_FAILURE.ASSET_NOT_FOUND, message: "That unit could not be resolved." } };
  const res = await call("recordWorkOrderEquipmentInstall", {
    workOrderId, partId: unit.partId, serialNumber: unit.serialNumber, idempotencyKey,
    equipmentName: equipmentName ?? `${unit.partId} S/N ${unit.serialNumber}`, ...(notes ? { notes } : {}),
  });
  if (!res.ok) return { outcome: null, error: errorFrom(res) };
  notifyEquipmentChanged();
  return {
    outcome: { outcome: res.result.outcome, equipmentId: res.result.equipment?.id ?? null, completionRequired: true, workOrderStatus: null },
    error: null,
  };
}
