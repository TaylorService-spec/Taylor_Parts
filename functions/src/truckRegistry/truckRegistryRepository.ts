// EI Truck Registry -- canonical repository for trucks / mobile_locations /
// location_truck_claims. Document identity IS domain identity (trucks/{truckId},
// mobile_locations/{locationId}, location_truck_claims/{locationId}); never derived from a
// mutable label. All client writes are denied by Rules; every mutation flows through
// truckRegistryCommands.ts. No DocumentSnapshot leaks; malformed stored data is surfaced
// explicitly (MalformedStoredRecordError), never silently defaulted. Physical delete exists
// ONLY through the admin-only Created-in-Error path (deleteTruckCreatedInError), which
// atomically removes the truck + its MOBILE location + the 1:1 claim after proving the record
// carries no operational history; ordinary lifecycle is active/status only.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { TRUCK_STATUSES, MalformedStoredRecordError, type TruckStatus } from "./types";
import type { MobileLocationInput, TruckInput } from "./validation";

export const TRUCKS_COLLECTION = "trucks";
export const MOBILE_LOCATIONS_COLLECTION = "mobile_locations";
export const LOCATION_TRUCK_CLAIMS_COLLECTION = "location_truck_claims";
export const EMPLOYEES_COLLECTION = "employees";
export const WAREHOUSES_COLLECTION = "warehouses";
export const INITIAL_VERSION = 1;

export interface StoredMeta {
  readonly version: number;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}
export interface StoredMobileLocation extends StoredMeta {
  readonly location: MobileLocationInput;
  readonly active: boolean;
}
export interface StoredTruck extends StoredMeta {
  readonly truck: TruckInput;
  readonly active: boolean;
}
export interface StoredClaim {
  readonly locationId: string;
  readonly truckId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly createdBy: string;
}

// ---- serialization (strict; explicit Timestamp handling) ----
function metaToFirestore(meta: StoredMeta): Record<string, unknown> {
  return {
    version: meta.version,
    createdAt: Timestamp.fromDate(meta.createdAt),
    createdBy: meta.createdBy,
    updatedAt: Timestamp.fromDate(meta.updatedAt),
    updatedBy: meta.updatedBy,
  };
}
function readMeta(docId: string, data: Record<string, unknown>): StoredMeta {
  const { version, createdAt, createdBy, updatedAt, updatedBy } = data;
  if (
    typeof version !== "number" || !Number.isInteger(version) || version < INITIAL_VERSION ||
    !(createdAt instanceof Timestamp) || !(updatedAt instanceof Timestamp) ||
    typeof createdBy !== "string" || typeof updatedBy !== "string"
  ) {
    throw new MalformedStoredRecordError(`stored record ${docId} has malformed version/audit metadata`);
  }
  return { version, createdAt: createdAt.toDate(), createdBy, updatedAt: updatedAt.toDate(), updatedBy };
}
function readActive(docId: string, data: Record<string, unknown>): boolean {
  if (typeof data.active !== "boolean") throw new MalformedStoredRecordError(`stored record ${docId} has non-boolean active`);
  return data.active;
}

export function mobileLocationToFirestore(s: StoredMobileLocation): Record<string, unknown> {
  return {
    locationId: s.location.locationId,
    type: "MOBILE",
    displayLabel: s.location.displayLabel,
    active: s.active,
    ...metaToFirestore(s),
  };
}
export function mobileLocationFromFirestore(docId: string, data: Record<string, unknown> | undefined): StoredMobileLocation {
  if (data === undefined) throw new MalformedStoredRecordError(`mobile_location ${docId} has no data`);
  if (data.locationId !== docId) throw new MalformedStoredRecordError(`mobile_location ${docId} carries mismatched locationId`);
  if (data.type !== "MOBILE") throw new MalformedStoredRecordError(`mobile_location ${docId} is not MOBILE`);
  if (typeof data.displayLabel !== "string" || data.displayLabel.trim() === "") throw new MalformedStoredRecordError(`mobile_location ${docId} has missing/invalid displayLabel`);
  return { location: { locationId: docId, type: "MOBILE", displayLabel: data.displayLabel }, active: readActive(docId, data), ...readMeta(docId, data) };
}

