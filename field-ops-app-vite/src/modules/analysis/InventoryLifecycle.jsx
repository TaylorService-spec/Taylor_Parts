// INVENTORY LIFECYCLE — EOS Insight's first dashboard, on /analysis/inventory-lifecycle
// (docs/design/eos-insight-inventory-lifecycle.md).
//
// Ordered -> received -> on hand -> issued / returned / scrapped, over the trailing twelve months. It decides nothing and
// computes nothing: every figure, series and bucket is the server's (/operations/analysis readInventoryLifecycle), each section
// authorized on its own EXISTING read; a refused section says why, and a missing figure is "—", never zero. The screen only
// draws: one filter row scopes everything below it, each chart answers one question, and each has a table view.
import { useCallback, useEffect, useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import { Field, FormError } from "../../shared/ui/form";
import EChart, { ChartTable, baseOption, compact, vizTheme } from "../../shared/ui/charts/EChart.jsx";
import { callAnalysisApi } from "../../services/analysisApiClient";
import { operatingCompanyLabel } from "../../shared/display/displayLabels.js";

const COMPANIES = [["consolidated", "Consolidated (Reporting View)"], ["taylor", operatingCompanyLabel("taylor")], ["ventana", operatingCompanyLabel("ventana")]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
const units = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);

/** A 12-point trend in the de-emphasis ink with the current point in the accent. Decorative: the value is the tile's number. */
function Sparkline({ values }) {
  if (!values?.length) return null;
  const t = vizTheme();
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 26 - ((v - min) / span) * 22]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="ins-kpi__spark" viewBox="-2 0 104 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={t.axis} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {/* a zero-length round-capped stroke: stays a circle when the line stretches to the tile's width */}
      <line x1={lx} y1={ly} x2={lx} y2={ly} stroke={t.series[0]} strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ label, value, note, trend, hero = false }) {
  return (
    <div className="ins-kpi">
      <span className="ins-kpi__label">{label}</span>
      <span className={`ins-kpi__value${hero ? " ins-kpi__value--hero" : ""}`}>{value}</span>
      {note && <span className="ins-kpi__note">{note}</span>}
      {trend && <Sparkline values={trend} />}
    </div>
  );
}

// ════════════════════ chart options (pure: data in, option out) ════════════════════

function flowOption(d, t = vizTheme()) {
  const base = baseOption(t);
  return { ...base,
    xAxis: { ...base.xAxis, data: d.months.map(monthLabel) },
    tooltip: { ...base.tooltip, valueFormatter: (v) => units(v) },
    series: d.flow.series.map((s, i) => ({ name: s.label, type: "bar", stack: "flow", stackStrategy: "samesign", barMaxWidth: 24,
      itemStyle: { color: t.series[i], borderColor: t.surface, borderWidth: 1 }, emphasis: { focus: "series" }, data: s.values })),
  };
}

function onHandOption(d, t = vizTheme()) {
  const base = baseOption(t);
  return { ...base, legend: { show: false }, grid: { ...base.grid, top: 16, right: 56 },
    xAxis: { ...base.xAxis, data: d.months.map(monthLabel), boundaryGap: false },
    tooltip: { ...base.tooltip, valueFormatter: (v) => `${units(v)} units` },
    series: [{ name: "On hand", type: "line", data: d.onHandTrend, smooth: false, showSymbol: false, symbolSize: 8,
      lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0], borderColor: t.surface, borderWidth: 2 },
      areaStyle: { color: t.series[0], opacity: 0.1 },
      endLabel: { show: true, formatter: ({ value }) => compact(value), color: t.ink, fontWeight: 600 },
      markPoint: undefined }],
  };
}

