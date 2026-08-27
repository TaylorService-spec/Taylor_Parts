import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useSalesAgreementById } from "../../hooks/useSalesAgreementById.js";
import { SALES_AGREEMENT_VIEW_STATE } from "../../domain/salesAgreementView.js";
import { SALES_AGREEMENT_ABSENCE, SALES_AGREEMENT_ABSENCE_SENTENCE } from "../../domain/salesAgreementRead.js";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { useAccountNamesWithStatus, ACCOUNT_NAMES_STATUS } from "../../hooks/useAccountNames.js";
import { REFERENCE_STATE, REFERENCE_STATE_LABEL } from "../../metadata/referenceResolution.js";
import { formatMoment } from "../../domain/displayTimestamp";
import { resolveEmployeeIdentity } from "../../domain/actorDisplayName.js";
import { SALES_AGREEMENT_READ_CAPABILITY } from "../../access/salesAgreementCapabilityAccess.js";
import {
  salesAgreementHeader,
  salesAgreementLines,
  salesAgreementMoneyLadder,
  salesAgreementAcceptance,
  salesAgreementProvenance,
  salesAgreementDownstream,
  salesAgreementTerms,
  salesAgreementActions,
  SALES_AGREEMENT_ACCEPTANCE_LABEL,
} from "../../domain/salesAgreementNorthStar.js";

// THE SALES AGREEMENT, COMPOSED IN THE NORTH STAR GRAMMAR — family 5.
//
// Visual authority: docs/north-star/sales-agreement/North Star - Sales Agreement P1v2.dc.html.
// Owner ruling: DECISIONS #134 — a first-class routed record page. Work order: PR 3 of six in
// docs/implementation-plans/sales-agreement-north-star.md.
//
// ════════════════════ IT ADDS NO AUTHORITY, AND ALMOST NO LOGIC ════════════════════
//
// Every fact on this page comes from domain/salesAgreementNorthStar.js (PR 1) over the view the
// by-id seam produced (PR 2). This file decides nothing about state, money, eligibility or
// acceptance — it places what those two already decided. That is why the page suite can assert
// semantics rather than pixels: the semantics are not in here.
//
// The read is the existing governed `getSalesAgreementContext`. No callable, capability, index or
// Rules change; no write path at all until PR 4.
//
// ════════════════════ NO LIFECYCLE BAND, AND THAT IS THE DESIGN (SA-D2) ════════════════════
//
// Every other North Star family draws one. This one must not: DRAFT → ACCEPTED | DECLINED is a gate
// with terminal outcomes, and `checkAgreementTransition` refuses every move out of them. Chevrons
// would manufacture a journey the engine does not have. The page suite asserts the absence.
//
// ════════════════════ THE SHIPPED GRAMMAR, NOT THE ARTIFACT'S WIDTHS (ND-16) ════════════════════
//
// The artifact composes 224 nav / 300 rail / 40 gap. `.ns-record-body` ships `minmax(0,1fr) 340px`
// with a 56px gap and is shared by four families. Owner ruling: build to the shipped grammar. This
// file therefore adds no layout CSS at all and composes `ns-page`, `ns-record-body`, `RuledSection`
// and `ns-table` exactly as the other four do. The divergence stays recorded as ND-16.
//
// ════════════════════ NOT_ENABLED AND DENIED, AND WHY THE CLIENT CANNOT ALWAYS TELL ═════════════
//
// The read is gated on `salesAgreement.read` before it is attempted, matching the convention
// OpportunityDetail already uses — an undeployed callable answers 404 without CORS headers, so
// asking anyway logs a red error about a feature that is simply not deployed.
//
// But environment enablement and authorization are ONE signal here: environmentCapabilityOverrides
// decides which capabilities an environment activates at all, so "not live in this environment" and
// "not granted to you" both arrive as the capability being absent, and the client genuinely cannot
// separate them at gate time. The gate therefore renders the NOT_ENABLED sentence, which is what the
// view model's own state means. DENIED remains reachable and distinct: the callable itself answers
// `permission-denied` when the grant changed under a live feature. The two are never collapsed in
// the rendering — they are two different sentences — and the limit is stated here rather than
// papered over.

