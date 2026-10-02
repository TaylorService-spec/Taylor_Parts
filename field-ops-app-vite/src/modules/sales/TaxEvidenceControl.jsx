import { TAX_CHOICE, TAX_EVIDENCE_WORDS, taxEvidenceDisplay } from "../../domain/taxEvidenceView.js";

// THE SMALLEST TAX CONTROL (DECISIONS #197). Two plain choices -- "Tax not yet determined" or "Tax determined" with an
// amount -- inside the Agreement's existing terms form. Zero is a real answer and is typed as 0; an empty box is never
// read as zero. An Agreement that needs confirmation starts with NEITHER choice selected, so saving unrelated terms
// leaves it exactly as recorded. No status code, rate, jurisdiction or provider appears here.

/** Read-only: what the Agreement's tax evidence says, in words. */
export function TaxEvidenceSummary({ view, className = "fo-agreement-tax" }) {
  const shown = taxEvidenceDisplay(view);
  return (
    <div className={className} data-tax-evidence={shown.kind}>
      <strong>{shown.label}</strong>
      {shown.amountText !== null ? <span className="fo-agreement-tax__amount">{` ${shown.amountText}`}</span> : null}
      {shown.note ? <p className="fo-muted">{shown.note}</p> : null}
    </div>
  );
}

/** The choice, as a controlled fieldset: value = { choice, amount }. */
export default function TaxEvidenceControl({ value, onChange, disabled = false }) {
  const set = (next) => onChange({ ...value, ...next });
  const determined = value.choice === TAX_CHOICE.DETERMINED;
  return (
    <fieldset className="fo-agreement-tax-control" disabled={disabled}>
      <legend>Tax</legend>
      <label>
        <input type="radio" name="tax-evidence" checked={value.choice === TAX_CHOICE.NOT_DETERMINED}
          onChange={() => set({ choice: TAX_CHOICE.NOT_DETERMINED })} />
        {TAX_EVIDENCE_WORDS.notDetermined}
      </label>
      <label>
        <input type="radio" name="tax-evidence" checked={determined}
          onChange={() => set({ choice: TAX_CHOICE.DETERMINED })} />
        {TAX_EVIDENCE_WORDS.determined}
      </label>
      {determined ? (
        <label>Tax amount
          <input inputMode="decimal" aria-label="Tax amount" value={value.amount} placeholder="0.00"
            onChange={(e) => set({ amount: e.target.value })} />
          <span className="fo-muted"> Enter 0 if none is due.</span>
        </label>
      ) : null}
    </fieldset>
  );
}
