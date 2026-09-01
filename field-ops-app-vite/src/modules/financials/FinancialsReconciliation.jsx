// RECONCILIATION & EXCEPTIONS — /financials/reconciliation (North Star P1, page 16).
//
// Design authority: docs/north-star/financials/North Star - Financials 16 Reconciliation.dc.html
// AS RECONCILED against current main (the two-section split is part of the installed
// design source, applied 2026-09-01). Two facts that must never be conflated:
//
//   1. OPERATIONAL INTEGRITY — internal FIN-010 reconciliation. The core is MERGED: it
//      reconciles stored financial projections against durable facts and classifies each
//      record IN_SYNC or DRIFT; nothing auto-fixes; malformed/foreign facts never report
//      false sync. It is BUILT_DORMANT — no results surface — so this section shows only
//      actual governed results, which today is the honest "none to show".
//
//   2. EXTERNAL ACCOUNTING RECONCILIATION — FUTURE INTEGRATION. No accounting authority
//      of record has been selected. No counts, not zero counts; no provider UI; the
//      dimmed structural specimen keeps the designed columns with deliberately empty
//      values, and the working state names are provisional vocabulary, not authority.
import {
  FinancialsPageFrame,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";

const EXTERNAL_STATE_NAMES = ["NOT_SENT", "PENDING", "ACCEPTED", "REJECTED", "EXCEPTION", "RECONCILED"];

export default function FinancialsReconciliation() {
  return (
    <FinancialsPageFrame
      title="Reconciliation & Exceptions"
      crumb="Reconciliation & Exceptions"
      custody="Internal operational integrity and external accounting reconciliation are two different facts, kept separate on this page."
      custodyTip="EOS reconciles its own stored projections against durable facts (FIN-010 internal core, merged and dormant). Reconciling against an external accounting system is FUTURE INTEGRATION — no accounting authority of record has been selected, so that workspace reports no counts, not zero counts."
    >
      <section className="ns-section" aria-label="Operational integrity">
        <div className="ns-section__head">
          <h2 className="ns-section__title">Operational integrity — internal reconciliation</h2>
          <span className="ns-section__meta">· FIN-010 · IN_SYNC / DRIFT · nothing auto-fixes</span>
        </div>
        <p className="fin-custody-note">
          The internal core classifies each reconciled record <strong>IN_SYNC</strong> or{" "}
          <strong>DRIFT</strong>; malformed or foreign facts never report false sync.
          <FinAnnotation tip="Merged capability: invoice projections are recomputed from durable facts (applications, credits, charges, write-offs) and diffed against stored state; receipts reconcile applied+unapplied against amount. BUILT_DORMANT — no results read is activated, so only actual governed results ever render here." />
        </p>
        <div className="fin-truth-band">
          <strong>No governed reconciliation results to show.</strong>
          <p>
            The internal reconciliation core exists but its results read is not activated
            (BUILT_DORMANT). When activated, records classified DRIFT list here first; IN_SYNC
            totals follow. No external provider is involved in this section.
          </p>
        </div>
      </section>

      <section className="ns-section" aria-label="External accounting reconciliation">
        <div className="ns-section__head">
          <h2 className="ns-section__title">External accounting reconciliation</h2>
          <span className="ns-section__meta">· FUTURE INTEGRATION · no accounting authority selected</span>
        </div>
        <div className="fin-truth-band">
          <strong>No external accounting authority is connected.</strong>
          <p>
            Nothing has been sent, accepted, rejected or reconciled — this workspace reports no
            counts, not zero counts. When FIN-010 selects a provider and fixes the state
            vocabulary, the exception queue below activates against real reads.
          </p>
        </div>
        <div className="ns-table-wrap fin-dimmed" aria-label="Designed exception queue (inactive)">
          <table className="ns-table">
            <caption className="fo-sr-only">
              Designed external exception queue — structural specimen, deliberately empty
            </caption>
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Source</th>
                <th scope="col">Company</th>
                <th scope="col" className="ns-num">EOS amount</th>
                <th scope="col" className="ns-num">External amount</th>
                <th scope="col">Difference</th>
                <th scope="col">External ref</th>
                <th scope="col">State</th>
              </tr>
            </thead>
          </table>
        </div>
        <p className="fin-section-note">
          Structural specimen, dimmed — columns and states are the design contract, values are
          deliberately empty
          <FinAnnotation tip={`Working state names (${EXTERNAL_STATE_NAMES.join(" / ")}) are PROVISIONAL VOCABULARY — the final names belong to FIN-010 with the provider decision. No vendor UI (sync buttons, provider logos) is drawn. Permitted actions on an exception are an open product question (FIN-PQ-16a).`} />
        </p>
      </section>
    </FinancialsPageFrame>
  );
}
