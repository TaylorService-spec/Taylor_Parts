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

// The scanner and its dependencies arrive only when Scan is opened.
const ScanWorkspace = lazy(() => import("../scan/ScanWorkspace"));

export default function TechnicianShell({ deps = {} }) {
  const [tab, setTab] = useState("home");
  const { technicianId, loading: techLoading } = useCurrentTechnician();
  const { data: workOrders, loading: workOrdersLoading } = useAssignedWorkOrders(technicianId);

  // ONE technician-scoped subscription feeds every tab. Home and Jobs are two views of the same
  // read, not two reads -- a phone on a weak connection should not pay twice for one answer.
  const home = useMemo(
    () => composeTechnicianHome({ workOrders: workOrders ?? [], pending: deps.pending ?? [] }),
    [workOrders, deps.pending],
  );
  const cards = useMemo(() => composeJobCards(workOrders ?? []), [workOrders]);
  const loading = techLoading || workOrdersLoading;

  return (
    <div className="fo-handheld">
      <main className="fo-handheld__body" aria-live="polite">
        {tab === "home" && <HandheldHome home={home} loading={loading} onOpenJobs={() => setTab("jobs")} />}
        {tab === "jobs" && <HandheldJobs cards={cards} loading={loading} />}
        {tab === "scan" && (
          <Suspense fallback={<p className="fo-muted" role="status">Starting the scanner…</p>}>
            <ScanWorkspace />
          </Suspense>
        )}
        {tab === "more" && <HandheldMore />}
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
function HandheldHome({ home, loading, onOpenJobs }) {
  if (loading) return <p className="fo-muted" role="status">Loading your day…</p>;
  const actionLabel = homePrimaryActionLabel(home);

  return (
    <section aria-label="Today">
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
function HandheldMore() {
  return (
    <section aria-label="More">
      <ul className="fo-list">
        {MORE_ITEMS.map((i) => (
          <li key={i.key}>{i.label}</li>
        ))}
      </ul>
      <p className="fo-muted">
        Desktop EOS remains available separately for anything not on this list.
      </p>
    </section>
  );
}
