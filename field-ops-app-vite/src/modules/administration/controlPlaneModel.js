// THE ADMINISTRATION CONTROL PLANE -- pure presentation of the server's answers.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md (sections 3, 5, 8).
//
// ════════════════════ WHAT THIS MODULE MAY DO ════════════════════
//
//   * name a server enum in words (a grant `source`, an Effective Access `result`)
//   * turn a condition form into the stored condition shape, and a stored condition into words
//   * regroup the server's rows for drawing (by Object), preserving every value it sent
//
// ════════════════════ WHAT IT MAY NEVER DO ════════════════════
//
// Decide access. There is no "can this Role..." helper here and there must never be one: the server's
// shared evaluator is the ONLY answer to "may this Role / Principal do this", and a client helper that
// looked like one would be a second authorization model. An Effective Access verdict is rendered as
// the server's word for it; an unknown result is shown RAW rather than guessed at. The condition
// vocabulary is the SERVER's (listSupportedConditionKinds); there is no local copy.

/** Where a Role x action cell's state came from (contract section 3 precedence, section 8 `source`). */
export const GRANT_SOURCE_LABEL = Object.freeze({
  SYSTEM_DEFAULT: "System default",
  ADMIN_GRANTED: "Admin granted",
  ADMIN_REVOKED: "Admin revoked",
  SYSTEM_INVARIANT: "System invariant — not grantable",
  DIRECT_EXCEPTION: "DIRECT EXCEPTION",
});

/** Words for a `source`; an unknown value is shown as itself, never mapped to a friendlier one. */
export function describeGrantSource(source) {
  if (source === null || source === undefined) return "Not held";
  return GRANT_SOURCE_LABEL[source] ?? String(source);
}

/** A SYSTEM_INVARIANT cell is refused on write by the server; the UI draws it as not grantable. */
export const isSystemInvariant = (cell) => cell?.source === "SYSTEM_INVARIANT";

// ════════════════════ CONDITION VOCABULARY -- THE SERVER'S, NEVER A LOCAL COPY ════════════════════
//
// The condition kinds, their parameters, the record kinds and the capabilities each kind may attach to
// come from the server's `listSupportedConditionKinds` read -- the same catalog its condition builder
// validates against. There is NO client mirror: when the read is not served (UNKNOWN_OPERATION) or
// fails, the picker is DISABLED and says why. A grant without a condition stays available.
//
// Accepted shape (either a bare array or `{ kinds: [...] }`), each kind:
//   { kind, label?, supported?, reason?, parameters?: [{ name, label?, required?, values? }],
//     recordKinds?: [...], capabilities?: [...] }
// `recordKinds` is folded in as a required `recordKind` parameter; `capabilities`, when present, limits
// the kind to those capability keys. A parameter named `recordKind` is stored on the condition, every
// other parameter on the predicate. A parameter with exactly one allowed value is filled automatically.

/** Normalise the server's kind catalog. Returns null for an unreadable payload (fail closed). */
export function conditionVocabularyFrom(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.kinds) ? payload.kinds : null;
  if (!list) return null;
  if (list.some((k) => !k || typeof k !== "object" || typeof k.kind !== "string")) return null;
  return list.map((k) => {
    const parameters = Array.isArray(k.parameters)
      ? k.parameters.filter((p) => p && typeof p.name === "string").map((p) => ({
        name: p.name,
        label: typeof p.label === "string" ? p.label : p.name,
        required: p.required !== false,
        values: Array.isArray(p.values) ? p.values : null,
      }))
      : [];
    if (Array.isArray(k.recordKinds) && !parameters.some((p) => p.name === "recordKind")) {
      parameters.push({ name: "recordKind", label: "Record kind", required: true, values: k.recordKinds });
    }
    return {
      kind: k.kind,
      label: typeof k.label === "string" ? k.label : k.kind,
      supported: k.supported !== false,
      why: typeof k.reason === "string" ? k.reason : k.supported === false ? "not supported by the server evaluator" : undefined,
      parameters,
      capabilities: Array.isArray(k.capabilities) ? k.capabilities : null,
    };
  });
}

