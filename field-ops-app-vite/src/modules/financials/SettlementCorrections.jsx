// SETTLEMENT CORRECTIONS — in the PostgreSQL Finance workspace (Financials Overview). Owner direction 2026-10-14.
//
// Lets an authorized Finance employee correct a recorded settlement with the EXISTING governed operations -- nothing new on
// the server:
//   * REVERSE an application (reverseSettlementApplication {applicationId, reason, idempotencyKey}) -- finance.settlement.correct.
//     A reversal fact is recorded; the obligation's outstanding balance and the settlement's unapplied amount go back up.
//   * VOID a settlement (voidFinancialSettlement {settlementId, reason}) -- finance.settlement.correct. Only a settlement with
//     no live application can be voided (the database refuses otherwise: SETTLEMENT_HAS_APPLICATIONS).
// Nothing is ever deleted or edited: the original settlement, its applications and every fact stay in history.
//
// It decides nothing. The rows are the server's (listSettlements, company-scoped); the actions are offered only where the
// server's company access says `correct` is held for the settlement's company (readMyFinanceCompanyAccess), and the server
// decides each command again. Each confirmation states the financial consequence and requires a reason; a REVERSE keeps one
// idempotency key per confirmation, so a double submit is a replay, never a second reversal.
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader, Button, StatusIndicator } from "../../shared/ui/primitives";
import { Field } from "../../shared/ui/form";
import { formatMinorUnits } from "../../domain/money.js";
import { operatingCompanyLabel, statusLabel } from "../../shared/display/displayLabels.js";

const money = (minor, currency = "USD") => (minor === null || minor === undefined ? "—" : formatMinorUnits(Number(minor), currency));
const SETTLEMENT_WORDS = Object.freeze({ CUSTOMER_PAYMENT: "Customer Payment", PROVIDER_FUNDING: "Provider Funding", VENDOR_PAYMENT: "Vendor Payment",
  INTERCOMPANY_PAYMENT: "Intercompany Payment", INTERCOMPANY_RECEIPT: "Intercompany Receipt" });
const SETTLEMENT_STATUS_WORDS = Object.freeze({ RECORDED: "Recorded", VOID: "Void" });
const RECONCILIATION_WORDS = Object.freeze({ UNRECONCILED: "Not yet reconciled", RECONCILED: "Reconciled", MISMATCH: "Mismatch", NOT_APPLICABLE: "—" });

/** The server's refusal, in words; the server's own message is shown too, never swallowed. */
export const CORRECTION_REFUSAL_WORDS = Object.freeze({
  CAPABILITY_REQUIRED: "Your Security Roles do not include settlement corrections.",
  OUTSIDE_OPERATING_COMPANY_SCOPE: "Your Financials access does not cover this operating company.",
  SETTLEMENT_NOT_FOUND: "That settlement no longer exists, or is outside your companies. Refresh and try again.",
  APPLICATION_NOT_FOUND: "That application no longer exists, or is outside your companies. Refresh and try again.",
  SETTLEMENT_HAS_APPLICATIONS: "This settlement still has applied amounts. Reverse each application before voiding it.",
  FINANCING_FUNDED: "This provider funding is complete (FUNDED). Reversing it is a correction with the financing provider, not in EOS.",
  REASON_REQUIRED: "A reason is required.",
});
const refusalText = (res) => [CORRECTION_REFUSAL_WORDS[res?.reason] ?? null, res?.message ?? "The correction was refused."].filter(Boolean).join(" ");

