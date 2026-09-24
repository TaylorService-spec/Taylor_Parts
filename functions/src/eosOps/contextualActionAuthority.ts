// THE CANONICAL CONTEXTUAL AUTHORIZATION SEAM — the one place a server-side command joins the
// capability set the Render runtime resolved to the record context the governed tables answer.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// Before it, the two halves never met. `capabilityAuthority.resolveOperationalContext` produced an
// effective capability Set from eos_policy; `contextualAuthorization.authorizeObjectAction`
// consumed one and read eos_workforce / eos_ops. NOTHING under src/ imported the second, so every
// domain kernel's authorization ended at `capabilities.has(key)` — thirteen separate call sites,
// each one structurally unable to ask a contextual question.
//
// The wrong fix is thirteen imports of the evaluator. This is the narrow seam instead: ONE function
// every kernel can call with the actor shape they ALREADY have
// (`{ tenantId, principalId, capabilities }` — identical in commercialCommandKernel,
// crmAuthorityKernel, employeeCommandKernel, catalogMasterKernel, workOrderLifecycle,
// reorderAssignmentAuthority and workOrderAssignmentAuthority), which decides whether context is
// even relevant before touching a database.
//
// ════════════════════ THE REGISTRY IS ABOUT ACTIONS, AND SHIPS EMPTY ════════════════════
//
// An action either declares a context policy or it does not. An action that does not is
// UNCONDITIONED and stays that way: the seam returns ALLOWED without one workforce query, which is
// the property that lets this be wired in front of every command without changing what any of them
// already permit.
//
// `ACTION_CONTEXT_POLICIES` therefore ships with ZERO entries. Composing the seam is not activating
// it. Registering a real business action is a separate, per-action, governed step with its own
// evidence — and for two specific cells it is FORBIDDEN; see WITHHELD_CONDITIONED_CELLS.
//
// ════════════════════ THE RECORD KIND IS POLICY, NOT INPUT ════════════════════
//
// A caller supplies a record ID and nothing else. Which governed relation table answers "is this
// mine" comes from the registered policy. A caller that could name the record KIND could name a
// table whose assignment rows it does control — the same shape of defect as a migration read that
// exposes a flag disabling a predicate the legacy path always enforced.
//
// ════════════════════ FAIL CLOSED, INCLUDING ON INFRASTRUCTURE ════════════════════
//
// The evaluator already fails closed on every RESOLVABLE refusal (no Employee link, missing
// eligibility, unmapped qualification, out of scope, not assigned, no record supplied). What it
// does not do is decide what happens when the context authority cannot answer at all — a dropped
// connection, a missing relation. That must never propagate as an exception a caller might catch
// and treat as "no decision"; it becomes one more refusal, named distinctly so an outage is never
// reported as a business denial. The evaluator's own seven-reason vocabulary is UNCHANGED; this
// seam adds exactly one outcome of its own, spelled like every other authority-unavailable refusal
// in this repository (CATALOG_AUTHORITY_UNAVAILABLE, EMPLOYEE_AUTHORITY_UNAVAILABLE).
import type { Pool, PoolClient } from "pg";
import {
  authorizeAnyPath,
  postgresContextualReader,
  type ContextPredicate,
  type ContextPredicateKind,
  type ContextualActor,
  type ContextualReader,
  type RecordContext,
} from "./contextualAuthorization";
import type { ResolvedOperationalContext } from "./capabilityAuthority";
// The withheld-cell ruling and the outcome vocabulary are CANONICAL in grantConditionPolicy.ts and
// re-exported here, so this module's public surface is unchanged while the GRANT-level model
// (conditionalEntitlement.ts) no longer has to import this 271-line ACTION-level design to reach
// them. See that file's header for the lane this import cost.
import { isWithheldConditionedCell, type ContextualActionOutcome } from "./grantConditionPolicy";

export { WITHHELD_CONDITIONED_CELLS, isWithheldConditionedCell } from "./grantConditionPolicy";
export type { ContextualActionOutcome } from "./grantConditionPolicy";

/**
 * The context policy for ONE action.
 *
 * `paths` are ALTERNATIVES: the action is authorized when every predicate on at least one path
 * holds. A policy with a single path is an AND of its predicates. An EMPTY `paths` array is not
 * expressible here on purpose — that is just an unconditioned action, and an unconditioned action
 * has no registry entry at all.
 */
export interface ActionContextPolicy {
  readonly capabilityKey: string;
  readonly paths: readonly (readonly ContextPredicate[])[];
  /** Required when any path carries RECORD_ASSIGNMENT. Chosen by policy, never by the caller. */
  readonly recordKind?: RecordContext["recordKind"];
}

