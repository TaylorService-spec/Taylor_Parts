"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartPolicyAuthorityError = void 0;
exports.createPostgresPartPolicyAuthority = createPostgresPartPolicyAuthority;
const controlTypeTrackingMode_js_1 = require("../partMaster/controlTypeTrackingMode.js");
class PartPolicyAuthorityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PartPolicyAuthorityError";
    }
}
exports.PartPolicyAuthorityError = PartPolicyAuthorityError;
// One row per requested id, in request order, whether or not the Part exists. A LEFT JOIN rather than a
// filtered SELECT for exactly that reason: a missing Part must come back as a stated absence in its own
// position, not as a shorter list the caller has to re-align and could re-align wrongly.
const READ_PART_POLICIES_SQL = `
SELECT r.ordinal,
       r.part_id,
       p.id IS NOT NULL                AS found,
       p.status::text                  AS status,
       p.whole_unit                    AS whole_unit,
       p.control_type::text            AS control_type,
       p.equipment_model_id            AS equipment_model_id
  FROM unnest($2::text[]) WITH ORDINALITY AS r(part_id, ordinal)
  LEFT JOIN eos_ops.parts p ON p.tenant_id = $1 AND p.id = r.part_id
 ORDER BY r.ordinal`;
async function readPartPolicies(db, tenantId, partIds) {
    if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new PartPolicyAuthorityError("INVALID_TENANT", "a Part is only answerable within a tenant");
    }
    if (!Array.isArray(partIds)) {
        throw new PartPolicyAuthorityError("INVALID_PART_ID", "partIds must be a list");
    }
    partIds.forEach((id, i) => {
        if (typeof id !== "string" || id.trim() === "") {
            throw new PartPolicyAuthorityError("INVALID_PART_ID", `partId ${i} is not a stated Part id`);
        }
    });
    if (partIds.length === 0)
        return [];
    const result = await db.query(READ_PART_POLICIES_SQL, [tenantId, [...partIds]]);
    const rows = result.rows;
    // The same one-row-per-input check the reference authority makes, for the same reason: a silently
    // shorter or reordered answer would attach one Part's policy to another Part's id.
    if (rows.length !== partIds.length || rows.some((row, i) => Number(row.ordinal) !== i + 1)) {
        throw new PartPolicyAuthorityError("AUTHORITY_ANSWER_MISMATCH", "the catalog did not answer one row per Part, in order");
    }
    return rows.map((row, i) => Object.freeze({
        partId: partIds[i],
        found: row.found === true,
        status: row.found === true ? row.status : null,
        wholeUnit: row.found === true ? row.whole_unit === true : null,
        controlType: row.found === true ? row.control_type : null,
        trackingMode: row.found === true && typeof row.control_type === "string"
            ? (0, controlTypeTrackingMode_js_1.controlTypeToTrackingMode)(row.control_type)
            : null,
        equipmentModelId: row.found === true && typeof row.equipment_model_id === "string" ? row.equipment_model_id : null,
    }));
}
/** The PostgreSQL Part policy authority. Stateless; the returned object has exactly one method. */
function createPostgresPartPolicyAuthority() {
    return Object.freeze({ readPartPolicies });
}
//# sourceMappingURL=postgresPartPolicyAuthority.js.map