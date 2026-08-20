import { useMemo } from "react";
import LifecycleChevrons from "../../shared/ui/LifecycleChevrons.jsx";
import {
  projectFulfillmentProgress,
  STEP_STATE,
} from "../../domain/salesOrderFulfillmentProgress.js";

// SALES ORDER > FULFILLMENT & INSTALLATION.
//
// A read-only answer to the question a salesperson actually asks: "where is my customer's
// order?" Every value is derived by domain/salesOrderFulfillmentProgress.js from records
// that already exist. There is no installation-status field here and there must not be one —
// an editable summary becomes a second source of truth that drifts from the records it
// claims to describe, and the drift is invisible precisely because the field looks official.
//
// THE BUSINESS RULES ARE NOT IN THIS COMPONENT. LifecycleChevrons is deliberately
// business-rule-free and stays that way; this file maps a projected state onto its
// vocabulary and nothing more.
//
// SIX STATES, THREE SLOTS. The chevron control understands complete/current/future. The
// projection distinguishes three more — blocked, failed, unknown — and those must not be
// flattened into "future", which reads as "not yet, but on track". They are mapped to
// `current` (so the eye lands on them) and carry their meaning in the LABEL and in the
// per-step explanation below, never in colour alone.
const CHEVRON_STATUS = {
  [STEP_STATE.COMPLETE]: "complete",
  [STEP_STATE.CURRENT]: "current",
  [STEP_STATE.FUTURE]: "future",
  // Not "future": something is wrong or unproven here, and a step that reads as merely
  // not-yet-reached would understate it.
  [STEP_STATE.BLOCKED]: "current",
  [STEP_STATE.FAILED]: "current",
  [STEP_STATE.UNKNOWN]: "current",
};

// Suffixes carry the extra states in TEXT, so meaning survives without colour — which is
// what a screen reader gets, and what a colour-blind reader gets.
const STATE_SUFFIX = {
  [STEP_STATE.BLOCKED]: " — blocked",
  [STEP_STATE.FAILED]: " — cancelled",
  [STEP_STATE.UNKNOWN]: " — not recorded",
};

const fmtDate = (millis) =>
  Number.isFinite(millis) ? new Date(millis).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

export default function SalesOrderFulfillmentSection({ salesOrder, workOrders = null, custodyHandoff = null }) {
  const progress = useMemo(
    () => projectFulfillmentProgress(salesOrder, workOrders, custodyHandoff),
    [salesOrder, workOrders, custodyHandoff],
  );

  const steps = progress.steps.map((s) => ({
    key: s.key,
    label: `${s.label}${STATE_SUFFIX[s.state] ?? ""}`,
    status: CHEVRON_STATUS[s.state] ?? "future",
  }));

  const { quantities: qty } = progress;

  return (
    <section aria-labelledby="so-fulfillment-h">
      <h3 id="so-fulfillment-h">Fulfillment &amp; Installation</h3>

      <LifecycleChevrons steps={steps} ariaLabel="Fulfillment and installation progress" />

      {/* The chevrons are a summary. Everything that makes them true, or prevents them from
          being true, is stated underneath — a progression a reader cannot interrogate is a
          claim they have to take on trust. */}
      <dl className="fo-kv">
        <dt>Allocation</dt>
        <dd>
          {qty.allocated === null ? (
            <span className="fo-muted">Not recorded on this order</span>
          ) : (
            `${qty.allocated} of ${qty.ordered} allocated`
          )}
        </dd>
        <dt>Installations</dt>
        <dd>
          {workOrders === null ? (
            <span className="fo-muted">Could not be read</span>
          ) : progress.workOrders.length === 0 ? (
            <span className="fo-muted">None linked yet</span>
          ) : (
            `${progress.workOrders.filter((w) => w.reachedInstalled).length} of ${progress.workOrders.filter((w) => !w.cancelled).length} complete`
          )}
        </dd>
      </dl>

      {progress.blockers.length > 0 && (
        // role="status" rather than "alert": these are explanations of an honest state, not
        // errors demanding immediate attention.
        <ul className="fo-list" role="status" aria-label="Why some steps are incomplete">
          {progress.blockers.map((b) => (
            <li key={b} className="fo-muted">{b}</li>
          ))}
        </ul>
      )}

      {Array.isArray(workOrders) && progress.workOrders.length > 0 && (
        <table className="fo-table">
          <caption className="fo-muted">Linked Work Orders</caption>
          <thead>
            <tr>
              <th scope="col">Work Order</th>
              <th scope="col">Status</th>
              <th scope="col">Scheduled</th>
              <th scope="col">Technician</th>
            </tr>
          </thead>
          <tbody>
            {progress.workOrders.map((w) => (
              <tr key={w.id}>
                {/* The business reference, never the document id. A row that shows a Firestore
                    id is asking a human to read a value meant for a database. */}
                <td>{w.workOrderNumber ?? <span className="fo-muted">Number unavailable</span>}</td>
                <td>{w.cancelled ? "Cancelled" : (w.status ?? <span className="fo-muted">Unknown</span>)}</td>
                <td>{fmtDate(w.scheduledAtMillis) ?? <span className="fo-muted">Not scheduled</span>}</td>
                <td>{w.technicianName ?? <span className="fo-muted">Unassigned</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
