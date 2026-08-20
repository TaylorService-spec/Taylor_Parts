import { useNavigate } from "react-router-dom";
import { salesOrderEntity, salesOrderIndexList } from "../../metadata/definitions/salesOrder.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";

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
export default function SalesOrdersList() {
  const navigate = useNavigate();
  // The list view declares its OWN readCallable ("listSalesOrderIndex"), which
  // useMetadataList resolves ahead of the entity's account-scoped one. The unscoped index
  // and the account-scoped related list are different reads with different authority
  // shapes; reusing one for the other was explicitly ruled out.
  const { presentation, loadMore, retry } = useMetadataList(salesOrderIndexList, salesOrderEntity, {
    filters: [],
  });

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
