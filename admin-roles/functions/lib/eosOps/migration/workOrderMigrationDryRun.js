"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_CLASSIFIED_EXCLUSIONS = exports.ManifestRefusedError = exports.canonicalJson = exports.numberShape = exports.TYPE_RESOLUTIONS = exports.FACT_CLASSES = exports.FIXTURE_FAMILIES = exports.TERMINAL_STATUSES = exports.TARGET_SEVERITIES = exports.TARGET_WORK_ORDER_TYPES = exports.NATIVE_WORK_ORDER_NUMBER = exports.RECORD_CLASSES = exports.BLOCKER_KINDS = exports.RECORD_RESULTS = exports.FIELD_ACTIONS = void 0;
exports.classifyFixtureFamilies = classifyFixtureFamilies;
exports.resolveOperatingCompany = resolveOperatingCompany;
exports.resolveWorkOrderType = resolveWorkOrderType;
exports.resolveWorkOrderNumber = resolveWorkOrderNumber;
exports.classifyAssignment = classifyAssignment;
exports.classifyRecord = classifyRecord;
exports.canonicalize = canonicalize;
exports.buildSourceSnapshot = buildSourceSnapshot;
exports.runDryRun = runDryRun;
exports.validateResolutionManifest = validateResolutionManifest;
exports.buildOwnerWorksheet = buildOwnerWorksheet;
exports.buildAssignmentWorksheet = buildAssignmentWorksheet;
exports.buildManifestScaffold = buildManifestScaffold;
exports.ownerExclusionsForSnapshot = ownerExclusionsForSnapshot;
// THE WORK ORDER MIGRATION DRY RUN -- pure classification core.
//
// ════════════════════ WHAT THIS IS ════════════════════
//
// workOrderFieldParityMatrix.ts says WHERE each legacy fact belongs in the target model. That is a
// different question from WHAT THE MIGRATION DOES WITH IT, and conflating the two is how a parity
// document gets mistaken for migration tooling. This module answers the second question, per RECORD and
// per FIELD, and it answers it from the matrix rather than restating the matrix -- so a field cannot be
// dispositioned here in a way that contradicts where the model says it lives.
//
// PURE. No Firebase, no PostgreSQL, no I/O, no clock, no randomness. It takes plain source documents and
// returns a report. That is what makes the classification testable against adversarial fixtures rather
// than only against whatever sandbox happens to contain today.
//
// IT WRITES NOTHING, and there is no code path here that could: no client, no pool, no `set`, no `INSERT`.
//
// ════════════════════ THE RULE THAT SHAPES EVERYTHING ELSE ════════════════════
//
// NO SILENT DEFAULT. Every record ends in exactly one of COPYABLE / EXCLUDED_WITH_EVIDENCE / BLOCKED, and
// every governed field ends in exactly one disposition. Where evidence is absent the answer is a BLOCKER
// naming what is missing -- never a guess that happens to satisfy a NOT NULL column. A migration that
// invents the facts its target requires produces a database that is full and wrong.
const workOrderFieldParityMatrix_js_1 = require("./workOrderFieldParityMatrix.js");
// ════════════════════ vocabulary ════════════════════
/** What the migration DOES with one field. */
exports.FIELD_ACTIONS = Object.freeze([
    "COPY", "DERIVE", "HISTORICAL_ONLY", "INTENTIONALLY_RETIRED", "BLOCKER",
]);
/** Exactly one per source record. */
exports.RECORD_RESULTS = Object.freeze([
    "COPYABLE", "EXCLUDED_WITH_EVIDENCE", "BLOCKED",
]);
exports.BLOCKER_KINDS = Object.freeze([
    "OPERATING_COMPANY_UNRESOLVED",
    "WORK_ORDER_TYPE_REQUIRES_RESOLUTION",
    "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED",
    "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION",
    "TARGET_CONFLICT",
    "REFERENCE_NOT_FOUND",
    "OTHER",
]);
exports.RECORD_CLASSES = Object.freeze([
    "BUSINESS", "SANDBOX_FIXTURE", "CERTIFICATION_FIXTURE", "OTHER_NONBUSINESS_EVIDENCE",
]);
/**
 * THE TARGET'S OWN NUMBER CONSTRAINT, restated from migration 1761004800000
 * (`work_order_number_format`). Native rows stay constrained to this; a historical record that does not
 * match is NEVER renumbered -- it is reported as requiring a migration-compatibility decision.
 */
exports.NATIVE_WORK_ORDER_NUMBER = /^WO-[0-9]{4}-[0-9]{6,}$/;
/** The target's governed type vocabulary (`ops_work_order_type`). */
exports.TARGET_WORK_ORDER_TYPES = Object.freeze(["SERVICE_CALL", "PM", "INSTALL", "WARRANTY", "INSPECTION"]);
/** The target's governed severity vocabulary (`ops_work_order_severity`). */
exports.TARGET_SEVERITIES = Object.freeze(["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC", "PREVENTIVE"]);
/** Terminal statuses -- the SAME three the transition engine calls terminal. */
exports.TERMINAL_STATUSES = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"]);
exports.FIXTURE_FAMILIES = Object.freeze([
    Object.freeze({
        key: "SBX-SCN-001",
        recordClass: "SANDBOX_FIXTURE",
        authoredBy: "functions/scripts/seedSandboxTransactional.js",
        scenarioId: "SBX-SCN-001",
        idPattern: /^wo-sbx-[0-9]{3}$/,
        numberPattern: /^WO-[0-9]{4}-SBX[0-9]{3}$/,
        authoredType: "SERVICE",
        reason: "Authored by the sandbox TRANSACTIONAL operating pack. The seeder composes the number as "
            + "`WO-${YEAR}-SBX${n padded to 3}`, writes document ids `wo-sbx-NNN`, and stamps scenarioId "
            + "SBX-SCN-001 on every record. Synthetic operating evidence for a scenario, not customer work.",
    }),
    Object.freeze({
        key: "SBX-SCN-002",
        recordClass: "SANDBOX_FIXTURE",
        authoredBy: "functions/scripts/seedSandboxCoordinatedInstall.js",
        scenarioId: "SBX-SCN-002",
        idPattern: /^wo-c713-[0-9]+$/,
        numberPattern: /^WO-[0-9]{4}-C713[0-9]{2}$/,
        authoredType: "INSTALL",
        reason: "Authored by the sandbox COORDINATED INSTALL pack: five identical units, one customer, one site, "
            + "one install day. The seeder composes `WO-${YEAR}-C713${n padded to 2}`, writes ids `wo-c713-N`, "
            + "and stamps scenarioId SBX-SCN-002. The 'C' is a MODEL NUMBER (Arctic C713), not a classification.",
    }),
]);
const text = (v) => typeof v === "string" && v.trim() !== "" ? v : null;
/**
 * Decide each declared family, from evidence only.
 *
 * A record is a CANDIDATE if it matches the family's number pattern. It is a MEMBER only if the id,
 * scenarioId and authored type all agree too. Any candidate that is not a member is a DIVERGENCE, and one
 * divergence refuses the family.
 */
