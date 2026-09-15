// The PostgreSQL CATALOG REFERENCE AUTHORITY -- the implementation of the Commercial catalog-reference port.
//
// ════════════════════ WHAT IT ANSWERS ════════════════════
//
// For each { kind, ref } a Commercial command sends, within ONE tenant, exactly one verdict, in order:
//
//   FOUND       the ref is a canonical identity of the kind the line claims
//                 PART             eos_ops.parts            (tenant_id, id)   -- migration 025
//                 EQUIPMENT_MODEL  eos_ops.equipment_models (tenant_id, id)   -- migration 008
//   WRONG_KIND  not of that kind, but a canonical identity of the OTHER kind in the same tenant
//   NOT_FOUND   neither
//
// The rules are the existing Firestore check's (salesAgreement/salesAgreementLineReferences.ts), restated against
// the PostgreSQL identities and nothing more: own kind first, then the other kind; EXISTENCE AND KIND ONLY (no
// sellability rule exists in the repository, so a DRAFT / INACTIVE / RETIRED model is FOUND exactly as it is in
// Firestore today); exact key equality (no trim, case-fold, prefix, LIKE, alias or SKU fallback). Another tenant's
// identity is NOT_FOUND -- never WRONG_KIND, never disclosed.
//
// ════════════════════ WHAT IT IS NOT ════════════════════
//
//   * Not a Firestore adapter and not a compatibility cache: it reads only the two PostgreSQL identity tables.
//   * Not a query surface: one frozen object, one method, one fixed parameterized statement. No search, no list,
//     no caller-supplied SQL, table or column.
//   * Not a transaction owner: it runs on the `db` the command hands it, so the verdicts belong to the SAME
//     snapshot as the command's write.
//   * Not wired: nothing composes it. Composition is CATALOG_CUTOVER_TAIL, gated on proven population/reconciliation
//     (an empty catalog would answer NOT_FOUND for every real product; CATALOG_AUTHORITY_UNAVAILABLE is the truth).
//
// The port's types are restated structurally rather than imported, because the C2 command layer is imported only
// by itself (commercialCommandLayer.test.mjs). Its CONTRACT is proven by passing this authority to the real
// command services as `deps.catalog` (catalogReferenceAuthorityPostgres.test.mjs).
import type { PoolClient } from "pg";

export type CatalogReferenceKind = "PART" | "EQUIPMENT_MODEL";
export interface CatalogReference {
  readonly kind: CatalogReferenceKind;
  readonly ref: string;
}
export type CatalogReferenceVerdict = "FOUND" | "NOT_FOUND" | "WRONG_KIND";

export interface CatalogReferenceAuthority {
  verifyReferences(
    db: Pick<PoolClient, "query">,
    tenantId: string,
    references: readonly CatalogReference[],
  ): Promise<readonly CatalogReferenceVerdict[]>;
}

export type CatalogReferenceAuthorityErrorCode = "INVALID_TENANT" | "INVALID_REFERENCE" | "AUTHORITY_ANSWER_MISMATCH";

export class CatalogReferenceAuthorityError extends Error {
  constructor(readonly code: CatalogReferenceAuthorityErrorCode, message: string) {
    super(message);
    this.name = "CatalogReferenceAuthorityError";
  }
}

// One row per reference, in input order. Each EXISTS is an exact primary-key probe inside the caller's tenant.
const VERIFY_REFERENCES_SQL = `
SELECT r.ordinal,
       EXISTS (SELECT 1 FROM eos_ops.parts p WHERE p.tenant_id = $1 AND p.id = r.ref) AS is_part,
       EXISTS (SELECT 1 FROM eos_ops.equipment_models m WHERE m.tenant_id = $1 AND m.id = r.ref) AS is_equipment_model
  FROM unnest($2::text[]) WITH ORDINALITY AS r(ref, ordinal)
 ORDER BY r.ordinal`;

function verdictFor(kind: CatalogReferenceKind, isPart: boolean, isEquipmentModel: boolean): CatalogReferenceVerdict {
  const own = kind === "PART" ? isPart : isEquipmentModel;
  const other = kind === "PART" ? isEquipmentModel : isPart;
  if (own) return "FOUND";
  if (other) return "WRONG_KIND";
  return "NOT_FOUND";
}

async function verifyReferences(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  references: readonly CatalogReference[],
): Promise<readonly CatalogReferenceVerdict[]> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new CatalogReferenceAuthorityError("INVALID_TENANT", "a catalog reference is only answerable within a tenant");
  }
  if (!Array.isArray(references)) {
    throw new CatalogReferenceAuthorityError("INVALID_REFERENCE", "references must be a list");
  }
  references.forEach((reference, i) => {
    if (
      reference === null || typeof reference !== "object" ||
      (reference.kind !== "PART" && reference.kind !== "EQUIPMENT_MODEL") ||
      typeof reference.ref !== "string" || reference.ref === ""
    ) {
      throw new CatalogReferenceAuthorityError("INVALID_REFERENCE", `reference ${i} is not a PART or EQUIPMENT_MODEL reference`);
    }
  });
  if (references.length === 0) return [];

  const result = await db.query(VERIFY_REFERENCES_SQL, [tenantId, references.map((r) => r.ref)]);
  const rows = result.rows as { ordinal: string | number; is_part: boolean; is_equipment_model: boolean }[];
  if (rows.length !== references.length || rows.some((row, i) => Number(row.ordinal) !== i + 1)) {
    throw new CatalogReferenceAuthorityError("AUTHORITY_ANSWER_MISMATCH", "the catalog did not answer one row per reference, in order");
  }
  return rows.map((row, i) => verdictFor(references[i].kind, row.is_part === true, row.is_equipment_model === true));
}

/** The PostgreSQL catalog reference authority. Stateless; the returned object has exactly one method. */
export function createPostgresCatalogReferenceAuthority(): CatalogReferenceAuthority {
  return Object.freeze({ verifyReferences });
}