export function truckToFirestore(s: StoredTruck): Record<string, unknown> {
  const t = s.truck;
  return {
    truckId: t.truckId,
    locationId: t.locationId,
    homeWarehouseId: t.homeWarehouseId,
    status: t.status,
    assignedDriverEmployeeId: t.assignedDriverEmployeeId, // string | null
    displayLabel: t.displayLabel,
    vehicleNumber: t.vehicleNumber,
    active: s.active,
    ...metaToFirestore(s),
  };
}
export function truckFromFirestore(docId: string, data: Record<string, unknown> | undefined): StoredTruck {
  if (data === undefined) throw new MalformedStoredRecordError(`truck ${docId} has no data`);
  if (data.truckId !== docId) throw new MalformedStoredRecordError(`truck ${docId} carries mismatched truckId`);
  if (typeof data.locationId !== "string" || data.locationId.trim() === "") throw new MalformedStoredRecordError(`truck ${docId} has invalid locationId`);
  if (typeof data.homeWarehouseId !== "string" || data.homeWarehouseId.trim() === "") throw new MalformedStoredRecordError(`truck ${docId} has invalid homeWarehouseId`);
  if (typeof data.status !== "string" || !(TRUCK_STATUSES as readonly string[]).includes(data.status)) throw new MalformedStoredRecordError(`truck ${docId} has invalid status`);
  const driver = data.assignedDriverEmployeeId;
  if (!(driver === null || (typeof driver === "string" && driver.trim() !== ""))) throw new MalformedStoredRecordError(`truck ${docId} has invalid assignedDriverEmployeeId`);
  if (typeof data.displayLabel !== "string" || data.displayLabel.trim() === "") throw new MalformedStoredRecordError(`truck ${docId} has missing/invalid displayLabel`);
  if (typeof data.vehicleNumber !== "string" || data.vehicleNumber.trim() === "") throw new MalformedStoredRecordError(`truck ${docId} has missing/invalid vehicleNumber`);
  const displayLabel = data.displayLabel;
  const vehicleNumber = data.vehicleNumber;
  return {
    truck: {
      truckId: docId,
      locationId: data.locationId,
      homeWarehouseId: data.homeWarehouseId,
      status: data.status as TruckStatus,
      assignedDriverEmployeeId: driver as string | null,
      displayLabel,
      vehicleNumber,
    },
    active: readActive(docId, data),
    ...readMeta(docId, data),
  };
}

export function claimToFirestore(c: StoredClaim): Record<string, unknown> {
  return { locationId: c.locationId, truckId: c.truckId, version: c.version, createdAt: Timestamp.fromDate(c.createdAt), createdBy: c.createdBy };
}
export function claimFromFirestore(docId: string, data: Record<string, unknown> | undefined): StoredClaim {
  if (data === undefined) throw new MalformedStoredRecordError(`claim ${docId} has no data`);
  if (data.locationId !== docId) throw new MalformedStoredRecordError(`claim ${docId} carries mismatched locationId`);
  if (typeof data.truckId !== "string" || data.truckId.trim() === "") throw new MalformedStoredRecordError(`claim ${docId} has invalid truckId`);
  if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < INITIAL_VERSION) throw new MalformedStoredRecordError(`claim ${docId} has invalid version`);
  if (!(data.createdAt instanceof Timestamp)) throw new MalformedStoredRecordError(`claim ${docId} has invalid createdAt`);
  if (typeof data.createdBy !== "string") throw new MalformedStoredRecordError(`claim ${docId} has invalid createdBy`);
  return { locationId: docId, truckId: data.truckId, version: data.version, createdAt: data.createdAt.toDate(), createdBy: data.createdBy };
}

