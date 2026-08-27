import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { salesOrderEntity, salesOrderIndexList } from "../../metadata/definitions/salesOrder.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import { salesOrderDisplayCurrency } from "../../domain/salesOrderDisplayCurrency.js";
import { salesOrderDollars } from "../../domain/salesOrderMoneyDisplay.js";
import {
  AddFilter, ActiveCriteria, SortControl, ListEmptyState, DroppedCriteriaNotice,
} from "../../metadata/MetadataListControls.jsx";
import ListViewHeader, { CollectionResultContext } from "../../metadata/ListViewHeader.jsx";
import { useListViewChrome } from "../../hooks/useListViewChrome.js";
import {
  addFilter, removeFilter, clearFilters, setSort, describeDropped, describeRefusal,
} from "../../metadata/listUrlState.js";
import { useListCriteria } from "../../hooks/useListCriteria.js";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { buildRowHref } from "../../metadata/listPresentation.js";
import { useAccountReferenceResolver } from "../../hooks/useAccountReferenceResolver.js";
import { ACCOUNT_NAMES_STATUS } from "../../hooks/useAccountNames.js";

// SALES ORDERS -- the global index, mounted on the metadata list runtime.
//
// NOTHING HERE IS NEW. Every piece this screen needs already existed and had for some time:
//
//   - salesOrderIndexList (metadata/definitions/salesOrder.js, id "salesOrder.index") --
//     columns, filters, defaultSort, pageSize, capabilityRequirement "salesOrder.read",
//     savedViews, and rowNavigationTo
//   - listSalesOrderIndex -- the unscoped governed read, deployed and exported
//   - callableListSource's CALLABLE_SOURCES entry for it (listKey "salesOrders",
//     scoped: false), so the runtime could serve this descriptor already
//
// The definition was simply never MOUNTED as a navigable page. That is the whole gap this
// file closes, which is why it is thirty lines and not three hundred.
//
// A CORRECTION IS RECORDED HERE ON PURPOSE. An earlier version of this file was a
// hand-rolled table with its own read client and its own pagination hook -- a second Sales
// Order list implementation standing beside the metadata definition, duplicating what the
// runtime already did. It also rendered a "Created" column bound to `createdAtMillis`, a
// field the write path never stores, so that column could only ever print an em dash. Both
// were removed rather than kept alongside this: two list implementations for one object is
// how the definitions and the screen drift apart, and the drift is invisible because each
// one works on its own terms.
//
// NO TIMESTAMP COLUMN, DELIBERATELY. salesOrderIndexList declares none, and the read
// service's timestamp projection was reading field names the write path does not store.
// A column must not be added here until that projection is corrected and tested --
// otherwise the screen displays a blank and calls it data.
// CUSTOMER NAMES ARE RESOLVED, NOT PRINTED AS IDS.
//
// Every row of this list rendered "Unresolved reference" under Customer while all 14 Sales Orders
// carried a valid accountId pointing at a real customer. The data was never wrong: useMetadataList
// accepted no resolver, so cellValue had no way to turn an id into a name -- and correctly refused
// to print the id, because a document id is a routing key, not content.
//
// The fix is in the shared hook, not here. This screen only supplies the resolver, and it does so
// through useAccountReferenceResolver so that the same account reference on Opportunities,
// Invoices and Equipment resolves through one implementation rather than six near-copies.
//
// THE FEEDBACK PASS IS DELIBERATE. The resolver needs the ids the loaded rows point at, and those
// rows come from the list hook -- so the resolver cannot be built before the call that produces
// them. Rather than a ref that mutates behind React's back (which would leave the presentation
// memo unaware that names had arrived), the rows are fed back through state: rows land, the
// resolver rebuilds, the presentation re-renders with real names. One extra pass, no hidden state.
export default function SalesOrdersList() {
  const navigate = useNavigate();
  const [resolvableRows, setResolvableRows] = useState([]);
  const { resolveReference, status: accountNamesStatus } = useAccountReferenceResolver(resolvableRows);
  // The list view declares its OWN readCallable ("listSalesOrderIndex"), which
  // useMetadataList resolves ahead of the entity's account-scoped one. The unscoped index
  // and the account-scoped related list are different reads with different authority
  // shapes; reusing one for the other was explicitly ruled out.
  // LIST CRITERIA LIVE IN THE URL, so a narrowed list survives opening an order and coming back,
  // and can be shared or bookmarked. This screen previously passed a frozen empty filter set: the
  // runtime was mounted, the CONTROLS never were, which is precisely the gap the release audit found.
  const { criteria, apply } = useListCriteria(salesOrderIndexList, salesOrderEntity, "salesOrders");

  // SAVED VIEWS + AN HONEST COUNT, shared by every object. The count is a real aggregate over
  // the same filters the list uses -- never a tally of loaded rows, and null rather than 0 on
  // any failure.
  const { activeViewId, selectView, total } = useListViewChrome(salesOrderIndexList, salesOrderEntity, criteria, apply);

  const { presentation, rows, loadMore, retry, descriptorErrors } = useMetadataList(salesOrderIndexList, salesOrderEntity, {
    filters: criteria.filters,
    sort: criteria.sort,
    resolveReference,
    // THE DOLLARS CELL, from the SAME function the record page uses.
    //
    // Two things were wrong here and they had the same shape -- the list knew less about its own
    // money than the record page did. Orders created before PR #976 carry no `currency`, so one
    // rendered "USD 50.00" and another worth the same fifty dollars rendered "50.00"; and an order
    // with no total rendered a BLANK cell, indistinguishable from a failed load, where the record
    // page has always said "Not priced" / "Partly priced" / "No lines".
    //
    // salesOrderDollars already decides all five readings, so the list borrows it rather than
    // growing a second opinion. That is what makes the two surfaces agree by construction instead
    // of by coincidence.
    resolveMoneyCell: (row) => salesOrderDollars({ ...row, currency: salesOrderDisplayCurrency(row) }).text,
  });

  // What was asked for and is not in effect, from both places it can fail: parsing the URL against
  // this build, and planning the query. Both leave a list wider than requested, so both say so.
  const droppedMessage = useMemo(() => {
    const fromUrl = describeDropped(criteria.dropped);
    if (fromUrl) return fromUrl;
    return describeRefusal(descriptorErrors, "sales orders");
  }, [criteria, descriptorErrors]);

  // `rows` is hook state, so its identity is stable between fetches and this cannot loop.
  useEffect(() => { setResolvableRows(rows ?? []); }, [rows]);

  // DEGRADED — the orders are fine, the CUSTOMER NAMES are not (Lists P2 board 2d).
  //
  // Customer is resolved by a separate batched read, and it can fail or be withheld while every
  // sales order loads perfectly. Each affected cell already says so where the name would have been;
  // this is the one quiet line above the table, because a reader scanning a column of them cannot
  // otherwise tell one bad reference from one failed read.
  //
  // WITHHELD IS NOT FAILED. A name your role may not see is a fact no retry changes; giving it the
  // words of a transient failure sends somebody to chase a data problem that is really an access one.
  const degraded = (() => {
    if (accountNamesStatus === ACCOUNT_NAMES_STATUS.DENIED) {
      return "Customer names aren’t available to your role. Every other detail below is complete.";
    }
    if (accountNamesStatus === ACCOUNT_NAMES_STATUS.ERROR) {
      return "Customer names couldn’t be loaded. The sales orders below are complete otherwise.";
    }
    return null;
  })();

  return (
    <WorkspaceIdentity
      crumb="CRM / Sales"
      title="Sales Orders"
      // The governed aggregate over the SAME filters the list uses — null on any failure, never 0.
      count={typeof total === "number" ? total : null}
      countLabel={total === 1 ? "sales order" : "sales orders"}
      // NOTHING TO SUMMARISE, TRUTHFULLY. Lists P2 asks for the facts the read can count and says to
      // omit the line entirely when there are none. There is no governed per-state aggregate for
      // sales orders and no attention projection, so a workload line here could only be assembled
      // from the loaded page — a claim about the business drawn from one screenful, which is the
      // decision the Work Order status chips already made correctly in the other direction.
      summaryItems={[]}
      // NO CREATE ACTION, and its absence is the third of P2's three treatments rather than an
      // oversight. A Sales Order is not user-creatable: it is produced by the atomic Won transition
      // on an Opportunity, and by the agreement path. Rendering a disabled "New sales order" here
      // would describe a permission boundary, when the truth is that creation belongs to another
      // object entirely.
    >
      {/* THE ONE SHARED FILTER AND SORT EXPERIENCE, from the Sales Order metadata. Only `state` is
          offered, because sales_orders(state, salesOrderNumber DESC) is the only live composite —
          the definition declares exactly that one filter and this screen offers exactly what it
          declares. */}
      <ListViewHeader
        def={salesOrderIndexList}
        entity={salesOrderEntity}
        criteria={criteria}
        total={total}
        activeViewId={activeViewId}
        onSelectView={selectView}
      />
      <div className="fo-listctl">
        <AddFilter
          def={salesOrderIndexList}
          entity={salesOrderEntity}
          onAdd={(c) => apply(addFilter(criteria, c))}
        />
        <SortControl
          entity={salesOrderEntity}
          criteria={criteria}
          onSort={(fieldId, direction) => apply(setSort(criteria, fieldId, direction))}
        />
      </div>
      <ActiveCriteria
        criteria={criteria}
        entity={salesOrderEntity}
        onRemove={(fieldId, operator) => apply(removeFilter(criteria, fieldId, operator))}
        onClear={() => apply(clearFilters(criteria))}
      />
      <DroppedCriteriaNotice message={droppedMessage} />

      {/* RESULT CONTEXT, IMMEDIATELY ABOVE THE ROWS IT DESCRIBES (Lists P2 anatomy). This sentence
          used to render inside the list header, ABOVE the filter and sort controls -- so it
          described a state the reader had not produced yet. Same sentence, same pure source; only
          its position changed. */}
      <CollectionResultContext entity={salesOrderEntity} criteria={criteria} defaultSort={salesOrderIndexList.defaultSort} total={total} />

      {/* Only on a settled, populated read — over a skeleton or a denial this would be describing a
          secondary failure while the primary one is still unresolved. */}
      {degraded && presentation?.state === "READY" ? (
        <HonestState state={HONEST_STATE.DEGRADED} detail={degraded} />
      ) : null}

      {/* THE MONEY COLUMN IS REAL, AND THIS COMMENT USED TO DENY IT.
          It read "NO DOLLARS COLUMN, and its absence is registered rather than forgotten — the
          Sales Order document stores no total of any kind", citing SALES_ORDER_TOTAL_AUTHORITY_GAP.
          That gap is CLOSED, and was wrong while it was open: invoiceCommands.ts snapshots each
          line's unitPrice, refuses to bill a line without one, and refuses any invoice price that
          disagrees with it — the invoice is derived FROM the order. salesOrderIndexList declares
          totalMinor, and resolveMoneyCell above renders it through the record page's own
          salesOrderDollars, so both surfaces give the same five readings by construction rather
          than by coincidence.
          A comment describing the opposite of the code is worse than no comment, because the next
          reader trusts it and does not check. */}
      {presentation?.state === "FILTERED" ? (
        <ListEmptyState criteria={criteria} onClear={() => apply(clearFilters(criteria))} />
      ) : (
      <MetadataListGrid
        presentation={presentation}
        caption="Sales Orders"
        // THE DESTINATION THE DEFINITION NAMES — and now actually read from it. This comment
        // already claimed exactly that ("not a path this screen invents -- so the row target cannot
        // drift from the declaration") while the code beneath it was a template literal. The two
        // happened to agree; on Work Orders and Part Master the same pair disagreed and named
        // routes this application does not mount, and nobody noticed because no screen ever asked
        // the definition. A comment is not a mechanism.
        onRowClick={(id) => navigate(buildRowHref(salesOrderIndexList.rowNavigationTo, id))}
        onLoadMore={loadMore}
        onRetry={retry}
      />
      )}
    </WorkspaceIdentity>
  );
}
