// Placement (put-away / pick staging) -- the EOS transport (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
//   recordPutAway  POST /operations/placement -- the placement EVENT (DQ-038): where a unit / quantity was put, no
//                  ledger row. Used by Pick staging, exactly as the Firebase `recordPutAway` callable was.
//   putAwayStock   POST /operations/relocation `relocateStock` WAREHOUSE -> BIN with recordPlacement:true -- the
//                  PUT-AWAY of received stock: the stock's location changes (paired RELOCATION_OUT / _IN in the
//                  ledger, serial custody moves) AND the placement is recorded, in one server transaction.
//
// Bin resolution comes from the governed location read (inventoryLocationClient.js). No Firebase fallback.
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "./eosOperationsClient.js";
import { resolveBin, resolveBinToken } from "./inventoryLocationClient.js";

const OPTS = Object.freeze({ serviceLabel: "the put-away service" });

/** A put-away request (domain/putAwaySession.js toPutAwayRequest + the resolved binId) as the relocation it is. */
export function toPutAwayRelocation(request, binId) {
  return Object.freeze({
    partId: request.partId,
    source: { type: "WAREHOUSE", locationId: request.warehouseId },
    destination: { type: "BIN", locationId: binId },
    ...(Array.isArray(request.serialNumbers) && request.serialNumbers.length > 0
      ? { serialNumbers: [...request.serialNumbers] } : { quantity: request.quantity }),
    idempotencyKey: request.idempotencyKey,
    recordPlacement: true,
  });
}

export const placementClient = Object.freeze({
  resolveBin: (request) => resolveBin(request),
  resolveBinToken: (request) => resolveBinToken(request),
  recordPutAway: (request) => eosOperationOrThrow(EOS_OPERATIONS_ROUTES.PLACEMENT, "recordPutAway", request, OPTS),
  /** `request` = { warehouseId, partId, binId, quantity | serialNumbers, idempotencyKey }. */
  putAwayStock: (request) => {
    const { binId, ...rest } = request;
    return eosOperationOrThrow(EOS_OPERATIONS_ROUTES.RELOCATION, "relocateStock", toPutAwayRelocation(rest, binId), OPTS);
  },
});
