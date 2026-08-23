import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { transitionWorkOrder } from "../../services/workOrderService";
import EquipmentInstallCloseout from "./EquipmentInstallCloseout";
import JobLabor from "./JobLabor";
import { activeFieldWorkOrders, FIELD_ACTIONS } from "../../domain/fieldWorkOrder";
import { buildCurrentJob, CUSTOMER_IDENTITY } from "../../domain/fieldCurrentJob";
import { useWorkOrderFieldContext } from "../../hooks/useWorkOrderFieldContext";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import PartsScanner from "./PartsScanner";
import JobNote from "./JobNote.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import SyncIndicator from "../../shared/ui/SyncIndicator.jsx";
import { useOfflineRuntime } from "../../hooks/useOfflineRuntime";
import { useProvidedOfflineRuntime } from "../../offline/OfflineRuntimeContext.jsx";
import { captureComplete } from "../../offline/technicianIntentCapture.js";
import { connectivityHint } from "../../offline/syncExecutor.js";

// THE SYNC QUEUE IS LAZY; THE INDICATOR IS NOT.
//
// A technician only opens the queue when something needs looking at, so its chunk is deferred. The
// INDICATOR is eager and deliberately so: the one state that must never exist is unsynced work with
// nothing on screen saying so, and a chunk that has not downloaded cannot say anything.
const SyncQueue = lazy(() => import("./SyncQueue.jsx"));

// F1 -- Field shell + Technician Home + Current Job.
//
// An OPERATING surface, not a record-detail screen. It follows the platform
// rhythm deliberately, top to bottom:
//
//   Context -> State -> Attention -> Readiness -> Next Best Action
//
// Everything shown derives from governed authority established in F0
// (fieldops_wos + transitionWorkOrder) and from the SHARED WO Parts Readiness
// projection. This module re-derives nothing: it owns no readiness vocabulary,
// no availability arithmetic and no lifecycle rules of its own.
//
// CUSTOMER / SITE IDENTITY resolves through the TRUSTED minimal projection
// getWorkOrderFieldContext (Owner Option 1). firestore.rules still gates
// accounts / locations / equipment to isAdminOrDispatcher() and the technician
// Role still holds no customer.record.read -- neither was widened. The server
// verifies the Work Order is assigned to THIS technician, takes customerId /
// locationId FROM the governed Work Order (never from the client), and returns
// only display fields.
//
// The four identity states are preserved exactly, and the existing injected
// resolver seam expresses them without restructuring: a DENIAL passes no
// resolver, which the composition already reports as NOT_AUTHORIZED, so a
// denial can never render as "no customer". See
// docs/assessments/f1-technician-customer-identity.md.

