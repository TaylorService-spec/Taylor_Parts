import { Link } from "react-router-dom";
import { Button } from "../../shared/ui/primitives/index.js";
import { formatMoneyDisplay } from "../../domain/moneyDisplay.js";
import {
  SALES_AGREEMENT_VIEW_STATE,
  salesAgreementLabel,
  agreementAcceptability,
} from "../../domain/salesAgreementView.js";
import { salesAgreementEntity } from "../../metadata/definitions/salesAgreement.js";
import { SALES_AGREEMENT_CREATE_CAPABILITY } from "../../access/salesAgreementCapabilityAccess.js";

// THE SALES AGREEMENT, AS A RELATED RECORD ON THE OPPORTUNITY — North Star P1v2.
//
// ════════════════════ WHY THIS IS NOT `SalesAgreementPanel` ════════════════════
//
// `SalesAgreementPanel` is the workspace's FULL agreement surface: draft editing, line pricing,
// the accept flow, terms. P1v2 is explicit that none of that belongs on the Opportunity —
// "acceptance, pricing and terms live on the agreement itself, not here" — and the implementation
// brief puts agreement lifecycle UI out of scope entirely, reserved for the Sales Agreement North
// Star run.
//
// So this composes the same AUTHORITY without importing that surface: the same
// `useSalesAgreement` hook (passed in), the same `salesAgreementView` view model, the same
// `salesAgreementLabel` identity rule and the same `agreementAcceptability` reason. It adds no
// read, no command and no state of its own. Rendering the panel here instead would have pulled an
// acceptance button onto a page whose design says acceptance does not happen here.
//
// ════════════════════ SIX STATES, NEVER COLLAPSED ════════════════════
//
// P1v2 names them and the view model already distinguishes them. They are genuinely different
// facts and a reader acts differently on each:
//
//   NOT_ENABLED  the feature is not live in this environment — no read is even attempted
//   DENIED       a real authorization answer about a live feature
//   UNAVAILABLE  the read failed; retryable
//   NONE         there is no agreement, which is an ordinary and common state
//   LOADING      a read is in flight
//   READY        an agreement exists
//
// Flattening any of these into a generic failure is the "fail-closed became fail-blank" defect the
// grammar exists to remove.
//
// ════════════════════ NEVER A DEAD CREATE BUTTON ════════════════════
//
// Create renders only when the agreement layer is BOTH enabled in this environment AND the caller
// holds `salesAgreement.create`. `hasCapability` is fail-closed, so a caller that injects nothing
// gets no button rather than one that will be refused.

// The canonical state words live on the entity definition. SalesAgreementPanel.jsx keeps a private
// STATE_LABEL copy of the same three strings; this reads the definition rather than adding a third
// copy, which is exactly the duplication the Account family had to unwind.
const STATE_WORDS = salesAgreementEntity.fields.find((f) => f.id === "state")?.enumLabels ?? {};

/** The clause P1v2 writes after the identifier: "Draft — awaiting acceptance" / "Accepted {date}". */
function stateSentence(view, formatWhen) {
  const words = STATE_WORDS[view.state] ?? null;
  if (!words) return null;
  if (view.state === "DRAFT") return `${words} — awaiting acceptance`;
  if (view.state === "ACCEPTED") {
    const when = view.acceptedAtMillis != null ? formatWhen(view.acceptedAtMillis) : null;
    return when ? `${words} ${when}` : words;
  }
  return words;
}

/** Tone so the state word is never carried by colour alone (R04). */
function stateTone(state) {
  if (state === "ACCEPTED") return "positive";
  if (state === "DECLINED") return "negative";
  return "info";
}

