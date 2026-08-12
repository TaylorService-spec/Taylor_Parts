// PURE adapter: turns an installed Equipment record (ADR-006) into the inventory-control read
// for the Equipment surfaces. An Equipment record exists because a serialized asset was received
// and installed, so `controlBegan` and `installationComplete` are both true for a serial-linked
// record. The SALE-CLOSE signal is a SEPARATE authority (Sales Order) not available on the
// Equipment surface, and D-5 (sale-close criteria) is unratified — so `saleClosed` is UNKNOWN and
// the control state honestly reads UNKNOWN, with the reason stated, until that signal is wired.
// This matches EquipmentDetail's own ethos: render the honest not-yet-known answer, never pretend.
//
// No firebase import; consumes the inventory-control authority. The `saleClosed` / `explicitTitleHolder`
// inputs are optional injection points so a caller that DOES have the sale-close signal (once the
// Sales Order read path is live and D-5 ratified) gets a fully-determined control state for free.

import {
  computeInventoryControl,
  describeInventoryControl,
  resolveOwnershipTitle,
  isPresentableAsAvailable,
} from "./inventoryControlLifecycle.js";

export function buildEquipmentInventoryControlView(equipment, { saleClosed = null, explicitTitleHolder, committedToSalesOrder = false } = {}) {
  const linked =
    equipment && typeof equipment === "object" && typeof equipment.serializedAssetId === "string" && equipment.serializedAssetId.trim() !== "";

  const control = computeInventoryControl({
    controlBegan: linked ? true : null, // a serial-linked Equipment came from a received serial
    installationComplete: linked ? true : null, // it is, by definition, installed
    saleClosed, // not available on this surface today ⇒ null ⇒ honest UNKNOWN
    context: { delivered: linked ? true : null },
  });

  const saleCloseSignalAvailable = saleClosed === true || saleClosed === false;
  const reason =
    control.state === "UNKNOWN" && linked && !saleCloseSignalAvailable
      ? "Installed; sale-close status not available on this surface (D-5 sale-close criteria pending)"
      : null;

  return Object.freeze({
    linkedToSerializedAsset: !!linked,
    inventoryControl: control.state,
    inventoryControlLabel: describeInventoryControl(control),
    unmetConditions: control.unmetConditions,
    // Independent axes, kept separate on the surface:
    ownershipTitle: resolveOwnershipTitle({ explicitTitleHolder }),
    presentableAsAvailable: isPresentableAsAvailable({ availableForAssignment: false, committedToSalesOrder }),
    saleCloseSignalAvailable,
    reason,
  });
}
