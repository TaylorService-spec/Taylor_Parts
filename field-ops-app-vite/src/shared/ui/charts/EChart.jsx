// EOS INSIGHT CHART -- the one place the product draws a chart (docs/design/eos-insight-inventory-lifecycle.md §5).
//
// Apache ECharts, tree-shaken to the marks EOS uses, rendered as SVG (crisp at any zoom, prints cleanly). It draws only what
// it is given: no network, no data of its own. Colours, ink and grid come from the --viz-* tokens in index.css through
// vizTheme(), so the whole kit re-themes in one place. Every chart that uses this also renders a table view (ChartTable):
// tooltips enhance, they never gate a value.
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, SVGRenderer]);

const css = (name, fallback) => (typeof document === "undefined" ? fallback
  : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/** The chart tokens, resolved from CSS. */
export function vizTheme() {
  return {
    series: [1, 2, 3, 4, 5].map((n) => css(`--viz-series-${n}`, "#2a78d6")),
    ordinal: [1, 2, 3, 4, 5].map((n) => css(`--viz-ordinal-${n}`, "#2a78d6")),
    surface: css("--color-surface-card", "#ffffff"),
    ink: css("--color-text-primary", "#111111"),
    inkSecondary: css("--color-text-secondary", "#3f4542"),
    muted: css("--color-text-muted", "#626a66"),
    grid: css("--viz-grid", "#e4e8e6"),
    axis: css("--viz-axis", "#b9c1be"),
  };
}

export const compact = (v) => (v === null || v === undefined ? "—"
  : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10_000 ? 0 : 1)}K` : String(Math.round(v * 10) / 10));

/** Recessive axes, hairline solid grid, axis-trigger tooltip with values leading. Merged under each chart's own option. */
export function baseOption(t) {
  const axisText = { color: t.muted, fontSize: 12, fontFamily: "Inter, system-ui, sans-serif" };
  return {
    animationDuration: 300,
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: t.inkSecondary },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: t.inkSecondary, fontSize: 12 } },
    tooltip: { trigger: "axis", backgroundColor: t.surface, borderColor: t.axis, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 12 }, axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } } },
    xAxis: { type: "category", axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: axisText },
    yAxis: { type: "value", splitLine: { lineStyle: { color: t.grid, type: "solid" } }, axisLabel: { ...axisText, formatter: compact } },
    aria: { enabled: true },
  };
}

export default function EChart({ option, height = 280, label }) {
  const el = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    if (!el.current) return undefined;
    chart.current = echarts.init(el.current, null, { renderer: "svg" });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => chart.current?.resize());
    ro?.observe(el.current);
    return () => { ro?.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  useEffect(() => { chart.current?.setOption(option, { notMerge: true }); }, [option]);
  return <div ref={el} className="ins-chart" style={{ height }} role="img" aria-label={label} />;
}

/** The table-view twin of a chart: every value reachable without hovering. Labels are text nodes, never HTML. */
export function ChartTable({ caption, columns, rows }) {
  return (
    <details className="ins-table-view">
      <summary>Show as table</summary>
      <table className="fo-table">
        <caption className="fo-visually-hidden">{caption}</caption>
        <thead><tr>{columns.map((c, j) => <th key={c} scope="col" className={j > 0 ? "ins-num" : undefined}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j > 0 ? "fo-tabular-nums ins-num" : undefined}>{v}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}
