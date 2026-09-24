// CONDITIONAL ENTITLEMENT — "Role A holds capability X unconditionally, Role B holds the SAME
// capability only when predicate P holds."
//
// ════════════════════ THE SENTENCE THE PREVIOUS MODEL COULD NOT SAY ════════════════════
//
// `contextualActionAuthority` attaches predicates to an ACTION. That is the right home for a rule
// about the action itself ("completing a Work Order requires being its assignee"), and the wrong
// home for a rule about ONE Role's grant: registering
// WORK_ELIGIBILITY(PARTS_OPERATIONS) on `reorder.purchaseOrder.read` would impose the technician's
// condition on the ELEVEN Roles the Owner left unconditioned, which is a narrowing of grants nobody
// asked to narrow. Measured, from migration 1761696000000: `.read` is granted to accountingManager,
// admin, controller, dispatcher, financeManager, generalManager, operationsManager, owner,
// purchasingManager, warehouseAssociate and warehouseManager with no condition at all; `.create` to
// admin, dispatcher, generalManager, owner and purchasingManager. Only `technician` carries a
// condition, and it carries it in the TypeScript catalog
// (compatibilityRoles.TECHNICIAN_ROLE.conditionsByPermission).
//
// The unit of authorization here is therefore not the action and not the capability. It is the
// ENTITLEMENT: the triple (GRANTOR, capability, condition). One capability key can be reached by
// several entitlements at once, each with its own condition or with none, and effective access is
// the UNION over them.
//
// ════════════════════ THIS IS THE ESTABLISHED EOS SHAPE, NOT A NEW ONE ════════════════════
//
// `adminPolicy/conditionedCapability.ts` already decides exactly this way for the LEGACY catalog
// Condition vocabulary: "allowed when AT LEAST ONE held Role grants the capability with EVERY
// condition on THAT Role's grant satisfied; an unconditioned grant on any held Role therefore
// allows." This module is that same rule for the GOVERNED authorities — Work Eligibility,
// Operational Scope, Record Assignment, read from PostgreSQL — rather than for `isOwnAssignment`
// evaluated against a record's assignee field. Two evaluators, one semantics, deliberately.
//
// ════════════════════ WHAT THIS MODULE MAY NEVER DO ════════════════════
//
//   WIDEN.      A conditional entitlement can only ever REFUSE a caller the flat capability set
//               already admitted. The decision requires BOTH the runtime-resolved capability set
//               (capabilityAuthority.capabilitiesForRoleKeys, unchanged) AND a matching
//               entitlement. If the two resolvers ever disagree, the stricter answer wins.
//   PUT SCOPE ON THE GRANT ROW. `eos_policy.role_capabilities` and `eos_policy.principal_capabilities`
//               keep answering WHAT, never WHICH. The condition lives in a SEPARATE relation keyed
//               by (grantor, capability) — see PROPOSED_GRANT_CONDITION_SCHEMA — so an
//               Administration screen still reads a grant row as one plain fact.
//   ACTIVATE.   SHIPPED_GRANT_CONDITIONS is EMPTY and frozen. Composing this model changes no
//               deployed permission. The two Purchase Order cells are WITHHELD by Owner ruling and
//               the production entry point refuses to run with a catalog that names either one.
//   DROP A CONDITION IT CANNOT PARSE. Silently discarding an unreadable condition turns a
//               conditioned grant into an unconditional one — a widening. Every malformed condition
//               THROWS at catalog-build time instead.
//
// No SQL lives here. The two grant relations and the condition relation are read by
// `capabilityAuthority`, which is the single permitted reader of the eos_policy schema in eosOps.
import {
  authorizeAnyPath,
  CONTEXT_PREDICATE_KINDS,
  type AuthorizationDecision,
  type AuthorizationReason,
  type ContextPredicate,
  type ContextPredicateKind,
  type ContextualActor,
  type ContextualReader,
  type RecordContext,
} from "./contextualAuthorization";
import { WITHHELD_CONDITIONED_CELLS, type ContextualActionOutcome } from "./contextualActionAuthority";

// ════════════════════ THE GRANTOR ════════════════════

