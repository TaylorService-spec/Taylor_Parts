import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useOpportunities } from "../../hooks/useOpportunities.js";
import {
  buildOpportunityPipeline,
  selectOpportunityView,
  normalizeOpportunityView,
  stageLabel,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_VIEW,
  OPPORTUNITY_VIEW_LABEL,
  OPPORTUNITY_EMPTY_TEXT,
} from "../../domain/opportunityLifecycle.js";
import {
  opportunityListRow,
  opportunityListCounts,
  filterOpportunityRows,
  opportunityResultContext,
} from "../../domain/opportunityListView.js";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
// THE RATIFIED COLLECTION HEADER. Not a bespoke one: the North Star pilot names the workspace
// header as a distinct pattern from the record header, and this primitive is it -- crumb, rule
// pair, serif title, count, and the operational summary line that answers "what matters" before
// the rows answer "what exists" (NS-P2). Reusing it is also what keeps a person who opens an
// opportunity from feeling they crossed between two products.
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
// THE SAME owner resolution the record page uses, imported rather than reimplemented so a deal
// cannot be owned by one person in the list and another on the record that list opens.
import { ownerName as resolveOwnerName } from "./opportunitySections.jsx";
// THE GOVERNED CREATE FORM, carried over from the retiring workspace.
//
// SA-G7 was exactly this failure one family earlier: a record page took over a pane's read and
// most of its writes, the pane kept ONE activated governed capability, and retiring it would have
// deleted that capability from the product. `opportunity.write` create lives only in
// NewOpportunityForm, which only SalesWorkspace mounted. Mounting it here is what makes the pane
// safe to retire -- checked before writing the replacement rather than discovered after.
import NewOpportunityForm from "./NewOpportunityForm.jsx";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { opportunityWriteReadiness } from "../../access/opportunityWriteReadiness.js";

// THE OPPORTUNITY COLLECTION — North Star List + State View P1v4.
//
// Visual authority: `docs/north-star/opportunity/Opportunity-North-Star-List-P1v4.dc.html`.
// Detail authority: P1v2, at /customers/opportunities/:opportunityId. This file ends at row
// selection and owns nothing about the record.
//
// ════════════════════ COLLECTION → RECORD, AND NOTHING IN BETWEEN ════════════════════
//
// The surface this replaces was a master-detail workspace: a pipeline on the left, a miniature
// record on the right, auto-selected on load. P1v4 rejects that outright — the record has its own
// certified route now, so the collection's whole job is finding one. Concretely, and each of these
// is asserted by a test:
//
//   * NO auto-selection. Opening the page selects nothing.
//   * NO pane, no preview, no expand, no edit-on-click.
//   * NO dependence on `?opportunity=` — that parameter existed only to address the pane.
//   * The ROW is the anchor. Clicking anywhere on it opens the record; cmd/middle-click open a tab,
//     because the reference cell is a real <a> and the row defers to it.
//
// ════════════════════ WHAT IS REUSED, AND WHAT IS ACTUALLY NEW ════════════════════
//
// STATE ENGINE — reused whole. `buildOpportunityPipeline` derives every row and every count;
// `selectOpportunityView` slices them. The tabs read the same numbers the rows do, so a tab can
// never disagree with what it opens. No filtering, ordering or counting is computed in this file.
//
// READ — reused. `useOpportunities` over the governed `listOpportunityContext`, the same seam the
// old workspace used. No new callable, no second read path, and NO PER-ROW READS of any kind.
//
// PRESENTATION — new, and deliberately so. P1v4 is explicit that reusing the shared list must not
// mean shipping a generic admin table: the context line, rule pair, serif title, count sentence,
// view tabs and row rhythm are the North Star treatment, not the default chrome.
//
// ════════════════════ THE COLUMNS STOP WHERE THE DATA STOPS ════════════════════
//
// Eight columns are designed. Seven render from facts the list read genuinely returns. The eighth
// — Agreement / Order — is the interesting one, and `opportunityListView.js` explains exactly what
// the read does and does not know. In short: the projection carries `salesAgreementId` and
// `salesOrderId`, so EXISTENCE is knowable for free; it carries no reference for either, so no
// reference is shown. A document id is never a label (DECISIONS #106), and resolving one per row
// would be the N+1 fan-out P1v4's G2 forbids.

