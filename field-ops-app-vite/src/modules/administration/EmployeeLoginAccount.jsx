import { useCallback, useEffect, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";

// EOS LOGIN -- Administration's control of one Principal's EOS sign-in (docs/architecture/eos-native-identity.md, 3(d)).
//
// Every action is an /admin/policy operation the SERVER gates: admin.roleAssignment.write for each change (never on
// oneself; an Owner's login only by an Owner), admin.principalAccess.read for the read. This panel decides nothing; a
// refusal is shown as the server worded it. Each change takes a stated reason, recorded in the audit trail.
//
// A setup or reset code is shown ONCE, here, to hand to the person out of band. It is never stored by the server
// in readable form and cannot be shown again; issuing another replaces it.

const STATUS_WORDS = Object.freeze({
  pending_enrollment: "Waiting for first sign-in setup",
  active: "Sign-in enabled",
  disabled: "Sign-in disabled",
});

// What the administrator is told once the server has applied an action (the re-read then shows the new state).
export const LOGIN_ACTION_DONE_WORDS = Object.freeze({
  provisionLoginAccount: "Sign-in created.",
  reissueLoginEnrollment: "New setup code issued.",
  issueLoginReset: "Password reset code issued.",
  unlockLoginAccount: "Sign-in unlocked.",
  revokeLoginSessions: "Signed out on every device.",
  resetLoginMfa: "Two-step verification reset: the authenticator and recovery codes were removed.",
  setLoginMfaRequirement: "Two-step verification requirement updated.",
  setLoginAccountStatus: "Sign-in status updated.",
  retireLoginAccount: "Sign-in removed.",
});

function OneTimeCode({ label, code, expiresAt, onDone }) {
  return (
    <div className="fo-panel" role="status" style={{ marginTop: 8 }}>
      <p><strong>{label}</strong> — give this to the person directly (in person or by phone). It is shown once and expires {new Date(expiresAt).toLocaleString()}.</p>
      <code style={{ display: "block", wordBreak: "break-all", fontSize: "0.95rem", padding: "6px 0" }}>{code}</code>
      <Button variant="secondary" onClick={onDone}>Done</Button>
    </div>
  );
}

export default function EmployeeLoginAccount({ api, principalId, suggestedIdentifier = "" }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [reason, setReason] = useState("");
  const [identifier, setIdentifier] = useState(suggestedIdentifier);
  const [requireMfa, setRequireMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [oneTime, setOneTime] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const r = await api("readLoginAccount", { principalId });
    setState(r.ok ? { status: "ready", data: r.data, error: null } : { status: "failed", data: null, error: r.message ?? r.code });
  }, [api, principalId]);
  useEffect(() => { load(); }, [load]);

  const run = async (operation, input, after) => {
    if (busy) return;
    if (!reason.trim()) { setActionError("State a reason; it is recorded with the change."); return; }
    // Removal is final (the sign-in identity is never reissued), and ending sessions is the suspected-compromise act
    // (DECISIONS #56: never bundled into a reset, separately confirmed): confirm both.
    const confirmWords = {
      retireLoginAccount: "Remove this sign-in permanently? The person will need a new sign-in to be created.",
      revokeLoginSessions: "Sign this person out on every device now? Use this when an account may be compromised.",
    }[operation];
    if (confirmWords && typeof window !== "undefined" && !window.confirm(confirmWords)) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const r = await api(operation, { principalId, reason: reason.trim(), ...input });
    setBusy(false);
    if (!r.ok) { setActionError(r.message ?? r.code); return; }
    setReason("");
    if (after) after(r.data);
    await load();
    setNotice(LOGIN_ACTION_DONE_WORDS[operation] ?? "Done.");
  };
  const noticeLine = notice ? <p className="fo-muted" role="status">{notice}</p> : null;

  if (state.status === "loading") return <p className="fo-muted">Loading sign-in…</p>;
  if (state.status === "failed") return <p role="alert">The EOS sign-in could not be read: {state.error}</p>;

  const { account, eosIdentity } = state.data;
  const reasonField = (
    <label style={{ display: "grid", gap: 4, maxWidth: 420 }}>
      <span>Reason (recorded)</span>
      <input className="fo-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
    </label>
  );

  if (!account) {
    if (eosIdentity) {
      return <p className="fo-muted">This Principal already holds an EOS identity ({eosIdentity.kind === "persona" ? "a nonprod persona" : "another binding"}), so a login cannot be added.</p>;
    }
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p className="fo-muted">No EOS sign-in. Creating one issues a one-time setup code; the person uses it to choose their password.</p>
        <label style={{ display: "grid", gap: 4, maxWidth: 420 }}>
          <span>Sign-in name (usually the work email)</span>
          <input className="fo-input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none" spellCheck={false} />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={requireMfa} onChange={(e) => setRequireMfa(e.target.checked)} />
          <span>Require two-step verification</span>
        </label>
        {reasonField}
        <div>
          <Button loading={busy} onClick={() => run("provisionLoginAccount", { loginIdentifier: identifier.trim(), mfaRequired: requireMfa },
            (d) => setOneTime({ label: "Setup code", code: d.enrollmentTicket, expiresAt: d.enrollmentTicketExpiresAt }))}>Create sign-in</Button>
        </div>
        {actionError ? <p role="alert">{actionError}</p> : null}
        {noticeLine}
        {oneTime ? <OneTimeCode {...oneTime} onDone={() => setOneTime(null)} /> : null}
      </div>
    );
  }

  const facts = [
    ["Sign-in name", account.loginIdentifier],
    ["Status", STATUS_WORDS[account.status] ?? account.status],
    ["Two-step verification", account.mfaEnrolled ? `On (${account.recoveryCodesRemaining} recovery codes left)` : account.mfaRequired ? "Required — not set up yet" : "Off"],
    ["Signed-in sessions", String(account.liveSessions)],
    ["Last sign-in", account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : "Never"],
    ...(account.lockedUntil ? [["Locked until", `${new Date(account.lockedUntil).toLocaleString()} (${account.failedAttempts} failed attempts)`]] : []),
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px", margin: 0 }}>
        {facts.map(([k, v]) => [<dt key={`k-${k}`} className="fo-muted">{k}</dt>, <dd key={`v-${k}`} style={{ margin: 0 }}>{v}</dd>])}
      </dl>
      {reasonField}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {account.status === "pending_enrollment" ? (
          <Button variant="secondary" loading={busy} onClick={() => run("reissueLoginEnrollment", {},
            (d) => setOneTime({ label: "Setup code", code: d.enrollmentTicket, expiresAt: d.enrollmentTicketExpiresAt }))}>New setup code</Button>
        ) : null}
        {account.status === "active" ? (
          <Button variant="secondary" loading={busy} onClick={() => run("issueLoginReset", {},
            (d) => setOneTime({ label: "Reset code", code: d.resetTicket, expiresAt: d.resetTicketExpiresAt }))}>Reset password</Button>
        ) : null}
        {account.lockedUntil ? <Button variant="secondary" loading={busy} onClick={() => run("unlockLoginAccount", {})}>Unlock</Button> : null}
        {account.liveSessions > 0 ? <Button variant="secondary" loading={busy} onClick={() => run("revokeLoginSessions", {})}>Sign out everywhere</Button> : null}
        {account.mfaEnrolled ? <Button variant="secondary" loading={busy} onClick={() => run("resetLoginMfa", {})}>Reset two-step verification</Button> : null}
        <Button variant="secondary" loading={busy} onClick={() => run("setLoginMfaRequirement", { required: !account.mfaRequired })}>
          {account.mfaRequired ? "Stop requiring two-step verification" : "Require two-step verification"}
        </Button>
        {account.status === "disabled"
          ? <Button variant="secondary" loading={busy} onClick={() => run("setLoginAccountStatus", { status: "active" })}>Enable sign-in</Button>
          : <Button variant="secondary" loading={busy} onClick={() => run("setLoginAccountStatus", { status: "disabled" })}>Disable sign-in</Button>}
        <Button variant="secondary" loading={busy} onClick={() => run("retireLoginAccount", {})}>Remove sign-in</Button>
      </div>
      {actionError ? <p role="alert">{actionError}</p> : null}
      {noticeLine}
      {oneTime ? <OneTimeCode {...oneTime} onDone={() => setOneTime(null)} /> : null}
      {state.data.recentEvents?.length ? (
        <details>
          <summary>Recent sign-in activity</summary>
          <ul>
            {state.data.recentEvents.map((e, i) => (
              <li key={i}>{new Date(e.occurredAt).toLocaleString()} — {e.event} {e.outcome === "refused" ? `refused (${e.reason})` : "ok"}{e.client ? ` · ${e.client}` : ""}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
