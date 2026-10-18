// ADMINISTRATION USERS CONSOLIDATION -- the client SEAM for the Administration > Users callables that
// remain: the legacy audit read (listRecordChangeHistory) and the EXISTING User Access commands
// (setUserStatus, readPrincipalAccessState), named here rather than reimplemented.
//
// SECURITY ROLES ARE NOT HERE (Firebase exit B2). `assignApprovedRole` / `revokeRole` were unused by any screen since
// lane CP-C moved Role assignment to PostgreSQL `assignRole` / `revokeRole` (EmployeeSecurityRoles.jsx); their wrappers
// are removed so no screen can write the Firestore `roleAssignments` store by accident. In an EOS-only sign-in build NONE of
// this seam is reached: Users administration uses the EOS Sign-in section (login administration over /admin/policy).
//
// NO EMPLOYEE PROFILE WRITER LIVES HERE ANY MORE (EMP-RT-W1C). The `updateEmployeeProfile` callable
// wrote the retired Firestore employees record; PostgreSQL has been the Employee authority since the
// copy-once cutover, and the Administration editor now writes only through the governed Workforce
// commands (services/workforceApiClient.js). The wrapper was removed rather than left unused, so no
// screen can reach the retired writer by accident. The server-side callable itself is untouched by
// this seam and is retired separately.
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

const HISTORY_CALLABLE = "listRecordChangeHistory";
// The EXISTING Issue #226 trusted command. Named here, not reimplemented.
const STATUS_CALLABLE = "setUserStatus";
// The trusted READ (Owner ruling 2026-09-06).
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
    // `already-exists` covers a reused request key (and, on the retired profile callable, a taken
    // employee number). Such messages are about what the CALLER submitted and are actionable, so they
    // are forwarded -- and none names another person or any server state. Mapping it to UNAVAILABLE (the old default) would
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
  setUserStatus,
  readPrincipalAccessState,
  listRecordChangeHistory,
};
