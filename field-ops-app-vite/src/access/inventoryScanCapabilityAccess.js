// Inventory Scan capability OFFER -- PURE (no React, no Firebase; node-testable). P1-2 Warehouse Scan.
//
// NOT A QUESTION FOR THE FIREBASE FEED. The Scan workspace (/service/scan, the technician workspace's Scan tab and
// /inventory/warehouse-workspace) used to ask the shell's Firebase effective-access feed which workflows to offer,
// while every EOS inventory command it runs (relocation, placement, cycle count, transfer) and the bin lookup it calls
// authorize from PostgreSQL. This projects the caller's OWN EOS capability set -- resolveMyCapabilities, POST
// /operations/inventory (functions/src/eosOps/eosOpsHttp.ts), answered from the resolved EOS Principal, ACTIVE
// membership and Role capabilities -- onto the scan keys. Same pattern as access/commercialCapabilityAccess.js.
//
// OFFER ONLY. Every command re-checks its capability AND the caller's warehouse scope / work eligibility server-side.
import { SCAN_WORKFLOW_CAPABILITY_IDS } from "./scanWorkflows.js";

export const MY_INVENTORY_SCAN_CAPABILITIES_OPERATION = "resolveMyCapabilities";

/**
 * Move stock's in-screen "send to a truck" choice (modules/scan/MoveStockScan.jsx) also asks for
 * inventory.transfer.create (with inventory.transfer.dispatch, already a workflow id). It is not a workflow gate, but
 * the Scan mounts hand MoveStockScan this same gate, so it must be kept -- otherwise the choice would go dark.
 */
export const MOVE_STOCK_SEND_TO_TRUCK_CAPABILITY = "inventory.transfer.create";

/**
 * Exactly the ids the Scan workspace consults: deriveScanWorkflows' ids plus MoveStockScan's in-screen choice.
 * Anything else in the answer is ignored, never offered.
 */
export const INVENTORY_SCAN_CAPABILITY_REQUEST = Object.freeze([...SCAN_WORKFLOW_CAPABILITY_IDS, MOVE_STOCK_SEND_TO_TRUCK_CAPABILITY]);

const SCAN_KEYS = new Set(INVENTORY_SCAN_CAPABILITY_REQUEST);

/**
 * The scan capability ids the caller holds, from a successful resolveMyCapabilities answer -- or null when the
 * answer is not the governed shape (not an object, `capabilities` not an array, or a non-string entry). Keys outside
 * the set asked for (the scan set unless `keys` is given) are dropped: resolveMyCapabilities answers the caller's whole set, and the Scan workspace needs only
 * INVENTORY_SCAN_CAPABILITY_REQUEST.
 */
export function inventoryScanCapabilitiesFrom(result, keys = SCAN_KEYS) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const { capabilities } = result;
  if (!Array.isArray(capabilities)) return null;
  if (!capabilities.every((id) => typeof id === "string" && id.length > 0)) return null;
  return new Set(capabilities.filter((id) => keys.has(id)));
}
