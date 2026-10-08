// ANALYSIS WORKSPACE — on /analysis (Analysis & Reporting, DECISIONS #208).
//
// FACTS -> MEASURES -> COMPARISONS -> VARIANCES -> DRIVERS -> EXCEPTIONS -> INSIGHTS -> AUTHORIZED ACTIONS, exception-first, per
// persona area (Owner / GM, Finance, Retail Sales, National Accounts, Service, Parts / Purchasing, Warehouse, Rental) and per
// company (Taylor, Ventana, or the Consolidated reporting projection).
//
// It decides nothing and computes nothing: every figure, basis, quality state, comparison, driver and exception is the server's
// (/operations/analysis), each measure authorized on its own EXISTING read. A refused measure shows why; an absent one shows why;
// a missing figure is never shown as zero. An action is offered only when the server says the caller already holds it -- and it
// runs on its own governed route, never here. No AI.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, SectionHeader, Button, StatusIndicator } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callAnalysisApi } from "../../services/analysisApiClient";
import { formatMinorUnits } from "../../domain/money.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";
import { operatingCompanyLabel, statusLabel, titleCase, titleCasePhrase } from "../../shared/display/displayLabels.js";

// Company names come from the governed table; "consolidated" is the reporting projection, not a company.
const COMPANIES = [["consolidated", "Consolidated (Reporting View)"], ["taylor", operatingCompanyLabel("taylor")], ["ventana", operatingCompanyLabel("ventana")]];
const PERIODS = [["MTD", "Month to Date"], ["QTD", "Quarter to Date"], ["YTD", "Year to Date"], ["T12M", "Trailing 12 Months"], ["DAY", "Today"]];
export const BASIS_WORDS = Object.freeze({ ACCOUNTING_ACTUAL: "Accounting Actual", EOS_OPERATIONAL_ACTUAL: "EOS Operational Actual",
  EOS_OPERATIONAL_ESTIMATE: "EOS Operational Estimate", FORECAST: "Forecast", TARGET_BUDGET: "Target / Budget" });
const QUALITY_WORDS = Object.freeze({ COMPLETE: "Complete", PARTIAL: "Partial", MISSING_PRICE: "Missing Price" });

/** A figure in words -- money per currency (never summed across currencies), counts, quantities, ratios. Null stays "—". */
export function figure(unit, value, aggregate) {
  if (unit === "MONEY") {
    const entries = Object.entries(aggregate?.money ?? {});
    if (entries.length === 0) return aggregate?.missingAmount ? "— (price missing)" : formatMinorUnits(0, "USD");
    return entries.map(([c, m]) => formatMinorUnits(Number(m), c)).join(" · ");
  }
  if (value === null || value === undefined) return "—";
  if (unit === "RATIO") return `${(Number(value) * 100).toFixed(1)}%`;
  if (unit === "UNIT_DAYS") return `${value} unit-days`;
  return String(value);
}

function variance(m) {
  const v = m.comparison?.variance;
  if (!v) return m.comparison?.notComparableReason ?? null;
  if (v.byCurrency) {
    return Object.entries(v.byCurrency).map(([c, x]) => `${BigInt(x.delta) >= 0n ? "+" : ""}${formatMinorUnits(Number(x.delta), c)} vs prior${x.percent === null ? "" : ` (${x.percent}%)`}`).join(" · ");
  }
  return `${v.delta >= 0 ? "+" : ""}${v.delta} vs prior${v.percent === null ? "" : ` (${v.percent}%)`}`;
}

function MeasureCard({ m, onOpen }) {
  return (
    <article className="fo-panel" aria-label={m.name}>
      <SectionHeader title={m.name} description={`${statusLabel(m.basis, BASIS_WORDS)}${m.status === "COMPUTED" ? ` · ${statusLabel(m.quality.state, QUALITY_WORDS)}` : ""}`} />
      {m.status === "COMPUTED" ? (
        <>
          <p><strong>{figure(m.unit, m.value.value, m.aggregate)}</strong></p>
          {variance(m) && <p className="fo-muted">{variance(m)}</p>}
          {m.quality.notes.map((note) => <p key={note} className="fo-muted">{note}</p>)}
          <Button size="sm" variant="secondary" onClick={() => onOpen(m.id)}>Explain {m.name}</Button>
        </>
      ) : (
        <p className="fo-muted">{m.status === "REFUSED" ? `Not available to you — ${m.reason}` : m.reason}</p>
      )}
    </article>
  );
}

// ════════ RESULT TABLES — header sorting over rows the server already returned; no sort = the server's order ════════

const actionWords = (x) => (x.action
  ? (x.action.available ? x.action.label : `${x.action.label} — needs ${titleCase(x.action.capability)} access`)
  : "No governed action here");
const EXCEPTION_SORT_COLUMNS = Object.freeze({
  severity: { value: (x) => statusLabel(x.severity) },
  what: { value: (x) => x.rule },
  record: { value: (x) => x.label ?? x.recordId },
  company: { value: (x) => operatingCompanyLabel(x.operatingCompanyId) },
  action: { value: actionWords },
});