/** The kind is offerable for this capability: supported, and (when the server scopes it) applicable. */
export function kindApplies(kindSpec, capabilityKey) {
  if (!kindSpec?.supported) return false;
  if (!kindSpec.capabilities || !capabilityKey) return true;
  return kindSpec.capabilities.includes(capabilityKey);
}

/** Single-value parameters, pre-filled; the form starts from these. */
export function initialConditionValues(kindSpec) {
  const values = {};
  for (const p of kindSpec?.parameters ?? []) if (p.values && p.values.length === 1) values[p.name] = p.values[0];
  return values;
}

/**
 * Build the stored condition shape `{ paths: [[predicate]], recordKind? }` from a server kind and the
 * form's values. Null while a required parameter is missing -- the submit stays disabled. It does not
 * judge whether the server will accept it.
 */
export function buildCondition(kindSpec, values = {}) {
  if (!kindSpec || !kindSpec.supported) return null;
  const merged = { ...initialConditionValues(kindSpec), ...values };
  const predicate = { kind: kindSpec.kind };
  let recordKind = null;
  for (const p of kindSpec.parameters) {
    const raw = merged[p.name];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === undefined || value === null || value === "") {
      if (p.required) return null;
      continue;
    }
    if (p.name === "recordKind") recordKind = value;
    else predicate[p.name] = value;
  }
  return { paths: [[predicate]], ...(recordKind ? { recordKind } : {}) };
}

function describePredicate(p, recordKind) {
  if (!p || typeof p !== "object") return "unreadable predicate";
  switch (p.kind) {
    case "RECORD_ASSIGNMENT":
      return `assigned Employee on the ${recordKind ?? "record"}`;
    case "WORK_ELIGIBILITY":
      return `Work Eligibility ${p.qualificationCode ?? "?"}`;
    case "OPERATIONAL_SCOPE":
      return `Operational Scope ${p.scopeType ?? "?"}${p.scopeId ? ` ${p.scopeId}` : ""}`;
    default: {
      const detail = Object.entries(p).filter(([k]) => k !== "kind").map(([k, v]) => `${k}=${v}`).join(", ");
      return `${String(p.kind ?? "unknown predicate")}${detail ? ` (${detail})` : ""}`;
    }
  }
}

/** A stored condition in words: paths are alternatives (OR), a path is an AND. */
export function describeCondition(condition) {
  if (!condition) return null;
  const inner = condition.condition && Array.isArray(condition.condition.paths) ? condition.condition : condition;
  if (!Array.isArray(inner.paths) || inner.paths.length === 0) return "unreadable condition";
  return inner.paths
    .map((path) => (Array.isArray(path) ? path.map((p) => describePredicate(p, inner.recordKind)).join(" AND ") : "unreadable path"))
    .join(" OR ");
}

/** A trimmed reason, or null. Used only to enable a submit button -- the server still requires one. */
export function statedReason(text) {
  const t = typeof text === "string" ? text.trim() : "";
  return t.length > 0 ? t : null;
}

// ════════════════════ OBJECT VIEW (getObjectActionGrantMatrix) ════════════════════

/**
 * The matrix's actions as ObjectSecurityActionList rows, keeping the server's cells beside them.
 * `roleKeys` are the HELD Role cells only; a revoked or invariant cell is a fact, not a holder.
 * Returns null for a payload that is not the contract's shape (fail closed, never "nobody holds it").
 */
export function matrixActionRows(matrix) {
  if (!matrix || typeof matrix !== "object" || !Array.isArray(matrix.actions)) return null;
  return matrix.actions.map((a) => {
    const roles = Array.isArray(a.roles) ? a.roles : [];
    const principals = Array.isArray(a.principals) ? a.principals : [];
    const held = roles.filter((r) => r.held === true);
    return {
      actionKey: a.actionKey,
      actionKind: a.actionKind ?? null,
      displayLabel: a.displayLabel ?? null,
      capabilityKey: a.capabilityKey ?? null,
      sourceLabel: a.actionKind ?? null,
      roleKeys: held.map((r) => r.roleKey),
      principalIds: principals.map((p) => p.principalId),
      granted: held.length + principals.length > 0,
      roles,
      principals,
    };
  });
}

