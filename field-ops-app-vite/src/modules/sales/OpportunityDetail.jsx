import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useOpportunity } from "../../hooks/useOpportunity.js";
import { useOpportunityTransitions } from "../../hooks/useOpportunityTransitions.js";
import { useOpportunitySectionSave } from "../../hooks/useOpportunitySectionSave.js";
import { useSalesAgreement } from "../../hooks/useSalesAgreement.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { opportunityView, OPPORTUNITY_VIEW_STATE } from "../../domain/opportunityView.js";
import { opportunityDetailModel } from "../../domain/opportunityFieldModel.js";
import { isOpportunityEditable } from "../../domain/opportunitySectionSave.js";
import { opportunityWriteReadiness } from "../../access/opportunityWriteReadiness.js";
import { UNRESOLVED_REFERENCE_LABEL } from "../../metadata/referenceResolution.js";
import { SALES_AGREEMENT_READ_CAPABILITY } from "../../access/salesAgreementCapabilityAccess.js";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import OpportunityLifecycleControl from "./OpportunityLifecycleControl.jsx";
import OpportunityAgreementCard from "./OpportunityAgreementCard.jsx";
import { DetailSection, ownerName as resolveOwnerName, currency as formatValue, shortDate } from "./opportunitySections.jsx";
import { formatDateOnly } from "../../domain/displayTimestamp";
import {
  opportunityHeader,
  opportunitySpine,
  opportunityAttentionStrip,
  opportunityDaysOpen,
  opportunityValueDisplay,
  opportunityConversion,
} from "../../domain/opportunityNorthStar.js";

// THE OPPORTUNITY RECORD PAGE — North Star P1v2.
//
// Visual authority:   `North Star - Opportunity P1v2.dc.html` (design_handoff_opportunity).
// Behavioral authority: this repository, unchanged.
// Acceptance:         the running sandbox + the Owner.
//
// ════════════════════ PRESENTATION-LAYER MIGRATION ════════════════════
//
// Every fact on this page is READ from an existing governed projection and every action is COMPOSED
// from an existing governed command. This file adds no capability, no command, no Rules change, no
// state machine, no numbering and no pricing. Where authority is absent, the truthful gap renders
// instead — the design names five such gaps (O1–O5) and each has a visible, honest slot rather than
// a fabricated value.
//
// ════════════════════ THE SEVEN THINGS IT COMPOSES, AND WHERE THEY COME FROM ════════════════════
//
//   identity + facts     `getOpportunityContext` (per-id governed read) via useOpportunity
//   stage chevrons       `stageProgress` — the SAME derivation the pipeline row draws
//   one legal advance    `allowedActions` — the engine decides, never this file
//   Won / Lost           `useOpportunityTransitions` → transitionOpportunity / closeOpportunityAsWon
//   section editing      `useOpportunitySectionSave` → updateOpportunity, version-checked
//   attention strip      `deriveAttention` verbatim, worded by opportunityNorthStar.js
//   sales agreement      `useSalesAgreement` → the existing agreement read/create authority
//
// ════════════════════ THE LIFECYCLE CONTROL IS MOUNTED TWICE, ON PURPOSE ════════════════════
//
// P1v2 puts the chevrons under the header and Mark Won / Mark Lost IN the header cluster. Both come
// from `OpportunityLifecycleControl`, in its `chevrons` and `actions` slots, and BOTH RECEIVE THE
// SAME `transitions` OBJECT — one idempotency cache, one invocation of the governed command. That
// is why the transitions hook lives here rather than inside the control.
//
// ════════════════════ WHY THE CHEVRONS ARE LEGITIMATE HERE ════════════════════
//
// The Account family draws no lifecycle spine because its four statuses are an editable field with
// no transition command (ND-11). An Opportunity has six governed stages, a legality graph and a
// transition command, so chevrons assert a rule the engine genuinely holds. The design says so in
// as many words: "this family legally gets chevrons".
//
// ════════════════════ AND WHY THE SALES AGREEMENT IS NOT ONE OF THEM ════════════════════
//
// The agreement is a RELATED COMMERCIAL RECORD, never a stage. It must never appear in the chevron
// row, acceptance never moves the opportunity's stage, and an agreement is never a prerequisite for
// Won — all four are repository truth (decision O6), and all four are asserted by the test suite.