function classifyFixtureFamilies(records, families = exports.FIXTURE_FAMILIES) {
    return Object.freeze(families.map((family) => {
        const candidates = records.filter((r) => family.numberPattern.test(String(r.data.woNumber ?? "")));
        const members = [];
        const diverged = [];
        for (const record of candidates) {
            const agrees = family.idPattern.test(record.id) &&
                text(record.data.scenarioId) === family.scenarioId &&
                text(record.data.type) === family.authoredType;
            (agrees ? members : diverged).push(record.id);
        }
        const excluded = diverged.length === 0 && members.length > 0;
        return Object.freeze({
            key: family.key,
            recordClass: family.recordClass,
            authoredBy: family.authoredBy,
            reason: family.reason,
            excluded,
            memberIds: Object.freeze(members.sort()),
            divergedIds: Object.freeze(diverged.sort()),
            refusalReason: diverged.length > 0
                ? `FIXTURE_EXCLUSION_REFUSED: ${diverged.length} record(s) carry this family's number shape but not its `
                    + "authored id / scenarioId / type. A diverged or user-authored occupant means the family cannot be "
                    + "excluded wholesale, so every member is treated as BUSINESS."
                : members.length === 0 ? "no record matches this family's number shape" : null,
        });
    }));
}
/**
 * Resolve the operating company from GOVERNED EVIDENCE ONLY.
 *
 * ownershipMatrix.ts already ruled this family: `fieldops_wos` has `ownerFields: []` -- no company storage
 * at all -- with `unresolvedPolicy: "remains OWNERLESS -- NO_GOVERNED_COMPANY_SOURCE"`, and it names
 * exactly ONE governed upstream: "a governed upstream source that already carries one (e.g. a Sales
 * Order)". So there are exactly two ways to an answer, in order:
 *
 *   1. the record's own stored company, if the model ever grows one
 *   2. the Sales Order it descends from, IF that Sales Order carries a governed company
 *
 * and one way to no answer, which is the common one. NOTHING ELSE IS TRIED. Not the warehouse, not the
 * account, not the location, not the technician, not a tenant default -- the matrix names those as
 * precisely what must not decide it, and "Taylor is the only company anyone has mentioned" is the
 * inference that makes a multi-company platform silently wrong.
 *
 * The manifest is consulted LAST and only reports what a human already decided; this function never
 * writes one.
 */
function resolveOperatingCompany(record, evidence) {
    const stored = text(record.data.operatingCompanyId) ?? text(record.data.operatingCompanyKey);
    if (stored) {
        return Object.freeze({
            workOrderId: record.id, resolutionStatus: "EXACT_SOURCE_EVIDENCE",
            evidenceKind: "WORK_ORDER_STORED_COMPANY", resolvedOperatingCompanyKey: stored,
        });
    }
    const salesOrderId = text(record.data.salesOrderId);
    if (salesOrderId) {
        const upstream = evidence.salesOrders.get(salesOrderId);
        const company = upstream ? text(upstream.operatingCompanyId) : null;
        if (company) {
            return Object.freeze({
                workOrderId: record.id, resolutionStatus: "EXACT_SOURCE_EVIDENCE",
                evidenceKind: "GOVERNED_UPSTREAM_SALES_ORDER", resolvedOperatingCompanyKey: company,
            });
        }
    }
    const manifest = evidence.resolutionManifest?.byWorkOrderId.get(record.id)?.operatingCompanyId ?? null;
    if (manifest) {
        return Object.freeze({
            workOrderId: record.id, resolutionStatus: "EXACT_SOURCE_EVIDENCE",
            evidenceKind: "OWNER_AUTHORED_RESOLUTION_MANIFEST", resolvedOperatingCompanyKey: manifest,
        });
    }
    return Object.freeze({
        workOrderId: record.id, resolutionStatus: "EXPLICIT_RESOLUTION_REQUIRED",
        evidenceKind: salesOrderId
            ? "NO_GOVERNED_COMPANY_SOURCE: the Sales Order lineage exists but carries no company"
            : "NO_GOVERNED_COMPANY_SOURCE: no stored company and no governed upstream",
        resolvedOperatingCompanyKey: null,
    });
}
// ════════════════════ type ════════════════════
/**
 * WHERE A FACT CAME FROM. Three kinds, never shown as equivalent.
 *
 * The distinction matters most exactly where it is easiest to lose: after normalization, a Work Order
 * whose type was NEVER RECORDED and one that genuinely said SERVICE_CALL look identical in the target.
 * One is a source fact and the other is a decision somebody made during a migration, and a report that
 * prints them the same way has quietly turned an assumption into history.
 */