export type ActionContextRegistry = ReadonlyMap<string, ActionContextPolicy>;

/**
 * THE RUNTIME ACTIVATION BOUNDARY. Empty, deliberately.
 *
 * Every deployed composition resolves this registry, finds no policy for any capability any command
 * requires, and therefore behaves exactly as it did before this file existed. Wiring the seam is a
 * code change; conditioning an action is a policy change, and they are kept apart so the first can
 * be reviewed without arguing about the second.
 */
export const ACTION_CONTEXT_POLICIES: ActionContextRegistry = Object.freeze(new Map<string, ActionContextPolicy>());

// `WITHHELD_CONDITIONED_CELLS` is declared in grantConditionPolicy.ts and re-exported above. It is
// the Owner's ruling, not this module's: an action-level predicate on either Purchase Order cell
// would impose the technician's condition on all eleven read holders and all five create holders.
// `actionContextRegistry` below enforces it for EVERY registry, test registries included.

/**
 * WHY A ROLE-SELECTIVE CONDITION COULD NOT BE EXPRESSED, AND WHAT CLOSED IT.
 *
 * Recorded in code because the reason was structural and a future reader would otherwise rediscover
 * it by trying. The three inputs a grant-level condition needs, and where each one now is:
 *
 *   the condition itself        WAS: only in the TypeScript catalog, as Role.conditionsByPermission.
 *                               NOW: eos_policy.capability_grant_conditions, created by migration
 *                               1762214400000 and LIVE in nonprod. `role_capabilities` is still
 *                               (tenant_id, role_id, capability_id) with no condition column — the
 *                               condition lives in its own relation, never on the grant row.
 *   which Role granted the key  WAS: discarded by SELECT DISTINCT c.key.
 *                               NOW: capabilityAuthority.roleCapabilityGrants keeps the Role KEY, and
 *                               resolveOperationalContext carries the resulting entitlements onto
 *                               ResolvedOperationalContext beside the unchanged flat set.
 *   a per-grant evaluation slot WAS: absent — predicates attached to the ACTION, and authorizeAnyPath
 *                               unions paths for ONE actor, so an unconditioned path beside a
 *                               conditioned one allows every holder.
 *                               NOW: conditionalEntitlement.authorizeEntitledAction evaluates each
 *                               ENTITLEMENT separately, so Role A unconditional and Role B
 *                               conditional on the same key coexist.
 *
 * THE ACTION-LEVEL GAP IS NOT CLOSED, and is not meant to be: an action-level predicate still
 * constrains every holder of the key, which is why the two Purchase Order cells stay withheld from
 * THIS registry for good. `status` below describes the GRANT-level model, which is where the sentence
 * became sayable.
 */
export const CONDITIONAL_ENTITLEMENT_MODEL = Object.freeze({
  status: "CLOSED_AT_GRANT_LEVEL" as const,
  code: "CONDITIONAL_ENTITLEMENT_MODEL_GAP" as const,
  /** What each of the three missing inputs was replaced by. Empty `missing` is the point. */
  missing: Object.freeze([] as readonly string[]),
  closedBy: Object.freeze([
    "eos_policy.capability_grant_conditions (migration 1762214400000, applied 2026-09-24, 0 rows)",
    "capabilityAuthority.roleCapabilityGrants keeps the granting Role key",
    "conditionalEntitlement.authorizeEntitledAction evaluates one condition per ENTITLEMENT",
  ]),
  /** Still true, and deliberately so. */
  stillTrueOfActionLevelPolicies: Object.freeze([
    "predicates attach to the action; authorizeAnyPath unions paths for one actor",
  ]),
});

export interface ContextualActionDecision {
  readonly allowed: boolean;
  readonly outcome: ContextualActionOutcome;
  /** Which predicate refused. Absent when the capability itself was missing or nothing was evaluated. */
  readonly predicate?: ContextPredicateKind;
  readonly detail?: string;
  /**
   * Whether any context authority was consulted. FALSE for an unconditioned action and false for a
   * missing capability — both are decided before a governed table is read, and a test can prove it.
   */
  readonly contextEvaluated: boolean;
}

export interface ContextualActionRequest {
  readonly actor: ContextualActor;
  readonly capabilityKey: string;
  /** The governed record id, when the action is about one. The KIND comes from the policy. */
  readonly recordId?: string;
}

const decide = (
  allowed: boolean,
  outcome: ContextualActionOutcome,
  contextEvaluated: boolean,
  predicate?: ContextPredicateKind,
  detail?: string,
): ContextualActionDecision => Object.freeze({ allowed, outcome, predicate, detail, contextEvaluated });

