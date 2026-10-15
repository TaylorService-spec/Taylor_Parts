"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogReferenceAuthorityError = void 0;
exports.createPostgresCatalogReferenceAuthority = createPostgresCatalogReferenceAuthority;
class CatalogReferenceAuthorityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CatalogReferenceAuthorityError";
    }
}
exports.CatalogReferenceAuthorityError = CatalogReferenceAuthorityError;
// One row per reference, in input order. Each EXISTS is an exact primary-key probe inside the caller's tenant.
const VERIFY_REFERENCES_SQL = `
SELECT r.ordinal,
       EXISTS (SELECT 1 FROM eos_ops.parts p WHERE p.tenant_id = $1 AND p.id = r.ref) AS is_part,
       EXISTS (SELECT 1 FROM eos_ops.equipment_models m WHERE m.tenant_id = $1 AND m.id = r.ref) AS is_equipment_model
  FROM unnest($2::text[]) WITH ORDINALITY AS r(ref, ordinal)
 ORDER BY r.ordinal`;
function verdictFor(kind, isPart, isEquipmentModel) {
    const own = kind === "PART" ? isPart : isEquipmentModel;
    const other = kind === "PART" ? isEquipmentModel : isPart;
    if (own)
        return "FOUND";
    if (other)
        return "WRONG_KIND";
    return "NOT_FOUND";
}
async function verifyReferences(db, tenantId, references) {
    if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new CatalogReferenceAuthorityError("INVALID_TENANT", "a catalog reference is only answerable within a tenant");
    }
    if (!Array.isArray(references)) {
        throw new CatalogReferenceAuthorityError("INVALID_REFERENCE", "references must be a list");
    }
    references.forEach((reference, i) => {
        if (reference === null || typeof reference !== "object" ||
            (reference.kind !== "PART" && reference.kind !== "EQUIPMENT_MODEL") ||
            typeof reference.ref !== "string" || reference.ref === "") {
            throw new CatalogReferenceAuthorityError("INVALID_REFERENCE", `reference ${i} is not a PART or EQUIPMENT_MODEL reference`);
        }
    });
    if (references.length === 0)
        return [];
    const result = await db.query(VERIFY_REFERENCES_SQL, [tenantId, references.map((r) => r.ref)]);
    const rows = result.rows;
    if (rows.length !== references.length || rows.some((row, i) => Number(row.ordinal) !== i + 1)) {
        throw new CatalogReferenceAuthorityError("AUTHORITY_ANSWER_MISMATCH", "the catalog did not answer one row per reference, in order");
    }
    return rows.map((row, i) => verdictFor(references[i].kind, row.is_part === true, row.is_equipment_model === true));
}
/** The PostgreSQL catalog reference authority. Stateless; the returned object has exactly one method. */
function createPostgresCatalogReferenceAuthority() {
    return Object.freeze({ verifyReferences });
}
//# sourceMappingURL=postgresCatalogReferenceAuthority.js.map