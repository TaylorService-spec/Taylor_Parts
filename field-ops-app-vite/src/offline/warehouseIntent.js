// WAREHOUSE OFFLINE WORK — observations and intents, never inventory state.
//
// ============================ THE LINE THAT MATTERS MOST HERE ============================
//
// A technician's queued note is a claim about words. A warehouse worker's queued receipt is a claim
// about STOCK, and stock is a shared, contended, conserved quantity that other people are moving at
// the same time. So the offline principle is stricter than it was for the technician:
//
//     OFFLINE CAPTURE NEVER RESERVES, NEVER ALLOCATES, AND NEVER PROJECTS A BALANCE.
//
// Two workers can capture receipts against the same remaining quantity, and both are right at the
// moment of capture. The server decides at sync who actually gets it, and one of them will be told
// no. That is correct, and it is why nothing here holds a quantity on the strength of an intent.
//
// ============================ WHY NOT TECHNICIAN SEMANTICS ============================
//
// The envelope is shared (intentEnvelope.js) because identity, fingerprinting and credential refusal
// are the same problem in both places. The SEMANTICS are not shared and must not be:
//
//   - a technician's intents all hang off one Work Order; warehouse intents hang off whatever the
//     action concerns, and there is no single spine
//   - technician dependencies are about a job's closeout order; warehouse dependencies are about
//     STOCK EXISTING before it can be moved
//   - a technician's labor cannot conflict with another technician's; a receipt absolutely can
//
// PURE. No storage, no network.
import { createEnvelopeFactory } from "./intentEnvelope.js";

/**
 * The warehouse queue's own storage namespace.
 *
 * One person can be both a technician and a warehouse worker on one device. Sharing a storage key
 * would let each runtime's save overwrite the other's whole queue -- silently, and with no error, on
 * every write.
 */
export const WAREHOUSE_STORE_NAMESPACE = "eos.warehouse.offline";

/** Eight, and only eight. Each maps to ONE existing governed command. */
export const WAREHOUSE_INTENT = Object.freeze({
  INVENTORY_RECEIVE: "INVENTORY_RECEIVE",
  PUT_AWAY: "PUT_AWAY",
  PICK_STAGE: "PICK_STAGE",
  TRANSFER_DISPATCH: "TRANSFER_DISPATCH",
  TRANSFER_RECEIVE: "TRANSFER_RECEIVE",
  TRUCK_HANDOFF: "TRUCK_HANDOFF",
  CYCLE_COUNT_SUBMIT: "CYCLE_COUNT_SUBMIT",
  RETURN_INTAKE: "RETURN_INTAKE",
});

export const WAREHOUSE_INTENT_TYPES = Object.freeze(Object.values(WAREHOUSE_INTENT));

/**
 * RECONCILIATION IS ABSENT, AND ITS ABSENCE IS THE POINT.
 *
 * Approving a variance is a decision against current inventory truth. An offline worker cannot
 * approve a state they have not re-read, and queueing an approval would mean a decision landing
 * hours later, made on numbers that have moved, by somebody who never saw the ones it lands on.
 *
 * This is not a gap to be closed in a later slice. It is a business rule, and the UI says
 * "Reconnect to reconcile this count" rather than offering a queue entry.
 */
export const RECONCILE_IS_ONLINE_ONLY = Object.freeze({
  workflow: "cycle count reconciliation",
  reason: "Approving a variance is an authority decision against current inventory truth.",
  uiText: "Reconnect to reconcile this count.",
});

/**
 * ORDERING PRECEDENCE — a tie-breaker among things that may all go, never a dependency.
 *
 * Stock must EXIST before it can be placed, and be placed before it is moved. Where a real
 * dependency exists it is declared as an edge; this only decides who goes first among peers.
 */
export const WAREHOUSE_PRECEDENCE = Object.freeze({
  [WAREHOUSE_INTENT.INVENTORY_RECEIVE]: 10,
  [WAREHOUSE_INTENT.RETURN_INTAKE]: 15,
  [WAREHOUSE_INTENT.PUT_AWAY]: 20,
  [WAREHOUSE_INTENT.PICK_STAGE]: 30,
  [WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT]: 40,
  [WAREHOUSE_INTENT.TRANSFER_DISPATCH]: 50,
  [WAREHOUSE_INTENT.TRUCK_HANDOFF]: 50,
  [WAREHOUSE_INTENT.TRANSFER_RECEIVE]: 60,
});

/** What each is called on a screen. Never the enum. */
export const WAREHOUSE_INTENT_LABEL = Object.freeze({
  [WAREHOUSE_INTENT.INVENTORY_RECEIVE]: "Receipt",
  [WAREHOUSE_INTENT.PUT_AWAY]: "Put away",
  [WAREHOUSE_INTENT.PICK_STAGE]: "Pick and stage",
  [WAREHOUSE_INTENT.TRANSFER_DISPATCH]: "Transfer dispatch",
  [WAREHOUSE_INTENT.TRANSFER_RECEIVE]: "Transfer receipt",
  [WAREHOUSE_INTENT.TRUCK_HANDOFF]: "Truck handoff",
  [WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT]: "Count",
  [WAREHOUSE_INTENT.RETURN_INTAKE]: "Return intake",
});

