"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeProfileSnapshotError = exports.SNAPSHOT_VERSION = exports.SNAPSHOT_FORMAT = exports.PROFILE_COLUMNS = void 0;
exports.parseEmployeeProfileSnapshot = parseEmployeeProfileSnapshot;
exports.censusEmployeeProfileSnapshot = censusEmployeeProfileSnapshot;
// EOS_EMPLOYEE_PROFILE_SNAPSHOT -- the parsed, censused, canonical form of the one-time Firestore `employees` export
// (functions/scripts/exportEmployeeProfileSnapshot.js, MIGRATION-ONLY). Pure: no Firebase, no database, no I/O.
//
// FORMAT (version 1):
//   { "format": "EOS_EMPLOYEE_PROFILE_SNAPSHOT", "version": 1,
//     "source": { "firebaseProjectId": string, "exportedAt": ISO-8601 },
//     "employees": [ { "id": string, "data": { ...Firestore fields, timestamps as {"$timestamp": {...}} } }, ... ] }
//
// FIELD MAPPING. Exactly the governed profile fields of access/employeeProfileCommands.ts EDITABLE_EMPLOYEE_FIELDS, with
// the command's own normalization: text is trimmed, "" is null, at most 200 characters; employeeNumber, workEmail and
// the calendar dates are shape-checked with the command's patterns. A value that is present but not valid is a CENSUS
// BLOCKER (reconcile the source), never coerced or guessed.
//
//   displayName firstName middleName lastName preferredName employeeNumber jobTitle workEmail workPhone mobilePhone
//   address.street address.unit address.city address.state address.postalCode hireDate separationDate
//   managerEmployeeId -> a reporting-relationship CANDIDATE (never a column)
//
// NOT MAPPED, BY RULING: operationalRoles (ruling E: counted, never copied), securityRole, role, userId / any Firebase
// uid (counted as provenance evidence only; never written to any PostgreSQL column), employmentStatus and
// operatingCompanyId (already the Employee authority's own facts in eos_workforce.employees; a disagreement is reported
// for reconciliation, never overwritten by a profile copy).
const node_crypto_1 = require("node:crypto");
const employeeProfileVocabulary_1 = require("../employeeProfileVocabulary");
var employeeProfileVocabulary_2 = require("../employeeProfileVocabulary");
Object.defineProperty(exports, "PROFILE_COLUMNS", { enumerable: true, get: function () { return employeeProfileVocabulary_2.PROFILE_COLUMNS; } });
exports.SNAPSHOT_FORMAT = "EOS_EMPLOYEE_PROFILE_SNAPSHOT";
exports.SNAPSHOT_VERSION = 1;
class EmployeeProfileSnapshotError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "EmployeeProfileSnapshotError";
    }
}
exports.EmployeeProfileSnapshotError = EmployeeProfileSnapshotError;
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
function parseEmployeeProfileSnapshot(raw) {
    const r = raw;
    if (!r || typeof r !== "object" || r.format !== exports.SNAPSHOT_FORMAT || r.version !== exports.SNAPSHOT_VERSION) {
        throw new EmployeeProfileSnapshotError("SNAPSHOT_FORMAT_INVALID", `not an ${exports.SNAPSHOT_FORMAT} version ${exports.SNAPSHOT_VERSION} document`);
    }
    const source = r.source;
    if (!source || typeof source.firebaseProjectId !== "string" || source.firebaseProjectId === ""
        || typeof source.exportedAt !== "string" || Number.isNaN(Date.parse(source.exportedAt))) {
        throw new EmployeeProfileSnapshotError("SNAPSHOT_SOURCE_INVALID", "the snapshot must name its Firebase project and export time");
    }
    if (!Array.isArray(r.employees))
        throw new EmployeeProfileSnapshotError("SNAPSHOT_FORMAT_INVALID", "employees must be an array");
    const employees = r.employees.map((e, i) => {
        const doc = e;
        if (!doc || typeof doc.id !== "string" || !doc.data || typeof doc.data !== "object" || Array.isArray(doc.data)) {
            throw new EmployeeProfileSnapshotError("SNAPSHOT_FORMAT_INVALID", `employees[${i}] must be { id, data }`);
        }
        return { id: doc.id, data: doc.data };
    });
    return { source: { firebaseProjectId: source.firebaseProjectId, exportedAt: new Date(source.exportedAt).toISOString() }, employees };
}
function readAt(data, dotted) {
    const [head, tail] = dotted.split(".");
    const v = data[head];
    if (tail === undefined)
        return v;
    if (v === undefined || v === null)
        return undefined;
    if (typeof v !== "object" || Array.isArray(v))
        return Symbol.for("NOT_A_MAP");
    return v[tail];
}
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function censusEmployeeProfileSnapshot(snapshot) {
    const blockers = [];
    const reconciliation = [];
    const profiles = [];
    const managers = [];
    const authority = [];
    const seenIds = new Set();
    const numbers = new Map();
    let legacyAccountPointers = 0;
    let operationalRolesNotMigrated = 0;
    const ids = new Set(snapshot.employees.map((e) => e.id));
    for (const doc of [...snapshot.employees].sort(byId)) {
        if (!ID_SHAPE(doc.id)) {
            blockers.push({ id: doc.id, field: null, code: "EMPLOYEE_ID_INVALID" });
            continue;
        }
        if (seenIds.has(doc.id)) {
            blockers.push({ id: doc.id, field: null, code: "EMPLOYEE_ID_DUPLICATE" });
            continue;
        }
        seenIds.add(doc.id);
        if (doc.data.userId !== undefined && doc.data.userId !== null)
            legacyAccountPointers += 1;
        if (Array.isArray(doc.data.operationalRoles) && doc.data.operationalRoles.length > 0)
            operationalRolesNotMigrated += 1;
        const profile = { id: doc.id };
        for (const [path, column, kind] of employeeProfileVocabulary_1.PROFILE_FIELD_MAP) {
            const raw = readAt(doc.data, path);
            if (typeof raw === "symbol") {
                blockers.push({ id: doc.id, field: path, code: "ADDRESS_NOT_A_MAP" });
                profile[column] = null;
                continue;
            }
            const n = (0, employeeProfileVocabulary_1.normalizeProfileValue)(kind, raw);
            if ("code" in n) {
                blockers.push({ id: doc.id, field: path, code: n.code });
                profile[column] = null;
                continue;
            }
            profile[column] = n.value;
        }
        profiles.push(profile);
        authority.push({
            id: doc.id,
            employmentStatus: typeof doc.data.employmentStatus === "string" ? doc.data.employmentStatus : null,
            operatingCompanyId: typeof doc.data.operatingCompanyId === "string" ? doc.data.operatingCompanyId : null,
        });
        if (profile.employee_number) {
            const key = profile.employee_number.toUpperCase();
            numbers.set(key, [...(numbers.get(key) ?? []), doc.id]);
        }
        const m = (0, employeeProfileVocabulary_1.normalizeProfileValue)("TEXT", doc.data.managerEmployeeId);
        if ("code" in m)
            blockers.push({ id: doc.id, field: "managerEmployeeId", code: m.code });
        else if (m.value !== null) {
            if (!ID_SHAPE(m.value))
                blockers.push({ id: doc.id, field: "managerEmployeeId", code: "MANAGER_ID_INVALID" });
            else if (m.value === doc.id)
                reconciliation.push({ id: doc.id, field: "managerEmployeeId", code: "MANAGER_IS_SELF" });
            else if (!ids.has(m.value))
                reconciliation.push({ id: doc.id, field: "managerEmployeeId", code: "MANAGER_NOT_IN_SNAPSHOT" });
            else
                managers.push({ employeeId: doc.id, managerEmployeeId: m.value });
        }
    }
    for (const [, holders] of numbers) {
        if (holders.length > 1)
            for (const id of holders)
                blockers.push({ id, field: "employeeNumber", code: "EMPLOYEE_NUMBER_DUPLICATE" });
    }
    const canonical = { exportedAt: snapshot.source.exportedAt, profiles, managers, authority };
    const canonicalDigest = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(canonical)).digest("hex");
    return {
        census: {
            employees: snapshot.employees.length,
            copyReady: blockers.length === 0,
            blockers,
            reconciliation,
            managerCandidates: managers.length,
            legacyAccountPointers,
            operationalRolesNotMigrated,
            canonicalDigest,
        },
        canonical,
    };
}
//# sourceMappingURL=employeeProfileSnapshot.js.map