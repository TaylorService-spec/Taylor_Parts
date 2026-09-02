// FINANCIALS NORTH STAR P1 — shared page primitives for the /financials family.
//
// Extracted because every Wave UX-1 page needs them (shared-component rule: two real
// pages minimum). Design authority: docs/north-star/financials/*.dc.html — the parchment
// North Star grammar: fact-class sublabels, serif figures, seg filters, hover-ⓘ
// annotations whose tooltip carries contract copy while only the contract sentence stays
// visible. No financial authority lives here: these render facts and honest states they
// are handed.

import { useState } from "react";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import HonestState from "../../shared/ui/HonestState.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { formatMoneyDisplay } from "../../domain/moneyDisplay.js";
import {
  FACT_CLASS_WORDS,
  COMPANY_FILTER_OPTIONS,
  BUSINESS_UNIT_FILTER_OPTIONS,
} from "../../domain/financialsSurface.js";
import { PERIOD_PRESETS, periodNote } from "../../domain/financialsPeriod.js";

// ─── Hover-ⓘ annotation (the design's binding convention: .hlp/.tip) ───
// Only contract copy stays visible; the explanation sits behind a focusable ⓘ. Rendered
// as a button for keyboard reach; the tooltip is aria-described so screen readers get the
// same sentence sighted users hover for.
let annotationSeq = 0;
export function FinAnnotation({ tip }) {
  const [id] = useState(() => `fin-tip-${(annotationSeq += 1)}`);
  return (
    <span className="fin-hlp-wrap">
      <button type="button" className="fin-hlp" aria-describedby={id} aria-label="Explanation">
        i
      </button>
      <span role="tooltip" id={id} className="fin-tip">
        {tip}
      </span>
    </span>
  );
}

// ─── Fact-class sublabel — the typographic law of the family. ───
export function FactClassLabel({ factClass, derivation = null }) {
  const words = FACT_CLASS_WORDS[factClass] ?? factClass;
  return <span className="fin-factclass">{derivation ? `${words} · ${derivation}` : words}</span>;
}

// ─── One scorecard figure slot. ───
// `valueMinor` present → formatted from integer minor units (display only, never
// arithmetic). Absent → the slot stays, with the honest word for WHY, never a zero.
// `valueText` carries an ALREADY-FORMATTED amount for figures whose source is a per-currency map
// the server computed (domain/financialFactsView.js's formatByCurrency, which lists currencies
// separately and never sums across them). It exists so a multi-currency figure stays honest in a
// slot that was built for one scalar — `valueMinor` remains the path for single-currency callers.
export function FinancialFigure({ label, valueMinor = null, valueText = null, currency = "USD", factClass, derivation = null, absence = null, detail = null }) {
  return (
    <div className="fin-figure">
      <div className="fin-figure__label">{label}</div>
      {valueText != null ? (
        <div className="fin-figure__value">{valueText}</div>
      ) : valueMinor != null ? (
        <div className="fin-figure__value">{formatMoneyDisplay(valueMinor, currency)}</div>
      ) : (
        <div className="fin-figure__absence">
          {absence ?? "Not activated"}
          {detail ? <FinAnnotation tip={detail} /> : null}
        </div>
      )}
      <FactClassLabel factClass={factClass} derivation={derivation} />
    </div>
  );
}

// ─── Measurement-basis chip (pages 08/10/13): the basis is unmissable, in its own slot. ───
export function BasisChip({ basis }) {
  return <span className="fin-basis">{basis}</span>;
}