export default function FieldMode({ deps } = {}) {
  const {
    technicianId,
    loading: technicianLoading,
    error: technicianError,
    retry: retryTechnician,
  } = useCurrentTechnician();
  const { data: workOrders, loading: workOrdersLoading, error } = useAssignedWorkOrders(technicianId);
  const loading = technicianLoading || workOrdersLoading;
  const unmapped = !technicianLoading && !technicianError && !technicianId;

  const [pending, setPending] = useState({ id: null, action: null });
  const [failure, setFailure] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  // The offline runtime. Loaded for the signed-in principal and for nobody else -- the queue follows
  // the person, not the device.
  //
  // PROVIDED FROM ABOVE WHEN THERE IS AN ABOVE. Inside TechnicianShell the shell owns the queue, and
  // opening a second one here would give two writers the same storage key. Standing alone -- which is
  // how FieldMode renders at desktop widths -- it owns its own.
  const provided = useProvidedOfflineRuntime();
  const own = useOfflineRuntime({
    disabled: !!provided, technicianId: () => technicianId, ...(deps?.offline ?? {}),
  });
  const offline = provided ?? own;

  const active = useMemo(() => activeFieldWorkOrders(workOrders), [workOrders]);
  const [current, ...upNext] = active;

  const { context: fieldContext, denied: contextDenied, loading: contextLoading } =
    useWorkOrderFieldContext(current?.id ?? null);

  // A denial passes NO resolver, which the composition already reports as
  // NOT_AUTHORIZED -- that is why a denial can never be mistaken for absence.
  // An allowed-but-unusable canonical value returns null from the resolver,
  // which the composition reports as UNRESOLVED. The raw id is never returned
  // as a fallback by either side.
  const job = useMemo(() => {
    const authorized = !contextDenied && !!fieldContext;
    const customerResolver = authorized
      ? () => (fieldContext.customer?.state === "RESOLVED" ? fieldContext.customer.displayName : null)
      : null;
    const siteResolver = authorized
      ? () => (fieldContext.site?.state === "RESOLVED" ? fieldContext.site.displayLabel : null)
      : null;
    return buildCurrentJob({
      workOrder: current ?? null,
      technicianId,
      plannedParts: current?.inventorySnapshot ?? [],
      customerResolver,
      siteResolver,
      contextPending: contextLoading,
    });
  }, [current, technicianId, fieldContext, contextDenied, contextLoading]);

  const advance = useCallback(async (workOrderId, action) => {
    if (pending.id) return; // duplicate-tap guard
    setPending({ id: workOrderId, action });
    setFailure(null);

    // ONLY "Complete" IS QUEUEABLE, and deliberately so. The earlier lifecycle actions -- Accept, En
    // route, Arrived -- are a technician telling dispatch where they are RIGHT NOW, and a position
    // report that arrives four hours late is worse than one that never arrived: dispatch would route
    // around a technician who has long since left. Completion is a durable business fact about work
    // that was actually done, and it keeps its meaning whenever it lands.
    if (action === "Complete" && offline?.enqueue
        && connectivityHint(typeof navigator === "undefined" ? null : navigator).likelyOnline === false) {
      const intent = captureComplete({
        workOrderId, principalUid: offline.principalUid ?? "self",
        // Derived from the live queue: anything already captured for this job -- notes, time, parts --
        // must be sequenced ahead of completion, because their commands refuse a work order that has
        // left execution.
        queue: offline.queue, captureKey: `complete:${workOrderId}`, at: Date.now(), offline: true,
      });
      if (intent.valid) {
        const stored = await offline.enqueue(intent);
        setFailure(stored.durable
          ? null
          : { id: workOrderId, message: "This phone could not save the completion offline. Stay on this screen until you have signal." });
      }
      setPending({ id: null, action: null });
      return;
    }

    try {
      await transitionWorkOrder(workOrderId, action);
      // The authoritative listener moves the Work Order. Nothing is fabricated here.
    } catch (err) {
      // site-work r3 L: previously surfaced err?.message verbatim, leaking raw
      // Firebase/Functions codes. Route through the same safe-copy helper
      // TechnicianWorkOrderActions.jsx uses for this identical
      // transitionWorkOrder() failure shape.
      setFailure({
        id: workOrderId,
        message: workflowActionErrorMessage(err),
      });
    } finally {
      setPending({ id: null, action: null });
    }
  }, [pending.id, offline]);

  if (loading) return <div className="fo-field"><p className="fo-muted">Loading your day…</p></div>;

  if (technicianError) {
    return (
      <div className="fo-field">
        <p className="fo-muted" role="alert">
          Your technician profile could not be loaded. {technicianError}
        </p>
        <Button variant="secondary" onClick={retryTechnician}>Retry</Button>
      </div>
    );
  }

  if (unmapped) {
    return (
      <div className="fo-field">
        <p className="fo-muted">
          Your account isn’t linked to a technician profile yet. Ask a dispatcher
          to link your account before using Field Mode.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fo-field">
        <p className="fo-muted" role="alert">Your work orders could not be loaded. {error}</p>
      </div>
    );
  }

  return (
    <div className="fo-field">
      {/* UNSYNCED WORK IS NEVER SILENT. Above the day, before anything else, every time.
          Suppressed when a shell above is already showing it -- one banner, not two stacked saying
          the same thing on a 320px screen. */}
      {!provided ? (
      <SyncIndicator
        indicator={offline.indicator}
        syncing={offline.syncing}
        onOpen={() => setSyncOpen(true)}
        onSync={() => offline.sync(true)}
      />
      ) : null}

      {syncOpen ? (
        <Suspense fallback={<p className="fo-muted" role="status">Opening sync…</p>}>
          <SyncQueue runtime={offline} onClose={() => setSyncOpen(false)} />
        </Suspense>
      ) : null}

      <header className="fo-field__head">
        <h2 className="fo-field__title">My Day</h2>
        <p className="fo-field__count">
          {active.length === 0
            ? "Nothing assigned"
            : active.length === 1
              ? "1 job"
              : `${active.length} jobs`}
        </p>
      </header>

      {active.length === 0 ? (
        <p className="fo-muted">No assigned work orders.</p>
      ) : (
        <CurrentJob
          workOrder={current ?? null}
          job={job}
          pending={pending.id === job.workOrderId ? pending.action : null}
          failure={failure?.id === job.workOrderId ? failure : null}
          onAdvance={advance}
          technicianId={technicianId}
          offline={offline}
          deps={deps}
        />
      )}

      {upNext.length > 0 && (
        <section className="fo-field__section" aria-labelledby="fo-upnext">
          <h3 id="fo-upnext" className="fo-field__section-title">Up next</h3>
          <ul className="fo-upnext">
            {upNext.map((wo) => (
              <li key={wo.id} className="fo-upnext__row">
                <span className="fo-upnext__ref">{wo.woNumber ?? wo.id}</span>
                {wo.complaint && <span className="fo-upnext__complaint">{wo.complaint}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="fo-field__section">
        <Button
          variant="secondary"
          className="fo-field__tool-toggle"
          onClick={() => setScannerOpen((open) => !open)}
          aria-expanded={scannerOpen}
        >
          Parts Scanner <span aria-hidden="true">{scannerOpen ? "▲" : "▼"}</span>
        </Button>
        {scannerOpen && <PartsScanner technicianId={technicianId} />}
      </section>
    </div>
  );
}

/** Context -> State -> Attention -> Readiness -> Next Best Action, in that order. */
function CurrentJob({ job, workOrder, pending, failure, onAdvance, technicianId, offline, deps }) {
  // Scanning and note-taking are opened FROM the job, so both inherit its context. Collapsed by
  // default: the job's own answer -- where am I, what is wrong, what next -- must not be pushed off
  // the top of a phone by tools nobody has asked for yet.
  const [tool, setTool] = useState(null);
  if (!job) return null;
  const toggle = (which) => setTool((open) => (open === which ? null : which));

  return (
    <article className="fo-job" aria-label="Current job">
      <CustomerContext context={job.context} reference={job.reference} />
      <JobState state={job.state} />
      <Attention items={job.attention} />
      <Readiness readiness={job.readiness} />
      <NextAction job={job} pending={pending} failure={failure} onAdvance={onAdvance} />

      <div className="fo-job__tools">
        <Button
          type="button"
          variant="secondary"
          className="fo-job__tool"
          onClick={() => toggle("scan")}
          aria-expanded={tool === "scan"}
        >
          Scan a part
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="fo-job__tool"
          onClick={() => toggle("note")}
          aria-expanded={tool === "note"}
        >
          Add a note
        </Button>
        {/* SAME CLASS AS ITS TWO SIBLINGS. Without it this rendered at 31px beside two 52px controls
            in the same row -- measured on a real phone once the shell was actually mounted. */}
        <Button
          variant="secondary" className="fo-job__tool"
          onClick={() => toggle("labor")} aria-pressed={tool === "labor"}
        >
          Time
        </Button>
      </div>

      {/* THE WORK ORDER IS PASSED DOWN, never re-picked. The technician opened this from a specific
          job and the screen already knows which one. */}
      {tool === "scan" && (
        <PartsScanner technicianId={technicianId} workOrderId={job.workOrderId} />
      )}
      {/* THE OFFLINE RUNTIME IS PASSED DOWN, never re-created. One queue per technician, per device --
          a second runtime inside a tool would be a second queue nobody is watching. */}
      {tool === "note" && <JobNote workOrderId={job.workOrderId} offline={offline} deps={deps?.note} />}
      {/* TIME, on every job -- not only installations. The work order is passed down and never
          re-picked, and the technician is the authenticated session, so the form asks for the two
          things the platform genuinely does not know: how long, and what kind. */}
      {tool === "labor" && <JobLabor workOrderId={job.workOrderId} offline={offline} deps={deps?.labor} />}

      {/* INSTALLATION CLOSEOUT, and only on a job that is actually an installation.
          The gate is the canonical WorkOrderType and NOTHING ELSE. Live data contains work orders
          typed "SERVICE" (not a member of the type union) and work orders with no type at all, and
          reading either as an installation would put a machine at a customer on a job nobody
          classified -- so this compares against INSTALL exactly.

          NO STATUS CHECK HERE, DELIBERATELY. An earlier version also required WORK_IN_PROGRESS, and
          this file's own guard rejected it: FieldMode does not decide what a technician may do, the
          governed matrix does. That guard is right, and the check was redundant besides -- the scoped
          read refuses a work order that is not in progress and the section reports that refusal
          honestly. Type is a CLASSIFICATION of the job; status is a lifecycle decision, and only one
          of those belongs on this screen. */}
      {workOrder?.type === "INSTALL" && (
        <EquipmentInstallCloseout
          workOrderId={job.workOrderId}
          onCompleteWorkOrder={(id) => onAdvance(id, "Complete")}
          deps={deps?.install}
        />
      )}
    </article>
  );
}

/** "Where am I going? Who is the customer?" — answered honestly. */
function CustomerContext({ context, reference }) {
  const { customer, site, complaint, contextPending } = context;
  return (
    <header className="fo-job__context">
      <p className="fo-job__ref">{reference}</p>
      {customer.state === CUSTOMER_IDENTITY.RESOLVED ? (
        <h3 className="fo-job__customer">{customer.name}</h3>
      ) : contextPending ? (
        <p className="fo-job__customer fo-job__customer--unavailable">Loading customer…</p>
      ) : (
        // Never a fabricated label, never a raw id dressed as a name, and never
        // silently omitted -- the distinction between "you may not see this" and
        // "there is nothing here" is operationally meaningful.
        <p className="fo-job__customer fo-job__customer--unavailable">
          {customer.state === CUSTOMER_IDENTITY.ABSENT
            ? "No customer on record"
            : "Customer details unavailable to your role"}
        </p>
      )}
      {/* "Where am I going?" -- resolved with the same four states and the same
          honesty as the customer, never a raw locationId. */}
      {site.state === CUSTOMER_IDENTITY.RESOLVED ? (
        <p className="fo-job__site">{site.label}</p>
      ) : contextPending ? null : (
        <p className="fo-job__site fo-job__site--unavailable">
          {site.state === CUSTOMER_IDENTITY.ABSENT
            ? "No site on record"
            : "Site details unavailable to your role"}
        </p>
      )}
      {complaint && <p className="fo-job__complaint">{complaint}</p>}
    </header>
  );
}

/** "What is its governed state?" */
function JobState({ state }) {
  return (
    <section className="fo-job__state" aria-label="Job state">
      <ol className="fo-field-progress">
        {FIELD_ACTIONS.map((step, index) => {
          // fieldProgressStep returns how many states are BEHIND you, so the
          // state you are IN is index === step - 1. Marking index === step
          // current highlighted the NEXT state as though you were already in
          // it.
          const done = index < state.step - 1;
          const isCurrent = index === state.step - 1;
          return (
            <li
              key={step.action}
              className={`fo-field-progress__step${done ? " is-done" : ""}${isCurrent ? " is-current" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              {step.stateLabel}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "What requires my attention before I act?" */
function Attention({ items }) {
  if (!items.length) return null;
  return (
    <section className="fo-job__attention" aria-label="Needs attention">
      <ul>
        {items.map((item) => (
          <li key={item.key} className={`fo-attention fo-attention--${item.severity}`}>
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Are the necessary parts ready?" — the SHARED projection, presented for field use. */
function Readiness({ readiness }) {
  const { jobReadiness, counts, rows, plannedCount } = readiness;
  const label =
    jobReadiness === "NO_PLAN" ? "No parts planned"
      : jobReadiness === "READY" ? "Parts ready"
        : jobReadiness === "ATTENTION" ? "Parts need attention"
          : "Parts readiness unknown";

  return (
    <section className="fo-job__readiness" aria-label="Parts readiness">
      <p className={`fo-readiness fo-readiness--${String(jobReadiness).toLowerCase()}`}>
        {label}
        {plannedCount > 0 && (
          <span className="fo-readiness__counts">
            {" "}· {counts.READY} ready · {counts.ATTENTION} attention · {counts.UNKNOWN} unknown
          </span>
        )}
      </p>
      {rows.length > 0 && (
        <ul className="fo-readiness__rows">
          {rows.map((row) => (
            <li key={row.partId ?? row.sku} className={`fo-readiness-row fo-readiness-row--${String(row.readiness).toLowerCase()}`}>
              {/* A technician planning a run read only "PRT-1002 — UNKNOWN" here and had to
                  open the scanner and search the code to learn it meant "Water Inlet Valve".
                  The readiness projection already carries the name; show it, and keep the code
                  alongside since that is what is printed on the shelf and the box. If no name
                  resolved, the code stands alone rather than a placeholder pretending to be one. */}
              <span className="fo-readiness-row__part">
                {row.name ? (
                  <>
                    {row.name} <span className="fo-readiness-row__code">{row.partId ?? row.sku}</span>
                  </>
                ) : (
                  (row.partId ?? row.sku)
                )}
              </span>
              <span className="fo-readiness-row__state">{row.readiness}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "What should I do next?" — governed, or an honest nothing. */
function NextAction({ job, pending, failure, onAdvance }) {
  const next = job.nextAction;
  if (!next) {
    return (
      <p className="fo-muted fo-job__next-empty">
        No action is available to you on this work order right now.
      </p>
    );
  }
  const busy = pending === next.action;
  return (
    <div className="fo-job__next">
      <Button
        className="fo-btn-field"
        onClick={() => onAdvance(job.workOrderId, next.action)}
        disabled={!!pending}
        loading={busy}
      >
        {next.label}
      </Button>
      {failure && (
        <p role="alert" className="fo-job__failure">{failure.message}</p>
      )}
    </div>
  );
}
