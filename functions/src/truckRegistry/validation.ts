// EI Truck Registry -- functions-side pure validation of write INPUT. Mirrors the frontend
// pure contract field-ops-app-vite/src/domain/truckRegistry.js (per-record shape + the 1:1
// link), kept as an independent functions-side authority (same split as partMaster's
// validation.ts vs the app's domain). No firebase, no reads, never throws; returns
// { valid, value } | { valid:false, errors }.
import { TRUCK_STATUSES, REACTIVATION_STATUSES, type TruckStatus, type ReactivationStatus } from "./types";

export interface ValidationError { path: string; code: string; }
export type ValidationResult<T> = { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

// Identifiers: non-empty, trimmed, bounded, no whitespace-only or control chars. Deliberately
// permissive on charset (ids are opaque business/inventory keys), but strict on emptiness and
// a sane length ceiling so a malformed id can never become a document key.
const ID_MAX = 200;
const isId = (v: unknown): v is string => isNonEmptyString(v) && v.length <= ID_MAX && v === (v as string).trim();
const isLabel = (v: unknown): v is string => typeof v === "string" && v.length <= 300;

export interface MobileLocationInput {
  locationId: string;
  type: "MOBILE";
  displayLabel?: string;
}
export interface TruckInput {
  truckId: string;
  locationId: string;
  homeWarehouseId: string;
  status: TruckStatus;
  assignedDriverEmployeeId: string | null;
  displayLabel?: string;
  vehicleNumber?: string;
}

export function parseTruckId(v: unknown): ValidationResult<string> {
  return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "truckId", code: "invalid" }] };
}
export function parseLocationId(v: unknown): ValidationResult<string> {
  return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "locationId", code: "invalid" }] };
}
export function parseWarehouseId(v: unknown): ValidationResult<string> {
  return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "homeWarehouseId", code: "invalid" }] };
}
export function parseEmployeeId(v: unknown): ValidationResult<string> {
  return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path: "employeeId", code: "invalid" }] };
}
export function isTruckStatus(v: unknown): v is TruckStatus {
  return typeof v === "string" && (TRUCK_STATUSES as readonly string[]).includes(v);
}
export function isReactivationStatus(v: unknown): v is ReactivationStatus {
  return typeof v === "string" && (REACTIVATION_STATUSES as readonly string[]).includes(v);
}

// Validate the create input for BOTH the MOBILE Location and the Truck business record that
// links to it 1:1 (docId IS the id in each case). assignedDriverEmployeeId is nullable; a
// non-empty value must be a valid id (its ACTIVE existence is checked transactionally, not
// here). status defaults to ACTIVE when omitted.
export interface CreateTruckFields {
  location: MobileLocationInput;
  truck: TruckInput;
}
export function validateCreateInput(raw: unknown): ValidationResult<CreateTruckFields> {
  const errors: ValidationError[] = [];
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const truckId = data.truckId;
  const locationId = data.locationId;
  const homeWarehouseId = data.homeWarehouseId;
  if (!isId(truckId)) errors.push({ path: "truckId", code: "invalid" });
  if (!isId(locationId)) errors.push({ path: "locationId", code: "invalid" });
  if (!isId(homeWarehouseId)) errors.push({ path: "homeWarehouseId", code: "invalid" });

  const status: unknown = data.status === undefined ? "ACTIVE" : data.status;
  if (!isTruckStatus(status)) errors.push({ path: "status", code: "invalid" });

  let assignedDriverEmployeeId: string | null = null;
  if (data.assignedDriverEmployeeId !== undefined && data.assignedDriverEmployeeId !== null) {
    if (!isId(data.assignedDriverEmployeeId)) errors.push({ path: "assignedDriverEmployeeId", code: "invalid" });
    else assignedDriverEmployeeId = data.assignedDriverEmployeeId;
  }

  if (data.displayLabel !== undefined && !isLabel(data.displayLabel)) errors.push({ path: "displayLabel", code: "invalid" });
  if (data.vehicleNumber !== undefined && !isLabel(data.vehicleNumber)) errors.push({ path: "vehicleNumber", code: "invalid" });

  if (errors.length > 0) return { valid: false, errors };

  const displayLabel = isNonEmptyString(data.displayLabel) ? (data.displayLabel as string) : undefined;
  const vehicleNumber = isNonEmptyString(data.vehicleNumber) ? (data.vehicleNumber as string) : undefined;
  return {
    valid: true,
    value: {
      location: { locationId: locationId as string, type: "MOBILE", ...(displayLabel ? { displayLabel } : {}) },
      truck: {
        truckId: truckId as string,
        locationId: locationId as string,
        homeWarehouseId: homeWarehouseId as string,
        status: status as TruckStatus,
        assignedDriverEmployeeId,
        ...(displayLabel ? { displayLabel } : {}),
        ...(vehicleNumber ? { vehicleNumber } : {}),
      },
    },
  };
}
