import { useState } from "react";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import ReceiveAgainstPurchaseOrder from "../receiving/ReceiveAgainstPurchaseOrder";

// Inventory > Receiving -- the FIRST-CLASS workspace for the Receiving business capability
// (Enterprise Operations OS platform-first; Taylor Parts flagship). Receiving IS a workspace;
// the PartsScanner is one operational tool/launch point elsewhere (FieldMode). Both launch the
// SAME single canonical governed workflow -- ReceiveAgainstPurchaseOrder (domain/
// receiveAgainstPurchaseOrder.js + the fail-closed readiness transport). This workspace adds NO
// alternate receiving implementation: it composes the one workflow with all ORDERED receipt
// candidates (no initialPartId), rather than the part-scoped launch the scanner uses.
//
// Access: the Inventory > Receiving nav item is admin/dispatcher (PLACEHOLDER_DEFAULT_ROLES),
// which matches the inventory.stock.receive capability holders ({admin,dispatcher,owner}). The
// workflow itself still fails closed at both layers (readiness FALSE today; capability-gated
// server-side), so nothing here can execute a live receipt until the separate authorized
// activation gate. No readiness flip, deploy, Rules change, or grant is part of this workspace.
export default function Receiving() {
  // A "Done"/complete restarts the workflow at the candidate list by remounting it fresh.
  const [sessionKey, setSessionKey] = useState(0);
  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Receiving" />
      <p className="fo-muted">
        Receive ordered purchase orders into inventory. This is a governed transaction limited to
        authorized purchasing roles (Admin, Dispatcher, Owner). Select an ordered purchase order
        awaiting receipt, choose its destination, and confirm the ordered quantity.
      </p>
      <ReceiveAgainstPurchaseOrder key={sessionKey} onDone={() => setSessionKey((k) => k + 1)} />
    </div>
  );
}
