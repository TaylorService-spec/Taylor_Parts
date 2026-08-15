import { useParams, Link } from "react-router-dom";
import { useSalesOrder } from "../../hooks/useSalesOrder.js";
import { salesOrderView, SALES_ORDER_VIEW_STATE } from "../../domain/salesOrderView.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import FailureState from "../../shared/ui/FailureState";

// Minimum usable Sales Order view (Owner-ratified 2026-08-15) over the trusted
// getSalesOrderContext read (salesOrder.read — admin/dispatcher, sandbox-activated). Makes
// visible: identity, account, originating Opportunity, lifecycle state, lines with the
// ordered/allocated/fulfilled/billed quantity model, and service/Work Order lineage. Not a
// CRM redesign — read-only today; lifecycle/allocation/service actions are a later slice
// once their own write-readiness seams are built (same shape as opportunityWriteReadiness.js).
//
// Distinguishes LOADING / DENIED / UNAVAILABLE / NOT_FOUND / READY — DENIED never renders as
// EMPTY (Item 4A finding, explicitly preserved here).
export default function SalesOrderDetail() {
  const { salesOrderId } = useParams();
  const { loading, errorStatus, result } = useSalesOrder(salesOrderId);
  const view = salesOrderView({ loading, errorStatus, result });

  const actions = null; // read-only today; a future write-readiness seam adds lifecycle actions here

  return (
    <WorkspaceShell title={view.kind === SALES_ORDER_VIEW_STATE.READY ? `Sales Order ${view.id}` : "Sales Order"} actions={actions}>
      {view.kind === SALES_ORDER_VIEW_STATE.LOADING && <p className="fo-muted">Loading Sales Order…</p>}
      {view.kind === SALES_ORDER_VIEW_STATE.DENIED && (
        <FailureState title="Sales Order unavailable" message="You are not authorized to view this Sales Order." />
      )}
      {view.kind === SALES_ORDER_VIEW_STATE.UNAVAILABLE && (
        <p className="fo-muted">Sales Order is currently unavailable. Try again later.</p>
      )}
      {view.kind === SALES_ORDER_VIEW_STATE.NOT_FOUND && (
        <p className="fo-muted">No Sales Order found for this id.</p>
      )}
      {view.kind === SALES_ORDER_VIEW_STATE.READY && (
        <>
          <ContextBand
            items={[
              { key: "account", label: "Account", value: <Link to={`/customers/${view.accountId}`}>{view.accountId}</Link> },
              {
                key: "opportunity",
                label: "Originating Opportunity",
                value: view.sourceOpportunityId
                  ? <Link to="/customers/opportunities">{view.sourceOpportunityId}</Link>
                  : "—",
              },
              { key: "state", label: "Lifecycle state", value: <StatusPill tone={view.tone} label={view.state} /> },
              { key: "channel", label: "Channel", value: view.salesChannel ?? "—" },
              { key: "owner", label: "Owner", value: view.ownerEmployeeId ?? "—" },
              { key: "po", label: "Customer PO", value: view.customerPO ?? "—" },
            ]}
          />

          <section aria-labelledby="so-lines-h">
            <h3 id="so-lines-h">Lines</h3>
            {view.lines.length === 0 ? (
              <p className="fo-muted">No lines.</p>
            ) : (
              <div className="fo-table-scroll">
                <table className="fo-table">
                  <thead>
                    <tr>
                      <th>Ref</th><th>Kind</th><th>Ordered</th><th>Allocated</th><th>Fulfilled</th><th>Billed</th><th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.lines.map((l) => (
                      <tr key={l.key}>
                        <td>{l.ref}</td>
                        <td>{l.kind}</td>
                        <td>{l.orderedQty}</td>
                        <td>{l.allocatedQty}</td>
                        <td>{l.fulfilledQty}</td>
                        <td>{l.billedQty}</td>
                        <td>{l.fullyFulfilled ? <StatusPill tone="positive" label="Fulfilled" /> : l.remainingQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="so-service-h">
            <h3 id="so-service-h">Service / Work Order lineage</h3>
            {view.serviceWorkOrderIds.length === 0 ? (
              <p className="fo-muted">No Work Orders linked yet.</p>
            ) : (
              <ul className="fo-list">
                {view.serviceWorkOrderIds.map((woId) => (
                  <li key={woId}>{woId}</li>
                ))}
              </ul>
            )}
          </section>

          {view.notes && (
            <section aria-labelledby="so-notes-h">
              <h3 id="so-notes-h">Notes</h3>
              <p className="fo-muted">{view.notes}</p>
            </section>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
