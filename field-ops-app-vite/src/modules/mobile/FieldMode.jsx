import { useEffect, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedJobs } from "../../hooks/useAssignedJobs";
import { updateJobStatus } from "../../domain/jobActions";
import { JOB_STATUS } from "../../domain/constants";
import { TRUSTED_COMPLETION_ENABLED } from "../../config/trustedCompletion";
import {
  completeAssignedJobViaCallable,
  reconcilePendingCompletion,
} from "../../services/completionService";
import { useInventory } from "../../demo/InventoryContext";
import { isHeroActiveJob, HERO_JOB_PARTS_REQUIRED } from "../../demo/heroConfig";

// Sprint 3.6.3: mobile-first visual upgrade + demo interaction layer.
// "Start Travel"/"Arrived" are purely local UI state (travelStage below),
// never written to Firestore and never part of JOB_STATUS -- they exist
// only to make the demo flow feel complete before a job is actually
// started. "Use Part" reads/writes demo/InventoryContext.jsx's in-memory
// truck stock -- no Firestore write, no change to the job document.
//
// F-RULES-1 PR-B: job COMPLETION now routes through the trusted
// completeAssignedJob callable (services/completionService.js) when
// TRUSTED_COMPLETION_ENABLED -- one request of exactly { jobId,
// idempotencyKey }, identity resolved server-side, technician-availability
// and audit written atomically by the Function, duplicate taps blocked,
// the same idempotency key retained across retries of one attempt.
// Until Owner Gate D1 deploys the callable, production builds keep the
// pre-existing client transaction (updateJobStatus(COMPLETE), still
// permitted by the interim Firestore Rules) -- see config/
// trustedCompletion.js for the release-gate rationale. Start-work
// (assigned -> in_progress) deliberately stays the direct client write
// approved by Decision #39 / O-3.

const TRAVEL_STAGE = {
  NOT_STARTED: "not_started",
  TRAVELING: "traveling",
  ARRIVED: "arrived",
};

