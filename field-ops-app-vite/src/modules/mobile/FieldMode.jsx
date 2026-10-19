import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import WorkOrderAuthorityNotice from "../../shared/ui/WorkOrderAuthorityNotice.jsx";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { transitionWorkOrder } from "../../services/workOrderService";
import EquipmentInstallCloseout from "./EquipmentInstallCloseout";
import JobLabor from "./JobLabor";
import { activeFieldWorkOrders, awaitingDispatchWorkOrders, fieldPhase, FIELD_ACTIONS, FIELD_PHASE } from "../../domain/fieldWorkOrder";
import { formatTimestamp } from "../../domain/displayTimestamp.js";
import { withTruckStock } from "../../domain/fieldTruckReadiness.js";
import { useMyTruckStock } from "../../hooks/useMyTruckStock.js";
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

// `workOrderId` (TW1): open ONE specific job of the technician's own -- what a tapped card on the phone's Jobs tab does.
// It selects among the technician's OWN assigned Work Orders only (an id that is not theirs finds nothing), and every
// action, gate and tool below is the same governed surface the "My Day" view uses. It grants no authority.
export default function FieldMode({ deps, workOrderId = null } = {}) {
  // The technician PROFILE state only (loading / failed-with-retry). No id is taken from it: every id this screen needs --
  // the ownership check, the scanner, the offline queue -- is the governed Employee id the server returned
  // (`ownEmployeeId`) or the signed-in principal, never the Firestore-derived users.technicianId.
  const {
    loading: technicianLoading,
    error: technicianError,
    retry: retryTechnician,
  } = useCurrentTechnician();
  // The technician's own work: the governed listMyAssignedWorkOrders read. The SERVER resolves this login
  // to an EOS Employee; `ownEmployeeId` is that answer (the id every row's assignedTechId carries), so the
  // next-action ownership check compares the server's answer with itself -- never a fieldops technician id.
  const {
    data: workOrders, loading: workOrdersLoading, error, employeeId: ownEmployeeId, unlinked, notActivated,
  } = useAssignedWorkOrders();
  const loading = technicianLoading || workOrdersLoading;
  // "Not set up for field work" is now the governed answer: this login resolves to no Employee.
  const unmapped = !workOrdersLoading && unlinked;

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
    disabled: !!provided, ...(deps?.offline ?? {}),
  });
  const offline = provided ?? own;

  const selected = useMemo(
    () => (workOrderId ? (workOrders ?? []).find((w) => w.id === workOrderId) ?? null : null),
    [workOrders, workOrderId],
  );
  const active = useMemo(
    () => (workOrderId ? (selected ? [selected] : []) : activeFieldWorkOrders(workOrders)),
    [workOrders, workOrderId, selected],
  );
  const [current, ...upNext] = active;
  // TW3: assigned-but-not-dispatched work, so "nothing dispatched" is never said as "nothing assigned".
  const awaitingDispatch = useMemo(() => awaitingDispatchWorkOrders(workOrders), [workOrders]);

  // TW4: the technician's own truck stock, folded into the shared readiness projection as its `truck` dimension.
  // Re-read when this job's recorded quantities move: recording usage consumes the truck's stock.
  const usedKey = (current?.inventorySnapshot ?? []).map((p) => `${p.partId ?? p.sku}:${p.qtyUsed ?? 0}`).join("|");
  const truckStock = useMyTruckStock({ refreshKey: usedKey, ...(deps?.truckStock ?? {}) });
  const plannedParts = useMemo(
    () => withTruckStock(current?.inventorySnapshot ?? [], truckStock),
    [current, truckStock],
  );

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
      technicianId: ownEmployeeId,
      plannedParts,
      // The truck dimension is on only when the stock was actually READ; otherwise the projection stays honest (UNKNOWN).
      capabilities: truckStock.known ? { truckInventory: true } : {},
      customerResolver,
      siteResolver,
      contextPending: contextLoading,
    });
  }, [current, ownEmployeeId, plannedParts, truckStock.known, fieldContext, contextDenied, contextLoading]);

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

  if (notActivated) {
    return (
      <div className="fo-field">
        <WorkOrderAuthorityNotice notActivated />
      </div>
    );
  }

  // The fieldops technician profile is no longer what selects the day's work, but a failed read of it is
  // still said, with Retry -- fail closed, never an endless spinner.
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
          Your account isn’t linked to an Employee record yet, so no work can be assigned to you. Ask an
          admin to link your login to your Employee record before using Field Mode.
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
        <h2 className="fo-field__title">{workOrderId ? "Job" : "My Day"}</h2>
        {!workOrderId && (
          <p className="fo-field__count">
            {active.length > 0
              ? (active.length === 1 ? "1 job" : `${active.length} jobs`)
              : awaitingDispatch.length > 0 ? "Nothing dispatched" : "Nothing assigned"}
          </p>
        )}
      </header>

      {active.length === 0 ? (
        workOrderId ? (
          <p className="fo-muted">This job is no longer on your list.</p>
        ) : awaitingDispatch.length > 0 ? (
          <AwaitingDispatch workOrders={awaitingDispatch} />
        ) : (
          <p className="fo-muted">No assigned work orders.</p>
        )
      ) : (
        <CurrentJob
          workOrder={current ?? null}
          job={job}
          inventoryState={contextDenied ? null : fieldContext?.inventory?.state ?? null}
          truckKnown={truckStock.known}
          awaitingDispatch={fieldPhase(current) === FIELD_PHASE.AWAITING_DISPATCH}
          pending={pending.id === job.workOrderId ? pending.action : null}
          failure={failure?.id === job.workOrderId ? failure : null}
          onAdvance={advance}
          offline={offline}
          deps={deps}
        />
      )}

      {upNext.length > 0 && (
        <section className="fo-field__section" aria-labelledby="fo-upnext">
          <h3 id="fo-upnext" className="fo-field__section-title">Up Next</h3>
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
        {scannerOpen && <PartsScanner />}
      </section>
    </div>
  );
}

