import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { OPERATIONAL_ROLE, ROLES } from "../../domain/constants";

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
// `onSubmit(manualQty)` is called with no argument on the READY path
// (the caller already has the analytics-computed quantity) and with
// the entered positive whole number on the NEEDS_PLANNING path.
export default function RequestReorderControl({ recommendation, onSubmit, submitting, alreadyRequested }) {
  const { role, operationalRoles } = useAuth();
  const [manualQty, setManualQty] = useState("");

  if (alreadyRequested) {
    return <span className="fo-muted">Requested</span>;
  }

  if (recommendation.recommendationStatus === "READY") {
    return (
      <button type="button" onClick={() => onSubmit()} disabled={submitting}>
        {submitting ? "Requesting..." : "Request Reorder"}
      </button>
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
      <button type="button" onClick={() => onSubmit(parsedQty)} disabled={submitting || !isValidQty}>
        {submitting ? "Requesting..." : "Request Reorder"}
      </button>
    </div>
  );
}
