// Authorization v2 parity, step 1-3: the LIVE ConditionKind inventory and its disposition.
//
// Pure: no database, no Firebase, no I/O. It derives what the Role catalog ACTUALLY declares and states, for each
// ConditionKind, what PostgreSQL must be able to do before a grant carrying it may migrate.
//
// ════════════════════ WHY THIS EXISTS AS CODE AND NOT AS A DOCUMENT ════════════════════
//
// `roleAssignmentCensus.ts` already refuses conditioned and scoped assignments with
// MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY -- correctly, because the PostgreSQL evaluator
// (effectiveObjectAccess.ts loadPrincipalPolicy) ignores assignment scope and has no Condition evaluation at all, so
// copying such a grant would WIDEN it. But "which conditions are live, and what would parity actually require?" was
// prose. Prose does not fail a build.
//
// Deriving the inventory from the catalog makes two things true that a document cannot make true:
//
//   a NEW conditioned grant cannot appear unnoticed -- it lands in this inventory, and the pinning test fails until
//     someone classifies it;
//   a ConditionKind cannot be quietly IMPLEMENTED in PostgreSQL without its disposition being revisited, because the
//     disposition is what says whether implementing it is the right move at all.
//
// ════════════════════ THE DISPOSITIONS ════════════════════
//
//   STILL_REQUIRED               live, and its meaning has nowhere else to live. PostgreSQL must be able to EVALUATE
//                                it before any grant carrying it migrates. Until then the grant stays where it is.
//   MOVED                        the question it asked is now answered by a different governed authority. The Kind
//                                must NOT be implemented in the evaluator: doing so would recreate a second answer
//                                to a settled question.
//   DEAD                         declared in the ConditionKind union and used by nothing. Nothing to implement, and
//                                nothing to migrate. Removing it from the union is a separate, reviewed change.
//   BUSINESS_ELIGIBILITY_SCOPE   live, but it is not a security question at all -- it asks whether an Employee is
//                                QUALIFIED, which the operationalRoles decomposition replaces with Work Eligibility
//                                and Operational Scope. It must NOT become a PostgreSQL Condition.
//
// ════════════════════ WHAT THIS MODULE MUST NEVER BECOME ════════════════════
//
// NOT an evaluator. It decides no access, and nothing in the running system imports it.
// NOT a migration. It moves no assignment and writes nowhere; there is no pool, client or transaction here.
// NOT a licence. A disposition of STILL_REQUIRED does not authorize migrating anything -- it names the work that
//   would have to be done and proved FIRST.
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../../access/governedBusinessRoles";
import type { ConditionKind, Role } from "../../types/access";

export const CONDITION_DISPOSITIONS = Object.freeze([
  "STILL_REQUIRED", "MOVED", "DEAD", "BUSINESS_ELIGIBILITY_SCOPE",
] as const);
export type ConditionDisposition = (typeof CONDITION_DISPOSITIONS)[number];

/** Every ConditionKind the type union declares, so a Kind cannot be added without appearing here. */
export const DECLARED_CONDITION_KINDS = Object.freeze([
  "statusEquals", "statusIn", "isOwnAssignment", "employmentActive", "operationalRoleActive",
] as const satisfies readonly ConditionKind[]);

export interface ConditionKindRuling {
  readonly disposition: ConditionDisposition;
  /** Why, in one sentence -- the record of the decision, not a restatement of the disposition. */
  readonly rationale: string;
  /** What PostgreSQL must be able to do before a grant carrying this Kind may migrate; null when it must never. */
  readonly parityRequirement: string | null;
}

/**
 * The disposition of each declared Kind.
 *
 * These are judgements about ARCHITECTURE, recorded here so they are reviewed as code. The FACTS they are judged
 * against -- which Kind is declared where, by which Role, on which permission -- are derived below and never typed
 * out, so a ruling can never silently drift from the catalog it describes.
 */
