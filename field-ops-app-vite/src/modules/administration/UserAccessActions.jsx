import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminPasswordResetClient } from "../../access/adminPasswordResetClient";
import { administrationUsersClient } from "../../access/administrationUsersClient";
import { ASSIGNABLE_ROLE_OPTIONS, assignableRoleName } from "../../access/assignableRoles";
import {
  ACTION_PHASE,
  DEFAULT_MODE,
  ELIGIBILITY_REASON_COPY,
  beginConfirm,
  canInitiateAdminCredentialReset,
  cancelConfirm,
  createAdminResetController,
  deriveTargetEligibility,
  initialActionState,
  markSubmitting,
  settle,
} from "../../domain/adminPasswordReset";
import { RESET_ACTION_LABEL, RESET_CONFIRM_TITLE, resetStatusView } from "../../domain/adminUsersResetView";
import {
  employeeDisplayName,
  eosAccessState,
  newTrustedIdempotencyKey,
  EOS_ACCESS,
} from "../../domain/employeeProfile.js";

// USER DETAIL → EOS ACCESS & SECURITY → the two administrative actions.
//
// ════════════════════ BOTH ARE THE EXISTING COMMANDS ════════════════════
//
// Nothing here is a second implementation of anything. Password reset drives the SAME governed
// callable through the SAME seam (access/adminPasswordResetClient.js) and the SAME pure controller
// (domain/adminPasswordReset.js) that owns the in-flight lock and the idempotency key. Enable and
// disable drive the SAME `setUserStatus` trusted command that has been this platform's authority
// for account status since Issue #226.
//
// What changed is only WHERE they live. Both used to sit on a page-level surface with no
// particular person selected -- the reset needed its own eligible-user list to find a target, and
// the status buttons floated with no target at all. On a record page the target IS the record, so
// the list read disappears and the buttons become actions on somebody.
//
// ════════════════════ TRUTHFULNESS, UNCHANGED ════════════════════
//
// An administrator never enters, sees or is shown the user's password, a reset link, an action
// code, a token or the provider's response body -- and cannot be, because the callable does not
// return any of them. The confirmation names the PERSON, not their email address: the callable
// contract does not guarantee an email address reaches this client, and naming one we do not have
// would be an invented fact.
//
// AND DELIVERY IS REQUESTED, NEVER PROMISED (Owner ruling, PR #1806). A future-tense promise that
// an email arrives is a claim about a provider this surface has no signal from -- the callable
// returns a neutral `accepted`, and the merged result copy is already careful to say the reset
// "has been requested". The copy here now matches it: conditional, and explicit that this screen
// does not confirm delivery. The difference matters at the moment the email does not arrive, which
// is when somebody rereads the sentence to work out what the system actually claimed.
//
// The copy is asserted from SOURCE by test/adminUsersReset.test.mjs, so this comment deliberately
// does not quote the phrasing it forbids -- the guard cannot tell a quotation from a claim.
//
// A routine reset does not revoke sessions and this surface never says it does. Session revocation
// is a separate governed command (revokeUserSessions) which nothing here invokes.
//
// ════════════════════ ONE STATUS BUTTON, CHOSEN BY AN AUTHORITATIVE READ ════════════════════
//
// This section used to offer Enable AND Disable side by side. The reason was real: the account's
// state is Firebase Auth's `disabled` flag, no governed read exposed it, and a screen that cannot
// see the current state cannot pick the right action -- so it asked the administrator to know.
//
// `readPrincipalAccessState` (Owner ruling 2026-09-06 §4) answers it, so the contextual form is
// now possible and the ambiguous one is gone: an enabled account offers Disable and nothing else.
// The status row renders the read and never an inference -- not from employment status, not from
// linkage, and not from what a mutation was asked to do. After every successful write the read is
// re-run and the row shows what came back, because a screen that writes its own optimistic
// "Disabled" is asserting an outcome it never observed.
//
// ════════════════════ GOVERNED ROLES ARE ADDITIVE, AND SAID SO ════════════════════
//
// Measured from the command, not assumed: assignApprovedRole is a single `txn.create` on
// roleAssignments and never reads, revokes or replaces an existing assignment. A principal holds
// ZERO OR MORE active Roles and effective authority is the UNION of them
// (resolveEffectivePermission collects every qualifying assignment). There is no primary Role in
// this model, so the control is "Add Role" -- calling it "Change Role" would describe a
// replacement the command does not perform. Removal is the separate revokeRole command, keyed by
// ASSIGNMENT id rather than roleId because the same Role may be held more than once.
//
// THE LEGACY MIRROR IS NOT TOUCHED. employees.securityRole mirrors users/{uid}.role, a different
// system; no command here reads or writes it, and adding a Role never changes it.
//
// FAIL-CLOSED. Every control here is gated on the session effectively holding the capability the
// command re-checks server-side. Nothing renders as available on the strength of nav visibility,
// and the capability previewer defaults to false, so a direct URL hit yields the protected state
// with the reason attached rather than a button that will fail.
const USER_STATUS_CAPABILITY = "admin.userStatus.write";
const ROLE_ASSIGNMENT_CAPABILITY = "admin.roleAssignment.write";
const PRINCIPAL_ACCESS_READ_CAPABILITY = "admin.principalAccess.read";

