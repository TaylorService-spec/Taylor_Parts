import { useState } from "react";
import { Link } from "react-router-dom";
import { useSalesOrderIndex } from "../../hooks/useSalesOrderIndex.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import FailureState from "../../shared/ui/FailureState";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives/index.js";

// THE SALES ORDER INDEX -- the cross-account list of Sales Orders.
//
// WHY IT DID NOT EXIST. `listSalesOrderIndex` has been deployed and live, admin has held
// every salesOrder.* capability, and the sandbox activates all four -- yet an admin
// signed into the product saw nothing anywhere about Sales Orders. The only Sales Order
// surface in the app was a DETAIL route reachable by first opening the Opportunity that
// created the order and following its link. If you did not already know an order
// existed, there was no way to find it. Nothing was denying access; there was simply
// nowhere to go.
//
// The four lifecycle states come from functions/src/salesOrder/salesOrderLifecycle.ts.
// They are repeated here because there is no shared-module tooling in this repo (the
// same reason the access contracts are mirrored) -- but the filter value is sent to the
// callable, which REJECTS an unrecognized state rather than ignoring it, so a drifted
// entry here fails loudly at the boundary instead of silently returning an unfiltered list.
const STATES = ["CONFIRMED", "IN_FULFILLMENT", "FULFILLED", "CLOSED", "CANCELLED"];

// Domain state -> SEMANTIC TONE, the mapping shared/ui/tone.js expects each domain to
// own. Only the seven tones in TONES exist; "warning"/"success" are not among them and
// would silently fall back to neutral, flattening the distinction this map exists to draw.
const STATE_TONE = {
  CONFIRMED: "info",
  IN_FULFILLMENT: "attention",
  FULFILLED: "positive",
  CLOSED: "muted",
  CANCELLED: "muted",
};

function formatDate(millis) {
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SalesOrdersList() {
  const [state, setState] = useState(null);
  const { rows, loading, loadingMore, errorStatus, skipped, hasMore, loadMore, refetch } = useSalesOrderIndex({ state });

  const filters = (
    <div className="fo-chip-row" role="group" aria-label="Filter by state">
      <Button variant={state === null ? "primary" : "secondary"} onClick={() => setState(null)}>
        All
      </Button>
      {STATES.map((s) => (
        <Button key={s} variant={state === s ? "primary" : "secondary"} onClick={() => setState(s)}>
          {s.replace(/_/g, " ")}
        </Button>
      ))}
    </div>
  );

  // DENIED is rendered distinctly from UNAVAILABLE and from EMPTY. "You cannot see this",
  // "we could not read it", and "there are none" are three different facts, and collapsing
  // them is the defect this codebase's read surfaces are explicitly built to avoid.
  if (errorStatus === "denied") {
    return (
      <WorkspaceShell title="Sales Orders">
        <FailureState
          title="Not authorized"
          message="Your access does not include reading Sales Orders. Ask your administrator if you need it."
        />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell title="Sales Orders" context={filters}>
      {errorStatus === "unavailable" && (
        <FailureState
          title="Could not load Sales Orders"
          message="The Sales Order read is temporarily unavailable."
          action={<Button variant="secondary" onClick={refetch}>Try again</Button>}
        />
      )}

      {loading && <p className="fo-state-message">Loading Sales Orders…</p>}

      {!loading && !errorStatus && rows.length === 0 && (
        <p className="fo-state-message">
          {state ? `No Sales Orders are in ${state.replace(/_/g, " ")}.` : "No Sales Orders exist yet."}
        </p>
      )}

      {rows.length > 0 && (
        <table className="fo-table">
          <thead>
            <tr>
              <th scope="col">Sales Order</th>
              <th scope="col">State</th>
              <th scope="col">Opportunity</th>
              <th scope="col">Customer PO</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {/* The governed business reference, never the Firestore document id
                      (DECISIONS #106). An order created before numbering existed has no
                      salesOrderNumber -- shown as an honest unavailable state, not one
                      fabricated from the id. The row still links, because the id is a
                      legitimate ROUTE even when it is not a legitimate LABEL. */}
                  <Link to={`/opportunities/sales-order/${row.id}`}>
                    {row.salesOrderNumber || <span className="fo-muted">Number unavailable</span>}
                  </Link>
                </td>
                <td>
                  <StatusPill tone={STATE_TONE[row.state] ?? "neutral"}>
                    {String(row.state ?? "").replace(/_/g, " ") || "Unknown"}
                  </StatusPill>
                </td>
                <td>{row.sourceOpportunityNumber || <span className="fo-muted">—</span>}</td>
                <td>{row.customerPO || <span className="fo-muted">—</span>}</td>
                <td>{formatDate(row.createdAtMillis) ?? <span className="fo-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Rows the server could not honestly project are REPORTED, not hidden. A list that
          silently drops malformed records reads as complete when it is not. */}
      {skipped > 0 && (
        <p className="fo-warning">
          {skipped} record{skipped === 1 ? "" : "s"} could not be displayed and {skipped === 1 ? "is" : "are"} not
          shown above.
        </p>
      )}

      {hasMore && (
        <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </WorkspaceShell>
  );
}