// ─── The shared filter rail: Company · Business Unit · Period. ───
// Identical wording and order on every Financials page (design contract). These controls
// parameterize governed read requests only — they are never client-side visibility
// authority, and with reads unactivated they narrow nothing but the request they would send.
export function FinancialsFilterRail({
  company,
  onCompanyChange,
  businessUnit = null,
  onBusinessUnitChange = null,
  periodLabel = "Period — all activity",
  period = null,
}) {
  return (
    <div className="fin-filter-rail">
      <FilterBar
        variant="chips"
        label="Company"
        options={COMPANY_FILTER_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
        activeKey={company}
        onChange={onCompanyChange}
      />
      {onBusinessUnitChange ? (
        <FilterBar
          variant="chips"
          label="Business unit"
          options={BUSINESS_UNIT_FILTER_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
          activeKey={businessUnit}
          onChange={onBusinessUnitChange}
        />
      ) : null}
      {period ? (
        <FinancialsPeriodControl {...period} />
      ) : (
        <span className="fin-period">
          {periodLabel}
          <FinAnnotation tip="The shared Financials filter grammar: Company (Consolidated / Taylor / Ventana), Business Unit, Period. Company is a governed dimension — never inferred from location, warehouse, manufacturer, route or free text. This surface does not filter by period: its read exposes no period contract, so a control here would be a promise it could not keep." />
        </span>
      )}
    </div>
  );
}

// ─── The period control. A REAL filter, not a footnote. ───
//
// It narrows on the SERVER: the selection becomes periodStartMillis/periodEndMillis on the
// governed read, so records outside the window are never sent. Nothing here filters a broader
// result in the browser, which would leave the client holding facts the user did not ask for.
//
// An invalid custom range is NOT issued as a request. Sending a backwards window would return a
// correct empty result that reads to the user as "no records" when the truth is "that range is
// backwards" — so the validation message stands in its place until it is fixed.
export function FinancialsPeriodControl({ presetKey, onPresetChange, custom, onCustomChange, invalidReason = null }) {
  return (
    <div className="fin-period-control">
      <label className="fin-period__label" htmlFor="fin-period-select">
        Period
        <FinAnnotation tip="Period narrows the governed read on the server — applied to the records your visibility scope already reaches, and it can only ever remove rows. EACH FACT IS JUDGED BY ITS OWN EVENT DATE: an invoice by the date it was issued, a payment by the date the cash was received, an application by the date it was recorded. The window includes both days you choose." />
      </label>
      <select
        id="fin-period-select"
        className="fin-period__select"
        value={presetKey}
        onChange={(e) => onPresetChange(e.target.value)}
      >
        {PERIOD_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      {presetKey === "custom" ? (
        <div className="fin-period__range">
          <label className="fin-period__field">
            <span>From</span>
            <input
              type="date"
              className="fin-period__date"
              value={custom.from ?? ""}
              onChange={(e) => onCustomChange({ ...custom, from: e.target.value })}
            />
          </label>
          <label className="fin-period__field">
            <span>To</span>
            <input
              type="date"
              className="fin-period__date"
              value={custom.to ?? ""}
              onChange={(e) => onCustomChange({ ...custom, to: e.target.value })}
            />
          </label>
        </div>
      ) : null}
      {/* EXPLANATORY ONLY. Deliberately not role="alert" and not styled as a warning: nothing has
          gone wrong, and a permanent alert beside a working control teaches people to ignore alerts.
          It is tied to the SELECTION, so it appears where it explains something and nowhere else. */}
      {periodNote(presetKey) ? <p className="fin-period__note">{periodNote(presetKey)}</p> : null}
      {invalidReason ? (
        <p className="fin-period__invalid" role="alert">
          {invalidReason} No read was issued.
        </p>
      ) : null}
    </div>
  );
}

// ─── The family page frame: crumb, rule pair, custody sentence, filter rail slot. ───
export function FinancialsPageFrame({ title, crumb, custody = null, custodyTip = null, summaryItems = [], action = null, children }) {
  return (
    <WorkspaceIdentity
      crumb={`Financials → ${crumb}`}
      title={title}
      description={custody}
      summaryItems={summaryItems}
      action={action}
    >
      {custodyTip ? (
        <p className="fin-custody-note">
          Operational financial subledger — not the general ledger.
          <FinAnnotation tip={custodyTip} />
        </p>
      ) : null}
      {children}
    </WorkspaceIdentity>
  );
}

// ─── A section whose body is a single honest state (the truthful composition for a
// fact family whose read is dormant / unwired / denied). ───
// `footer` renders AFTER the honest state. Cross-page links passed as `children` landed
// between the table's column headers and the empty-state box, which read as though the
// links belonged to a table that had not started yet.
export function FinancialsHonestSection({ id, title, meta = null, honest, subject, children = null, footer = null }) {
  return (
    <section id={id} className="ns-section" aria-label={title}>
      <div className="ns-section__head">
        <h2 className="ns-section__title">{title}</h2>
        {meta ? <span className="ns-section__meta">· {meta}</span> : null}
      </div>
      {children}
      {honest?.state ? (
        <HonestState state={honest.state} subject={subject} detail={honest.detail ?? null} />
      ) : null}
      {footer}
    </section>
  );
}