export default function OpportunityDetail({ readiness, hasCapability = () => false, actionDeps, saveDeps } = {}) {
  const { opportunityId } = useParams();
  const { loading, errorStatus, result, refetch } = useOpportunity(opportunityId);
  const view = opportunityView({ loading, errorStatus, result });
  const ready = view.kind === OPPORTUNITY_VIEW_STATE.READY;

  // ─────────────────────────── seams, all called unconditionally (rules of hooks)

  // THE WRITE SEAM, FAIL-CLOSED BY DEFAULT. `opportunityWriteReadiness()` with no arguments is a
  // hard refusal, so a mount that injects nothing — every unit test, and any future mount that
  // forgets — gets protected controls carrying their reason rather than live ones.
  const effectiveReadiness = readiness ?? opportunityWriteReadiness();
  const transitions = useOpportunityTransitions(opportunityId, actionDeps);
  const sectionSave = useOpportunitySectionSave(opportunityId, saveDeps);
  // Gated on the READ capability exactly as the workspace gates it: an ungranted caller issues no
  // request at all, so a feature that is not deployed cannot fill the console with failed round
  // trips — and NOT_ENABLED stays a distinct state rather than arriving as a failure.
  const agreement = useSalesAgreement(opportunityId, {
    enabled: hasCapability(SALES_AGREEMENT_READ_CAPABILITY) === true,
  });
  const directory = useEmployeeDirectory();
  const [editingSection, setEditingSection] = useState(null);

  const nowMillis = Date.now();

  // ─────────────────────────── every fact, derived ONCE
  const header = useMemo(() => (ready ? opportunityHeader(view) : null), [ready, view]);
  const spine = useMemo(() => opportunitySpine(ready ? view : null), [ready, view]);
  const attention = useMemo(
    () => (ready ? opportunityAttentionStrip(view, nowMillis) : { present: false, reasons: [], nextAction: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowMillis is read per render on purpose; "overdue" is relative to now
    [ready, view],
  );
  const daysOpen = ready ? opportunityDaysOpen(view, nowMillis) : null;
  const conversion = useMemo(
    () => (ready ? opportunityConversion(view, agreement?.view) : null),
    [ready, view, agreement],
  );

  const ownerDisplay = ready
    ? resolveOwnerName(view.ownerEmployeeId, directory)
    : null;

  // The section model the workspace pane already uses, so both surfaces offer the same fields,
  // the same four data classes and the same edit affordances.
  const model = useMemo(
    () => (ready
      // THE SAME FORMATTERS THE WORKSPACE INJECTS. Without them the rail fell back to the model's
      // bare defaults and rendered "41000" and "2026-08-31" beside a header saying "41,000" and
      // "Aug 31" — one fact, two renderings, on one page.
      ? opportunityDetailModel(commandRow(view), {
        resolveOwnerName: (id) => resolveOwnerName(id, directory),
        format: { currency: formatValue, date: shortDate },
      })
      : { sections: [] }),
    [ready, view, directory],
  );
  const bySlot = useMemo(() => Object.fromEntries((model.sections ?? []).map((s) => [s.id, s])), [model]);

  // ─────────────────────────── the honest read states (P1v2 1c)

  if (view.kind === OPPORTUNITY_VIEW_STATE.LOADING) {
    return <div className="ns-page"><HonestState state={HONEST_STATE.LOADING} subject="opportunity" /></div>;
  }
  if (view.kind === OPPORTUNITY_VIEW_STATE.DENIED) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.DENIED} subject="Opportunities" detail="Opportunities are not available to you." />
      </div>
    );
  }
  if (view.kind === OPPORTUNITY_VIEW_STATE.NOT_FOUND) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.EMPTY} detail="No opportunity exists for this address." />
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="ns-page">
        <HonestState
          state={HONEST_STATE.UNAVAILABLE}
          detail="Couldn’t load this opportunity."
          action={<button type="button" className="fo-button" onClick={refetch}>Try again</button>}
        />
      </div>
    );
  }

  const value = opportunityValueDisplay(view, (n) => n.toLocaleString());
  const recordEditable = isOpportunityEditable(view);
  const row = commandRow(view);

  const renderSection = (id) => {
    const section = bySlot[id];
    if (!section) return null;
    return (
      <DetailSection
        key={id}
        section={section}
        editing={editingSection === id}
        onEnterEdit={setEditingSection}
        onCancelEdit={() => setEditingSection(null)}
        readiness={effectiveReadiness}
        editable={recordEditable}
        saving={!!sectionSave.pending[id]}
        outcome={sectionSave.outcome?.sectionId === id ? sectionSave.outcome : null}
        directory={directory}
        onSave={async (sectionId, draft) => {
          // THE GOVERNED, VERSION-CHECKED SAVE. `view.updatedAtMillis` is the token the caller must
          // prove it loaded; the command rejects anything else. The section closes only on a save
          // that actually happened, and the page then RE-READS rather than patching locally — a
          // locally-invented version token would fail the next save with a conflict nobody could
          // explain.
          const result = await sectionSave.saveSection(sectionId, draft, view.updatedAtMillis);
          if (result?.kind === "applied" || result?.kind === "replayed") {
            setEditingSection(null);
            refetch();
          }
          return result;
        }}
      />
    );
  };

  return (
    <div className="ns-page ns-opportunity">
      {/* Utility line: context left, what is TRUE about this read right. There is no live badge —
          useOpportunity is a one-shot callable read, and refetch() is the refresh the design names. */}
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to="/customers/opportunities">CRM/Sales → Opportunities</Link>
          {header.reference ? ` → ${header.reference}` : null}
        </span>
        <span className="ns-gap-note">
          Read-checked ·{" "}
          <button type="button" className="fo-link-button" onClick={refetch}>Refresh</button>
        </span>
      </div>
      <div className="ns-rulepair" />

      {/* ─────────────── IDENTITY (P1v2 §2).
          The SHARED RecordIdentity, not a second header. It already enforces the rules this page
          must obey — the governed reference is the one h1, an absent reference renders the truthful
          fallback, and the document id is not even accepted as a prop — so hand-rolling the block
          would have been a second implementation of the invariant families 1-3 depend on. The one
          thing P1v2 needed that it lacked was the serif subtitle, which was added to the shared
          component rather than forked here. */}
      <RecordIdentity
        kicker={header.kicker}
        reference={header.reference}
        fallbackName="Opportunity — not numbered"
        subtitle={header.subtitle}
        statusWords={header.stateSentence ?? header.stateWords}
        statusTone={header.stateTone}
        statusVariant="sentence"
        facts={[
          {
            key: "customer",
            label: null,
            value: view.accountName
              ? <Link to={`/customers/${view.accountId}`}><strong>{view.accountName}</strong></Link>
              : view.accountId
                // O2: the account link stays live even when the name does not resolve. Never the id.
                ? <Link to={`/customers/${view.accountId}`}>Customer — name unavailable</Link>
                : null,
          },
          {
            key: "value",
            label: null,
            title: value.title,
            value: value.amount
              ? <>Worth <strong className="ns-num-inline">{value.amount}</strong> <span className="ns-gap-note">{value.note}</span></>
              : null,
          },
          {
            key: "close",
            label: null,
            value: view.expectedCloseAt != null
              ? <>Closes <strong>{formatDateOnly(view.expectedCloseAt, { unknown: "—" })}</strong>{daysOpen != null ? ` · open ${daysOpen} day${daysOpen === 1 ? "" : "s"}` : null}</>
              : null,
          },
          {
            key: "owner",
            label: "Owner",
            // AN UNRESOLVED OWNER IS STATED, NOT LEFT BLANK.
            //
            // Found on the live sandbox record OPP-2026-000002: the header read "Owner" with
            // nothing after it. `ownerName()` returns NULL when the directory cannot resolve the
            // id, and this passed `<strong>{null}</strong>` -- a truthy React element wrapping
            // nothing, so RecordIdentity's own "drop a fact with no value" filter could not see it
            // was empty. A label with no value is the fail-blank the grammar exists to remove.
            //
            // Two different facts, kept apart: an opportunity with NO owner recorded is not the
            // same as one whose owner the directory could not resolve. The employee directory is
            // admin/dispatcher-only, so "cannot resolve" is a normal outcome for a legitimate
            // caller rather than an error. Neither branch ever renders the employee id.
            value: ownerDisplay
              ? <strong>{ownerDisplay}</strong>
              : view.ownerEmployeeId
                ? UNRESOLVED_REFERENCE_LABEL
                : "Unassigned",
          },
          {
            key: "agreement",
            label: null,
            // THE AGREEMENT FACT APPEARS ONLY WHEN ONE EXISTS. P1v2 is explicit: never
            // "Agreement: —". Absence is stated by the section below, not by a placeholder here.
            // RecordIdentity drops a fact whose value is null, so returning null IS the absence.
            value: agreement?.view?.kind === "READY"
              ? <>Agreement <strong><Link to={`/customers/opportunities?opportunity=${encodeURIComponent(view.id)}`}>{agreement.view.salesAgreementNumber ?? "Sales Agreement"}</Link></strong></>
              : null,
          },
        ]}
        actions={
          // The governed action cluster. Mark Won is legal only at Decision; Mark Lost from any
          // open stage. Legality is `allowedActions`', not this file's.
          <OpportunityLifecycleControl
            row={row}
            readiness={effectiveReadiness}
            transitions={transitions}
            onChanged={refetch}
            slot="actions"
          />
        }
      />

      {/* ─────────────── STAGE (P1v2 §3). Desktop draws chevrons; the phone draws the same
          position in words. Only one is in the DOM at a time (display:none removes the other from
          the accessibility tree), so nothing is announced twice. */}
      <div className="ns-stage-row">
        <span className="ns-stage-row__label">Stage</span>
        <div className="ns-stage-row__chevrons">
          <OpportunityLifecycleControl
            row={row}
            readiness={effectiveReadiness}
            transitions={transitions}
            onChanged={refetch}
            slot="chevrons"
          />
        </div>
        <span className="ns-stage-row__words">
          {header.stateWords}
          {spine.positionWords ? ` · ${spine.positionWords}` : null}
        </span>
        {spine.isLastStage && !header.isClosed ? (
          <span className="ns-stage-row__note">Last stage — the way forward is Won or Lost, above.</span>
        ) : null}
      </div>
      {spine.unrecognised ? (
        <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="This opportunity’s stage is not one the lifecycle recognises." />
      ) : null}

      {/* ─────────────── ATTENTION (P1v2 §5). Presentation of deriveAttention's four reasons —
          not a recommendation engine, and never labelled as one. Renders nothing when clean. */}
      {/* A CLOSED DEAL RAISES NOTHING. `deriveAttention` already returns [] for WON/LOST, and the
          strip is gated on the same fact so a stale stored next action cannot resurrect it: an
          attention band on a closed opportunity is noise that trains people to ignore the band. */}
      {!header.isClosed && (attention.present || attention.nextAction) ? (
        <section className="ns-attention-strip" aria-label="Attention">
          <span className="ns-attention-strip__label">Attention</span>
          <span className="ns-attention-strip__body">
            {attention.reasons.map((r, i) => (
              <span key={r.kind}>
                {i === 0 ? <strong>{r.text}</strong> : <> · {r.text}</>}
              </span>
            ))}
            {attention.nextAction
              ? <> · Next action on file: <strong>“{attention.nextAction}”</strong></>
              : null}
          </span>
          <button
            type="button"
            className="fo-link-button ns-attention-strip__action"
            onClick={() => setEditingSection("nextAction")}
          >
            Update next action →
          </button>
        </section>
      ) : null}

      {/* ─────────────── BODY: 1fr / 340 (P1v2 §6) */}
      <div className="ns-record-body">
        <div>
          {renderSection("need")}
          {renderSection("solution")}
          <p className="ns-gap-note ns-solution-note">
            Lines carry no prices — pricing on an opportunity is the single estimated value above.
            Committed prices arrive with the accepted agreement and the Sales Order. “Quoting” is a
            stage of this lifecycle, not a document: EOS has no quote object, so there is no quote
            list to show.
          </p>
          {/* The next-action section is editable from the attention strip's link as well as here. */}
          {renderSection("nextAction")}

          <OpportunityAgreementCard
            agreement={agreement}
            opportunityId={view.id}
            hasCapability={hasCapability}
            formatWhen={(v) => formatDateOnly(v, { unknown: "" })}
          />

          {/* ─────────────── WHEN THIS CLOSES (P1v2 §6). Both governed paths stated as fact.
              An agreement is NEVER a prerequisite and this page never implies the sequence is
              mandatory — repository truth, decision O6. */}
          <section className="ns-section" aria-label="When this closes">
            <div className="ns-section__head">
              <h2 className="ns-section__title">
                When this closes <span className="ns-section__note">· the governed conversion</span>
              </h2>
            </div>
            <div className="ns-section__body ns-prose">
              <p>
                Two real paths, both governed. An <strong>accepted agreement</strong> produces a
                priced Sales Order from its committed lines, or <strong>Mark Won</strong> runs the
                atomic close directly — the order is created in the same transaction from this
                opportunity’s own lines. An agreement is never a prerequisite.
                {" "}
                {conversion.hasOrder ? (
                  <>
                    This opportunity’s Sales Order is{" "}
                    <Link to={`/customers/opportunities/sales-order/${conversion.salesOrderId}`}>
                      {conversion.salesOrderNumber ?? "the linked order"}
                    </Link>.
                  </>
                ) : conversion.agreementOrderId ? (
                  <>
                    No order was created from this opportunity directly; its agreement produced{" "}
                    <Link to={`/customers/opportunities/sales-order/${conversion.agreementOrderId}`}>
                      a Sales Order
                    </Link>.
                  </>
                ) : (
                  <>No order exists for this opportunity yet.</>
                )}
                {" "}
                <strong>Mark Lost</strong> closes it with nothing created.
              </p>
            </div>
          </section>

          {/* ─────────────── ACTIVITY — the honest gap (O3). Audits exist server-side; no read
              serves them here, and CRM activity is not an active capability. Nothing is invented,
              and no timeline is reconstructed from audit data it was not designed to serve. */}
          <section className="ns-section" aria-label="Activity">
            <div className="ns-section__head">
              <h2 className="ns-section__title">
                Activity <span className="ns-section__note">· what happened, who did it, when</span>
              </h2>
            </div>
            <div className="ns-section__body">
              <p className="ns-gap-note">
                No activity history can be shown yet. Stage changes and edits are audited
                server-side, but no read serves them to this page, and notes, calls and emails have
                no home on an opportunity — the CRM activity capability is not active. The record’s
                own facts remain the timeline:{" "}
                created {formatDateOnly(view.createdAtMillis, { unknown: "not recorded" })}, last
                updated {formatDateOnly(view.updatedAtMillis, { unknown: "not recorded" })}.
              </p>
            </div>
          </section>
        </div>

        <aside className="ns-rail">
          {/* CUSTOMER. The account link and status only — the primary contact (O4) is an existing
              read that is deliberately NOT composed here: the design flags it as a confirmed
              addition because it adds a read to this surface, and the brief forbids broadening
              this migration into CRM architecture work. */}
          <section className="ns-section" aria-label="Customer">
            <div className="ns-section__head"><h3 className="ns-rail__title">Customer</h3></div>
            <div className="ns-section__body">
              {view.accountId ? (
                <>
                  <Link to={`/customers/${view.accountId}`}>
                    <strong>{view.accountName ?? "Customer — name unavailable"}</strong>
                  </Link>
                  <p className="ns-gap-note">
                    Contact facts come from the Account’s own contacts — an opportunity stores no
                    contact of its own, and none is composed here yet.
                  </p>
                </>
              ) : (
                <HonestState state={HONEST_STATE.EMPTY} detail="No customer is recorded on this opportunity." />
              )}
            </div>
          </section>

          {renderSection("commercial")}

          {/* QUALIFICATION — the ratified seam, empty until Product ratifies a schema. */}
          {renderSection("qualification")}

          <section className="ns-section" aria-label="Record">
            <div className="ns-section__head"><h3 className="ns-rail__title">Record</h3></div>
            <div className="ns-section__body">
              <dl className="ns-deflist">
                <dt>Opportunity</dt>
                <dd>{header.reference ?? "not numbered"}</dd>
                <dt>Created</dt>
                <dd>{formatDateOnly(view.createdAtMillis, { unknown: "not recorded" })}</dd>
                <dt>Updated</dt>
                <dd>{formatDateOnly(view.updatedAtMillis, { unknown: "not recorded" })}</dd>
              </dl>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * The shape the governed controls and the section model were built against.
 *
 * `OpportunityLifecycleControl` and `opportunityDetailModel` both read a PIPELINE ROW
 * (`buildPipelineRow`), and this page holds a record view. Rather than widen either to understand
 * two shapes — which is how one component quietly becomes two — the record view is adapted to the
 * row contract at the single point of use.
 *
 * `channel` deliberately carries the RAW `salesChannel` rather than the display word: it is a
 * command payload, and the server validates it against SALES_CHANNELS.
 */
function commandRow(view) {
  return {
    id: view.id,
    opportunityNumber: view.opportunityNumber,
    stage: view.stage,
    outcome: view.outcome,
    ownerEmployeeId: view.ownerEmployeeId,
    channel: view.salesChannel,
    need: view.need,
    nextAction: view.nextAction,
    expectedValue: view.expectedValue,
    expectedCloseAt: view.expectedCloseAt,
    lines: view.lines,
    salesOrderId: view.salesOrderId,
    createdAt: view.createdAtMillis,
    updatedAt: view.updatedAtMillis,
    updatedAtMillis: view.updatedAtMillis,
  };
}
