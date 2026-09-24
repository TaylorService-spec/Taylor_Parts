// GRANT CONDITION POLICY — the canonical home for the facts BOTH conditional-authorization
// consumers need, and the only thing either of them needs from the other.
//
// ════════════════════ WHY THIS FILE EXISTS (the integration story, stated plainly) ════════════════════
//
// `WITHHELD_CONDITIONED_CELLS` — the two Technician Purchase Order cells the Owner withheld — used to
// live inside `contextualActionAuthority.ts`, a 271-line module that carries a whole ACTION-level
// authorization design. `conditionalEntitlement.ts`, which is about GRANT-level conditions and shares
// nothing else with that design, imported the constant (and the outcome vocabulary) from it purely
// because that is where they happened to be written first.
//
// That one import cost a lane. `git cherry-pick d48b55a3` onto the migration lineage applied with no
// textual conflict and then failed to compile:
//
//     src/eosOps/conditionalEntitlement.ts(62,74): error TS2307:
//       Cannot find module './contextualActionAuthority'
//
// because the action seam is a DIFFERENT lane's unmerged work. The migration lane's only two options
// were to drag an unreviewed authorization design across, or to INVENT the constant that holds the
// two cells withheld — and inventing a withholding is how a withholding stops being real. It reverted
// the cherry-pick and wrote the schema out by hand instead.
//
// So the policy evidence moves to where it belongs: a small module that depends on NOTHING but the
// evaluator's reason vocabulary, which both consumers import. `contextualActionAuthority` re-exports
// these names so its own public surface is unchanged; `conditionalEntitlement` no longer mentions it.
// The GRANT-level model is now cherry-pickable as {this file + conditionalEntitlement.ts +
// capabilityAuthority.ts + entitledActionAuthority.ts}, none of which reaches the action seam.
//
// NOTHING HERE IS DUPLICATED. There is exactly one `WITHHELD_CONDITIONED_CELLS` array in the tree and
// exactly one `ContextualActionOutcome`; every other reference is a re-export of these.
import type { AuthorizationReason, RecordContext } from "./contextualAuthorization";

// ════════════════════ THE OUTCOME VOCABULARY ════════════════════

/**
 * The one outcome neither the evaluator nor any predicate can produce: the context authority could
 * not be CONSULTED at all. Spelled like every other authority-unavailable refusal in this repository
 * (CATALOG_AUTHORITY_UNAVAILABLE, EMPLOYEE_AUTHORITY_UNAVAILABLE) so an outage is never read as a
 * business denial, and never as a decision.
 */
export const CONTEXT_AUTHORITY_UNAVAILABLE = "CONTEXT_AUTHORITY_UNAVAILABLE" as const;

/** The evaluator's seven-reason vocabulary, plus "the authority could not answer". */
export type ContextualActionOutcome = AuthorizationReason | typeof CONTEXT_AUTHORITY_UNAVAILABLE;

// ════════════════════ THE WITHHELD CELLS ════════════════════

/**
 * (Role, capability) cells that MUST NOT be activated as a condition — Owner ruling.
 *
 * `reorder.purchaseOrder.read` is granted UNCONDITIONED to eleven Roles and `.create` to five
 * (functions/migrations/1761696000000, grant block; measured again in nonprod on 2026-09-24 as 11 and
 * 5, with `technician` absent from both). Registering a WORK_ELIGIBILITY(PARTS_OPERATIONS) policy for
 * either ACTION would impose the technician's condition on all eleven and all five — a narrowing of
 * other Roles' grants, which is the opposite of preserving them.
 *
 * The two enforcement points differ, and the difference is the whole distinction between EXPRESSING a
 * condition and ACTIVATING one:
 *
 *   ACTION level   `contextualActionAuthority.actionContextRegistry` throws for these keys in ANY
 *                  registry, test registries included, because an action-level predicate is wrong for
 *                  them in every registry.
 *   GRANT level    a condition on `ROLE:technician` narrows nobody else, so it is not wrong in the
 *                  same way — it is simply not activated. `assertNoWithheldGrantConditions` therefore
 *                  guards the PRODUCTION entry point only, and a test may still model the cell.
 */
export const WITHHELD_CONDITIONED_CELLS: readonly string[] = Object.freeze([
  "reorder.purchaseOrder.read",
  "reorder.purchaseOrder.create",
]);

export const isWithheldConditionedCell = (capabilityKey: string): boolean =>
  WITHHELD_CONDITIONED_CELLS.includes(capabilityKey);

// ════════════════════ THE RELATION, AS DEPLOYED ════════════════════

/**
 * The migration that created the condition relation. APPLIED — this is no longer a proposal.
 *
 * Written by the governed-activation lane (commit 0aaeffeb) from this module's own DDL text, and
 * applied to nonprod on 2026-09-24. The relation is LIVE and EMPTY: zero rows, therefore zero
 * conditional entitlements active anywhere.
 */
export const GRANT_CONDITION_RELATION_MIGRATION = "1762214400000";

/** Schema-qualified name of the relation. The single spelling every reader and test uses. */
export const GRANT_CONDITION_RELATION_NAME = "eos_policy.capability_grant_conditions";

