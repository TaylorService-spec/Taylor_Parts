import { useParams, Link } from "react-router-dom";
import { useSalesOrder } from "../../hooks/useSalesOrder.js";
import { salesOrderView, SALES_ORDER_VIEW_STATE } from "../../domain/salesOrderView.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import FailureState from "../../shared/ui/FailureState";
import SalesOrderActions from "./SalesOrderActions.jsx";

// Minimum usable Sales Order view (Owner-ratified 2026-08-15) over the trusted
// getSalesOrderContext read (salesOrder.read — admin/dispatcher, sandbox-activated), with
// operational actions (Item 4, salesOrder.write/.fulfill/.service — same sandbox activation) layered
// on top via SalesOrderActions.jsx. Makes visible: identity, account, originating Opportunity,
// lifecycle state, lines with the ordered/allocated/fulfilled/billed quantity model, and
// service/Work Order lineage. Still not a CRM redesign, and still exposes NO pricing/discount/tax/
// quote-term field — those stay out of scope for this operational surface.
//
// Distinguishes LOADING / DENIED / UNAVAILABLE / NOT_FOUND / READY — DENIED never renders as
// EMPTY (Item 4A finding, explicitly preserved here).
// `actionDeps` is an injectable test-only seam (mirrors PartWriteModal's `writeDeps`): passed straight
// through to SalesOrderActions -> useSalesOrderActions so tests can supply a MOCKED command client
// without touching `firebase`. Production routing never supplies it, so it defaults to the real client.
// `hasCapability` is the REAL trusted write-capability signal (access/useSalesOrderCapabilities),
// passed straight through to SalesOrderActions so it can render Advance/Cancel/Allocate/Create Service
// as live only for a principal actually granted salesOrder.write/.fulfill/.service -- fail-closed
// (protected + disabled + honest) when omitted, same posture as every other write-readiness seam.
export default function SalesOrderDetail({ actionDeps, hasCapability } = {}) {
  const { salesOrderId } = useParams();
  const { loading, errorStatus, result, refetch } = useSalesOrder(salesOrderId);
  const view = salesOrderView({ loading, errorStatus, result });

  const actions =
    view.kind === SALES_ORDER_VIEW_STATE.READY
      ? <SalesOrderActions view={view} onChanged={refetch} actionDeps={actionDeps} hasCapability={hasCapability} />
      : null;

  // The page title is the governed business reference, never the Firestore document id
  // (DECISIONS #106: a missing reference is not permission to display a record id). A Sales
  // Order created before numbering existed has no salesOrderNumber -- that is rendered as an
  // honest unavailable state, not a fabricated or id-derived one. `view.id` remains available
  // to the rest of the tree for routing only.
  const title =
    view.kind === SALES_ORDER_VIEW_STATE.READY
      ? view.salesOrderNumber
        ? `Sales Order ${view.salesOrderNumber}`
        : "Sales Order — Reference unavailable"
      : "Sales Order";

  return (
    <WorkspaceShell title={title} actions={actions}>
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
                // Label with the Opportunity's immutable reference, never its document id.
                // Where a Sales Order predates Opportunity identity there is no reference to
                // show, so the link reads "Originating opportunity" — a true statement that a
                // link exists, rather than a database key presented as a name.
                value: view.sourceOpportunityId
                  ? (
                    <Link to="/customers/opportunities">
                      {view.sourceOpportunityNumber || "Originating opportunity"}
                    </Link>
                  )
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
