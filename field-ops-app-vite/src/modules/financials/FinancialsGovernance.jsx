// FINANCIAL SETTINGS & GOVERNANCE — /financials/governance (North Star P1, page 20).
//
// Design authority: docs/north-star/financials/North Star - Financials 20 Governance.dc.html
// AS RECONCILED against current main (period/policy rows corrected to BUILT_DORMANT ·
// POLICY NOT CONFIGURED in the installed source, 2026-09-01). Financials-specific
// administration; not generic Admin; nothing here rewrites immutable history.
//
// Every row carries one of the five state chips — CONFIGURED / NOT CONFIGURED /
// BUILT_DORMANT / AUTHORITY NOT IMPLEMENTED / FUTURE INTEGRATION — and the chip states
// come from the reconciliation truth table, not from optimism. No calendar/fiscal
// configuration is implied; common practice is not authority (FIN-PQ-20a).
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import { OPERATING_COMPANIES } from "../../domain/operatingCompanyAuthority.js";
import { BUSINESS_UNIT_FILTER_OPTIONS } from "../../domain/financialsSurface.js";

function StateChip({ state }) {
  const tone =
    state === "Configured" ? "fin-gov-chip--configured"
    : state === "Built dormant" ? "fin-gov-chip--dormant"
    : "fin-gov-chip--future";
  return <span className={`fin-gov-chip ${tone}`}>{state}</span>;
}

function Row({ label, state = null, words = null, tip = null, last = false }) {
  return (
    <div className={last ? "fin-gov-row fin-gov-row--last" : "fin-gov-row"}>
      <span className="fin-gov-row__label">{label}</span>
      <span className="fin-gov-row__value">
        {state ? <StateChip state={state} /> : null}
        {words ? <span className="fin-gov-row__words">{words}</span> : null}
        {tip ? <FinAnnotation tip={tip} /> : null}
      </span>
    </div>
  );
}

const COMPANY_WORDS = OPERATING_COMPANIES.filter((c) => c.active)
  .map((c) => (c.code === "TAYLOR" ? "Taylor" : c.displayName))
  .join(" · ");

const UNIT_WORDS = BUSINESS_UNIT_FILTER_OPTIONS.filter((u) => u.key !== "all")
  .map((u) => u.label)
  .join(" · ");

export default function FinancialsGovernance() {
  return (
    <FinancialsPageFrame
      title="Financial Settings & Governance"
      crumb="Settings & Governance"
      custody="Financials-specific administration. Not application admin — role administration lives elsewhere. No setting here can rewrite issued financial history."
      custodyTip="Every section reads a governed configuration record where one exists; edits are permitted-role acts and audited. Sections whose authority does not exist yet say which state they are in: CONFIGURED / NOT CONFIGURED / BUILT_DORMANT / AUTHORITY NOT IMPLEMENTED / FUTURE INTEGRATION."
    >
      <div className="fin-overview-grid">
        <div>
          <section className="ns-section" aria-label="Authority and scope">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Authority &amp; scope</h2>
            </div>
            <Row label="Financial authority mode" state="Configured" words="Operational subledger" />
            <Row label="External accounting authority" state="Future integration" words="Not selected" />
            <Row label="Reconciliation provider (FIN-010)" state="Not configured" tip="Internal operational reconciliation (IN_SYNC/DRIFT) is merged and dormant; the external provider decision has not been made." />
            <Row
              label="Cost authority (FIN-006)"
              state="Built dormant"
              words="Cost-fact supply missing"
              tip="The margin derivation core is merged. Margin computes only when every required governed cost fact exists; otherwise UNKNOWN. Real cost-fact supply is an Owner decision (FIN-BLOCK-003)."
            />
            <Row label="Operating currency" state="Configured" words="USD" last />
          </section>

          <section className="ns-section" aria-label="Structure">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Structure</h2>
            </div>
            <Row label="Companies" words={COMPANY_WORDS} />
            <Row label="Business units" words={UNIT_WORDS} />
            <Row
              label="Financial periods (FIN-008)"
              state="Built dormant"
              words="Policy not configured"
              tip="The period model is merged: OPEN/CLOSED per operating company; close records preserve actor, time and reason; closed-period event writes refuse; reopen is not modeled. What remains policy: cadence/fiscal calendar, closer role, late-event treatment — none configured. No calendar configuration is asserted; common practice is not authority (FIN-PQ-20a)."
              last
            />
          </section>
        </div>

        <div>
          <section className="ns-section" aria-label="Policy">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Policy</h2>
            </div>
            <Row
              label="Goal governance — bases, approval"
              state="Built dormant"
              words="Policy not configured"
              tip="The FIN-003 plan core (GOAL distinct from BUDGET, versioned, explicit basis) is merged and dormant. Approval routing and thresholds remain FIN-007 policy — not configured."
            />
            <Row label="Budget governance — versioning, approval" state="Built dormant" words="Policy not configured" />
            <Row
              label="Correction approval policy (FIN-007)"
              state="Built dormant"
              words="Policy not configured"
              tip="The approval mechanism is merged — self-approval is forbidden by current authority and missing policy fails closed. Thresholds, approver roles, escalations and expiry remain unconfigured."
            />
            <Row
              label="Visibility policy summary"
              words="SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED"
              tip="Read-only summary of the visibility scope VOCABULARY as it applies to financial facts. It lists the scopes that exist, not who holds them and not which are active — grants and activation live in the platform's role system and are resolved server-side per principal; this page never duplicates or asserts them."
            />
            <Row label="Financial classifications (FIN-009)" state="Not configured" last />
          </section>

          <section className="ns-section" aria-label="References">
            <div className="ns-section__head">
              <h2 className="ns-section__title">References</h2>
            </div>
            <Row label="Financial audit lens" words={<Link to="/financials/audit">Audit &amp; History →</Link>} last />
          </section>
        </div>
      </div>
    </FinancialsPageFrame>
  );
}