export default function FieldMode() {
  // Read-scoping: Field Mode reads ONLY the caller's own jobs, via a query
  // constrained to their mapped technicianId (useCurrentTechnician's first
  // hop) -- never a full-collection read. An unmapped user gets no jobs and a
  // clear prompt (fail closed), which also matches the scoped read rule.
  const { technicianId, loading: technicianLoading } = useCurrentTechnician();
  const { data: jobs, loading: jobsLoading } = useAssignedJobs(technicianId);
  const loading = technicianLoading || jobsLoading;
  const unmapped = !technicianLoading && !technicianId;
  const { parts, truckStock, usedPartsByJob, consumePart } = useInventory();
  const [travelStageByJob, setTravelStageByJob] = useState({});

  // Hero-story follow-up: the hero job (demo/heroConfig.js), if present
  // among today's assigned jobs, is sorted to the front so it's always
  // the auto-opened "Active Job" -- pure display ordering, no data
  // mutation. Falls back to whatever's first when no hero job matches.
  const assignedJobs = jobs
    .filter((j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS)
    .sort((a, b) => (isHeroActiveJob(b.customer) ? 1 : 0) - (isHeroActiveJob(a.customer) ? 1 : 0));

  const [activeJob, ...upNext] = assignedJobs;

  // Trusted-completion UI state: idle | pending | error. `jobId` tracks
  // which job the attempt belongs to so the reconciliation effect below can
  // resolve it against authoritative snapshot data.
  const [completion, setCompletion] = useState({ phase: "idle", jobId: null, message: null, canRetry: false });

  async function updateStatus(job, status) {
    try {
      await updateJobStatus(job, status);
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  async function completeJob(job) {
    if (!TRUSTED_COMPLETION_ENABLED) {
      // Pre-D1 posture: the pre-existing client transaction, unchanged.
      return updateStatus(job, JOB_STATUS.COMPLETE);
    }
    if (completion.phase === "pending") return; // duplicate-tap guard
    setCompletion({ phase: "pending", jobId: job.id, message: null, canRetry: false });
    const outcome = await completeAssignedJobViaCallable(job.id);
    if (outcome.ok) {
      // Success (including idempotent replay): the authoritative onSnapshot
      // listener moves the job out of the active slot -- no local fabrication
      // of the completed job document.
      setCompletion({ phase: "idle", jobId: null, message: null, canRetry: false });
      return;
    }
    setCompletion({
      phase: "error",
      jobId: job.id,
      message: outcome.message,
      // Only an UNRESOLVED attempt (transient/ambiguous outcome, or an auth
      // recovery) retries with the same retained key; authoritative
      // rejections rely on the snapshot refresh below instead.
      canRetry: outcome.kind === "transient" || outcome.kind === "auth",
    });
  }

  // Ambiguous-result reconciliation: whenever authoritative job data shows
  // the tracked attempt's job as complete (the server committed even though
  // the client saw a transport failure / refreshed mid-submit), resolve the
  // attempt as success and release its idempotency key. A job that
  // disappeared entirely resolves as halt (key released, state cleared).
  useEffect(() => {
    if (!TRUSTED_COMPLETION_ENABLED) return;
    if (!completion.jobId || completion.phase === "pending") return;
    const live = jobs.find((j) => j.id === completion.jobId);
    if (!live) {
      reconcilePendingCompletion(completion.jobId, "missing");
      setCompletion({ phase: "idle", jobId: null, message: null, canRetry: false });
      return;
    }
    if (live.status === JOB_STATUS.COMPLETE) {
      reconcilePendingCompletion(completion.jobId, live.status);
      setCompletion({ phase: "idle", jobId: null, message: null, canRetry: false });
    }
  }, [jobs, completion.jobId, completion.phase]);

  function travelStageFor(jobId) {
    return travelStageByJob[jobId] ?? TRAVEL_STAGE.NOT_STARTED;
  }

  function setTravelStage(jobId, stage) {
    setTravelStageByJob((prev) => ({ ...prev, [jobId]: stage }));
  }

  return (
    <div className="fo-panel">
      <h2>Field Mode</h2>

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : unmapped ? (
        <p className="fo-muted">
          Your account isn’t linked to a technician profile yet. Ask a
          dispatcher to link your account before using Field Mode.
        </p>
      ) : assignedJobs.length === 0 ? (
        <p className="fo-muted">No assigned work orders</p>
      ) : (
        <>
          <div className="fo-card fo-card--field fo-card--field-active">
            <div className="fo-muted">Active Job</div>
            <h3>
              {activeJob.customer}
              {isHeroActiveJob(activeJob.customer) && (
                <span className="fo-chip fo-chip-hero">Active Demo Job</span>
              )}
            </h3>
            <p>{activeJob.description}</p>

            {isHeroActiveJob(activeJob.customer) && (
              <div className="fo-muted" style={{ marginBottom: 8 }}>
                Parts required: {HERO_JOB_PARTS_REQUIRED.join(", ")}
              </div>
            )}

            <ActiveJobActions
              job={activeJob}
              travelStage={travelStageFor(activeJob.id)}
              onTravelStageChange={(stage) => setTravelStage(activeJob.id, stage)}
              onUpdateStatus={updateStatus}
              onComplete={completeJob}
              completion={completion.jobId === activeJob.id ? completion : null}
              parts={parts}
              truckStock={truckStock}
              usedParts={usedPartsByJob[activeJob.id] ?? []}
              onUsePart={(partId) => consumePart(activeJob.id, partId)}
            />
          </div>

          {upNext.length > 0 && (
            <div className="fo-card">
              <h3>Up Next</h3>
              {upNext.map((job) => (
                <div key={job.id} className="fo-upnext-row">
                  {job.customer} — {job.description}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActiveJobActions({
  job,
  travelStage,
  onTravelStageChange,
  onUpdateStatus,
  onComplete,
  completion,
  parts,
  truckStock,
  usedParts,
  onUsePart,
}) {
  const [showPartPicker, setShowPartPicker] = useState(false);

  if (job.status === JOB_STATUS.ASSIGNED) {
    if (travelStage === TRAVEL_STAGE.NOT_STARTED) {
      return (
        <button className="fo-btn-large" onClick={() => onTravelStageChange(TRAVEL_STAGE.TRAVELING)}>
          Start Travel
        </button>
      );
    }
    if (travelStage === TRAVEL_STAGE.TRAVELING) {
      return (
        <button className="fo-btn-large" onClick={() => onTravelStageChange(TRAVEL_STAGE.ARRIVED)}>
          Arrived
        </button>
      );
    }
    // ARRIVED
    return (
      <button className="fo-btn-large" onClick={() => onUpdateStatus(job, JOB_STATUS.IN_PROGRESS)}>
        Start Work
      </button>
    );
  }

  // IN_PROGRESS
  const completing = completion?.phase === "pending";
  const completionError = completion?.phase === "error" ? completion : null;
  return (
    <div>
      <div className="fo-btn-row">
        <button className="fo-btn-large fo-btn-secondary" onClick={() => setShowPartPicker((v) => !v)}>
          Use Part
        </button>
        <button
          className="fo-btn-large"
          onClick={() => onComplete(job)}
          disabled={completing}
          aria-busy={completing}
        >
          {completing ? "Completing…" : "Complete Job"}
        </button>
      </div>

      {completionError && (
        <div role="alert" className="fo-muted" style={{ marginTop: 8 }}>
          {completionError.message}
          {completionError.canRetry && (
            <div style={{ marginTop: 8 }}>
              {/* Retry re-submits the SAME pending attempt: the retained
                  idempotency key makes the server replay, never duplicate. */}
              <button className="fo-btn-large fo-btn-secondary" onClick={() => onComplete(job)}>
                Retry completion
              </button>
            </div>
          )}
        </div>
      )}

      {showPartPicker && (
        <div className="fo-part-picker">
          {parts.map((part) => (
            <button
              key={part.id}
              className="fo-part-picker-row"
              disabled={(truckStock[part.id] ?? 0) <= 0}
              onClick={() => onUsePart(part.id)}
            >
              {part.name} ({truckStock[part.id] ?? 0} on truck)
            </button>
          ))}
        </div>
      )}

      {usedParts.length > 0 && (
        <div className="fo-muted" style={{ marginTop: 8 }}>
          Parts used:{" "}
          {usedParts
            .map((u) => parts.find((p) => p.id === u.partId)?.name ?? u.partId)
            .join(", ")}
        </div>
      )}
    </div>
  );
}
