// Which CONTROLS the Transfers and Cycle Counts screens may OFFER this caller -- the caller's own EOS capability set, the authority the
// server enforces (UI permission parity, ISO inventory 2026-10-19). Same feed as the Scan workspace (access/useInventoryScanCapabilities.js,
// resolveMyCapabilities), kept to the keys these two screens gate on.
//
// OFFER ONLY. Every command re-checks its capability, company authority, warehouse scope and work eligibility on the server; a control that is
// absent here is one the server would refuse, not a second authority. FAIL CLOSED: nothing is offered while the answer is loading, failed or
// malformed (the hook's own rule), so a control never flashes for someone who cannot use it.
import { useInventoryScanCapabilities } from "./useInventoryScanCapabilities.js";

/** The server's own keys: transferOperations.ts EOS_TRANSFER_CAPABILITY and cycleCountOperations.ts EOS_CYCLE_COUNT_CAPABILITY. */
export const TRANSFER_CAPABILITY = Object.freeze({
  create: "inventory.transfer.create",
  dispatch: "inventory.transfer.dispatch",
  receive: "inventory.transfer.receive",
  cancel: "inventory.transfer.cancel",
});
export const CYCLE_COUNT_CAPABILITY = Object.freeze({
  create: "inventory.cycleCount.create",
  submit: "inventory.cycleCount.submit",
  reconcile: "inventory.cycleCount.reconcile",
  cancel: "inventory.cycleCount.cancel",
  close: "inventory.cycleCount.close",
});
/** Put-away: recording the placement (binPlacementOperations.ts) and the relocation Move Stock offers it with (stockRelocationOperations.ts). */
export const PUT_AWAY_CAPABILITY = "inventory.placement.record";

/** A STABLE Set (the hook re-reads when its identity changes). */
export const INVENTORY_SCREEN_CAPABILITY_KEYS = Object.freeze(new Set([
  ...Object.values(TRANSFER_CAPABILITY), ...Object.values(CYCLE_COUNT_CAPABILITY), PUT_AWAY_CAPABILITY,
]));

/** { status, error, hasCapability(id), reload } -- offered only from a READY answer. */
export function useInventoryScreenCapabilities(user, options = {}) {
  return useInventoryScanCapabilities(user, { ...options, keys: INVENTORY_SCREEN_CAPABILITY_KEYS });
}