function ExceptionTable({ rows }) {
  const { sort, toggle, sorted } = useTableSort({ rows, columns: EXCEPTION_SORT_COLUMNS });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table fo-table--stack">
      <thead><tr>{th("severity", "Severity")}{th("what", "What")}{th("record", "Record")}{th("company", "Company")}{th("action", "Action")}</tr></thead>
      <tbody>{sorted.map((x) => (
        <tr key={`${x.kind}-${x.recordId}`}><td>{statusLabel(x.severity)}</td><td>{x.rule}</td><td>{x.label ?? x.recordId}</td><td>{operatingCompanyLabel(x.operatingCompanyId)}</td>
          <td>{actionWords(x)}</td></tr>))}</tbody>
    </table>
  );
}

const companyKeyLabel = (k) => operatingCompanyLabel(k);
const plainKeyLabel = (k) => k;
const driverValue = (detail, d) => (detail.unit === "COUNT" ? d.count : detail.unit === "RATIO" ? d.ratio : d.quantity);
// Money sorts only when the row is single-currency; a multi-currency figure is never summed into one number.
const driverSortValue = (detail, d) => {
  if (detail.unit === "MONEY") {
    const amounts = Object.values(d.money ?? {});
    return amounts.length === 1 ? Number(amounts[0]) : null;
  }
  const v = driverValue(detail, d);
  return v === null || v === undefined ? null : Number(v);
};

function DriverTable({ detail, rows, keyHeader, keyLabel }) {
  const columns = useMemo(() => ({
    key: { value: (d) => keyLabel(d.key) },
    figure: { value: (d) => driverSortValue(detail, d) },
    records: { value: (d) => (typeof d.count === "number" ? d.count : null) },
  }), [detail, keyLabel]);
  const { sort, toggle, sorted } = useTableSort({ rows, columns });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table fo-table--stack"><thead><tr>{th("key", keyHeader)}{th("figure", "Figure")}{th("records", "Records")}</tr></thead>
      <tbody>{sorted.map((d) => <tr key={d.key}><td>{keyLabel(d.key)}</td><td>{figure(detail.unit, driverValue(detail, d), d)}</td><td>{d.count}</td></tr>)}</tbody></table>
  );
}

const drillWords = (s) => (s.drill ? `${titleCase(s.drill.operation)} (${s.drill.route})` : "—");
const SOURCE_SORT_COLUMNS = Object.freeze({
  record: { value: (s) => s.label ?? s.recordId },
  company: { value: (s) => operatingCompanyLabel(s.operatingCompanyId) },
  dimension: { value: (s) => (s.dimension ? statusLabel(s.dimension) : null) },
  amount: { value: (s) => (s.amountMinor !== null && s.amountMinor !== undefined ? Number(s.amountMinor) : (typeof s.quantity === "number" ? s.quantity : null)) },
  drill: { value: (s) => (s.drill ? drillWords(s) : null) },
});

function SourceTable({ detail }) {
  const { sort, toggle, sorted } = useTableSort({ rows: detail.provenance.sources, columns: SOURCE_SORT_COLUMNS });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  const dimension = detail.provenance.definition.dimension;
  return (
    <table className="fo-table fo-table--stack"><thead><tr>{th("record", "Record")}{th("company", "Company")}{th("dimension", dimension ? titleCasePhrase(dimension) : "Detail")}{th("amount", "Amount / Quantity")}{th("drill", "Open With")}</tr></thead>
      <tbody>{sorted.map((s) => (
        <tr key={`${s.recordId}-${s.dimension}`}><td>{s.label ?? s.recordId}</td><td>{operatingCompanyLabel(s.operatingCompanyId)}</td><td>{s.dimension ? statusLabel(s.dimension) : "—"}</td>
          <td>{s.amountMinor !== null && s.amountMinor !== undefined ? formatMinorUnits(Number(s.amountMinor), s.currency ?? "USD") : (detail.unit === "MONEY" ? "Price missing" : s.quantity)}</td>
          <td className="fo-muted">{drillWords(s)}</td></tr>))}</tbody></table>
  );
}

