// Issue #226 Row 12 -- Admin mutation UI (Task 17). Two governed surfaces:
//
// (1) Set user status (Enable/Disable) -> the trusted-writer `setUserStatus`
//     command. Server-side only, not yet a deployed callable (blocked on Issue
//     #15). Shown but genuinely disabled -- no path to any Auth/Firestore
//     mutation today. Activation is a later Owner gate (Row 22).
//
// (2) Password reset (AUTH-UI-3, DECISIONS #56) -> the governed admin-initiated
//     reset. Wired to the trusted callable via the client SEAM
//     (access/adminPasswordResetClient.js); ALL logic lives in the pure,
//     node-tested view-model (domain/adminUsersResetView.js + adminPasswordReset.js)
//     so this JSX stays thin. The callables are NOT deployed yet, so the live
//     surface renders the honest unavailable/uncertain states -- never a
//     client-direct Auth mutation, never a delivery claim. Authorization is
//     resolved SERVER-SIDE; nav/button visibility here is not authorization.
//
// Truthfulness (DECISIONS #56): this surface never shows a reset link, action
// code, token, target email, or provider body, never claims the email was
// delivered/opened/consumed, and only drives the ROUTINE reset (no session
// revocation -- D-ROUTINE-REVOKE = NO).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { adminPasswordResetClient } from "../../access/adminPasswordResetClient";
import {
  createAdminResetController,
  initialActionState,
  beginConfirm,
  cancelConfirm,
  markSubmitting,
  settle,
  sanitizeReasonCode,
  canInitiateAdminCredentialReset,
  DEFAULT_MODE,
} from "../../domain/adminPasswordReset";
import {
  RESET_SECTION_TITLE,
  RESET_ACTION_LABEL,
  RESET_CONFIRM_TITLE,
  RESET_UNAVAILABLE_COPY,
  maybeLoadEligibleUsers,
  resetStatusView,
} from "../../domain/adminUsersResetView";

