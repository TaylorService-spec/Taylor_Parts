// Publish validation for a workflow version -- FAIL CLOSED, with stable machine codes.
//
// A version that cannot describe a runnable, AUTHORIZABLE process is refused at publication rather
// than discovered by the first record that gets stuck in it, or -- worse -- by the first principal
// who is bound to an action nothing authorizes. Every ERROR blocks publish. WARNINGs are shown to
// the administrator and never block.
//
// ════════════════════ THE CODES ════════════════════
//
//   NO_START_STATE              no initial step
//   MULTIPLE_START_STATES       more than one initial step
//   NO_TERMINAL_STATE           no terminal step: an instance could never finish
//   INVALID_TRANSITION          an action from/to an unknown step, or leaving a terminal step
//   UNREACHABLE_STEP            a step no path from the start reaches
//   INVALID_OBJECT              the workflow governs no Object, or one this tenant does not have
//   ACTION_WITHOUT_CAPABILITY   an action names no capability -- nothing could authorize it
//   UNKNOWN_CAPABILITY          an action names a capability the catalog does not have, or one the
//                               catalog marks SUPERSEDED ("must not be granted again")
//   BINDING_WITHOUT_CAPABILITY  a Role is bound to an action whose capability that Role does NOT
//                               hold. A binding never grants, so the binding is stale; publishing it
//                               would present an authority the runtime will refuse
//   UNKNOWN_ROLE                a binding names a Role this tenant does not have
//   UNSUPPORTED_BINDING_KIND    a FUNCTIONAL_ROLE binding (documented extension point; no evaluator)
//   BINDING_UNKNOWN_ACTION      a binding names an action the version does not have
//   INVALID_GUARD               a guard outside the closed list, or RECORD_ASSIGNMENT on an Object
//                               the evaluator has no assignment relation for
//   MISSING_REQUIRED_GUARD      the runtime REQUIRES a guard for this capability
//                               (LIFECYCLE_CONTEXT_PREDICATES) and the action does not declare it
//
//   WARNING CAPABILITY_HOLDER_NOT_BOUND  Roles hold the action's capability but are not bound, so
//                                        the workflow is narrower than the security policy
//   WARNING ACTION_WITHOUT_BINDING       nobody is bound; the action is inert until someone is
//   WARNING DEAD_END_STEP                a non-terminal step with no outgoing action
//
// Pure: the caller supplies the definition and the tenant facts (Objects, catalog, Roles, grants).
import { LIFECYCLE_CONTEXT_PREDICATES } from "../eosOps/workOrderLifecycle";
import { isAssignmentRecordKind } from "./workflowAuthority";
import { WORKFLOW_GUARD_KINDS } from "./types";
import type { PolicyReader } from "./policyRepository";
import type { TenantId } from "./types";
import type { WorkflowVersionDefinition } from "./workflowEngine";

export const WORKFLOW_VALIDATION_ERROR_CODES = Object.freeze([
  "NO_START_STATE",
  "MULTIPLE_START_STATES",
  "NO_TERMINAL_STATE",
  "INVALID_TRANSITION",
  "UNREACHABLE_STEP",
  "INVALID_OBJECT",
  "ACTION_WITHOUT_CAPABILITY",
  "UNKNOWN_CAPABILITY",
  "BINDING_WITHOUT_CAPABILITY",
  "UNKNOWN_ROLE",
  "UNSUPPORTED_BINDING_KIND",
  "BINDING_UNKNOWN_ACTION",
  "INVALID_GUARD",
  "MISSING_REQUIRED_GUARD",
] as const);
export const WORKFLOW_VALIDATION_WARNING_CODES = Object.freeze([
  "CAPABILITY_HOLDER_NOT_BOUND",
  "ACTION_WITHOUT_BINDING",
  "DEAD_END_STEP",
] as const);

export type WorkflowValidationCode =
  | (typeof WORKFLOW_VALIDATION_ERROR_CODES)[number]
  | (typeof WORKFLOW_VALIDATION_WARNING_CODES)[number];

export interface WorkflowValidationIssue {
  readonly code: WorkflowValidationCode;
  readonly severity: "ERROR" | "WARNING";
  readonly message: string;
  readonly stepKey?: string;
  readonly actionKey?: string;
  readonly roleKey?: string;
  readonly roleKeys?: readonly string[];
  readonly capabilityKey?: string;
}