/**
 * WHO grants the capability. This is the fact `capabilitiesForRoleKeys` discards when it returns
 * `SELECT DISTINCT c.key` as a flat `Set<string>`, and its absence is the second of the three
 * structural causes the previous lane measured. A condition that cannot name its grantor is a
 * condition on everybody.
 *
 * AB3 — DIRECT PRINCIPAL GRANTS MAY CARRY CONDITIONS. The grantor is a discriminated union, not a
 * role key, so `eos_policy.principal_capabilities` is a first-class conditionable grantor from the
 * start. Nothing today produces a conditioned direct grant (the catalog attaches
 * `conditionsByPermission` to Roles only, and no direct grant is conditioned anywhere), so none is
 * seeded — but the model, the key encoding and the proposed relation all carry PRINCIPAL already,
 * which is what keeps a future direct conditioned grant a data change rather than a redesign.
 */
export type EntitlementGrantor =
  | { readonly kind: "ROLE"; readonly roleKey: string }
  | { readonly kind: "PRINCIPAL"; readonly principalId: string };

export const GRANTOR_KINDS = Object.freeze(["ROLE", "PRINCIPAL"] as const);

/** The stable key for one grantor. Also the first half of the condition relation's business key. */
export function grantorKey(grantor: EntitlementGrantor): string {
  return grantor.kind === "ROLE" ? `ROLE:${grantor.roleKey}` : `PRINCIPAL:${grantor.principalId}`;
}

/** (grantor, capability) — the cell a condition is attached to. Never (capability) alone. */
export function grantCellKey(grantor: EntitlementGrantor, capabilityKey: string): string {
  return `${grantorKey(grantor)}|${capabilityKey}`;
}

// ════════════════════ THE CONDITION ════════════════════

/**
 * The condition on ONE grant cell.
 *
 * `paths` are ALTERNATIVES, exactly as in `ActionContextPolicy`: satisfied when every predicate on
 * at least one path holds. A single path is an AND. An EMPTY `paths`, or an empty path inside it,
 * is REFUSED at build time rather than normalized — "conditioned on nothing" is unconditioned, and
 * an unconditioned grant is expressed by having no condition row at all, never by an empty one.
 */
export interface GrantCondition {
  readonly paths: readonly (readonly ContextPredicate[])[];
  /** Required when any path carries RECORD_ASSIGNMENT. Policy's word, never the caller's. */
  readonly recordKind?: RecordContext["recordKind"];
}

export interface GrantConditionRow {
  readonly grantor: EntitlementGrantor;
  readonly capabilityKey: string;
  readonly condition: GrantCondition;
}

/** (grantor, capability) -> condition. Built only through `grantConditionCatalog`. */
export type GrantConditionCatalog = ReadonlyMap<string, GrantCondition>;

const RECORD_KINDS: readonly RecordContext["recordKind"][] = Object.freeze(["reorderRequest", "workOrder"]);

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function validatePredicate(p: ContextPredicate, where: string): void {
  if (!p || !(CONTEXT_PREDICATE_KINDS as readonly string[]).includes(p.kind)) {
    throw new Error(`${where}: unsupported predicate kind ${JSON.stringify((p as { kind?: unknown })?.kind)}`);
  }
  if (p.kind === "WORK_ELIGIBILITY" && !nonEmpty(p.qualificationCode)) {
    throw new Error(`${where}: WORK_ELIGIBILITY needs a qualificationCode`);
  }
  if (p.kind === "OPERATIONAL_SCOPE" && !nonEmpty(p.scopeType)) {
    throw new Error(`${where}: OPERATIONAL_SCOPE needs a scopeType`);
  }
  if (p.kind === "RECORD_ASSIGNMENT" && p.relation !== "ASSIGNED_EMPLOYEE") {
    throw new Error(`${where}: RECORD_ASSIGNMENT supports only ASSIGNED_EMPLOYEE`);
  }
}

/** Does this condition ask a question about a specific record? */
export const conditionNeedsRecord = (condition: GrantCondition): boolean =>
  condition.paths.some((path) => path.some((p) => p.kind === "RECORD_ASSIGNMENT"));

/**
 * Build a condition catalog, refusing anything it cannot evaluate.
 *
 * Every refusal here is a FAIL-CLOSED refusal: the alternative to throwing is producing a catalog
 * in which a conditioned cell looks unconditioned, and that is a silent grant widening.
 */
