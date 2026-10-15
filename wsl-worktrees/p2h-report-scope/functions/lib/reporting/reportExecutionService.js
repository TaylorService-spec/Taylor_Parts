"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SCAN_DOCS = exports.MAX_GROUP_CARDINALITY = exports.MAX_RESULT_ROWS = exports.IncompleteAggregateScanError = exports.UnknownReportObjectError = exports.InvalidReportDefinitionError = void 0;
exports.judgeScanCompleteness = judgeScanCompleteness;
exports.runReportDefinition = runReportDefinition;
// Issue #325 / ADR-007 D-FN -- the trusted, field-projecting report
// execution service (ADR-007 sec2.1/sec2.3/sec2.4/sec2.5, Specification
// sec6/sec7/sec10). Server-side ONLY, reads governed collections with
// Admin SDK privilege and returns only the fields/rows the RUNNER is
// authorized to see -- there is no client-direct report read path
// (ADR-007 sec2.1). PURE-ish core: every side effect (Firestore reads,
// the Audit Event write) is confined to `runReportDefinition()`; every
// authorization/projection/limit DECISION is made by small, independently
// testable pure helper functions below it, none of which touch Firestore.
//
// Reuses reportQueryValidation.ts (the SAME F2 validator port
// reportCatalogParity.test.mjs proves matches Customer's client-side
// validator byte-for-semantics) to decide "is this definition
// structurally valid and in-catalog" BEFORE any Firestore read --
// exactly ADR-007 sec2.3's "client and server agree" requirement.
//
// Authorization is D-226: every object/field/relationship-traversal
// gate below is a resolveEffectivePermission() call against the
// runner's REAL RoleAssignments (Admin SDK read of roleAssignments +
// users/{uid}.accessVersion, same pattern as access/
// trustedWriterCommands.ts's resolvePrincipalPermission()) -- never a
// raw role-string check, never a client-supplied claim of access. Since
// this task adds NO Role grant for any report.* capability (see
// permissionCatalog.ts/compatibilityRoles.ts/governedBusinessRoles.ts,
// untouched by this PR), every real call today resolves every
// report.* capability to DENY -- this service is "unavailable-not-
// unsafe" by construction of the access layer it depends on, not
// because of any special-cased "not yet activated" flag in this file.
//
// Auditing is D-AUDIT: exactly one Audit Event per run
// (auditEventWriter.ts's "runReportDefinition" action), recording
// actor/objectId/Scope/accessVersion/rowCount/dropped-field+predicate/
// truncation facts -- NEVER row data. The summary string is a fixed,
// templated, row-data-free sentence (never interpolates a filter value,
// a field's actual content, or anything read from a document).
//
// No caching, anywhere, of any kind, across calls: every value this
// module holds in memory is a local variable or parameter scoped to a
// single `runReportDefinition()` invocation, freed when that call
// returns. There is no module-level `let`/mutable Map/Set/cache of any
// kind (grep this file: every top-level binding is `const` bound to a
// pure function or frozen constant). This is the simplest possible way
// to satisfy ADR-007 sec2.4's "no cross-principal result caching" --
// there is no cache to leak across principals because there is no
// cache, full stop. functions/test/reportExecutionService.test.mjs
// proves this structurally (source-text assertion) in addition to
// proving two different runners never observe each other's data.
const firestore_1 = require("firebase-admin/firestore");
const compatibilityRoles_1 = require("../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../access/governedBusinessRoles");
const resolveEffectivePermission_1 = require("../access/resolveEffectivePermission");
const environmentCapabilityOverrides_1 = require("../access/environmentCapabilityOverrides");
const compactClaims_1 = require("../access/compactClaims");
const auditEventWriter_1 = require("../access/auditEventWriter");
const reportCatalog_1 = require("./reportCatalog");
const reportQueryValidation_1 = require("./reportQueryValidation");
const reportQueryModel_1 = require("./reportQueryModel");
const reportRowScope_1 = require("./reportRowScope");
// ---------------------------------------------------------------------
// Error taxonomy -- mirrors access/trustedWriterCommands.ts's own
// per-reason class-per-error convention, so a caller (and a test) can
// assert on the SPECIFIC failure.
// ---------------------------------------------------------------------
class InvalidReportDefinitionError extends Error {
    errors;
    constructor(errors) {
        super(`Invalid report definition: ${errors.join("; ")}`);
        this.errors = errors;
    }
}
exports.InvalidReportDefinitionError = InvalidReportDefinitionError;
class UnknownReportObjectError extends Error {
}
exports.UnknownReportObjectError = UnknownReportObjectError;
// Truncation honesty (docs/assessments/eos-dashboard-reporting-authority-
// census.md X-9, a BINDING rule, and the FIN-004 precedent it cites):
//
//   "A bounded read may return a page and say so; a TOTAL may not --
//    bounding an aggregate produces a number smaller than the truth
//    while still labelled 'Total', which is worse than the slow
//    unbounded read it replaced."
//
// This service fetches at most `maxScanDocs` raw documents and then
// filters/groups/aggregates them IN MEMORY. That is a defensible way to
// page a LIST. It is not a defensible way to produce a SUM/AVG/MIN/MAX/
// COUNT: once the raw scan was cut, every aggregate computed from it is
// an arbitrary partial figure, and before this error existed it was
// returned as the aggregate's value with only a `truncated: true`
// boolean beside it. `kind` did not even reliably say so -- an
// aggregate run whose truncated slice matched no rows resolved to
// `"empty"`, and one with a dropped column to `"partially-authorized"`,
// both of which outrank `"truncated-widened"` in the kind ladder below.
// So the wrong number could arrive labelled "no results" or "partially
// authorized", never "this total is incomplete".
//
// The governed answer is FIN-004's: refuse. "A page that would truncate
// renders 'unavailable', never a partial 'ready'."
class IncompleteAggregateScanError extends Error {
}
exports.IncompleteAggregateScanError = IncompleteAggregateScanError;
// PURE. The whole X-9 judgement, isolated so it is testable without
// Firestore (this file's stated design: every limit DECISION is a small
// pure helper).
//
// Only SCAN truncation can corrupt an aggregate's value, and this is
// why the other two caps are deliberately NOT refusals:
//
//   * rowCapTruncated -- caps the RETURNED rows. On an ungrouped run it
//     pages a list. On a grouped run it caps how many GROUP rows come
//     back; each returned group's total was still computed over that
//     group's complete matched row set (groupDocuments() runs over all
//     filtered docs, and only the resulting entry list is sliced).
//   * groupCardinalityTruncated -- same shape: whole groups are
//     omitted, but no returned total is understated.
//
// In both cases every number that IS returned is true, and `truncated`
// honestly reports that the SET is a page. Under scan truncation
// nothing of the sort holds: the population itself was cut before a
// single filter ran.
function judgeScanCompleteness(input) {
    if (!input.scanTruncated)
        return "complete";
    return input.hasAggregates ? "refuse-incomplete-total" : "bounded-page";
}
// Spec sec10's proposed conservative starting bounds (ADR-007 sec4 open
// decision 3 -- the EXACT values remain an open Owner decision; these
// are enforced as a maximum regardless, since a stricter cap can only
// under-serve, never leak -- tightening later is always safe).
exports.MAX_RESULT_ROWS = 10_000;
exports.MAX_GROUP_CARDINALITY = 1_000;
// Defense-in-depth beyond Spec sec10's stated row cap: a hard ceiling on
// how many raw documents this service will ever fetch from a single
// collection in one run, independent of the (lower) returned-row cap.
// Filters are applied IN-MEMORY (see the module header's index-free
// design note below) rather than pushed to Firestore, specifically so
// this PR introduces NO new composite index (a hard stop of this task)
// -- this fetch cap bounds the cost of that trade-off. Generous
// headroom (2x the result cap) so an ordinary filtered query is never
// starved before it can find its authorized/matching rows.
exports.MAX_SCAN_DOCS = exports.MAX_RESULT_ROWS * 2;
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
// The merged Role catalog D-FN authorizes against -- report.* capabilities
// are eligible to be granted to EITHER a compatibility Role or a governed
// business Role (unlike access/trustedWriterCommands.ts, which only ever
// checks COMPATIBILITY_ROLES because ITS actions are compatibility-only
// by the Enterprise Access Specification's own design). No id collision
// exists between the two maps (proved by functions/test/
// resolveEffectivePermission.test.mjs's own "share no id" check), so a
// plain spread-merge is safe and complete.
function allRoles() {
    return { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
}
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
function readAuthoritativeAccessVersion(data) {
    if (!data)
        return 0;
    if (data.accessVersion === undefined || data.accessVersion === null)
        return 0;
    if (!(0, compactClaims_1.isValidAccessVersionValue)(data.accessVersion))
        return 0; // fail closed: treat as unversioned, never trust a malformed value upward
    return data.accessVersion;
}
// Resolves the runner's REAL access state ONCE per run (not once per
// capability) -- both Firestore reads happen exactly once, and the
// resulting {assignments, accessVersion} pair is reused (as ordinary
// function parameters, never module-level state) for every subsequent
// resolveEffectivePermission() call this run makes.
async function loadRunnerAccessState(db, runnerUid) {
    const [userSnap, assignmentsSnap] = await Promise.all([
        db.collection(USERS_COLLECTION).doc(runnerUid).get(),
        db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", runnerUid).where("status", "==", "active").get(),
    ]);
    const accessVersion = readAuthoritativeAccessVersion(userSnap.data());
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { accessVersion, assignments };
}
function isAllowed(permissionId, runner, target, roles) {
    return ((0, resolveEffectivePermission_1.resolveEffectivePermission)({
        permissionId,
        assignments: runner.assignments,
        roles,
        currentAccessVersion: runner.accessVersion,
        target,
        // 2C.6C (DECISIONS #167): the report.* family is ENVIRONMENT-ACTIVATED. Without the runtime
        // activation set this service would deny every report capability in EVERY environment --
        // including the sandbox where Reporting is live -- because the catalog now registers them
        // active:false. Resolved from the runtime's own trusted project identity, exactly as
        // effectiveAccessFeed.ts does. Production carries no overrides, so Reporting stays
        // fail-closed there until a separate activation ruling.
        activationOverrides: (0, environmentCapabilityOverrides_1.resolveRuntimeCapabilityOverrides)(),
    }).decision === "ALLOW");
}
// Every field id (and, when the field is reached via a relationship, its
// traversal capability too) referenced ANYWHERE in the definition --
// fields/filters/groupBy/sort/aggregates -- resolved ONCE each (memoized
// by capability id WITHIN this single call via a local Map, never a
// module-level one) and classified authorized/denied. Returns the
// authorized-field-id set and the denied-field-id set (with labels) so
// every later step (projection, predicate application, grouping) can
// answer "is this field id usable in this run" with a plain Set lookup.
//
// P2-H: this takes a CHECKER rather than a (runner, target, roles) triple. The
// triple forced one fixed target, which is what made the old hardcoded global
// scope reach every field gate in the run. The checker the caller supplies is
// reach-aware -- it requires a capability to hold at EVERY operating company the
// run is bound to -- so there is no longer a single target for a future edit to
// pin back to global here.
function resolveFieldAuthorization(baseObjectId, referencedFieldIds, allowedEverywhereInReach) {
    const authorized = new Set();
    const deniedLabels = new Map(); // fieldId -> label, for audit-safe UI copy
    const capabilityCache = new Map(); // capabilityId -> allowed, scoped to THIS call only
    const checkCapability = (capabilityId) => {
        if (!capabilityCache.has(capabilityId)) {
            capabilityCache.set(capabilityId, allowedEverywhereInReach(capabilityId));
        }
        return capabilityCache.get(capabilityId);
    };
    for (const fieldId of new Set(referencedFieldIds)) {
        const resolved = (0, reportQueryValidation_1.resolveDefinitionField)(baseObjectId, fieldId);
        if (!resolved)
            continue; // already refused by the validator; nothing to authorize
        const fieldAllowed = checkCapability(resolved.field.readCapability);
        const traversalAllowed = resolved.relationship
            ? checkCapability(resolved.relationship.traversalCapability ?? "")
            : true;
        if (fieldAllowed && traversalAllowed) {
            authorized.add(fieldId);
        }
        else {
            deniedLabels.set(fieldId, resolved.field.label);
        }
    }
    return { authorized, deniedLabels };
}
// Every field id referenced anywhere in a (already structurally valid)
// definition -- the exhaustive set resolveFieldAuthorization() must
// check. Order doesn't matter (the caller de-duplicates via Set).
function collectReferencedFieldIds(def) {
    const ids = [];
    if (Array.isArray(def.fields))
        ids.push(...def.fields);
    if (Array.isArray(def.filters)) {
        for (const flt of def.filters) {
            if (typeof flt?.fieldId === "string")
                ids.push(flt.fieldId);
        }
    }
    if (Array.isArray(def.groupBy))
        ids.push(...def.groupBy);
    if (Array.isArray(def.sort)) {
        for (const s of def.sort) {
            if (typeof s?.fieldId === "string")
                ids.push(s.fieldId);
        }
    }
    if (Array.isArray(def.aggregates)) {
        for (const a of def.aggregates) {
            if (typeof a?.fieldId === "string")
                ids.push(a.fieldId);
        }
    }
    return ids;
}
// Raw Firestore field path for a fieldId on ITS OWN object (never
// cross-object -- a related-object field is read from the RELATED
// document, whose own raw path is computed the same way against ITS
// object id). fieldId is always `${objectId}.${rawPath}` by catalog
// construction (reportCatalog.ts), so this is a plain prefix strip, not
// a lookup table that could drift from the catalog.
function rawFieldPath(field) {
    return field.fieldId.slice(field.objectId.length + 1);
}
function getAtPath(doc, path) {
    return path.split(".").reduce((acc, key) => {
        if (acc && typeof acc === "object" && !Array.isArray(acc)) {
            return acc[key];
        }
        return undefined;
    }, doc);
}
// Independent-review finding (round 1): the original design read a
// related-object field's value ONLY in projectDoc() (final projection),
// but matchesFilter()/groupDocuments()/computeAggregate() ran BEFORE the
// relationship join and read only the base document -- so a filter/
// group/aggregate on an AUTHORIZED related-object field (e.g.
// `location.name` from an `equipment` report) silently produced wrong
// results (an `eq` filter dropped every row; grouping bucketed
// everything together) instead of actually applying against the joined
// value. Fixed by: (a) joining EVERY referenced related field -- not
// just ones in `fields[]` -- BEFORE filtering/grouping/aggregation/sort
// run (see the reordered pipeline in runReportDefinition below), and
// (b) this single shared getFieldValue() used by every execution-time
// consumer (filter/group/aggregate/sort/project), so there is exactly
// ONE place that knows how to resolve a field id (own or joined) to a
// value, never two independently-written copies that can drift.
function getFieldValue(doc, baseObjectId, field) {
    if (field.objectId === baseObjectId)
        return getAtPath(doc, rawFieldPath(field));
    const related = doc[`__related__${field.objectId}`];
    return related ? getAtPath(related, rawFieldPath(field)) : undefined;
}
// ---------------------------------------------------------------------
// The public entry point.
// ---------------------------------------------------------------------
async function runReportDefinition(params, options = {}) {
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    const maxResultRows = options.maxResultRows ?? exports.MAX_RESULT_ROWS;
    const maxGroupCardinality = options.maxGroupCardinality ?? exports.MAX_GROUP_CARDINALITY;
    const maxScanDocs = options.maxScanDocs ?? exports.MAX_SCAN_DOCS;
    const definitionId = params.definitionId ?? `adhoc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Structural validation FIRST (Spec sec6/sec7): a structurally invalid
    // definition is refused outright, before any Firestore read and
    // before any Audit Event -- this is "never valid," not "no longer
    // fully authorized" (F2's own documented distinction).
    const validationErrors = (0, reportQueryValidation_1.validateReportDefinition)(params.definition);
    if (validationErrors.length > 0) {
        throw new InvalidReportDefinitionError(validationErrors);
    }
    const def = params.definition;
    const objectId = def.objectId;
    const object = (0, reportCatalog_1.getReportObject)(objectId); // non-null: validator already proved it exists and is activated
    if (!object.collection) {
        // serviceHistory-shaped derived objects have no backing collection
        // yet (Spec sec4) -- not reachable today since no derived object is
        // wave-1/fieldsPopulated, but fails closed rather than crashing on
        // a null collection() call if that ever changes.
        throw new UnknownReportObjectError(`objectId "${objectId}" has no backing collection`);
    }
    const runner = await loadRunnerAccessState(db, params.runnerUid);
    // --- P2-H: the row bound, decided BEFORE any capability gate and BEFORE any
    // document is read ---
    //
    // The scope is DERIVED from the runner's own access state; it is not a
    // constant. What used to stand here was:
    //
    //     const target: TargetContext = { scope: { type: "global" }, condition: {} };
    //
    // -- a hardcoded global target that made the Scope axis contribute nothing to
    // any object/field/traversal decision in the run, paired with a fetch that
    // carried no `where()` at all. Together they meant the report creator had no
    // operating-company axis and no row-level bound: an authorized run returned
    // the whole collection, every company's rows included. That was survivable
    // only because `report.*` is `active: false` outside the sandbox override
    // set, which makes it a PRE-ACTIVATION defect -- the first activation is what
    // would have granted the access, not some later regression.
    //
    // Reach is resolved the way finance/financeReadCallables.ts:119-123 already
    // resolves it: enumerate the governed company ids and ask the CANONICAL
    // resolver, once per candidate, with a value-matched
    // `{ type: "operatingCompany", value }` target. Consequences worth stating
    // plainly, because both are deliberate:
    //
    //   * a GLOBAL assignment still matches every company target
    //     (resolveEffectivePermission's scopeMatches: `case "global": return
    //     true`), so an admin's reach is both companies and nothing regresses for
    //     them;
    //   * an operatingCompany-scoped assignment can now match, where against the
    //     old hardcoded global target it could never match anything. That is the
    //     scope type doing its declared job, and it is strictly NARROWER than the
    //     global grant it replaces the need for.
    //
    // The company is never inferred from an employee profile, a warehouse, a job
    // title or a display name (types/access.ts:26-33; employeePrincipalLink.ts
    // :202-207 refuses exactly that), and this file adds no uid->company lookup
    // to be misused later. Authority, not demographics, decides reach.
    const companyReach = (0, reportRowScope_1.resolveCompanyReach)((scope) => isAllowed(object.objectReadCapability, runner, { scope, condition: {} }, roles));
    const rowScope = (0, reportRowScope_1.reportRowScopeForCollection)(object.collection);
    // Fail closed, in this order, and NEVER by widening to global.
    //
    // Reach first: an empty reach is not "no opinion", it is "this runner is
    // bound to no operating company for this object", and the only honest answer
    // to a report request from such a runner is nothing, plus the reason.
    const scopeRefusal = companyReach.length === 0
        ? `No operating company is in reach for "${object.objectReadCapability}". A report run must be bound to at least ` +
            "one governed operating company; a capability held at no company confers no reach, and the run is not widened " +
            "to every company to compensate."
        : rowScope.kind === "unsupported"
            ? `Object "${objectId}" cannot be row-bounded: ${rowScope.why}. The run is refused rather than executed unbounded.`
            : null;
    if (scopeRefusal !== null) {
        await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
            actorUid: params.runnerUid,
            action: "runReportDefinition",
            targetType: "reportDefinition",
            targetId: definitionId,
            outcome: "denied",
            summary: `Report run refused: no enforceable operating-company row bound for "${objectId}".`,
            objectId,
            accessVersionAfter: runner.accessVersion,
        }, db);
        return {
            kind: "scope-unresolved",
            objectId,
            rows: null,
            aggregates: null,
            rowCount: 0,
            rowCap: maxResultRows,
            truncated: false,
            widened: false,
            droppedColumnLabels: [],
            droppedFieldIds: [],
            droppedPredicateFieldIds: [],
            droppedPredicateCount: 0,
            operatingCompanyReach: [...companyReach],
            reason: scopeRefusal,
        };
    }
    // Every capability gate below now evaluates at the runner's REAL company
    // scope, not at global. Where the reach spans more than one company (today
    // only a global grant does that), a capability must be allowed at EVERY
    // company in reach to count as held: the result set may contain rows from
    // any of them, so a field readable for only one of them must not be
    // projected across all of them. With a single-company reach this collapses
    // to one ordinary check.
    const targets = companyReach.map((companyId) => ({
        scope: (0, reportRowScope_1.operatingCompanyScope)(companyId),
        condition: {},
    }));
    const target = targets[0];
    const allowedEverywhereInReach = (capabilityId) => targets.every((t) => isAllowed(capabilityId, runner, t, roles));
    // --- Object gate (Spec sec6: "a run requires the object's
    // objectReadCapability; without it, nothing is read") ---
    const objectAllowed = allowedEverywhereInReach(object.objectReadCapability);
    if (!objectAllowed) {
        await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
            actorUid: params.runnerUid,
            action: "runReportDefinition",
            targetType: "reportDefinition",
            targetId: definitionId,
            outcome: "denied",
            summary: `Report run denied: object-level read capability not held for "${objectId}".`,
            objectId,
            accessVersionAfter: runner.accessVersion,
        });
        return {
            kind: "permission-denied",
            objectId,
            rows: null,
            aggregates: null,
            rowCount: 0,
            rowCap: maxResultRows,
            truncated: false,
            widened: false,
            droppedColumnLabels: [],
            droppedFieldIds: [],
            droppedPredicateFieldIds: [],
            droppedPredicateCount: 0,
            operatingCompanyReach: [...companyReach],
        };
    }
    // --- Field/relationship gate (Spec sec6/sec2.5) ---
    const referencedFieldIds = collectReferencedFieldIds(def);
    const { authorized: authorizedFieldIds, deniedLabels } = resolveFieldAuthorization(objectId, referencedFieldIds, allowedEverywhereInReach);
    const activeFields = (def.fields ?? []).filter((id) => authorizedFieldIds.has(id));
    const droppedFieldIds = (def.fields ?? []).filter((id) => !authorizedFieldIds.has(id));
    const droppedColumnLabels = droppedFieldIds.map((id) => deniedLabels.get(id) ?? id);
    // Predicate-drop rule (ADR-007 sec2.4): a filter/group/sort/aggregate
    // that REFERENCES a field the runner may not read is DROPPED, never
    // applied -- widens the result rather than leaking membership.
    const activeFilters = (def.filters ?? []).filter((flt) => authorizedFieldIds.has(flt.fieldId));
    const droppedFilterFieldIds = (def.filters ?? [])
        .filter((flt) => !authorizedFieldIds.has(flt.fieldId))
        .map((flt) => flt.fieldId);
    const activeGroupBy = (def.groupBy ?? []).filter((id) => authorizedFieldIds.has(id));
    const droppedGroupByFieldIds = (def.groupBy ?? []).filter((id) => !authorizedFieldIds.has(id));
    const activeSort = (def.sort ?? []).filter((s) => authorizedFieldIds.has(s.fieldId));
    const activeAggregates = (def.aggregates ?? []).filter((a) => (0, reportQueryModel_1.isFieldlessAggregate)(a.fn) || (typeof a.fieldId === "string" && authorizedFieldIds.has(a.fieldId)));
    const droppedAggregateFieldIds = (def.aggregates ?? [])
        .filter((a) => !(0, reportQueryModel_1.isFieldlessAggregate)(a.fn) && typeof a.fieldId === "string" && !authorizedFieldIds.has(a.fieldId))
        .map((a) => a.fieldId);
    const droppedPredicateFieldIds = Array.from(new Set([...droppedFilterFieldIds, ...droppedGroupByFieldIds, ...droppedAggregateFieldIds]));
    const widened = droppedPredicateFieldIds.length > 0;
    // --- Fetch ---
    //
    // P2-H: THE ROW BOUND IS APPLIED HERE, AT THE QUERY, not after the fact.
    // What stood here was:
    //
    //     db.collection(object.collection).limit(maxScanDocs + 1).get()
    //
    // -- no `where()` of any kind, i.e. every document in the collection up to
    // the scan cap, every operating company included. Filtering the company out
    // in memory afterwards would not have been equivalent: the scan cap is
    // applied by Firestore BEFORE any in-memory pass, so an out-of-reach
    // company's rows would still consume the budget and could silently push the
    // runner's own rows past the cap (and, with aggregates, into an
    // IncompleteAggregateScanError over data the runner was never entitled to
    // see). The bound has to be in the query for the cap to mean anything.
    //
    // `rowScope` is not a judgement made here -- it is read from the ownership
    // matrix (see reportRowScope.ts), which is the existing authority under Owner
    // rulings D-8..D-16 for whether a family is partitioned by operating company
    // and which field stores it. An `unsupported` verdict already refused the run
    // above, so only the two enforceable shapes reach this point.
    //
    // Still index-free in the sense the maxScanDocs comment means: a single-field
    // `in` needs only Firestore's automatic single-field index, never a declared
    // composite. All filtering/grouping/aggregation/sort remains in memory.
    const baseQuery = rowScope.kind === "company-bound"
        ? db.collection(object.collection).where(rowScope.field, "in", [...companyReach])
        : db.collection(object.collection);
    const snap = await baseQuery.limit(maxScanDocs + 1).get();
    const scanTruncated = snap.size > maxScanDocs;
    // --- Truncation honesty (census X-9) -- decided BEFORE any join read
    // and before a single aggregate is computed, so a refused run never
    // produces a partial figure that some later branch could return. See
    // judgeScanCompleteness()/IncompleteAggregateScanError above. ---
    if (judgeScanCompleteness({ scanTruncated, hasAggregates: activeAggregates.length > 0 }) === "refuse-incomplete-total") {
        // The run really happened (documents were read), so unlike a
        // structurally invalid definition this IS an auditable outcome --
        // recorded the same way the object-gate denial above is, with a
        // fixed, row-data-free summary.
        await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
            actorUid: params.runnerUid,
            action: "runReportDefinition",
            targetType: "reportDefinition",
            targetId: definitionId,
            outcome: "denied",
            summary: `Report run refused: aggregates over "${objectId}" would be computed from a truncated scan and would understate the true totals.`,
            objectId,
            truncated: true,
            accessVersionAfter: runner.accessVersion,
        }, db);
        throw new IncompleteAggregateScanError(`Aggregates for "${objectId}" cannot be computed: the scan exceeded ${maxScanDocs} documents, so any total would be lower than the truth. Narrow the report with filters, or run it without aggregates.`);
    }
    const rawDocs = snap.docs.slice(0, maxScanDocs).map((d) => ({ id: d.id, ...d.data() }));
    // --- One-hop relationship join, BEFORE filtering/grouping/aggregation/
    // sort -- for EVERY authorized field referenced ANYWHERE in the
    // definition (not only the selected `fields[]`). Independent-review
    // finding (round 1): the original code joined only `activeFields` and
    // joined AFTER filtering, so a filter/groupBy/aggregate/sort on an
    // authorized related-object field (e.g. `location.name` from an
    // `equipment` report) always read `undefined` (nothing had been
    // joined yet) and silently produced wrong results (an `eq` filter
    // dropped every row; grouping bucketed everything together) instead
    // of a real error OR a leak -- fixed by joining first, from the full
    // authorized-and-referenced field set. Spec sec2.5's own authorization
    // rule is unaffected: which related fields are ELIGIBLE to join here
    // was already decided by resolveFieldAuthorization() above (BOTH the
    // traversal capability AND the related object's own field capability
    // required) -- this only fixes WHEN the already-authorized join
    // happens, not what is authorized to join. ---
    const authorizedReferencedFields = Array.from(authorizedFieldIds)
        .map((id) => (0, reportQueryValidation_1.resolveDefinitionField)(objectId, id))
        .filter((r) => !!r);
    const relatedFieldsByBase = authorizedReferencedFields.filter((r) => !!r.relationship);
    //
    // P2-H: the join is the SECOND unbounded axis, and closing only the base
    // query would have left it open. joinRelatedDocs() fetches related documents
    // by id (`collection(c).doc(id).get()`), which cannot carry a `where`, so a
    // correctly company-bounded base row could still drag a foreign-company
    // related record into the result through its reference field. The reach is
    // therefore threaded in and each fetched related document is checked against
    // its OWN family's bound before it is attached.
    const joinedRaw = relatedFieldsByBase.length > 0
        ? await joinRelatedDocs(db, objectId, rawDocs, relatedFieldsByBase, companyReach)
        : rawDocs;
    // --- Apply active filters in-memory (now against joined docs, so a
    // related-object predicate actually has a value to compare) ---
    const filtered = joinedRaw.filter((doc) => activeFilters.every((flt) => matchesFilter(doc, objectId, flt)));
    // --- Sort (ungrouped path only -- Spec's own field-catalog `sort`
    // operator is declared per-field for RAW column sort; sorting grouped/
    // aggregated output by a group key is a distinct, un-specified
    // feature not implemented here) ---
    const sorted = sortRows(filtered, objectId, activeSort);
    // --- Grouping + aggregation ---
    let resultRows;
    let aggregateRows = null;
    let groupCardinalityTruncated = false;
    if (activeGroupBy.length > 0 || activeAggregates.length > 0) {
        const groups = groupDocuments(filtered, objectId, activeGroupBy);
        groupCardinalityTruncated = groups.size > maxGroupCardinality;
        const cappedGroupEntries = Array.from(groups.entries()).slice(0, maxGroupCardinality);
        aggregateRows = cappedGroupEntries.map(([, rows]) => {
            const row = {};
            for (const fieldId of activeGroupBy) {
                const field = (0, reportCatalog_1.getReportField)(fieldId);
                if (field)
                    row[fieldId] = getFieldValue(rows[0], objectId, field);
            }
            for (const agg of activeAggregates) {
                row[aggregateResultKey(agg)] = computeAggregate(rows, objectId, agg);
            }
            return row;
        });
        resultRows = []; // grouped/aggregated runs return aggregateRows, not raw rows
    }
    else {
        resultRows = sorted;
    }
    const rowCountBeforeCap = activeGroupBy.length > 0 || activeAggregates.length > 0
        ? aggregateRows.length
        : resultRows.length;
    const rowCapTruncated = rowCountBeforeCap > maxResultRows;
    const truncated = scanTruncated || groupCardinalityTruncated || rowCapTruncated;
    const cappedRows = resultRows.slice(0, maxResultRows);
    const cappedAggregateRows = aggregateRows ? aggregateRows.slice(0, maxResultRows) : null;
    // --- Project rows down to authorized fields only (Spec sec6: "A
    // field the runner may not read is absent from the response payload
    // -- never blanked, never returned-then-hidden") ---
    const projectedRows = (activeGroupBy.length > 0 || activeAggregates.length > 0)
        ? null
        : cappedRows.map((doc) => projectDoc(doc, objectId, activeFields));
    const rowCount = (activeGroupBy.length > 0 || activeAggregates.length > 0)
        ? cappedAggregateRows.length
        : projectedRows.length;
    const finalDroppedPredicateFieldIds = droppedPredicateFieldIds;
    const finalDroppedFieldIds = droppedFieldIds;
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid: params.runnerUid,
        action: "runReportDefinition",
        targetType: "reportDefinition",
        targetId: definitionId,
        outcome: "applied",
        summary: `Report run applied for object "${objectId}".`,
        objectId,
        rowCount,
        droppedFieldIds: finalDroppedFieldIds.length > 0 ? finalDroppedFieldIds : undefined,
        droppedPredicateFieldIds: finalDroppedPredicateFieldIds.length > 0 ? finalDroppedPredicateFieldIds : undefined,
        truncated,
        accessVersionAfter: runner.accessVersion,
    }, db);
    const kind = rowCount === 0
        ? "empty"
        : droppedColumnLabels.length > 0
            ? "partially-authorized"
            : truncated || widened
                ? "truncated-widened"
                : "results";
    return {
        kind,
        objectId,
        rows: projectedRows,
        aggregates: cappedAggregateRows,
        rowCount,
        rowCap: maxResultRows,
        truncated,
        widened,
        droppedColumnLabels,
        droppedFieldIds: finalDroppedFieldIds,
        droppedPredicateFieldIds: finalDroppedPredicateFieldIds,
        droppedPredicateCount: finalDroppedPredicateFieldIds.length,
        operatingCompanyReach: [...companyReach],
    };
}
// ---------------------------------------------------------------------
// In-memory query helpers -- pure functions over already-fetched docs.
// ---------------------------------------------------------------------
function matchesFilter(doc, objectId, flt) {
    const field = (0, reportCatalog_1.getReportField)(flt.fieldId);
    if (!field)
        return true; // unresolvable somehow; validator already guarantees this never happens for an active filter
    const raw = getFieldValue(doc, objectId, field);
    switch (flt.op) {
        case "eq":
            if (field.dataType === "date") {
                const r = toComparableDate(raw);
                const v = toComparableDate(flt.value);
                return r !== null && v !== null && r === v;
            }
            return raw === flt.value;
        case "ne":
            if (field.dataType === "date") {
                const r = toComparableDate(raw);
                const v = toComparableDate(flt.value);
                // Mirror `eq`'s complement exactly: unresolvable dates never match
                // either "equal" or "not equal" (fail closed, consistent with
                // `before`/`after`/`between` below, which also require both
                // sides to normalize before comparing).
                return r !== null && v !== null && r !== v;
            }
            return raw !== flt.value;
        case "gt": return typeof raw === "number" && typeof flt.value === "number" && raw > flt.value;
        case "gte": return typeof raw === "number" && typeof flt.value === "number" && raw >= flt.value;
        case "lt": return typeof raw === "number" && typeof flt.value === "number" && raw < flt.value;
        case "lte": return typeof raw === "number" && typeof flt.value === "number" && raw <= flt.value;
        case "contains":
            // List-typed fields (e.g. tags, relationshipTypes) store `raw` as an
            // array (reportQueryModel.ts's FILTER_COMPARATORS_BY_TYPE.list
            // legitimately allows "contains" alongside "containsAny" -- the
            // validator has always accepted this combination). Mirror the
            // sibling "containsAny" case's Array.isArray(raw) handling so a
            // list field's "contains" filter actually matches instead of
            // silently dropping every row (raw is never a string for a list
            // field, so the string branch below could never have matched it).
            if (Array.isArray(raw))
                return typeof flt.value === "string" && raw.includes(flt.value);
            return typeof raw === "string" && typeof flt.value === "string" && raw.includes(flt.value);
        case "startsWith": return typeof raw === "string" && typeof flt.value === "string" && raw.startsWith(flt.value);
        case "in": return Array.isArray(flt.value) && flt.value.includes(raw);
        case "before": return toComparableDate(raw) !== null && toComparableDate(flt.value) !== null && toComparableDate(raw) < toComparableDate(flt.value);
        case "after": return toComparableDate(raw) !== null && toComparableDate(flt.value) !== null && toComparableDate(raw) > toComparableDate(flt.value);
        case "between": {
            if (!Array.isArray(flt.value) || flt.value.length !== 2)
                return false;
            const r = toComparableDate(raw);
            const lo = toComparableDate(flt.value[0]);
            const hi = toComparableDate(flt.value[1]);
            return r !== null && lo !== null && hi !== null && r >= lo && r <= hi;
        }
        case "containsAny":
            return Array.isArray(raw) && Array.isArray(flt.value) && flt.value.some((v) => raw.includes(v));
        default:
            return false; // unknown operator -- fail closed, never match
    }
}
function toComparableDate(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    if (value && typeof value === "object" && typeof value.toMillis === "function") {
        return value.toMillis();
    }
    return null;
}
function groupDocuments(docs, objectId, groupBy) {
    const groups = new Map();
    for (const doc of docs) {
        const key = groupBy
            .map((fieldId) => {
            const field = (0, reportCatalog_1.getReportField)(fieldId);
            if (!field)
                return "";
            return JSON.stringify(getFieldValue(doc, objectId, field) ?? null);
        })
            .join(" ");
        const bucket = groups.get(key);
        if (bucket)
            bucket.push(doc);
        else
            groups.set(key, [doc]);
    }
    return groups;
}
function aggregateResultKey(agg) {
    return (0, reportQueryModel_1.isFieldlessAggregate)(agg.fn) ? agg.fn : `${agg.fn}(${agg.fieldId})`;
}
function computeAggregate(rows, objectId, agg) {
    if ((0, reportQueryModel_1.isFieldlessAggregate)(agg.fn))
        return rows.length; // countRows: bounded by the runner's own authorized/filtered row set
    const field = (0, reportCatalog_1.getReportField)(agg.fieldId);
    if (!field)
        return 0;
    const values = rows
        .map((doc) => getFieldValue(doc, objectId, field))
        .filter((v) => typeof v === "number" && Number.isFinite(v));
    switch (agg.fn) {
        case "count": return values.length;
        case "sum": return values.reduce((a, b) => a + b, 0);
        case "avg": return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        case "min": return values.length > 0 ? Math.min(...values) : 0;
        case "max": return values.length > 0 ? Math.max(...values) : 0;
        default: return 0;
    }
}
async function joinRelatedDocs(db, baseObjectId, docs, relatedFields, 
// P2-H: the operating companies this run is bound to. A related document is
// attached only if it satisfies its OWN family's bound against this reach.
companyReach) {
    // Group the related fields by the relationship they traverse (usually
    // one relationship, but a definition could select fields from more
    // than one related object).
    const byRelationship = new Map();
    for (const { field, relationship } of relatedFields) {
        if (!relationship)
            continue;
        const toObject = (0, reportCatalog_1.getReportObject)(relationship.toObjectId);
        if (!toObject?.collection)
            continue;
        const viaField = (0, reportCatalog_1.getReportField)(relationship.viaField);
        if (!viaField)
            continue;
        const key = relationship.relationshipId;
        if (!byRelationship.has(key)) {
            byRelationship.set(key, { toObjectId: relationship.toObjectId, toCollection: toObject.collection, viaField, fields: [] });
        }
        byRelationship.get(key).fields.push(field);
    }
    if (byRelationship.size === 0)
        return docs;
    const joinedDocs = docs.map((d) => ({ ...d }));
    for (const { toObjectId, toCollection, viaField } of byRelationship.values()) {
        const refIds = new Set();
        for (const doc of joinedDocs) {
            const rawRef = getAtPath(doc, rawFieldPath(viaField));
            if (typeof rawRef === "string" && rawRef)
                refIds.add(rawRef);
        }
        if (refIds.size === 0)
            continue;
        const refDocs = await Promise.all(Array.from(refIds).map((id) => db.collection(toCollection).doc(id).get()));
        // P2-H: the related collection's own row bound, read from the same
        // ownership-matrix authority the base query used. A document whose family
        // is company-partitioned and whose company is absent, malformed, or out of
        // reach is NOT attached -- and neither is one whose family states no
        // enforceable bound at all (`unsupported` fails closed here exactly as it
        // refuses the run at the base object). An ownerless record is not
        // everyone's; it is a record whose company nobody has stated.
        const relatedScope = (0, reportRowScope_1.reportRowScopeForCollection)(toCollection);
        const byId = new Map();
        refDocs.forEach((snap, i) => {
            if (!snap.exists)
                return;
            const data = { id: snap.id, ...snap.data() };
            if (!(0, reportRowScope_1.documentWithinCompanyReach)(data, relatedScope, companyReach))
                return;
            byId.set(Array.from(refIds)[i], data);
        });
        for (const doc of joinedDocs) {
            const rawRef = getAtPath(doc, rawFieldPath(viaField));
            if (typeof rawRef === "string" && byId.has(rawRef)) {
                doc[`__related__${toObjectId}`] = byId.get(rawRef);
            }
        }
    }
    return joinedDocs;
}
// Independent-review finding (round 1): `sort` was authorization-filtered
// into `activeSort` but never actually applied anywhere -- a definition
// with a `sort` clause silently returned Firestore's raw fetch order
// (and the row cap then truncated an arbitrary, not a sorted, set).
// Fixed: applied to the ungrouped row list before capping/projecting
// (see runReportDefinition below). Stable (Array.prototype.sort's
// documented guarantee since ES2019) so a multi-key sort composes
// correctly across successive single-key comparisons.
function sortRows(rows, objectId, sort) {
    if (sort.length === 0)
        return rows;
    const sorted = [...rows];
    // Apply sort keys in REVERSE order with a stable sort, so the FIRST
    // key in `sort` ends up the primary key (each later stable pass only
    // breaks ties left by the previous one).
    for (const s of [...sort].reverse()) {
        const field = (0, reportCatalog_1.getReportField)(s.fieldId);
        if (!field)
            continue;
        sorted.sort((a, b) => {
            const av = getFieldValue(a, objectId, field);
            const bv = getFieldValue(b, objectId, field);
            const cmp = compareValues(av, bv);
            return s.direction === "desc" ? -cmp : cmp;
        });
    }
    return sorted;
}
// A field's declared dataType (from the catalog) isn't threaded through
// to this comparator, so it infers by RUNTIME shape instead: two numbers
// compare numerically; a Firestore Timestamp-shaped value (has
// `.toMillis()`, e.g. a `date` field's raw stored value) compares by
// millis; everything else compares as a string. `null`/`undefined`
// (a field genuinely absent on a document, or the runner-authorized-but-
// unset case) always sorts last, regardless of asc/desc, matching the
// conventional "nulls last" sort convention.
function compareValues(a, b) {
    if (a === b)
        return 0;
    if (a === undefined || a === null)
        return 1;
    if (b === undefined || b === null)
        return -1;
    if (typeof a === "number" && typeof b === "number")
        return a - b;
    const aMillis = toTimestampMillis(a);
    const bMillis = toTimestampMillis(b);
    if (aMillis !== null && bMillis !== null)
        return aMillis - bMillis;
    return String(a).localeCompare(String(b));
}
function toTimestampMillis(value) {
    if (value && typeof value === "object" && typeof value.toMillis === "function") {
        return value.toMillis();
    }
    return null;
}
function projectDoc(doc, baseObjectId, activeFields) {
    const projected = {};
    for (const fieldId of activeFields) {
        const field = (0, reportCatalog_1.getReportField)(fieldId);
        if (!field)
            continue;
        projected[fieldId] = getFieldValue(doc, baseObjectId, field) ?? null;
    }
    return projected;
}
//# sourceMappingURL=reportExecutionService.js.map