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

const COMPANIES = [["consolidated", "Consolidated (reporting view)"], ["taylor", "Taylor"], ["ventana", "Ventana"]];

const PRIORITY_WORDS = Object.freeze({ HIGH: "High priority", MEDIUM: "Medium priority", LOW: "Low priority" });

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
  return action.available ? action.label : `${action.label} — needs ${action.capability}`;
}

function SectionBody({ section }) {
  if (section.status === "NOT_AUTHORIZED") return <HonestState state={HONEST_STATE.DENIED} subject={section.title} detail={`Not available to you — ${section.reason}.`} />;
  if (section.status === "UNAVAILABLE") return <HonestState state={HONEST_STATE.UNAVAILABLE} subject={section.title} detail={section.reason} />;
  if (section.key === "measures") return <Measures summary={section.summary} />;
  if (section.items.length === 0) return <HonestState state={HONEST_STATE.EMPTY} subject={section.title} />;
  return (
    <>
      {section.key === "rental" && section.summary?.counts && (
        <ContextBand items={Object.entries(section.summary.counts).map(([k, v]) => ({ key: k, label: k, value: String(v) }))} />
      )}
      <table className="fo-table fo-table--stack">
        <thead><tr><th>Record</th><th>What</th><th>Status</th><th>People</th></tr></thead>
        <tbody>
          {section.items.map((item) => (
            <tr key={`${item.kind}-${item.id}`}>
              <td data-label="Record">{recordLink(item)}</td>
              <td data-label="What">{item.detail ?? "—"}{actionWords(item.action) ? <span className="fo-muted"> · {actionWords(item.action)}</span> : null}</td>
              <td data-label="Status">{item.severity ? `${item.severity === "BLOCKING" ? "Blocking" : "Needs attention"} · ` : ""}{item.status ?? "—"}</td>
              <td data-label="People">{responsibilityWords(item) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {section.count > section.items.length && <p className="fo-muted">Showing {section.items.length} of {section.count}.</p>}
      {section.summary?.notReadable?.length > 0 && <p className="fo-muted">Not readable with your access: {section.summary.notReadable.join(", ")}.</p>}
    </>
  );
}

function Measures({ summary }) {
  if (!summary || summary.measures.length === 0) return <HonestState state={HONEST_STATE.EMPTY} subject="Measures" />;
  return (
    <>
      {summary.scope?.note && <p className="fo-muted">{summary.scope.note}</p>}
      <p className="fo-muted">{summary.period.currentFirstDay} – {summary.period.currentLastDay}</p>
      <table className="fo-table fo-table--stack">
        <thead><tr><th>Measure</th><th>Figure</th><th>Basis</th><th>Change</th></tr></thead>
        <tbody>
          {summary.measures.map((m) => (
            <tr key={m.id}>
              <td data-label="Measure">{m.name}</td>
              <td data-label="Figure">{m.status === "COMPUTED" ? <strong>{figure(m.unit, m.value?.value, m.aggregate)}</strong> : <span className="fo-muted">{m.status === "REFUSED" ? `Not available to you — ${m.reason}` : m.reason}</span>}</td>
              <td data-label="Basis">{BASIS_WORDS[m.basis] ?? m.basis}</td>
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

  if (refusal) return <WorkspaceShell title="My work"><HonestState state={HONEST_STATE.UNAVAILABLE} subject="Your workspace" detail={refusal} action={<Button variant="secondary" onClick={load}>Try again</Button>} /></WorkspaceShell>;
  if (!work) return <WorkspaceShell title="My work"><HonestState state={HONEST_STATE.LOADING} subject="Your workspace" /></WorkspaceShell>;

  const attention = work.sections.find((s) => s.key === "attention");
  const others = work.sections.filter((s) => s.key !== "attention");
  const attentionItems = attention?.status === "READY"
    ? attention.items.filter((i) => i.severity).map((i) => ({ key: `${i.kind}-${i.id}`, severity: i.severity, fact: `${i.priority ? `${PRIORITY_WORDS[i.priority] ?? i.priority} · ` : ""}${i.detail ?? ""} — ${i.label}`,
      link: i.path ? <Link to={i.path}>Open</Link> : null, owner: actionWords(i.action) }))
    : [];
  const showsCompany = work.persona.analysisArea === "executive" || work.persona.analysisArea === "finance";

  return (
    <WorkspaceShell
      title={`My work — ${work.persona.label}`}
      context={<ContextBand items={[
        { key: "me", label: "Signed in as", value: work.me.displayName ?? "No linked Employee" },
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
