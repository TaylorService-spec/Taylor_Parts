"use strict";
// Commercial Coverage & Territory — PURE governed write command core (capability #15 persistence). Validates +
// builds the durable records the client authority model (field-ops-app-vite/src/domain/commercialCoverage.js)
// defines: a SALES TERRITORY (a coverage object independent of any salesperson) and a COVERAGE ASSIGNMENT (a
// person assigned to a scope, effective-dated). Records only — NO precedence/override/inheritance, NO winner,
// NO credit/commission (deferred per the ratified assessment). Coverage ≠ owner ≠ credit ≠ commission ≠
// security ≠ Service Territory. No I/O (the callable owns the write).
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoverageCommandError = exports.COVERAGE_PRIORITIES = exports.COVERAGE_SCOPE_KINDS = exports.TERRITORY_KINDS = void 0;
exports.buildTerritory = buildTerritory;
exports.buildCoverageAssignment = buildCoverageAssignment;
exports.TERRITORY_KINDS = Object.freeze(["STATE", "STATE_GROUP", "ZIP_GROUP", "GEOSPATIAL"]);
exports.COVERAGE_SCOPE_KINDS = Object.freeze(["TERRITORY", "ACCOUNT", "NAMED_ACCOUNT", "CORPORATE", "CHANNEL"]);
exports.COVERAGE_PRIORITIES = Object.freeze(["PRIMARY", "SECONDARY", "OVERLAY"]);
class CoverageCommandError extends Error {
    code;
    constructor(code, message) { super(message); this.name = "CoverageCommandError"; this.code = code; }
}
exports.CoverageCommandError = CoverageCommandError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
const strList = (v) => (Array.isArray(v) ? v.filter(nonEmpty).map((s) => s.trim()) : []);
function buildTerritory(input, deps) {
    if (!nonEmpty(input?.name))
        throw new CoverageCommandError("REQUIRED", "territory name is required");
    if (!exports.TERRITORY_KINDS.includes(input?.kind))
        throw new CoverageCommandError("KIND_INVALID", `kind must be one of ${exports.TERRITORY_KINDS.join("/")}`);
    const g = (input.geo ?? {});
    let geo;
    switch (input.kind) {
        case "STATE":
        case "STATE_GROUP": {
            const states = strList(g.states).map((s) => s.toUpperCase());
            if (states.length === 0)
                throw new CoverageCommandError("GEO_INVALID", `${String(input.kind)} territory requires geo.states[]`);
            geo = { states };
            break;
        }
        case "ZIP_GROUP": {
            const zips = strList(g.zips);
            const zipPrefixes = strList(g.zipPrefixes);
            if (zips.length === 0 && zipPrefixes.length === 0)
                throw new CoverageCommandError("GEO_INVALID", "ZIP_GROUP territory requires geo.zips[] or geo.zipPrefixes[]");
            geo = { ...(zips.length ? { zips } : {}), ...(zipPrefixes.length ? { zipPrefixes } : {}) };
            break;
        }
        default: {
            // GEOSPATIAL — an opaque reference to a future geometry authority (never resolved here).
            if (!nonEmpty(g.polygonRef))
                throw new CoverageCommandError("GEO_INVALID", "GEOSPATIAL territory requires geo.polygonRef");
            geo = { polygonRef: g.polygonRef.trim() };
        }
    }
    const status = input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    return { name: input.name.trim(), kind: input.kind, geo, status, createdAtMillis: deps.nowMillis };
}
function buildCoverageAssignment(input, deps) {
    if (!nonEmpty(input?.companyId))
        throw new CoverageCommandError("REQUIRED", "companyId is required");
    const a = input?.assignee ?? {};
    // A coverage assignment assigns a PERSON (the reciprocally-linked employee/user identity). Identity
    // resolution is separate; both refs are required so an assignment is never a dangling name.
    if (!nonEmpty(a.assignedToEmployeeId) || !nonEmpty(a.assignedToUserId)) {
        throw new CoverageCommandError("ASSIGNEE_INVALID", "assignee requires assignedToEmployeeId and assignedToUserId");
    }
    const s = input?.scope ?? {};
    if (!exports.COVERAGE_SCOPE_KINDS.includes(s.kind))
        throw new CoverageCommandError("SCOPE_INVALID", `scope.kind must be one of ${exports.COVERAGE_SCOPE_KINDS.join("/")}`);
    const scope = { kind: s.kind };
    const requireRef = (field) => {
        if (!nonEmpty(s[field]))
            throw new CoverageCommandError("SCOPE_INVALID", `scope.kind ${String(s.kind)} requires scope.${String(field)}`);
        scope[field] = s[field].trim();
    };
    switch (s.kind) {
        case "TERRITORY":
            requireRef("territoryId");
            break;
        case "ACCOUNT":
            requireRef("accountId");
            break;
        case "NAMED_ACCOUNT":
            requireRef("namedAccountId");
            break;
        case "CORPORATE":
            requireRef("corporateAccountId");
            break;
        case "CHANNEL":
            requireRef("channelId");
            break;
    }
    // A channel constraint may accompany a geographic/account scope (AND-ed at resolve time).
    if (s.kind !== "CHANNEL" && nonEmpty(s.channelId))
        scope.channelId = s.channelId.trim();
    if (!isInt(input.effectiveFrom))
        throw new CoverageCommandError("EFFECTIVE_FROM_INVALID", "effectiveFrom (ms epoch) is required");
    const effectiveTo = input.effectiveTo === undefined || input.effectiveTo === null ? null : input.effectiveTo;
    if (effectiveTo !== null && !isInt(effectiveTo))
        throw new CoverageCommandError("EFFECTIVE_TO_INVALID", "effectiveTo must be a ms epoch or null (open-ended)");
    if (effectiveTo !== null && effectiveTo <= input.effectiveFrom)
        throw new CoverageCommandError("EFFECTIVE_RANGE_INVALID", "effectiveTo must be after effectiveFrom");
    const priority = exports.COVERAGE_PRIORITIES.includes(input.priority) ? input.priority : null;
    return {
        companyId: input.companyId.trim(),
        assignee: {
            assignedToEmployeeId: a.assignedToEmployeeId.trim(),
            assignedToUserId: a.assignedToUserId.trim(),
            assignedToDisplayName: nonEmpty(a.assignedToDisplayName) ? a.assignedToDisplayName.trim() : null,
        },
        scope,
        responsibility: nonEmpty(input.responsibility) ? input.responsibility.trim() : null,
        priority,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: effectiveTo,
        createdAtMillis: deps.nowMillis,
    };
}
//# sourceMappingURL=coverageCommands.js.map