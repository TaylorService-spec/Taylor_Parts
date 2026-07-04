import { useState } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { updateJobStatus } from "../../domain/jobActions";
import { JOBS_COLLECTION, JOB_STATUS } from "../../domain/constants";
import { useInventory } from "../../demo/InventoryContext";

// Sprint 3.6.3: mobile-first visual upgrade + demo interaction layer.
// The only real state transitions are still updateJobStatus(IN_PROGRESS)
// and updateJobStatus(COMPLETE) -- exactly what this screen already did.
// "Start Travel"/"Arrived" are purely local UI state (travelStage below),
// never written to Firestore and never part of JOB_STATUS -- they exist
// only to make the demo flow feel complete before a job is actually
// started. "Use Part" reads/writes demo/InventoryContext.jsx's in-memory
// truck stock -- no Firestore write, no change to the job document.

const TRAVEL_STAGE = {
  NOT_STARTED: "not_started",
  TRAVELING: "traveling",
  ARRIVED: "arrived",
};

export default function FieldMode() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
  const { parts, truckStock, usedPartsByJob, consumePart } = useInventory();
  const [travelStageByJob, setTravelStageByJob] = useState({});

  const assignedJobs = jobs.filter(
    (j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS
  );

  const [activeJob, ...upNext] = assignedJobs;

  async function updateStatus(job, status) {
    try {
      await updateJobStatus(job, status);
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

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
      ) : assignedJobs.length === 0 ? (
        <p className="fo-muted">No assigned work orders</p>
      ) : (
        <>
          <div className="fo-card fo-card--field fo-card--field-active">
            <div className="fo-muted">Active Job</div>
            <h3>{activeJob.customer}</h3>
            <p>{activeJob.description}</p>

            <ActiveJobActions
              job={activeJob}
              travelStage={travelStageFor(activeJob.id)}
              onTravelStageChange={(stage) => setTravelStage(activeJob.id, stage)}
              onUpdateStatus={updateStatus}
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
  return (
    <div>
      <div className="fo-btn-row">
        <button className="fo-btn-large fo-btn-secondary" onClick={() => setShowPartPicker((v) => !v)}>
          Use Part
        </button>
        <button className="fo-btn-large" onClick={() => onUpdateStatus(job, JOB_STATUS.COMPLETE)}>
          Complete Job
        </button>
      </div>

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
