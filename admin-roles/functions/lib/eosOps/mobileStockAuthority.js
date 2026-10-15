"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MobileStockRefusal = exports.MOBILE_WORK_ELIGIBILITY = void 0;
exports.mobilePredicates = mobilePredicates;
exports.requireUsableMobileLocation = requireUsableMobileLocation;
exports.authorizeMobileAct = authorizeMobileAct;
exports.currentMobileLocationIds = currentMobileLocationIds;
const contextualAuthorization_js_1 = require("./contextualAuthorization.js");
exports.MOBILE_WORK_ELIGIBILITY = "SERVICE_TECHNICIAN";
/** The Technician (truck) path for an act at one MOBILE location. */
function mobilePredicates(locationId) {
    return Object.freeze([
        Object.freeze({ kind: "WORK_ELIGIBILITY", qualificationCode: exports.MOBILE_WORK_ELIGIBILITY }),
        Object.freeze({ kind: "OPERATIONAL_SCOPE", scopeType: "MOBILE", scopeId: locationId }),
    ]);
}
class MobileStockRefusal extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "MobileStockRefusal";
    }
}
exports.MobileStockRefusal = MobileStockRefusal;
/**
 * The location is a usable truck location RIGHT NOW: present, ACTIVE, linked 1:1 to a truck that is active and not out of
 * service. `lock` takes a share lock so a concurrent deactivation / relink waits for the operation that relied on it.
 */
async function requireUsableMobileLocation(db, tenantId, locationId, opts = {}) {
    const { rows } = await db.query(`SELECT m.active, m.operating_company_key, m.display_label, t.truck_id, t.active AS truck_active, t.status::text AS truck_status
       FROM eos_ops.mobile_locations m
       LEFT JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
      WHERE m.tenant_id = $1 AND m.location_type = 'MOBILE' AND m.location_id = $2${opts.lock ? " FOR SHARE OF m" : ""}`, [tenantId, locationId]);
    const r = rows[0];
    if (!r)
        throw new MobileStockRefusal("MOBILE_LOCATION_NOT_FOUND", "NOT_FOUND", "no truck location with that id");
    if (r.active !== true)
        throw new MobileStockRefusal("MOBILE_LOCATION_INACTIVE", "PRECONDITION_FAILED", "the truck location is inactive");
    if (!r.truck_id)
        throw new MobileStockRefusal("TRUCK_NOT_LINKED", "PRECONDITION_FAILED", "the truck location is not linked to a truck");
    if (r.truck_active !== true || r.truck_status === "OUT_OF_SERVICE") {
        throw new MobileStockRefusal("TRUCK_INACTIVE", "PRECONDITION_FAILED", "the truck is out of service");
    }
    return Object.freeze({ locationId, operatingCompanyKey: String(r.operating_company_key), truckId: String(r.truck_id), displayLabel: String(r.display_label) });
}
async function employeeCompanyKey(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT k.operating_company_key FROM eos_workforce.employees e
       JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = e.tenant_id AND k.operating_company_id = e.operating_company_id AND k.status = 'ACTIVE'
      WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, employeeId]);
    return rows.length === 1 ? String(rows[0].operating_company_key) : null;
}
/**
 * The full Technician-path decision for one act at one MOBILE location (steps 1-5 above). A refused authorization comes
 * back as a decision (so a caller can fall through to another path); a location / company precondition throws.
 */
async function authorizeMobileAct(db, actor, capabilityKey, locationId, opts = {}) {
    const reader = (0, contextualAuthorization_js_1.postgresContextualReader)(db);
    const decision = await (0, contextualAuthorization_js_1.authorizeObjectAction)(reader, { actor, capabilityKey, predicates: mobilePredicates(locationId) });
    if (!decision.allowed)
        return { allowed: false, decision };
    const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
    if (!employeeId)
        return { allowed: false, decision: { ...decision, allowed: false, reason: "EMPLOYEE_LINK_REQUIRED" } };
    const location = await requireUsableMobileLocation(db, actor.tenantId, locationId, opts);
    if ((await employeeCompanyKey(db, actor.tenantId, employeeId)) !== location.operatingCompanyKey) {
        throw new MobileStockRefusal("MOBILE_LOCATION_COMPANY_MISMATCH", "FORBIDDEN", "the truck belongs to a different operating company than your employment");
    }
    return { allowed: true, employeeId, location };
}
/**
 * The MOBILE locations the caller may operate RIGHT NOW: current MOBILE scopes of the caller's access-eligible linked Employee,
 * over ACTIVE locations linked to an active truck of the Employee's own operating company. Empty for a caller without an
 * Employee, without eligibility or without scope -- never "all trucks".
 */
async function currentMobileLocationIds(db, actor) {
    const reader = (0, contextualAuthorization_js_1.postgresContextualReader)(db);
    const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
    if (!employeeId)
        return [];
    if (!(await reader.hasWorkEligibility(actor.tenantId, employeeId, exports.MOBILE_WORK_ELIGIBILITY)))
        return [];
    const { rows } = await db.query(`SELECT s.scope_id FROM eos_workforce.employee_operational_scopes s
       JOIN eos_ops.mobile_locations m ON m.tenant_id = s.tenant_id AND m.location_type = 'MOBILE' AND m.location_id = s.scope_id AND m.active
       JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
                            AND t.active AND t.status::text <> 'OUT_OF_SERVICE'
       JOIN eos_workforce.employees e ON e.tenant_id = s.tenant_id AND e.id = s.employee_id
       JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = e.tenant_id AND k.operating_company_id = e.operating_company_id
                            AND k.status = 'ACTIVE' AND k.operating_company_key = m.operating_company_key
      WHERE s.tenant_id = $1 AND s.employee_id = $2 AND s.scope_type = 'MOBILE' AND s.effective_to IS NULL
      ORDER BY s.scope_id`, [actor.tenantId, employeeId]);
    return rows.map((r) => String(r.scope_id));
}
//# sourceMappingURL=mobileStockAuthority.js.map