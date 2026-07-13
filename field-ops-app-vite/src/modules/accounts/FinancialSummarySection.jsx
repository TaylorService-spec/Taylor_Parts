import { financialSummaryView, FINANCIAL_PROVIDER_STATE } from "../../domain/financialSummaryView";

// Customer/Account Business Model -- Customer PR 4, Financial Summary.
// Provider-neutral surface built to the Framework's five-state contract
// (docs/architecture/enterprise-business-metrics-framework.md Section 17),
// but ONLY `unconfigured` is reachable in production this phase: no financial
// provider is connected, so it renders the exact "Sales data source not
// connected." copy and NO dollar figure, $0, Work Order count, procurement
// figure, or financial data. Connecting a real provider (external or a
// governed local ledger) is a separate future initiative -- this PR adds no
// provider integration, collection, Rules, index, or query.
//
// `providerState` defaults to the only reachable production state; the prop
// exists so the surface is genuinely built to the full contract and so a
// future provider integration can flow a real state in without reworking the
// rendering. AccountDetail renders it with no prop -> unconfigured.
const PRODUCTION_PROVIDER_STATE = { status: FINANCIAL_PROVIDER_STATE.UNCONFIGURED };

function renderView(view) {
  if (view.kind === "loading") {
    return <p className="fo-muted">{view.text}</p>;
  }
  if (view.kind === "message") {
    return <p className={view.tone === "warning" ? "fo-warning" : "fo-muted"}>{view.text}</p>;
  }
  // view.kind === "metrics" (partial | complete). Only reachable once a
  // provider is connected -- each canonical metric is rendered explicitly;
  // an unavailable/unsupported metric is disclosed, never silently omitted.
  return (
    <div className="fo-financial-metrics">
      <ul className="fo-activity-list">
        {view.rows.map((row) => (
          <li key={row.name} className={row.available ? "fo-badge" : "fo-muted"}>
            {row.text}
          </li>
        ))}
      </ul>
      {view.footer && <p className="fo-muted">{view.footer}</p>}
    </div>
  );
}

export default function FinancialSummarySection({ providerState = PRODUCTION_PROVIDER_STATE }) {
  const view = financialSummaryView(providerState);
  return (
    <section className="wo-history">
      <h4>Financial Summary</h4>
      {renderView(view)}
    </section>
  );
}
