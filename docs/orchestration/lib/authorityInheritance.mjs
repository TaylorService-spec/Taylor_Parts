// Constrained authority inheritance — the seam that makes "Owner approves intent ONCE → Agent Manager
// decomposes → children inherit constrained authority → EOS executes them" real and fail-closed.
//
// The Owner signs the PARENT intent once (profile + write scope + budget + capabilities + protected boundary).
// The Agent Manager then decomposes it into children. Each child does NOT get a fresh Owner approval; it
// inherits a grant that is a strict SUBSET of the parent's on every axis. A child that asks for MORE than the
// parent holds on ANY axis is REJECTED — never silently clamped, never escalated. No partial grant is emitted:
// a violated child yields NO authorized artifact, so EOS's existing gate can only ever execute children whose
// authority provably descends from the single parent approval.
//
// This is the governed INPUT to runAuthorizedWritesConcurrently: buildChildWorkItems mints child work artifacts
// already stamped EXECUTION_AUTHORIZED with basis "inherited from <parent>", so EOS executes them through the
// SAME per-item gate (authorizationState AUTHORIZED + status EXECUTION_AUTHORIZED + boundary) — the concurrency
// layer still authorizes nothing; the authority is the inherited, constrained grant.
//
// PURE: no I/O. deriveChildGrant validates one child ⊆ parent; buildChildWorkItems mints the artifacts (the
// caller commits them). Fail-closed everywhere: malformed parent/child, over-ask on any axis, or sibling budget
// over-allocation all reject.

import { PROFILE_NAMES, resolveExecutionProfile } from "./executionProfiles.mjs";
import { intakeDigest } from "./workIntake.mjs";

const normPath = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
// A child path is within the parent scope iff it equals a parent scope entry OR is under one at a SEGMENT
// boundary (parent `src/foo` covers `src/foo/bar.js`, but NOT `src/foobar.js`). A parent entry that is itself a
// concrete file covers only that file. Empty parent scope covers nothing (a child cannot inherit write scope
// the parent never held).
const withinScope = (childPath, parentScope) => {
  const c = normPath(childPath);
  return parentScope.some((s) => { const n = normPath(s); return c === n || c.startsWith(`${n}/`); });
};

const isNonNegFinite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Validate + derive a single child grant as a constrained subset of the parent. Returns
 * `{ ok:true, grant }` or `{ ok:false, violations:[...] }` — fail-closed, no partial grant on failure.
 *
 * @param {object} parent   { profile, scope:string[], budgetUsd, capabilities:string[], protectedBoundary,
 *                            workId }  — the single Owner-approved intent authority.
 * @param {object} request  { requestId, profile?, scope?:string[], budgetUsd?, capabilities?, protectedBoundary?,
 *                            title?, intent? } — what the decomposed child asks for.
 */
export function deriveChildGrant({ parent, request } = {}) {
  const v = [];
  // Parent must be well-formed, else nothing can safely inherit from it.
  if (!parent || typeof parent !== "object") return { ok: false, violations: ["parent grant is required"] };
  if (!PROFILE_NAMES.includes(parent.profile)) v.push(`parent profile invalid: ${parent.profile}`);
  const parentScope = Array.isArray(parent.scope) ? parent.scope.filter((s) => typeof s === "string") : [];
  const parentCaps = Array.isArray(parent.capabilities) ? parent.capabilities.filter((c) => typeof c === "string") : [];
  if (!isNonNegFinite(parent.budgetUsd)) v.push("parent budgetUsd must be a finite number ≥ 0");
  if (!request || typeof request !== "object" || !request.requestId) v.push("child request with requestId is required");
  if (v.length) return { ok: false, violations: v };

  // Axis 1 — PROFILE: reuse the proven two-key least-privilege resolver. A child requesting a higher rank than
  // the parent authorizes is denied (fail-closed to least-privilege), which we treat as a hard violation here.
  const prof = resolveExecutionProfile({ requestedProfile: request.profile || null, authorizedProfile: parent.profile });
  if (!prof.granted) v.push(`profile escalation denied: child requested ${request.profile || "default"} > parent ${parent.profile}`);

  // Axis 2 — SCOPE: every declared child write path must fall within the parent's declared scope. A child with
  // no declared writes (empty scope) is trivially within any parent (it inherits no write reach).
  const childScope = (Array.isArray(request.scope) ? request.scope.filter((s) => typeof s === "string") : []).map(normPath).filter(Boolean);
  const outside = childScope.filter((p) => !withinScope(p, parentScope));
  if (outside.length) v.push(`scope escapes parent: ${outside.join(", ")}`);

  // Axis 3 — BUDGET: child spend ≤ parent budget (single-child check; sibling-sum is enforced by the builder).
  const childBudget = request.budgetUsd ?? 0;
  if (!isNonNegFinite(childBudget)) v.push("child budgetUsd must be a finite number ≥ 0");
  else if (childBudget > parent.budgetUsd) v.push(`budget exceeds parent: ${childBudget} > ${parent.budgetUsd}`);

  // Axis 4 — CAPABILITIES: child capabilities ⊆ parent capabilities.
  const childCaps = Array.isArray(request.capabilities) ? request.capabilities.filter((c) => typeof c === "string") : [];
  const uncovered = childCaps.filter((c) => !parentCaps.includes(c));
  if (uncovered.length) v.push(`capabilities not held by parent: ${uncovered.join(", ")}`);

  // Axis 5 — PROTECTED BOUNDARY: STRICTLY inherited. The child's boundary is ALWAYS the parent's. A child may
  // never ADD one (parent none → child some), CLEAR one (parent some → child none), or CHANGE one (parent X →
  // child Y) — decomposition must not manufacture a boundary the parent did not carry, or "approve once" would
  // let new authority appear at decomposition time. A child that merely restates the parent's own boundary is
  // fine; any request that DIFFERS from the parent's boundary is rejected, fail-closed. (Narrowing WITHIN an
  // explicitly structured parent boundary model is a deliberate future seam — until such a model defines legal
  // sub-scopings, no narrowing is permitted, because we cannot prove it stays inside the parent.)
  const parentBoundary = parent.protectedBoundary ?? null;
  const reqBoundary = request.protectedBoundary ?? null;
  if (reqBoundary !== null && reqBoundary !== parentBoundary) {
    v.push(`child may not add/clear/change a protected boundary the parent did not carry: parent=${parentBoundary ?? "none"} child=${reqBoundary}`);
  }
  const protectedBoundary = parentBoundary; // exactly the parent's — never introduced by the child

  if (v.length) return { ok: false, violations: v };
  return {
    ok: true,
    grant: Object.freeze({
      requestId: request.requestId,
      profile: prof.profile,
      scope: Object.freeze(childScope),
      budgetUsd: childBudget,
      capabilities: Object.freeze(childCaps),
      protectedBoundary,
      inheritedFrom: parent.workId ?? null,
    }),
  };
}