export interface WorkflowValidationResult {
  readonly valid: boolean;
  readonly errors: readonly WorkflowValidationIssue[];
  readonly warnings: readonly WorkflowValidationIssue[];
}

/**
 * The guards the RUNTIME requires for a capability, derived from the evaluator's own policy
 * (LIFECYCLE_CONTEXT_PREDICATES) rather than restated. A workflow that let a technician complete a
 * Work Order without the assignment guard would describe an authority the command path refuses.
 */
export const REQUIRED_GUARD_BY_CAPABILITY: Readonly<Record<string, "RECORD_ASSIGNMENT">> = Object.freeze(
  Object.fromEntries(
    Object.entries(LIFECYCLE_CONTEXT_PREDICATES)
      .filter(([, predicates]) => predicates.some((p) => p.kind === "RECORD_ASSIGNMENT"))
      .map(([capability]) => [capability, "RECORD_ASSIGNMENT" as const]),
  ),
);

/** A definition in validation form: Role KEYS (null = a binding whose Role id this tenant lacks). */
export interface WorkflowDefinitionView {
  readonly objectKey: string | null;
  readonly steps: readonly { readonly key: string; readonly initial: boolean; readonly terminal: boolean }[];
  readonly actions: readonly {
    readonly key: string;
    readonly from: string;
    readonly to: string;
    readonly capabilityKey: string | null;
    readonly guardKind: string | null;
  }[];
  readonly bindings: readonly {
    readonly actionKey: string;
    readonly roleKey: string | null;
    readonly roleRef: string;
    readonly bindingKind: string;
  }[];
}

/** The tenant facts a definition is validated against. */
export interface WorkflowValidationContext {
  readonly objectKeys: ReadonlySet<string>;
  /** capability key -> whether the catalog marks it SUPERSEDED. */
  readonly capabilities: ReadonlyMap<string, { readonly superseded: boolean }>;
  readonly roleKeys: ReadonlySet<string>;
  /** Role key -> the capability keys that Role holds in this tenant (role_capabilities). */
  readonly roleCapabilities: ReadonlyMap<string, ReadonlySet<string>>;
}

const issue = (code: WorkflowValidationCode, message: string, extra: Partial<WorkflowValidationIssue> = {}): WorkflowValidationIssue =>
  Object.freeze({
    code,
    severity: (WORKFLOW_VALIDATION_WARNING_CODES as readonly string[]).includes(code) ? "WARNING" : "ERROR",
    message,
    ...extra,
  } as WorkflowValidationIssue);

