// THE TECHNICIAN'S PHONE — four tabs, one answer per screen.
//
// ============================ WHY A SHELL AND NOT A REBUILD ============================
//
// FieldMode, the technician dashboard, JobNote, PartsScanner and the install closeout all already
// exist and are already governed. What did not exist was a handheld composition: a way to reach them
// with a thumb, on a 320px screen, without a desktop side-nav.
//
// So this composes rather than replaces. Rebuilding those surfaces would have meant a second
// technician experience to keep in step with the first, and the second would drift.
//
// ============================ SCAN IS LAZY, HOME IS NOT ============================
//
// The scanner pulls in camera and decoding machinery that a technician checking their next job never
// needs. It loads when they open Scan, not when the app boots -- the whole point of the entry-bundle
// work this follows.
//
// Home and Jobs are eager: they are the first thing opened, and deferring them would move the wait
// rather than remove it.
import { lazy, Suspense, useMemo, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import {
  HANDHELD_TABS, MORE_ITEMS, SYNC_PRESENTATION,
  composeTechnicianHome, composeJobCards, homePrimaryActionLabel,
} from "../../domain/technicianHandheld";
import { Button } from "../../shared/ui/primitives";
import FieldMode from "../mobile/FieldMode";
import SyncIndicator from "../../shared/ui/SyncIndicator.jsx";
import { useOfflineRuntime } from "../../hooks/useOfflineRuntime";

// The scanner and its dependencies arrive only when Scan is opened.
const ScanWorkspace = lazy(() => import("../scan/ScanWorkspace"));
// The sync queue is opened when something needs looking at, so its chunk waits until then. The
// INDICATOR that says something needs looking at is eager -- see SyncIndicator.jsx.
const SyncQueue = lazy(() => import("../mobile/SyncQueue"));

export default function TechnicianShell({ deps = {} }) {
  const [tab, setTab] = useState("home");
  const { technicianId, loading: techLoading } = useCurrentTechnician();
  const { data: workOrders, loading: workOrdersLoading } = useAssignedWorkOrders(technicianId);

  // ONE technician-scoped subscription feeds every tab. Home and Jobs are two views of the same
  // read, not two reads -- a phone on a weak connection should not pay twice for one answer.
  // WO-02 left `pending` as a prop with nothing behind it. It is now the REAL queue: what this
  // technician has captured on this device and the platform has not yet accepted.
  const offline = useOfflineRuntime({ technicianId: () => technicianId, ...(deps.offline ?? {}) });
  const home = useMemo(
    () => composeTechnicianHome({
      workOrders: workOrders ?? [],
      pending: deps.pending ?? offline.queue.map((i) => ({
        intentId: i.intentId, state: i.state, label: i.describe,
      })),
    }),
    [workOrders, deps.pending, offline.queue],
  );
  const cards = useMemo(() => composeJobCards(workOrders ?? []), [workOrders]);
  const loading = techLoading || workOrdersLoading;

  return (
    <div className="fo-handheld">
      <main className="fo-handheld__body" aria-live="polite">
        {tab === "home" && (
          <HandheldHome
            home={home} loading={loading} onOpenJobs={() => setTab("jobs")}
            offline={offline} onOpenSync={() => setTab("more")}
          />
        )}
        {tab === "jobs" && <HandheldJobs cards={cards} loading={loading} />}
        {tab === "scan" && (
          <Suspense fallback={<p className="fo-muted" role="status">Starting the scanner…</p>}>
            <ScanWorkspace />
          </Suspense>
        )}
        {tab === "more" && <HandheldMore offline={offline} />}
      </main>

      {/* BOTTOM nav, because a thumb reaches the bottom of a phone and not the top. */}
      <nav className="fo-handheld__nav" aria-label="Technician">
        {HANDHELD_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`fo-handheld__tab${tab === t.key ? " fo-handheld__tab--active" : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** "What do I need to do next?" — and nothing that does not answer it. */
function HandheldHome({ home, loading, onOpenJobs, offline, onOpenSync }) {
  if (loading) return <p className="fo-muted" role="status">Loading your day…</p>;
  const actionLabel = homePrimaryActionLabel(home);

  return (
    <section aria-label="Today">
      {/* ABOVE THE DAY. Unsynced work is the thing most easily forgotten and least recoverable, so it
          is never below the fold and never behind a tap. */}
      {offline ? (
        <SyncIndicator
          indicator={offline.indicator} syncing={offline.syncing}
          onOpen={onOpenSync} onSync={() => offline.sync(true)}
        />
      ) : null}
      {/* UNSYNCED WORK COMES FIRST. It is the thing most easily forgotten and least recoverable. */}
      {home.pending.length > 0 && (
        <div className="fo-handheld__pending" role="status">
          <h2>Waiting to sync</h2>
          <ul className="fo-list">
            {home.pending.map((p) => (
              <li key={p.intentId ?? p.id}>
                <span>{p.label ?? "Captured on this device"}</span>
                <span className="fo-muted">{SYNC_PRESENTATION[p.state]?.label ?? p.state}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {home.current ? (
        <>
          <h2>Current job</h2>
          {/* The whole governed current-job composition, unchanged. */}
          <FieldMode />
        </>
      ) : (
        <div className="fo-handheld__empty">
          <h2>Nothing in progress</h2>
          <p className="fo-muted">
            {home.today.length > 0
              ? `${home.today.length} job${home.today.length === 1 ? "" : "s"} assigned to you.`
              : "No jobs are assigned to you right now."}
          </p>
          {home.today.length > 0 && <Button onClick={onOpenJobs}>See my jobs</Button>}
        </div>
      )}

      {home.blocked.length > 0 && (
        <div className="fo-handheld__blocked">
          <h2>Blocked by parts</h2>
          <ul className="fo-list">
            {home.blocked.map((wo) => (
              <li key={wo.id}>{wo.woNumber ?? wo.id}</li>
            ))}
          </ul>
        </div>
      )}

      {actionLabel && <p className="fo-muted">Next: {actionLabel}</p>}
    </section>
  );
}

/** Cards, not a table. A desktop grid on a phone is a horizontal scrollbar with extra steps. */
function HandheldJobs({ cards, loading }) {
  if (loading) return <p className="fo-muted" role="status">Loading your jobs…</p>;
  if (cards.length === 0) {
    return <p className="fo-muted">No jobs are assigned to you right now.</p>;
  }
  return (
    <section aria-label="My jobs">
      <ul className="fo-handheld__jobs">
        {cards.map((c) => (
          <li key={c.workOrderId} className="fo-handheld__job">
            <p className="fo-handheld__job-ref">{c.woNumber}{c.isInstall ? " · Installation" : ""}</p>
            <p className="fo-handheld__job-customer">{c.customer ?? "Customer unknown"}</p>
            <p className="fo-muted">{c.location ?? "Location unknown"}</p>
            <p className="fo-muted">
              {c.status}
              {/* UNKNOWN is shown as UNKNOWN. Rendering it as "Missing" would send somebody to a
                  supplier for parts that may be sitting on their van. */}
              {c.readiness ? ` · parts ${c.readiness.toLowerCase()}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Small on purpose — see MORE_ITEMS on why this is a closed list. */
function HandheldMore({ offline }) {
  const [openItem, setOpenItem] = useState(null);
  return (
    <section aria-label="More">
      <ul className="fo-list">
        {MORE_ITEMS.map((i) => (
          // "Sync status" was a label with nothing behind it. It is now the queue itself: every
          // item, its state, why it stopped, and what to do -- NO HIDDEN QUEUE.
          i.key === "sync" ? (
            <li key={i.key}>
              <button type="button" className="fo-link-btn" onClick={() => setOpenItem(openItem === "sync" ? null : "sync")} aria-expanded={openItem === "sync"}>
                {i.label}
                {offline?.summary?.unsynced > 0 ? ` — ${offline.summary.unsynced} not sent` : ""}
              </button>
            </li>
          ) : <li key={i.key}>{i.label}</li>
        ))}
      </ul>

      {openItem === "sync" && offline ? (
        <Suspense fallback={<p className="fo-muted" role="status">Opening sync…</p>}>
          <SyncQueue runtime={offline} onClose={() => setOpenItem(null)} />
        </Suspense>
      ) : null}
      <p className="fo-muted">
        Desktop EOS remains available separately for anything not on this list.
      </p>
    </section>
  );
}
