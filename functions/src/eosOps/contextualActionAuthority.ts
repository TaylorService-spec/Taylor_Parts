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
  type AuthorizationReason,
  type ContextPredicate,
  type ContextPredicateKind,
  type ContextualActor,
  type ContextualReader,
  type RecordContext,
} from "./contextualAuthorization";
import type { ResolvedOperationalContext } from "./capabilityAuthority";

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

/**
 * (Role, capability) cells that MUST NOT be expressed as an action-level policy — Owner ruling.
 *
 * `reorder.purchaseOrder.read` is granted UNCONDITIONED to eleven Roles and conditioned only on
 * `technician`; `.create` to five unconditioned Roles and conditioned only on `technician`
 * (functions/migrations/1761696000000, grant block). Registering a WORK_ELIGIBILITY(PARTS_OPERATIONS)
 * policy for either ACTION would impose the technician's condition on all eleven and all five —
 * a narrowing of other Roles' grants, which is the opposite of preserving them. The two conditioned
 * cells stay WITHHELD until a grant-level model exists; see CONDITIONAL_ENTITLEMENT_MODEL.
 */
export const WITHHELD_CONDITIONED_CELLS: readonly string[] = Object.freeze([
  "reorder.purchaseOrder.read",
  "reorder.purchaseOrder.create",
]);

/**
 * WHY A ROLE-SELECTIVE CONDITION CANNOT BE EXPRESSED TODAY. Recorded in code because the reason is
 * structural and a future reader will otherwise rediscover it by trying.
 *
 * The three inputs a grant-level condition needs, and where each one is:
 *
 *   the condition itself        ONLY in the TypeScript catalog, as Role.conditionsByPermission.
 *                               eos_policy.role_capabilities is (tenant_id, role_id, capability_id)
 *                               with no condition column, and by Owner ruling a grant carries no
 *                               scope. There is no governed PostgreSQL row to read it from.
 *   which Role granted the key  DISCARDED. capabilitiesForRoleKeys selects DISTINCT c.key and
 *                               returns Set<string>; ContextualActor.capabilities is a flat set by
 *                               design, so provenance cannot be recovered downstream.
 *   a per-grant evaluation slot ABSENT. The evaluator attaches predicates to the ACTION, and
 *                               authorizeAnyPath is a UNION across paths for ONE actor: adding an
 *                               unconditioned path alongside a conditioned one allows EVERY holder,
 *                               so the two cannot coexist meaningfully at action level.
 *
 * Closing it is a schema change plus a resolver change, which is a migration — out of scope here,
 * and not something to approximate.
 */
export const CONDITIONAL_ENTITLEMENT_MODEL = Object.freeze({
  status: "GAP" as const,
  code: "CONDITIONAL_ENTITLEMENT_MODEL_GAP" as const,
  missing: Object.freeze([
    "eos_policy.role_capabilities has no condition column",
    "capabilitiesForRoleKeys returns SELECT DISTINCT c.key, discarding the granting Role",
    "predicates attach to the action; authorizeAnyPath unions paths for one actor",
  ]),
});

/** The seam's outcomes: the evaluator's vocabulary, plus ONE for "the authority could not answer". */
export type ContextualActionOutcome = AuthorizationReason | "CONTEXT_AUTHORITY_UNAVAILABLE";

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
    if (WITHHELD_CONDITIONED_CELLS.includes(policy.capabilityKey)) {
      // Not advice. A cell the Owner withheld cannot be registered by anybody, including a test that
      // thought it was only proving a shape.
      throw new Error(`${policy.capabilityKey} is a WITHHELD conditioned cell and may not carry an action-level policy`);
    }
    map.set(policy.capabilityKey, policy);
  }
  return Object.freeze(map);
}
