import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { salesOrderEntity, salesOrderIndexList } from "../../metadata/definitions/salesOrder.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import { salesOrderDisplayCurrency } from "../../domain/salesOrderDisplayCurrency.js";
import {
  AddFilter, ActiveCriteria, SortControl, ListEmptyState, DroppedCriteriaNotice,
} from "../../metadata/MetadataListControls.jsx";
import ListViewHeader from "../../metadata/ListViewHeader.jsx";
import { useListViewChrome } from "../../hooks/useListViewChrome.js";
import {
  addFilter, removeFilter, clearFilters, setSort, describeDropped, describeRefusal,
} from "../../metadata/listUrlState.js";
import { useListCriteria } from "../../hooks/useListCriteria.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import { useAccountReferenceResolver } from "../../hooks/useAccountReferenceResolver.js";

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
  const { resolveReference } = useAccountReferenceResolver(resolvableRows);
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
    // X-SALES-ORDER-USD-DISPLAY. Orders created before PR #976 carry no `currency` field, so the
    // Dollars column rendered "USD 50.00" for one order and "50.00" for another worth the same
    // fifty dollars. The projection is right to report the gap honestly; this surface knows every
    // Sales Order this implementation can create is USD (buildCreateSalesOrder hardcodes it and
    // takes no parameter that could produce anything else), so it says so HERE rather than letting
    // a formatter decide that unlabelled money is dollars. See domain/salesOrderDisplayCurrency.js.
    resolveCurrency: salesOrderDisplayCurrency,
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

  return (
    <WorkspaceShell title="Sales Orders">
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

      {/* NO DOLLARS COLUMN, and its absence is registered rather than forgotten. The Sales Order
          document stores no total of any kind — see SALES_ORDER_TOTAL_AUTHORITY_GAP. */}
      {presentation?.state === "FILTERED" ? (
        <ListEmptyState criteria={criteria} onClear={() => apply(clearFilters(criteria))} />
      ) : (
      <MetadataListGrid
        presentation={presentation}
        caption="Sales Orders"
        // The destination the definition itself names (rowNavigationTo), not a path this
        // screen invents -- so the row target cannot drift from the declaration.
        onRowClick={(id) => navigate(`/customers/opportunities/sales-order/${id}`)}
        onLoadMore={loadMore}
        onRetry={retry}
      />
      )}
    </WorkspaceShell>
  );
}