// GLOBAL SCOPE, STATED RATHER THAN CHOSEN. `assignApprovedRole` takes a scope, and every Role this
// surface can offer is defined against global reach today -- there is no narrower scope a person
// could pick here that any Role's permission set is written to expect. So the value is fixed and
// SAID ON SCREEN, rather than being a silent default or a picker offering choices that would all
// mean the same thing. A Role that later needs a real scope needs a scope control designed for it,
// not this constant widened.
const ASSIGNMENT_SCOPE = Object.freeze({ type: "global" });

// One frozen empty array, not a fresh literal per render: `assignments` feeds a useMemo, and a new
// [] each time would recompute the addable list on every render for no reason.
const NO_ASSIGNMENTS = Object.freeze([]);

// WHAT THE LOCK ACTUALLY MEANS, and it is narrower than it used to say.
//
// This read "No principal holds the governed access-record grant this command requires, in any
// environment yet." That was true when written and is now FALSE: eos-platform-sandbox's admin
// persona has held `roleAssignments/bootstrap-admin-<uid>` since 2026-08-14, and the resolver
// returns ALLOW there. A control that explains itself with a claim about every environment is a
// control that will eventually lie, because it is asserting something it cannot see.
//
// So the reason now says only what this session can actually know: the trusted feed did not return
// a positive decision for THIS principal. That covers every real case -- no grant, a grant that
// does not qualify, an inactive capability, an undeployed or unreachable feed -- without naming a
// cause it has no evidence for.
const NO_GRANT_REASON =
  "The trusted access feed did not grant this action for your account.";
const NO_ACCOUNT_REASON =
  "This person has no linked EOS account, so there is no account to enable or disable.";

function holdsCapability(hasCapability, id) {
  if (typeof hasCapability !== "function") return false;
  try {
    return hasCapability(id) === true;
  } catch {
    return false;
  }
}

