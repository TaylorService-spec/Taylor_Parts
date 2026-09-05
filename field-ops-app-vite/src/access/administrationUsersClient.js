// ADMINISTRATION USERS CONSOLIDATION -- the client SEAM for the Administration > Users callables:
// the two new ones (updateEmployeeProfile, listRecordChangeHistory) and the EXISTING setUserStatus,
// named here rather than reimplemented.
//
// Mirrors adminPasswordResetClient.js exactly, and for the same reasons: a deliberately THIN
// wrapper so `firebase` stays out of the unit tests, with every judgement (validation, diffing,
// what a failure MEANS) delegated to the pure modules in domain/. This file maps a rejection to an
// honest sanitized outcome and does nothing else.
//
// UNAVAILABLE-SAFE. None of them is deployed to production, and all deny in every environment
// today (no principal holds a roleAssignments document). When the callable is unreachable the SDK
// rejects, and that resolves to an honest unavailable result -- never a simulated success, and
// never a client-direct write. There is no fallback path here that writes Firestore, because there
// is no such path to fall back to: employees is client-write-denied and auditEvents is
// client-read-denied by Rules.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const UPDATE_CALLABLE = "updateEmployeeProfile";
const HISTORY_CALLABLE = "listRecordChangeHistory";
// The EXISTING Issue #226 trusted command. Named here, not reimplemented.
const STATUS_CALLABLE = "setUserStatus";

/** The outcomes any caller of this seam must be able to render. */
export const ADMIN_USER_RESULT = Object.freeze({
  APPLIED: "APPLIED",
  UNCHANGED: "UNCHANGED",
  DENIED: "DENIED",
  INVALID: "INVALID",
  NOT_FOUND: "NOT_FOUND",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * Map a callable rejection to one of the outcomes above.
 *
 * `invalid-argument` is the ONE case whose server message is forwarded: the backend's adapter
 * maps only the caller's own input errors to that code, and those messages name a field the user
 * can actually fix. Every other code gets fixed copy, because the server's message for them is
 * either generic already or would leak resolver state if it were not.
 */
export function mapAdminUserError(err) {
  const code = String(err?.code ?? "").replace(/^functions\//, "");
  switch (code) {
    case "permission-denied":
    case "unauthenticated":
      return { result: ADMIN_USER_RESULT.DENIED, message: null };
    case "invalid-argument":
    case "failed-precondition":
      return { result: ADMIN_USER_RESULT.INVALID, message: err?.message ?? null };
    case "not-found":
      return { result: ADMIN_USER_RESULT.NOT_FOUND, message: null };
    default:
      return { result: ADMIN_USER_RESULT.UNAVAILABLE, message: null };
  }
}

/**
 * Save profile changes. Resolves (never rejects).
 *
 * `changes` is a field-key map; actorUid is derived server-side from the authenticated context and
 * is never sent from here.
 */
export async function updateEmployeeProfile({ employeeId, changes, idempotencyKey }) {
  try {
    const res = await httpsCallable(functions, UPDATE_CALLABLE)({ employeeId, changes, idempotencyKey });
    const status = res?.data?.status;
    return {
      ok: true,
      result: status === "unchanged" ? ADMIN_USER_RESULT.UNCHANGED : ADMIN_USER_RESULT.APPLIED,
      changedFields: Array.isArray(res?.data?.changedFields) ? res.data.changedFields : [],
    };
  } catch (err) {
    return { ok: false, ...mapAdminUserError(err) };
  }
}

/**
 * Enable or disable a principal's EOS account. Resolves (never rejects).
 *
 * The SAME `setUserStatus` trusted command that has been the authority for this since Issue #226 --
 * no second implementation, and no client-direct write to `users/{uid}` or to Firebase Auth, both
 * of which are denied to this client anyway. `status` is explicit rather than a toggle, which is
 * what lets the surface offer the action honestly without first knowing the account's current
 * state (a state no governed read exposes).
 */
export async function setUserStatus({ principalUid, status, idempotencyKey }) {
  try {
    const res = await httpsCallable(functions, STATUS_CALLABLE)({ principalUid, status, idempotencyKey });
    return { ok: true, result: ADMIN_USER_RESULT.APPLIED, status: res?.data?.status ?? null };
  } catch (err) {
    return { ok: false, ...mapAdminUserError(err) };
  }
}

/** One record's authoritative change history. Resolves (never rejects). */
export async function listRecordChangeHistory({ targetType, targetId, limit }) {
  try {
    const res = await httpsCallable(functions, HISTORY_CALLABLE)({ targetType, targetId, limit });
    return { ok: true, rows: Array.isArray(res?.data?.rows) ? res.data.rows : [] };
  } catch (err) {
    return { ok: false, ...mapAdminUserError(err) };
  }
}

/** The seam object the Users surfaces consume (injectable for tests). */
export const administrationUsersClient = {
  updateEmployeeProfile,
  setUserStatus,
  listRecordChangeHistory,
};