exports.FACT_CLASSES = Object.freeze([
    "SOURCE_FACT", "OWNER_MIGRATION_RESOLUTION", "DERIVED_FACT",
]);
exports.TYPE_RESOLUTIONS = Object.freeze([
    "SOURCE_EXACT", "OWNER_LEGACY_SERVICE_NORMALIZATION", "OWNER_LEGACY_DEFAULT", "UNRESOLVED",
]);
/**
 * Classify the Work Order type, under the OWNER MIGRATION NORMALIZATION.
 *
 * SERVICE -> SERVICE_CALL and a missing type -> SERVICE_CALL are OWNER DECISIONS about historical data,
 * not discoveries about it. Before the ruling this function blocked both, and it was right to: no rule in
 * the repository distinguishes SERVICE from SERVICE_CALL, so nothing could derive the intent. What
 * changed is not the evidence -- it is that someone with the authority to decide has decided.
 *
 * SO THE RAW VALUE IS KEPT AND THE RESOLUTION IS NAMED. A missing type resolves to SERVICE_CALL and
 * records `sourceValue: null` with `OWNER_LEGACY_DEFAULT`; the migration must never be able to claim the
 * source historically said SERVICE_CALL when it said nothing at all.
 *
 * THE NATIVE VOCABULARY IS UNTOUCHED. This is a migration normalization, not a vocabulary change: no
 * LEGACY_SERVICE or LEGACY_UNCLASSIFIED member is added, and a natively created Work Order still must
 * state one of the five governed types.
 *
 * AN UNRECOGNIZED VALUE STILL BLOCKS. The ruling covers SERVICE, absent, and exact target values. A
 * fourth spelling nobody has seen is not covered by it, and defaulting that to SERVICE_CALL would be the
 * tool deciding -- which is the thing it must never do.
 */
function resolveWorkOrderType(record) {
    const value = text(record.data.type) ?? text(record.data.workOrderType);
    if (value && exports.TARGET_WORK_ORDER_TYPES.includes(value)) {
        return Object.freeze({
            sourceValue: value, action: "COPY", targetValue: value,
            resolution: "SOURCE_EXACT", factClass: "SOURCE_FACT", provenance: "SOURCE",
            deterministic: true, reason: "exact match against the governed target vocabulary; copied unchanged",
        });
    }
    if (value === "SERVICE") {
        return Object.freeze({
            sourceValue: "SERVICE", action: "COPY", targetValue: "SERVICE_CALL",
            resolution: "OWNER_LEGACY_SERVICE_NORMALIZATION",
            factClass: "OWNER_MIGRATION_RESOLUTION", provenance: "MIGRATED",
            deterministic: true,
            reason: "OWNER MIGRATION NORMALIZATION: legacy SERVICE is recorded as SERVICE_CALL. The raw source value "
                + "is retained as evidence; this is a decision about history, not a fact discovered in it.",
        });
    }
    if (value === null) {
        return Object.freeze({
            sourceValue: null, action: "COPY", targetValue: "SERVICE_CALL",
            resolution: "OWNER_LEGACY_DEFAULT",
            factClass: "OWNER_MIGRATION_RESOLUTION", provenance: "MIGRATED",
            deterministic: true,
            reason: "OWNER LEGACY DEFAULT: the source recorded NO type, and eos_ops.work_orders.work_order_type is NOT "
                + "NULL. sourceValue stays null so the evidence never claims the source said SERVICE_CALL.",
        });
    }
    return Object.freeze({
        sourceValue: value, action: "BLOCKER", targetValue: null,
        resolution: "UNRESOLVED", factClass: "SOURCE_FACT", provenance: "SOURCE",
        deterministic: false,
        reason: `WORK_ORDER_TYPE_REQUIRES_RESOLUTION: '${value}' is neither a governed target value nor a value the `
            + "Owner normalization covers. Defaulting an unrecognized spelling would be this tool deciding.",
    });
}
/** Digits masked, so a shape can be counted without exposing a specific business reference. */
const numberShape = (value) => value === null ? "(absent)" : value.replace(/[0-9]/g, "#");
exports.numberShape = numberShape;
/**
 * Classify one Work Order number.
 *
 * THERE IS NO RENUMBER ACTION, deliberately. A Work Order number is what a person says on the phone and
 * what an invoice references; changing it during a migration silently breaks every conversation and every
 * paper record that already used it.
 */
function resolveWorkOrderNumber(record, recordClass) {
    const value = text(record.data.woNumber);
    const shape = (0, exports.numberShape)(value);
    if (recordClass !== "BUSINESS") {
        return Object.freeze({
            sourceNumber: value, shape, action: "EXCLUDE_WITH_EVIDENCE",
            reason: "the record is proven nonbusiness, so no target row is needed and its number never lands",
        });
    }
    if (value && exports.NATIVE_WORK_ORDER_NUMBER.test(value)) {
        return Object.freeze({
            sourceNumber: value, shape, action: "COPY_NATIVE_COMPATIBLE",
            reason: "matches the native format; copies unchanged",
        });
    }
    return Object.freeze({
        sourceNumber: value, shape, action: "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED",
        reason: "a genuine business Work Order whose historical number does not match the native CHECK. The number "
            + "is PRESERVED EXACTLY; the target must accept migrated history without widening the NATIVE "
            + "constraint -- a decision for the Owner, not for this tool.",
    });
}
function resolveTechnician(field, technicianId, evidence) {
    if (!technicianId) {
        return Object.freeze({ field, technicianId: null, resolution: "NOT_ASSIGNED", employeeId: null });
    }
    const technician = evidence.technicians.get(technicianId);
    if (!technician) {
        return Object.freeze({ field, technicianId, resolution: "TECHNICIAN_DOC_MISSING", employeeId: null });
    }
    if (!technician.employeeId) {
        return Object.freeze({ field, technicianId, resolution: "TECHNICIAN_HAS_NO_EMPLOYEE_ID", employeeId: null });
    }
    if (!evidence.employees.has(technician.employeeId)) {
        return Object.freeze({ field, technicianId, resolution: "EMPLOYEE_NOT_FOUND", employeeId: null });
    }
    return Object.freeze({ field, technicianId, resolution: "EXACT_EMPLOYEE", employeeId: technician.employeeId });
}
/**
 * Resolve both assignment references, independently, and classify the record.
 *
 * EXACT RESOLUTION ONLY: technician id -> technician record -> employeeId -> governed Employee. No name,
 * email, title or role matching -- those find A person, not THE person, and an assignment names who is
 * accountable for the work.
 *
 * A TERMINAL Work Order may migrate without a current assignment: its history is what matters and nobody
 * is going to do the work. An ACTIVE one may not -- an in-flight job whose technician cannot be resolved
 * would arrive in the target unassigned and silently stall.
 */
