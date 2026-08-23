import { lazy, Suspense, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";

import {
  WAREHOUSE_TABS, WAREHOUSE_MORE_ITEMS, composeWarehouseHome,
} from "../../domain/warehouseHandheld";
import { RECEIVING_TRANSPORT_READY } from "../../config/receivingReadiness.js";
import { unavailableText } from "../../access/scanWorkflows.js";

// THE WAREHOUSE / PARTS HANDHELD — four tabs, one answer per screen.
//
// ============================ IT COMPOSES THE SCAN WORKSPACE ============================
//
// Every workflow a person can start from here IS the existing governed surface, mounted unchanged:
// supplier receiving, put-away, pick, transfer, cycle count, return intake, lookup. There is no
// second receiving component, no second transfer lifecycle, no second count. So every invariant
// those already prove — scanning moves nothing, counting adjusts nothing, intake does not restock,
// picking holds nothing — holds here because it is literally the same code.
//
// What did not exist was a way to reach any of it with a thumb, on a 320px screen, in gloves.
//
// ============================ HOME AND WORK ARE ONE DERIVATION ============================
//
// Both answer "what may this person do". Home ranks by attention and leads with what is waiting;
// Work is the same set as a plain list. Two derivations would eventually disagree, and the one a
// person trusted would be whichever they happened to open.
//
// ============================ ABSENCE, NOT DISABLEMENT ============================
//
// A workflow this person has no capability for is NOT rendered greyed out. A disabled tile asserts
// that the operation exists and that access is the only obstacle — untrue for several of these,
// whose capabilities are registered active:false and carried by no Role anywhere. It would be an
// invitation to go and ask for something nobody can grant.
//
// ============================ SCAN IS LAZY. HOME IS NOT. ============================
//
// The scanning workspace pulls camera and decoding machinery that somebody checking what is waiting
// never needs. Home is the first thing opened, and deferring that moves the wait rather than
// removing it.
const ScanWorkspace = lazy(() => import("../scan/ScanWorkspace"));

export default function WarehouseShell({ deps = {} }) {
  const { role } = useAuth() ?? {};
  const [tab, setTab] = useState("home");
  // A workflow chosen on Home opens inside Scan, so the person lands ON the task rather than on a
  // menu of tasks they have just chosen from.
  const [requested, setRequested] = useState(null);

  const hasCapability = deps.hasCapability ?? null;
  const home = useMemo(() => composeWarehouseHome({
    hasCapability,
    receivingReady: deps.receivingReady ?? RECEIVING_TRANSPORT_READY,
    role: deps.role ?? role ?? null,
    counts: deps.counts ?? {},
  }), [hasCapability, deps.receivingReady, deps.role, deps.counts, role]);

  const openWorkflow = (key) => { setRequested(key); setTab("scan"); };

  return (
    <div className="fo-handheld">
      <main className="fo-handheld__body" aria-live="polite">
        {tab === "home" && <WarehouseHome home={home} onOpen={openWorkflow} />}
        {tab === "work" && <WarehouseWork home={home} onOpen={openWorkflow} />}
        {tab === "scan" && (
          <Suspense fallback={<p className="fo-muted" role="status">Starting the scanner…</p>}>
            <ScanWorkspace deps={{ hasCapability, role: deps.role ?? role, initialWorkflow: requested }} />
          </Suspense>
        )}
        {tab === "more" && <WarehouseMore />}
      </main>

      {/* BOTTOM nav, because a thumb reaches the bottom of a phone and not the top. */}
      <nav className="fo-handheld__nav" aria-label="Warehouse">
        {WAREHOUSE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`fo-handheld__tab${tab === t.key ? " fo-handheld__tab--active" : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
            onClick={() => { setRequested(null); setTab(t.key); }}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** "What needs attention?" — ranked by domain state, never by an invented severity score. */
function WarehouseHome({ home, onOpen }) {
  if (home.empty) {
    return (
      <section aria-label="Today">
        <h2>Nothing assigned to you here</h2>
        {/* An empty screen that merely looks empty is indistinguishable from a broken one, so it
            says WHY -- and names the one thing that would change it. */}
        <p className="fo-muted">
          No warehouse or parts work is available to your account. Warehouse tasks are staffed
          individually rather than by department, so this usually means a station has not been
          assigned to you yet. Ask your manager which one you should hold.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Today">
      <h2>What needs attention</h2>
      <ul className="fo-wh-queues">
        {home.queues.map((q) => (
          <li key={q.key} className="fo-wh-queue">
            <button type="button" className="fo-wh-queue__button" onClick={() => onOpen(q.key)}>
              <span className="fo-wh-queue__title">{q.title}</span>
              {/* A COUNT ONLY WHERE ONE CAN BE READ. Several of these queues have commands but no
                  governed list callable, and a number invented for a warehouse is a stock-out
                  somebody discovers at a customer site. */}
              {q.count !== null ? (
                <span className="fo-wh-queue__count">{q.count} waiting</span>
              ) : (
                <span className="fo-wh-queue__count fo-wh-queue__count--none">{q.countText}</span>
              )}
              {q.reason ? <span className="fo-wh-queue__reason">{q.reason}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The same authorized set, as a plain list of places to go. */
function WarehouseWork({ home, onOpen }) {
  return (
    <section aria-label="Work">
      <h2>Work</h2>
      {home.empty ? (
        <p className="fo-muted">Nothing is available to your account.</p>
      ) : (
        <ul className="fo-wh-queues">
          {home.queues.map((q) => (
            <li key={q.key} className="fo-wh-queue">
              <button type="button" className="fo-wh-queue__button" onClick={() => onOpen(q.key)}>
                <span className="fo-wh-queue__title">{q.title}</span>
                <span className="fo-wh-queue__reason">{q.actionLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Only where saying so helps somebody act: "the transport is not ready in this environment"
          is a different fact from "you may not", and one of them is worth telling a manager. */}
      {home.unavailable.length > 0 ? (
        <>
          <h3>Not available here</h3>
          <ul className="fo-list">
            {home.unavailable.map((u) => (
              <li key={u.workflow} className="fo-muted">{unavailableText(u.workflow, u.reason)}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** Small on purpose — a closed list, so the desktop side-nav never lands in here. */
function WarehouseMore() {
  return (
    <section aria-label="More">
      <ul className="fo-list">
        {WAREHOUSE_MORE_ITEMS.map((i) => (
          <li key={i.key}>
            {i.key === "sync"
              // WO-04 builds no warehouse offline runtime, and this says so rather than showing a
              // queue that would always be empty and imply work was being held.
              ? <span>{i.label} — <span className="fo-muted">warehouse work is sent as you do it</span></span>
              : i.label}
          </li>
        ))}
      </ul>
      <p className="fo-muted">
        Desktop EOS remains available separately for anything not on this list.
      </p>
    </section>
  );
}
