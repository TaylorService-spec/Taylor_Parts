// THE ADMINISTRATION CONTROL PLANE -- pure presentation of the server's answers.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md (sections 3, 5, 8).
//
// ════════════════════ WHAT THIS MODULE MAY DO ════════════════════
//
//   * name a server enum in words (a grant `source`, an Effective Access `runtime` verdict)
//   * turn a condition form into the stored condition shape, and a stored condition into words
//   * regroup the server's rows for drawing (by Object), preserving every value it sent
//
// ════════════════════ WHAT IT MAY NEVER DO ════════════════════
//
// Decide access. There is no "can this Role..." helper here and there must never be one: the server's
// shared evaluator is the ONLY answer to "may this Role / Principal do this", and a client helper that
// looked like one would be a second authorization model. An Effective Access verdict is rendered as
// the server's word for it; an unknown verdict is shown RAW rather than guessed at.

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

// ════════════════════ CONDITION KINDS (contract section 5) ════════════════════
//
// A MIRROR of the contract's storable-kind table, used only to lay out the form. The server re-validates
// every condition with the builder the runtime uses; a kind marked supported here that the server
// refuses comes back as CONDITION_INVALID and is shown verbatim. When a payload carries the server's
// own `supportedConditionKinds`, that list wins (see `conditionKindsFor`).
export const CONDITION_KINDS = Object.freeze([
  Object.freeze({ kind: "RECORD_ASSIGNMENT", label: "Record assignment — the assigned Employee only", supported: true }),
  Object.freeze({ kind: "WORK_ELIGIBILITY", label: "Work Eligibility — holds a qualification", supported: true }),
  Object.freeze({ kind: "OPERATIONAL_SCOPE", label: "Operational Scope — scoped to a warehouse or queue", supported: true }),
  Object.freeze({ kind: "SELF", label: "Self", supported: false, why: "no evaluator" }),
  Object.freeze({ kind: "TEAM", label: "Team", supported: false, why: "no reportsTo edge is bindable" }),
  Object.freeze({ kind: "BUSINESS_UNIT", label: "Business unit", supported: false, why: "no evaluator" }),
  Object.freeze({ kind: "COMPANY", label: "Company", supported: false, why: "no evaluator" }),
]);

/** Governed record kinds a RECORD_ASSIGNMENT condition may name (grantConditionPolicy RECORD_KINDS). */
export const RECORD_KINDS = Object.freeze(["workOrder", "reorderRequest"]);
/** Work Eligibility codes (workEligibilityVocabulary.ts, CHECK-constrained). */
export const WORK_ELIGIBILITY_CODES = Object.freeze(["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS", "PARTS_OPERATIONS"]);
/** Operational Scope types (operationalScopeVocabulary.ts, CHECK-constrained). */
export const OPERATIONAL_SCOPE_TYPES = Object.freeze(["WAREHOUSE", "REORDER_QUEUE"]);

/**
 * The condition kinds to offer, each with `supported`. When the server reports its own list
 * (`supportedConditionKinds` on a payload) that list decides; otherwise the contract mirror does.
 */
export function conditionKindsFor(serverReported) {
  if (!Array.isArray(serverReported)) return CONDITION_KINDS;
  const reported = new Set(serverReported);
  const known = CONDITION_KINDS.map((k) => ({ ...k, supported: reported.has(k.kind), why: reported.has(k.kind) ? undefined : "not supported by the server" }));
  const extra = serverReported
    .filter((kind) => !CONDITION_KINDS.some((k) => k.kind === kind))
    .map((kind) => ({ kind, label: kind, supported: false, why: "this screen has no form for it yet" }));
  return [...known, ...extra];
}

/**
 * Build the stored condition shape `{ paths: [[predicate]], recordKind? }` from one form's values.
 * Returns null for an incomplete form (a missing required parameter) -- the submit stays disabled.
 * It does not judge whether the server will accept it.
 */
export function buildCondition(kind, params = {}) {
  switch (kind) {
    case "RECORD_ASSIGNMENT":
      if (!params.recordKind) return null;
      return { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: params.recordKind };
    case "WORK_ELIGIBILITY":
      if (!params.qualificationCode) return null;
      return { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: params.qualificationCode }]] };
    case "OPERATIONAL_SCOPE": {
      if (!params.scopeType) return null;
      const scopeId = typeof params.scopeId === "string" ? params.scopeId.trim() : "";
      return { paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: params.scopeType, ...(scopeId ? { scopeId } : {}) }]] };
    }
    default:
      return null;
  }
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
    default:
      return String(p.kind ?? "unknown predicate");
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

// ════════════════════ EFFECTIVE ACCESS (explainEffectiveAccess) ════════════════════

/** The server's runtime verdicts (contract section 8), in words. Unknown verdicts are shown raw. */
export const RUNTIME_VERDICT_LABEL = Object.freeze({
  ALLOWED: "Allowed",
  DENIED: "Denied",
  CONDITIONAL: "Conditional",
  WITHHELD_FROM_FLAT_KERNELS: "Withheld — held only through a conditioned grant",
  NOT_ENFORCED_DIRECT: "DIRECT EXCEPTION — not enforced by the main operational gates",
});

export function describeVerdict(verdict) {
  if (verdict === null || verdict === undefined) return "No verdict returned";
  return RUNTIME_VERDICT_LABEL[verdict] ?? String(verdict);
}

function grantorWords(grantor) {
  if (!grantor || typeof grantor !== "object") return "unknown grantor";
  if (grantor.kind === "ROLE") return `Security Role ${grantor.roleKey ?? "?"}`;
  if (grantor.kind === "PRINCIPAL") return `DIRECT EXCEPTION (${grantor.principalId ?? "principal"})`;
  return String(grantor.kind ?? "unknown grantor");
}

/**
 * Normalise the explain payload into rows for drawing -- WITHOUT re-deciding anything.
 *
 * Accepts `{ capabilities: [...] }`, `{ entries: [...] }` or a bare array. Each row keeps the server's
 * verdict (`runtime`, or `decision` per the pass-7 design) and its reason. Returns null for a payload
 * that is not the contract's shape.
 */
export function effectiveAccessRows(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.capabilities) ? payload.capabilities : Array.isArray(payload?.entries) ? payload.entries : null;
  if (!list) return null;
  if (list.some((row) => !row || typeof row !== "object" || typeof row.capabilityKey !== "string")) return null;
  return list.map((row) => {
    const via = Array.isArray(row.via) ? row.via : [];
    const sources = via.map((v) => ({
      words: grantorWords(v.grantor),
      direct: v.grantor?.kind === "PRINCIPAL",
      condition: v.condition ? describeCondition(v.condition) : null,
    }));
    const verdict = row.runtime ?? row.decision ?? null;
    return {
      capabilityKey: row.capabilityKey,
      objectKey: row.objectKey ?? null,
      actionKey: row.actionKey ?? null,
      displayLabel: row.displayLabel ?? null,
      verdict,
      verdictWords: describeVerdict(verdict),
      direct: verdict === "NOT_ENFORCED_DIRECT" || sources.some((s) => s.direct) || Boolean(row.directException),
      sources,
      scope: row.scope ?? null,
      why: row.why ?? row.reason ?? row.reasonCode ?? null,
    };
  });
}

/** Group effective-access rows by Object for drawing. */
export function groupByObject(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const key = row.objectKey ?? "(no object)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([objectKey, items]) => ({ objectKey, items }));
}