export function grantConditionCatalog(rows: readonly GrantConditionRow[]): GrantConditionCatalog {
  const map = new Map<string, GrantCondition>();
  for (const row of rows) {
    if (!row?.grantor || !(GRANTOR_KINDS as readonly string[]).includes(row.grantor.kind)) {
      throw new Error(`grant condition: unknown grantor kind ${JSON.stringify((row?.grantor as { kind?: unknown })?.kind)}`);
    }
    const who = grantorKey(row.grantor);
    if (who === "ROLE:" || who === "PRINCIPAL:") throw new Error("grant condition: grantor has no identity");
    if (!nonEmpty(row.capabilityKey)) throw new Error(`grant condition on ${who}: no capability key`);
    const where = `grant condition ${grantCellKey(row.grantor, row.capabilityKey)}`;
    const paths = row.condition?.paths;
    if (!Array.isArray(paths) || paths.length === 0) throw new Error(`${where}: a condition with no path is not a condition`);
    for (const path of paths) {
      if (!Array.isArray(path) || path.length === 0) throw new Error(`${where}: an empty path would allow every holder`);
      for (const p of path) validatePredicate(p, where);
    }
    const needsRecord = conditionNeedsRecord(row.condition);
    if (needsRecord && !RECORD_KINDS.includes(row.condition.recordKind as RecordContext["recordKind"])) {
      throw new Error(`${where}: RECORD_ASSIGNMENT needs a governed recordKind`);
    }
    if (!needsRecord && row.condition.recordKind !== undefined) {
      throw new Error(`${where}: a recordKind without a RECORD_ASSIGNMENT predicate decides nothing`);
    }
    const key = grantCellKey(row.grantor, row.capabilityKey);
    if (map.has(key)) throw new Error(`${where}: duplicate condition for one grant cell`);
    map.set(key, Object.freeze({
      paths: Object.freeze(paths.map((p) => Object.freeze([...p]))),
      ...(row.condition.recordKind ? { recordKind: row.condition.recordKind } : {}),
    }));
  }
  return Object.freeze(map);
}

/**
 * THE ACTIVATION BOUNDARY, and it is EMPTY.
 *
 * Every deployed composition resolves entitlements against this catalog, finds no condition for any
 * grant cell, and therefore produces entitlements that are all UNCONDITIONAL — byte-identical
 * effective access to `capabilitiesForRoleKeys` on its own. Conditioning a real business grant is a
 * governed data change with its own evidence, and for the two Purchase Order cells it is FORBIDDEN
 * this Wave; `assertNoWithheldGrantConditions` enforces that on the production path.
 */
export const SHIPPED_GRANT_CONDITIONS: GrantConditionCatalog = grantConditionCatalog([]);

/**
 * The Owner's withheld cells, enforced where activation would actually happen.
 *
 * `actionContextRegistry` throws for these keys in ANY registry, because an action-level predicate
 * is wrong for them in any registry — it would condition all eleven and all five holders. A
 * GRANT-level condition on `ROLE:technician` narrows nobody else, so it is not wrong in the same
 * way; it is simply not activated yet. The guard therefore sits on the PRODUCTION entry point: a
 * catalog naming a withheld cell can never reach a deployed decision, while a test may still model
 * the cell and prove the shape. That is the whole distinction between expressing and activating.
 */
export function assertNoWithheldGrantConditions(conditions: GrantConditionCatalog): void {
  for (const key of conditions.keys()) {
    const capabilityKey = key.slice(key.indexOf("|") + 1);
    if (WITHHELD_CONDITIONED_CELLS.includes(capabilityKey)) {
      throw new Error(`${capabilityKey} is a WITHHELD conditioned cell and may not be activated as a grant condition`);
    }
  }
}

// ════════════════════ THE ENTITLEMENT ════════════════════

/** One way this actor reaches one capability. `condition === null` means UNCONDITIONAL. */
export interface Entitlement {
  readonly capabilityKey: string;
  readonly grantor: EntitlementGrantor;
  readonly condition: GrantCondition | null;
}

export type EntitlementSet = readonly Entitlement[];

/** A grant row as the resolver reads it, before a condition is attached. */
export interface CapabilityGrant {
  readonly grantor: EntitlementGrantor;
  readonly capabilityKey: string;
}

/**
 * Compose grants with conditions. Pure, ordered, and total: every grant produces exactly one
 * entitlement, conditioned or not — a grant is never dropped, and a condition for a cell nobody
 * grants is simply inert.
 */