/**
 * Decompose one Owner-approved parent intent into REAL emitted child work items, each carrying its inherited,
 * constrained grant and stamped EXECUTION_AUTHORIZED with basis "inherited from <parent>". Pure: returns the
 * artifacts; the caller commits them (the gated I/O step). Fail-closed: any child that over-asks on any axis is
 * rejected with its violations and gets NO artifact; if the ACCEPTED children's budgets sum beyond the parent's
 * budget, the whole decomposition is rejected (siblings cannot collectively exceed the single approval).
 *
 * @returns {{ ok:boolean, accepted:Array, rejected:Array, reason?:string }}
 */
export function buildChildWorkItems({ parent, requests = [], now = null } = {}) {
  const ts = now || "1970-01-01T00:00:00.000Z";
  const parentScope = Array.isArray(parent?.scope) ? parent.scope.filter((s) => typeof s === "string" && s) : [];
  const accepted = [];
  const rejected = [];
  for (const request of Array.isArray(requests) ? requests : []) {
    const derived = deriveChildGrant({ parent, request });
    if (!derived.ok) { rejected.push({ requestId: request?.requestId ?? null, violations: derived.violations }); continue; }
    accepted.push({ request, grant: derived.grant });
  }

  // Sibling budget guard: the children may not collectively spend more than the single parent approval.
  const totalChildBudget = accepted.reduce((sum, a) => sum + a.grant.budgetUsd, 0);
  if (isNonNegFinite(parent?.budgetUsd) && totalChildBudget > parent.budgetUsd) {
    return { ok: false, accepted: [], rejected, reason: `sibling budget over-allocation: ${totalChildBudget} > parent ${parent.budgetUsd}` };
  }

  // contextScope is the child's C-7 retrieval scope (NOT an authority axis): inherit the parent's when the child
  // doesn't declare its own. The intake schema requires it non-empty, as it does the work scope — a read-only
  // child (no declared WRITE scope) still operates within, so its artifact scope falls back to the parent's
  // approved scope (grant.scope ⊆ parent.scope, so the fallback is always within the single approval).
  const parentContextScope = Array.isArray(parent.contextScope) ? parent.contextScope.filter((s) => typeof s === "string" && s) : [];
  const artifacts = [];
  for (const { request, grant } of accepted) {
    const scope = grant.scope.length ? [...grant.scope] : [...parentScope];
    const contextScope = (Array.isArray(request.contextScope) ? request.contextScope.filter((s) => typeof s === "string" && s) : []);
    const effectiveContextScope = contextScope.length ? contextScope : parentContextScope;
    // Fail-closed: a work item with no scope or no C-7 context tag can't be a valid EOS artifact. Reject it
    // (surfacing why) rather than mint something the intake gate would reject downstream.
    if (!scope.length || !effectiveContextScope.length) {
      rejected.push({ requestId: grant.requestId, violations: [scope.length ? "contextScope is empty (declare it or set parent.contextScope)" : "scope is empty (declare child scope or parent scope)"] });
      continue;
    }
    const payload = {
      requestId: grant.requestId,
      title: request.title || `child of ${parent.workId ?? "intent"}`,
      intent: request.intent || "decomposed child of an Owner-approved intent",
      scope,
      contextScope: effectiveContextScope,
      source: { producer: "AgentManager/decomposition", provenance: `inherited from ${parent.workId ?? "parent"}` },
      status: "EXECUTION_AUTHORIZED",
      authority: {
        authorizationState: "AUTHORIZED",
        basis: `inherited from ${parent.workId ?? "parent"} (constrained subset)`,
        protectedBoundary: grant.protectedBoundary,
        profile: grant.profile,
        budgetUsd: grant.budgetUsd,
        capabilities: [...grant.capabilities],
        parentRef: parent.workId ?? null,
      },
      artifactLocation: `docs/orchestration/work-intake/${grant.requestId}.work.json`,
      createdAt: ts, updatedAt: ts, relatedRefs: { issues: [], pullRequests: [] },
    };
    artifacts.push(Object.freeze({ ...payload, sha256: intakeDigest(payload) }));
  }

  return { ok: true, accepted: Object.freeze(artifacts), rejected: Object.freeze(rejected) };
}
