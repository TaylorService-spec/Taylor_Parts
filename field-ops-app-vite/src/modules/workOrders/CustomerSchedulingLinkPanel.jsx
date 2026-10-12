import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives";
import { callWorkOrderApi } from "../../services/workOrderApiClient.js";
import { routerBasenameFrom } from "../../routerBasename";

// SERVICE OFFICE -> CUSTOMER SCHEDULING LINK (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
//
// Issue a link for an unscheduled Work Order; the customer picks a time from governed availability and the booking
// lands on THIS Work Order through the governed schedule command -- the office sees it here with no sync step.
// GENERATION IS NOT DELIVERY: the link is shown ONCE, to be sent through whatever channel the office uses; EOS sends
// nothing (no outbound email / SMS is governed yet). The panel renders nothing for a caller without the authority --
// every action is re-authorized server-side anyway.

const STATUS_TEXT = { ACTIVE: "Waiting for the customer", EXPIRED: "Expired", COMPLETED: "Booked by the customer", REVOKED: "Withdrawn", SUPERSEDED: "Replaced by a newer link" };

export default function CustomerSchedulingLinkPanel({ workOrder, call = callWorkOrderApi }) {
  const [sessions, setSessions] = useState({ status: "loading", items: [] });
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const workOrderId = workOrder?.id ?? workOrder?.workOrderId ?? null;
  // The CURRENT load. A response is applied only if it answers the load still current: not after unmount (no state
  // update on a torn-down tree), and never a late answer for a PREVIOUS Work Order over the one now shown.
  const currentLoad = useRef(0);
  // The Work Order this panel is showing, or null once unmounted. Set by an effect (not at first render) so StrictMode's
  // mount -> unmount -> remount leaves it correct. An issue/revoke answer is applied only while its Work Order is shown,
  // and moving to another Work Order clears the previous one's link, error and busy state.
  const shownWorkOrder = useRef(null);
  useEffect(() => {
    shownWorkOrder.current = workOrderId;
    setIssued(null);
    setError(null);
    setBusy(false);
    return () => { shownWorkOrder.current = null; };
  }, [workOrderId]);

  const load = useCallback(async () => {
    if (!workOrderId) return;
    const mine = ++currentLoad.current;
    const res = await call("readSelfSchedulingSessions", { workOrderId });
    if (mine !== currentLoad.current) return;
    setSessions(res.ok ? { status: "ready", items: res.result.sessions ?? [] } : { status: res.code === "FORBIDDEN" ? "denied" : "unavailable", items: [] });
  }, [call, workOrderId]);
  useEffect(() => {
    load();
    // Leaving this Work Order (or unmounting) retires the in-flight load.
    return () => { currentLoad.current += 1; };
  }, [load]);

  if (!workOrderId || sessions.status === "denied") return null;
  const schedulable = workOrder.status === "READY_TO_DISPATCH";
  if (!schedulable && sessions.items.length === 0) return null;

  const issue = async () => {
    setBusy(true);
    setError(null);
    const res = await call("issueSelfSchedulingLink", { workOrderId });
    if (shownWorkOrder.current !== workOrderId) return;
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    const base = routerBasenameFrom(import.meta.env.BASE_URL).replace(/\/+$/, "");
    setIssued({ url: `${window.location.origin}${base}${res.result.linkPath}`, expiresAt: res.result.expiresAt });
    load();
  };
  const revoke = async () => {
    const reason = window.prompt("Why is this link being withdrawn?");
    if (!reason) return;
    setBusy(true);
    const res = await call("revokeSelfSchedulingLink", { workOrderId, reason });
    if (shownWorkOrder.current !== workOrderId) return;
    setBusy(false);
    if (!res.ok) setError(res.message);
    setIssued(null);
    load();
  };
  const active = sessions.items.find((s) => s.status === "ACTIVE");

  return (
    <section className="fo-panel fo-self-schedule-link" aria-label="Customer Scheduling Link">
      <h3>Customer Scheduling Link</h3>
      {error && <p className="fo-inline-error" role="alert">{error}</p>}
      {issued && (
        <div role="status">
          <p>Send this link to the customer. It is shown once, and expires {new Date(issued.expiresAt).toLocaleString()}.</p>
          <input className="fo-wizard-control" readOnly value={issued.url} onFocus={(e) => e.target.select()} aria-label="Scheduling Link" />
          <Button variant="tertiary" onClick={() => navigator.clipboard?.writeText(issued.url)}>Copy Link</Button>
        </div>
      )}
      {schedulable && (
        <Button variant="secondary" disabled={busy} onClick={issue}>{active ? "Replace the Link" : "Create Scheduling Link"}</Button>
      )}
      {active && <Button variant="tertiary" className="fo-link-btn" disabled={busy} onClick={revoke}>Withdraw Link</Button>}
      {sessions.items.length > 0 && (
        <ul className="fo-muted">
          {sessions.items.map((s) => (
            <li key={s.sessionId}>
              {STATUS_TEXT[s.status] ?? s.status} · issued {new Date(s.issuedAt).toLocaleString()}
              {s.selectedStart ? ` · booked for ${new Date(s.selectedStart).toLocaleString()}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