export function entitlementsFrom(
  grants: readonly CapabilityGrant[],
  conditions: GrantConditionCatalog = SHIPPED_GRANT_CONDITIONS,
): EntitlementSet {
  return Object.freeze(grants.map((g) => Object.freeze({
    capabilityKey: g.capabilityKey,
    grantor: Object.freeze({ ...g.grantor }) as EntitlementGrantor,
    condition: conditions.get(grantCellKey(g.grantor, g.capabilityKey)) ?? null,
  })));
}

/**
 * The flat capability set, derived.
 *
 * This is what makes the model adoptable: every surface that today takes
 * `ReadonlySet<string>` keeps working, and a test can prove this set is EQUAL to what
 * `capabilitiesForRoleKeys` returns for the same Roles. Provenance is added beside the old answer,
 * never instead of it.
 */
export function capabilityKeysOf(entitlements: EntitlementSet): ReadonlySet<string> {
  return new Set(entitlements.map((e) => e.capabilityKey));
}

/** The entitlements reaching one capability, in resolution order. */
export function entitlementsFor(entitlements: EntitlementSet, capabilityKey: string): EntitlementSet {
  return Object.freeze(entitlements.filter((e) => e.capabilityKey === capabilityKey));
}

/** Is this capability reachable by at least one UNCONDITIONAL entitlement? */
export const hasUnconditionalEntitlement = (entitlements: EntitlementSet, capabilityKey: string): boolean =>
  entitlements.some((e) => e.capabilityKey === capabilityKey && e.condition === null);

// ════════════════════ THE DECISION ════════════════════

export interface EntitledActor extends ContextualActor {
  /** Provenance-preserving entitlements for this actor, in the resolved tenant only. */
  readonly entitlements: EntitlementSet;
}

export interface EntitlementDenial {
  readonly grantor: EntitlementGrantor;
  readonly outcome: ContextualActionOutcome;
  readonly predicate?: ContextPredicateKind;
  readonly detail?: string;
}

export interface EntitledActionDecision {
  readonly allowed: boolean;
  readonly outcome: ContextualActionOutcome;
  readonly predicate?: ContextPredicateKind;
  readonly detail?: string;
  /** Whether any context authority was consulted. FALSE for capability-missing and for an unconditional path. */
  readonly contextEvaluated: boolean;
  /** The grantor whose entitlement decided an ALLOW. Null on every refusal. */
  readonly viaGrantor: EntitlementGrantor | null;
  /** Whether the allowing entitlement carried a condition. False for an unconditional allow. */
  readonly viaCondition: boolean;
  /** Every conditional entitlement that refused, so nothing is lost behind the reported outcome. */
  readonly denials: readonly EntitlementDenial[];
}

/**
 * SPECIFICITY, for choosing which refusal to report when several conditional entitlements fail.
 *
 * Higher is more specific, where "specific" means "says more about THIS caller and THIS record".
 * NOT_ASSIGNED is about one record; OUTSIDE_OPERATIONAL_SCOPE about where they may work;
 * WORK_ELIGIBILITY_MISSING about what work they may be given; EMPLOYEE_LINK_REQUIRED only that they
 * are not an Employee at all. WORK_ELIGIBILITY_UNMAPPED ranks LAST because it is not a statement
 * about the caller at all — it is the platform admitting it cannot decide — and it would otherwise
 * mask an actionable refusal. It is never lost: every refusal is carried in `denials`.
 */
const DENIAL_SPECIFICITY: Readonly<Record<string, number>> = Object.freeze({
  NOT_ASSIGNED: 5,
  OUTSIDE_OPERATIONAL_SCOPE: 4,
  WORK_ELIGIBILITY_MISSING: 3,
  EMPLOYEE_LINK_REQUIRED: 2,
  WORK_ELIGIBILITY_UNMAPPED: 1,
  CAPABILITY_MISSING: 0,
});

export interface EntitledActionRequest {
  readonly actor: EntitledActor;
  readonly capabilityKey: string;
  /** The governed record id, when a condition asks about one. The KIND comes from the condition. */
  readonly recordId?: string;
}

const decide = (d: Omit<EntitledActionDecision, "denials"> & { denials?: readonly EntitlementDenial[] }): EntitledActionDecision =>
  Object.freeze({ ...d, denials: Object.freeze(d.denials ?? []) });

