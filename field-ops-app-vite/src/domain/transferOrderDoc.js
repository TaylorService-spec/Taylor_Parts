// Pure: no transport, no Firebase. Moved out of services/transferCommandClient.js so the mapper and its view validator
// can be tested together without the network client (2026-10-19).
/** One EOS transfer-order item as the { docId, data } row the transfer view-model reads. Pure; exported for tests. */
export function toTransferOrderDoc(item) {
  // Exactly the governed Location reference { type, locationId }: the view validator refuses any other key, and the
  // server's governing warehouseId is not a Location identity (carrying it made every row "unknown_field" -- the
  // Transfers list showed none; found by the deployed proof 2026-10-19).
  const ref = (e) => (e && typeof e === "object" ? { type: e.type, locationId: e.locationId } : e);
  return Object.freeze({
    docId: item.transferOrderId,
    data: Object.freeze({
      partId: item.partId,
      status: item.status,
      trackingMode: item.trackingMode ?? null,
      quantity: item.quantity,
      ...(Array.isArray(item.serialNumbers) && item.serialNumbers.length > 0 ? { serialNumbers: [...item.serialNumbers] } : {}),
      origin: ref(item.origin),
      destination: ref(item.destination),
      transferOrderNumber: item.transferOrderNumber ?? null,
      createdAt: item.createdAt ?? null,
      createdBy: item.createdBy ?? null,
      canReceive: item.canReceive === true,
    }),
  });
}