function ageOption(d, t = vizTheme()) {
  const base = baseOption(t);
  return { ...base, legend: { show: false }, grid: { ...base.grid, top: 24 },
    xAxis: { ...base.xAxis, data: d.age.buckets.map((b) => b.label) },
    tooltip: { ...base.tooltip, trigger: "item", formatter: (p) => `<strong>${units(p.value)} units</strong><br/>${p.name} · ${d.age.buckets[p.dataIndex].positions} stock positions` },
    series: [{ name: "Units", type: "bar", barMaxWidth: 40,
      data: d.age.buckets.map((b, i) => ({ value: b.units, itemStyle: { color: t.ordinal[i], borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: "top", color: t.inkSecondary, formatter: ({ value }) => (value ? compact(value) : "") } }],
  };
}

function leadOption(d, t = vizTheme()) {
  const base = baseOption(t);
  const line = (name, key, color) => ({ name, type: "line", connectNulls: false, symbolSize: 8, showSymbol: true,
    lineStyle: { width: 2, color }, itemStyle: { color, borderColor: t.surface, borderWidth: 2 }, data: d.leadTime.months.map((m) => m[key]) });
  return { ...base,
    xAxis: { ...base.xAxis, data: d.leadTime.months.map((m) => monthLabel(m.month)) },
    tooltip: { ...base.tooltip, valueFormatter: (v) => (v === null || v === undefined ? "no receipts" : `${v} days`) },
    series: [line("Median", "medianDays", t.series[0]), line("90th percentile", "p90Days", t.series[1])],
  };
}

// ════════════════════ page ════════════════════

export default function InventoryLifecycle({ callApi = callAnalysisApi }) {
  const [company, setCompany] = useState("consolidated");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [refusal, setRefusal] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    const res = await callApi("readInventoryLifecycle", { operatingCompanyId: company });
    setBusy(false);
    if (!res.ok) { setRefusal(res.message ?? "The inventory lifecycle could not be read."); return; }
    setRefusal(null);
    setData(res.result);
  }, [callApi, company]);
  useEffect(() => { load(); }, [load]);

  const options = useMemo(() => (data ? { flow: flowOption(data), onHand: onHandOption(data), age: ageOption(data),
    lead: data.leadTime.status === "COMPUTED" ? leadOption(data) : null } : null), [data]);

  const filters = (
    <div className="ins-filters">
      <Field id="lifecycle-company" label="Company">
        <select className="fo-input" value={company} onChange={(e) => setCompany(e.target.value)}>
          {COMPANIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {data && <span className="ins-asof">{monthLabel(data.months[0])} – {monthLabel(data.months[11])} · as of {new Date(data.asOf).toLocaleDateString()} · {data.scope.warehouses} warehouse{data.scope.warehouses === 1 ? "" : "s"} in your scope</span>}
    </div>
  );

  return (
    <WorkspaceShell title="Inventory Lifecycle" context={filters}>
      {refusal && <FormError>{refusal}</FormError>}
      {!data && !refusal && <p className="fo-muted">Reading the inventory ledger…</p>}
      {data && (
        <div className="ins-body" aria-busy={busy}>
          <div className="ins-kpis" role="list" aria-label="Key figures">
            <div role="listitem"><Kpi hero label="Units on hand" value={units(data.kpis.onHand)} trend={data.onHandTrend} note="month-end, 12 months" /></div>
            <div role="listitem"><Kpi label="Issued, 12 months" value={units(data.kpis.issued12)} trend={data.kpis.issuedTrend} note="work orders, sales, rental" /></div>
            <div role="listitem"><Kpi label="Stock turns" value={data.kpis.turns ?? "—"} note={data.kpis.turns === null ? "no average stock" : "issued ÷ average on hand"} /></div>
            <div role="listitem"><Kpi label="Days of supply" value={units(data.kpis.daysOfSupply)} note={data.kpis.daysOfSupply === null ? "nothing issued in 90 days" : "at the last 90 days' pace"} /></div>
            <div role="listitem"><Kpi label="Idle over 180 days" value={pct(data.kpis.dormantShare)} note="share of units on hand" /></div>
            <div role="listitem"><Kpi label="Scrap rate" value={pct(data.kpis.scrapRate)} note="scrapped ÷ (issued + scrapped)" /></div>
          </div>

          <div className="ins-grid">
            <RuledSection title="Stock flow" meta="units per month">
              <p className="ins-question">What came in (above the line) and went out (below) each month?</p>
              <EChart option={options.flow} height={300} label="Monthly units in and out by lifecycle stage" />
              <ChartTable caption="Stock flow by month and stage" columns={["Month", ...data.flow.series.map((s) => s.label)]}
                rows={data.months.map((m, i) => [monthLabel(m), ...data.flow.series.map((s) => units(s.values[i]))])} />
            </RuledSection>

            <RuledSection title="Units on hand" meta="month-end">
              <p className="ins-question">Is stock building up or draining?</p>
              <EChart option={options.onHand} height={300} label="Month-end units on hand" />
              <ChartTable caption="Month-end units on hand" columns={["Month", "Units on hand"]}
                rows={data.months.map((m, i) => [monthLabel(m), units(data.onHandTrend[i])])} />
            </RuledSection>

            <RuledSection title="Stock age" meta="units by days since the part last moved">
              <p className="ins-question">How long has today's stock been sitting?</p>
              <EChart option={options.age} height={280} label="Units on hand by days since last movement" />
              <ChartTable caption="Stock age" columns={["Days since last movement", "Units", "Stock positions"]}
                rows={data.age.buckets.map((b) => [b.label, units(b.units), units(b.positions)])} />
            </RuledSection>

            <RuledSection title="Order to receipt" meta="days, by month received">
              <p className="ins-question">How long from placing an order to having the stock?</p>
              {data.leadTime.status === "COMPUTED" ? (
                <>
                  <EChart option={options.lead} height={280} label="Median and 90th percentile days from order to receipt" />
                  <ChartTable caption="Order to receipt days" columns={["Month", "Receipts", "Median days", "90th percentile days"]}
                    rows={data.leadTime.months.map((m) => [monthLabel(m.month), units(m.receipts), m.medianDays ?? "—", m.p90Days ?? "—"])} />
                </>
              ) : <p className="ins-refused">Not available to you — {data.leadTime.reason}.</p>}
            </RuledSection>

            <RuledSection title="Slow movers" meta={`parts idle over ${data.slowMovers.dormantDays} days, most units first`}>
              {data.slowMovers.rows.length === 0 ? <p className="ins-refused">No part in your warehouses has been idle that long.</p> : (
                <table className="fo-table">
                  <thead><tr><th scope="col">Part</th><th scope="col" className="ins-num">Units on hand</th><th scope="col" className="ins-num">Days idle</th><th scope="col" className="ins-num">Last moved</th><th scope="col" className="ins-num">Issued, 12 months</th></tr></thead>
                  <tbody>{data.slowMovers.rows.map((r) => (
                    <tr key={r.partId}>
                      <td>{r.partNumber ? <><strong>{r.partNumber}</strong> {r.name}</> : r.partId}</td>
                      <td className="fo-tabular-nums ins-num">{units(r.onHand)}</td>
                      <td className="fo-tabular-nums ins-num">{units(r.daysIdle)}</td>
                      <td className="fo-tabular-nums ins-num">{new Date(r.lastActivity).toLocaleDateString()}</td>
                      <td className="fo-tabular-nums ins-num">{units(r.issued12)}</td>
                    </tr>))}</tbody>
                </table>
              )}
              {data.slowMovers.namesWithheld && <p className="fo-muted">Part names need catalog read access; part ids are shown instead.</p>}
            </RuledSection>

            <RuledSection title="How these are calculated">
              <dl className="ins-defs">
                {Object.entries({ "Units on hand": data.definitions.onHand, "Stock turns": data.definitions.turns, "Days of supply": data.definitions.daysOfSupply,
                  "Stock age": data.definitions.stockAge, "Idle over 180 days": data.definitions.dormantShare, "Scrap rate": data.definitions.scrapRate,
                  "Order to receipt": data.definitions.leadTime }).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </RuledSection>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