/** Context -> State -> Attention -> Readiness -> Next Best Action, in that order. */
function CurrentJob({ job, workOrder, inventoryState = null, truckKnown = false, awaitingDispatch = false, pending, failure, onAdvance, offline, deps }) {
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
      <Readiness readiness={job.readiness} inventoryState={inventoryState} truckKnown={truckKnown} />
      <NextAction job={job} pending={pending} failure={failure} onAdvance={onAdvance} awaitingDispatch={awaitingDispatch} />

      <div className="fo-job__tools">
        <Button
          type="button"
          variant="secondary"
          className="fo-job__tool"
          onClick={() => toggle("scan")}
          aria-expanded={tool === "scan"}
        >
          Scan a Part
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="fo-job__tool"
          onClick={() => toggle("note")}
          aria-expanded={tool === "note"}
        >
          Add a Note
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
        <PartsScanner workOrderId={job.workOrderId} />
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
function Readiness({ readiness, inventoryState = null, truckKnown = false }) {
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
      {/* The governed field context states the Inventory boundary; it is said out loud rather than shown as a
          stock figure nobody read. */}
      {inventoryState === "NOT_YET_ACTIVATED" && (
        // TW4: the technician's own truck IS read now (readTruckStock); only warehouse stock is not checked here.
        <p className="fo-muted" role="note">
          {truckKnown
            ? "Inventory readiness is not activated yet — warehouse stock is not checked. This shows the stock on your truck."
            : "Inventory readiness is not activated yet — stock on hand is not checked."}
        </p>
      )}
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
              {/* TW4: planned vs what is physically on the technician's own truck, only when that stock was read. */}
              {row.dimensions?.truck?.status === "KNOWN" && (
                <span className="fo-readiness-row__truck fo-muted">
                  Planned {row.qtyPlanned} · On your truck {row.dimensions.truck.onTruck}
                  {row.dimensions.truck.onTruck < Math.max(0, row.qtyPlanned - row.qtyUsed) ? " · not enough" : ""}
                </span>
              )}
              <span className="fo-readiness-row__state">{row.readiness}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "What should I do next?" — governed, or an honest nothing. */
function NextAction({ job, pending, failure, onAdvance, awaitingDispatch = false }) {
  const next = job.nextAction;
  if (!next) {
    // TW3: a SCHEDULED job is the technician's, but dispatch has not released it -- say that, not "nothing available".
    if (awaitingDispatch) {
      return <p className="fo-muted fo-job__next-empty">Scheduled, not yet dispatched. You can start it once dispatch sends it to you.</p>;
    }
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

/**
 * TW3 -- the technician's jobs that are assigned but not yet dispatched. "My Day" lists only released work, so without this a
 * technician whose jobs are all SCHEDULED read "No assigned work orders" -- which is false.
 */
function AwaitingDispatch({ workOrders }) {
  const n = workOrders.length;
  return (
    <section className="fo-field__section" aria-label="Scheduled, not yet dispatched">
      <p className="fo-muted">
        {n === 1 ? "1 scheduled job, not yet dispatched" : `${n} scheduled jobs, not yet dispatched`}. They appear here to start once dispatch sends them to you.
      </p>
      <ul className="fo-upnext">
        {workOrders.map((wo) => (
          <li key={wo.id} className="fo-upnext__row">
            <span className="fo-upnext__ref">{wo.woNumber ?? wo.id}</span>
            <span className="fo-upnext__complaint">{formatTimestamp(wo.scheduledStart, { unknown: "time not set" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