/** The action cluster. Eligibility is PR 1's; invocation arrives in PR 4. */
function AgreementActions({ actions, onEditDraft, onRecordAcceptance }) {
  if (!actions?.edit && !actions?.accept) return null;
  const handlers = { updateSalesAgreementDraft: onEditDraft, acceptSalesAgreement: onRecordAcceptance };

  // ABSENT IS NOT DISABLED. A terminal agreement offers no edit at all, because a disabled control
  // sends somebody hunting for a permission problem that does not exist (SA-D11).
  const offered = [actions.accept, actions.edit].filter((a) => a && a.present);
  if (offered.length === 0) return null;

  return (
    <>
      {offered.map((action, index) => {
        const handler = handlers[action.id] ?? null;
        // A control with no handler is truthfully disabled, never live-looking and inert: this page
        // ships before PR 4 wires the commands, and a dead button is the defect the grammar names.
        const live = action.available && typeof handler === "function";
        const reason = action.reason ?? (action.available ? "This action is not connected on this page yet." : null);
        return (
          <button
            key={action.id}
            type="button"
            className={index === 0 ? "fo-button fo-button--primary" : "fo-button"}
            disabled={!live}
            onClick={live ? handler : undefined}
            title={reason ?? undefined}
            data-restriction={action.restriction ?? undefined}
          >
            {action.label}
          </button>
        );
      })}
      {offered
        .filter((a) => !a.available && a.reason)
        .map((a) => (
          // The reason is stated, not only hovered — the view model's own sentence for a state
          // block, the capability's own sentence for a permission one. Never interchanged.
          <p key={`${a.id}-reason`} className="ns-action-reason" data-restriction={a.restriction}>
            {a.reason}
          </p>
        ))}
    </>
  );
}