export const CONDITION_KIND_RULINGS: Readonly<Record<ConditionKind, ConditionKindRuling>> = Object.freeze({
  isOwnAssignment: Object.freeze({
    disposition: "STILL_REQUIRED",
    rationale:
      "It double-gates reorder.purchaseOrder.void: even an Administrator or Dispatcher must be the request's own "
      + "recorded assignee, matching firestore.rules. It is a PER-RECORD predicate about the target row, which no "
      + "Role, capability, qualification or scope can express -- so its meaning has nowhere else to go.",
    parityRequirement:
      "The PostgreSQL evaluator must evaluate the condition against the TARGET RECORD at decision time, and the "
      + "Void grant must stay denied for a non-assignee. Migrating it unconditioned would hand every Administrator "
      + "and Dispatcher unconditional Void -- the exact widening the census refuses.",
  }),
  operationalRoleActive: Object.freeze({
    disposition: "BUSINESS_ELIGIBILITY_SCOPE",
    rationale:
      "It asks whether an Employee is QUALIFIED to do a kind of work, which is not a security question. The "
      + "operationalRoles decomposition (Owner ruling 2026-09-17) replaces it with Work Eligibility and Operational "
      + "Scope as separate governed authorities. R-32 already moved the six manager-conditioned capabilities to "
      + "governed Business Roles UNCONDITIONED, and that ruling is closed.",
    parityRequirement: null,
  }),
  employmentActive: Object.freeze({
    disposition: "MOVED",
    rationale:
      "Whether an Employee is currently employed is answered by the governed PostgreSQL employment status "
      + "(eos_workforce.employees.employment_status, EMP-RT-W2), which the Owner ruled the sole authority governing "
      + "access. The catalog declares the Kind and uses it nowhere.",
    parityRequirement: null,
  }),
  statusEquals: Object.freeze({
    disposition: "DEAD",
    rationale: "Declared in the ConditionKind union and carried by no Role, on no permission, in either catalog.",
    parityRequirement: null,
  }),
  statusIn: Object.freeze({
    disposition: "DEAD",
    rationale: "Declared in the ConditionKind union and carried by no Role, on no permission, in either catalog.",
    parityRequirement: null,
  }),
});

export interface ConditionUse {
  readonly roleKey: string;
  readonly permissionId: string;
  readonly kind: ConditionKind;
  /** The condition's params, canonically serialized -- two uses differing only in params are different uses. */
  readonly params: string;
}

export interface ConditionKindEntry {
  readonly kind: ConditionKind;
  readonly disposition: ConditionDisposition;
  readonly rationale: string;
  readonly parityRequirement: string | null;
  /** Every live declaration, sorted. Empty for a Kind nothing carries. */
  readonly uses: readonly ConditionUse[];
  readonly roleKeys: readonly string[];
  readonly permissionIds: readonly string[];
}

export interface ConditionKindInventory {
  readonly entries: readonly ConditionKindEntry[];
  /** Role keys carrying at least one Condition -- the census's `conditionedRoleKeys`, derived rather than listed. */
  readonly conditionedRoleKeys: readonly string[];
  /**
   * Kinds that MUST be evaluable in PostgreSQL before any grant carrying them migrates. Exactly the STILL_REQUIRED
   * ones: a MOVED, DEAD or BUSINESS_ELIGIBILITY_SCOPE Kind must never gain an evaluator.
   */
  readonly blockingEvaluatorParity: readonly ConditionKind[];
}

const catalog = (): Readonly<Record<string, Role>> => ({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES });

/** Every Condition the Role catalog actually declares, derived -- never a hand-kept list. */
export function listLiveConditionUses(roles: Readonly<Record<string, Role>> = catalog()): readonly ConditionUse[] {
  const uses: ConditionUse[] = [];
  for (const [roleKey, role] of Object.entries(roles)) {
    for (const [permissionId, conditions] of Object.entries(role.conditionsByPermission ?? {})) {
      for (const condition of conditions ?? []) {
        uses.push({ roleKey, permissionId, kind: condition.kind, params: JSON.stringify(condition.params ?? {}) });
      }
    }
  }
  return uses.sort((a, b) => a.kind.localeCompare(b.kind) || a.roleKey.localeCompare(b.roleKey) || a.permissionId.localeCompare(b.permissionId));
}

/**
 * The inventory: every DECLARED Kind, its ruling, and the live uses backing it.
 *
 * A Kind the catalog uses but the union does not declare is impossible by typing; a Kind used but not RULED would be
 * a gap, so the pinning test asserts every declared Kind has a ruling and every live use names a declared Kind.
 */
export function buildConditionKindInventory(roles: Readonly<Record<string, Role>> = catalog()): ConditionKindInventory {
  const uses = listLiveConditionUses(roles);
  const entries = DECLARED_CONDITION_KINDS.map((kind): ConditionKindEntry => {
    const mine = uses.filter((u) => u.kind === kind);
    const ruling = CONDITION_KIND_RULINGS[kind];
    return {
      kind,
      disposition: ruling.disposition,
      rationale: ruling.rationale,
      parityRequirement: ruling.parityRequirement,
      uses: mine,
      roleKeys: [...new Set(mine.map((u) => u.roleKey))].sort(),
      permissionIds: [...new Set(mine.map((u) => u.permissionId))].sort(),
    };
  });
  return {
    entries,
    conditionedRoleKeys: [...new Set(uses.map((u) => u.roleKey))].sort(),
    blockingEvaluatorParity: entries.filter((e) => e.disposition === "STILL_REQUIRED" && e.uses.length > 0).map((e) => e.kind),
  };
}
