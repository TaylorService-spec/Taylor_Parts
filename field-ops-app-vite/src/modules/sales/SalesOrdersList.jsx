import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { salesOrderEntity, salesOrderIndexList } from "../../metadata/definitions/salesOrder.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import { useAccountReferenceResolver } from "../../hooks/useAccountReferenceResolver.js";

/** Module-level so the identity is stable and the list effect does not refetch every render. */
const NO_FILTERS = [];

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
  const { presentation, rows, loadMore, retry } = useMetadataList(salesOrderIndexList, salesOrderEntity, {
    filters: NO_FILTERS,
    resolveReference,
  });

  // `rows` is hook state, so its identity is stable between fetches and this cannot loop.
  useEffect(() => { setResolvableRows(rows ?? []); }, [rows]);

  return (
    <WorkspaceShell title="Sales Orders">
      <MetadataListGrid
        presentation={presentation}
        caption="Sales Orders"
        // The destination the definition itself names (rowNavigationTo), not a path this
        // screen invents -- so the row target cannot drift from the declaration.
        onRowClick={(id) => navigate(`/customers/opportunities/sales-order/${id}`)}
        onLoadMore={loadMore}
        onRetry={retry}
      />
    </WorkspaceShell>
  );
}