export default function AnalysisWorkspace({ callApi = callAnalysisApi }) {
  const [catalog, setCatalog] = useState(null);
  const [area, setArea] = useState(null);
  const [company, setCompany] = useState("consolidated");
  const [periodType, setPeriodType] = useState("MTD");
  const [ws, setWs] = useState(null);
  const [detail, setDetail] = useState(null);
  const [refusal, setRefusal] = useState(null);

  useEffect(() => {
    (async () => {
      const res = await callApi("readAnalysisCatalog", {});
      if (!res.ok) { setRefusal(res.message ?? "Analysis could not be read."); return; }
      setCatalog(res.result);
      const first = res.result.areas.find((a) => a.available);
      if (first) setArea(first.key); else setRefusal("No analysis area is available to you. Each figure needs the existing read of its records.");
    })();
  }, [callApi]);

  const load = useCallback(async () => {
    if (!area) return;
    setDetail(null);
    const res = await callApi("readAnalysisWorkspace", { area, operatingCompanyId: company, periodType });
    if (!res.ok) { setWs(null); setRefusal(res.message ?? "Analysis could not be read."); return; }
    setRefusal(null);
    setWs(res.result);
  }, [callApi, area, company, periodType]);
  useEffect(() => { load(); }, [load]);

  const open = async (measureId) => {
    const res = await callApi("readMeasureAnalysis", { measureId, operatingCompanyId: company, periodType,
      ...(ws?.area?.channel ? { channel: ws.area.channel } : {}) });
    setDetail(res.ok ? res.result.measure : { refused: res.message ?? "refused" });
  };

  if (!catalog && !refusal) return (<div className="fo-workspace"><PageHeader title="Analysis" /><p className="fo-muted">Loading the governed measures…</p></div>);
  return (
    <div className="fo-workspace">
      <PageHeader title="Analysis" description="Exception-first operational analysis. Every figure states its basis and traces to its records; nothing here grants authority." />
      {refusal && <FormError>{refusal}</FormError>}
      {catalog && (
        <nav aria-label="Analysis Areas">
          {catalog.areas.filter((a) => a.available).map((a) => (
            <Button key={a.key} size="sm" variant={a.key === area ? "primary" : "secondary"} onClick={() => setArea(a.key)}>{a.label}</Button>
          ))}
        </nav>
      )}
      <Field id="analysis-company" label="Company">
        <select className="fo-input" value={company} onChange={(e) => setCompany(e.target.value)}>
          {COMPANIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field id="analysis-period" label="Period">
        <select className="fo-input" value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {ws && (
        <>
          {ws.scope.note && <StatusIndicator tone="neutral">{ws.scope.note}</StatusIndicator>}
          <p className="fo-muted">{ws.area.label} · {ws.period.currentFirstDay} – {ws.period.currentLastDay}{ws.period.comparisonFirstDay ? ` · compared with ${ws.period.comparisonFirstDay} – ${ws.period.comparisonLastDay}` : ""}</p>

          <section className="fo-panel" aria-label="Needs Attention">
            <SectionHeader title="Needs Attention" description={ws.exceptions.length === 0 ? "No governed exception in this view." : `${ws.exceptions.length} exception(s), most severe first.`} />
            {ws.exceptions.length > 0 && <ExceptionTable rows={ws.exceptions} />}
          </section>

          <section aria-label="Measures">{ws.measures.map((m) => <MeasureCard key={m.id} m={m} onOpen={open} />)}</section>

          <section className="fo-panel" aria-label="Insights">
            <SectionHeader title="Insights" description={ws.insights.length === 0 ? "No change against the prior comparable period." : "Deterministic findings over the figures above."} />
            <ul>{ws.insights.map((i, n) => (
              <li key={`${i.kind}-${i.measureId}-${n}`}>{ws.measures.find((m) => m.id === i.measureId)?.name ?? i.measureId}: {i.kind === "DATA_INCOMPLETE" ? `incomplete (${i.finding})`
                : i.kind === "LARGEST_DRIVER" ? `largest driver is ${i.dimension}` : `${i.kind === "INCREASED_VS_PRIOR" ? "up" : "down"} ${i.percent === null ? "" : `${Math.abs(i.percent)}% `}vs the prior comparable period`}</li>))}</ul>
          </section>
        </>
      )}

      {detail && (
        <section className="fo-panel" aria-label="Measure Detail">
          {detail.refused ? <FormError>{detail.refused}</FormError> : (
            <>
              <SectionHeader title={detail.name} description={`${statusLabel(detail.basis, BASIS_WORDS)} · ${detail.provenance.definition.formula}`} />
              <p className="fo-muted">{detail.provenance.definition.description} Sources: {detail.provenance.definition.sourceFacts.join(", ")}.
                {detail.provenance.definition.periodEvent ? ` Period by ${detail.provenance.definition.periodEvent}.` : ""}</p>
              <h3>By Company</h3>
              <DriverTable detail={detail} rows={detail.drivers.byCompany} keyHeader="Company" keyLabel={companyKeyLabel} />
              {detail.drivers.byDimension.length > 0 && (<>
                <h3>By {titleCasePhrase(detail.provenance.definition.dimension)}</h3>
                <DriverTable detail={detail} rows={detail.drivers.byDimension} keyHeader={titleCasePhrase(detail.provenance.definition.dimension)} keyLabel={plainKeyLabel} />
              </>)}
              <h3>Contributing Records ({detail.provenance.contributingRecords})</h3>
              <SourceTable detail={detail} />
            </>
          )}
        </section>
      )}
    </div>
  );
}