export default function SalesAgreementDetail({ hasCapability = () => false, onEditDraft, onRecordAcceptance } = {}) {
  const { salesAgreementId } = useParams();
  const mayRead = hasCapability(SALES_AGREEMENT_READ_CAPABILITY) === true;
  const { view, absence, refresh } = useSalesAgreementById(salesAgreementId, { enabled: mayRead });

  const ready = view.kind === SALES_AGREEMENT_VIEW_STATE.READY;

  // THE CUSTOMER IS NAMED, NOT KEYED (DECISIONS #106) — through the same batched read the lists use.
  const accountIds = useMemo(() => (ready && view.accountId ? [view.accountId] : []), [ready, view.accountId]);
  const { names: accountNames, status: accountNamesStatus } = useAccountNamesWithStatus(accountIds);
  const accountName = ready && view.accountId ? accountNames.get(view.accountId) : null;
  const accountFallbackState =
    accountNamesStatus === ACCOUNT_NAMES_STATUS.DENIED ? REFERENCE_STATE.DENIED
      : accountNamesStatus === ACCOUNT_NAMES_STATUS.ERROR ? REFERENCE_STATE.ERROR
        : accountNamesStatus === ACCOUNT_NAMES_STATUS.READY ? REFERENCE_STATE.NOT_FOUND
          : REFERENCE_STATE.LOADING;

  // ONE DIRECTORY READ for both the owner and the acceptance actor. An employee id is a routing key
  // and never content, and a raw Firebase uid must never reach a non-Admin DOM (F-UID-1).
  const directory = useEmployeeDirectory();
  const owner = resolveEmployeeIdentity(ready ? view.ownerEmployeeId : null, {
    byEmployeeId: directory.byEmployeeId,
    loading: directory.loading,
    error: directory.error ?? null,
  });

  // ── THE HONEST STATES, EACH ITS OWN SENTENCE ─────────────────────────────────────────────────
  //
  // IDLE first: a route parameter still resolving has not failed, and "loading" would be a claim
  // about a read that was never started.
  if (!salesAgreementId) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.LOADING} subject="this address" />
      </div>
    );
  }
  if (view.kind === SALES_AGREEMENT_VIEW_STATE.LOADING) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.LOADING} subject="this sales agreement" />
      </div>
    );
  }
  if (view.kind === SALES_AGREEMENT_VIEW_STATE.NOT_ENABLED) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.NOT_ENABLED} detail="Sales agreements aren't enabled in this environment yet." />
      </div>
    );
  }
  if (view.kind === SALES_AGREEMENT_VIEW_STATE.DENIED) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.DENIED} detail="You do not have permission to view Sales Agreements." />
      </div>
    );
  }
  if (view.kind === SALES_AGREEMENT_VIEW_STATE.UNAVAILABLE) {
    return (
      <div className="ns-page">
        <HonestState
          state={HONEST_STATE.UNAVAILABLE}
          detail="We couldn't reach this sales agreement just now."
          action={<button type="button" className="fo-button" onClick={refresh}>Try again</button>}
        />
      </div>
    );
  }
  if (view.kind === SALES_AGREEMENT_VIEW_STATE.NONE) {
    // NOT_FOUND, not "none yet". This address resolves to nothing, and offering to CREATE here
    // would be offering to create an agreement from nowhere — the distinction PR 2 exists to keep.
    return (
      <div className="ns-page">
        <HonestState
          state={HONEST_STATE.NOT_APPLICABLE}
          detail={SALES_AGREEMENT_ABSENCE_SENTENCE[absence ?? SALES_AGREEMENT_ABSENCE.NOT_FOUND]}
        />
      </div>
    );
  }

  const header = salesAgreementHeader(view, { resolveAccountName: () => accountName ?? null });
  const lines = salesAgreementLines(view);
  const ladder = salesAgreementMoneyLadder(view);
  const acceptance = salesAgreementAcceptance(view, {
    byUserId: directory.byUserId,
    formatWhen: (ms) => formatMoment(ms, { unknown: "" }),
  });
  const provenance = salesAgreementProvenance(view);
  const downstream = salesAgreementDownstream(view);
  const terms = salesAgreementTerms(view);
  const actions = salesAgreementActions(view, { hasCapability });

  return (
    <div className="ns-page">
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to="/customers/opportunities">Customers → Opportunities</Link>
          {provenance.sourceOpportunityId ? (
            <> → <Link to={`/customers/opportunities/${provenance.sourceOpportunityId}`}>Opportunity</Link></>
          ) : null}
          {header.reference ? ` → ${header.reference}` : null}
        </span>
        <span className="ns-gap-note" title="This page reads the agreement once. Another user's change does not appear until you refresh.">
          Read once — <button type="button" className="fo-link-button" onClick={refresh}>Refresh</button>
        </span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker={header.kicker}
        reference={header.reference}
        // DECISIONS #106 has no escape clause: an unnumbered agreement renders the truthful generic
        // label. The document id is not accepted as a prop, so it cannot be passed by mistake.
        fallbackName={header.title}
        statusWords={header.stateWords}
        statusTone={header.stateTone}
        statusVariant="sentence"
        facts={[
          {
            key: "customer",
            label: null,
            value: accountName
              ? <Link to={`/customers/${view.accountId}`}>{accountName}</Link>
              : REFERENCE_STATE_LABEL[accountFallbackState],
          },
          {
            key: "committed",
            label: null,
            // The committed value, and NOTHING while any line is unpriced — a partial sum is a real
            // figure that is not the agreement's value, and it is worse than nothing because it is
            // credible. NULL IS NOT ZERO (SA-D3).
            value: ladder.complete
              ? `${ladder.saleComposition.total.formatted}${header.currency ? ` ${header.currency} committed` : ""}`
              : `Incomplete — ${ladder.unpricedCount} line${ladder.unpricedCount === 1 ? "" : "s"} with no price`,
            title: ladder.complete ? undefined : `No total is claimed while a line is unpriced. Missing: ${ladder.unpricedRefs.join(", ")}`,
          },
          { key: "po", label: "Customer PO", value: header.customerPO },
          { key: "owner", label: "Owner", value: owner.name },
        ]}
        actions={<AgreementActions actions={actions} onEditDraft={onEditDraft} onRecordAcceptance={onRecordAcceptance} />}
      />

      {/* No LifecycleBand. See the file header — SA-D2. */}

      {!ladder.complete ? (
        /* The existing attention markup, not a second one. Blocking severity, because the engine
           will refuse acceptance until it clears — and the reason is the view model's own. */
        <div className="ns-attention" role="status" aria-label="Blocking acceptance">
          <ul className="ns-attention__list">
            <li className="ns-attention__item is-blocking">
              <span className="ns-attention__severity">Blocking acceptance</span>
              <span>
                {actions.accept?.reason
                  ?? `Every line needs a price before this can be accepted. Missing: ${ladder.unpricedRefs.join(", ")}`}
              </span>
            </li>
          </ul>
        </div>
      ) : null}

      <div className="ns-record-body">
        <div>
          {/* THE AGREED LINES LEAD. This is what the agreement IS. */}
          <RuledSection
            title="What we committed to sell"
            meta={<span className="ns-section__note">negotiated prices, fixed at acceptance</span>}
          >
            {lines.length === 0 ? (
              <HonestState state={HONEST_STATE.EMPTY} detail="No lines have been recorded on this agreement." />
            ) : (
              <div className="ns-table-wrap">
                <table className="ns-table">
                  <thead>
                    <tr>
                      <th scope="col">Line</th>
                      <th scope="col" className="ns-num">Qty</th>
                      <th scope="col" className="ns-num">Unit</th>
                      <th scope="col" className="ns-num">Committed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.lineId ?? line.ref}>
                        <td>
                          {/* THE REFERENCE IS THE IDENTITY (SA-D5/SA-G4). A line stores no display
                              name; a resolved catalogue name would ACCOMPANY this, never replace it,
                              and none is resolved here because no such read exists on this surface. */}
                          <span className="ns-ref">{line.ref ?? <span className="ns-state--na">Line — reference unavailable</span>}</span>
                          {line.displayName ? <span className="ns-line-name"> {line.displayName}</span> : null}
                          <span className="ns-line-sub">
                            {[
                              line.kind,
                              line.condition,
                              line.warranty,
                              line.estimatedArrivalMillis != null ? `est. arrival ${formatMoment(line.estimatedArrivalMillis, { unknown: "" })}` : null,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </td>
                        <td className="ns-num">{line.quantity ?? "—"}</td>
                        {/* An unpriced line says so. It never shows $0.00, which would say free. */}
                        <td className="ns-num">{line.unitPriceFormatted ?? <span className="ns-state--na">Not priced</span>}</td>
                        <td className="ns-num">{line.extendedFormatted ?? <span className="ns-state--na">Not priced</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* THE MONEY LADDER — two blocks with two jobs (SA-D8). */}
            {ladder.complete ? (
              <div className="ns-ladder">
                <dl className="ns-ladder__block" aria-label="Sale composition">
                  <div><dt>Subtotal</dt><dd className="ns-num">{ladder.saleComposition.subtotal.formatted}</dd></div>
                  {ladder.saleComposition.shipping ? <div><dt>Shipping</dt><dd className="ns-num">{ladder.saleComposition.shipping.formatted}</dd></div> : null}
                  {ladder.saleComposition.installCharge ? <div><dt>Installation charge</dt><dd className="ns-num">{ladder.saleComposition.installCharge.formatted}</dd></div> : null}
                  {ladder.saleComposition.tax ? <div><dt>Tax</dt><dd className="ns-num">{ladder.saleComposition.tax.formatted}</dd></div> : null}
                  <div className="ns-ladder__total"><dt>Total committed</dt><dd className="ns-num">{ladder.saleComposition.total.formatted}</dd></div>
                </dl>
                {ladder.credits.balance ? (
                  <dl className="ns-ladder__block ns-ladder__block--credits" aria-label="Credits recorded at commitment">
                    {ladder.credits.downPayment ? <div><dt>Down payment</dt><dd className="ns-num">−{ladder.credits.downPayment.formatted}</dd></div> : null}
                    {ladder.credits.tradeIn ? <div><dt>Trade-in</dt><dd className="ns-num">−{ladder.credits.tradeIn.formatted}</dd></div> : null}
                    <div><dt>Balance after credits</dt><dd className="ns-num">{ladder.credits.balance.formatted}</dd></div>
                    <p className="ns-section__note">
                      The agreement&apos;s own arithmetic: total minus down payment and trade-in. Not an
                      accounts-receivable balance — no payment is tracked on this record.
                    </p>
                  </dl>
                ) : null}
              </div>
            ) : (
              <p className="ns-state--na">
                No subtotal, total or balance is claimed while a line is unpriced.
              </p>
            )}
          </RuledSection>

          {/* ACCEPTANCE — EVIDENCE, NOT ESSAY. Exactly the three facts EOS writes, then the two
              short statements it can stand behind. The sentences come from PR 1's frozen contract,
              so the language boundary is asserted by test rather than by review (SA-D7). */}
          <RuledSection title="Acceptance" meta={<span className="ns-section__note">exactly what EOS records</span>}>
            {acceptance.accepted ? (
              <dl className="ns-evidence">
                <div>
                  <dt>{SALES_AGREEMENT_ACCEPTANCE_LABEL.state}</dt>
                  <dd>{acceptance.stateWords}</dd>
                </div>
                <div>
                  <dt>{SALES_AGREEMENT_ACCEPTANCE_LABEL.recordedAt}</dt>
                  <dd>{acceptance.recordedAtText || <span className="ns-state--na">Not recorded</span>}</dd>
                </div>
                <div>
                  <dt>{SALES_AGREEMENT_ACCEPTANCE_LABEL.actor}</dt>
                  <dd>{acceptance.actorName ?? <span className="ns-state--na">Not recorded</span>}</dd>
                </div>
              </dl>
            ) : null}
            {acceptance.statements.map((sentence) => (
              <p key={sentence} className="ns-section__note">{sentence}</p>
            ))}
          </RuledSection>

          <RuledSection title="What this agreement became">
            {downstream.hasOrder ? (
              <p>
                <Link to={`/customers/opportunities/sales-order/${downstream.salesOrderId}`}>
                  {downstream.salesOrderNumber ?? "Sales Order"}
                </Link>{" "}
                — created from these committed lines and prices.
              </p>
            ) : (
              // Neutral, not a failure — and no invented Create button. The order is produced by the
              // Opportunity's governed close-as-won, which can still refuse (SA-D10).
              <p className="ns-state--na">{downstream.noOrderSentence}</p>
            )}
          </RuledSection>
        </div>

        <aside className="ns-rail">
          <RuledSection title="Commercial terms" panel>
            <dl className="ns-rail__dl">
              {terms.rows.map((row) => (
                <div key={row.id}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
            {terms.shippingInstructions ? <p className="ns-rail__meta">Shipping: {terms.shippingInstructions}</p> : null}
            {terms.specialInstructions ? <p className="ns-rail__meta">Special: {terms.specialInstructions}</p> : null}
          </RuledSection>

          <RuledSection title="Why this agreement exists" panel>
            {provenance.sourceOpportunityId ? (
              <p>
                <Link to={`/customers/opportunities/${provenance.sourceOpportunityId}`}>Opportunity</Link>
                <span className="ns-rail__meta"> — the agreement was drafted from it.</span>
              </p>
            ) : (
              <p className="ns-state--na">No originating opportunity is recorded.</p>
            )}
          </RuledSection>

          <RuledSection title="Customer" panel>
            {accountName ? (
              <p><Link to={`/customers/${view.accountId}`}>{accountName}</Link></p>
            ) : (
              <p className="ns-state--na">{REFERENCE_STATE_LABEL[accountFallbackState]}</p>
            )}
          </RuledSection>

          <RuledSection title="Record" panel>
            <dl className="ns-rail__dl">
              <div><dt>Agreement</dt><dd>{header.reference ?? header.title}</dd></div>
              <div><dt>State</dt><dd>{header.stateWords}{header.isTerminal ? " · terminal" : ""}</dd></div>
            </dl>
          </RuledSection>
        </aside>
      </div>
    </div>
  );
}
