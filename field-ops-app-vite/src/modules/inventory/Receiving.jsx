import { useState } from "react";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import { Button } from "../../shared/ui/primitives/index.js";
import ReceiveAgainstPurchaseOrder from "../receiving/ReceiveAgainstPurchaseOrder";
import MultiScanReceiving from "../receiving/MultiScanReceiving";

// Inventory > Receiving -- the FIRST-CLASS workspace for the Receiving business capability
// (Enterprise Operations OS platform-first; Taylor Parts flagship). Receiving IS a workspace;
// the PartsScanner is one operational tool/launch point elsewhere (FieldMode).
//
// TWO PURCHASING AUTHORITIES, TWO JOURNEYS, ONE GOVERNED COMMAND.
//
// Reorder purchase orders and supplier purchase orders are different things, not two skins on one
// thing: a reorder PO is one part at a full quantity and its document is immutable, while a supplier
// PO carries several lines and accepts partial receipts over time. They are presented as two choices
// because an operator genuinely has to know which they are holding -- collapsing them into one screen
// would mean inventing a mode switch for a distinction the business already makes.
//
// Both submit through the SAME trusted receiveInventoryStock command, which discriminates on an
// explicit source authority and re-validates everything either journey concluded.
//
// THE LEGACY JOURNEY IS UNTOUCHED. ReceiveAgainstPurchaseOrder is composed exactly as before, with
// the same props and the same remount-on-done behaviour, so deployed behaviour is unchanged.
//
// Access: the Inventory > Receiving nav item is admin/dispatcher (PLACEHOLDER_DEFAULT_ROLES),
// matching the inventory.stock.receive capability holders ({admin,dispatcher,owner}). Both journeys
// still fail closed at both layers (readiness FALSE today; capability-gated server-side), so nothing
// here can execute a live receipt until the separate authorized activation gate. No readiness flip,
// deploy, Rules change, or grant is part of this workspace.
const JOURNEY = Object.freeze({ REORDER: "REORDER", SUPPLIER: "SUPPLIER" });

export default function Receiving() {
  // A "Done"/complete restarts the workflow at the candidate list by remounting it fresh.
  const [sessionKey, setSessionKey] = useState(0);
  const [journey, setJourney] = useState(JOURNEY.REORDER);

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Receiving" />
      <p className="fo-muted">
        Receive ordered stock into inventory. This is a governed transaction limited to authorized
        purchasing roles (Admin, Dispatcher, Owner).
      </p>

      <div className="fo-chip-row" role="group" aria-label="Receiving journey">
        <Button
          variant={journey === JOURNEY.REORDER ? "primary" : "secondary"}
          onClick={() => setJourney(JOURNEY.REORDER)}
        >
          Reorder purchase order
        </Button>
        <Button
          variant={journey === JOURNEY.SUPPLIER ? "primary" : "secondary"}
          onClick={() => setJourney(JOURNEY.SUPPLIER)}
        >
          Supplier purchase order (multi-scan)
        </Button>
      </div>

      {journey === JOURNEY.REORDER ? (
        <>
          <p className="fo-muted">
            One part at its full ordered quantity. Select an ordered purchase order awaiting receipt,
            choose its destination, and confirm the ordered quantity.
          </p>
          <ReceiveAgainstPurchaseOrder key={sessionKey} onDone={() => setSessionKey((k) => k + 1)} />
        </>
      ) : (
        <>
          <p className="fo-muted">
            Several lines, scanned continuously. Partial receipts are supported — a line that is still
            short stays open, and the order completes only when every line is satisfied.
          </p>
          <MultiScanReceiving />
        </>
      )}
    </div>
  );
}