/**
 * Decide one action for one entitled actor.
 *
 * ORDER, and every step observable in the returned decision:
 *
 *   1  CAPABILITY, from the flat set the runtime authority resolved — unchanged, first, and on its
 *      own. Zero context reads for a caller who does not hold the key. Then the entitlement list
 *      must agree; a disagreement between the two resolvers refuses, never allows.
 *   2  ANY UNCONDITIONAL ENTITLEMENT ALLOWS, before any conditional one is considered, so an
 *      unconditioned holder costs ZERO context reads — the property that keeps the other eleven
 *      Purchase Order Roles exactly as they are.
 *   3  CONDITIONAL ENTITLEMENTS, each evaluated fail-closed against the governed authorities. The
 *      FIRST one that succeeds allows; the capability is checked once, not once per entitlement.
 *   4  NO PATH VALID -> the most specific contextual denial, with every refusal kept in `denials`.
 *      If any conditional entitlement could not be ANSWERED, that dominates: an outage must never
 *      be reported as a business denial, and must never be treated as a decision either.
 */
export async function authorizeEntitledAction(
  reader: ContextualReader,
  request: EntitledActionRequest,
): Promise<EntitledActionDecision> {
  const { actor, capabilityKey } = request;

  // 1. CAPABILITY FIRST — byte-identical to the seam's refusal, and BEFORE the entitlement list is
  //    consulted, so a caller without authority learns only that they lack the capability.
  if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(capabilityKey)) {
    return decide({ allowed: false, outcome: "CAPABILITY_MISSING", detail: capabilityKey,
      contextEvaluated: false, viaGrantor: null, viaCondition: false });
  }
  const reaching = entitlementsFor(actor.entitlements ?? [], capabilityKey);
  if (reaching.length === 0) {
    // The runtime capability set says held, the provenance resolver says nobody granted it. Two
    // authorities disagreeing is not a licence to pick the permissive one.
    return decide({ allowed: false, outcome: "CAPABILITY_MISSING", detail: `${capabilityKey}: no entitlement`,
      contextEvaluated: false, viaGrantor: null, viaCondition: false });
  }

  // 2. UNCONDITIONAL WINS, AND COSTS NOTHING.
  const unconditional = reaching.find((e) => e.condition === null);
  if (unconditional) {
    return decide({ allowed: true, outcome: "ALLOWED", contextEvaluated: false,
      viaGrantor: unconditional.grantor, viaCondition: false });
  }

  // 3. ONLY CONDITIONAL PATHS REMAIN. Each is a separate grant with its own condition.
  const denials: EntitlementDenial[] = [];
  let unavailable: EntitlementDenial | undefined;
  let contextEvaluated = false;

  for (const entitlement of reaching) {
    const condition = entitlement.condition as GrantCondition;
    let record: RecordContext | undefined;
    if (conditionNeedsRecord(condition)) {
      if (!condition.recordKind) {
        denials.push({ grantor: entitlement.grantor, outcome: "NOT_ASSIGNED",
          predicate: "RECORD_ASSIGNMENT", detail: "condition declares no record kind" });
        continue;
      }
      if (typeof request.recordId !== "string" || request.recordId.trim() === "") {
        denials.push({ grantor: entitlement.grantor, outcome: "NOT_ASSIGNED",
          predicate: "RECORD_ASSIGNMENT", detail: "no record supplied" });
        continue;
      }
      record = { recordKind: condition.recordKind, recordId: request.recordId };
    }
    let decision: AuthorizationDecision;
    try {
      contextEvaluated = true;
      decision = await authorizeAnyPath(reader, {
        actor, capabilityKey, paths: condition.paths, record,
      });
    } catch {
      unavailable ??= { grantor: entitlement.grantor, outcome: "CONTEXT_AUTHORITY_UNAVAILABLE",
        detail: "the contextual authority could not be consulted" };
      continue;
    }
    if (decision.allowed) {
      return decide({ allowed: true, outcome: "ALLOWED", contextEvaluated: true,
        viaGrantor: entitlement.grantor, viaCondition: true, denials });
    }
    denials.push({ grantor: entitlement.grantor, outcome: decision.reason,
      predicate: decision.predicate, detail: decision.detail });
  }

  // 4. REFUSED. An unanswerable authority dominates a business denial.
  if (unavailable) {
    return decide({ allowed: false, outcome: "CONTEXT_AUTHORITY_UNAVAILABLE", detail: unavailable.detail,
      contextEvaluated, viaGrantor: null, viaCondition: false, denials: [...denials, unavailable] });
  }
  const worst = denials.reduce((best, d) =>
    (DENIAL_SPECIFICITY[d.outcome] ?? 0) > (DENIAL_SPECIFICITY[best.outcome] ?? 0) ? d : best, denials[0]);
  return decide({ allowed: false, outcome: worst.outcome, predicate: worst.predicate, detail: worst.detail,
    contextEvaluated, viaGrantor: null, viaCondition: false, denials });
}

