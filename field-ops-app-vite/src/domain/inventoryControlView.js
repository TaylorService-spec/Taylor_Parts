// Ventana / Equipment-Sale — UX READ-COMPOSITION for the two-condition inventory-control
// lifecycle. PURE and read-only: it DERIVES the three inventory-control signals from their
// real authorities (Serialized Asset identity + installation link, Sales Order state, a
// receipt fact), calls the inventory-control projection, and returns a display model that
// keeps EVERY independent axis legible and separate — inventory control, ownership/title,
// custody holder, and availability are shown side-by-side, never collapsed into one another.
//
// No firebase import, no persistence. This is the surface layer the baseline §7 UX rules ask
// for: no single event reads as completion; two conditions → two indicators; "in inventory" ≠
// "available"; a visible custody holder; one vocabulary across surfaces.

import { computeInventoryControl, describeInventoryControl, resolveOwnershipTitle, isPresentableAsAvailable, rollupOrderInventoryControl, OWNERSHIP } from "./inventoryControlLifecycle.js";
import { validateSerializedAssetIdentity, SERIALIZED_ASSET_STATES } from "./serializedAssetIdentity.js";

// Derive `controlBegan`: a serialized asset only exists because it was received into Taylor
// control (ADR-010 Ph2 creates the serial at Receiving). An explicit drop-ship-without-receipt
// fact means control never began. Unknown asset ⇒ unknown signal (fail closed).
function deriveControlBegan({ assetValid, dropShipNoReceipt }) {
  if (dropShipNoReceipt === true) return false;
  if (assetValid) return true;
  return null;
}

// Derive `installationComplete`: the Serialized Asset lifecycle state is INSTALLED (which the
// identity contract couples to a reciprocal Equipment link). A malformed/unknown asset ⇒ null.
function deriveInstallationComplete({ assetValid, state }) {
  if (!assetValid) return null;
  return state === "INSTALLED";
}

// D-5 (Owner: the ONLY load-bearing unresolved business rule). Until Taylor defines the
// authoritative sale-close criteria (invoice finalization / customer acceptance / AR posting /
// installation paperwork / some combination / another existing accounting event), a bare Sales
// Order state of CLOSED is NOT authoritative for ending inventory responsibility — FULFILLED→CLOSED
// has no payment/acceptance gate. So the sale-close SIGNAL is fail-closed: it becomes `true` ONLY
// from an explicit authoritative-close fact, never from SO state alone, until this flag is flipped
// when D-5 is ratified. This guarantees no machine EXITS inventory control on the weak signal.
export const SALE_CLOSE_CRITERIA_RATIFIED = false;

const KNOWN_SALES_ORDER_STATES = new Set(["CONFIRMED", "IN_FULFILLMENT", "FULFILLED", "CLOSED", "CANCELLED"]);

// Derive `saleClosed`. An explicit authoritative-close fact (the future D-5 event) always wins.
// Otherwise a CANCELLED order is not a close (false); a bare CLOSED is authoritative ONLY once D-5
// is ratified (else null/UNKNOWN — pending, never a premature exit); a known open state ⇒ false;
// anything else ⇒ null (fail closed — never assume open or closed).
function deriveSaleClosed({ salesOrderState, saleCloseAuthoritative } = {}) {
  if (saleCloseAuthoritative === true) return true;
  if (saleCloseAuthoritative === false) return false;
  if (salesOrderState === "CANCELLED") return false;
  if (salesOrderState === "CLOSED") return SALE_CLOSE_CRITERIA_RATIFIED ? true : null; // D-5 pending
  if (KNOWN_SALES_ORDER_STATES.has(salesOrderState)) return false;
  return null;
}

