// MY WORKSPACE — the employee's landing under EOS authority (Application Assembly, DECISIONS #209).
//
// ATTENTION -> INSIGHT -> CONTEXT -> AUTHORIZED ACTION, per persona. The persona is the caller's CURRENT Job Role and it only
// chooses the LAYOUT (which sections, in which order); every section is the server's (/operations/workspace), each authorized on
// its own EXISTING read. A refused section says why -- it is never rendered as "nothing to do". The page decides nothing,
// computes nothing and grants nothing: an action is a link to the governed record page or workspace that already enforces it.
// No Firebase, no AI.
//
// Reused, not rebuilt: WorkspaceShell / AttentionBand / RuledSection / ContextBand / HonestState (shared/ui) and Analysis's
// `figure` + BASIS_WORDS, so a measure reads the same here as on /analysis.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import WorkspaceShell from "../../shared/ui/WorkspaceShell";
import AttentionBand from "../../shared/ui/AttentionBand";
import RuledSection from "../../shared/ui/RuledSection";
import ContextBand from "../../shared/ui/ContextBand";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState";
import { Field } from "../../shared/ui/form";
import { Button } from "../../shared/ui/primitives";
import { callWorkspaceApi } from "../../services/workspaceApiClient";
import { figure, BASIS_WORDS } from "../analysis/AnalysisWorkspace";
import WorkflowWork from "./WorkflowWork.jsx";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";
import { operatingCompanyLabel, statusLabel, titleCase } from "../../shared/display/displayLabels.js";

// Company names come from the governed table; "consolidated" is the reporting projection, not a company.
const COMPANIES = [["consolidated", "Consolidated (Reporting View)"], ["taylor", operatingCompanyLabel("taylor")], ["ventana", operatingCompanyLabel("ventana")]];

const PRIORITY_WORDS = Object.freeze({ HIGH: "High Priority", MEDIUM: "Medium Priority", LOW: "Low Priority" });

const EMPTY = Object.freeze([]);
const recordLink = (item) => (item.path ? <Link to={item.path}>{item.label}</Link> : item.label);

/** OWNER / ACCOUNTABLE / ASSIGNEE are three answers -- rendered as three, never merged into one "responsible" word. */
function responsibilityWords(item) {
  const r = item.action?.responsibility;
  const words = [];
  if (r) {
    words.push(`Owner: ${r.owner ?? "not set"}`);
    words.push(`Accountable: ${r.accountable ?? "not set"}`);
  }
  if (item.action && "assignee" in item.action) words.push(`Assignee: ${item.action.assignee ?? "unassigned"}`);
  return words.join(" · ");
}

function actionWords(action) {
  if (!action || typeof action.available !== "boolean") return null;
  return action.available ? action.label : `${action.label} — needs ${titleCase(action.capability)} access`;
}

const statusWords = (item) => `${item.severity ? `${item.severity === "BLOCKING" ? "Blocking" : "Needs Attention"} · ` : ""}${item.status ? statusLabel(item.status) : "—"}`;
const LABEL_OF = (item) => (typeof item.label === "string" ? item.label : null);
// HEADER SORTING over the section's items already read; no sort = the server's order.
const ITEM_SORT_COLUMNS = Object.freeze({
  record: { value: LABEL_OF },
  what: { value: (item) => item.detail ?? null },
  status: { value: (item) => (item.severity || item.status ? statusWords(item) : null) },
  people: { value: (item) => responsibilityWords(item) || null },
});

