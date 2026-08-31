import { useEffect, useState } from "react";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import { Button } from "../../shared/ui/primitives/index.js";
import ReceiveAgainstPurchaseOrder from "../receiving/ReceiveAgainstPurchaseOrder";
import MultiScanReceiving from "../receiving/MultiScanReceiving";
import AcquireExistingUnit from "../receiving/AcquireExistingUnit";
import { useAuth } from "../../auth/AuthContext";
import { useSerializedAssetAcquireCapability } from "../../access/useSerializedAssetAcquireCapability";
import { fetchReceivingLocationOptions } from "../../services/receivingCallableClient";

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
// ND-33 — THE EXCEPTIONAL PATH, DELIBERATELY BESIDE THE NORMAL ONE AND NOT AMONG IT.
//
// Both journeys above are Purchase Order → Receive: a delivery ARRIVED. Some units never took that
// road — an opening balance, a legacy migration, a machine that has been in the van for three years
// — and until now the platform could not say "we already own THIS machine" without inventing a
// purchase that never happened.
//
// It is NOT a third journey chip. Putting it in that row would make it look like a third way to
// receive, and receiving is exactly what it is not: `acquisitionProvenance: NON_PO_ACQUISITION`, no
// `activatedByReceivingId`, no purchase order, no supplier. It sits apart, after both, named for
// what it does.
//
// Owner ruling ND-33 placed it HERE and not under Equipment: Equipment represents units the business
// services or has installed at customers; Inventory represents units it currently holds. Acquiring
// creates no Equipment record and no customer relationship, and the Role that may acquire carries no
// `equipment.install` — so no single person can take a machine from non-existence to a customer.
const JOURNEY = Object.freeze({ REORDER: "REORDER", SUPPLIER: "SUPPLIER" });

export default function Receiving() {
  // A "Done"/complete restarts the workflow at the candidate list by remounting it fresh.
  const [sessionKey, setSessionKey] = useState(0);
  const [journey, setJourney] = useState(JOURNEY.REORDER);
  const [acquiring, setAcquiring] = useState(false);

  const { user } = useAuth();
  const { canAcquire } = useSerializedAssetAcquireCapability(user);

  // THE SAME governed warehouse options both receiving journeys use. Read once here and passed
  // down, rather than the dialog building a second, weaker location list of its own — an
  // acquisition that accepted a location receiving would reject would be a second answer to a
  // question one authority already owns.
  const [locations, setLocations] = useState({ status: null, options: [] });
  useEffect(() => {
    if (!acquiring) return undefined;
    let cancelled = false;
    fetchReceivingLocationOptions()
      .then((res) => { if (!cancelled) setLocations({ status: res.status, options: res.options ?? [] }); })
      .catch(() => { if (!cancelled) setLocations({ status: "UNAVAILABLE", options: [] }); });
    return () => { cancelled = true; };
  }, [acquiring]);

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

      {/* ── ND-33: the exceptional path. Set apart by a rule, after both purchase-order journeys. */}
      <section className="fo-receiving-exception" aria-labelledby="acquire-existing-heading">
        <h3 id="acquire-existing-heading">A unit the company already owns</h3>
        <p className="fo-muted">
          For an opening balance, a legacy migration, or a machine the company owns that was never
          recorded. This does not create a purchase order or supplier receipt, and it does not assign
          the unit to a customer.
        </p>
        {/* ABSENT, not merely disabled, for a principal who does not hold the capability. Inviting
            somebody to fill in a part, a serial and a reason only to be refused at the last press is
            the defect the install surface's own capability gate exists to prevent. */}
        {canAcquire ? (
          <Button variant="secondary" onClick={() => setAcquiring(true)}>Add existing unit</Button>
        ) : null}
      </section>

      {acquiring ? (
        <AcquireExistingUnit
          canAcquire={canAcquire}
          locationOptions={locations.options}
          locationsStatus={locations.status}
          onClose={() => setAcquiring(false)}
          // The unit is now in AVAILABLE company stock. Remounting the receiving journey reconciles
          // the reads that have a new unit to show. It does NOT navigate into an Equipment record —
          // acquiring creates none, and sending somebody to one that does not exist would be the
          // most confusing possible success.
          onAcquired={() => setSessionKey((k) => k + 1)}
        />
      ) : null}
    </div>
  );
}
