// TRADE-INS ON A SALES AGREEMENT (Owner ruling #204, 2026-10-03).
//
// A salesperson PROPOSES what the customer offers -- description, manufacturer / model / serial when known, a proposed value,
// notes and an evidence reference. A proposal is not consideration: it never reduces the balance. Only an approver (the
// server's salesAgreement.tradeIn.approve -- Owner / Executive and General Manager) approves, ASSIGNING the value, or declines
// with a reason. The approved credit is what buys the balance down. Nothing here is an acquisition / book value or a resale
// price, and the page decides nothing: every proposal and decision is a governed command the server re-validates.
import { useState } from "react";
import { formatMinorUnits } from "../../domain/money.js";
import { toMinor, toMajorText } from "./salesAgreementLines.jsx";

const STATUS_WORDS = Object.freeze({ PROPOSED: "Proposed — awaiting approval", APPROVED: "Approved", DECLINED: "Declined" });
const BLANK = { description: "", manufacturer: "", modelNumber: "", serialNumber: "", proposedValue: "", notes: "", evidenceReference: "" };
const money = (minor, currency) => (typeof minor === "number" ? formatMinorUnits(minor, currency) : "—");

/** A stored item -> the proposal input the server takes (the facts only; a decision is never sent). */
export function toTradeInInput(t) {
  const out = { description: t.description, proposedValueMinor: t.proposedValueMinor };
  for (const k of ["manufacturer", "modelNumber", "serialNumber", "equipmentModelId", "notes", "evidenceReference"]) if (t[k]) out[k] = t[k];
  return out;
}

function ProposalForm({ busy, onSubmit, onCancel }) {
  const [draft, setDraft] = useState(BLANK);
  const [error, setError] = useState(null);
  const field = (id, label) => (
    <label key={id} className="ns-terms-edit__field">
      <span>{label}</span>
      <input type="text" aria-label={label} value={draft[id]} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, [id]: e.target.value }))} />
    </label>
  );
  return (
    <form className="ns-terms-edit" onSubmit={(e) => {
      e.preventDefault();
      const value = toMinor(draft.proposedValue);
      if (!draft.description.trim()) return setError("Describe the equipment being traded in.");
      if (!Number.isFinite(value) || value <= 0) return setError("The proposed value must look like 2500.00.");
      setError(null);
      const item = { description: draft.description.trim(), proposedValueMinor: value };
      for (const k of ["manufacturer", "modelNumber", "serialNumber", "notes", "evidenceReference"]) if (draft[k].trim()) item[k] = draft[k].trim();
      onSubmit(item);
    }}>
      {field("description", "Equipment description")}
      {field("manufacturer", "Manufacturer (if known)")}
      {field("modelNumber", "Model (if known)")}
      {field("serialNumber", "Serial number (if known)")}
      {field("proposedValue", "Proposed value")}
      {field("notes", "Notes")}
      {field("evidenceReference", "Evidence reference (photos, inspection)")}
      {error ? <p className="ns-action-reason" role="alert">{error}</p> : null}
      <div className="ns-terms-edit__actions">
        <button type="submit" className="fo-button fo-button--primary" disabled={busy}>Propose trade-in</button>
        <button type="button" className="fo-button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Decision({ item, currency, busy, onApprove, onDecline }) {
  const [value, setValue] = useState(toMajorText(item.proposedValueMinor));
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  return (
    <div className="ns-terms-edit__actions">
      <label className="ns-terms-edit__field">
        <span>Approved value</span>
        <input type="text" aria-label={`Approved value for item ${item.itemNumber}`} value={value} disabled={busy} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label className="ns-terms-edit__field">
        <span>Reason</span>
        <input type="text" aria-label={`Decision reason for item ${item.itemNumber}`} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" className="fo-button fo-button--primary" disabled={busy} onClick={() => {
        const minor = toMinor(value);
        if (!Number.isFinite(minor) || minor <= 0) return setError(`The approved value must look like ${toMajorText(item.proposedValueMinor) || "2500.00"}.`);
        setError(null);
        onApprove({ itemNumber: item.itemNumber, approvedCreditMinor: minor, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      }}>Approve trade-in {item.itemNumber}</button>
      <button type="button" className="fo-button" disabled={busy} onClick={() => {
        if (!reason.trim()) return setError("A declined trade-in states its reason.");
        setError(null);
        onDecline({ itemNumber: item.itemNumber, reason: reason.trim() });
      }}>Decline trade-in {item.itemNumber}</button>
      {error ? <p className="ns-action-reason" role="alert">{error}</p> : null}
      <p className="ns-section__note">Proposed at {money(item.proposedValueMinor, currency)}. The value you approve is the credit.</p>
    </div>
  );
}

export default function TradeInSection({ tradeIns = [], currency = "USD", editable = false, mayApprove = false, pending = null, commandError = null,
  onPropose, onApprove, onDecline }) {
  const [proposing, setProposing] = useState(false);
  const busy = pending !== null;
  if (tradeIns.length === 0 && !editable) return null;
  return (
    <div>
      {tradeIns.length === 0 ? <p className="ns-section__note">No trade-in has been proposed.</p> : (
        <div className="ns-table-wrap">
          <table className="ns-table" aria-label="Trade-ins">
            <thead>
              <tr>
                <th scope="col">Equipment</th>
                <th scope="col" className="ns-num">Proposed value</th>
                <th scope="col">Status</th>
                <th scope="col" className="ns-num">Trade-in credit</th>
              </tr>
            </thead>
            <tbody>
              {tradeIns.map((t) => (
                <tr key={t.itemNumber}>
                  <td>
                    <span>{t.description}</span>
                    <span className="ns-line-sub">
                      {[t.manufacturer, t.modelNumber, t.serialNumber ? `serial ${t.serialNumber}` : "serial not known"].filter(Boolean).join(" · ")}
                    </span>
                    {t.notes ? <span className="ns-line-sub">{t.notes}</span> : null}
                    {mayApprove && t.approvalStatus === "PROPOSED" ? (
                      <Decision item={t} currency={currency} busy={busy} onApprove={onApprove} onDecline={onDecline} />
                    ) : null}
                  </td>
                  <td className="ns-num">{money(t.proposedValueMinor, currency)}</td>
                  <td>{STATUS_WORDS[t.approvalStatus] ?? <span className="ns-state--na">Not recorded</span>}{t.approvalStatus === "DECLINED" && t.decisionReason ? ` — ${t.decisionReason}` : ""}</td>
                  <td className="ns-num">{t.approvalStatus === "APPROVED" ? money(t.approvedCreditMinor, currency) : <span className="ns-state--na">None until approved</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ns-section__note">A proposed trade-in does not reduce the balance until it is approved.</p>
      {editable ? (proposing ? (
        <ProposalForm busy={busy} onCancel={() => setProposing(false)} onSubmit={async (item) => {
          const outcome = await onPropose([...tradeIns.map(toTradeInInput), item]);
          if (outcome?.ok) setProposing(false);
        }} />
      ) : (
        <button type="button" className="fo-button" disabled={busy} onClick={() => setProposing(true)}>Propose a trade-in</button>
      )) : null}
      {commandError ? <p className="ns-action-reason" data-restriction="command">{commandError}</p> : null}
    </div>
  );
}