function classifyAssignment(record, evidence) {
    const decided = evidence.resolutionManifest?.byWorkOrderId.get(record.id)?.assignmentEmployeeId ?? null;
    const terminal = exports.TERMINAL_STATUSES.includes(String(record.data.status ?? ""));
    const references = Object.freeze([
        resolveTechnician("assignedTechId", text(record.data.assignedTechId), evidence),
        resolveTechnician("scheduledTechId", text(record.data.scheduledTechId), evidence),
    ]);
    const stated = references.filter((r) => r.technicianId !== null);
    const unresolved = stated.filter((r) => r.resolution !== "EXACT_EMPLOYEE");
    if (stated.length === 0) {
        return Object.freeze({
            workOrderId: record.id, terminal, references, outcome: "ASSIGNMENT_COPYABLE",
            reason: "no technician is named, so there is no assignment to carry",
        });
    }
    if (unresolved.length === 0) {
        return Object.freeze({
            workOrderId: record.id, terminal, references, outcome: "ASSIGNMENT_COPYABLE",
            reason: "every stated technician resolves to an exact governed Employee",
        });
    }
    if (decided) {
        // An EXPLICIT Owner decision, and it clears ONLY this blocker. It does not resolve the legacy
        // technician reference -- that stays unresolved in the evidence, because what happened historically
        // and who is accountable now are different facts.
        return Object.freeze({
            workOrderId: record.id, terminal, references, outcome: "ASSIGNMENT_COPYABLE",
            reason: `OWNER_MIGRATION_RESOLUTION: the assignee is explicitly decided as Employee ${decided}. The `
                + "unresolved legacy technician reference is retained as evidence and is NOT overwritten.",
        });
    }
    if (terminal) {
        return Object.freeze({
            workOrderId: record.id, terminal, references, outcome: "TERMINAL_ASSIGNMENT_HISTORICAL_ONLY",
            reason: "terminal Work Order with an unresolved technician reference. Migration-eligible with NO current "
                + "assignment row: the unresolved source reference is retained in evidence, no Employee is "
                + "invented, and the history stays explainable.",
        });
    }
    return Object.freeze({
        workOrderId: record.id, terminal, references, outcome: "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION",
        reason: "ACTIVE Work Order whose technician does not resolve to a governed Employee. It must be explicitly "
            + "resolved or reassigned before cutover -- an in-flight job cannot arrive unassigned.",
    });
}
/** The model disposition -> migration action mapping. Stated once, so the two axes cannot drift apart. */
const ACTION_FOR_MODEL_DISPOSITION = Object.freeze({
    GOVERNED_WORK_ORDER_FACT: "COPY",
    GOVERNED_ASSIGNMENT_FACT: "COPY",
    GOVERNED_OTHER_OBJECT_FACT: "COPY",
    DERIVED: "DERIVE",
    LEGACY_IDENTITY: "DERIVE",
    SUPERSEDED_BY_HISTORY: "HISTORICAL_ONLY",
    MIGRATION_EVIDENCE: "HISTORICAL_ONLY",
    APPROVED_RETIREMENT: "INTENTIONALLY_RETIRED",
    REMEDIATION_REQUIRED: "BLOCKER",
});
function referenceBlockers(record, evidence) {
    const out = [];
    const check = (field, value, present) => {
        if (value !== null && !present) {
            out.push({ kind: "REFERENCE_NOT_FOUND", detail: `${field} '${value}' resolves to no record in this source` });
        }
    };
    const customerId = text(record.data.customerId);
    const locationId = text(record.data.locationId);
    const equipmentId = text(record.data.equipmentId);
    const salesOrderId = text(record.data.salesOrderId);
    check("customerId", customerId, customerId === null || evidence.accounts.has(customerId));
    check("locationId", locationId, locationId === null || evidence.locations.has(locationId));
    check("equipmentId", equipmentId, equipmentId === null || evidence.equipment.has(equipmentId));
    check("salesOrderId", salesOrderId, salesOrderId === null || evidence.salesOrders.has(salesOrderId));
    return out;
}
/** Classify ONE source record. Every field gets an action; every failure names its blocker. */
function classifyRecord(record, recordClass, exclusionEvidence, evidence, matrix = workOrderFieldParityMatrix_js_1.WORK_ORDER_FIELD_PARITY_MATRIX) {
    const operatingCompany = resolveOperatingCompany(record, evidence);
    const type = resolveWorkOrderType(record);
    const number = resolveWorkOrderNumber(record, recordClass);
    const assignment = classifyAssignment(record, evidence);
    const targetIds = evidence.targetWorkOrderIds;
    const targetCollision = targetIds === null || targetIds === undefined
        ? "TARGET_COLLISION_STATUS_UNKNOWN"
        : targetIds.has(record.id) ? "TARGET_CONFLICT" : "TARGET_ABSENT";
    const blockers = [];
    if (recordClass === "BUSINESS") {
        if (operatingCompany.resolutionStatus === "EXPLICIT_RESOLUTION_REQUIRED") {
            blockers.push({ kind: "OPERATING_COMPANY_UNRESOLVED", detail: operatingCompany.evidenceKind });
        }
        if (type.action === "BLOCKER")
            blockers.push({ kind: "WORK_ORDER_TYPE_REQUIRES_RESOLUTION", detail: type.reason });
        if (number.action === "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED") {
            blockers.push({ kind: "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED", detail: `shape ${number.shape}` });
        }
        if (assignment.outcome === "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION") {
            blockers.push({ kind: "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION", detail: assignment.reason });
        }
        if (targetCollision === "TARGET_CONFLICT") {
            blockers.push({ kind: "TARGET_CONFLICT", detail: "a row with this id already exists in the target" });
        }
        blockers.push(...referenceBlockers(record, evidence));
    }
    // EVERY governed field gets exactly one action. The matrix decides where the fact lives; the record's
    // own evidence can only ever turn an action INTO a blocker, never out of one.
    const fields = matrix.map((entry) => {
        const base = ACTION_FOR_MODEL_DISPOSITION[entry.disposition] ?? "BLOCKER";
        if (entry.legacyField === "type") {
            return {
                field: entry.legacyField,
                action: type.action === "BLOCKER" ? "BLOCKER" : "COPY",
                factClass: type.factClass, reason: type.reason,
            };
        }
        if (entry.legacyField === "woNumber" && number.action === "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED") {
            return { field: entry.legacyField, action: "BLOCKER", factClass: "SOURCE_FACT", reason: number.reason };
        }
        if (entry.legacyField === "severity") {
            // RULING: severity is HISTORICAL_ONLY and NEVER becomes priority. Priority is an independent
            // governed fact whose source values already fit the target range, and folding a severity into it
            // would author a priority nobody set.
            const value = text(record.data.severity);
            const known = value !== null && exports.TARGET_SEVERITIES.includes(value);
            return {
                field: entry.legacyField, action: "HISTORICAL_ONLY", factClass: "SOURCE_FACT",
                reason: known
                    ? "carried as history; it does not and must not influence priority"
                    : `'${String(value)}' is outside the governed severity vocabulary -- retained as migration history only, `
                        + "never translated into priority",
            };
        }
        if (entry.legacyField === "assignedTechId" || entry.legacyField === "scheduledTechId") {
            const ref = assignment.references.find((r) => r.field === entry.legacyField);
            if (ref && ref.technicianId !== null && ref.resolution !== "EXACT_EMPLOYEE") {
                const decidedEmployee = evidence.resolutionManifest?.byWorkOrderId.get(record.id)?.assignmentEmployeeId ?? null;
                if (decidedEmployee) {
                    return { field: entry.legacyField, action: "HISTORICAL_ONLY",
                        factClass: "OWNER_MIGRATION_RESOLUTION",
                        reason: `${ref.resolution}; the legacy reference is retained as evidence and the assignee is an explicit Owner decision` };
                }
                return assignment.terminal
                    ? { field: entry.legacyField, action: "HISTORICAL_ONLY", factClass: "SOURCE_FACT",
                        reason: `${ref.resolution}; terminal record keeps the unresolved reference as evidence and authors no assignment row` }
                    : { field: entry.legacyField, action: "BLOCKER", factClass: "SOURCE_FACT",
                        reason: `${ref.resolution}; an ACTIVE Work Order cannot migrate with an unresolvable assignee` };
            }
        }
        const factClass = base === "DERIVE" ? "DERIVED_FACT" : "SOURCE_FACT";
        return { field: entry.legacyField, action: base, factClass, reason: entry.targetAuthority };
    });
    const result = recordClass !== "BUSINESS" ? "EXCLUDED_WITH_EVIDENCE"
        : blockers.length > 0 ? "BLOCKED"
            : "COPYABLE";
    return Object.freeze({
        workOrderId: record.id, recordClass, result,
        blockers: Object.freeze(blockers.map((b) => Object.freeze(b))),
        fields: Object.freeze(fields.map((f) => Object.freeze(f))),
        operatingCompany, type, number, assignment, targetCollision,
        exclusionEvidence,
    });
}
// ════════════════════ deterministic snapshot ════════════════════
/**
 * CANONICAL FORM: sorted keys, stable primitives, Timestamps as {seconds,nanos}.
 *
 * Determinism is the whole point. A snapshot whose checksum changes because two keys were enumerated in a
 * different order cannot prove that the source did not change between a DRY RUN and a COPY -- which is
 * the one thing a snapshot exists to prove. Mirrors the canonical form the M-1 cycle-count export used.
 */
