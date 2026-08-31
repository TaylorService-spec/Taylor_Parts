import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { OPERATIONAL_ROLE, ROLES } from "../../domain/constants";
import { Button } from "../ui/primitives/index.js";

// Zero-history reorder behavior sprint, PR 3
// (docs/specifications/inventory-zero-history-reorder-behavior.md).
// Shared "Request Reorder" action -- used by InventoryHealthPanel.jsx's
// queue action column and PartDetail.jsx's Stock Position card, so the
// READY one-click submit and the NEEDS_PLANNING eligibility-gated
// manual-quantity entry are implemented once, not duplicated.
//
// Eligibility mirrors firestore.rules' canSubmitManualZeroHistoryQuantity()
// client-side (admin override, or a linked Employee with operationalRoles
// containing PARTS_MANAGER/WAREHOUSE_MANAGER, read via AuthContext's
// existing exposure from PR #84 -- no new read path). This is a UX
// nicety only, not the enforcement boundary -- firestore.rules (PR 2)
// is what actually rejects an ineligible submission regardless of
// what this control renders.
//
// `onSubmit(manualQty, warehouseId)` is called with no quantity on the
// READY path (the caller already has the analytics-computed quantity)
// and with the entered positive whole number on the NEEDS_PLANNING path.
//
// WORKSTREAM 2B -- `warehouseId`. A Reorder Request now names a governed
// Warehouse, and the trusted command derives the record's operating
// company from it. This control therefore will not submit until one has
// been chosen (shared/inventory/ReorderWarehouseSelect.jsx is where the
// choosing happens), and it hands the very value that unlocked the
// button back to `onSubmit` -- so the warehouse that gated the action
// and the warehouse that gets written cannot be two different answers.
//
// It never supplies a warehouse of its own. No default, no "the only
// one", no inference from the part or the signed-in user. Missing means
// missing, and missing means the button is off.
//
// Still a UX gate, not the enforcement boundary: the trusted
// createReorderRequest command refuses a request with no governed
// warehouse regardless of what this renders.
export default function RequestReorderControl({ recommendation, onSubmit, submitting, alreadyRequested, warehouseId }) {
  const { role, operationalRoles } = useAuth();
  const [manualQty, setManualQty] = useState("");

  if (alreadyRequested) {
    return <span className="fo-muted">Requested</span>;
  }

  const hasWarehouse = typeof warehouseId === "string" && warehouseId !== "";

  if (recommendation.recommendationStatus === "READY") {
    return (
      <Button
        type="button"
        variant="primary"
        onClick={() => onSubmit(undefined, warehouseId)}
        disabled={submitting || !hasWarehouse}
        loading={submitting}
        title={hasWarehouse ? undefined : "Choose a warehouse first."}
      >
        Request Reorder
      </Button>
    );
  }

  const isEligible =
    role === ROLES.ADMIN ||
    operationalRoles.includes(OPERATIONAL_ROLE.PARTS_MANAGER) ||
    operationalRoles.includes(OPERATIONAL_ROLE.WAREHOUSE_MANAGER);

  if (!isEligible) {
    return <span className="fo-muted">Requires Parts Manager or Warehouse Manager</span>;
  }

  const trimmedQty = manualQty.trim();
  const parsedQty = Number.parseInt(trimmedQty, 10);
  const isValidQty = trimmedQty !== "" && Number.isInteger(parsedQty) && parsedQty > 0 && String(parsedQty) === trimmedQty;

  return (
    <div className="fo-inline-form">
      <input
        type="number"
        min="1"
        step="1"
        value={manualQty}
        onChange={(e) => setManualQty(e.target.value)}
        placeholder="Qty"
        disabled={submitting}
        aria-label="Manual reorder quantity"
      />
      <Button
        type="button"
        variant="primary"
        onClick={() => onSubmit(parsedQty, warehouseId)}
        disabled={submitting || !isValidQty || !hasWarehouse}
        loading={submitting}
        title={hasWarehouse ? undefined : "Choose a warehouse first."}
      >
        Request Reorder
      </Button>
    </div>
  );
}
