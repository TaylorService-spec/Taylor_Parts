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
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callFinanceApi } from "../../services/financeApiClient.js";
import { choiceLabel, describeFailure } from "../../domain/financialPolicyAdministration.js";
import {
  FinancialsPageFrame,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import { OPERATING_COMPANIES } from "../../domain/operatingCompanyAuthority.js";
import { operatingCompanyLabel, titleCasePhrase } from "../../shared/display/displayLabels.js";
import { BUSINESS_UNIT_FILTER_OPTIONS } from "../../domain/financialsSurface.js";

// FOUR STATES, FOUR TREATMENTS (Owner visual review, F12). "Not configured" and "Future
// integration" previously shared one plain-outline treatment and read as a single state,
// which is precisely the distinction an administrator comes to this page for:
//   Configured        — solid dark  — the setting exists and holds a value
//   Built dormant     — amber       — the authority is merged; its policy is not set
//   Not configured    — solid quiet — a governed slot that exists and is empty
//   Future integration— dashed      — there is nothing to configure yet, by design
// Same chip, same tokens; only the border treatment separates the last two.
const CHIP_TONES = Object.freeze({
  "Configured": "fin-gov-chip--configured",
  "Built dormant": "fin-gov-chip--dormant",
  "Not configured": "fin-gov-chip--notconfigured",
  "Future integration": "fin-gov-chip--future",
});

function StateChip({ state }) {
  // The tone is keyed by the state's own words; the chip shows them as a Title Case status label.
  return <span className={`fin-gov-chip ${CHIP_TONES[state] ?? "fin-gov-chip--notconfigured"}`}>{titleCasePhrase(state)}</span>;
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
  .map((c) => operatingCompanyLabel(c.id, { short: true }))
  .join(" · ");

const UNIT_WORDS = BUSINESS_UNIT_FILTER_OPTIONS.filter((u) => u.key !== "all")
  .map((u) => u.label)
  .join(" · ");

/**
 * THE POLICY IN FORCE, AS THE SERVER SAYS IT (#232 Phase 2). Read-only: readMyFinancialPolicyAuthority names the
 * companies this viewer's finance.policy.read reaches (none -> the read is refused and the section says so, never "Not
 * configured"), then readFinancialPolicy per company answers CONFIGURED or NOT_CONFIGURED. Nothing here edits.
 */
function useFinancialPolicySummary(financeApi) {
  const [state, setState] = useState({ status: "LOADING", companies: [], failure: null });
  useEffect(() => {
    let live = true;
    (async () => {
      const auth = await financeApi("readMyFinancialPolicyAuthority", {});
      if (!live) return;
      if (!auth.ok) { setState({ status: "UNAVAILABLE", companies: [], failure: describeFailure(auth) }); return; }
      const companies = await Promise.all((auth.result?.companies ?? []).map(async (c) => {
        const res = await financeApi("readFinancialPolicy", { operatingCompanyId: c.operatingCompanyId });
        return { id: c.operatingCompanyId, name: c.name, read: res.ok ? res.result : null, failure: res.ok ? null : describeFailure(res) };
      }));
      if (live) setState({ status: "READY", companies, failure: null });
    })();
    return () => { live = false; };
  }, [financeApi]);
  return state;
}

const policyWords = (policy) => [
  choiceLabel("inventoryCostMethod", policy.inventoryCostMethod),
  `serialized: ${choiceLabel("serializedInventoryCostMethod", policy.serializedInventoryCostMethod)}`,
  `COGS at ${choiceLabel("cogsRecognitionPointId", policy.cogsRecognitionPointId)}`,
].join(" · ");

function PolicyInForceRows({ summary }) {
  if (summary.status === "LOADING") return <Row label="Policy In Effect" words="Loading…" />;
  if (summary.status === "UNAVAILABLE") {
    const code = summary.failure?.code;
    const words = code === "CAPABILITY_REQUIRED" || code === "FORBIDDEN"
      ? "Visible to holders of Financial Policy access"
      : code === "NOT_CONFIGURED" ? "Not available in this environment" : "Could not be read";
    return <Row label="Policy In Effect" words={words} tip="This summary shows only what the server answers for you. A refused or unavailable read is never shown as Not configured." />;
  }
  if (summary.companies.length === 0) {
    return <Row label="Policy In Effect" words="No operating company is covered by your Financial Policy access"
      tip="The server answered and listed no company you may read. That is not the same as a policy that is not configured." />;
  }
  return summary.companies.map((c) => {
    if (!c.read) return <Row key={c.id} label={`${c.name}`} words="Could not be read" />;
    if (c.read.state !== "CONFIGURED" || !c.read.inForce) {
      return <Row key={c.id} label={`${c.name}`} state="Not configured" words={c.read.scheduled ? `Scheduled from ${c.read.scheduled.effectiveDate}` : "No policy in effect"}
        tip="EOS applies no costing method until a policy is approved and activated, and never assumes one." />;
    }
    const v = c.read.inForce;
    return <Row key={c.id} label={`${c.name}`} state="Configured" words={`${policyWords(v.policy)} · version ${v.versionNumber}, effective ${v.effectiveDate}`}
      tip={c.read.scheduled ? `Version ${c.read.scheduled.versionNumber} is scheduled from ${c.read.scheduled.effectiveDate}.` : null} />;
  });
}

export default function FinancialsGovernance({ financeApi = callFinanceApi }) {
  const policySummary = useFinancialPolicySummary(financeApi);
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
              <h2 className="ns-section__title">Authority &amp; Scope</h2>
            </div>
            <Row label="Financial Authority Mode" state="Configured" words="Operational subledger" />
            <Row label="External Accounting Authority" state="Future integration" words="Not selected" />
            <Row label="Reconciliation Provider (FIN-010)" state="Not configured" tip="Internal operational reconciliation (IN_SYNC/DRIFT) is merged and dormant; the external provider decision has not been made." />
            <Row
              label="Cost Authority (FIN-006)"
              state="Built dormant"
              words="Cost-fact supply missing"
              tip="The margin derivation core is merged. Margin computes only when every required governed cost fact exists; otherwise UNKNOWN. Real cost-fact supply is an Owner decision (FIN-BLOCK-003)."
            />
            <Row label="Operating Currency" state="Configured" words="USD" last />
          </section>

          {/* ACCOUNTING POLICY — READ-ONLY, DELIBERATELY. Financials is not a second configuration
              authority: a company's accounting policy is prepared, approved and activated in ONE place,
              Administration → Financial Policy, and this section only summarizes it and links there. Two
              places to change an accounting method is two places for them to disagree.

              The rows are the SERVER's answer per company the viewer may read (#232 Phase 2): Configured
              with the policy in force, or Not configured only when the server says NOT_CONFIGURED. A viewer
              without Financial Policy access sees that said, never a fabricated "Not configured". EOS never
              implies a costing method nobody chose. */}
          <section className="ns-section" aria-label="Accounting policy">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Accounting Policy</h2>
            </div>
            <PolicyInForceRows summary={policySummary} />
            <Row
              label="Unknown Cost"
              state="Configured"
              words="Preserved as unknown"
              tip="A platform invariant, not a deployment choice: EOS never substitutes zero for a cost it does not know."
            />
            <Row
              label="Policy Profile"
              words={<Link to="/administration/financial-policy">View Financial Policy →</Link>}
              last
            />
          </section>

          <section className="ns-section" aria-label="Structure">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Structure</h2>
            </div>
            <Row label="Companies" words={COMPANY_WORDS} />
            <Row label="Business Units" words={UNIT_WORDS} />
            <Row
              label="Financial Periods (FIN-008)"
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
              label="Goal Governance — Bases, Approval"
              state="Built dormant"
              words="Policy not configured"
              tip="The FIN-003 plan core (GOAL distinct from BUDGET, versioned, explicit basis) is merged and dormant. Approval routing and thresholds remain FIN-007 policy — not configured."
            />
            <Row label="Budget Governance — Versioning, Approval" state="Built dormant" words="Policy not configured" />
            <Row
              label="Correction Approval Policy (FIN-007)"
              state="Built dormant"
              words="Policy not configured"
              tip="The approval mechanism is merged — self-approval is forbidden by current authority and missing policy fails closed. Thresholds, approver roles, escalations and expiry remain unconfigured."
            />
            <Row
              label="Visibility Policy Summary"
              words="SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED"
              tip="Read-only summary of the visibility scope VOCABULARY as it applies to financial facts. It lists the scopes that exist, not who holds them and not which are active — grants and activation live in the platform's role system and are resolved server-side per principal; this page never duplicates or asserts them."
            />
            <Row label="Financial Classifications (FIN-009)" state="Not configured" last />
          </section>

          <section className="ns-section" aria-label="References">
            <div className="ns-section__head">
              <h2 className="ns-section__title">References</h2>
            </div>
            <Row label="Financial Audit Lens" words={<Link to="/financials/audit">Audit &amp; History →</Link>} last />
          </section>
        </div>
      </div>
    </FinancialsPageFrame>
  );
}