function SectionItemsTable({ items }) {
  const { sort, toggle, sorted } = useTableSort({ rows: items, columns: ITEM_SORT_COLUMNS });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table fo-table--stack">
      <thead><tr>{th("record", "Record")}{th("what", "What")}{th("status", "Status")}{th("people", "People")}</tr></thead>
      <tbody>
        {sorted.map((item) => (
          <tr key={`${item.kind}-${item.id}`}>
            <td data-label="Record">{recordLink(item)}</td>
            <td data-label="What">{item.detail ?? "—"}{actionWords(item.action) ? <span className="fo-muted"> · {actionWords(item.action)}</span> : null}</td>
            <td data-label="Status">{statusWords(item)}</td>
            <td data-label="People">{responsibilityWords(item) || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectionBody({ section }) {
  if (section.status === "NOT_AUTHORIZED") return <HonestState state={HONEST_STATE.DENIED} subject={section.title} detail={`Not available to you — ${section.reason}.`} />;
  if (section.status === "UNAVAILABLE") return <HonestState state={HONEST_STATE.UNAVAILABLE} subject={section.title} detail={section.reason} />;
  if (section.key === "measures") return <Measures summary={section.summary} />;
  if (section.items.length === 0) return <HonestState state={HONEST_STATE.EMPTY} subject={section.title} />;
  return (
    <>
      {section.key === "rental" && section.summary?.counts && (
        <ContextBand items={Object.entries(section.summary.counts).map(([k, v]) => ({ key: k, label: titleCase(k), value: String(v) }))} />
      )}
      <SectionItemsTable items={section.items} />
      {section.count > section.items.length && <p className="fo-muted">Showing {section.items.length} of {section.count}.</p>}
      {section.summary?.notReadable?.length > 0 && <p className="fo-muted">Not readable with your access: {section.summary.notReadable.join(", ")}.</p>}
    </>
  );
}

const MEASURE_SORT_COLUMNS = Object.freeze({
  measure: { value: (m) => m.name },
  figure: { value: (m) => {
    if (m.status !== "COMPUTED") return null;
    if (m.unit === "MONEY") { const v = Object.values(m.aggregate?.money ?? {}); return v.length === 1 ? Number(v[0]) : null; }
    const v = m.value?.value;
    return v === null || v === undefined ? null : Number(v);
  } },
  basis: { value: (m) => statusLabel(m.basis, BASIS_WORDS) },
  change: { value: (m) => (m.variance && typeof m.variance.percent === "number" ? m.variance.percent : null) },
});

function Measures({ summary }) {
  const { sort, toggle, sorted } = useTableSort({ rows: summary?.measures ?? EMPTY, columns: MEASURE_SORT_COLUMNS });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  if (!summary || summary.measures.length === 0) return <HonestState state={HONEST_STATE.EMPTY} subject="Measures" />;
  return (
    <>
      {summary.scope?.note && <p className="fo-muted">{summary.scope.note}</p>}
      <p className="fo-muted">{summary.period.currentFirstDay} – {summary.period.currentLastDay}</p>
      <table className="fo-table fo-table--stack">
        <thead><tr>{th("measure", "Measure")}{th("figure", "Figure")}{th("basis", "Basis")}{th("change", "Change")}</tr></thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.id}>
              <td data-label="Measure">{m.name}</td>
              <td data-label="Figure">{m.status === "COMPUTED" ? <strong>{figure(m.unit, m.value?.value, m.aggregate)}</strong> : <span className="fo-muted">{m.status === "REFUSED" ? `Not available to you — ${m.reason}` : m.reason}</span>}</td>
              <td data-label="Basis">{statusLabel(m.basis, BASIS_WORDS)}</td>
              <td data-label="Change">{m.variance && typeof m.variance.percent === "number" ? `${m.variance.percent >= 0 ? "+" : ""}${m.variance.percent}% vs prior` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><Link to="/analysis">Explain these figures in Analysis</Link></p>
    </>
  );
}

export default function MyWorkspace({ callApi = callWorkspaceApi, preview = false }) {
  const [work, setWork] = useState(null);
  const [company, setCompany] = useState(null);
  const [refusal, setRefusal] = useState(null);

  const load = useCallback(async () => {
    const res = await callApi("readMyWork", company ? { operatingCompanyId: company } : {});
    if (!res.ok) { setWork(null); setRefusal(res.message ?? "Your workspace could not be read."); return; }
    setRefusal(null);
    setWork(res.result);
  }, [callApi, company]);
  useEffect(() => { load(); }, [load]);

  if (refusal) return <WorkspaceShell title="My Work"><HonestState state={HONEST_STATE.UNAVAILABLE} subject="Your workspace" detail={refusal} action={<Button variant="secondary" onClick={load}>Try Again</Button>} /></WorkspaceShell>;
  if (!work) return <WorkspaceShell title="My Work"><HonestState state={HONEST_STATE.LOADING} subject="Your workspace" /></WorkspaceShell>;

  const attention = work.sections.find((s) => s.key === "attention");
  const others = work.sections.filter((s) => s.key !== "attention");
  const attentionItems = attention?.status === "READY"
    ? attention.items.filter((i) => i.severity).map((i) => ({ key: `${i.kind}-${i.id}`, severity: i.severity, fact: `${i.priority ? `${PRIORITY_WORDS[i.priority] ?? i.priority} · ` : ""}${i.detail ?? ""} — ${i.label}`,
      link: i.path ? <Link to={i.path}>Open</Link> : null, owner: actionWords(i.action) }))
    : [];
  const showsCompany = work.persona.analysisArea === "executive" || work.persona.analysisArea === "finance";

  return (
    <WorkspaceShell
      title={`My Work — ${work.persona.label}`}
      context={<ContextBand items={[
        { key: "me", label: "Signed In As", value: work.me.displayName ?? "No linked Employee" },
        { key: "role", label: "Job Role", value: work.me.jobRole?.label ?? "No current Job Role (General Employee layout)" },
      ]} />}
      attention={<AttentionBand items={attentionItems} />}
    >
      {showsCompany && (
        <Field id="my-work-company" label="Company">
          <select className="fo-input" value={company ?? work.operatingCompanyId ?? "consolidated"} onChange={(e) => setCompany(e.target.value)}>
            {COMPANIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      )}
      {attention && attention.status !== "READY" && (
        <RuledSection title={attention.title}><SectionBody section={attention} /></RuledSection>
      )}
      {attention?.status === "READY" && attention.items.length === 0 && <p className="fo-muted">Nothing governed needs your attention right now.</p>}
      {others.map((s) => (
        <RuledSection key={s.key} title={s.title} meta={s.status === "READY" ? String(s.count) : null}>
          <SectionBody section={s} />
        </RuledSection>
      ))}
      {/* Workflow participation (#210). Never inside a View-as-user PREVIEW: a preview cannot act. */}
      {!preview && <WorkflowWork />}
    </WorkspaceShell>
  );
}