/** Does this action declare a context policy at all? */
export function requiresContext(
  capabilityKey: string,
  registry: ActionContextRegistry = ACTION_CONTEXT_POLICIES,
): boolean {
  return registry.has(capabilityKey);
}

const needsRecord = (policy: ActionContextPolicy): boolean =>
  policy.paths.some((path) => path.some((p) => p.kind === "RECORD_ASSIGNMENT"));

/**
 * Authorize one action for one already-resolved actor.
 *
 * ORDER, and every step of it is observable in the returned decision:
 *
 *   1  capability, from the effective set the runtime resolved. Refuses without reading anything.
 *   2  policy lookup. No policy -> ALLOWED, and no context authority is touched.
 *   3  record: required by the policy, supplied by the caller as an ID only, kind fixed by policy.
 *   4  the predicates, through the evaluator, on alternative paths.
 *
 * Nothing about the actor is caller-supplied: `capabilities` came from role_capabilities, the
 * Employee from employee_principal_links, eligibility/scope/assignment from their own tables.
 */
export async function authorizeContextualAction(
  reader: ContextualReader,
  request: ContextualActionRequest,
  registry: ActionContextRegistry = ACTION_CONTEXT_POLICIES,
): Promise<ContextualActionDecision> {
  const { actor, capabilityKey } = request;

  // 1. CAPABILITY FIRST — before the registry is even consulted, so the refusal is byte-identical
  //    whether or not this action happens to be conditioned. A caller without authority learns only
  //    that they lack the capability.
  if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(capabilityKey)) {
    return decide(false, "CAPABILITY_MISSING", false, undefined, capabilityKey);
  }

  // 2. UNCONDITIONED STAYS UNCONDITIONED.
  const policy = registry.get(capabilityKey);
  if (!policy || policy.paths.length === 0) return decide(true, "ALLOWED", false);

  // 3. The record, when the policy needs one. A policy that asks about a record and is given none
  //    refuses; it does not fall through to "then it must be fine".
  let record: RecordContext | undefined;
  if (needsRecord(policy)) {
    if (!policy.recordKind) {
      return decide(false, "NOT_ASSIGNED", false, "RECORD_ASSIGNMENT", "policy declares no record kind");
    }
    if (typeof request.recordId !== "string" || request.recordId.trim() === "") {
      return decide(false, "NOT_ASSIGNED", false, "RECORD_ASSIGNMENT", "no record supplied");
    }
    record = { recordKind: policy.recordKind, recordId: request.recordId };
  }

  // 4. The context authority. A failure to ANSWER is a refusal, never an exception and never a pass.
  try {
    const decision = await authorizeAnyPath(reader, {
      actor,
      capabilityKey,
      paths: policy.paths,
      record,
    });
    return decide(decision.allowed, decision.reason, true, decision.predicate, decision.detail);
  } catch {
    return decide(false, "CONTEXT_AUTHORITY_UNAVAILABLE", true, undefined,
      "the contextual authority could not be consulted");
  }
}

/**
 * The same decision, for a caller holding what `resolveOperationalContext` returned.
 *
 * This is the shape the five EOS transports already have in hand after
 * `resolveOperationalContext(deps.reader, deps.pool, ...)`, so adopting the seam in a transport or
 * kernel is one call and no new resolution.
 */
export async function authorizeResolvedAction(
  db: Pool | Pick<PoolClient, "query">,
  resolved: ResolvedOperationalContext,
  request: Omit<ContextualActionRequest, "actor">,
  registry: ActionContextRegistry = ACTION_CONTEXT_POLICIES,
): Promise<ContextualActionDecision> {
  const actor: ContextualActor = {
    tenantId: resolved.principalContext.tenantId,
    principalId: resolved.principalContext.uid,
    capabilities: resolved.capabilities,
  };
  return authorizeContextualAction(postgresContextualReader(db as Pick<PoolClient, "query">), { ...request, actor }, registry);
}

/**
 * Build a registry. Exists so a test — or a future governed activation step — supplies policies
 * explicitly rather than mutating the shipped one, which is frozen and must stay empty until an
 * action is activated on its own evidence.
 */
export function actionContextRegistry(policies: readonly ActionContextPolicy[]): ActionContextRegistry {
  const map = new Map<string, ActionContextPolicy>();
  for (const policy of policies) {
    if (isWithheldConditionedCell(policy.capabilityKey)) {
      // Not advice. A cell the Owner withheld cannot be registered by anybody, including a test that
      // thought it was only proving a shape.
      throw new Error(`${policy.capabilityKey} is a WITHHELD conditioned cell and may not carry an action-level policy`);
    }
    map.set(policy.capabilityKey, policy);
  }
  return Object.freeze(map);
}