const makeWarehouseEnvelope = createEnvelopeFactory({
  allowedTypes: WAREHOUSE_INTENT_TYPES,
  scopeField: "scopeId",
});

const deviceClaim = (offline, at) => (offline ? at : null);

/**
 * The one place a warehouse intent is built.
 *
 * `references` carries the business identities a conflict card needs as DISCRETE FIELDS — part,
 * serial, location, source, destination, transfer, quantity. Not because the payload lacks them, but
 * because a conflict screen must be able to show WHICH field changed without unpacking a command's
 * request shape, and because the structured-object standard says an attribute stays addressable all
 * the way through.
 */
function warehouseIntent({ type, scopeId, principalUid, payload, captureKey, references = null, dependsOn = [], at = 0, offline = false }) {
  const built = makeWarehouseEnvelope({
    type, scope: scopeId, principalUid, payload, captureKey, dependsOn,
    createdAtLocal: at,
    deviceReportedAtMillis: deviceClaim(offline, at),
    describe: WAREHOUSE_INTENT_LABEL[type] ?? type,
    extra: references,
  });
  if (!built.valid) return built;
  // The idempotency key IS the intent id. Every warehouse command derives its document id from the
  // key it is given, so the same act lands on the same record however many times it is sent.
  return {
    valid: true,
    value: Object.freeze({
      ...built.value,
      payload: Object.freeze({ ...built.value.payload, idempotencyKey: built.value.intentId }),
    }),
  };
}

// ============================ CAPTURE ============================

/**
 * A receipt.
 *
 * SERIALS ARE CARRIED INDIVIDUALLY. One serial is one physical unit, and collapsing them into a
 * count would lose the identities the server needs to refuse a duplicate — and would make "we
 * received four" unfalsifiable.
 */
export function captureReceive({
  principalUid, sourceId, partId, quantity = null, serialNumbers = null,
  destinationId = null, captureKey, at = 0, offline = false,
}) {
  return warehouseIntent({
    type: WAREHOUSE_INTENT.INVENTORY_RECEIVE,
    scopeId: sourceId, principalUid, captureKey, at, offline,
    payload: {
      sourceId, partId,
      ...(Array.isArray(serialNumbers) && serialNumbers.length > 0
        ? { serialNumbers: [...serialNumbers] }
        : { quantity }),
      ...(destinationId ? { destinationId } : {}),
    },
    references: {
      Source: sourceId, Part: partId, Destination: destinationId,
      Quantity: Array.isArray(serialNumbers) ? serialNumbers.length : quantity,
      Serial: Array.isArray(serialNumbers) && serialNumbers.length === 1 ? serialNumbers[0] : null,
    },
  });
}

/**
 * A placement. Put-away records WHERE existing stock goes; it does not create stock.
 *
 * That is why it may declare a dependency on a receipt: placing something the server does not yet
 * know exists is not a race, it is a guaranteed refusal.
 */
export function capturePutAway({
  principalUid, partId = null, serialNo = null, destinationBinId,
  quantity = null, dependsOnIntentId = null, captureKey, at = 0, offline = false,
}) {
  if (!partId && !serialNo) return { valid: false, reason: "item_identity_required" };
  return warehouseIntent({
    type: WAREHOUSE_INTENT.PUT_AWAY,
    scopeId: destinationBinId, principalUid, captureKey, at, offline,
    dependsOn: dependsOnIntentId ? [{ intentId: dependsOnIntentId, required: true }] : [],
    payload: { partId, serialNo, destinationBinId, quantity },
    references: { Part: partId, Serial: serialNo, Destination: destinationBinId, Quantity: quantity },
  });
}

/**
 * A pick, staged.
 *
 * PICKING RESERVES NOTHING, offline or online — the surface itself says so, and reservation is a
 * Work Order lifecycle effect rather than an operator action. Capturing one offline must not quietly
 * become the reservation the online path deliberately does not perform.
 */
export function capturePickStage({
  principalUid, workOrderId, partId, pickedQuantity, stagingBinId,
  serialNumbers = null, captureKey, at = 0, offline = false,
}) {
  return warehouseIntent({
    type: WAREHOUSE_INTENT.PICK_STAGE,
    scopeId: stagingBinId, principalUid, captureKey, at, offline,
    payload: {
      workOrderId, partId, destinationBinId: stagingBinId,
      quantity: pickedQuantity,
      ...(Array.isArray(serialNumbers) && serialNumbers.length > 0 ? { serialNumbers: [...serialNumbers] } : {}),
    },
    references: {
      "Work order": workOrderId, Part: partId, Quantity: pickedQuantity, Destination: stagingBinId,
    },
  });
}