// ════════════════════ ROLE VIEW (getSecurityRoleDetail) ════════════════════

/** The Role's actions grouped by Object, in the server's order. Null for an unreadable payload. */
export function roleActionsByObject(detail) {
  if (!detail || typeof detail !== "object" || !Array.isArray(detail.actions)) return null;
  const groups = new Map();
  for (const action of detail.actions) {
    const key = action.objectKey ?? "(no object)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(action);
  }
  return [...groups.entries()].map(([objectKey, actions]) => ({
    objectKey,
    actions,
    heldCount: actions.filter((a) => a.held).length,
  }));
}

// ════════════════════ EFFECTIVE ACCESS (explainEffectiveAccess, contract section 8) ════════════════════
//
// The served shape, rendered as-is:
//   { tenantId, principalId, securityRoleKeys, accessVersion,
//     assignments: { excluded: [{ assignmentId, roleKey, reason: STALE|INACTIVE|SCOPE_UNSUPPORTED, scopeType?, scopeValue? }],
//                    scoped: [{ assignmentId, roleKey, scopeType, scopeValue, capabilities, inertCapabilities }] },
//     scopedHeld: [{ capabilityKey, scopeType, scopeValue, sourceRole, conditioned }],
//     employeeId, workEligibility: [code], operationalScopes: [{ scopeType, scopeId }],
//     capabilities: [capabilityKey], surfaces: [surfaceKey],
//     actions: [{ objectKey, actionKey, actionKind, capabilityKey, result: ALLOWED|CONDITIONAL|SCOPED|DENIED, reasonCode,
//                 sourceRoles: [{ roleKey, condition|null }],
//                 scopedSources: [{ roleKey, scopeType, scopeValue, condition|null, result, reasonCode }],
//                 directGrant: { label: "DIRECT_EXCEPTION", exceptionReason, expiresAt, notEnforcedOnRoleOnlyRuntimePaths } | null,
//                 withheldFromFlatSetKernels, surfaces: [...], workflowSource: [{ workflowKey, version, actionKey, roleKey }] | null }] }

/** The evaluator's results in words. An unknown result is shown RAW, never mapped to a friendlier one. */
export const RESULT_LABEL = Object.freeze({
  ALLOWED: "Allowed",
  CONDITIONAL: "Conditional",
  // Lane SC: held only through a scoped Security Role assignment -- allowed only for records inside the scope.
  SCOPED: "Scoped",
  DENIED: "Denied",
});

export function describeResult(result) {
  if (result === null || result === undefined) return "No result returned";
  return RESULT_LABEL[result] ?? String(result);
}

/** Why an assignment grants nothing, in words (the reason code is shown beside it). */
export const EXCLUSION_LABEL = Object.freeze({
  STALE: "Stale — granted before the current access version",
  INACTIVE: "Inactive assignment",
  SCOPED: "Scoped — a scoped assignment grants nothing unscoped",
  // Lane SC: a scope the runtime does not decide (an unconsumed type, or no value) -- it grants nothing at all.
  SCOPE_UNSUPPORTED: "Scope not enforced by the runtime — this assignment grants nothing",
});

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/**
 * Normalise the explanation WITHOUT re-deciding anything. Returns null for a payload that is not the
 * contract's shape (fail closed): `actions` must be an array of objects each carrying a capabilityKey.
 */
