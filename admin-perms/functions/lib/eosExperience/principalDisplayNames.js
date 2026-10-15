"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_OWNER_CANDIDATE_LIMIT = exports.ACCOUNT_OWNER_OFFER_CAPABILITIES = exports.MAX_PRINCIPAL_IDS = exports.ACTOR_DISPLAY_READ_CAPABILITIES = void 0;
exports.resolvePrincipalDisplayNames = resolvePrincipalDisplayNames;
exports.resolveEmployeeDisplayNames = resolveEmployeeDisplayNames;
exports.searchAccountOwnerCandidates = searchAccountOwnerCandidates;
const myWork_1 = require("./myWork");
exports.ACTOR_DISPLAY_READ_CAPABILITIES = Object.freeze([
    "customer.record.read", "opportunity.read", "salesAgreement.read", "salesOrder.read", "workOrder.record.read",
]);
exports.MAX_PRINCIPAL_IDS = 100;
async function resolvePrincipalDisplayNames(deps, caller, input) {
    const extra = Object.keys(input ?? {}).filter((k) => k !== "principalIds" && k !== "actorSubjects");
    if (extra.length)
        throw new myWork_1.MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    const list = (v) => (v === undefined ? [] : v);
    const principalIds = list(input?.principalIds);
    const subjects = list(input?.actorSubjects);
    const valid = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200);
    if (!valid(principalIds) || !valid(subjects) || principalIds.length + subjects.length === 0 || principalIds.length + subjects.length > exports.MAX_PRINCIPAL_IDS) {
        throw new myWork_1.MyWorkError("PRINCIPAL_IDS_INVALID", "INVALID_INPUT", `principalIds and actorSubjects are 1 to ${exports.MAX_PRINCIPAL_IDS} non-empty ids in all`);
    }
    const actor = caller.actor;
    if (!holdsAny(caller, exports.ACTOR_DISPLAY_READ_CAPABILITIES)) {
        throw new myWork_1.MyWorkError("CAPABILITY_REQUIRED", "FORBIDDEN", `naming record actors requires one of ${exports.ACTOR_DISPLAY_READ_CAPABILITIES.join(", ")}`);
    }
    const { rows } = await deps.pool.query(`SELECT p.id AS key, p.display_name
       FROM eos_policy.principals p
       JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
      WHERE p.id = ANY($2::text[])
     UNION
     SELECT p.external_subject AS key, p.display_name
       FROM eos_policy.principals p
       JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
      WHERE p.external_subject = ANY($3::text[])
      ORDER BY 1`, [actor.tenantId, [...new Set(principalIds)], [...new Set(subjects)]]);
    return Object.freeze({ names: Object.freeze(rows.map((r) => Object.freeze({ key: r.key, displayName: r.display_name ?? null }))) });
}
// resolveEmployeeDisplayNames -- WHO OWNS IT, IN WORDS. Commercial records carry their owner / accountable person as an
// EOS Employee id. The Employee directory read (listEmployees) is employee.record.read -- Administration and management --
// so a seller or dispatcher who may read the RECORD could not name its owner. Same minimal shape as the actor read above:
// the Employee ids the caller already holds (from records it was allowed to read), at most 100; the same record-read gate;
// the answer is { key, displayName } for Employees of the CALLER'S tenant, every employment status (a former owner keeps
// their name), and nothing else -- no status, no operating company, no Principal link. Unknown or foreign ids are absent.
async function resolveEmployeeDisplayNames(deps, caller, input) {
    const extra = Object.keys(input ?? {}).filter((k) => k !== "employeeIds");
    if (extra.length)
        throw new myWork_1.MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    const ids = input?.employeeIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > exports.MAX_PRINCIPAL_IDS
        || !ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200)) {
        throw new myWork_1.MyWorkError("EMPLOYEE_IDS_INVALID", "INVALID_INPUT", `employeeIds is 1 to ${exports.MAX_PRINCIPAL_IDS} non-empty ids`);
    }
    requireRecordRead(caller);
    const { rows } = await deps.pool.query(`SELECT id AS key, display_name FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY id`, [caller.actor.tenantId, [...new Set(ids)]]);
    return Object.freeze({ names: Object.freeze(rows.map((r) => Object.freeze({ key: r.key, displayName: r.display_name ?? null }))) });
}
// searchAccountOwnerCandidates -- WHOM MAY I MAKE THE OWNER. The Account owner picker's OFFER, for a caller who may create
// or update an Account (customer.record.create / customer.record.update -- the capabilities under which the CRM write accepts
// an owner; no capability is added). It offers exactly what that write accepts (accountAuthority requireOwnerEmployee): an
// Employee of the caller's tenant whose status is ACTIVE or CONTRACTOR. A typed query of 2 to 100 characters, matched on the
// name; at most 25 answers of { employeeId, displayName }, by last name then first name then id. The write re-validates.
exports.ACCOUNT_OWNER_OFFER_CAPABILITIES = Object.freeze(["customer.record.create", "customer.record.update"]);
exports.ACCOUNT_OWNER_CANDIDATE_LIMIT = 25;
async function searchAccountOwnerCandidates(deps, caller, input) {
    const extra = Object.keys(input ?? {}).filter((k) => k !== "query");
    if (extra.length)
        throw new myWork_1.MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    const query = typeof input?.query === "string" ? input.query.trim() : "";
    if (query.length < 2 || query.length > 100)
        throw new myWork_1.MyWorkError("QUERY_INVALID", "INVALID_INPUT", "query is 2 to 100 characters");
    if (!holdsAny(caller, exports.ACCOUNT_OWNER_OFFER_CAPABILITIES)) {
        throw new myWork_1.MyWorkError("CAPABILITY_REQUIRED", "FORBIDDEN", `offering Account owners requires one of ${exports.ACCOUNT_OWNER_OFFER_CAPABILITIES.join(", ")}`);
    }
    const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { rows } = await deps.pool.query(`SELECT id, display_name FROM eos_workforce.employees
      WHERE tenant_id = $1 AND employment_status::text = ANY($2::text[])
        AND (display_name ILIKE $3 OR first_name ILIKE $3 OR last_name ILIKE $3 OR preferred_name ILIKE $3)
      ORDER BY lower(last_name) NULLS LAST, lower(first_name) NULLS LAST, id
      LIMIT ${exports.ACCOUNT_OWNER_CANDIDATE_LIMIT}`, [caller.actor.tenantId, ["ACTIVE", "CONTRACTOR"], like]);
    return Object.freeze({ candidates: Object.freeze(rows.map((r) => Object.freeze({ employeeId: r.id, displayName: r.display_name ?? r.id }))) });
}
function holdsAny(caller, keys) {
    const scoped = (caller.operational?.scopedHeld ?? []);
    return keys.some((c) => caller.actor.capabilities.has(c) || scoped.some((h) => h.capabilityKey === c));
}
function requireRecordRead(caller) {
    if (!holdsAny(caller, exports.ACTOR_DISPLAY_READ_CAPABILITIES)) {
        throw new myWork_1.MyWorkError("CAPABILITY_REQUIRED", "FORBIDDEN", `naming record owners requires one of ${exports.ACTOR_DISPLAY_READ_CAPABILITIES.join(", ")}`);
    }
}
//# sourceMappingURL=principalDisplayNames.js.map