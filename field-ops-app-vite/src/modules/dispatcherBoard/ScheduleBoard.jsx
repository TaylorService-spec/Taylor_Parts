import { memo } from "react";

function formatWindow(workOrder) {
  if (!workOrder.scheduledStart?.toDate || !workOrder.scheduledEnd?.toDate) return "Scheduled time not set";
  return `${workOrder.scheduledStart.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${workOrder.scheduledEnd.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

// Scheduler is intentionally read-first: current persistence supports schedule
// windows, but does not provide an estimated-duration field or a separate
// non-work-time record. Those concepts must not be fabricated in the UI.
function ScheduleBoard({ technicians, workOrders, onSelect }) {
  const scheduled = workOrders.filter((wo) => wo.status === "SCHEDULED");

  return (
    <section className="disp-schedule" aria-labelledby="schedule-heading">
      <div className="disp-section-heading">
        <div>
          <p className="disp-eyebrow">Plan the day</p>
          <h3 id="schedule-heading">Technician schedule</h3>
        </div>
        <p>{scheduled.length} scheduled work order{scheduled.length === 1 ? "" : "s"}</p>
      </div>
      {technicians.length === 0 ? (
        <div className="disp-schedule-empty">Add technicians in Administration before scheduling work.</div>
      ) : (
        <div className="disp-schedule-grid">
          {technicians.map((tech) => {
            const assignments = scheduled.filter((wo) => (wo.scheduledTechId ?? wo.assignedTechId) === tech.id);
            return (
              <article className="disp-schedule-row" key={tech.id}>
                <header>
                  <strong>{tech.name}</strong>
                  <span className={`fo-badge fo-badge-${tech.status}`}>{tech.status === "on_job" ? "Busy" : tech.status === "off_shift" ? "Off shift" : "Available"}</span>
                </header>
                <div className="disp-schedule-slots">
                  {assignments.length ? assignments.map((wo) => (
                    <button
                      className="disp-schedule-card"
                      key={wo.id}
                      onClick={() => onSelect(wo.id)}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", wo.id);
                        event.dataTransfer.effectAllowed = "move";
                        onSelect(wo.id);
                      }}
                      type="button"
                    >
                      <span>{formatWindow(wo)}</span>
                      <strong>{wo.woNumber}</strong>
                      <small>{wo.customerId}</small>
                    </button>
                  )) : <span className="disp-schedule-open">Open capacity</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default memo(ScheduleBoard);