export default function OpportunityAgreementCard({
  agreement,
  opportunityId,
  hasCapability = () => false,
  formatWhen = (v) => String(v),
}) {
  const view = agreement?.view ?? { kind: SALES_AGREEMENT_VIEW_STATE.LOADING };
  const canCreate = hasCapability(SALES_AGREEMENT_CREATE_CAPABILITY) === true;

  // THE AGREEMENT NOW HAS ITS OWN ADDRESS.
  //
  // This used to link to the workspace pane with the opportunity selected, because no per-agreement
  // route existed and §20 says navigation either works, is truthfully disabled, or is absent. The
  // Sales Agreement North Star run gave it one (DECISIONS #134), so the link goes to the record
  // itself.
  //
  // The document id is the ROUTE KEY and nothing else — the visible text is `salesAgreementLabel`,
  // the governed number or the truthful generic. A routing key is not a name (DECISIONS #106).
  const agreementHref = (id) => `/customers/opportunities/sales-agreement/${encodeURIComponent(id)}`;

  const heading = (
    <h2 className="ns-section__title">
      Sales agreement{" "}
      <span className="ns-section__note">
        · the commercial commitment — related record, never a stage of this lifecycle
      </span>
    </h2>
  );

  function body() {
    switch (view.kind) {
      case SALES_AGREEMENT_VIEW_STATE.LOADING:
        return <p className="ns-state">Loading the agreement…</p>;

      case SALES_AGREEMENT_VIEW_STATE.NOT_ENABLED:
        // No read was attempted at all. One sentence, once — never a page of padlocks.
        return <p className="ns-state ns-state--not-enabled">Sales agreements aren’t enabled in this environment yet.</p>;

      case SALES_AGREEMENT_VIEW_STATE.DENIED:
        return (
          <p className="ns-state ns-state--denied">
            Not available to you. Ask an administrator if you believe you need it.
          </p>
        );

      case SALES_AGREEMENT_VIEW_STATE.UNAVAILABLE:
        return (
          <p className="ns-state">
            Couldn’t load the agreement — {" "}
            <button type="button" className="fo-link-button" onClick={agreement?.refresh}>try again</button>.
            Your work elsewhere is unaffected.
          </p>
        );

      case SALES_AGREEMENT_VIEW_STATE.NONE:
        return (
          <div className="ns-agreement ns-agreement--none">
            <span>No sales agreement associated.</span>
            {canCreate ? (
              <Button
                type="button"
                variant="secondary"
                disabled={!!agreement?.pending?.create}
                onClick={() => agreement?.create?.({ opportunityId })}
              >
                {agreement?.pending?.create ? "Creating…" : "Create Sales Agreement"}
              </Button>
            ) : null}
          </div>
        );

      default:
        return readyCard();
    }
  }

  function readyCard() {
    const label = salesAgreementLabel(view);
    // READY implies the record was read, so its routing id is present. Absent it, no link renders
    // at all rather than one that goes nowhere.
    const href = view.id ? agreementHref(view.id) : null;
    const sentence = stateSentence(view, formatWhen);
    const acceptability = agreementAcceptability(view);
    const lineCount = view.lines?.length ?? 0;

    // PRICING READINESS, in the view model's own words. When every line is priced the card says
    // so plainly; when it is not, the reason names which lines — the same sentence the agreement
    // surface would give, so the reader is never sent there to find out why.
    const pricing = lineCount === 0
      ? "No lines yet"
      : acceptability.canAccept
        ? `${lineCount} line${lineCount === 1 ? "" : "s"}, all priced`
        : (acceptability.reason ?? `${lineCount} line${lineCount === 1 ? "" : "s"}`);

    // THE AGREEMENT'S MONEY IS REAL MONEY. Unlike the opportunity's expected value, the agreement
    // record stores a currency, so this renders with its symbol — the one place on this page where
    // that is justified. Integer minor units all the way to the formatter.
    // `formatMoneyDisplay`, NOT `formatMinorUnits`: the latter returns bare digits ("23450.00").
    // The display helper adds the symbol and grouping ONLY when a real 3-letter currency code is
    // present and falls back to exact digits otherwise -- which is the same rule the opportunity's
    // own value obeys by showing no symbol at all. One rule, two records, opposite outcomes,
    // because the data differs.
    const total = typeof view.totalMinor === "number"
      ? formatMoneyDisplay(view.totalMinor, view.currency)
      : null;

    return (
      <>
        <div className="ns-agreement">
          <div className="ns-agreement__facts">
            {href ? <Link to={href} className="ns-agreement__ref">{label}</Link> : <span className="ns-agreement__ref">{label}</span>}
            {sentence ? (
              <>
                {" · "}
                <span className={`ns-agreement__state is-${stateTone(view.state)}`}>{sentence}</span>
              </>
            ) : null}
            <div className="ns-agreement__detail">
              {pricing}
              {total ? <> · total <strong className="ns-num-inline">{total}</strong></> : null}
              {view.salesOrderId ? (
                <> · <Link to={`/customers/opportunities/sales-order/${view.salesOrderId}`}>Sales order</Link></>
              ) : (
                <> · not yet tied to a sales order</>
              )}
            </div>
          </div>
          {href ? <Link to={href} className="fo-button ns-agreement__action">View agreement</Link> : null}
        </div>
        <p className="ns-gap-note">
          The agreement carries its own currency, so its money renders as money — unlike the
          estimated value above. Acceptance, pricing and terms live on the agreement itself, not here.
        </p>
      </>
    );
  }

  return (
    <section className="ns-section" aria-label="Sales agreement">
      <div className="ns-section__head">{heading}</div>
      <div className="ns-section__body">
        {body()}
        {agreement?.commandError ? (
          <p className="ns-state ns-state--error" role="alert">{agreement.commandError}</p>
        ) : null}
      </div>
    </section>
  );
}