function canonicalize(value) {
    if (value === null || value === undefined)
        return null;
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (typeof value === "object") {
        const obj = value;
        // A Firestore Timestamp, without importing Firebase to recognise one.
        if (typeof obj.toMillis === "function"
            && typeof obj.seconds === "number") {
            return { seconds: obj.seconds, nanos: obj.nanoseconds ?? 0 };
        }
        const out = {};
        for (const key of Object.keys(obj).sort())
            out[key] = canonicalize(obj[key]);
        return out;
    }
    return value;
}
/** Stable JSON for hashing. Never used as a data format -- only as bytes to digest. */
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
exports.canonicalJson = canonicalJson;
/**
 * Build the snapshot. `digest` is injected so this module stays free of node:crypto and therefore pure --
 * and so a test can prove the ORDERING is what makes the checksum stable, independently of the hash.
 */
function buildSourceSnapshot(sourceProject, collection, records, digest) {
    const documents = [...records]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((record) => {
        const canonical = (0, exports.canonicalJson)(record.data);
        return Object.freeze({ id: record.id, canonical, sha256: digest(canonical) });
    });
    const body = documents.map((d) => `${d.id}:${d.sha256}`).join("\n");
    return Object.freeze({
        sourceProject, collection,
        documentCount: documents.length,
        documents: Object.freeze(documents),
        bodySha256: digest(body),
    });
}
/** Run the whole classification over a snapshot's records. */
function runDryRun(input) {
    const families = classifyFixtureFamilies(input.records, input.families ?? exports.FIXTURE_FAMILIES);
    const excludedById = new Map();
    for (const family of families) {
        if (!family.excluded)
            continue;
        for (const id of family.memberIds)
            excludedById.set(id, family);
    }
    // Owner rulings apply ONLY to the snapshot they were made about.
    const ownerExclusions = ownerExclusionsForSnapshot(input.snapshot.bodySha256);
    const records = input.records.map((record) => {
        const family = excludedById.get(record.id);
        if (family) {
            return classifyRecord(record, family.recordClass, `${family.key} -- ${family.reason} (authored by ${family.authoredBy})`, input.evidence);
        }
        const ruled = ownerExclusions.get(record.id);
        if (ruled) {
            return classifyRecord(record, ruled.recordClass, `${ruled.familyId} -- ${ruled.reason} [ruled ${ruled.ruledOn}; evidence: ${ruled.measuredEvidence.join("; ")}]`, input.evidence);
        }
        return classifyRecord(record, "BUSINESS", null, input.evidence);
    });
    const blockersByKind = Object.fromEntries(exports.BLOCKER_KINDS.map((k) => [k, 0]));
    const combos = new Map();
    for (const record of records) {
        const kinds = [...new Set(record.blockers.map((b) => b.kind))].sort();
        for (const kind of kinds)
            blockersByKind[kind] += 1;
        if (kinds.length > 0)
            combos.set(kinds.join(" + "), (combos.get(kinds.join(" + ")) ?? 0) + 1);
    }
    const summary = Object.freeze({
        sourceTotal: input.records.length,
        provenBusiness: records.filter((r) => r.recordClass === "BUSINESS").length,
        provenFixtureOrNonbusiness: records.filter((r) => r.recordClass !== "BUSINESS").length,
        copyable: records.filter((r) => r.result === "COPYABLE").length,
        excluded: records.filter((r) => r.result === "EXCLUDED_WITH_EVIDENCE").length,
        blocked: records.filter((r) => r.result === "BLOCKED").length,
        blockersByKind: Object.freeze(blockersByKind),
        blockedRecordCount: records.filter((r) => r.blockers.length > 0).length,
        blockerIntersections: Object.freeze([...combos]
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
            .map(([key, count]) => Object.freeze({
            kinds: Object.freeze(key.split(" + ")), records: count,
        }))),
    });
    return Object.freeze({
        snapshot: input.snapshot,
        families,
        records: Object.freeze(records),
        summary,
        targetCollisionStatusKnown: input.evidence.targetWorkOrderIds !== null
            && input.evidence.targetWorkOrderIds !== undefined,
    });
}
// ════════════════════ THE OWNER RESOLUTION MANIFEST ════════════════════
//
// THE TOOL MAY CONSUME A DECISION. THE TOOL MAY NEVER AUTHOR ONE.
//
// Every refusal below exists because the opposite behaviour would let a decision arrive without anybody
// making it:
//
//   checksum      a manifest written against a different source snapshot is a decision about DIFFERENT
//                 records. Statuses move, assignments change; "wo-123 -> taylor" decided last week may be
//                 about a Work Order that has since been cancelled and reassigned.
//   population    naming a record that is not in the business population resolves nothing and hides a
//                 typo as a no-op.
//   fixture       naming a synthetic record means the author misread the census; silently ignoring it
//                 would leave them believing they had decided something.
//   duplicate     two entries for one Work Order is an unresolved disagreement, not a last-writer-wins.
//   company       validated through the governed authority -- not a string. UNKNOWN and INACTIVE are
//                 kept apart because they are different mistakes.
//   unknown field this is what forbids a future `defaultOperatingCompany: "taylor"` from being honoured
//                 by a tool that simply ignores what it does not recognise. A key nobody implemented is
//                 a decision nobody applied.
//
// A BULK DECISION IS STILL EXPLICIT. "All 14 of these go to taylor" is supported by LISTING the fourteen
// ids against this snapshot. There is no default, no wildcard and no rule -- which keeps it a migration
// fact about one population rather than an inference that outlives it.
// Aliased: this module already exports a resolveOperatingCompany for the WORK ORDER question ("which
// company does this record belong to"). The imported one answers a different question ("is this id a
// governed company"), and letting the two share a name is how a validity check gets mistaken for a
// resolution.
const operatingCompanyAuthority_js_1 = require("../../ownership/operatingCompanyAuthority.js");
const MANIFEST_KEYS = Object.freeze(["snapshotBodySha256", "decisionId", "decidedAt", "records"]);
const RECORD_KEYS = Object.freeze(["workOrderId", "operatingCompanyId", "assignmentEmployeeId", "decisionReason"]);
class ManifestRefusedError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ManifestRefusedError";
    }
}
exports.ManifestRefusedError = ManifestRefusedError;
const refuseManifest = (code, message) => { throw new ManifestRefusedError(code, message); };
/**
 * Validate a manifest against THIS snapshot and THIS classified population.
 *
 * `businessIds` and `fixtureIds` come from a DRY RUN that already ran without a manifest, so the manifest
 * is always checked against a population someone could read first.
 */