/**
 * The relation's DDL, character for character as migration 1762214400000 carries it.
 *
 * Kept in the repository because a test can create a throwaway database from THIS text and prove the
 * reader against it, and because `describeGrantConditionRelation` compares the LIVE shape to
 * `GRANT_CONDITION_RELATION_SHAPE` below — the two halves of "the code understands the deployed
 * schema" rather than "the code once wrote a schema".
 *
 * WHY A SEPARATE RELATION AND NOT A COLUMN (AB2, Owner ruling). `role_capabilities` and
 * `principal_capabilities` answer "may this Principal perform this TYPE of action" and nothing else.
 * A `condition` column on either would make one row answer two questions, and every Administration
 * screen would have to render a compound. Keyed by (grantor, capability) instead, the condition is a
 * second, separately administered fact that a grant row need never know about; deleting the grant
 * makes the condition inert without deleting it.
 *
 * WHY grant_scope + grantor_key AND NOT TWO TABLES. One relation covers ROLE and PRINCIPAL grantors
 * (AB3) so a future conditioned direct grant needs no new table, no new reader and no new code path —
 * only a row. `grantor_key` is the ROLE KEY or the PRINCIPAL ID, matching how `capabilitiesForRoleKeys`
 * already resolves by key rather than by id.
 */
export const GRANT_CONDITION_RELATION_DDL = `
CREATE TABLE eos_policy.capability_grant_conditions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    grant_scope     TEXT NOT NULL CHECK (grant_scope IN ('ROLE','PRINCIPAL')),
    grantor_key     TEXT NOT NULL,
    capability_key  TEXT NOT NULL REFERENCES eos_policy.capabilities(key),
    condition       JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
    established_by  TEXT NOT NULL,
    established_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, grant_scope, grantor_key, capability_key)
);
CREATE INDEX capability_grant_conditions_by_capability
    ON eos_policy.capability_grant_conditions (tenant_id, capability_key);
`.trim();

/** The two `status` values the relation's CHECK admits. Only ACTIVE rows are ever loaded. */
export const GRANT_CONDITION_STATUSES = Object.freeze(["ACTIVE", "RETIRED"] as const);
/** The two `grant_scope` values the relation's CHECK admits. */
export const GRANT_CONDITION_SCOPES = Object.freeze(["ROLE", "PRINCIPAL"] as const);

export interface GrantConditionColumnShape {
  readonly name: string;
  /** `information_schema.columns.data_type`, verbatim. */
  readonly dataType: string;
  readonly nullable: boolean;
  /** `column_default`, or null where the column has none. */
  readonly columnDefault: string | null;
}

/**
 * THE DEPLOYED SHAPE, declared.
 *
 * Read out of nonprod (`information_schema.columns`, `pg_constraint`, `pg_indexes`) on 2026-09-24 and
 * written down so the repository can FAIL when the database and the code drift apart, in either
 * direction. This is the whole of AJ2: the code does not merely contain a CREATE TABLE it once
 * emitted; it holds an executable claim about what is live.
 */
export const GRANT_CONDITION_RELATION_SHAPE = Object.freeze({
  schema: "eos_policy",
  table: "capability_grant_conditions",
  columns: Object.freeze([
    { name: "id", dataType: "text", nullable: false, columnDefault: null },
    { name: "tenant_id", dataType: "text", nullable: false, columnDefault: null },
    { name: "grant_scope", dataType: "text", nullable: false, columnDefault: null },
    { name: "grantor_key", dataType: "text", nullable: false, columnDefault: null },
    { name: "capability_key", dataType: "text", nullable: false, columnDefault: null },
    { name: "condition", dataType: "jsonb", nullable: false, columnDefault: null },
    { name: "status", dataType: "text", nullable: false, columnDefault: "'ACTIVE'::text" },
    { name: "established_by", dataType: "text", nullable: false, columnDefault: null },
    { name: "established_at", dataType: "timestamp with time zone", nullable: false, columnDefault: "now()" },
    { name: "updated_by", dataType: "text", nullable: false, columnDefault: null },
    { name: "updated_at", dataType: "timestamp with time zone", nullable: false, columnDefault: "now()" },
  ] as readonly GrantConditionColumnShape[]),
  /** `pg_get_constraintdef`, verbatim, keyed by the definition rather than by PostgreSQL's generated name. */
  constraints: Object.freeze([
    "PRIMARY KEY (id)",
    "UNIQUE (tenant_id, grant_scope, grantor_key, capability_key)",
    "FOREIGN KEY (tenant_id) REFERENCES eos_policy.tenants(id)",
    "FOREIGN KEY (capability_key) REFERENCES eos_policy.capabilities(key)",
    "CHECK ((grant_scope = ANY (ARRAY['ROLE'::text, 'PRINCIPAL'::text])))",
    "CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text])))",
  ] as readonly string[]),
  /** The one NAMED index the migration creates. The two constraint-backed indexes are implied above. */
  namedIndex: Object.freeze({
    name: "capability_grant_conditions_by_capability",
    columns: Object.freeze(["tenant_id", "capability_key"] as readonly string[]),
  }),
} as const);

/**
 * The record kinds a condition may ask about. Fixed by the evaluator's governed assignment relations,
 * restated here so the catalog builder can refuse an unknown kind without importing the evaluator's
 * internals.
 */
export const GRANT_CONDITION_RECORD_KINDS: readonly RecordContext["recordKind"][] =
  Object.freeze(["reorderRequest", "workOrder"]);
