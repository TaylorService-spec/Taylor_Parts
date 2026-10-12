import { useCallback, useEffect, useState } from "react";
import { Button, PageHeader, SectionHeader } from "../../shared/ui/primitives/index.js";
import { eosLoginClient, eosLoginMessage } from "../../auth/eosLoginClient.js";

// ACCOUNT SECURITY -- the account holder's own EOS login: password, two-step verification, recovery codes, sessions.
// docs/architecture/eos-native-identity.md, 3(c). Every action is a call to /auth/* with the holder's own session; the
// server decides everything (including whether a second factor may be removed). Nothing here reads a Role.

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 4, maxWidth: 360 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Message({ error, notice }) {
  if (error) return <p role="alert" className="fo-inline-error">{error}</p>;
  if (notice) return <p role="status">{notice}</p>;
  return null;
}

function RecoveryCodes({ codes, onDone }) {
  return (
    <div className="fo-panel" style={{ marginTop: 12 }}>
      <p><strong>Save these recovery codes now.</strong> Each works once if you lose your authenticator. They will not be shown again.</p>
      <pre style={{ fontSize: "1.05rem", lineHeight: 1.6 }}>{codes.join("\n")}</pre>
      <Button variant="secondary" onClick={onDone}>I have saved them</Button>
    </div>
  );
}

export default function AccountSecurity() {
  const [account, setAccount] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [enroll, setEnroll] = useState(null); // { factorId, secret, otpauthUri }
  const [enrollCode, setEnrollCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [stepUp, setStepUp] = useState({ password: "", code: "" });
  const [setupPassword, setSetupPassword] = useState("");

  const load = useCallback(async () => {
    try {
      setAccount(await eosLoginClient.describeAccount());
      setLoadError(null);
    } catch (err) {
      setLoadError(eosLoginMessage(err?.code, err?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, success) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
      await load();
    } catch (err) {
      setError(eosLoginMessage(err?.code, err?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="ns-page">
        <PageHeader title="Account security" />
        <p role="alert">{loadError}</p>
      </div>
    );
  }
  if (!account) return <div className="ns-page"><PageHeader title="Account security" /><p>Loading…</p></div>;

  const totp = account.factors.find((f) => f.kind === "totp");

  return (
    <div className="ns-page">
      <PageHeader title="Account security" description={`Signed in as ${account.loginIdentifier}`} />
      <Message error={error} notice={notice} />

      <section className="fo-panel">
        <SectionHeader title="Password" description={account.passwordChangedAt ? `Last changed ${new Date(account.passwordChangedAt).toLocaleString()}` : null} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.next !== pw.confirm) { setError("The two new passwords do not match."); return; }
            act(async () => {
              await eosLoginClient.changePassword(pw.current, pw.next);
              setPw({ current: "", next: "", confirm: "" });
            }, "Password changed. Your other sessions were signed out.");
          }}
          style={{ display: "grid", gap: 10 }}
        >
          <Field label="Current password"><input className="fo-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
          <Field label="New password (12 or more characters)"><input className="fo-input" type="password" autoComplete="new-password" minLength={12} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></Field>
          <Field label="Confirm new password"><input className="fo-input" type="password" autoComplete="new-password" minLength={12} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
          <div><Button type="submit" loading={busy}>Change password</Button></div>
        </form>
      </section>

      <section className="fo-panel">
        <SectionHeader
          title="Two-step verification"
          description={totp ? `On since ${new Date(totp.confirmedAt).toLocaleDateString()} · ${account.recoveryCodesRemaining} recovery codes left`
            : account.mfaRequired ? "Required by your administrator. Set it up to continue using the system." : "Off"}
        />
        {!account.mfaConfigured ? <p>Two-step verification is not available on this system yet.</p> : null}
        {account.mfaConfigured && !totp && !enroll ? (
          <form onSubmit={(e) => { e.preventDefault(); act(async () => { setEnroll(await eosLoginClient.beginTotp(setupPassword)); setSetupPassword(""); }); }}
            style={{ display: "grid", gap: 10 }}>
            <Field label="Your current password"><input className="fo-input" type="password" autoComplete="current-password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} required /></Field>
            <div><Button type="submit" loading={busy}>Set up an authenticator app</Button></div>
          </form>
        ) : null}
        {enroll ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                setCodes(await eosLoginClient.confirmTotp(enroll.factorId, enrollCode.replace(/\s/g, "")));
                setEnroll(null);
                setEnrollCode("");
              }, "Two-step verification is on.");
            }}
            style={{ display: "grid", gap: 10 }}
          >
            <p>Add this account to your authenticator app. On a phone, <a href={enroll.otpauthUri}>open it in the app</a>; otherwise enter the key by hand:</p>
            <code style={{ fontSize: "1.05rem", letterSpacing: "0.08em", wordBreak: "break-all" }}>{enroll.secret.match(/.{1,4}/g).join(" ")}</code>
            <Field label="Then enter the six-digit code it shows"><input className="fo-input" inputMode="numeric" autoComplete="one-time-code" value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)} required /></Field>
            <div><Button type="submit" loading={busy}>Turn on</Button> <Button variant="secondary" onClick={() => setEnroll(null)}>Cancel</Button></div>
          </form>
        ) : null}
        {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> : null}
        {totp && !codes ? (
          <form onSubmit={(e) => e.preventDefault()} style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <p>To change two-step verification, confirm your password and a current code.</p>
            <Field label="Password"><input className="fo-input" type="password" autoComplete="current-password" value={stepUp.password} onChange={(e) => setStepUp({ ...stepUp, password: e.target.value })} /></Field>
            <Field label="Current six-digit code"><input className="fo-input" inputMode="numeric" autoComplete="one-time-code" value={stepUp.code} onChange={(e) => setStepUp({ ...stepUp, code: e.target.value })} /></Field>
            <div>
              <Button variant="secondary" loading={busy} onClick={() => act(async () => {
                setCodes(await eosLoginClient.regenerateRecoveryCodes(stepUp.password, stepUp.code.replace(/\s/g, "")));
                setStepUp({ password: "", code: "" });
              }, "New recovery codes issued; the old ones no longer work.")}>New recovery codes</Button>{" "}
              {account.mfaRequired ? null : (
                <Button variant="secondary" loading={busy} onClick={() => act(async () => {
                  await eosLoginClient.removeTotp(stepUp.password, stepUp.code.replace(/\s/g, ""));
                  setStepUp({ password: "", code: "" });
                }, "Two-step verification is off.")}>Turn off</Button>
              )}
            </div>
          </form>
        ) : null}
      </section>

      <section className="fo-panel">
        <SectionHeader
          title="Where you are signed in"
          actions={account.sessions.length > 1 ? (
            <Button variant="secondary" loading={busy} onClick={() => act(() => eosLoginClient.revokeOtherSessions(), "Signed out everywhere else.")}>Sign out everywhere else</Button>
          ) : null}
        />
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {account.sessions.map((s) => (
            <li key={s.sessionId} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span>{s.client ?? "Unknown device"}</span>
              <span className="fo-muted">signed in {new Date(s.createdAt).toLocaleString()} · active {new Date(s.lastRefreshedAt).toLocaleString()}</span>
              {s.current ? <strong>This device</strong> : (
                <Button variant="secondary" loading={busy} onClick={() => act(() => eosLoginClient.revokeSession(s.sessionId), "That session was signed out.")}>Sign out</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