/** A dispatch. The transfer already exists; this moves it. */
export function captureTransferDispatch({ principalUid, transferOrderId, sourceId = null, destinationId = null, captureKey, at = 0, offline = false }) {
  return warehouseIntent({
    type: WAREHOUSE_INTENT.TRANSFER_DISPATCH,
    scopeId: transferOrderId, principalUid, captureKey, at, offline,
    payload: { transferOrderId },
    references: { Transfer: transferOrderId, Source: sourceId, Destination: destinationId },
  });
}

/**
 * A receipt at the far end.
 *
 * Depends on the dispatch ONLY when both were captured on this device. Far more often the dispatch
 * was somebody else's, on another phone, and there is no local intent to point at — which is why the
 * executor's precheck re-reads the transfer rather than relying on an edge that may not exist.
 */
export function captureTransferReceive({ principalUid, transferOrderId, destinationId = null, dependsOnIntentId = null, captureKey, at = 0, offline = false }) {
  return warehouseIntent({
    type: WAREHOUSE_INTENT.TRANSFER_RECEIVE,
    scopeId: transferOrderId, principalUid, captureKey, at, offline,
    dependsOn: dependsOnIntentId ? [{ intentId: dependsOnIntentId, required: true }] : [],
    payload: { transferOrderId },
    references: { Transfer: transferOrderId, Destination: destinationId },
  });
}

/**
 * A truck handoff. IT IS A TRANSFER.
 *
 * The type exists so the SCREEN can say "Truck handoff", which is what the work is called. It binds
 * to the transfer lifecycle and nothing else — there is no separate mobile movement model, and
 * inventing one would be a second inventory authority nobody governs.
 */
export function captureTruckHandoff({ principalUid, transferOrderId, action = "dispatch", sourceId = null, destinationId = null, captureKey, at = 0, offline = false }) {
  return warehouseIntent({
    type: WAREHOUSE_INTENT.TRUCK_HANDOFF,
    scopeId: transferOrderId, principalUid, captureKey, at, offline,
    payload: { transferOrderId, action },
    references: { Transfer: transferOrderId, Source: sourceId, Destination: destinationId },
  });
}

/**
 * A count.
 *
 * The observation, and nothing derived from it. The client does NOT compute variance: variance is
 * expected-minus-counted, expected is the server's, and a device that calculated it would be
 * asserting a number against a balance it cannot see. Blind-count policy also survives by
 * construction here — there is nowhere in this payload for an expected quantity to hide.
 */
export function captureCycleCountSubmit({
  principalUid, cycleCountId, countedQuantity = null, countedSerials = null,
  partId = null, locationId = null, captureKey, at = 0, offline = false,
}) {
  return warehouseIntent({
    type: WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT,
    scopeId: cycleCountId, principalUid, captureKey, at, offline,
    payload: {
      cycleCountId,
      ...(Array.isArray(countedSerials) ? { countedSerials: [...countedSerials] } : { countedQuantity }),
    },
    references: {
      "Cycle count": cycleCountId, Part: partId, Location: locationId,
      Quantity: Array.isArray(countedSerials) ? countedSerials.length : countedQuantity,
    },
  });
}

/**
 * A return, taken in.
 *
 * INTAKE ONLY. No restock, no disposition, no credit — those authorities do not exist, and a queue
 * entry implying one would be inventing product policy in a sync layer.
 */
export function captureReturnIntake({
  principalUid, sourceId, partId, quantity = null, serialNo = null,
  condition = null, notes = null, captureKey, at = 0, offline = false,
}) {
  return warehouseIntent({
    type: WAREHOUSE_INTENT.RETURN_INTAKE,
    scopeId: sourceId, principalUid, captureKey, at, offline,
    payload: {
      sourceId, partId, quantity, serialNo,
      ...(condition ? { condition } : {}),
      ...(notes ? { notes } : {}),
    },
    references: {
      Source: sourceId, Part: partId, Serial: serialNo, Quantity: quantity, Condition: condition,
    },
  });
}

/**
 * The dependency graph, stated.
 *
 * REQUIRED edges only where business semantics demand them — stock must exist before it is placed,
 * and a transfer must be dispatched before it can be received. Everything else is left free, because
 * a dependency that is merely tidy is a queue that stalls for no reason.
 */
export const WAREHOUSE_DEPENDENCY_RULES = Object.freeze([
  {
    from: WAREHOUSE_INTENT.INVENTORY_RECEIVE, to: WAREHOUSE_INTENT.PUT_AWAY, required: true,
    why: "Put-away records where EXISTING stock goes. Placing something the server does not yet know exists is not a race, it is a guaranteed refusal.",
  },
  {
    from: WAREHOUSE_INTENT.TRANSFER_DISPATCH, to: WAREHOUSE_INTENT.TRANSFER_RECEIVE, required: true,
    why: "A transfer must be IN_TRANSIT before it can be received. Only applies when both were captured on THIS device; otherwise the precheck re-reads the transfer.",
  },
  {
    from: null, to: WAREHOUSE_INTENT.RETURN_INTAKE, required: false,
    why: "Nothing blocks taking a return in. A note on a return must never hold up the intake it describes.",
  },
  {
    from: null, to: WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT, required: false,
    why: "An observation depends on nothing. It asserts what a person saw and changes no balance.",
  },
]);