const VIEW_ORDER = [
  OPPORTUNITY_VIEW.OPEN,
  OPPORTUNITY_VIEW.MINE,
  OPPORTUNITY_VIEW.NEEDS_ATTENTION,
  OPPORTUNITY_VIEW.AT_DECISION,
  OPPORTUNITY_VIEW.WON,
  OPPORTUNITY_VIEW.LOST,
  OPPORTUNITY_VIEW.ALL,
];

export default function OpportunityList({ source, readiness, createDeps, viewerUid = null } = {}) {
  const navigate = useNavigate();
  // `null` closed, `true` open. Local to the page and deliberately NOT in the URL: a half-filled
  // create form is not a place somebody should be able to link to or reload back into.
  const [creating, setCreating] = useState(false);
  // Search and stage narrowing are page state, not URL state. They are a scanning aid over rows
  // already loaded, and putting a half-typed query in the address bar makes a shared link mean
  // something different from what the sender was looking at.
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const { opportunities, accountNameById, status, synthetic, loading, error, refetch } = useOpportunities(source);
  // ONE directory subscription for the whole page. Owner names then resolve as a map lookup per
  // row -- never a read per row, which on a scanning surface is one round trip per visible deal.
  const directory = useEmployeeDirectory();
  // WHO IS LOOKING, resolved from the directory subscription already open above -- no extra read,
  // and no new authority. `byUserId` is keyed by the Firebase uid; an account with no linked
  // Employee record simply has no entry, and the "My opportunities" view says so rather than
  // reporting an empty queue (see selectOpportunityView).
  const viewerEmployeeId = viewerUid ? (directory.byUserId?.get(viewerUid)?.id ?? null) : null;

  // Fail-closed by default: a caller that injects nothing gets the seam's own inert readiness and
  // this page writes nothing. Production injects the real trusted capability decision.
  const writeReadiness = readiness ?? opportunityWriteReadiness();

  // THE URL HOLDS THE VIEW, and nothing else. The old surface also carried `?opportunity=` to
  // address the pane; that parameter is gone with the pane it served, and a stale link carrying it
  // simply lands on the collection.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = normalizeOpportunityView(searchParams.get("view"));
  const setView = (next) => {
    const params = new URLSearchParams(searchParams);
    // OPEN is the default and leaves no parameter behind, so a shared link stays clean.
    if (next === OPPORTUNITY_VIEW.OPEN) params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  };

  // ONE DERIVATION for rows, tabs and the count sentence -- nothing on this page filters, orders or
  // counts on its own, so a tab can never disagree with the rows it opens.
  //
  // The clock is read ONCE per render pass and shared by both derivations. Two separate
  // `Date.now()` calls can
  // straddle a day boundary and let the pipeline judge a row overdue while that same row's close
  // note still says it is due today.
  const nowMillis = Date.now();
  const pipeline = useMemo(
    () => buildOpportunityPipeline(opportunities, { nowMillis, accountNameById }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowMillis is read per render on purpose; "overdue" is relative to now
    [opportunities, accountNameById],
  );
  const selected = useMemo(
    () => selectOpportunityView(pipeline, view, { viewerEmployeeId }),
    [pipeline, view, viewerEmployeeId],
  );
  const counts = useMemo(() => opportunityListCounts(pipeline, { viewerEmployeeId }), [pipeline, viewerEmployeeId]);
  const viewRows = useMemo(
    () => selected.rows.map((r) => opportunityListRow(r, {
      nowMillis,
      resolveOwner: (employeeId) => resolveOwnerName(employeeId, directory),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see nowMillis above
    [selected, directory],
  );

  // NARROWING HAPPENS AFTER DERIVATION and over rows already in hand. Nothing here re-reads, so a
  // search cannot widen what this caller is allowed to see -- and the result line below says the
  // denominator is the VIEW, not the collection, so an empty search never looks authoritative
  // about records this page never read.
  const rows = useMemo(
    () => filterOpportunityRows(viewRows, { query, stages: [...stageFilter] }),
    [viewRows, query, stageFilter],
  );
  const narrowed = query.trim().length > 0 || stageFilter.size > 0;

  const ready = status === "ready" && !loading;

  // `ns-page` alone, with no block class of its own: this page's header, rules and table are the
  // shared primitives, and every `ns-collection__*` element class below carries real styling. A
  // bare block class that styles nothing is a hook pretending to be design.
  return (
    <div className="ns-page">
      {/* The count and summary render ONLY on a settled read. A "0 open" printed while loading, or
          after a denial, is a claim about the business rather than about the request -- and the
          primitive omits what it is not given rather than rendering a zero. */}
      <WorkspaceIdentity
        crumb="CRM / Sales"
        title="Opportunities"
        count={ready ? counts.open : null}
        countLabel={ready ? "open" : null}
        summaryItems={ready ? [
          counts.atDecision > 0 ? { key: "decision", label: `${counts.atDecision} at decision` } : null,
          counts.needsAttention > 0
            ? { key: "attention", label: `${counts.needsAttention} need attention`, tone: "attention" }
            : null,
        ].filter(Boolean) : []}
        action={
          // The write seam is fail-closed by default, so this renders DISABLED with the seam's own
          // reason rather than vanishing: a control that disappears reads as a missing feature,
          // while a disabled one carrying a reason reads as the permission boundary it is. The
          // reason is visible text, not tooltip-only, so it reaches keyboard and AT users too.
          <div className="ns-collection__act">
            <button
              type="button"
              className={writeReadiness.enabled ? "fo-button fo-button--primary" : "fo-button"}
              disabled={!writeReadiness.enabled}
              onClick={writeReadiness.enabled ? () => setCreating(true) : undefined}
            >
              New Opportunity
            </button>
            {!writeReadiness.enabled && writeReadiness.reason ? (
              <p className="ns-collection__act-reason">{writeReadiness.reason}</p>
            ) : null}
          </div>
        }
      />

      {creating ? (
        <NewOpportunityForm
          readiness={writeReadiness}
          deps={createDeps}
          onClose={() => setCreating(false)}
          onCreated={(opportunityId) => {
            setCreating(false);
            // GO TO THE RECORD, do not select a row. The workspace selected the new opportunity in
            // its pane because the pane was where you read one; the record now has its own route,
            // and landing on it is both the honest confirmation that the create succeeded and the
            // place the next thing (agreement, lifecycle) actually happens.
            //
            // Refetch regardless, so returning to the collection shows the new row from the
            // authoritative read rather than from a row this page invented out of a command result.
            refetch();
            if (opportunityId) navigate(`/customers/opportunities/${encodeURIComponent(opportunityId)}`);
          }}
        />
      ) : null}

      {/* THE STATE VIEW. Radio semantics, not buttons: these are mutually exclusive views of one
          collection and an assistive reader should hear that. Counts come from the projection. */}
      {ready ? (
        <div className="ns-collection__views" role="radiogroup" aria-label="Opportunity view">
          {VIEW_ORDER.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              className={`ns-view ${view === v ? "is-active" : ""}`.trim()}
              onClick={() => setView(v)}
            >
              {OPPORTUNITY_VIEW_LABEL[v]}
              {/* A null count renders NOTHING. The My-opportunities tab has no count when the
                  viewer cannot be identified, and "0" there would assert they have no work. */}
              {counts.byView[v] == null ? null : (
                <span className={`ns-view__count${v === OPPORTUNITY_VIEW.NEEDS_ATTENTION && counts.needsAttention > 0 ? " is-attention" : ""}`}>
                  {counts.byView[v]}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {/* THE TOOLBAR. Search and stage narrowing only — no sort control and no column chooser,
          because the pipeline's order (attention first, then closing soonest) is a governed
          derivation this page does not own, and re-ordering by an arbitrary column would quietly
          replace the queue's meaning with a spreadsheet's. */}
      {ready ? (
        <div className="ns-toolbar">
          <label className="ns-toolbar__search">
            <span className="ns-visually-hidden">Search opportunities</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search opportunities, customers, references"
            />
          </label>
          <button
            type="button"
            className={`fo-button${stageFilter.size > 0 ? " is-active" : ""}`}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            Filter{stageFilter.size > 0 ? ` · ${stageFilter.size}` : ""}
          </button>
          {narrowed ? (
            <button
              type="button"
              className="fo-link-button"
              onClick={() => { setQuery(""); setStageFilter(new Set()); }}
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      {/* The filter sheet: the SIX GOVERNED STAGE WORDS as checkboxes. Not a free-text field and
          not a list this page invents — the vocabulary is the domain's, so a stage cannot be
          filtered for that an opportunity could never be in. */}
      {ready && filterOpen ? (
        <fieldset className="ns-filtersheet">
          <legend>Stage</legend>
          {OPPORTUNITY_STAGES.map((stage) => (
            <label key={stage} className="ns-filtersheet__opt">
              <input
                type="checkbox"
                checked={stageFilter.has(stage)}
                onChange={() => setStageFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(stage)) next.delete(stage); else next.add(stage);
                  return next;
                })}
              />
              {stageLabel(stage)}
            </label>
          ))}
        </fieldset>
      ) : null}

      {/* THE FIVE DESIGNED STATES, each a different fact about the request. None borrows another's
          sentence: a denial rendered as an empty list tells somebody their pipeline is empty when
          their permission is. */}
      {loading ? (
        <HonestState state={HONEST_STATE.LOADING} subject="opportunities" />
      ) : status === "denied" ? (
        <HonestState
          state={HONEST_STATE.DENIED}
          subject="Opportunities"
          detail="Opportunities are not available to you."
        />
      ) : status === "error" ? (
        <HonestState state={HONEST_STATE.UNAVAILABLE} detail={loadErrorMessage(error, { entity: "opportunities" })} />
      ) : status !== "ready" ? (
        <HonestState state={HONEST_STATE.NOT_ENABLED} detail="The opportunity pipeline source is not connected yet." />
      ) : rows.length === 0 ? (
        // THREE DIFFERENT EMPTINESSES, three different sentences and three different ways out.
        //
        //   * the collection itself is empty          -> "No opportunities yet", no way out to offer
        //   * this VIEW is empty                      -> the view's own sentence, offer All
        //   * the view has rows but the FILTERS ate them -> say the filters did it, offer Clear
        //
        // The third is the one that is usually collapsed into the second, and doing so is what
        // makes a filter feel broken: the screen reports an empty pipeline while the cause is a
        // checkbox two inches above it.
        <div className="ns-collection__empty">
          {narrowed ? (
            <HonestState
              state={HONEST_STATE.NO_MATCHES}
              detail={`No opportunities match this view. ${
                viewRows.length === 1 ? "1 opportunity is" : `${viewRows.length} opportunities are`
              } being narrowed to none.`}
              action={
                <button
                  type="button"
                  className="fo-button"
                  onClick={() => { setQuery(""); setStageFilter(new Set()); }}
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <HonestState
              state={selected.emptyReason === "none" ? HONEST_STATE.EMPTY : HONEST_STATE.NO_MATCHES}
              detail={OPPORTUNITY_EMPTY_TEXT[selected.emptyReason] ?? OPPORTUNITY_EMPTY_TEXT.none}
              action={
                selected.emptyReason !== "none" ? (
                  <button type="button" className="fo-button" onClick={() => setView(OPPORTUNITY_VIEW.ALL)}>
                    Show all opportunities
                  </button>
                ) : null
              }
            />
          )}
        </div>
      ) : (
        <>
          {synthetic === true ? (
            <p className="ns-gap-note">Showing synthetic sample opportunities — the live pipeline connects in a later cycle.</p>
          ) : null}
          <p className="ns-collection__result">
            {opportunityResultContext({
              shown: rows.length,
              inView: viewRows.length,
              viewLabel: OPPORTUNITY_VIEW_LABEL[view].toLowerCase(),
              query,
              stageCount: stageFilter.size,
            })}
          </p>
          <div className="ns-table-wrap">
            <table className="ns-table ns-collection__table">
              <thead>
                <tr>
                  <th scope="col">Opportunity</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Attention</th>
                  <th scope="col" className="ns-num">Est. value</th>
                  <th scope="col">Expected close</th>
                  <th scope="col" className="ns-col--commercial">Agreement / Order</th>
                  <th scope="col" className="ns-col--owner">Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <OpportunityRow key={row.id} row={row} navigate={navigate} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * ONE ROW, ONE DESTINATION.
 *
 * The reference cell is a REAL anchor, which is what makes cmd-click, middle-click, "open in new
 * tab" and keyboard activation work without reimplementing any of them. The `<tr>` adds a click
 * handler for the rest of the row's area and defers whenever the event began inside a link — so
 * there is one destination reached two ways, never two competing behaviours.
 *
 * The row is deliberately NOT given role="button"/tabIndex. The anchor is already the focusable,
 * activatable thing; adding a second would announce every row twice and put a fake button in the
 * tab order. That is why P1v4's "the whole row is an anchor" is implemented as "the row defers to
 * its anchor" rather than by wrapping a <tr> in an <a>, which is not valid table markup.
 */
function OpportunityRow({ row, navigate }) {
  return (
    <tr
      className={`ns-row${row.attention.tone === "attention" ? " is-attention" : ""}`}
      onClick={(e) => {
        // A click that began on a link is the link's; let the browser do it, modifiers and all.
        if (e.target.closest("a")) return;
        // A modified click on the row's dead space has no honest meaning here — the anchor is the
        // new-tab path — so it is left alone rather than forced into this tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        navigate(row.href);
      }}
    >
      <td>
        <Link to={row.href} className="ns-row__ref">{row.reference}</Link>
        {row.need ? <span className="ns-row__sub">{row.need}</span> : null}
      </td>
      <td data-label="Customer">
        {row.customer.name ? (
          <>
            <span className="ns-row__strong">{row.customer.name}</span>
            {row.channel ? <span className="ns-row__sub">{row.channel}</span> : null}
          </>
        ) : (
          <span className="ns-state--na">{row.customer.fallback}</span>
        )}
      </td>
      <td data-label="Stage">
        <span className={`ns-row__stage is-${row.stage.tone}`}>{row.stage.words}</span>
        {row.stage.position ? <span className="ns-row__sub">{row.stage.position}</span> : null}
      </td>
      <td data-label="Attention">
        {row.attention.words ? (
          <span className={`ns-row__attention is-${row.attention.tone}`}>{row.attention.words}</span>
        ) : (
          <span className="ns-state--na">—</span>
        )}
      </td>
      {/* BARE NUMBER, NO SYMBOL (G5). expectedValue is stored with no currency field; a "$" here
          would assert a unit nobody recorded. Absent is "Not estimated", never 0 — zero would read
          as a worthless deal rather than an unestimated one. */}
      <td className="ns-num" data-label="Est. value">
        {row.value.amount ?? <span className="ns-state--na">{row.value.fallback}</span>}
      </td>
      <td data-label="Expected close">
        {row.close.date ? (
          <>
            <span className={row.close.overdue ? "ns-row__overdue" : undefined}>{row.close.date}</span>
            {row.close.note ? <span className="ns-row__sub">{row.close.note}</span> : null}
          </>
        ) : (
          <span className="ns-state--na">{row.close.fallback}</span>
        )}
      </td>
      <td className="ns-col--commercial" data-label="Agreement / Order">
        <span className={row.commercial.agreement.known ? undefined : "ns-state--na"}>{row.commercial.agreement.words}</span>
        <span className={`ns-row__sub${row.commercial.order.known ? "" : " ns-state--na"}`}>{row.commercial.order.words}</span>
      </td>
      <td className="ns-col--owner" data-label="Owner">
        {row.owner.name ? row.owner.name : <span className="ns-state--na">{row.owner.fallback}</span>}
      </td>
    </tr>
  );
}
