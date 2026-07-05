import { memo, useEffect, useState } from "react";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import TechnicianCapacityCard from "./TechnicianCapacityCard";
import { technicianStatusLabel } from "./technicianStatusLabel";

// Epic 2 Phase 2C -- right pane, drop targets for drag-and-drop
// dispatch. Ranking display only -- onDropTechnician (passed down from
// DispatcherBoard.jsx) is the only place a drop actually calls
// transitionWorkOrder(); this component never writes anything itself.
//
// A column only accepts a drop when the selected Work Order's status
// actually allows the "Dispatch" action (i.e. SCHEDULED, per the real
// transition table) -- dragging over a non-droppable column shows no
// visual invitation to drop, so the UI never implies an action the
// backend would reject. Native HTML5 drag-and-drop does not work
// reliably via keyboard or on touch devices -- see
// WorkOrderPreview.jsx's "Dispatch to..." picker for the accessible/
// mobile equivalent path, which calls the identical onDropTechnician
// callback.
function TechnicianBoard({ technicians, selectedWorkOrder, recommendations, allWorkOrders, onDropTechnician, isDispatching }) {
  const [dragOverTechId, setDragOverTechId] = useState(null);

  // Safety net for Priority 1's "no orphan UI state" requirement: a
  // drag that ends anywhere (a successful drop, a drop outside any
  // recognized target, or a cancel via Escape) fires a window-level
  // "dragend"/"drop" event even when this component's own
  // onDrop/onDragLeave never ran -- clears any stuck highlight
  // unconditionally.
  useEffect(() => {
    function clearDragOver() {
      setDragOverTechId(null);
    }
    window.addEventListener("dragend", clearDragOver);
    window.addEventListener("drop", clearDragOver);
    return () => {
      window.removeEventListener("dragend", clearDragOver);
      window.removeEventListener("drop", clearDragOver);
    };
  }, []);

  const canDispatch = selectedWorkOrder
    ? getAllowedActions(selectedWorkOrder.status, "dispatcher", false).includes("Dispatch")
    : false;

  const scoreFor = (techId) => recommendations.find((r) => r.techId === techId);
  const top3Ids = new Set(recommendations.slice(0, 3).map((r) => r.techId));
  const topId = recommendations[0]?.techId;

  function handleDragOver(e, techId) {
    if (!canDispatch || isDispatching) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTechId(techId);
  }

  function handleDrop(e, techId) {
    e.preventDefault();
    setDragOverTechId(null);
    if (!canDispatch || isDispatching || !selectedWorkOrder) return;
    const draggedWorkOrderId = e.dataTransfer.getData("text/plain");
    if (draggedWorkOrderId !== selectedWorkOrder.id) return; // dragstart always selects, so this only guards against stale data
    onDropTechnician(selectedWorkOrder, techId);
  }

  if (technicians.length === 0) {
    return (
      <div className="disp-pane disp-pane--techs">
        <h3>Technicians</h3>
        <p className="fo-muted">No technicians exist yet. Add one from the Technicians tab.</p>
      </div>
    );
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
            role="group"
            aria-label={`${tech.name}, ${technicianStatusLabel(tech.status)}${rec ? `, score ${rec.score} percent` : ""}`}
          >
            <div className="disp-tech-column-header">
              <span>{tech.name}</span>
              <span className={`fo-badge fo-badge-${tech.status}`}>{technicianStatusLabel(tech.status)}</span>
            </div>
            <TechnicianCapacityCard technician={tech} workOrders={allWorkOrders} />
            {rec && (
              <div className="fo-muted">
                {isTop && "⭐ "}Score: {rec.score}%{isTop && " (Recommended)"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// React.memo -- Priority 3 render audit.
export default memo(TechnicianBoard);
