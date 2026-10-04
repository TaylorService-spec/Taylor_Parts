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
import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader, Button, StatusIndicator } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callAnalysisApi } from "../../services/analysisApiClient";
import { formatMinorUnits } from "../../domain/money.js";

const COMPANIES = [["consolidated", "Consolidated (reporting view)"], ["taylor", "Taylor"], ["ventana", "Ventana"]];
const PERIODS = [["MTD", "Month to date"], ["QTD", "Quarter to date"], ["YTD", "Year to date"], ["T12M", "Trailing 12 months"], ["DAY", "Today"]];
export const BASIS_WORDS = Object.freeze({ ACCOUNTING_ACTUAL: "Accounting actual", EOS_OPERATIONAL_ACTUAL: "EOS operational actual",
  EOS_OPERATIONAL_ESTIMATE: "EOS operational estimate", FORECAST: "Forecast", TARGET_BUDGET: "Target / budget" });
const QUALITY_WORDS = Object.freeze({ COMPLETE: "Complete", PARTIAL: "Partial", MISSING_PRICE: "Missing price" });

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
      <SectionHeader title={m.name} description={`${BASIS_WORDS[m.basis] ?? m.basis}${m.status === "COMPUTED" ? ` · ${QUALITY_WORDS[m.quality.state] ?? m.quality.state}` : ""}`} />
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
        <nav aria-label="Analysis areas">
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

          <section className="fo-panel" aria-label="Needs attention">
            <SectionHeader title="Needs attention" description={ws.exceptions.length === 0 ? "No governed exception in this view." : `${ws.exceptions.length} exception(s), most severe first.`} />
            {ws.exceptions.length > 0 && (
              <table className="fo-table fo-table--stack">
                <thead><tr><th>Severity</th><th>What</th><th>Record</th><th>Company</th><th>Action</th></tr></thead>
                <tbody>{ws.exceptions.map((x) => (
                  <tr key={`${x.kind}-${x.recordId}`}><td>{x.severity}</td><td>{x.rule}</td><td>{x.label ?? x.recordId}</td><td>{x.operatingCompanyId}</td>
                    <td>{x.action ? (x.action.available ? x.action.label : `${x.action.label} — needs ${x.action.capability}`) : "No governed action here"}</td></tr>))}</tbody>
              </table>
            )}
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
        <section className="fo-panel" aria-label="Measure detail">
          {detail.refused ? <FormError>{detail.refused}</FormError> : (
            <>
              <SectionHeader title={detail.name} description={`${BASIS_WORDS[detail.basis]} · ${detail.provenance.definition.formula}`} />
              <p className="fo-muted">{detail.provenance.definition.description} Sources: {detail.provenance.definition.sourceFacts.join(", ")}.
                {detail.provenance.definition.periodEvent ? ` Period by ${detail.provenance.definition.periodEvent}.` : ""}</p>
              <h3>By company</h3>
              <table className="fo-table fo-table--stack"><thead><tr><th>Company</th><th>Figure</th><th>Records</th></tr></thead>
                <tbody>{detail.drivers.byCompany.map((d) => <tr key={d.key}><td>{d.key}</td><td>{figure(detail.unit, detail.unit === "COUNT" ? d.count : detail.unit === "RATIO" ? d.ratio : d.quantity, d)}</td><td>{d.count}</td></tr>)}</tbody></table>
              {detail.drivers.byDimension.length > 0 && (<>
                <h3>By {detail.provenance.definition.dimension}</h3>
                <table className="fo-table fo-table--stack"><thead><tr><th>{detail.provenance.definition.dimension}</th><th>Figure</th><th>Records</th></tr></thead>
                  <tbody>{detail.drivers.byDimension.map((d) => <tr key={d.key}><td>{d.key}</td><td>{figure(detail.unit, detail.unit === "COUNT" ? d.count : detail.unit === "RATIO" ? d.ratio : d.quantity, d)}</td><td>{d.count}</td></tr>)}</tbody></table>
              </>)}
              <h3>Contributing records ({detail.provenance.contributingRecords})</h3>
              <table className="fo-table fo-table--stack"><thead><tr><th>Record</th><th>Company</th><th>{detail.provenance.definition.dimension ?? "Detail"}</th><th>Amount / quantity</th><th>Open with</th></tr></thead>
                <tbody>{detail.provenance.sources.map((s) => (
                  <tr key={`${s.recordId}-${s.dimension}`}><td>{s.label ?? s.recordId}</td><td>{s.operatingCompanyId}</td><td>{s.dimension ?? "—"}</td>
                    <td>{s.amountMinor !== null && s.amountMinor !== undefined ? formatMinorUnits(Number(s.amountMinor), s.currency ?? "USD") : (detail.unit === "MONEY" ? "price missing" : s.quantity)}</td>
                    <td className="fo-muted">{s.drill ? `${s.drill.operation} (${s.drill.route})` : "—"}</td></tr>))}</tbody></table>
            </>
          )}
        </section>
      )}
    </div>
  );
}
