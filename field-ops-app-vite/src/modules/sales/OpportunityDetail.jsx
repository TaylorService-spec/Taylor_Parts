import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useOpportunity } from "../../hooks/useOpportunity.js";
import { useOpportunityTransitions } from "../../hooks/useOpportunityTransitions.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { opportunityView, OPPORTUNITY_VIEW_STATE } from "../../domain/opportunityView.js";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import AttentionBand from "../../shared/ui/AttentionBand.jsx";
import LifecycleBand from "../../shared/ui/LifecycleBand.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import OpportunityLifecycleControl from "./OpportunityLifecycleControl.jsx";
import { formatMoment } from "../../domain/displayTimestamp";
import { opportunityWriteReadiness } from "../../access/opportunityWriteReadiness.js";
import {
  opportunityHeader,
  opportunitySpine,
  opportunityAttention,
  opportunityStageDetail,
  opportunityTimeline,
  opportunityLineage,
  opportunityValueDisplay,
  EDGE,
} from "../../domain/opportunityNorthStar.js";

// THE OPPORTUNITY, COMPOSED IN THE NORTH STAR GRAMMAR.
//
// Translation contract: docs/design/eos-north-star-design-grammar.md.
// Three-authority model: DECISIONS #122. Design owns the composition, this file owns the
// implementation, and the running sandbox plus the Owner own acceptance. Where the two disagreed,
// the conflict is recorded as a NAMED product decision in
// docs/design/north-star-open-product-decisions.md rather than silently resolved here.
//
// ════════════════════ THIS FAMILY IS NOT A RECOMPOSITION ════════════════════
//
// Families 1–3 each took a page that already existed and re-composed it. This one had no page to
// re-compose. An Opportunity had no per-id governed read and therefore no URL: it could be seen
// only as the selected row of a pipeline someone had already loaded. Deep-linking to a deal,
// sending a colleague its address, or arriving from the Sales Order's own lineage link were all
// impossible. The migration ledger stopped here and asked for a decision rather than absorbing a
// change of scope.
//
// So this page ships on a NEW trusted read — `getOpportunityContext` — which reuses the EXISTING
// `opportunity.read` capability. No Rules change, no new capability, no widened access: the
// `opportunities` collection stays Admin-SDK-only and the authorization question ("may this
// principal read Opportunities?") is the one the two list reads already ask.
//
// ════════════════════ AUTHORITY IS UNCHANGED ON THE WRITE SIDE TOO ════════════════════
//
// Every transition still resolves through the same governed `transitionOpportunity` command, reached
// through the same `OpportunityLifecycleControl` and the same `useOpportunityTransitions` hook the
// workspace uses. This file adds NO second way to move a deal. The control is asked to render its
// `actions` variant — the page draws the spine itself, from the same `stageProgress` derivation, so
// drawing the chevrons too would put two progressions for one deal on one page (NS-P4).
//
// ════════════════════ THE HONEST DIFFERENCES FROM FAMILIES 1 AND 2 ════════════════════
//
// 1. NO LIVE INDICATOR. `useOpportunity` is a one-shot read with an explicit refetch, exactly like
//    `useSalesOrder`. The same badge the Work Order carries would be a false claim here, so the
//    utility line says what is actually true instead (ND-10 applies unchanged).
//
// 2. TWO STAGES CAN STATE A TIME, not one. An Opportunity records `createdAt`, `updatedAt` and —
//    on an outcome transition only — `closedAt`. So "Identified" can say when the deal began and
//    "Decision" can say when it ended; every other stage says no time is recorded, rather than
//    borrowing `updatedAt` (ND-12).
//
// 3. THE SUGGESTION SLOT IS ABSENT, not empty. There is no governed Opportunity recommendation in
//    this build. The Work Order leaves the slot visible and silent because a slot was designed for
//    it; inventing one here to hold "nothing is proposed" would be composition for its own sake.
//    §8's prohibition is explicit: if the AI capability does not exist, do not fabricate it.

