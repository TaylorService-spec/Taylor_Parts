"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXCLUSION_DISPOSITIONS = exports.TECHNICIAN_PREDICATE_MEASUREMENT_STATE = exports.TECHNICIAN_PREDICATE_DISPOSITION = exports.LEGACY_EXCLUDED_SECURITY_ROLE = exports.LEGACY_ASSIGNABLE_OPERATIONAL_ROLE = void 0;
exports.reportPartsAssignabilityExclusion = reportPartsAssignabilityExclusion;
/** The legacy value the picker filters on. Named once; never used as an eligibility input. */
exports.LEGACY_ASSIGNABLE_OPERATIONAL_ROLE = "PARTS_ASSOCIATE";
/** The legacy Security Role the retired client filter excluded. Reported, never required. */
exports.LEGACY_EXCLUDED_SECURITY_ROLE = "technician";
/** The Owner's disposition of that predicate. Retired deliberately; never reproduced in any governed authority. */
exports.TECHNICIAN_PREDICATE_DISPOSITION = "APPROVED_LEGACY_UI_RESTRICTION_RETIREMENT";
/** The state of the live population measurement. Useful evidence to collect later; NOT a cutover gate. */
exports.TECHNICIAN_PREDICATE_MEASUREMENT_STATE = "NOT_MEASURED_OPERATOR_BLOCKED";
exports.EXCLUSION_DISPOSITIONS = Object.freeze([
    /** Satisfies the stored query AND passes the client filter: assignable today, and assignable after cutover. */
    "INCLUDED_TODAY",
    /** Satisfies the stored query but the client hook excludes it for securityRole == technician. THE POPULATION. */
    "EXCLUDED_BY_TECHNICIAN_SECURITY_ROLE",
    /** Satisfies the stored query but securityRole is missing or outside the role vocabulary: the warning case. */
    "EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE",
]);
const zeroed = () => Object.fromEntries(exports.EXCLUSION_DISPOSITIONS.map((d) => [d, 0]));
/**
 * Partition the legacy assignable population by what the client filter does to it.
 *
 * `validSecurityRoles` is the client's own role vocabulary, passed in rather than imported, so the report measures
 * the rule the application actually applies instead of a second copy of it that could drift.
 */
function reportPartsAssignabilityExclusion(snapshot, governed, validSecurityRoles) {
    const valid = new Set(validSecurityRoles);
    const counts = zeroed();
    const excluded = [];
    let satisfyingStoredQuery = 0;
    for (const doc of snapshot.employees) {
        const data = doc.data;
        const roles = Array.isArray(data.operationalRoles) ? data.operationalRoles : [];
        // The STORED query, reproduced exactly: all three clauses, none of them optional.
        const satisfiesStored = data.employmentStatus === "ACTIVE"
            && roles.includes(exports.LEGACY_ASSIGNABLE_OPERATIONAL_ROLE)
            && data.userId !== undefined && data.userId !== null && data.userId !== "";
        if (!satisfiesStored)
            continue;
        satisfyingStoredQuery += 1;
        const legacySecurityRole = typeof data.securityRole === "string" ? data.securityRole : null;
        const disposition = legacySecurityRole === null || !valid.has(legacySecurityRole)
            ? "EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE"
            : legacySecurityRole === exports.LEGACY_EXCLUDED_SECURITY_ROLE
                ? "EXCLUDED_BY_TECHNICIAN_SECURITY_ROLE"
                : "INCLUDED_TODAY";
        counts[disposition] += 1;
        if (disposition === "INCLUDED_TODAY")
            continue;
        const facts = governed.get(doc.id);
        excluded.push({
            employeeId: doc.id,
            disposition,
            legacySecurityRole,
            governedSecurityRoleKeys: [...(facts?.securityRoleKeys ?? [])].sort(),
            governedJobRole: facts?.jobRole ?? null,
            knownToPostgres: facts?.knownToPostgres ?? false,
        });
    }
    excluded.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
    return Object.freeze({
        exportedAt: snapshot.source.exportedAt,
        satisfyingStoredQuery,
        counts: Object.freeze(counts),
        excluded: Object.freeze(excluded),
        enforcedByAnyServerAuthority: false,
    });
}
//# sourceMappingURL=partsAssignabilityExclusion.js.map