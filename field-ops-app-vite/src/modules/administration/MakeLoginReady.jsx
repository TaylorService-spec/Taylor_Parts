import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { LOGIN_ACTION_DONE_WORDS, OneTimeCode } from "./EmployeeLoginAccount.jsx";

// MAKE LOGIN-READY (docs/architecture/eos-login-ready-person.md, A13 / Owner decision D5). On an Employee with NO linked Principal, one governed act
// creates the person's EOS Principal, its membership, the Employee link and a pending sign-in, and returns a one-time setup code.
//
// The caller (UserDetail) renders this only when the Employee is unlinked AND the server's own per-operation access map says this session may ask
// (makePersonLoginReady: admin.loginReadyPerson.provision + admin.roleAssignment.write). While the first key is ungranted -- its state at
// release -- nobody sees it. This panel decides nothing: the server re-decides every call and a refusal is shown as the server worded it.
//
// Roles, scopes and capabilities are NOT given by this step; they stay in the Roles panel under their own capability.
// The setup code is shown ONCE, here, to the Administrator who ran the act. It is never stored readably, logged or audited, and cannot be
// shown again; a lost code is replaced from Sign-in (New setup code) on the created account.

// result / onIssued (optional): the caller may hold the one-time result, so a page re-read that unmounts this panel cannot lose the code.
export default function MakeLoginReady({ api, employeeId, workEmail = "", onDone, result = null, onIssued }) {
  const [identifier, setIdentifier] = useState(workEmail ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [localOneTime, setLocalOneTime] = useState(null);
  const oneTime = onIssued ? result : localOneTime;
  const setOneTime = onIssued ?? setLocalOneTime;
  const hasWorkEmail = typeof workEmail === "string" && workEmail.trim() !== "";

  const run = async () => {
    if (busy) return;
    if (!reason.trim()) { setError("State a reason; it is recorded with the change."); return; }
    setBusy(true);
    setError(null);
    const r = await api("makePersonLoginReady", { employeeId, loginIdentifier: identifier.trim(), reason: reason.trim() });
    setBusy(false);
    if (!r.ok) { setError(r.message ?? r.code); return; }
    setReason("");
    setOneTime({ label: "Setup code", code: r.data.enrollmentTicket, expiresAt: r.data.enrollmentTicketExpiresAt });
  };

  // After the code is shown the page re-reads (the Employee is now linked, so this whole control goes away).
  if (oneTime) {
    return (
      <div style={{ display: "grid", gap: 8 }} data-make-login-ready="done">
        <p className="fo-muted" role="status">{LOGIN_ACTION_DONE_WORDS.makePersonLoginReady}</p>
        <OneTimeCode {...oneTime} onDone={() => { setOneTime(null); if (onDone) onDone(); }} />
        <p className="fo-muted">If the code is lost, issue a new one from Sign-in on this record.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }} data-make-login-ready="form">
      <p className="fo-muted">
        Creates this person&rsquo;s sign-in. They set a password and an authenticator the first time they sign in. Roles are not given by this step.
      </p>
      <label style={{ display: "grid", gap: 4, maxWidth: 420 }}>
        <span>Sign-in name{hasWorkEmail ? " (this Employee's work email)" : " (usually the work email)"}</span>
        <input className="fo-input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} readOnly={hasWorkEmail}
          autoCapitalize="none" spellCheck={false} />
      </label>
      <label style={{ display: "grid", gap: 4, maxWidth: 420 }}>
        <span>Reason (recorded)</span>
        <input className="fo-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </label>
      <div>
        <Button loading={busy} onClick={run}>Make login-ready</Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