// `hasCapability` is the trusted effective-access previewer threaded from the
// App.jsx dispatcher (operationalContext.hasCapability). The password-reset
// surface -- and its eligible-user list read -- exist ONLY when the session
// effectively holds `admin.credentialReset.initiate`. This gate is enforced
// HERE, at the rendered surface, NOT merely by nav visibility: reaching
// /administration/users directly still yields a fail-closed hasCapability
// (undefined default) and the whole reset surface stays hidden with ZERO list
// callable attempts. The catalog entry is `active: false` today, so this is
// always false until a separate activation/grant gate -- keeping production
// fail-closed. The setUserStatus preview below is a SEPARATE surface and is
// intentionally not gated by this capability.
export default function AdminUsers({ client = adminPasswordResetClient, hasCapability }) {
  const { user } = useAuth();
  const actorUid = user?.uid ?? "";
  const canReset = canInitiateAdminCredentialReset(hasCapability);

  const [loadState, setLoadState] = useState({ loading: true, ok: false, rows: [], result: null });
  const [selected, setSelected] = useState(null); // the row being reset
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(null);
  const [action, setAction] = useState(initialActionState());
  const [inFlight, setInFlight] = useState(false);

  // ONE controller instance owns the synchronous in-flight lock + the
  // idempotency key for the current intent (reused on retry).
  const controllerRef = useRef(null);
  if (controllerRef.current === null) {
    controllerRef.current = createAdminResetController((payload) => client.rawInitiateAdminPasswordReset(payload));
  }

  useEffect(() => {
    // Fail-closed: without the reset capability the surface is hidden and the
    // governed list read must NEVER be attempted. Return before any call.
    if (!canReset) {
      setLoadState({ loading: false, ok: false, rows: [], result: null });
      return undefined;
    }
    let alive = true;
    setLoadState((s) => ({ ...s, loading: true }));
    // maybeLoadEligibleUsers re-checks the SAME capability predicate and only
    // invokes the seam when it holds -- a second, single-source-of-truth guard.
    maybeLoadEligibleUsers({ hasCapability, listFn: client.listResetEligibleUsers, actorUid }).then((res) => {
      if (!alive) return;
      if (res.ok) setLoadState({ loading: false, ok: true, rows: res.rows, result: null });
      else setLoadState({ loading: false, ok: false, rows: [], result: res.result ?? null });
    });
    return () => {
      alive = false;
    };
  }, [client, actorUid, canReset, hasCapability]);

  const openConfirm = useCallback((row) => {
    setSelected(row);
    setReason("");
    setReasonError(null);
    controllerRef.current.beginIntent(); // fresh idempotency key for this intent
    setAction(beginConfirm(initialActionState(), { eligible: row.eligible, mode: DEFAULT_MODE }));
  }, []);

  const cancel = useCallback(() => {
    setAction((s) => cancelConfirm(s));
    setSelected(null);
  }, []);

  const confirmSend = useCallback(async () => {
    if (!selected) return;
    const clean = sanitizeReasonCode(reason);
    if (!clean.ok) {
      setReasonError(clean.error);
      return;
    }
    setReasonError(null);
    setAction((s) => markSubmitting(s));
    setInFlight(true);
    // NOTE: reason is captured client-side only; it is NOT part of the merged
    // callable contract and is deliberately not sent until AUTH-PR-3.5 adds it.
    const outcome = await controllerRef.current.submit({ targetUid: selected.uid, mode: DEFAULT_MODE });
    setInFlight(false);
    if (outcome.skipped) return; // an overlapping submit was ignored by the lock
    setAction((s) => settle(s, outcome.result));
  }, [selected, reason]);

  const status = useMemo(() => resetStatusView(action), [action]);

  return (
    <div className="fo-panel">
      <h2>Users</h2>
      <p className="fo-muted">
        This surface&apos;s governed content requires the Enterprise Access &amp; Administration
        Platform&apos;s trusted backend. Firestore Rules deny all client-direct access to governed
        Role/Permission/Audit data by design (Spec sec12); mutations are performed only by trusted
        callables, never by the client.
      </p>

      <h3>Set user status</h3>
      <p className="fo-muted">
        Enabling or disabling a user calls the trusted <code>setUserStatus</code> command. It is
        implemented and tested but not deployed as a callable Cloud Function yet, so these actions
        are shown to preview the intended surface and cannot be triggered.
      </p>
      <button type="button" disabled aria-disabled="true">
        Enable user
      </button>{" "}
      <button type="button" disabled aria-disabled="true">
        Disable user
      </button>

      {/* Fail-closed: the ENTIRE password-reset surface renders only when the
          session effectively holds admin.credentialReset.initiate. Hidden (and
          zero list calls) otherwise -- see the gate at the top of this file. */}
      {canReset && (
        <>
          <h3>{RESET_SECTION_TITLE}</h3>
          <p className="fo-muted">
            Initiates a governed password reset for another eligible user. The user sets their own new
            password from an email they receive; an administrator never sees a reset link, code, or the
            user&apos;s password. Routine resets do not sign the user out.
          </p>

          {loadState.loading && <p className="fo-muted">Loading eligible users…</p>}

          {!loadState.loading && !loadState.ok && (
            <p className="fo-muted" role="status">
              {RESET_UNAVAILABLE_COPY}
            </p>
          )}

          {!loadState.loading && loadState.ok && loadState.rows.length === 0 && (
            <p className="fo-muted">No eligible users to display.</p>
          )}

          {!loadState.loading && loadState.ok && loadState.rows.length > 0 && (
            <ul className="fo-list">
              {loadState.rows.map((row) => (
                <li key={row.uid}>
                  <span>{row.displayName || row.uid}</span>
                  {row.role ? <span className="fo-muted"> — {row.role}</span> : null}{" "}
                  {row.eligible ? (
                    <button type="button" onClick={() => openConfirm(row)} disabled={inFlight}>
                      {RESET_ACTION_LABEL}
                    </button>
                  ) : (
                    <span className="fo-muted" title={row.ineligibleReasonCopy || undefined}>
                      (not eligible)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="fo-modal" role="dialog" aria-modal="true" aria-label={RESET_CONFIRM_TITLE}>
              <h4>{RESET_CONFIRM_TITLE}</h4>
              <p>
                Send a password reset for <strong>{selected.displayName || selected.uid}</strong>
                {selected.role ? <span className="fo-muted"> ({selected.role})</span> : null}?
              </p>
              <label>
                Reason (optional)
                <input
                  type="text"
                  value={reason}
                  maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                  aria-invalid={reasonError ? "true" : "false"}
                />
              </label>
              {reasonError && <p className="fo-error">{reasonError}</p>}
              <div>
                <button type="button" onClick={confirmSend} disabled={inFlight}>
                  {inFlight ? "Sending…" : "Confirm"}
                </button>{" "}
                <button type="button" onClick={cancel} disabled={inFlight}>
                  Cancel
                </button>
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
