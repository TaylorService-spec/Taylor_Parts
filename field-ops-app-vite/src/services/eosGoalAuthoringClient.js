// PERFORMANCE GOAL AUTHORING, FROM THE BROWSER (G-1; DECISIONS #G-1; resolves OD-B4-3).
//
//   browser -> THIS -> POST /operations/inventory: listGoalAuthoringOptions / createPerformanceGoalDraft / approvePerformanceGoal / retirePerformanceGoal
//   (+ the existing reads listPerformanceGoalVersions through services/eosRecordsClients.js)
//   -> verified bearer -> EOS Principal + tenant + the VERB'S capability (performance.goal.*) + the caller's operating companies + the target's reach, the
//   self-targeting and the self-approval rules -> PostgreSQL (functions/src/eosOps/performanceGoalAuthoring.ts)
//
// THE CLIENT DECIDES NOTHING. It names no capability and trusts no flag it computed itself: every call re-decides on the server, and the pickers offer
// exactly what the server's own options read states. A GOVERNED refusal (denied / not found / invalid / conflict / precondition) carries the command's own
// sentence; any other failure -- an internal error, an unreachable service -- is a bounded word with NO server text.
//
// The idempotencyKey is the CALLER'S and travels verbatim, so a retry after a lost response is answered `replayed` and writes nothing. A caller keeps ONE key per
// submission attempt (newIdempotencyKey) and reuses it until the attempt is answered.
import { createPerformanceGoalClient } from "./eosRecordsClients.js";

// The transport is imported LAZILY, on the first real call (reorderApiClient.js reaches the token seam); this module stays importable and unit-testable
// without initializing anything.
const callReorderApi = async (...args) => (await import("./reorderApiClient.js")).callReorderApi(...args);

export const GOAL_AUTHORING_OPERATIONS = Object.freeze({
  options: "listGoalAuthoringOptions",
  create: "createPerformanceGoalDraft",
  approve: "approvePerformanceGoal",
  retire: "retirePerformanceGoal",
});

export const GOAL_OUTCOME = Object.freeze({
  DENIED: "denied", NOT_FOUND: "not-found", INVALID: "invalid", CONFLICT: "conflict", UNAUTHENTICATED: "unauthenticated", UNAVAILABLE: "unavailable",
});

const OUTCOME_BY_FAILURE = Object.freeze({
  NOT_SIGNED_IN: GOAL_OUTCOME.UNAUTHENTICATED,
  UNAUTHENTICATED: GOAL_OUTCOME.UNAUTHENTICATED,
  FORBIDDEN: GOAL_OUTCOME.DENIED,
  INVALID_INPUT: GOAL_OUTCOME.INVALID,
  NOT_FOUND: GOAL_OUTCOME.NOT_FOUND,
  CONFLICT: GOAL_OUTCOME.CONFLICT,
  PRECONDITION_FAILED: GOAL_OUTCOME.CONFLICT,
});
const GOVERNED = new Set([GOAL_OUTCOME.DENIED, GOAL_OUTCOME.NOT_FOUND, GOAL_OUTCOME.INVALID, GOAL_OUTCOME.CONFLICT]);

/** A failed call -> `{ ok: false, outcome, reason, message? }`. `message` is present ONLY for a governed refusal. Pure; exported for tests. */
export function goalFailure(res) {
  const outcome = Object.prototype.hasOwnProperty.call(OUTCOME_BY_FAILURE, res?.code) ? OUTCOME_BY_FAILURE[res.code] : GOAL_OUTCOME.UNAVAILABLE;
  const governed = GOVERNED.has(outcome) && typeof res?.message === "string" && res.message !== "";
  return Object.freeze({ ok: false, outcome, reason: typeof res?.reason === "string" ? res.reason : null, ...(governed ? { message: res.message } : {}) });
}