// `readiness` is the write seam (NOT a raw capability flag — the workspace's own connected mount
// derives it from the trusted resolveEffectiveAccessCallable decision and this page takes the same
// value, so the two surfaces can never disagree about whether a transition is offerable).
// `actionDeps` injects a mocked command client for tests, exactly as it does for SalesOrderDetail.
export default function OpportunityDetail({ readiness, actionDeps } = {}) {
  const { opportunityId } = useParams();
  const { loading, errorStatus, result, refetch } = useOpportunity(opportunityId);
  const view = opportunityView({ loading, errorStatus, result });
  const ready = view.kind === OPPORTUNITY_VIEW_STATE.READY;

  // ONE DIRECTORY READ FOR THE PAGE, resolving the owner to a person. An employee id is a routing
  // key and never content. The directory is admin/dispatcher-only, so "cannot resolve" is a normal
  // outcome for a legitimate caller (a salesperson reading their own deal) rather than an error —
  // which is why the absence is stated in words instead of falling back to the id.
  const directory = useEmployeeDirectory();
  const ownerName = useMemo(() => {
    if (!ready || !view.ownerEmployeeId || directory.loading) return null;
    const employee = directory.byEmployeeId?.get(view.ownerEmployeeId);
    return employee?.displayName ?? employee?.name ?? null;
  }, [ready, view.ownerEmployeeId, directory]);

  // THE WRITE SEAM, FAIL-CLOSED BY DEFAULT. `opportunityWriteReadiness()` called with no arguments
  // is a hard refusal, so a caller that injects nothing (every unit test, and any future mount that
  // forgets) gets protected controls carrying their reason — never live ones. The production mount
  // (App.jsx) passes the real trusted resolveEffectiveAccessCallable decision.
  const effectiveReadiness = readiness ?? opportunityWriteReadiness();
  const transitions = useOpportunityTransitions(opportunityId, actionDeps);

  // ─────────────────────────── every fact, derived ONCE
  const header = useMemo(() => (ready ? opportunityHeader(view) : null), [ready, view]);
  const spine = useMemo(() => (ready ? opportunitySpine(view) : { steps: [], terminal: null, unrecognised: false }), [ready, view]);
  // `Date.now()` is read HERE and injected, so the derivation stays pure and testable against a
  // fixed clock. "Overdue" is a comparison against now; a domain layer that reads the clock itself
  // cannot be asserted deterministically.
  const attention = useMemo(() => (ready ? opportunityAttention(view, Date.now()) : []), [ready, view]);
  const lineage = useMemo(() => (ready ? opportunityLineage(view) : []), [ready, view]);
  const timeline = useMemo(() => (ready ? opportunityTimeline(view) : []), [ready, view]);

  if (view.kind === OPPORTUNITY_VIEW_STATE.LOADING) {
    return <div className="ns-page"><HonestState state={HONEST_STATE.LOADING} subject="opportunity" /></div>;
  }
  if (view.kind === OPPORTUNITY_VIEW_STATE.DENIED) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.DENIED} subject="This opportunity" detail="You are not authorized to view Opportunities." />
      </div>
    );
  }
  if (view.kind === OPPORTUNITY_VIEW_STATE.NOT_FOUND) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.EMPTY} detail="No Opportunity exists for this address." />
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="ns-page">
        {/* The retry is an `action` node, not an `onRetry` prop: HonestState's UNAVAILABLE branch
            renders `action` and ignores `onRetry`, so passing the latter would produce a dead-end
            failure state that merely looked recoverable. */}
        <HonestState
          state={HONEST_STATE.UNAVAILABLE}
          detail="This Opportunity is currently unavailable."
          action={<button type="button" className="fo-button" onClick={refetch}>Try again</button>}
        />
      </div>
    );
  }

  const value = opportunityValueDisplay(view, (n) => n.toLocaleString());

  return (
    <div className="ns-page">
      {/* THE UTILITY LINE. Context left; on the right, what is TRUE about this read. There is no
          live badge here — see the file header, difference 1. */}
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to="/customers/opportunities">Customers → Opportunities</Link>
          {header.reference ? ` → ${header.reference}` : null}
        </span>
        <span className="ns-gap-note" title="This page reads the opportunity once. A governed action refreshes it; another user's change does not.">
          Read once — refreshed when you act
        </span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker="Opportunity"
        reference={header.reference}
        // An Opportunity created before numbering existed has no reference. That is stated, never
        // patched over with the document id (DECISIONS #106).
        fallbackName="Opportunity — reference unavailable"
        statusWords={header.stateSentence ?? header.stateWords}
        statusTone={header.stateTone}
        statusVariant="sentence"
        facts={[
          {
            key: "customer",
            label: null,
            // The customer is NAMED, not keyed — resolved server-side by the read, because
            // firestore.rules grants `accounts` to admin/dispatcher only and a client-side
            // resolution would tell the salesperson they may not see their own customer's name.
            value: view.accountName
              ? <Link to={`/customers/${view.accountId}`}>{view.accountName}</Link>
              : view.accountId ? "Customer — name unavailable" : null,
          },
          {
            key: "owner",
            label: "Owner",
            value: ownerName ?? (view.ownerEmployeeId ? "reference unavailable" : "Unassigned"),
          },
          { key: "channel", label: "Channel", value: header.channelWords },
          {
            key: "expectedClose",
            label: "Expected close",
            // The DATE, stated plainly. Whether it has PASSED is a different fact and lives in the
            // attention band; stating both here would be one fact rendered twice.
            value: view.expectedCloseAt != null ? formatMoment(view.expectedCloseAt, { unknown: "—" }) : null,
          },
          { key: "value", label: null, value: value.text, title: value.title },
        ]}
        actions={
          // The governed action cluster. Legality is decided by `allowedActions` and by the
          // caller's real capability; this file neither widens nor narrows it, and adds no second
          // invocation path.
          <OpportunityLifecycleControl
            row={opportunityCommandRow(view)}
            readiness={effectiveReadiness}
            transitions={transitions}
            onChanged={refetch}
            variant="actions"
          />
        }
      />

      {/* THE LIFECYCLE SPINE (NS-P1), drawn from the SAME stageProgress derivation the pipeline
          row's chevrons use. Clicking any stage opens the one line of recorded fact behind it; at
          every stage but Identified and a closed Decision that line says no time is recorded,
          because none is (ND-12). */}
      <LifecycleBand
        steps={spine.steps}
        terminal={spine.terminal}
        ariaLabel="Opportunity lifecycle"
        detailFor={(stepKey) => opportunityStageDetail(view, stepKey, (v) => formatMoment(v, { unknown: "" }))}
        tail={lineageSentence(lineage)}
      />
      {spine.unrecognised ? (
        <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="This opportunity's stage is not one the lifecycle recognises." />
      ) : null}

      <AttentionBand items={attention} />

      <div className="ns-record-body">
        <div>
          {/* THE SOLUTION LEADS. This is the deal — what is being sold. A line references a
              product, model or part and NEVER a serialized asset: an Opportunity is
              pre-commitment, and nothing here creates warehouse demand, inventory movement, a Work
              Order or an invoice. */}
          <RuledSection
            title="Solution"
            meta={view.lines.length > 0 ? <span className="ns-section__note">{view.lines.length} line{view.lines.length === 1 ? "" : "s"}</span> : null}
          >
            {view.lines.length === 0 ? (
              <HonestState state={HONEST_STATE.EMPTY} detail="No solution lines have been recorded on this opportunity yet." />
            ) : (
              <div className="ns-table-wrap">
                <table className="ns-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Kind</th>
                      <th scope="col" className="ns-num">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.lines.map((l) => (
                      <tr key={l.key}>
                        <td>{l.ref ?? <span className="ns-state--na">Item — reference unavailable</span>}</td>
                        <td>{l.kind ?? <span className="ns-state--na">—</span>}</td>
                        <td className="ns-num">
                          {/* A missing quantity is NOT rendered as a dash and left at that: it is
                              the thing that blocks WON forever, and the attention band above says
                              so. Here it is named so the reader can see WHICH line. */}
                          {l.qty != null ? l.qty : <span className="ns-state--na">not recorded</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RuledSection>

          {view.need ? (
            <RuledSection title="Need">
              {/* Prose, read as sentences rather than scanned as data — which is why the need is
                  not a field in the rail grid. */}
              <div className="ns-prose"><p>{view.need}</p></div>
            </RuledSection>
          ) : null}

          <RuledSection title="Next action">
            {view.nextAction ? (
              <div className="ns-prose"><p>{view.nextAction}</p></div>
            ) : (
              // Its ABSENCE is already a ranked attention item above, so this states the fact
              // without repeating the warning — the band is where "this needs you" is said.
              <HonestState state={HONEST_STATE.EMPTY} detail="No next action is recorded." />
            )}
          </RuledSection>
        </div>

        <aside className="ns-rail">
          <RuledSection title="Lineage">
            <ul className="ns-lineage">
              {lineage.map((edge) => (
                <li className="ns-lineage__row" key={edge.key}>
                  <span className="ns-lineage__label">{edge.label}</span>{" "}
                  {edge.state === EDGE.RESOLVED
                    ? <LineageLink edge={edge} />
                    : edge.state === EDGE.UNRESOLVED
                      ? <span className="ns-lineage__unresolved">reference unavailable</span>
                      : <span className="ns-lineage__unresolved">none</span>}
                </li>
              ))}
            </ul>
          </RuledSection>

          <RuledSection
            title="Milestones"
            meta={<span className="ns-section__note">only what the record records</span>}
          >
            {timeline.length === 0 ? (
              <HonestState state={HONEST_STATE.EMPTY} detail="No times are recorded on this opportunity." />
            ) : (
              <ul className="ns-timeline">
                {timeline.map((e) => (
                  <li className="ns-timeline__row" key={e.key}>
                    <span className="ns-timeline__when">{formatMoment(e.at, { unknown: "—" })}</span>
                    <span>{e.label}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="ns-gap-note">
              An Opportunity stores when it was created, when it closed, and when it was last
              changed. There are no recorded times for the stages in between.
            </p>
          </RuledSection>
        </aside>
      </div>
    </div>
  );
}

/**
 * The shape `OpportunityLifecycleControl` was built against.
 *
 * That control reads a PIPELINE ROW (`buildPipelineRow`), and this page holds a record view. Rather
 * than widen the control to understand two shapes — which is how one component quietly becomes two
 * — the record view is adapted to the row contract at the single point of use. Only the four fields
 * the control actually reads are supplied: `allowedActions` needs stage and outcome, and the WON
 * intent carries owner and channel onto the Sales Order it creates.
 *
 * `channel` deliberately carries the RAW `salesChannel`, not the display word: it is a command
 * payload, and the server validates it against SALES_CHANNELS.
 */
function opportunityCommandRow(view) {
  return {
    id: view.id,
    stage: view.stage,
    outcome: view.outcome,
    ownerEmployeeId: view.ownerEmployeeId,
    channel: view.salesChannel,
  };
}

/**
 * A resolved edge, linked where the app can actually route to it.
 *
 * Offering a link into a page that does not exist is a dead end, and a dead end is worse than plain
 * text — so a resolved Sales Agreement (which has no per-record destination in this build) would
 * render as its reference alone. It never gets that far today: the agreement edge is always
 * UNRESOLVED or ABSENT (ND-9).
 */
function LineageLink({ edge }) {
  if (edge.key === "account") {
    return <Link to={`/customers/${edge.targetId}`}>{edge.reference}</Link>;
  }
  if (edge.key === "salesOrder") {
    return <Link to={`/customers/opportunities/sales-order/${edge.targetId}`}>{edge.reference}</Link>;
  }
  return <span>{edge.reference}</span>;
}

/**
 * The one sentence trailing the lifecycle band.
 *
 * Names the customer where it is resolvable and the order this deal became where there is one, and
 * NEVER prints a document id in any branch. Returns null rather than padding the band with a
 * sentence that says nothing.
 */
function lineageSentence(edges) {
  const account = edges.find((e) => e.key === "account");
  const salesOrder = edges.find((e) => e.key === "salesOrder");
  const parts = [];
  if (account?.state === EDGE.RESOLVED) parts.push(`for ${account.reference}`);
  else if (account?.state === EDGE.UNRESOLVED) parts.push("for a customer whose name is unavailable");
  if (salesOrder?.state === EDGE.RESOLVED) parts.push(`became ${salesOrder.reference}`);
  else if (salesOrder?.state === EDGE.UNRESOLVED) parts.push("became an order whose reference is unavailable");
  return parts.length > 0 ? parts.join(" · ") : null;
}