export function validateWorkflowDefinition(
  definition: WorkflowDefinitionView,
  context: WorkflowValidationContext,
): WorkflowValidationResult {
  const out: WorkflowValidationIssue[] = [];
  const stepKeys = new Set(definition.steps.map((s) => s.key));
  const terminal = new Set(definition.steps.filter((s) => s.terminal).map((s) => s.key));

  // ── the Object ──
  if (!definition.objectKey || !context.objectKeys.has(definition.objectKey)) {
    out.push(issue("INVALID_OBJECT", definition.objectKey
      ? `the workflow governs "${definition.objectKey}", which is not an Object in this tenant`
      : "the workflow governs no Object"));
  }

  // ── start and end ──
  const initial = definition.steps.filter((s) => s.initial);
  if (initial.length === 0) out.push(issue("NO_START_STATE", "no initial step: an instance would have nowhere to start"));
  if (initial.length > 1) {
    out.push(issue("MULTIPLE_START_STATES", `${initial.length} initial steps: an instance's start would be ambiguous`));
  }
  for (const s of definition.steps) {
    if (s.initial && s.terminal) out.push(issue("INVALID_TRANSITION", `step "${s.key}" is both initial and terminal`, { stepKey: s.key }));
  }
  if (terminal.size === 0) out.push(issue("NO_TERMINAL_STATE", "no terminal step: an instance could never finish"));

  // ── transitions ──
  for (const a of definition.actions) {
    if (!stepKeys.has(a.from)) out.push(issue("INVALID_TRANSITION", `action "${a.key}" comes from unknown step "${a.from}"`, { actionKey: a.key }));
    if (!stepKeys.has(a.to)) out.push(issue("INVALID_TRANSITION", `action "${a.key}" goes to unknown step "${a.to}"`, { actionKey: a.key }));
    if (terminal.has(a.from)) out.push(issue("INVALID_TRANSITION", `action "${a.key}" leaves terminal step "${a.from}"`, { actionKey: a.key }));
  }

  // ── reachability, only meaningful with exactly one start ──
  if (initial.length === 1) {
    const reached = new Set<string>([initial[0].key]);
    const queue = [initial[0].key];
    while (queue.length > 0) {
      const from = queue.shift() as string;
      for (const a of definition.actions) {
        if (a.from === from && stepKeys.has(a.to) && !reached.has(a.to)) { reached.add(a.to); queue.push(a.to); }
      }
    }
    for (const s of definition.steps) {
      if (!reached.has(s.key)) out.push(issue("UNREACHABLE_STEP", `step "${s.key}" cannot be reached from "${initial[0].key}"`, { stepKey: s.key }));
    }
  }
  for (const s of definition.steps) {
    if (!s.terminal && !definition.actions.some((a) => a.from === s.key && a.to !== s.key)) {
      out.push(issue("DEAD_END_STEP", `step "${s.key}" is not terminal and has no action leaving it`, { stepKey: s.key }));
    }
  }

  // ── capability and guard per action ──
  const actionByKey = new Map(definition.actions.map((a) => [a.key, a]));
  for (const a of definition.actions) {
    const capabilityKey = a.capabilityKey;
    if (!capabilityKey) {
      out.push(issue("ACTION_WITHOUT_CAPABILITY", `action "${a.key}" names no capability, so nothing could authorize it`, { actionKey: a.key }));
    } else {
      const known = context.capabilities.get(capabilityKey);
      if (!known) {
        out.push(issue("UNKNOWN_CAPABILITY", `action "${a.key}" names "${capabilityKey}", which is not in the capability catalog`, { actionKey: a.key, capabilityKey }));
      } else if (known.superseded) {
        out.push(issue("UNKNOWN_CAPABILITY", `action "${a.key}" names "${capabilityKey}", which the catalog marks SUPERSEDED`, { actionKey: a.key, capabilityKey }));
      }
    }
    if (a.guardKind !== null && a.guardKind !== undefined) {
      if (!(WORKFLOW_GUARD_KINDS as readonly string[]).includes(a.guardKind)) {
        out.push(issue("INVALID_GUARD", `action "${a.key}" declares guard "${a.guardKind}", which is not an evaluator primitive`, { actionKey: a.key }));
      } else if (a.guardKind === "RECORD_ASSIGNMENT" && !isAssignmentRecordKind(definition.objectKey)) {
        out.push(issue("INVALID_GUARD", `action "${a.key}" declares RECORD_ASSIGNMENT, but "${definition.objectKey ?? "(none)"}" has no assignment relation the evaluator can answer`, { actionKey: a.key }));
      }
    }
    const required = capabilityKey ? REQUIRED_GUARD_BY_CAPABILITY[capabilityKey] : undefined;
    if (required && a.guardKind !== required) {
      out.push(issue("MISSING_REQUIRED_GUARD", `action "${a.key}" uses "${capabilityKey}", which the runtime authorizes only with the ${required} guard`, { actionKey: a.key, capabilityKey: capabilityKey as string }));
    }
  }

  // ── bindings ──
  for (const b of definition.bindings) {
    const action = actionByKey.get(b.actionKey);
    if (!action) {
      out.push(issue("BINDING_UNKNOWN_ACTION", `a binding names action "${b.actionKey}", which this version does not have`, { actionKey: b.actionKey }));
      continue;
    }
    if (b.bindingKind !== "SECURITY_ROLE") {
      out.push(issue("UNSUPPORTED_BINDING_KIND", `action "${b.actionKey}" has a ${b.bindingKind} binding; only SECURITY_ROLE is evaluable today`, { actionKey: b.actionKey }));
      continue;
    }
    if (b.roleKey === null || !context.roleKeys.has(b.roleKey)) {
      out.push(issue("UNKNOWN_ROLE", `action "${b.actionKey}" is bound to Role "${b.roleKey ?? b.roleRef}", which this tenant does not have`, { actionKey: b.actionKey, roleKey: b.roleKey ?? b.roleRef }));
      continue;
    }
    const capabilityKey = action.capabilityKey;
    if (capabilityKey && context.capabilities.has(capabilityKey)
        && !(context.roleCapabilities.get(b.roleKey)?.has(capabilityKey) ?? false)) {
      out.push(issue("BINDING_WITHOUT_CAPABILITY",
        `Role "${b.roleKey}" is bound to "${b.actionKey}" but does not hold "${capabilityKey}"; a binding never grants`,
        { actionKey: b.actionKey, roleKey: b.roleKey, capabilityKey }));
    }
  }

  // ── coverage warnings ──
  for (const a of definition.actions) {
    const bound = definition.bindings.filter((b) => b.actionKey === a.key && b.roleKey).map((b) => b.roleKey as string);
    if (bound.length === 0) {
      out.push(issue("ACTION_WITHOUT_BINDING", `action "${a.key}" has no Role bound; it is inert until one is`, { actionKey: a.key }));
    }
    if (!a.capabilityKey) continue;
    const holders = [...context.roleCapabilities.entries()]
      .filter(([roleKey, keys]) => keys.has(a.capabilityKey as string) && !bound.includes(roleKey))
      .map(([roleKey]) => roleKey)
      .sort();
    if (holders.length > 0) {
      out.push(issue("CAPABILITY_HOLDER_NOT_BOUND",
        `${holders.join(", ")} hold${holders.length === 1 ? "s" : ""} "${a.capabilityKey}" but ${holders.length === 1 ? "is" : "are"} not bound to "${a.key}"`,
        { actionKey: a.key, capabilityKey: a.capabilityKey, roleKeys: holders }));
    }
  }

  const errors = out.filter((i) => i.severity === "ERROR");
  const warnings = out.filter((i) => i.severity === "WARNING");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
}

