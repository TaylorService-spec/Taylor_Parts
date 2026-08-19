// EI Truck Registry -- renders a SANITIZED command outcome. It shows ONLY the fixed
// per-kind message from domain/truckManagement.js (never a raw backend message/id). A
// conflict outcome is the reload-required state and offers a Reload control that re-reads
// the registry so the operator can retry against the current version.
import { TRUCK_COMMAND_OUTCOME } from "../../../domain/truckManagement.js";
import { Button } from "../../../shared/ui/primitives/index.js";

const KIND_CLASS = {
  [TRUCK_COMMAND_OUTCOME.OK]: "fo-outcome-banner--ok",
  [TRUCK_COMMAND_OUTCOME.DENIED]: "fo-warning",
  [TRUCK_COMMAND_OUTCOME.UNAVAILABLE]: "fo-warning",
  [TRUCK_COMMAND_OUTCOME.CONFLICT]: "fo-warning",
  [TRUCK_COMMAND_OUTCOME.INVALID]: "fo-warning",
  [TRUCK_COMMAND_OUTCOME.FAILURE]: "fo-warning",
};

export default function OutcomeBanner({ outcome, successMessage = "Saved.", onReload }) {
  if (!outcome) return null;
  // A stale outcome (resolved after an access-boundary change) is intentionally not shown.
  if (outcome.stale) return null;
  const isOk = outcome.kind === TRUCK_COMMAND_OUTCOME.OK;
  const isConflict = outcome.kind === TRUCK_COMMAND_OUTCOME.CONFLICT;
  const text = isOk ? successMessage : outcome.message;
  return (
    <div className={KIND_CLASS[outcome.kind] || "fo-warning"} role={isOk ? "status" : "alert"} data-testid="truck-command-outcome">
      <span>{text}</span>
      {isConflict && typeof onReload === "function" && (
        <Button variant="secondary" style={{ marginLeft: 8 }} onClick={onReload}>
          Reload
        </Button>
      )}
    </div>
  );
}
