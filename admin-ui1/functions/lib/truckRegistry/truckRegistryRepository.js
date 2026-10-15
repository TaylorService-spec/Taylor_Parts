"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INITIAL_VERSION = exports.WAREHOUSES_COLLECTION = exports.EMPLOYEES_COLLECTION = exports.LOCATION_TRUCK_CLAIMS_COLLECTION = exports.MOBILE_LOCATIONS_COLLECTION = exports.TRUCKS_COLLECTION = void 0;
exports.mobileLocationToFirestore = mobileLocationToFirestore;
exports.mobileLocationFromFirestore = mobileLocationFromFirestore;
exports.truckToFirestore = truckToFirestore;
exports.truckFromFirestore = truckFromFirestore;
exports.claimToFirestore = claimToFirestore;
exports.claimFromFirestore = claimFromFirestore;
exports.buildFirestoreTruckRegistryRepository = buildFirestoreTruckRegistryRepository;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("./types");
exports.TRUCKS_COLLECTION = "trucks";
exports.MOBILE_LOCATIONS_COLLECTION = "mobile_locations";
exports.LOCATION_TRUCK_CLAIMS_COLLECTION = "location_truck_claims";
exports.EMPLOYEES_COLLECTION = "employees";
exports.WAREHOUSES_COLLECTION = "warehouses";
exports.INITIAL_VERSION = 1;
// ---- serialization (strict; explicit Timestamp handling) ----
function metaToFirestore(meta) {
    return {
        version: meta.version,
        createdAt: firestore_1.Timestamp.fromDate(meta.createdAt),
        createdBy: meta.createdBy,
        updatedAt: firestore_1.Timestamp.fromDate(meta.updatedAt),
        updatedBy: meta.updatedBy,
    };
}
function readMeta(docId, data) {
    const { version, createdAt, createdBy, updatedAt, updatedBy } = data;
    if (typeof version !== "number" || !Number.isInteger(version) || version < exports.INITIAL_VERSION ||
        !(createdAt instanceof firestore_1.Timestamp) || !(updatedAt instanceof firestore_1.Timestamp) ||
        typeof createdBy !== "string" || typeof updatedBy !== "string") {
        throw new types_1.MalformedStoredRecordError(`stored record ${docId} has malformed version/audit metadata`);
    }
    return { version, createdAt: createdAt.toDate(), createdBy, updatedAt: updatedAt.toDate(), updatedBy };
}
function readActive(docId, data) {
    if (typeof data.active !== "boolean")
        throw new types_1.MalformedStoredRecordError(`stored record ${docId} has non-boolean active`);
    return data.active;
}
function mobileLocationToFirestore(s) {
    return {
        locationId: s.location.locationId,
        type: "MOBILE",
        displayLabel: s.location.displayLabel,
        active: s.active,
        ...metaToFirestore(s),
    };
}
function mobileLocationFromFirestore(docId, data) {
    if (data === undefined)
        throw new types_1.MalformedStoredRecordError(`mobile_location ${docId} has no data`);
    if (data.locationId !== docId)
        throw new types_1.MalformedStoredRecordError(`mobile_location ${docId} carries mismatched locationId`);
    if (data.type !== "MOBILE")
        throw new types_1.MalformedStoredRecordError(`mobile_location ${docId} is not MOBILE`);
    if (typeof data.displayLabel !== "string" || data.displayLabel.trim() === "")
        throw new types_1.MalformedStoredRecordError(`mobile_location ${docId} has missing/invalid displayLabel`);
    return { location: { locationId: docId, type: "MOBILE", displayLabel: data.displayLabel }, active: readActive(docId, data), ...readMeta(docId, data) };
}
function truckToFirestore(s) {
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
function truckFromFirestore(docId, data) {
    if (data === undefined)
        throw new types_1.MalformedStoredRecordError(`truck ${docId} has no data`);
    if (data.truckId !== docId)
        throw new types_1.MalformedStoredRecordError(`truck ${docId} carries mismatched truckId`);
    if (typeof data.locationId !== "string" || data.locationId.trim() === "")
        throw new types_1.MalformedStoredRecordError(`truck ${docId} has invalid locationId`);
    if (typeof data.homeWarehouseId !== "string" || data.homeWarehouseId.trim() === "")
        throw new types_1.MalformedStoredRecordError(`truck ${docId} has invalid homeWarehouseId`);
    if (typeof data.status !== "string" || !types_1.TRUCK_STATUSES.includes(data.status))
        throw new types_1.MalformedStoredRecordError(`truck ${docId} has invalid status`);
    const driver = data.assignedDriverEmployeeId;
    if (!(driver === null || (typeof driver === "string" && driver.trim() !== "")))
        throw new types_1.MalformedStoredRecordError(`truck ${docId} has invalid assignedDriverEmployeeId`);
    if (typeof data.displayLabel !== "string" || data.displayLabel.trim() === "")
        throw new types_1.MalformedStoredRecordError(`truck ${docId} has missing/invalid displayLabel`);
    if (typeof data.vehicleNumber !== "string" || data.vehicleNumber.trim() === "")
        throw new types_1.MalformedStoredRecordError(`truck ${docId} has missing/invalid vehicleNumber`);
    const displayLabel = data.displayLabel;
    const vehicleNumber = data.vehicleNumber;
    return {
        truck: {
            truckId: docId,
            locationId: data.locationId,
            homeWarehouseId: data.homeWarehouseId,
            status: data.status,
            assignedDriverEmployeeId: driver,
            displayLabel,
            vehicleNumber,
        },
        active: readActive(docId, data),
        ...readMeta(docId, data),
    };
}
function claimToFirestore(c) {
    return { locationId: c.locationId, truckId: c.truckId, version: c.version, createdAt: firestore_1.Timestamp.fromDate(c.createdAt), createdBy: c.createdBy };
}
function claimFromFirestore(docId, data) {
    if (data === undefined)
        throw new types_1.MalformedStoredRecordError(`claim ${docId} has no data`);
    if (data.locationId !== docId)
        throw new types_1.MalformedStoredRecordError(`claim ${docId} carries mismatched locationId`);
    if (typeof data.truckId !== "string" || data.truckId.trim() === "")
        throw new types_1.MalformedStoredRecordError(`claim ${docId} has invalid truckId`);
    if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < exports.INITIAL_VERSION)
        throw new types_1.MalformedStoredRecordError(`claim ${docId} has invalid version`);
    if (!(data.createdAt instanceof firestore_1.Timestamp))
        throw new types_1.MalformedStoredRecordError(`claim ${docId} has invalid createdAt`);
    if (typeof data.createdBy !== "string")
        throw new types_1.MalformedStoredRecordError(`claim ${docId} has invalid createdBy`);
    return { locationId: docId, truckId: data.truckId, version: data.version, createdAt: data.createdAt.toDate(), createdBy: data.createdBy };
}
function buildFirestoreTruckRegistryRepository(db) {
    const truckRef = (id) => db.collection(exports.TRUCKS_COLLECTION).doc(id);
    const locRef = (id) => db.collection(exports.MOBILE_LOCATIONS_COLLECTION).doc(id);
    const claimRef = (id) => db.collection(exports.LOCATION_TRUCK_CLAIMS_COLLECTION).doc(id);
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
            const snap = await txn.get(db.collection(exports.EMPLOYEES_COLLECTION).doc(employeeId));
            return snap.exists && snap.data()?.employmentStatus === "ACTIVE";
        },
        async isWarehouseActive(txn, warehouseId) {
            // Existence-primary; a warehouse explicitly flagged inactive fails closed. Warehouses on
            // main carry no mandatory active/status field, so absence of the flag = active, but a
            // present active===false / status==="INACTIVE" is rejected.
            const snap = await txn.get(db.collection(exports.WAREHOUSES_COLLECTION).doc(warehouseId));
            if (!snap.exists)
                return false;
            const d = snap.data() ?? {};
            return d.active !== false && d.status !== "INACTIVE";
        },
        async findOtherTruckWithDriver(txn, employeeId, excludeTruckId) {
            const snap = await txn.get(db.collection(exports.TRUCKS_COLLECTION).where("assignedDriverEmployeeId", "==", employeeId).limit(2));
            for (const doc of snap.docs) {
                if (doc.id !== excludeTruckId)
                    return doc.id;
            }
            return null;
        },
    };
}
//# sourceMappingURL=truckRegistryRepository.js.map