/** A catalog description that marks the key retired ("SUPERSEDED by ..."). */
export const isSupersededCapabilityDescription = (description: string | null | undefined): boolean =>
  typeof description === "string" && /^\s*SUPERSEDED\b/i.test(description);

/** Load the tenant facts validation needs, from the governed store. */
export async function loadWorkflowValidationContext(
  reader: PolicyReader,
  tenantId: TenantId,
): Promise<WorkflowValidationContext> {
  const [objects, catalog, roles, grants] = await Promise.all([
    reader.listObjects(tenantId), reader.listCapabilities(), reader.listRoles(tenantId), reader.listRoleCapabilities(tenantId),
  ]);
  const keyByCapabilityId = new Map(catalog.map((c) => [c.id, c.key]));
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const roleCapabilities = new Map<string, Set<string>>();
  for (const r of roles) roleCapabilities.set(r.key, new Set());
  for (const g of grants) {
    const roleKey = roleKeyById.get(g.roleId);
    const capabilityKey = keyByCapabilityId.get(g.capabilityId);
    if (roleKey && capabilityKey) roleCapabilities.get(roleKey)?.add(capabilityKey);
  }
  return {
    objectKeys: new Set(objects.map((o) => o.key)),
    capabilities: new Map(catalog.map((c) => [c.key, { superseded: isSupersededCapabilityDescription(c.description) }])),
    roleKeys: new Set(roles.map((r) => r.key)),
    roleCapabilities,
  };
}

/** A stored version, in validation form. A binding whose Role id is unknown keeps a null key. */
export async function storedDefinitionView(
  reader: PolicyReader,
  tenantId: TenantId,
  objectKey: string | null,
  definition: WorkflowVersionDefinition,
): Promise<WorkflowDefinitionView> {
  const roles = await reader.listRoles(tenantId);
  const keyById = new Map(roles.map((r) => [r.id, r.key]));
  return {
    objectKey,
    steps: definition.steps.map((s) => ({ key: s.key, initial: s.initial, terminal: s.terminal })),
    actions: definition.actions.map((a) => ({
      key: a.key, from: a.fromStepKey, to: a.toStepKey,
      capabilityKey: a.capabilityKey ?? null,
      guardKind: a.guardKind ?? (a.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
    })),
    bindings: definition.bindings.map((b) => ({
      actionKey: b.actionKey, roleKey: keyById.get(b.roleId) ?? null, roleRef: b.roleId,
      bindingKind: b.bindingKind ?? "SECURITY_ROLE",
    })),
  };
}
