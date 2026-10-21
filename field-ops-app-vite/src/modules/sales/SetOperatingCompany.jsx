import { useRef, useState } from "react";
import { assignRecordOperatingCompany } from "../../services/opportunityCommandClient.js";
import { operatingCompanyLabel } from "../../shared/display/displayLabels.js";

// SET THE OPERATING COMPANY OF A RECORD THAT HAS NONE (CLC; DECISIONS #CLC).
//
// THE CLIENT DECIDES NOTHING. The record page mounts this ONLY when the server's own read of the record carries `operatingCompanyAssignment` -- the server
// states that the record is company-less, that the caller may assign, and exactly which companies the caller may choose. This component names no capability,
// derives no company and keeps no copy of the rule. Every attempt is re-decided on the server (capability, that the record is visible and still company-less,
// that the caller reaches the company, that the company agrees with the lineage) and a refusal is shown in plain words, with the server's own words as the fallback.
//
// IT HAPPENS ONCE. The company cannot be changed or cleared afterwards, so the control says so before it asks, and a reason is required (it is recorded in the
// audit trail).
//
// IDEMPOTENCY. One key per attempt (record, company, reason), kept across a failed attempt so a retry replays rather than applying twice, dropped on success.

const MAX_REASON = 500;
const newKey = () => `clc-${typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const WORDS = Object.freeze({
  REASON_REQUIRED: "Say why the operating company is being set.",
  REASON_TOO_LONG: `The reason is too long (${MAX_REASON} characters at most).`,
  OPERATING_COMPANY_ALREADY_SET: "This record already has an operating company. It is set once and cannot be changed here.",
  LINEAGE_DISAGREEMENT: "The operating company has to match the records this one belongs to. Set it on the Opportunity first; the agreement follows it.",
  COMPANY_TRANSFER_DECISION_REQUIRED: "The person who created this record does not work in that company, so it can't be moved there from here. Moving a record into another company needs a separate decision.",
  OPERATING_COMPANY_NOT_GOVERNED: "That operating company is not available to you.",
  RECORD_NOT_FOUND: "This record could not be found. Reload the page.",
  CAPABILITY_REQUIRED: "You are not authorized to set an operating company.",
  IDEMPOTENCY_KEY_REUSED: "That request was already used for a different record. Reload the page and try again.",
});

const FAMILY_WORDS = Object.freeze({ OPPORTUNITY: "opportunity", SALES_AGREEMENT: "sales agreement" });

/**
 * @param {{ family: "OPPORTUNITY" | "SALES_AGREEMENT", recordId: string, assignment: { companies: { operatingCompanyId: string }[] } | null | undefined,
 *   onApplied?: () => void, assign?: typeof assignRecordOperatingCompany }} props
 */
export default function SetOperatingCompany({ family, recordId, assignment, onApplied, assign = assignRecordOperatingCompany }) {
  const companies = Array.isArray(assignment?.companies) ? assignment.companies : [];
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keys = useRef({});
  if (companies.length === 0) return null; // the server did not offer it

  const chosen = companies.some((c) => c.operatingCompanyId === companyId) ? companyId : companies[0].operatingCompanyId;
  const trimmed = reason.trim();
  const canSave = !busy && trimmed !== "" && trimmed.length <= MAX_REASON;

  const save = async () => {
    const attempt = `${recordId}|${chosen}|${trimmed}`;
    keys.current[attempt] ??= newKey();
    setBusy(true);
    setError(null);
    try {
      const answer = await assign({ family, recordId, operatingCompanyId: chosen, reason: trimmed, idempotencyKey: keys.current[attempt] });
      if (answer.errorStatus) {
        setError(WORDS[answer.errorDetail] ?? answer.message ?? "The operating company could not be set. Try again.");
        return;
      }
      delete keys.current[attempt]; // finished: the next click is a new intent
      setOpen(false);
      setReason("");
      onApplied?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ns-attention-strip" aria-label="Operating company not set">
      <span className="ns-attention-strip__label">Operating company</span>
      <span className="ns-attention-strip__body">
        Not set. Until it is, this {FAMILY_WORDS[family] ?? "record"} is visible only to its owner, its creator and the administrators.
      </span>
      {!open ? (
        <button type="button" className="fo-link-button ns-attention-strip__action" onClick={() => setOpen(true)}>Set operating company →</button>
      ) : (
        <form className="ns-attention-strip__form" onSubmit={(e) => { e.preventDefault(); if (canSave) save(); }}>
          <p className="fo-muted" role="note">You can set this once. It cannot be changed or cleared afterwards.</p>
          <div className="fo-field">
            <label htmlFor="clc-company">Operating company</label>
            <select id="clc-company" className="fo-input" value={chosen} disabled={busy} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => <option key={c.operatingCompanyId} value={c.operatingCompanyId}>{operatingCompanyLabel(c.operatingCompanyId, { short: false })}</option>)}
            </select>
          </div>
          <div className="fo-field">
            <label htmlFor="clc-reason">Reason (required)</label>
            <textarea id="clc-reason" className="fo-input" rows={2} maxLength={MAX_REASON} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error ? <p role="alert" className="ns-action-reason">{error}</p> : null}
          <div className="fo-btn-row">
            <button type="submit" className="fo-button" disabled={!canSave}>{busy ? "Setting…" : "Set operating company"}</button>
            <button type="button" className="fo-btn-secondary" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