/** Every reason this module can report. The evaluator's vocabulary, plus the seam's outage outcome. */
export const ENTITLED_ACTION_OUTCOMES: readonly ContextualActionOutcome[] = Object.freeze([
  "ALLOWED", "CAPABILITY_MISSING", "EMPLOYEE_LINK_REQUIRED", "WORK_ELIGIBILITY_MISSING",
  "OUTSIDE_OPERATIONAL_SCOPE", "NOT_ASSIGNED", "WORK_ELIGIBILITY_UNMAPPED", "CONTEXT_AUTHORITY_UNAVAILABLE",
] as const satisfies readonly (AuthorizationReason | "CONTEXT_AUTHORITY_UNAVAILABLE")[]);

// ════════════════════ PERSISTENCE — DESIGNED, NOT MIGRATED ════════════════════

/**
 * The relation a conditioned grant needs, and the exact schema for it.
 *
 * NOT APPLIED. Lane AA owns the migration slot this Wave, so this ships as a design artifact plus a
 * reader (`capabilityAuthority.grantConditionRows`) that is exercised against a throwaway test
 * database created from this very DDL. When the slot is free, this text becomes the migration
 * body unchanged.
 *
 * WHY A SEPARATE RELATION AND NOT A COLUMN (AB2, Owner ruling). `role_capabilities` and
 * `principal_capabilities` answer "may this Principal perform this TYPE of action" and nothing
 * else. A `condition` column on either would make one row answer two questions, and every
 * Administration screen would have to render a compound. Keyed by (grantor, capability) instead,
 * the condition is a second, separately administered fact that a grant row need never know about;
 * deleting the grant makes the condition inert without deleting it, and listing conditions is a
 * governed report of its own.
 *
 * WHY grant_scope + grantor_key AND NOT TWO TABLES. One relation covers ROLE and PRINCIPAL grantors
 * (AB3) so a future conditioned direct grant needs no new table, no new reader and no new code
 * path — only a row. `grantor_key` is the ROLE KEY or the PRINCIPAL ID, matching how
 * `capabilitiesForRoleKeys` already resolves by key rather than by id.
 */
export const PROPOSED_GRANT_CONDITION_SCHEMA = `
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

/** The stored shape one row of that relation holds, before it becomes a `GrantConditionRow`. */
export interface StoredGrantConditionRow {
  readonly grantScope: "ROLE" | "PRINCIPAL";
  readonly grantorKey: string;
  readonly capabilityKey: string;
  readonly condition: unknown;
}

/**
 * Turn stored rows into a catalog, refusing anything unreadable.
 *
 * A stored condition that cannot be parsed must NOT become "no condition": that would convert a
 * conditioned grant into an unconditional one at read time, which is the parity defect shape this
 * repository has already paid for once. It throws, the caller fails closed.
 */
export function grantConditionCatalogFromRows(rows: readonly StoredGrantConditionRow[]): GrantConditionCatalog {
  return grantConditionCatalog(rows.map((row) => {
    const condition = row.condition as GrantCondition | null;
    if (!condition || typeof condition !== "object" || !Array.isArray((condition as GrantCondition).paths)) {
      throw new Error(`stored grant condition ${row.grantScope}:${row.grantorKey}|${row.capabilityKey} is unreadable`);
    }
    return {
      grantor: row.grantScope === "ROLE"
        ? { kind: "ROLE" as const, roleKey: row.grantorKey }
        : { kind: "PRINCIPAL" as const, principalId: row.grantorKey },
      capabilityKey: row.capabilityKey,
      condition,
    };
  }));
}