/** One key per submission attempt. Random where the platform has it; the caller reuses it until the attempt is answered. */
export const newIdempotencyKey = (prefix = "goal") =>
  `${prefix}-${typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

async function callOp(operation, input, call) {
  try {
    return await call(operation, input);
  } catch {
    return { ok: false, code: "UNREACHABLE" };
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const UNAVAILABLE = () => Object.freeze({ ok: false, outcome: GOAL_OUTCOME.UNAVAILABLE, reason: null });
const INVALID = () => Object.freeze({ ok: false, outcome: GOAL_OUTCOME.INVALID, reason: null });

/** @param {{ call?: typeof callReorderApi, reads?: ReturnType<typeof createPerformanceGoalClient> }} [deps] injectable transport (tests) */
export function createGoalAuthoringClient({ call = callReorderApi, reads = createPerformanceGoalClient({ call }) } = {}) {
  return Object.freeze({
    /** What this caller may author: { principalId, verbs, metrics, companies, warehouses, employeeIds }. A malformed answer is UNAVAILABLE. */
    async loadOptions() {
      const res = await callOp(GOAL_AUTHORING_OPERATIONS.options, {}, call);
      if (!res.ok) return goalFailure(res);
      const r = res.result;
      return isObject(r) && isObject(r.verbs) && Array.isArray(r.metrics) && Array.isArray(r.companies) && Array.isArray(r.warehouses) && Array.isArray(r.employeeIds)
        ? Object.freeze({ ok: true, options: r }) : UNAVAILABLE();
    },

    /** Every version of ONE target, oldest first (the existing read). */
    async listVersions(target) {
      const out = await reads.fetchPerformanceGoalVersions(target);
      if (out?.result && Array.isArray(out.result.versions)) return Object.freeze({ ok: true, versions: out.result.versions });
      return out?.errorStatus === "denied" ? Object.freeze({ ok: false, outcome: GOAL_OUTCOME.DENIED, reason: null }) : UNAVAILABLE();
    },

    /**
     * Author a DRAFT. `supersedesGoalId` names the approved version this one replaces (a different capability on the server). Malformed input is refused HERE
     * without a call. The goal id and the version are the server's.
     */
    async createDraft({ metricId, targetScopeType, targetScopeId = null, targetValue, unit, direction, currency = null, effectiveFrom, effectiveTo = null, supersedesGoalId = null, idempotencyKey }) {
      if (typeof metricId !== "string" || metricId === "" || typeof targetScopeType !== "string" || targetScopeType === ""
        || !Number.isSafeInteger(targetValue) || targetValue < 0 || typeof unit !== "string" || typeof direction !== "string"
        || typeof effectiveFrom !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || typeof idempotencyKey !== "string" || idempotencyKey === "") {
        return INVALID();
      }
      const input = {
        metricId, targetScopeType, targetValue, unit, direction, effectiveFrom, idempotencyKey,
        ...(targetScopeId ? { targetScopeId } : {}), ...(currency ? { currency } : {}), ...(effectiveTo ? { effectiveTo } : {}), ...(supersedesGoalId ? { supersedesGoalId } : {}),
      };
      const res = await callOp(GOAL_AUTHORING_OPERATIONS.create, input, call);
      if (!res.ok) return goalFailure(res);
      return isObject(res.result) && typeof res.result.goalId === "string" && Number.isSafeInteger(res.result.version)
        ? Object.freeze({ ok: true, goal: res.result, replayed: res.result.outcome === "replayed" }) : UNAVAILABLE();
    },

    /** Approve a DRAFT (never the author's own). A decision states its `reason`. */
    async approve({ goalId, reason, idempotencyKey }) {
      if (typeof goalId !== "string" || goalId === "" || !(typeof reason === "string" && reason.trim() !== "") || typeof idempotencyKey !== "string" || idempotencyKey === "") return INVALID();
      const res = await callOp(GOAL_AUTHORING_OPERATIONS.approve, { goalId, reason: reason.trim(), idempotencyKey }, call);
      if (!res.ok) return goalFailure(res);
      return isObject(res.result) && res.result.status === "APPROVED" ? Object.freeze({ ok: true, result: res.result, replayed: res.result.outcome === "replayed" }) : UNAVAILABLE();
    },

    /** Retire an APPROVED goal with no successor. A decision states its `reason`. */
    async retire({ goalId, reason, idempotencyKey }) {
      if (typeof goalId !== "string" || goalId === "" || !(typeof reason === "string" && reason.trim() !== "") || typeof idempotencyKey !== "string" || idempotencyKey === "") return INVALID();
      const res = await callOp(GOAL_AUTHORING_OPERATIONS.retire, { goalId, reason: reason.trim(), idempotencyKey }, call);
      if (!res.ok) return goalFailure(res);
      return isObject(res.result) && res.result.status === "RETIRED" ? Object.freeze({ ok: true, result: res.result, replayed: res.result.outcome === "replayed" }) : UNAVAILABLE();
    },
  });
}

export const goalAuthoringClient = createGoalAuthoringClient();