function validateResolutionManifest(manifest, context) {
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
        refuseManifest("MANIFEST_MALFORMED", "the manifest must be an object");
    }
    const m = manifest;
    const extra = Object.keys(m).filter((k) => !MANIFEST_KEYS.includes(k));
    if (extra.length > 0) {
        refuseManifest("MANIFEST_UNKNOWN_FIELD", `the manifest carries field(s) this tool does not implement: ${extra.sort().join(", ")}. A key nobody `
            + "implemented is a decision nobody applied -- including any form of implicit default.");
    }
    for (const key of ["snapshotBodySha256", "decisionId", "decidedAt"]) {
        if (typeof m[key] !== "string" || m[key].trim() === "") {
            refuseManifest("MANIFEST_MALFORMED", `${key} is required`);
        }
    }
    if (m.snapshotBodySha256 !== context.snapshotBodySha256) {
        refuseManifest("MANIFEST_SNAPSHOT_MISMATCH", "this manifest was written against a different source snapshot. Its decisions are about records as "
            + "they were then, which may no longer be these records.");
    }
    if (!Array.isArray(m.records))
        refuseManifest("MANIFEST_MALFORMED", "records must be a list");
    const byWorkOrderId = new Map();
    m.records.forEach((raw, i) => {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
            refuseManifest("MANIFEST_MALFORMED", `records[${i}] must be an object`);
        }
        const r = raw;
        const unknown = Object.keys(r).filter((k) => !RECORD_KEYS.includes(k));
        if (unknown.length > 0) {
            refuseManifest("MANIFEST_UNKNOWN_FIELD", `records[${i}] carries unknown field(s): ${unknown.sort().join(", ")}`);
        }
        const workOrderId = text(r.workOrderId);
        if (!workOrderId)
            refuseManifest("MANIFEST_MALFORMED", `records[${i}].workOrderId is required`);
        if (byWorkOrderId.has(workOrderId)) {
            refuseManifest("MANIFEST_DUPLICATE_RECORD", `${workOrderId} is resolved twice. Two entries for one Work Order is an unresolved disagreement, `
                + "not a last-one-wins.");
        }
        if (context.fixtureIds.has(workOrderId)) {
            refuseManifest("MANIFEST_FIXTURE_NAMED", `${workOrderId} is a proven nonbusiness fixture and needs no target row. Naming it means the census `
                + "was misread, and ignoring the entry would leave that belief in place.");
        }
        if (!context.businessIds.has(workOrderId)) {
            refuseManifest("MANIFEST_RECORD_NOT_IN_POPULATION", `${workOrderId} is not in the business population of this snapshot`);
        }
        const company = (0, operatingCompanyAuthority_js_1.resolveOperatingCompany)(r.operatingCompanyId);
        if (company.state === "INVALID") {
            refuseManifest("MANIFEST_COMPANY_INVALID", `records[${i}].operatingCompanyId is not a governed company id`);
        }
        if (company.state === "UNKNOWN") {
            refuseManifest("MANIFEST_COMPANY_UNKNOWN", `'${String(r.operatingCompanyId)}' is not a known operating company. A company id is validated `
                + "through the governed authority, never accepted as a string.");
        }
        if (company.state === "INACTIVE") {
            refuseManifest("MANIFEST_COMPANY_INACTIVE", `'${String(r.operatingCompanyId)}' names an INACTIVE operating company`);
        }
        if (!text(r.decisionReason)) {
            refuseManifest("MANIFEST_MALFORMED", `records[${i}].decisionReason is required -- a decision states why`);
        }
        const employeeId = r.assignmentEmployeeId === undefined ? undefined : (text(r.assignmentEmployeeId) ?? undefined);
        if (r.assignmentEmployeeId !== undefined) {
            if (!employeeId)
                refuseManifest("MANIFEST_MALFORMED", `records[${i}].assignmentEmployeeId must be a stated id`);
            // A Firebase uid is NOT an Employee identity, and the shapes are distinguishable: governed Employee
            // ids are not 28-character Firebase auth uids.
            if (/^[A-Za-z0-9]{28}$/.test(employeeId)) {
                refuseManifest("MANIFEST_EMPLOYEE_IS_UID", `records[${i}].assignmentEmployeeId looks like a Firebase uid. A uid is how a person logs in, `
                    + "not who they are as an Employee.");
            }
            if (context.employeeIds && !context.employeeIds.has(employeeId)) {
                refuseManifest("MANIFEST_EMPLOYEE_NOT_FOUND", `records[${i}].assignmentEmployeeId '${employeeId}' resolves to no governed Employee`);
            }
        }
        byWorkOrderId.set(workOrderId, Object.freeze({
            workOrderId: workOrderId,
            operatingCompanyId: r.operatingCompanyId,
            ...(employeeId === undefined ? {} : { assignmentEmployeeId: employeeId }),
            decisionReason: r.decisionReason,
        }));
    });
    return Object.freeze({
        decisionId: m.decisionId,
        decidedAt: m.decidedAt,
        byWorkOrderId,
    });
}
/**
 * The 14-row worksheet, sorted by woNumber.
 *
 * THE COMPANY COLUMN IS BLANK AND STAYS BLANK. The contextual columns are here to let a person recognise
 * the Work Order -- which customer, which site, which job -- and NOT so the tool can hint. Printing a
 * "likely" company beside them would be the inference the ruling forbids, wearing a suggestion's clothes:
 * a reviewer confirming a pre-filled column is not deciding, they are agreeing.
 */
