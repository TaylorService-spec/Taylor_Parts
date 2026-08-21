import { useAccountSalesOrders } from "../../hooks/useAccountSalesOrders.js";
import { accountSalesOrdersView, ACCOUNT_SALES_ORDERS_STATE } from "../../domain/accountSalesOrdersView.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { resolveEmployeeIdentity } from "../../domain/actorDisplayName.js";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import FailureState from "../../shared/ui/FailureState";
import { Link } from "react-router-dom";

// Account-scoped Sales Orders -- Wave 7 completion PART 3. Reads the trusted
// `listSalesOrdersForAccount` callable (functions/src/salesOrder/salesOrderReadService.ts, capability
// `salesOrder.read` -- the SAME capability getSalesOrderContext already uses, reused rather than a new
// one minted). Deep links to the existing per-id Sales Order route
// (/customers/opportunities/sales-order/:salesOrderId, see SalesOrderDetail.jsx / App.jsx) -- a REAL
// route, unlike Opportunity's shared-workspace-only link in AccountOpportunitiesSection.jsx.
//
// No amount/price is rendered here by design: PR #991 deliberately stripped unitPrice from the
// underlying projection (no pricing policy, no quote state on this surface) and this section adds
// nothing the projection doesn't already carry. Only the service-lineage indicator
// (serviceWorkOrderIds.length) is shown, since it IS authoritative on the projection.
//
// EMPTY vs FAILURE (the single most important behavioral requirement here): EMPTY renders ONLY when the
// read genuinely succeeded with zero rows. denied/unavailable render FailureState -- never the
// empty-state copy. See domain/accountSalesOrdersView.js for the state machine this renders.
function formatDate(millis) {
  if (typeof millis !== "number" || !Number.isFinite(millis)) return null;
  return new Date(millis).toLocaleDateString();
}

export default function AccountSalesOrdersSection({ accountId }) {
  const { loading, errorStatus, result } = useAccountSalesOrders(accountId);
  const { byEmployeeId, loading: directoryLoading, error: directoryError } = useEmployeeDirectory();
  const view = accountSalesOrdersView({ loading, errorStatus, result });

  return (
    <section id="account-sales-orders-section" className="wo-history" aria-label="Sales Orders">
      <h4>Sales Orders</h4>

      {view.kind === ACCOUNT_SALES_ORDERS_STATE.LOADING && <p className="fo-muted">Loading sales orders…</p>}

      {view.kind === ACCOUNT_SALES_ORDERS_STATE.DENIED && (
        <FailureState title="Sales Orders unavailable" message="You are not authorized to view Sales Orders for this account." />
      )}

      {view.kind === ACCOUNT_SALES_ORDERS_STATE.UNAVAILABLE && (
        <p className="fo-muted" data-sales-orders-unavailable>Sales Orders are currently unavailable. Try again later.</p>
      )}

      {/* EMPTY renders ONLY on a genuinely succeeded read with zero rows -- never on denied/unavailable
          above. */}
      {view.kind === ACCOUNT_SALES_ORDERS_STATE.EMPTY && <p className="fo-muted">No sales orders on this account.</p>}

      {view.kind === ACCOUNT_SALES_ORDERS_STATE.READY && (
        <div>
          {view.truncated && (
            <p className="fo-muted" role="status">
              Showing the first {view.rows.length} sales orders — more may exist on this account.
            </p>
          )}
          <ul className="fo-activity-list">
            {view.rows.map((row) => {
              const owner = resolveEmployeeIdentity(row.ownerEmployeeId, { byEmployeeId, loading: directoryLoading, error: directoryError });
              const updated = formatDate(row.updatedAtMillis);
              return (
                <li key={row.key}>
                  {/* The order's own number identifies it. An order predating the salesOrderNumber
                      rollout genuinely has none -- readSalesOrdersForAccount applies no orderBy, so
                      unlike the global list it DOES return them -- and it is labelled as unnumbered
                      rather than with its raw document id, which identifies nothing to a reader. */}
                  <Link to={`/customers/opportunities/sales-order/${row.id}`}>
                    {row.salesOrderNumber ?? "Unnumbered sales order"}
                  </Link>{" "}
                  {/* Shown as what it is: the customer's own reference, not this order's number. */}
                  {row.customerPO && <span className="fo-muted">Customer PO {row.customerPO}</span>}{" "}
                  <StatusPill tone={row.tone} label={row.state ?? "—"} />{" "}
                  {row.hasServiceLineage && (
                    <StatusPill tone="positive" label={`${row.serviceWorkOrderCount} Work Order${row.serviceWorkOrderCount === 1 ? "" : "s"}`} />
                  )}{" "}
                  <span className="fo-muted">
                    {owner.state === "loading" ? "owner loading…" : owner.state === "unset" ? "" : `owner: ${owner.name}`}
                    {updated ? ` · updated ${updated}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
