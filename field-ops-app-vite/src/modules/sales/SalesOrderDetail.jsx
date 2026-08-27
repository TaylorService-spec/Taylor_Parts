import { useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useSalesOrder } from "../../hooks/useSalesOrder.js";
import { salesOrderView, SALES_ORDER_VIEW_STATE } from "../../domain/salesOrderView.js";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import AttentionBand from "../../shared/ui/AttentionBand.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import LifecycleBand from "../../shared/ui/LifecycleBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import SalesOrderActions from "./SalesOrderActions.jsx";
import SalesOrderFulfillmentSection from "./SalesOrderFulfillmentSection.jsx";
import { useAccountNamesWithStatus, ACCOUNT_NAMES_STATUS } from "../../hooks/useAccountNames.js";
import { REFERENCE_STATE, REFERENCE_STATE_LABEL } from "../../metadata/referenceResolution.js";
import MetadataRecordPage from "../../metadata/MetadataRecordPage.jsx";
import { salesOrderRecordPageRailSubset } from "../../metadata/definitions/salesOrderPage.js";
import { salesOrderEntity } from "../../metadata/definitions/salesOrder.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { salesOrderDollars } from "../../domain/salesOrderMoneyDisplay.js";
import { formatMoment } from "../../domain/displayTimestamp";
import { objectListPathWithState, OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";
import { savedListState } from "../../navigation/listStateMemory.js";
import { SALES_ORDER_FULFILL_CAPABILITY } from "../../access/salesOrderCapabilityAccess.js";
import { deriveSalesOrderIntelligence } from "../../domain/salesOrderIntelligence.js";
import {
  salesOrderHeader,
  salesOrderSpine,
  salesOrderAttention,
  salesOrderStageDetail,
  salesOrderTimeline,
  salesOrderLineage,
  EDGE,
} from "../../domain/salesOrderNorthStar.js";

// THE SALES ORDER, COMPOSED IN THE NORTH STAR GRAMMAR.
//
// Translation contract: docs/design/eos-north-star-design-grammar.md.
// Three-authority model: DECISIONS #122. Design owns the composition, this file owns the
// implementation, and the running sandbox plus the Owner own acceptance. Where the two disagreed,
// the conflict is recorded as a NAMED product decision in
// docs/design/north-star-open-product-decisions.md rather than silently resolved here.
//
// DOMAIN AUTHORITY IS UNCHANGED. Every write still resolves through the existing governed commands
// — transitionSalesOrder, allocateSalesOrder, createServiceForSalesOrder — reached through the
// unmodified `SalesOrderActions`. This file adds no command, no capability, no write path, and
// narrows nobody's access. The trusted read is the same `getSalesOrderContext`.
//
// ════════════════════ WHAT CHANGED, AND WHY IT IS NOT A RESTYLE ════════════════════
//
// The shipped page stated the lifecycle state TWICE — as a pill in the ContextBand and again as a
// field in the metadata grid — and never once drew the lifecycle itself. The Work Order audit named
// that exact class of defect, and the answer is the same one: the state is derived once, in
// domain/salesOrderNorthStar.js, and rendered once, as a sentence, in the record header. The band
// beneath it draws where the order actually is.
//
// It also stacked three grammars: a ContextBand, a metadata field grid, and two hand-rolled
// `<h3>` + `fo-table` sections. Those are now one grammar — RecordIdentity, LifecycleBand,
// AttentionBand, RuledSection, HonestState — the same primitives the Work Order family shipped on.
//
// ════════════════════ THE THREE HONEST DIFFERENCES FROM THE WORK ORDER ════════════════════
//
// 1. NO "LIVE" INDICATOR. The Work Order page carries one because `useWorkOrder` is an onSnapshot
//    subscription and the claim is true. `useSalesOrder` is a ONE-SHOT read with an explicit
//    refetch. The same badge here would be a false statement about the record in front of the
//    reader, so it is absent and the utility line says what is actually true instead.
//
// 2. THE SUGGESTION SLOT SPEAKS. On the Work Order it is deliberately empty — no engine is
//    connected. Here the governed deterministic recommendation (#1504) genuinely has something to
//    say, and it says it. It states an OBSERVED FACT about quantities the order already records and
//    points at the Allocate button that already exists; it does NOT offer a second way to invoke
//    the command. One action, one rendering — and no AI-originated write path.
//
// 3. ONLY ONE STAGE CAN STATE A TIME. A Sales Order document stores `createdAt` and `updatedAt` and
//    nothing else. The band says so at every other stage rather than borrowing `updatedAt`, which
//    would be a fabricated fact about a sale (ND-8).
//
// `actionDeps` and `hasCapability` are unchanged seams, passed straight through to SalesOrderActions
// exactly as before: `hasCapability` is the REAL trusted write-capability signal and its absence is
// fail-closed.

export default function SalesOrderDetail({ actionDeps, hasCapability } = {}) {
  const { salesOrderId } = useParams();
  const { loading, errorStatus, result, refetch } = useSalesOrder(salesOrderId);
  const view = salesOrderView({ loading, errorStatus, result });
  const ready = view.kind === SALES_ORDER_VIEW_STATE.READY;

  // THE CUSTOMER IS NAMED, NOT KEYED (DECISIONS #106). Resolved through the same batched read the
  // Sales Orders list uses, so the two surfaces agree on what a customer is called and on what to
  // say when they cannot find out.
  const accountIds = useMemo(
    () => (ready && view.accountId ? [view.accountId] : []),
    [ready, view.accountId],
  );
  const { names: accountNames, status: accountNamesStatus } = useAccountNamesWithStatus(accountIds);
  const accountName = view.accountId ? accountNames.get(view.accountId) : null;
  const accountFallbackState =
    accountNamesStatus === ACCOUNT_NAMES_STATUS.DENIED ? REFERENCE_STATE.DENIED
      : accountNamesStatus === ACCOUNT_NAMES_STATUS.ERROR ? REFERENCE_STATE.ERROR
        : accountNamesStatus === ACCOUNT_NAMES_STATUS.READY ? REFERENCE_STATE.NOT_FOUND
          : REFERENCE_STATE.LOADING;

  // ONE DIRECTORY READ FOR THE PAGE, resolving the owner to a person. An employee id is a routing
  // key and never content.
  const directory = useEmployeeDirectory();
  const ownerName = useMemo(() => {
    if (!ready || !view.ownerEmployeeId) return null;
    if (directory.loading) return null;
    const employee = directory.byEmployeeId?.get(view.ownerEmployeeId);
    return employee?.displayName ?? employee?.name ?? null;
  }, [ready, view.ownerEmployeeId, directory]);

  const resolveSalesOrderReference = useCallback((fieldId, id) => {
    if (fieldId === "accountId") {
      return accountName ? { state: REFERENCE_STATE.FOUND, label: accountName } : { state: accountFallbackState };
    }
    if (fieldId !== "ownerEmployeeId") return undefined;
    if (directory.loading) return { state: REFERENCE_STATE.LOADING };
    const employee = directory.byEmployeeId?.get(id);
    const name = employee?.displayName ?? employee?.name ?? null;
    return name ? { state: REFERENCE_STATE.FOUND, label: name } : { state: REFERENCE_STATE.NOT_FOUND };
  }, [directory, accountName, accountFallbackState]);

  // ─────────────────────────── every fact, derived ONCE
  const header = useMemo(() => (ready ? salesOrderHeader(view) : null), [ready, view]);
  const spine = useMemo(() => salesOrderSpine(ready ? view.state : null), [ready, view.state]);
  const attention = useMemo(() => (ready ? salesOrderAttention(view) : []), [ready, view]);
  const lineage = useMemo(() => (ready ? salesOrderLineage(view) : []), [ready, view]);
  const timeline = useMemo(() => (ready ? salesOrderTimeline(view) : []), [ready, view]);

  // THE GOVERNED RECOMMENDATION, ASKED THE SAME QUESTION THE BUTTON IS GOVERNED BY.
  //
  // `canAllocate` is the caller's REAL salesOrder.fulfill grant, read through the same
  // `hasCapability` seam SalesOrderActions uses — so the suggestion cannot propose an action the
  // action cluster would refuse to render. Absent the seam it is false, and the derivation falls
  // silent: fail-closed, identically to the buttons.
  const canAllocate = typeof hasCapability === "function" ? hasCapability(SALES_ORDER_FULFILL_CAPABILITY) === true : false;
  const intelligence = useMemo(
    () => (ready ? deriveSalesOrderIntelligence(view, { canAllocate }) : null),
    [ready, view, canAllocate],
  );

  if (view.kind === SALES_ORDER_VIEW_STATE.LOADING) {
    return <div className="ns-page"><HonestState state={HONEST_STATE.LOADING} subject="sales order" /></div>;
  }
  if (view.kind === SALES_ORDER_VIEW_STATE.DENIED) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.DENIED} subject="This sales order" detail="You are not authorized to view this Sales Order." />
      </div>
    );
  }
  if (view.kind === SALES_ORDER_VIEW_STATE.NOT_FOUND) {
    return (
      <div className="ns-page">
        <HonestState state={HONEST_STATE.EMPTY} detail="No Sales Order exists for this address." />
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="ns-page">
        {/* The retry is an `action` node, not an `onRetry` prop: HonestState's UNAVAILABLE branch
            renders `action` and ignores `onRetry`, so passing the latter would have produced a
            dead-end failure state that merely looked recoverable. */}
        <HonestState
          state={HONEST_STATE.UNAVAILABLE}
          detail="This Sales Order is currently unavailable."
          action={<button type="button" className="fo-button" onClick={refetch}>Try again</button>}
        />
      </div>
    );
  }

  const dollars = salesOrderDollars(view);

  // THE LINEAGE TAIL beneath the band, stated in ONE place. The rail carries no second copy — the
  // same sentence in both is the NS-P4 defect this composition exists to remove.
  const lineageTail = lineageSentence(lineage, view);
  const agreementEdge = lineage.find((edge) => edge.key === "agreement") ?? null;

  return (
    <div className="ns-page">
      {/* THE UTILITY LINE. Context left; on the right, what is TRUE about this read.
          There is no live badge here — see the file header, difference 1. */}
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to={objectListPathWithState(OBJECT_LIST_KEY.SALES_ORDERS, savedListState(OBJECT_LIST_KEY.SALES_ORDERS))}>
            Customers → Sales Orders
          </Link>
          {header.reference ? ` → ${header.reference}` : null}
        </span>
        <span className="ns-gap-note" title="This page reads the order once. A governed action refreshes it; another user's change does not.">
          Read once — refreshed when you act
        </span>
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker="Sales Order"
        reference={header.reference}
        // A Sales Order written before numbering existed has no reference. That is stated, never
        // patched over with the document id (DECISIONS #106).
        fallbackName="Sales Order — reference unavailable"
        statusWords={header.stateSentence ?? header.stateWords}
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
            key: "owner",
            label: "Owner",
            value: ownerName ?? (view.ownerEmployeeId ? "reference unavailable" : "Unassigned"),
          },
          { key: "channel", label: "Channel", value: view.salesChannel ?? null },
          {
            key: "dollars",
            label: null,
            // WHAT THIS SALE IS WORTH, from the authoritative server projection, rendered only when
            // EVERY line is priced. A partly-priced order shows NO NUMBER: a sum over the priced
            // lines is a real figure that is not the sale total, and it is worse than nothing
            // because it is credible. NULL IS NOT ZERO.
            value: dollars.text,
            title: dollars.title,
          },
        ]}
        actions={
          // The governed action cluster, unchanged. Legality is decided by the engine and by the
          // caller's real capabilities; this file neither widens nor narrows it.
          <SalesOrderActions view={view} onChanged={refetch} actionDeps={actionDeps} hasCapability={hasCapability} />
        }
      />

      {/* THE LIFECYCLE SPINE (NS-P1) — absent from this page entirely until now. Clicking any stage
          opens the one line of recorded fact behind it; at every stage but the first that line says
          no time is recorded, because none is (ND-8). */}
      <LifecycleBand
        steps={spine.steps}
        terminal={spine.terminal}
        ariaLabel="Sales order lifecycle"
        detailFor={(stepKey) => salesOrderStageDetail(view, stepKey, (v) => formatMoment(v, { unknown: "" }))}
        tail={lineageTail}
      />
      {spine.unrecognised ? (
        <HonestState state={HONEST_STATE.NOT_APPLICABLE} detail="This order's state is not one the lifecycle recognises." />
      ) : null}

      <AttentionBand items={attention} />

      {/* COMMERCIAL PROVENANCE — where this order's committed prices came from.
          `salesOrderLineage` already computes this edge and has always reported it UNRESOLVED:
          `sourceAgreementId` is projected and no read resolves an agreement to a reference (ND-9).
          What changed is that the agreement now HAS an address (DECISIONS #134), so the
          relationship becomes navigable without becoming resolvable.
          The id is the route key and never the label — "the sales agreement" is honest neutral
          wording; printing the document id is the defect DECISIONS #106 exists to forbid. */}
      {agreementEdge?.state === EDGE.UNRESOLVED && agreementEdge.targetId ? (
        <p className="ns-provenance">
          Priced from{" "}
          <Link to={`/customers/opportunities/sales-agreement/${encodeURIComponent(agreementEdge.targetId)}`}>
            the sales agreement
          </Link>{" "}
          <span className="ns-section__note">— the commercial commitment these lines and prices came from.</span>
        </p>
      ) : null}

      {/* THE SUGGESTION SLOT — and here it genuinely speaks.
          The recommendation is DETERMINISTIC and says so: it compares two quantities the order
          already records and reads nothing about inventory availability. It proposes no new write
          path — the Allocate button above is the only way to act, and the command re-checks
          salesOrder.fulfill and its own state precondition when a human presses it. */}
      <div className={intelligence?.speak ? "ns-suggest ns-suggest--active" : "ns-suggest"} aria-label="Suggested">
        <span className="ns-suggest__label">Suggested</span>
        {intelligence?.speak ? (
          <span>
            {intelligence.observedFact} {intelligence.businessConsequence} Use Allocate above to run the governed allocation.
          </span>
        ) : (
          <span>Nothing is proposed for this order.</span>
        )}
      </div>

      <div className="ns-record-body">
        <div>
          {/* THE LINES LEAD. This is the order — what was bought, and how far each line has got
              through the quantity model the engine actually maintains. */}
          <RuledSection
            title="Lines"
            meta={view.lines.length > 0 ? <span className="ns-section__note">{view.lines.length} line{view.lines.length === 1 ? "" : "s"}</span> : null}
          >
            {view.lines.length === 0 ? (
              <HonestState state={HONEST_STATE.EMPTY} detail="No lines have been recorded on this order." />
            ) : (
              <div className="ns-table-wrap">
                <table className="ns-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Kind</th>
                      <th scope="col" className="ns-num">Ordered</th>
                      <th scope="col" className="ns-num">Allocated</th>
                      <th scope="col" className="ns-num">Fulfilled</th>
                      <th scope="col" className="ns-num">Billed</th>
                      <th scope="col">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.lines.map((l) => (
                      <tr key={l.key}>
                        <td>{l.ref ?? <span className="ns-state--na">Item — reference unavailable</span>}</td>
                        <td>{l.kind ?? <span className="ns-state--na">—</span>}</td>
                        <td className="ns-num">{l.orderedQty ?? "—"}</td>
                        <td className="ns-num">{l.allocatedQty ?? "—"}</td>
                        <td className="ns-num">{l.fulfilledQty ?? "—"}</td>
                        <td className="ns-num">{l.billedQty ?? "—"}</td>
                        <td>
                          {l.fullyFulfilled
                            ? <StatusPill tone="positive" label="Fulfilled" />
                            : l.remainingQty}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RuledSection>

          {/* Fulfillment & Installation — a READ-ONLY projection over records that already exist.
              `workOrders` stays null until a governed linked-Work-Order read is wired, and null
              means UNKNOWN rather than none; the section is explicit about that distinction. */}
          <SalesOrderFulfillmentSection salesOrder={view} workOrders={null} />

          {view.notes ? (
            <RuledSection title="Notes">
              {/* Prose, read as sentences rather than scanned as data — which is why the notes are
                  not a field in the rail grid. */}
              <div className="ns-prose"><p>{view.notes}</p></div>
            </RuledSection>
          ) : null}
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
            meta={<span className="ns-section__note">only what the order records</span>}
          >
            {timeline.length === 0 ? (
              <HonestState state={HONEST_STATE.EMPTY} detail="No times are recorded on this order." />
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
              A Sales Order stores only when it was created and when it was last changed. There are no
              recorded times for allocation, fulfilment, closeout or cancellation.
            </p>
          </RuledSection>

          <RuledSection title="Record">
            {/* NO PENCILS, and that is derived rather than chosen: there is no field-update command
                for a Sales Order at all. Every write in this domain is a governed ACTION with its
                own capability and state guard, and those stay in the header cluster above. */}
            <MetadataRecordPage
              definition={salesOrderRecordPageRailSubset}
              record={view}
              entityResolver={() => salesOrderEntity}
              resolveReference={resolveSalesOrderReference}
            />
          </RuledSection>
        </aside>
      </div>
    </div>
  );
}

/**
 * A resolved edge, linked where the app can actually route to it.
 *
 * A Work Order has no per-id destination in this build, so a resolved WO reference is rendered as
 * the reference alone. Offering a link into a page that does not exist is a dead end, and a dead
 * end is worse than plain text.
 */
function LineageLink({ edge }) {
  if (edge.key === "opportunity") {
    return <Link to="/customers/opportunities">{edge.reference}</Link>;
  }
  return <span>{edge.reference}</span>;
}

/**
 * The one sentence trailing the lifecycle band.
 *
 * Names the origin where it is resolvable, states the absence where it is not, and NEVER prints a
 * document id in either branch.
 */
function lineageSentence(edges, view) {
  const opportunity = edges.find((e) => e.key === "opportunity");
  if (opportunity?.state === EDGE.RESOLVED) return `from ${opportunity.reference}`;
  if (opportunity?.state === EDGE.UNRESOLVED) return "from an opportunity whose reference is unavailable";
  const workOrders = Array.isArray(view?.serviceWorkOrders) ? view.serviceWorkOrders.length : 0;
  if (workOrders > 0) return `${workOrders} work order${workOrders === 1 ? "" : "s"} linked`;
  return null;
}
