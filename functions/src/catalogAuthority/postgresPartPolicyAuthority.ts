// The PostgreSQL PART POLICY AUTHORITY -- the Part FACTS a governed Render command needs before it may act.
//
// ════════════════════ WHY THIS IS NOT postgresCatalogReferenceAuthority ════════════════════
//
// That authority answers ONE question -- "is this ref a canonical identity of the kind the line claims" --
// and says so in its own header: existence and kind only, one frozen object, one method, not a query
// surface. Commercial needs exactly that and must not be handed more.
//
// Install, Consumption and Parts Plan need a DIFFERENT question, and it is a policy question rather than a
// reference one: not "does this Part exist" but "what KIND of thing is it, and may this operation act on
// it". Widening the reference authority to carry `whole_unit` and `control_type` would hand every Commercial
// caller two facts it has no business reading, and would make a sales-agreement line's validation depend on
// columns that have nothing to do with selling. Two authorities, two questions, one table.
//
// ════════════════════ WHY ONE AUTHORITY AND NOT THREE ════════════════════
//
// partMaster/controlTypeTrackingMode.ts records what happened last time: the controlType -> trackingMode
// rule existed as two byte-identical private copies and a third was about to be written. The same pressure
// is here -- Install wants `whole_unit`, Consumption wants tracking mode, Parts Plan wants existence -- and
// three private `SELECT ... FROM eos_ops.parts` statements in three ops modules would be three chances to
// disagree about what a Part is. They read it from here instead.
//
// THE MAPPING IS IMPORTED, NOT RESTATED. controlTypeToTrackingMode is THE mapping, and it is pure (no
// imports at all), so reading it here costs nothing and guarantees Render's answer to "is this part counted
// by quantity or by serial" is the same answer Receiving, Transfer, Cycle Count and the balance read give.
//
// SERIALIZED_LOT IS DELIBERATELY NOT SPECIAL-CASED. PostgreSQL's ops_part_control_type carries a fourth
// value the Firestore-era mapping never learned, so it falls to that mapping's default -- LOT -- which the
// existing validators reject as an unsupported tracking mode. That is the fail-closed answer and it is the
// correct one here: a Part whose control vocabulary this program has not yet ruled on must not be silently
// treated as ordinary countable stock. Teaching the shared mapping a new value would change Receiving,
// Transfer and the balance read at the same time, which is a ruling, not a wiring detail.
//
// NOT A TRANSACTION OWNER. Every method runs on the `db` the command hands it -- the command's own client --
// so the facts belong to the SAME snapshot as the command's write. A Part validated in one transaction and
// acted on in another is not validated.
import type { PoolClient } from "pg";
import { controlTypeToTrackingMode, type ControlTypeTrackingMode } from "../partMaster/controlTypeTrackingMode.js";

/** What a governed command may learn about a Part. Facts only -- every refusal belongs to the caller. */
export interface PartPolicy {
  readonly partId: string;
  /** False when no Part with this id exists IN THIS TENANT. Another tenant's Part is not found. */
  readonly found: boolean;
  /** ACTIVE / INACTIVE / ... as stored. Null when not found. */
  readonly status: string | null;
  /**
   * Is this Part a whole unit -- the thing that becomes customer Equipment when installed?
   *
   * Null when not found. The database already guarantees the shape of this fact:
   * `part_whole_unit_serialized` (migration 1759881600000) refuses any whole-unit Part that is not
   * SERIALIZED/SERIALIZED_LOT or that is a SERVICE class, so "whole unit" cannot mean a service component.
   */
  readonly wholeUnit: boolean | null;
  readonly controlType: string | null;
  /** The ledger vocabulary, through THE shared mapping. Null when not found. */
  readonly trackingMode: ControlTypeTrackingMode | null;
}

export type PartPolicyAuthorityErrorCode = "INVALID_TENANT" | "INVALID_PART_ID" | "AUTHORITY_ANSWER_MISMATCH";

export class PartPolicyAuthorityError extends Error {
  constructor(readonly code: PartPolicyAuthorityErrorCode, message: string) {
    super(message);
    this.name = "PartPolicyAuthorityError";
  }
}

export interface PartPolicyAuthority {
  readPartPolicies(
    db: Pick<PoolClient, "query">,
    tenantId: string,
    partIds: readonly string[],
  ): Promise<readonly PartPolicy[]>;
}

// One row per requested id, in request order, whether or not the Part exists. A LEFT JOIN rather than a
// filtered SELECT for exactly that reason: a missing Part must come back as a stated absence in its own
// position, not as a shorter list the caller has to re-align and could re-align wrongly.
const READ_PART_POLICIES_SQL = `
SELECT r.ordinal,
       r.part_id,
       p.id IS NOT NULL                AS found,
       p.status::text                  AS status,
       p.whole_unit                    AS whole_unit,
       p.control_type::text            AS control_type
  FROM unnest($2::text[]) WITH ORDINALITY AS r(part_id, ordinal)
  LEFT JOIN eos_ops.parts p ON p.tenant_id = $1 AND p.id = r.part_id
 ORDER BY r.ordinal`;

async function readPartPolicies(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  partIds: readonly string[],
): Promise<readonly PartPolicy[]> {
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
  if (partIds.length === 0) return [];

  const result = await db.query(READ_PART_POLICIES_SQL, [tenantId, [...partIds]]);
  const rows = result.rows as {
    ordinal: string | number; part_id: string; found: boolean;
    status: string | null; whole_unit: boolean | null; control_type: string | null;
  }[];
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
      ? controlTypeToTrackingMode(row.control_type)
      : null,
  }));
}

/** The PostgreSQL Part policy authority. Stateless; the returned object has exactly one method. */
export function createPostgresPartPolicyAuthority(): PartPolicyAuthority {
  return Object.freeze({ readPartPolicies });
}