// ---- repository contract + Firestore adapter ----
export interface TruckRegistryRepository {
  getTruck(txn: Transaction, truckId: string): Promise<StoredTruck | null>;
  getLocation(txn: Transaction, locationId: string): Promise<StoredMobileLocation | null>;
  getClaim(txn: Transaction, locationId: string): Promise<StoredClaim | null>;
  stageCreateLocation(txn: Transaction, s: StoredMobileLocation): void;
  stageUpdateLocation(txn: Transaction, s: StoredMobileLocation): void;
  stageCreateTruck(txn: Transaction, s: StoredTruck): void;
  stageUpdateTruck(txn: Transaction, s: StoredTruck): void;
  stageCreateClaim(txn: Transaction, c: StoredClaim): void;
  /** Created-in-Error hard delete ONLY (deleteTruckCreatedInError) -- physical removal. */
  stageDeleteTruck(txn: Transaction, truckId: string): void;
  stageDeleteLocation(txn: Transaction, locationId: string): void;
  stageDeleteClaim(txn: Transaction, locationId: string): void;
  /** ACTIVE-existence checks for injected reference validation -- all reads through the txn. */
  isEmployeeActive(txn: Transaction, employeeId: string): Promise<boolean>;
  isWarehouseActive(txn: Transaction, warehouseId: string): Promise<boolean>;
  /**
   * Cross-truck driver-uniqueness lookup. Mirrors the boundedReferenceQuery pattern in
   * operationalReferenceProbe.ts: a bounded (limit 2), single-field equality query on
   * assignedDriverEmployeeId -- the automatic single-field index applies, no composite index
   * required -- read through the SAME transaction so a concurrent conflicting assignment
   * conflicts the commit. limit(2) (not 1) because excludeTruckId itself may already hold this
   * driver (a same-truck reassign-to-current-driver is not a conflict); returns the truckId of
   * the first OTHER truck found still holding this driver, or null if none.
   */
  findOtherTruckWithDriver(txn: Transaction, employeeId: string, excludeTruckId: string): Promise<string | null>;
}

export function buildFirestoreTruckRegistryRepository(db: Firestore): TruckRegistryRepository {
  const truckRef = (id: string) => db.collection(TRUCKS_COLLECTION).doc(id);
  const locRef = (id: string) => db.collection(MOBILE_LOCATIONS_COLLECTION).doc(id);
  const claimRef = (id: string) => db.collection(LOCATION_TRUCK_CLAIMS_COLLECTION).doc(id);
  return {
    async getTruck(txn, truckId) {
      const snap = await txn.get(truckRef(truckId));
      return snap.exists ? truckFromFirestore(snap.id, snap.data()) : null;
    },
    async getLocation(txn, locationId) {
      const snap = await txn.get(locRef(locationId));
      return snap.exists ? mobileLocationFromFirestore(snap.id, snap.data()) : null;
    },
    async getClaim(txn, locationId) {
      const snap = await txn.get(claimRef(locationId));
      return snap.exists ? claimFromFirestore(snap.id, snap.data()) : null;
    },
    stageCreateLocation(txn, s) { txn.create(locRef(s.location.locationId), mobileLocationToFirestore(s)); },
    stageUpdateLocation(txn, s) { txn.set(locRef(s.location.locationId), mobileLocationToFirestore(s)); },
    stageCreateTruck(txn, s) { txn.create(truckRef(s.truck.truckId), truckToFirestore(s)); },
    stageUpdateTruck(txn, s) { txn.set(truckRef(s.truck.truckId), truckToFirestore(s)); },
    stageCreateClaim(txn, c) { txn.create(claimRef(c.locationId), claimToFirestore(c)); },
    stageDeleteTruck(txn, truckId) { txn.delete(truckRef(truckId)); },
    stageDeleteLocation(txn, locationId) { txn.delete(locRef(locationId)); },
    stageDeleteClaim(txn, locationId) { txn.delete(claimRef(locationId)); },
    async isEmployeeActive(txn, employeeId) {
      // employmentStatus is the authoritative Employee lifecycle field (domain/employees.js).
      const snap = await txn.get(db.collection(EMPLOYEES_COLLECTION).doc(employeeId));
      return snap.exists && snap.data()?.employmentStatus === "ACTIVE";
    },
    async isWarehouseActive(txn, warehouseId) {
      // Existence-primary; a warehouse explicitly flagged inactive fails closed. Warehouses on
      // main carry no mandatory active/status field, so absence of the flag = active, but a
      // present active===false / status==="INACTIVE" is rejected.
      const snap = await txn.get(db.collection(WAREHOUSES_COLLECTION).doc(warehouseId));
      if (!snap.exists) return false;
      const d = snap.data() ?? {};
      return d.active !== false && d.status !== "INACTIVE";
    },
    async findOtherTruckWithDriver(txn, employeeId, excludeTruckId) {
      const snap = await txn.get(db.collection(TRUCKS_COLLECTION).where("assignedDriverEmployeeId", "==", employeeId).limit(2));
      for (const doc of snap.docs) {
        if (doc.id !== excludeTruckId) return doc.id;
      }
      return null;
    },
  };
}
