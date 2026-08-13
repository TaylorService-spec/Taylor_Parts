import { useCallback, useMemo, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { transitionWorkOrder } from "../../services/workOrderService";
import { activeFieldWorkOrders, FIELD_ACTIONS } from "../../domain/fieldWorkOrder";
import { buildCurrentJob, CUSTOMER_IDENTITY } from "../../domain/fieldCurrentJob";
import { useWorkOrderFieldContext } from "../../hooks/useWorkOrderFieldContext";
import PartsScanner from "./PartsScanner";

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
// Role still holds no account.record.read -- neither was widened. The server
// verifies the Work Order is assigned to THIS technician, takes customerId /
// locationId FROM the governed Work Order (never from the client), and returns
// only display fields.
//
// The four identity states are preserved exactly, and the existing injected
// resolver seam expresses them without restructuring: a DENIAL passes no
// resolver, which the composition already reports as NOT_AUTHORIZED, so a
// denial can never render as "no customer". See
// docs/assessments/f1-technician-customer-identity.md.

export default function FieldMode() {
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
    try {
      await transitionWorkOrder(workOrderId, action);
      // The authoritative listener moves the Work Order. Nothing is fabricated here.
    } catch (err) {
      setFailure({
        id: workOrderId,
        message: err?.message || "That step could not be recorded. Try again.",
      });
    } finally {
      setPending({ id: null, action: null });
    }
  }, [pending.id]);

  if (loading) return <div className="fo-field"><p className="fo-muted">Loading your day…</p></div>;

  if (technicianError) {
    return (
      <div className="fo-field">
        <p className="fo-muted" role="alert">
          Your technician profile could not be loaded. {technicianError}
        </p>
        <button type="button" onClick={retryTechnician}>Retry</button>
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
        <p className="fo-muted" role="alert">Your work orders could not be loaded. {error.message}</p>
      </div>
    );
  }

  return (
    <div className="fo-field">
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
          job={job}
          pending={pending.id === job.workOrderId ? pending.action : null}
          failure={failure?.id === job.workOrderId ? failure : null}
          onAdvance={advance}
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
        <button
          type="button"
          className="fo-field__tool-toggle"
          onClick={() => setScannerOpen((open) => !open)}
          aria-expanded={scannerOpen}
        >
          Parts Scanner <span aria-hidden="true">{scannerOpen ? "▲" : "▼"}</span>
        </button>
        {scannerOpen && <PartsScanner technicianId={technicianId} />}
      </section>
    </div>
  );
}

/** Context -> State -> Attention -> Readiness -> Next Best Action, in that order. */
function CurrentJob({ job, pending, failure, onAdvance }) {
  if (!job) return null;
  return (
    <article className="fo-job" aria-label="Current job">
      <CustomerContext context={job.context} reference={job.reference} />
      <JobState state={job.state} />
      <Attention items={job.attention} />
      <Readiness readiness={job.readiness} />
      <NextAction job={job} pending={pending} failure={failure} onAdvance={onAdvance} />
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
      <button
        className="fo-btn-field"
        onClick={() => onAdvance(job.workOrderId, next.action)}
        disabled={!!pending}
        aria-busy={busy}
      >
        {busy ? "Recording…" : next.label}
      </button>
      {failure && (
        <p role="alert" className="fo-job__failure">{failure.message}</p>
      )}
    </div>
  );
}
