// INV-EQ-P2 -- the injectable read seam for an Equipment's INVENTORY history
// (receiving, transfers, RMA, installation-link, and ledger events). It authors NO
// ledger, NO persistence, and NO event store. Those sources are Enterprise Inventory
// Phase 1/2/4 + the installation-link collection (this Spec's own P3) and do NOT exist
// yet, so the DEFAULT source is INERT: it reports an honest "not connected" status and
// supplies ZERO events -- never a fabricated inventory row. When those sources ship (a
// later, separately authorized gate) a real source is injected here with no change to
// the timeline UI, which composes rows via the merged composeUnifiedTimeline.

export const INVENTORY_HISTORY_STATUS = Object.freeze({
  UNAVAILABLE: "unavailable", // no inventory-history source connected yet (honest default)
  DENIED: "denied",
  READY: "ready",
});

export const inertInventoryHistorySource = Object.freeze({
  connected: false,
  status: INVENTORY_HISTORY_STATUS.UNAVAILABLE,
  events: [],
});

// Normalize any injected source (or the inert default) into a stable shape. Fail-
// closed: an unknown/missing source is treated as unavailable with no events, and
// events are surfaced ONLY when the source is genuinely connected + ready.
export function readInventoryHistorySource(source = inertInventoryHistorySource) {
  if (!source || typeof source !== "object") {
    return { status: INVENTORY_HISTORY_STATUS.UNAVAILABLE, events: [] };
  }
  const status = Object.values(INVENTORY_HISTORY_STATUS).includes(source.status)
    ? source.status
    : INVENTORY_HISTORY_STATUS.UNAVAILABLE;
  const connected = source.connected === true && status === INVENTORY_HISTORY_STATUS.READY;
  const events = connected && Array.isArray(source.events) ? source.events : [];
  return { status, events };
}

/**
 * The governed Equipment history (eos_ops.equipment_events: CREATED / UPDATED / INSTALLED, read with the record through
 * /operations/equipment readEquipment) as a CONNECTED inventory-history source -- Controller EQUIPMENT ACTIVATION,
 * 2026-10-01. An INSTALLED event carries the Work Order, the serial and the ledger movement it was recorded with.
 */
export function equipmentEventHistorySource(events) {
  if (!Array.isArray(events)) return inertInventoryHistorySource;
  return Object.freeze({
    connected: true,
    status: INVENTORY_HISTORY_STATUS.READY,
    events: Object.freeze(events
      .map((e) => Object.freeze({
        at: typeof e?.occurredAt === "string" ? Date.parse(e.occurredAt) : null,
        kind: typeof e?.eventType === "string" ? e.eventType : null,
        workOrderId: e?.workOrderId ?? null, serialNumber: e?.serialNumber ?? null, source: e?.source ?? null, reason: e?.reason ?? null,
      }))
      .filter((e) => Number.isFinite(e.at))),
  });
}