function buildOwnerWorksheet(report, records) {
    const byId = new Map(records.map((r) => [r.id, r]));
    return Object.freeze(report.records
        .filter((r) => r.recordClass === "BUSINESS")
        .map((r) => {
        const data = byId.get(r.workOrderId)?.data ?? {};
        const ref = (field) => r.assignment.references.find((x) => x.field === field)?.resolution ?? "NOT_ASSIGNED";
        return Object.freeze({
            workOrderId: r.workOrderId,
            woNumber: text(data.woNumber),
            status: text(data.status),
            sourceType: r.type.sourceValue,
            targetType: r.type.targetValue,
            typeResolution: r.type.resolution,
            customerId: text(data.customerId),
            locationId: text(data.locationId),
            equipmentId: text(data.equipmentId),
            salesOrderId: text(data.salesOrderId),
            assignedTechIdResolution: ref("assignedTechId"),
            scheduledTechIdResolution: ref("scheduledTechId"),
            operatingCompanyDecision: "",
        });
    })
        .sort((a, b) => String(a.woNumber).localeCompare(String(b.woNumber))));
}
/** Only the business Work Orders whose ACTIVE assignment must be resolved before they can copy. */
function buildAssignmentWorksheet(report, records) {
    const byId = new Map(records.map((r) => [r.id, r]));
    return Object.freeze(report.records
        .filter((r) => r.recordClass === "BUSINESS" && r.assignment.outcome === "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION")
        .map((r) => {
        const data = byId.get(r.workOrderId)?.data ?? {};
        const ref = (field) => r.assignment.references.find((x) => x.field === field);
        return Object.freeze({
            workOrderId: r.workOrderId,
            woNumber: text(data.woNumber),
            status: text(data.status),
            legacyAssignedTechId: ref("assignedTechId")?.technicianId ?? null,
            legacyScheduledTechId: ref("scheduledTechId")?.technicianId ?? null,
            exactResolutionResult: r.assignment.references
                .filter((x) => x.technicianId !== null)
                .map((x) => `${x.field}=${x.resolution}`).join(", "),
            assignmentEmployeeDecision: "",
        });
    })
        .sort((a, b) => String(a.woNumber).localeCompare(String(b.woNumber))));
}
/**
 * Emit a BLANK manifest for the final genuine business population.
 *
 * EVERY DECISION FIELD IS NULL, and the scaffold is therefore NOT a valid manifest: handed back
 * unfilled it is refused, because `operatingCompanyId: null` is not a governed company id. That is the
 * intended behaviour and it is tested. A scaffold that validated while empty would be a template with a
 * default hiding in it.
 *
 * The company field is null for every record and there is no bulk shortcut in this shape -- a bulk
 * decision is expressed by filling all of the rows, which keeps it a list rather than a rule.
 */
