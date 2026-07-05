import { useState } from "react";
import { getAllowedActions } from "../../domain/workOrderWorkflow";

// Epic 2 Phase 2C -- right pane, drop targets for drag-and-drop
// dispatch. Ranking display only -- onDropTechnician (passed down from
// DispatcherBoard.jsx) is the only place a drop actually calls
// transitionWorkOrder(); this component never writes anything itself.
//
// A column only accepts a drop when the selected Work Order's status
// actually allows the "Dispatch" action (i.e. SCHEDULED, per the real
// transition table) -- dragging over a non-droppable column shows no
// visual invitation to drop, so the UI never implies an action the
// backend would reject.
export default function TechnicianBoard({ technicians, selectedWorkOrder, recommendations, onDropTechnician }) {
  const [dragOverTechId, setDragOverTechId] = useState(null);

  const canDispatch = selectedWorkOrder
    ? getAllowedActions(selectedWorkOrder.status, "dispatcher", false).includes("Dispatch")
    : false;

  const scoreFor = (techId) => recommendations.find((r) => r.techId === techId);
  const top3Ids = new Set(recommendations.slice(0, 3).map((r) => r.techId));
  const topId = recommendations[0]?.techId;

  function handleDragOver(e, techId) {
    if (!canDispatch) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTechId(techId);
  }

  function handleDrop(e, techId) {
    e.preventDefault();
    setDragOverTechId(null);
    if (!canDispatch || !selectedWorkOrder) return;
    const draggedWorkOrderId = e.dataTransfer.getData("text/plain");
    if (draggedWorkOrderId !== selectedWorkOrder.id) return; // only the selected/previewed WO is a valid drag source here
    onDropTechnician(selectedWorkOrder, techId);
  }

  return (
    <div className="disp-pane disp-pane--techs">
      <h3>Technicians</h3>
      {!selectedWorkOrder && <p className="fo-muted">Select a Work Order to see rankings and enable drop targets.</p>}
      {selectedWorkOrder && !canDispatch && (
        <p className="fo-muted">
          {selectedWorkOrder.woNumber} is {selectedWorkOrder.status} -- only SCHEDULED work orders can be dispatched by drag-and-drop.
        </p>
      )}
      {technicians.map((tech) => {
        const rec = scoreFor(tech.id);
        const isTop = tech.id === topId;
        const isTop3 = top3Ids.has(tech.id);
        return (
          <div
            key={tech.id}
            className={`disp-tech-column${isTop3 ? " disp-tech-column--top3" : ""}${
              dragOverTechId === tech.id && canDispatch ? " disp-tech-column--dragover" : ""
            }`}
            onDragOver={(e) => handleDragOver(e, tech.id)}
            onDragLeave={() => setDragOverTechId(null)}
            onDrop={(e) => handleDrop(e, tech.id)}
          >
            <div className="disp-tech-column-header">
              <span>{tech.name}</span>
              <span className={`fo-badge fo-badge-${tech.status}`}>{tech.status}</span>
            </div>
            {rec && (
              <div className="fo-muted">
                Score: {rec.score}%{isTop && " (Recommended)"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
