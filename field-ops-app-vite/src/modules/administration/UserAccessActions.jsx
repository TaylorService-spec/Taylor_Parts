import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminPasswordResetClient } from "../../access/adminPasswordResetClient";
import { administrationUsersClient } from "../../access/administrationUsersClient";
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
// ════════════════════ SECURITY ROLES MOVED TO POSTGRESQL (lane CP-C, 2026-09-26) ════════════════════
//
// This component used to add and remove Security Roles through the Firebase callables
// `assignApprovedRole` / `revokeRole`, writing Firestore `roleAssignments` -- a second assignment
// store beside the governed PostgreSQL one, offered from a client registry of Roles. That control is
// REMOVED. Security Roles are administered on the Employee page's own "Security Roles" section
// (EmployeeSecurityRoles.jsx) through PostgreSQL `assignRole` / `revokeRole`, gated on the server by
// admin.roleAssignment.write. What stays here is the account's status and password reset, which are
// credential concerns on the legacy trusted callables.
//
// FAIL-CLOSED. Every control here is gated on the session effectively holding the capability the
// command re-checks server-side. Nothing renders as available on the strength of nav visibility,
// and the capability previewer defaults to false, so a direct URL hit yields the protected state
// with the reason attached rather than a button that will fail.
const USER_STATUS_CAPABILITY = "admin.userStatus.write";
const PRINCIPAL_ACCESS_READ_CAPABILITY = "admin.principalAccess.read";

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

  const status = resetStatusView(action);

  return (
    <div className="fo-user-actions">
      <h3 className="fo-user-actions__title">Administrative Actions</h3>

      {/* ── ACCOUNT STATUS ──
          ONE BUTTON, chosen by the authoritative read. This section used to offer Enable AND
          Disable side by side, because the account's real state was Firebase Auth's `disabled`
          flag and no governed read exposed it -- so the screen asked the administrator to know
          which one they needed. readPrincipalAccessState answers that now, so the contextual form
          is available and the ambiguous one is gone. */}
      <dl className="fo-detail-list">
        <dt>Account Status</dt>
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