export function explanationModel(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.actions)) return null;
  if (payload.actions.some((a) => !a || typeof a !== "object" || typeof a.capabilityKey !== "string")) return null;
  const excluded = Array.isArray(payload.assignments?.excluded) ? payload.assignments.excluded : [];
  return {
    principalId: payload.principalId ?? null,
    employeeId: payload.employeeId ?? null,
    accessVersion: payload.accessVersion ?? null,
    securityRoleKeys: strings(payload.securityRoleKeys),
    capabilities: strings(payload.capabilities),
    surfaces: strings(payload.surfaces),
    workEligibility: strings(payload.workEligibility),
    // EMPLOYEE FACTS (never a permission source): the linked Employee's CURRENT Functional Roles. Drawn as
    // facts only; nothing on the client derives access from them, and the server states grantsCapabilities:false.
    functionalRoles: Array.isArray(payload.employeeFacts?.functionalRoles)
      ? payload.employeeFacts.functionalRoles.filter((f) => f && typeof f === "object" && typeof f.key === "string")
      : [],
    operationalScopes: Array.isArray(payload.operationalScopes) ? payload.operationalScopes.filter((s) => s && typeof s === "object") : [],
    // Lane SC: supported scoped assignments -- what each grants WITHIN its scope and what stays not granted.
    scopedAssignments: (Array.isArray(payload.assignments?.scoped) ? payload.assignments.scoped : [])
      .filter((a) => a && typeof a === "object").map((a) => ({
        assignmentId: a.assignmentId ?? null,
        roleKey: a.roleKey ?? null,
        scope: describeScope(a.scopeType, a.scopeValue),
        capabilities: strings(a.capabilities),
        inertCapabilities: strings(a.inertCapabilities),
      })),
    excluded: excluded.filter((e) => e && typeof e === "object").map((e) => ({
      assignmentId: e.assignmentId ?? null,
      roleKey: e.roleKey ?? null,
      reason: e.reason ?? null,
      reasonWords: EXCLUSION_LABEL[e.reason] ?? String(e.reason ?? "unknown"),
      scope: e.scopeType ? `${e.scopeType}${e.scopeValue ? ` · ${e.scopeValue}` : ""}` : null,
    })),
    actions: payload.actions.map((a) => ({
      objectKey: a.objectKey ?? null,
      actionKey: a.actionKey ?? null,
      actionKind: a.actionKind ?? null,
      capabilityKey: a.capabilityKey,
      result: a.result ?? null,
      resultWords: describeResult(a.result),
      reasonCode: a.reasonCode ?? null,
      sourceRoles: (Array.isArray(a.sourceRoles) ? a.sourceRoles : []).map((r) => ({
        roleKey: r?.roleKey ?? null,
        condition: r?.condition ? describeCondition(r.condition) : null,
      })),
      scopedSources: (Array.isArray(a.scopedSources) ? a.scopedSources : []).filter((r) => r && typeof r === "object").map((r) => ({
        roleKey: r.roleKey ?? null,
        scope: describeScope(r.scopeType, r.scopeValue),
        condition: r.condition ? describeCondition(r.condition) : null,
        result: r.result ?? null,
        resultWords: describeResult(r.result),
        reasonCode: r.reasonCode ?? null,
      })),
      directGrant: a.directGrant && typeof a.directGrant === "object" ? {
        label: a.directGrant.label ?? "DIRECT_EXCEPTION",
        exceptionReason: a.directGrant.exceptionReason ?? null,
        expiresAt: a.directGrant.expiresAt ?? null,
        notEnforced: a.directGrant.notEnforcedOnRoleOnlyRuntimePaths === true,
      } : null,
      withheldFromFlatSetKernels: a.withheldFromFlatSetKernels === true,
      surfaces: strings(a.surfaces),
      workflowSource: Array.isArray(a.workflowSource) ? a.workflowSource : null,
    })),
  };
}

/** A scope as the server states it: "<type> = <value>", never re-labelled or re-derived here. */
export function describeScope(scopeType, scopeValue) {
  if (!scopeType) return null;
  return scopeValue ? `${scopeType} = ${scopeValue}` : String(scopeType);
}

/** Group explained actions by Object for drawing, in the server's order. */
export function groupByObject(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const key = row.objectKey ?? "(no object)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([objectKey, items]) => ({ objectKey, items }));
}