// Build the per-machine display model. Inputs are the raw authority records this surface reads:
//   serializedAsset — governed identity ({ serialNo, partId, currentLocation, state, currentEquipmentId })
//   part            — Part authority (for SERIAL eligibility validation of the identity)
//   salesOrderState — the linked Sales Order lifecycle state
//   explicitTitleHolder — the SEPARATE title fact (VENTANA/TAYLOR/CUSTOMER), never derived here
//   custodyHolderLabel  — who physically holds it now (warehouse/truck/tech/customer site)
//   flags           — display-only { allocated, delivered, invoiced, dropShipNoReceipt }
// Returns a frozen view model; every axis is a distinct field.
export function buildMachineInventoryControlView({
  serializedAsset,
  part,
  salesOrderState,
  saleCloseAuthoritative, // explicit D-5 authoritative-close fact (optional); overrides SO state
  explicitTitleHolder,
  custodyHolderLabel = null,
  flags = {},
} = {}) {
  const identity = validateSerializedAssetIdentity(serializedAsset, part);
  const assetValid = identity.valid;
  const state = assetValid ? identity.value.state : null;

  const controlBegan = deriveControlBegan({ assetValid, dropShipNoReceipt: flags.dropShipNoReceipt });
  const installationComplete = deriveInstallationComplete({ assetValid, state });
  const saleClosed = deriveSaleClosed({ salesOrderState, saleCloseAuthoritative });

  const control = computeInventoryControl({
    controlBegan,
    installationComplete,
    saleClosed,
    context: { allocated: flags.allocated, delivered: flags.delivered, invoiced: flags.invoiced },
  });

  // Availability is its OWN axis (INV-2): a unit committed to a sale is present-and-unavailable.
  // Committed = under control with the sale still open OR explicitly flagged allocated.
  const committedToSalesOrder = control.state === "CONTROLLED" || flags.allocated === true;
  const availableForAssignment = assetValid && state === "AVAILABLE";
  const presentableAsAvailable = isPresentableAsAvailable({ availableForAssignment, committedToSalesOrder });

  return Object.freeze({
    serialNo: assetValid ? identity.value.serialNo : null,
    // --- inventory-control axis ---
    inventoryControl: control.state,
    inventoryControlLabel: describeInventoryControl(control),
    unmetConditions: control.unmetConditions,
    controlResult: control, // the raw (frozen) determination, for order-level rollup
    // --- ownership/title axis (SEPARATE; never derived from control) ---
    ownershipTitle: resolveOwnershipTitle({ explicitTitleHolder }),
    ownershipIsExplicit: resolveOwnershipTitle({ explicitTitleHolder }) !== OWNERSHIP.UNKNOWN,
    // --- custody axis ---
    custodyHolder: custodyHolderLabel,
    location: assetValid ? identity.value.currentLocation : null,
    // --- availability axis (INV-2) ---
    presentableAsAvailable,
    lifecycleState: state,
    // --- display-only context (proven non-authoritative over the exit decision) ---
    context: control.context,
  });
}

// Coordinated multi-machine ORDER view (C713 × 5). `unitInputs` are the per-machine inputs for
// the units allocated to ONE Sales Order; `salesOrderState` is shared. Returns the honest
// order-level rollup plus each unit's view — so a surface can show "N installed / M controlled,
// sale open" without ever claiming the order complete while any unit is still controlled.
export function buildCoordinatedOrderView({ unitInputs = [], salesOrderState, saleCloseAuthoritative, orderRef = null } = {}) {
  const units = (Array.isArray(unitInputs) ? unitInputs : []).map((u) =>
    buildMachineInventoryControlView({ ...u, salesOrderState, saleCloseAuthoritative })
  );
  // Roll up the actual per-unit control determinations (no reconstruction).
  const rollup = rollupOrderInventoryControl(units.map((u) => u.controlResult));
  const dropShipNote = rollup.notStartedUnits > 0 ? ` (${rollup.notStartedUnits} never under Taylor control)` : "";
  let summaryLabel;
  if (rollup.state === "EXITED") {
    summaryLabel = `All ${rollup.underControl} Taylor-controlled units installed and sale closed — inventory control ended${dropShipNote}`;
  } else if (rollup.state === "NOT_STARTED") {
    summaryLabel = `No units under Taylor inventory control (${rollup.total} drop-ship/never received)`;
  } else if (rollup.state === "UNKNOWN") {
    summaryLabel = `Inventory-control status unknown for one or more of ${rollup.total} units`;
  } else {
    summaryLabel = `${rollup.exitedUnits}/${rollup.underControl} Taylor-controlled units exited; ${rollup.controlledUnits} still under Taylor control${dropShipNote}`;
  }
  return Object.freeze({
    orderRef,
    inventoryControl: rollup.state,
    total: rollup.total,
    underControl: rollup.underControl,
    exitedUnits: rollup.exitedUnits,
    controlledUnits: rollup.controlledUnits,
    notStartedUnits: rollup.notStartedUnits,
    summaryLabel,
    units,
  });
}

export { SERIALIZED_ASSET_STATES };
