import { useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import { useOpportunities } from "../../hooks/useOpportunities.js";
import { buildOpportunityPipeline, channelLabel } from "../../domain/opportunityLifecycle.js";

// Sales — Opportunity Operating Workspace (Cycle 2, READ-FIRST). The commercial pipeline is the entry point
// to Sales (ratified: Opportunity Management, NOT Account→Create Work Order). This surface reads SYNTHETIC
// opportunities through the injected source seam (hooks/useOpportunities → access/opportunitySource) and
// renders them on the Wave-0 composition primitives (WorkspaceShell / ContextBand / StatusPill / ActionRail),
// serving as their first Sales-side proving ground. It is a PIPELINE built for rapid scanning + comparison,
// not a metric-card CRM dashboard and not a giant-card-per-opportunity page.
//
// No write path exists here yet. Opportunity is PRE-COMMITMENT — nothing on this screen creates a Work
// Order, reserves inventory, or touches an invoice. Cycle 3+ adds mutation through a TRUSTED COMMAND service
// + governed callable (client stays deny by Rules); the "New opportunity" control is intentionally inert
// until that lands, so the affordance is honest rather than a dead button pretending to work.

const currency = (v) =>
  typeof v === "number" ? v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "—";
const shortDate = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

function LineSummary({ lines }) {
  if (!lines?.length) return <span className="fo-muted">No solution lines yet</span>;
  return (
    <ul className="fo-sales-detail__lines">
      {lines.map((l, i) => (
        <li key={`${l.kind}-${l.ref}-${i}`}>
          <span className="fo-sales-detail__line-kind">{l.kind}</span> {l.ref}
          {l.qty ? <span className="fo-muted"> ×{l.qty}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// Read-only detail for the selected opportunity (the supporting aside). Facts as a ContextBand, then the
// customer need, the solution lines, any attention reasons, and the next action — no editing affordances.
function OpportunityDetail({ row }) {
  if (!row) return <p className="fo-muted">Select an opportunity to see its detail.</p>;
  const facts = [
    { key: "customer", label: "Customer", value: row.customerName },
    { key: "channel", label: "Channel", value: channelLabel(row.channel) },
    { key: "stage", label: "State", value: <StatusPill tone={row.commercial.tone} label={row.commercial.label} /> },
    { key: "value", label: "Est. value", value: currency(row.expectedValue) },
    { key: "close", label: "Expected close", value: shortDate(row.expectedCloseAt) },
    { key: "owner", label: "Owner", value: row.ownerEmployeeId ?? "—" },
  ];
  return (
    <div className="fo-sales-detail">
      <ContextBand items={facts} />
      <section className="fo-sales-detail__block">
        <h4>Customer need</h4>
        <p>{row.need ?? "—"}</p>
      </section>
      <section className="fo-sales-detail__block">
        <h4>Solution</h4>
        <LineSummary lines={row.lines} />
      </section>
      {row.attention.length > 0 && (
        <section className="fo-sales-detail__block">
          <h4>Needs attention</h4>
          <ul className="fo-sales-detail__attention">
            {row.attention.map((a) => (
              <li key={a.kind}>
                <StatusPill tone={a.tone} label={a.label} asText />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="fo-sales-detail__block">
        <h4>Next action</h4>
        <p>{row.nextAction ? row.nextAction : <span className="fo-muted">None recorded</span>}</p>
      </section>
    </div>
  );
}

// One scannable pipeline row. Attention-bearing rows carry a left marker + an inline pill so the queue reads
// at a glance; the stage pill uses the shared semantic tone so "attention looks like attention" everywhere.
function PipelineRow({ row, selected, onSelect }) {
  return (
    <tr
      className={`fo-sales-row ${selected ? "is-selected" : ""} ${row.attentionTone === "attention" ? "is-attention" : ""}`.trim()}
      onClick={() => onSelect(row.id)}
      aria-selected={selected}
    >
      <td className="fo-sales-row__customer">{row.customerName}</td>
      <td><StatusPill tone={row.commercial.tone} label={row.commercial.label} /></td>
      <td>{channelLabel(row.channel)}</td>
      <td className="fo-sales-row__value">{currency(row.expectedValue)}</td>
      <td>{shortDate(row.expectedCloseAt)}</td>
      <td className="fo-sales-row__next">
        {row.attention.length > 0 ? (
          <StatusPill tone={row.attentionTone} label={row.attention[0].label} asText />
        ) : (
          <span className="fo-muted">{row.nextAction || "—"}</span>
        )}
      </td>
    </tr>
  );
}

export default function SalesWorkspace() {
  const { opportunities, accountNameById, status } = useOpportunities();
  const [selectedId, setSelectedId] = useState(null);

  // Fixed "now" for the render pass so attention derivation is stable within a paint; sourced once from the
  // clock rather than per-row (deterministic across the whole projection).
  const pipeline = useMemo(
    () => buildOpportunityPipeline(opportunities, { nowMillis: Date.now(), accountNameById }),
    [opportunities, accountNameById]
  );

  const selectedRow = useMemo(
    () => pipeline.all.find((r) => r.id === selectedId) ?? pipeline.rows[0] ?? null,
    [pipeline, selectedId]
  );

  const contextItems = [
    { key: "open", label: "Open", value: pipeline.counts.open },
    { key: "attention", label: "Needs attention", value: pipeline.counts.needsAttention },
    { key: "won", label: "Won", value: pipeline.counts.won },
    { key: "lost", label: "Lost", value: pipeline.counts.lost },
  ];

  const actions = (
    <ActionRail
      primary={
        <button type="button" className="fo-btn-primary" disabled title="Creating opportunities arrives in a later cycle (governed write path).">
          New opportunity
        </button>
      }
    />
  );

  const attention =
    pipeline.counts.needsAttention > 0 ? (
      <p className="fo-sales-attention">
        <StatusPill tone="attention" label={`${pipeline.counts.needsAttention} opportunit${pipeline.counts.needsAttention === 1 ? "y" : "ies"} need attention`} />
        <span className="fo-muted"> — sorted to the top of the pipeline.</span>
      </p>
    ) : null;

  const isSynthetic = status === "ready";

  return (
    <WorkspaceShell
      title="Opportunities"
      density="compact"
      actions={actions}
      context={<ContextBand items={contextItems} />}
      attention={attention}
      supporting={<OpportunityDetail row={selectedRow} />}
    >
      {isSynthetic && (
        <p className="fo-sales-banner fo-muted">
          Showing synthetic sample opportunities. The live sales pipeline connects in a later cycle.
        </p>
      )}
      {pipeline.rows.length === 0 ? (
        <p className="fo-muted">No open opportunities.</p>
      ) : (
        <table className="fo-sales-pipeline">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Stage</th>
              <th>Channel</th>
              <th>Est. value</th>
              <th>Expected close</th>
              <th>Attention / next</th>
            </tr>
          </thead>
          <tbody>
            {pipeline.rows.map((row) => (
              <PipelineRow key={row.id} row={row} selected={selectedRow?.id === row.id} onSelect={setSelectedId} />
            ))}
          </tbody>
        </table>
      )}
    </WorkspaceShell>
  );
}
