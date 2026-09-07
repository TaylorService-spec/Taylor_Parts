// ADMINISTRATION USERS CONSOLIDATION -- the client SEAM for the Administration > Users callables:
// the two new ones (updateEmployeeProfile, listRecordChangeHistory) and the EXISTING setUserStatus,
// named here rather than reimplemented.
//
// Mirrors adminPasswordResetClient.js exactly, and for the same reasons: a deliberately THIN
// wrapper so `firebase` stays out of the unit tests, with every judgement (validation, diffing,
// what a failure MEANS) delegated to the pure modules in domain/. This file maps a rejection to an
// honest sanitized outcome and does nothing else.
//
// UNAVAILABLE-SAFE. None of them is deployed to production. They do NOT deny everywhere, and the
// sentence here that said so was stale: eos-platform-sandbox's admin persona has held
// `roleAssignments/bootstrap-admin-<uid>` since 2026-08-14, and the resolver returns ALLOW there.
// What is true of every environment is only that this seam never assumes either answer -- it asks
// and renders what comes back. When the callable is unreachable the SDK
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
// The EXISTING Issue #226 role-assignment command. Named here, not reimplemented.
const ASSIGN_ROLE_CALLABLE = "assignApprovedRole";
// The EXISTING revoke half of the same authority, and the trusted READ (Owner ruling 2026-09-06).
const REVOKE_ROLE_CALLABLE = "revokeRole";
const PRINCIPAL_ACCESS_CALLABLE = "readPrincipalAccessState";

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
    // `already-exists` covers a taken employee number and a reused request key. Both messages are
    // about what the CALLER submitted and both are actionable, so both are forwarded -- and neither
    // names another person or any server state. Mapping it to UNAVAILABLE (the old default) would
    // have told an administrator the service was down when the truth was a duplicate they can fix.
    case "already-exists":
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

/**
 * Assign one already-approved, non-privileged Role to a principal. Resolves (never rejects).
 *
 * The EXISTING `assignApprovedRole` trusted command -- the SINGLE-ADMIN path. It refuses any
 * privileged Role outright (that is grantRole's two-person route), resolves the roleId against its
 * own server-side allowlist, re-authorizes the caller on `admin.roleAssignment.write`, and writes
 * one audited roleAssignment. `actorUid` is derived server-side from the authenticated context and
 * is never sent from here, exactly as with the three commands above.
 *
 * `scope` is passed through rather than defaulted in this seam: what a Role means at global vs a
 * narrower scope is a governance question the command owns, and a default invented here would be
 * this file quietly making it.
 */
export async function assignApprovedRole({ principalUid, roleId, scope, idempotencyKey }) {
  try {
    const res = await httpsCallable(functions, ASSIGN_ROLE_CALLABLE)({
      principalUid,
      roleId,
      scope,
      idempotencyKey,
    });
    return {
      ok: true,
      result: ADMIN_USER_RESULT.APPLIED,
      assignmentId: res?.data?.assignmentId ?? null,
    };
  } catch (err) {
    return { ok: false, ...mapAdminUserError(err) };
  }
}

/**
 * Revoke ONE governed Role assignment by its assignment id. Resolves (never rejects).
 *
 * The EXISTING `revokeRole` trusted command. It takes an ASSIGNMENT id rather than a roleId
 * because a principal may hold the same Role more than once at different scopes -- "remove
 * salesperson" would be ambiguous, "remove this assignment" is not. That id comes from
 * readPrincipalAccessState below and from nowhere else on the client.
 *
 * `approverUid` exists on the command for PRIVILEGED revocations and is deliberately not passed
 * here: this seam serves the single-admin path only. A privileged revocation submitted without it
 * is refused server-side, which is the correct outcome rather than something to work around.
 */
export async function revokeRole({ assignmentId, idempotencyKey }) {
  try {
    await httpsCallable(functions, REVOKE_ROLE_CALLABLE)({ assignmentId, idempotencyKey });
    return { ok: true, result: ADMIN_USER_RESULT.APPLIED };
  } catch (err) {
    return { ok: false, ...mapAdminUserError(err) };
  }
}

/**
 * One principal's CURRENT access state -- account status and active governed Roles. Resolves
 * (never rejects).
 *
 * THE READ THIS SURFACE WAS MISSING. Every other function in this file writes; without this one
 * the record page could change a person's access and never show it, which is how "Account Status:
 * Not available" came to sit above two working Enable/Disable buttons.
 *
 * ABSENT IS NOT DENIED, and the caller must be able to tell them apart. On failure this returns
 * `state: null` alongside the mapped result, so the page can say "you may not read this" (DENIED)
 * or "this could not be read" (UNAVAILABLE) rather than rendering an empty Role list, which would
 * be a positive claim that the person holds none.
 */
export async function readPrincipalAccessState({ principalUid }) {
  try {
    const res = await httpsCallable(functions, PRINCIPAL_ACCESS_CALLABLE)({ principalUid });
    const data = res?.data ?? {};
    return {
      ok: true,
      state: {
        authExists: data.authExists === true,
        // Only the two values the contract defines survive; anything else becomes null rather
        // than being passed through to be rendered as a status word nobody defined.
        accountStatus:
          data.accountStatus === "enabled" || data.accountStatus === "disabled"
            ? data.accountStatus
            : null,
        assignments: Array.isArray(data.assignments) ? data.assignments : [],
      },
    };
  } catch (err) {
    return { ok: false, state: null, ...mapAdminUserError(err) };
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
  assignApprovedRole,
  revokeRole,
  readPrincipalAccessState,
  listRecordChangeHistory,
};