const freshKey = () => `corr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** The confirmation: the consequence in words, a required reason, Confirm / Keep It. */
function ConfirmCorrection({ id, title, consequence, confirmLabel, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <div role="group" aria-label={`Confirm: ${title}`} data-confirm={id} className="fo-panel">
      <p><strong>{title}</strong></p>
      <p>{consequence}</p>
      <Field label="Reason (Required, Kept in the Financial History)">
        <input className="fo-input" aria-label={`Reason for ${title}`} value={reason} maxLength={500} disabled={busy} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="fo-form-actions">
        <Button variant="destructive" disabled={busy || reason.trim() === ""} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Keep It</Button>
      </div>
    </div>
  );
}

export default function SettlementCorrections({ callApi, company, access, refreshToken = 0, onCorrected }) {
  const [rows, setRows] = useState(null);
  const [failure, setFailure] = useState(null);
  const [open, setOpen] = useState(null);         // settlement id whose correction panel is open
  const [confirming, setConfirming] = useState(null); // { kind: "reverse" | "void", id, key? }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const correctable = (companyId) => access?.companies?.some((c) => c.operatingCompanyId === companyId && c.actions?.correct === true) === true;

  // Only the LATEST request may draw: a slow answer for a company the person has since left is dropped.
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (!company) return;
    const mine = ++sequence.current;
    const res = await callApi("listSettlements", { operatingCompanyId: company });
    if (mine !== sequence.current) return;
    if (!res.ok) { setRows(null); setFailure(refusalText(res)); return; }
    setFailure(null);
    setRows(res.result?.items ?? []);
  }, [callApi, company]);
  // A different company starts clean; a workspace refresh re-reads the list without closing what the person is typing.
  useEffect(() => { setOpen(null); setConfirming(null); setNotice(null); setFailure(null); setRows(null); }, [company]);
  useEffect(() => { load(); }, [load, refreshToken]);

  // The company the person is looking at NOW: an answer that comes back after a switch is not announced under another company.
  const currentCompany = useRef(company);
  currentCompany.current = company;
  const run = async (operation, input, done) => {
    const startedFor = company;
    setBusy(true); setNotice(null);
    const res = await callApi(operation, input);
    setBusy(false);
    if (currentCompany.current !== startedFor) return;
    if (!res.ok) { setNotice({ tone: "danger", text: refusalText(res) }); return; }
    const replayed = res.result?.outcome === "replayed";
    setNotice({ tone: "positive", text: replayed ? `${done.already} Nothing changed.` : done.text });
    setConfirming(null);
    // Always refresh: even a replay means someone else corrected it, so the workspace's balances may be out of date. The
    // workspace reload re-reads this list too (refreshToken); without a workspace, re-read it here.
    if (onCorrected) await onCorrected(); else await load();
  };

  if (!company) return null;
  return (
    <section className="fo-panel" aria-label="Settlements and corrections">
      <SectionHeader title="Settlements and Corrections"
        description="Recent settlements and where each was applied. A mistake is corrected by reversing an application or voiding a settlement; nothing is deleted, and every step stays in the financial history." />
      {failure && <p className="fo-muted" role="status">{failure}</p>}
      {notice && <StatusIndicator tone={notice.tone}>{notice.text}</StatusIndicator>}
      {rows && rows.length === 0 && <p className="fo-muted">No settlements recorded for this selection.</p>}
      {rows && rows.length > 0 && (
        <table className="fo-table">
          <thead><tr><th>Company</th><th>Date</th><th>Kind</th><th>Reference</th><th>Amount</th><th>Applied</th><th>Unapplied</th><th>Status</th><th>Reconciliation</th><th>Correct</th></tr></thead>
          <tbody>
            {rows.map((s) => {
              const live = (s.applications ?? []).filter((a) => a.status === "APPLIED");
              const canCorrect = correctable(s.operatingCompanyId);
              return (
                <tr key={s.id} data-settlement={s.id}>
                  <td>{operatingCompanyLabel(s.operatingCompanyId) || "—"}</td><td>{s.businessDate}</td><td>{statusLabel(s.kind, SETTLEMENT_WORDS)}</td>
                  <td>{s.sourceReference}</td><td>{money(s.amountMinor, s.currency)}</td>
                  {/* A VOID settlement no longer counts as money received or paid: no applied / unapplied amount is shown for it. */}
                  <td>{s.status === "VOID" ? "—" : money(s.appliedMinor, s.currency)}</td><td>{s.status === "VOID" ? "—" : money(s.unappliedMinor, s.currency)}</td>
                  <td>{statusLabel(s.status, SETTLEMENT_STATUS_WORDS)}{s.voidReason ? ` — ${s.voidReason}` : ""}</td>
                  <td>{statusLabel(s.reconciliationStatus, RECONCILIATION_WORDS)}</td>
                  <td>
                    {!canCorrect ? <span className="fo-muted">Not available to you</span>
                      : s.status === "VOID" ? <span className="fo-muted">Void — final</span>
                        : (
                          <>
                            <Button size="sm" variant="secondary" disabled={busy} aria-expanded={open === s.id}
                              aria-label={`${open === s.id ? "Close corrections for" : "Correct"} ${s.sourceReference} (${operatingCompanyLabel(s.operatingCompanyId) || s.operatingCompanyId}, ${s.businessDate})`}
                              onClick={() => { setOpen(open === s.id ? null : s.id); setConfirming(null); }}>
                              {open === s.id ? "Close" : `Correct ${s.sourceReference}`}
                            </Button>
                            {open === s.id && (
                              <div aria-label={`Corrections for ${s.sourceReference}`} role="region">
                                <p className="fo-muted">Applications</p>
                                {(s.applications ?? []).length === 0 && <p className="fo-muted">Not applied to any obligation.</p>}
                                <ul>
                                  {(s.applications ?? []).map((a) => (
                                    <li key={a.id} data-application={a.id}>
                                      {money(a.amountMinor, s.currency)} to obligation {a.obligationId} —{" "}
                                      {a.status === "REVERSED" ? `reversed${a.reversalReason ? `: ${a.reversalReason}` : ""}` : "applied"}
                                      {a.status === "APPLIED" && (confirming?.kind === "reverse" && confirming.id === a.id ? (
                                        <ConfirmCorrection id={`reverse-${a.id}`} title={`Reverse ${money(a.amountMinor, s.currency)} applied to ${a.obligationId}`}
                                          consequence={`The obligation's outstanding balance goes back up by ${money(a.amountMinor, s.currency)} and the settlement's unapplied amount rises by the same. A reversal is recorded; the original application stays in the history. The money itself is not refunded.`}
                                          confirmLabel="Reverse Application" busy={busy}
                                          onConfirm={(reason) => run("reverseSettlementApplication", { applicationId: a.id, reason, idempotencyKey: confirming.key },
                                            { text: "Application reversed.", already: "This application was already reversed." })}
                                          onCancel={() => setConfirming(null)} />
                                      ) : (
                                        <Button size="sm" variant="destructive" disabled={busy} aria-label={`Reverse ${money(a.amountMinor, s.currency)} applied to ${a.obligationId}`}
                                          onClick={() => setConfirming({ kind: "reverse", id: a.id, key: freshKey() })}>
                                          Reverse {money(a.amountMinor, s.currency)}
                                        </Button>
                                      ))}
                                    </li>
                                  ))}
                                </ul>
                                {confirming?.kind === "void" && confirming.id === s.id ? (
                                  <ConfirmCorrection id={`void-${s.id}`} title={`Void settlement ${s.sourceReference} (${money(s.amountMinor, s.currency)})`}
                                    consequence="The settlement is marked VOID: it no longer counts as money received or paid, and it can no longer be applied or reconciled. It stays in the history with your reason; the correct settlement can then be recorded as its replacement."
                                    confirmLabel="Void Settlement" busy={busy}
                                    onConfirm={(reason) => run("voidSettlement", { settlementId: s.id, reason }, { text: "Settlement voided.", already: "This settlement was already void." })}
                                    onCancel={() => setConfirming(null)} />
                                ) : (
                                  <>
                                    <Button size="sm" variant="destructive" disabled={busy || live.length > 0} onClick={() => setConfirming({ kind: "void", id: s.id })}>
                                      Void Settlement
                                    </Button>
                                    {live.length > 0 && <span className="fo-wizard-hint"> Reverse its {live.length === 1 ? "application" : `${live.length} applications`} first.
                                      {s.kind === "PROVIDER_FUNDING" ? " Provider funding that has completed (FUNDED) cannot be reversed in EOS; it is corrected with the financing provider." : ""}</span>}
                                  </>
                                )}
                              </div>
                            )}
                          </>
                        )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