function buildManifestScaffold(report, records) {
    const byId = new Map(records.map((r) => [r.id, r]));
    const rows = report.records
        .filter((r) => r.recordClass === "BUSINESS")
        .map((r) => {
        const needsAssignment = r.assignment.outcome === "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION";
        return Object.freeze({
            workOrderId: r.workOrderId,
            woNumber: text(byId.get(r.workOrderId)?.data.woNumber),
            operatingCompanyId: null,
            decisionReason: null,
            ...(needsAssignment ? { assignmentEmployeeId: null } : {}),
        });
    })
        .sort((a, b) => String(a.woNumber).localeCompare(String(b.woNumber)));
    return Object.freeze({
        snapshotBodySha256: report.snapshot.bodySha256,
        decisionId: null,
        decidedAt: null,
        records: Object.freeze(rows),
    });
}
exports.OWNER_CLASSIFIED_EXCLUSIONS = Object.freeze([
    Object.freeze({
        familyId: "OWNER_CLASSIFIED_PROBE_RESIDUE_2026_09_22",
        workOrderId: "p8nHWH7HywDUMiaS21YA",
        snapshotBodySha256: "3800975c2838f6c1610790c2eea153e7719b6d390c61b2f74319093650531b59",
        ruledOn: "2026-09-22",
        recordClass: "OTHER_NONBUSINESS_EVIDENCE",
        measuredEvidence: Object.freeze([
            "woNumber WO-2026-000034, status DISPATCHED, type SERVICE_CALL",
            "customerId 'probe-c' resolves to no account (105 accounts read)",
            "locationId 'probe-l' resolves to no location (185 locations read)",
            "assignedTechId and scheduledTechId both 'probe-t-mtbxlplt', resolving to no technician (13 read)",
            "the referenced records were never created, not deleted: no probe-* document exists in any collection",
            "id suffix decodes as Date.now().toString(36) = 2026-08-27T19:44:26.081Z, 1.377s BEFORE the Work Order's createdAt",
            "created 19:44:27.458 and DISPATCHED 19:44:28.418 -- 960ms apart, a machine cadence",
            "the only probe-referencing document among 30 work orders, 105 accounts, 185 locations, 13 technicians, 290 equipment, 45 jobs, 26 sales orders",
            "MEASUREMENT CORRECTION: the record carries NO salesOrderId field at all. An earlier report, and the "
                + "ruling text, describe a dangling Sales Order; the unresolved references are customerId and locationId only.",
            "NO repository code authors these ids: `git log --all -S` finds zero commits for 'probe-t-', \"'probe-c'\" or \"'probe-l'\"",
        ]),
        reason: "OWNER RULING 2026-09-22: nonbusiness probe residue, excluded from the migration population. The "
            + "forensic pass classified it BUSINESS_UNRESOLVED because no repository-authored tool could be tied "
            + "to it -- the affirmative standard was not met. The Owner, who knows what was run by hand, ruled it "
            + "residue. The source record is RETAINED in Firestore until legacy retirement; exclusion means no "
            + "target row, not deletion.",
    }),
]);
/** Owner exclusions that apply to THIS snapshot. A ruling about another population does not carry over. */
function ownerExclusionsForSnapshot(snapshotBodySha256, exclusions = exports.OWNER_CLASSIFIED_EXCLUSIONS) {
    return new Map(exclusions
        .filter((x) => x.snapshotBodySha256 === snapshotBodySha256)
        .map((x) => [x.workOrderId, x]));
}
//# sourceMappingURL=workOrderMigrationDryRun.js.map