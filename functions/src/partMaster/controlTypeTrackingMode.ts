// THE ONE mapping from Part Master's `controlType` vocabulary to the ledger's `trackingMode`.
//
// ============================ WHY IT LIVES IN ITS OWN FILE ============================
//
// This existed as two byte-identical private copies -- one in inventoryReceiving/receivingCallableWiring.ts,
// one in inventoryTransfer/transferCallableWiring.ts. Two copies of a rule that decides whether a part
// is counted by quantity or by serial is two chances to disagree, and the disagreement would not be
// loud: receiving would accept a part transfer refused, or one surface would report a quantity the
// other said could not exist.
//
// A third copy was about to be written for the part-balance read. Extracting instead means every
// surface that asks "is this part serial-tracked" gets the same answer by construction.
//
// ============================ FAIL CLOSED ON THE UNKNOWN ============================
//
// An unrecognized controlType resolves to LOT, which the receiving and transfer validators both
// reject as "tracking mode not supported". That is deliberate: a controlType nobody has taught this
// mapping about must not silently become NONE and be treated as ordinary countable stock.

/** The ledger-side vocabulary. Deliberately a string union rather than the ledger's own type, so this
 * module stays free of a dependency on the ledger and can be imported by reads as well as commands. */
export type ControlTypeTrackingMode = "NONE" | "SERIAL" | "LOT";

export function controlTypeToTrackingMode(controlType: string): ControlTypeTrackingMode {
  switch (controlType) {
    case "STANDARD":
      return "NONE";
    case "SERIALIZED":
      return "SERIAL";
    case "LOT":
      return "LOT";
    default:
      return "LOT";
  }
}

/**
 * Is a part counted individually rather than by quantity?
 *
 * The question the part-balance read actually asks. Expressed here so callers do not each re-derive
 * it from the mode string and quietly differ on, say, whether LOT counts as serial-tracked.
 */
export function isSerialTracked(controlType: string): boolean {
  return controlTypeToTrackingMode(controlType) === "SERIAL";
}