export default function UserAccessActions({
  employee,
  actorUid,
  hasCapability,
  resetClient = adminPasswordResetClient,
  statusClient = administrationUsersClient,
}) {
  const targetUid = employee?.userId ?? null;
  const linked = eosAccessState(employee) === EOS_ACCESS.LINKED;
  const name = employeeDisplayName(employee);

  const canReset = canInitiateAdminCredentialReset(hasCapability);
  const canSetStatus = holdsCapability(hasCapability, USER_STATUS_CAPABILITY);
  const canAssignRole = holdsCapability(hasCapability, ROLE_ASSIGNMENT_CAPABILITY);
  const canReadAccess = holdsCapability(hasCapability, PRINCIPAL_ACCESS_READ_CAPABILITY);

  // The client-side eligibility check is a USABILITY filter, never the boundary -- the backend
  // enforces disabled/break-glass/linkage/final-admin independently. `hasEmployeeLink` is true
  // because we are standing on the employee record that names this uid; the reciprocal half of
  // that link (users/{uid}.employeeId) is not readable here and is re-verified server-side.
  const eligibility = useMemo(
    () => deriveTargetEligibility({ uid: targetUid ?? "", hasEmployeeLink: linked }, actorUid),
    [targetUid, linked, actorUid],
  );

  const [action, setAction] = useState(initialActionState());
  const [inFlight, setInFlight] = useState(false);

  // ── THE AUTHORITATIVE ACCESS READ ──
  // One trusted call answers both halves of this section: the account's real enabled/disabled state
  // and the principal's active governed Roles. Everything below renders from it and from nothing
  // else -- no inference from employment status, no inference from linkage, no optimistic local
  // state after a mutation. `nonce` is bumped after every successful write so the screen re-reads
  // rather than predicting what the write did.
  const [accessNonce, setAccessNonce] = useState(0);
  const [access, setAccess] = useState({ phase: "idle", state: null });
  const refreshAccess = useCallback(() => setAccessNonce((n) => n + 1), []);

  useEffect(() => {
    // No account to read, or no authority to read it: neither is a load, and neither should sit
    // showing a spinner. The distinction between "may not" and "could not" is preserved below.
    if (!targetUid || !canReadAccess) {
      setAccess({ phase: canReadAccess ? "noAccount" : "denied", state: null });
      return undefined;
    }
    let live = true;
    setAccess((cur) => ({ phase: "loading", state: cur.state }));
    statusClient
      .readPrincipalAccessState({ principalUid: targetUid })
      .then((outcome) => {
        if (!live) return;
        if (outcome.ok) {
          setAccess({ phase: "ready", state: outcome.state });
          return;
        }
        // ABSENT IS NOT EMPTY. A failed read must never fall through to rendering an empty Role
        // list, which would be a positive claim that this person holds none.
        setAccess({ phase: outcome.result === "DENIED" ? "denied" : "unavailable", state: null });
      });
    return () => {
      // The record page is a live subscription and an administrator can move between people
      // faster than a callable resolves; without this, a slow read for the PREVIOUS person can
      // land after a fast read for the current one and render their access under this name.
      live = false;
    };
  }, [targetUid, canReadAccess, statusClient, accessNonce]);

  const accountStatus = access.phase === "ready" ? access.state.accountStatus : null;
  const assignments = access.phase === "ready" ? access.state.assignments : NO_ASSIGNMENTS;
  const [statusIntent, setStatusIntent] = useState(null); // "enabled" | "disabled" | null
  const [statusMessage, setStatusMessage] = useState(null);

  // ONE controller instance owns the synchronous in-flight lock and the idempotency key for the
  // current intent (reused on retry) -- the existing duplicate-submit protection, not a new one.
  const controllerRef = useRef(null);
  if (controllerRef.current === null) {
    controllerRef.current = createAdminResetController((payload) =>
      resetClient.rawInitiateAdminPasswordReset(payload),
    );
  }

  const openResetConfirm = useCallback(() => {
    controllerRef.current.beginIntent();
    setAction(beginConfirm(initialActionState(), { eligible: eligibility.eligible, mode: DEFAULT_MODE }));
  }, [eligibility.eligible]);

  const confirmReset = useCallback(async () => {
    if (!targetUid) return;
    setAction((s) => markSubmitting(s));
    setInFlight(true);
    const outcome = await controllerRef.current.submit({ targetUid, mode: DEFAULT_MODE });
    setInFlight(false);
    if (outcome.skipped) return; // an overlapping submit was ignored by the lock
    setAction((s) => settle(s, outcome.result));
  }, [targetUid]);

  const statusIdempotencyRef = useRef(null);
  const openStatusConfirm = useCallback((next) => {
    // A fresh key per INTENT, reused across retries of that same intent -- the same rule the reset
    // controller applies, so a retry after a timeout cannot apply the change twice.
    statusIdempotencyRef.current = newTrustedIdempotencyKey();
    setStatusMessage(null);
    setStatusIntent(next);
  }, []);

  const confirmStatus = useCallback(async () => {
    if (!targetUid || !statusIntent || inFlight) return;
    setInFlight(true);
    const outcome = await statusClient.setUserStatus({
      principalUid: targetUid,
      status: statusIntent,
      idempotencyKey: statusIdempotencyRef.current,
    });
    setInFlight(false);
    setStatusIntent(null);
    if (outcome.ok) {
      // RE-READ RATHER THAN ASSERT. The message says what was requested; the STATUS ROW above is
      // refreshed from the trusted read and is what says what is now true. A screen that writes
      // its own optimistic "Disabled" is claiming an outcome it did not observe.
      refreshAccess();
      setStatusMessage(`Account status change to ${statusIntent} submitted; re-reading.`);
      return;
    }
    setStatusMessage(
      outcome.result === "DENIED"
        ? "You are not authorized to change this account's status."
        : "The account status service is not available. Nothing was changed.",
    );
  }, [statusClient, statusIntent, targetUid, inFlight, refreshAccess]);

  // ── ROLE ASSIGNMENT ──
  // Same three-part shape as account status, for the same reasons: a chosen intent, a fresh
  // idempotency key per intent (reused on retry), and a confirmation that names the person and the
  // Role in words before anything is written.
  const [roleChoice, setRoleChoice] = useState("");
  const [roleIntent, setRoleIntent] = useState(null);
  const [roleMessage, setRoleMessage] = useState(null);
  const roleIdempotencyRef = useRef(null);

  const openRoleConfirm = useCallback(() => {
    if (!roleChoice) return;
    roleIdempotencyRef.current = newTrustedIdempotencyKey();
    setRoleMessage(null);
    setRoleIntent(roleChoice);
  }, [roleChoice]);

  const confirmRole = useCallback(async () => {
    if (!targetUid || !roleIntent || inFlight) return;
    setInFlight(true);
    const outcome = await statusClient.assignApprovedRole({
      principalUid: targetUid,
      roleId: roleIntent,
      scope: ASSIGNMENT_SCOPE,
      idempotencyKey: roleIdempotencyRef.current,
    });
    setInFlight(false);
    setRoleIntent(null);
    if (outcome.ok) {
      // Cleared so the control cannot be pressed twice on the same selection by reflex. The
      // assignment itself is idempotent server-side; this is about the reading of the screen.
      setRoleChoice("");
      refreshAccess();
      setRoleMessage(`${assignableRoleName(roleIntent)} added for ${name}.`);
      return;
    }
    setRoleMessage(
      outcome.result === "DENIED"
        ? "You are not authorized to assign Roles."
        : outcome.result === "INVALID"
          ? // The command's own message names what the caller submitted and is safe to show; it is
            // the one class of failure an administrator can act on without a developer.
            (outcome.message ?? "That Role cannot be assigned this way.")
          : "The role assignment service is not available. Nothing was changed.",
    );
  }, [statusClient, roleIntent, targetUid, inFlight, name, refreshAccess]);

  // ── REMOVE ONE ASSIGNMENT ──
  // Keyed by assignmentId, which is why this needs the trusted read: revokeRole identifies the
  // assignment, never the Role, so before this read existed the command was uncallable from any UI.
  const [removeIntent, setRemoveIntent] = useState(null);
  const removeIdempotencyRef = useRef(null);

  const openRemoveConfirm = useCallback((assignment) => {
    removeIdempotencyRef.current = newTrustedIdempotencyKey();
    setRoleMessage(null);
    setRemoveIntent(assignment);
  }, []);

  const confirmRemove = useCallback(async () => {
    if (!removeIntent || inFlight) return;
    setInFlight(true);
    const outcome = await statusClient.revokeRole({
      assignmentId: removeIntent.assignmentId,
      idempotencyKey: removeIdempotencyRef.current,
    });
    setInFlight(false);
    const removedName = assignableRoleName(removeIntent.roleId);
    setRemoveIntent(null);
    if (outcome.ok) {
      refreshAccess();
      setRoleMessage(`${removedName} removed from ${name}.`);
      return;
    }
    setRoleMessage(
      outcome.result === "DENIED"
        ? // Covers the privileged case honestly without claiming to know it was the cause: a
          // privileged revocation needs a second approver this single-admin path does not supply,
          // and the server refuses it exactly as it refuses an unauthorized caller.
          "You are not authorized to remove this Role. A privileged Role needs the two-person approval route."
        : "The role assignment service is not available. Nothing was changed.",
    );
  }, [statusClient, removeIntent, inFlight, name, refreshAccess]);

  // ALREADY HELD IS NOT OFFERED (Owner ruling §6). assignApprovedRole would happily create a
  // SECOND active assignment for the same roleId at the same scope -- it does not dedupe -- and the
  // result would be two identical rows conferring nothing extra and each needing its own removal.
  // Filtered on the read, so the option reappears the moment the Role is removed.
  const addableRoles = useMemo(() => {
    const held = new Set(
      assignments
        .filter((a) => a.scope?.type === ASSIGNMENT_SCOPE.type)
        .map((a) => a.roleId),
    );
    return ASSIGNABLE_ROLE_OPTIONS.filter((r) => !held.has(r.id));
  }, [assignments]);

  const status = resetStatusView(action);

  return (
    <div className="fo-user-actions">
      <h3 className="fo-user-actions__title">Administrative actions</h3>

      {/* ── ACCOUNT STATUS ──
          ONE BUTTON, chosen by the authoritative read. This section used to offer Enable AND
          Disable side by side, because the account's real state was Firebase Auth's `disabled`
          flag and no governed read exposed it -- so the screen asked the administrator to know
          which one they needed. readPrincipalAccessState answers that now, so the contextual form
          is available and the ambiguous one is gone. */}
      <dl className="fo-detail-list">
        <dt>Account status</dt>
        <dd data-user-account-status={accountStatus ?? access.phase}>
          {accountStatus === "enabled" && "Enabled"}
          {accountStatus === "disabled" && "Disabled"}
          {/* Four different not-a-status states, each said in its own words. Collapsing them into
              one "Unavailable" would tell an administrator the service is down when the truth is
              that they may not read it, or that this person has no account at all. */}
          {accountStatus === null && (
            <span className="fo-muted">
              {access.phase === "loading" && "Reading…"}
              {access.phase === "denied" && "You do not have access to read this."}
              {access.phase === "unavailable" && "Could not be read."}
              {(access.phase === "noAccount" || access.phase === "idle") && "No linked account."}
              {access.phase === "ready" && "No account exists for this person."}
            </span>
          )}
        </dd>
      </dl>

      {/* The action appears only once the state is known: an Enable button next to an unread
          status is the same guess the two-button version made. */}
      {accountStatus !== null && (
        <>
          <div className="fo-btn-row">
            {(() => {
              const next = accountStatus === "enabled" ? "disabled" : "enabled";
              const label = next === "enabled" ? "Enable Account" : "Disable Account";
              const reason = !linked ? NO_ACCOUNT_REASON : !canSetStatus ? NO_GRANT_REASON : null;
              return reason ? (
                // variant="protected" renders the lock, keeps the native disabled attribute and
                // ties the stated reason to the control through aria-describedby -- so the reason
                // is ATTACHED to the button rather than being loose prose sitting near it.
                <Button type="button" variant="protected" reason={reason} data-user-action={next}>
                  {label}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={inFlight}
                  data-user-action={next}
                  onClick={() => openStatusConfirm(next)}
                >
                  {label}
                </Button>
              );
            })()}
          </div>
          <p className="fo-muted" role="note">
            Changing account status does not change this person&apos;s employment status. The two
            are independent records and neither is derived from the other.
          </p>
        </>
      )}

      {statusIntent && (
        <div className="fo-modal" role="dialog" aria-modal="true" aria-label="Change account status">
          <h4>{statusIntent === "enabled" ? "Enable this account?" : "Disable this account?"}</h4>
          <p>
            Set <strong>{name}</strong>&apos;s EOS account status to{" "}
            <strong>{statusIntent === "enabled" ? "enabled" : "disabled"}</strong>?
            {statusIntent === "disabled"
              ? " A disabled account cannot sign in. Their employment record is unchanged."
              : " An enabled account can sign in again. Their employment record is unchanged."}
          </p>
          <div>
            <Button type="button" variant="primary" onClick={confirmStatus} disabled={inFlight} loading={inFlight}>
              Confirm
            </Button>{" "}
            <Button type="button" variant="secondary" onClick={() => setStatusIntent(null)} disabled={inFlight}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {statusMessage && (
        <p className="fo-muted" role="status">
          {statusMessage}
        </p>
      )}

      {/* ── ASSIGN A ROLE ──
          THE TARGET IS THE RECORD, which is the whole reason this lives here and not on Roles &
          Permissions. That page carried a disabled version of this control for months because it
          asked an administrator to pick a principal from a list no trusted read can produce. On a
          person's own page there is nothing to look up: the principal is the record being read.

          The control is SHOWN-AND-PROTECTED rather than hidden, unlike password reset. Reset hides
          because its very availability is sensitive; who may hold a Role is not, and an
          administrator who cannot assign one needs to know the action exists and that they lack it
          -- otherwise the answer to "how do I give someone Sales access" is silence. */}
      <div className="fo-role-assign">
        <h4>Governed Roles</h4>

        {/* WHAT THEY HOLD NOW, before anything about changing it. The list is the authoritative
            read; an empty list is only rendered as "holds none" when the read actually SUCCEEDED
            and returned none -- every other phase says why it cannot answer instead. */}
        {access.phase === "ready" && assignments.length > 0 && (
          <ul className="fo-role-list" data-user-governed-roles={assignments.length}>
            {assignments.map((a) => (
              <li key={a.assignmentId}>
                <span>{assignableRoleName(a.roleId)}</span>{" "}
                <span className="fo-muted">
                  {a.scope?.type === "global" ? "global" : `${a.scope?.type}${a.scope?.value ? `: ${a.scope.value}` : ""}`}
                </span>{" "}
                {canAssignRole ? (
                  <Button
                    type="button"
                    variant="secondary"
                    data-user-action="remove-role"
                    disabled={inFlight}
                    onClick={() => openRemoveConfirm(a)}
                  >
                    Remove
                  </Button>
                ) : (
                  <Button type="button" variant="protected" reason={NO_GRANT_REASON} data-user-action="remove-role">
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {access.phase === "ready" && assignments.length === 0 && (
          <p className="fo-muted" data-user-governed-roles="0">
            Holds no governed Role. Their access is whatever the legacy compatibility role confers.
          </p>
        )}
        {access.phase !== "ready" && (
          <p className="fo-muted" data-user-governed-roles="unknown">
            {access.phase === "loading" && "Reading current Roles…"}
            {access.phase === "denied" && "You do not have access to read this person's Roles."}
            {access.phase === "unavailable" && "Current Roles could not be read."}
            {(access.phase === "noAccount" || access.phase === "idle") &&
              "No linked EOS account, so there are no governed Roles to read."}
          </p>
        )}

        <h4>Add Role</h4>
        {/* The no-account branch gets its OWN sentence rather than reusing NO_ACCOUNT_REASON,
            which is written for the status buttons and ends "no account to enable or disable" --
            true, and the wrong reason to give for a Role. */}
        {!linked ? (
          <p className="fo-muted" data-user-role-assign="no-account">
            This person has no linked EOS account. A Role is held by an account, so there is
            nothing to assign one to.
          </p>
        ) : (
          <>
            <div className="fo-btn-row">
              <label className="fo-visually-hidden" htmlFor="user-assign-role">
                Role to assign
              </label>
              <select
                id="user-assign-role"
                value={roleChoice}
                disabled={!canAssignRole || inFlight}
                onChange={(e) => setRoleChoice(e.target.value)}
              >
                <option value="">Select a Role</option>
                {addableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>{" "}
              {canAssignRole ? (
                <Button
                  type="button"
                  variant="secondary"
                  data-user-action="assign-role"
                  disabled={!roleChoice || inFlight}
                  onClick={openRoleConfirm}
                >
                  Add Role
                </Button>
              ) : (
                <Button type="button" variant="protected" reason={NO_GRANT_REASON} data-user-action="assign-role">
                  Add Role
                </Button>
              )}
            </div>
            <p className="fo-muted">
              Adding a Role never replaces one — a person holds any number, and their access is
              everything those Roles carry together. It does not change their legacy compatibility
              role or their operational roles. Roles are added at global scope. Owner and
              Administrator are not offered here: a privileged Role needs the two-person approval
              route on Roles &amp; Permissions.
            </p>
          </>
        )}

        {roleIntent && (
          <div className="fo-modal" role="dialog" aria-modal="true" aria-label="Add a role">
            <h4>Add this Role?</h4>
            <p>
              Give <strong>{name}</strong> the <strong>{assignableRoleName(roleIntent)}</strong>{" "}
              Role, at global scope? This grants everything that Role carries, immediately, in
              addition to any Role they already hold, and is recorded against your signed-in
              account.
            </p>
            <div>
              <Button type="button" variant="primary" onClick={confirmRole} disabled={inFlight} loading={inFlight}>
                Confirm
              </Button>{" "}
              <Button type="button" variant="secondary" onClick={() => setRoleIntent(null)} disabled={inFlight}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {removeIntent && (
          <div className="fo-modal" role="dialog" aria-modal="true" aria-label="Remove a role">
            <h4>Remove this Role?</h4>
            <p>
              Take the <strong>{assignableRoleName(removeIntent.roleId)}</strong> Role away from{" "}
              <strong>{name}</strong>? They lose everything that Role carries unless another Role
              they hold also carries it. Their other Roles, their employment record and their
              account status are unchanged.
            </p>
            <div>
              <Button type="button" variant="primary" onClick={confirmRemove} disabled={inFlight} loading={inFlight}>
                Confirm
              </Button>{" "}
              <Button type="button" variant="secondary" onClick={() => setRemoveIntent(null)} disabled={inFlight}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {roleMessage && (
          <p className="fo-muted" role="status">
            {roleMessage}
          </p>
        )}
      </div>

      {/* ── PASSWORD RESET ──
          The WHOLE control is hidden unless the session effectively holds
          admin.credentialReset.initiate. Unlike the retired page-level surface, hiding it costs
          nothing extra here: there is no eligible-user list read to suppress, because the target
          is the record. */}
      {canReset && (
        <>
          <div className="fo-btn-row">
            {eligibility.eligible ? (
              <Button
                type="button"
                variant="secondary"
                onClick={openResetConfirm}
                disabled={inFlight}
                data-user-action="reset"
              >
                {RESET_ACTION_LABEL}
              </Button>
            ) : (
              <Button
                type="button"
                variant="protected"
                reason={ELIGIBILITY_REASON_COPY[eligibility.reason] ?? NO_ACCOUNT_REASON}
                data-user-action="reset"
              >
                {RESET_ACTION_LABEL}
              </Button>
            )}
          </div>
          <p className="fo-muted">
            If the request is accepted, a password-reset email is requested for this account, and the
            user sets their own new password from it. An administrator never sees a reset link, code,
            or the user&apos;s password, and this screen does not confirm delivery. Routine resets do
            not sign the user out.
          </p>

          {action.phase === ACTION_PHASE.CONFIRMING && (
            <div className="fo-modal" role="dialog" aria-modal="true" aria-label={RESET_CONFIRM_TITLE}>
              <h4>{RESET_CONFIRM_TITLE}</h4>
              {/* Names the PERSON. The callable's contract does not deliver an email address to
                  this client, so an "…to john.smith@example.com?" confirmation would be quoting an
                  address we do not have. */}
              <p>
                Request a password reset for <strong>{name}</strong>? If the account is eligible, a
                reset email is requested and they set their own new password from it. Delivery is not
                confirmed here.
              </p>
              <div>
                <Button type="button" variant="primary" onClick={confirmReset} disabled={inFlight} loading={inFlight}>
                  Confirm
                </Button>{" "}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAction((s) => cancelConfirm(s))}
                  disabled={inFlight}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {status.show && (
            <p className={`fo-${status.tone}`} {...status.aria}>
              {status.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
