// THE REORDER SOURCE WRITE FREEZE -- the cutover gate every legacy Reorder writer passes through.
//
// ════════════════════ WHY RULES ARE NOT ENOUGH ════════════════════
//
// firestore.rules do not constrain the Firebase Admin SDK. A Rules-only freeze stops the browser and
// leaves every trusted callable free to keep changing the very population being copied -- which
// would make the copy a photograph of a moving subject, and would let a write land in Firestore
// after PostgreSQL became authoritative, where nothing would ever read it again.
//
// So the freeze lives in the SERVER writers as well, and this module is the one place that decides
// whether they may write.
//
// ════════════════════ WHAT IT FREEZES, AND WHAT IT MUST NOT ════════════════════
//
// The Reorder chain ONLY: reorder_requests, reorder_purchase_orders, reorder_purchase_order_voids,
// and the legacy REORDER_PURCHASE_ORDER receiving path that closes a Reorder out.
//
// It deliberately does NOT freeze the canonical PURCHASE_ORDER authority. That is a different
// business authority with its own Firebase-exit cutover, its own population and its own timing, and
// freezing it here would stop a workflow this cutover has no mandate over. A canonical receipt must
// keep working unchanged while the Reorder chain is frozen -- which is exactly why the guard is
// called on the legacy branch of the receiving command and not at its entry point.
//
// ════════════════════ IT FAILS CLOSED, AND SAYS WHY ════════════════════
//
// A frozen writer does not return a generic permission error, and it certainly does not succeed
// quietly. It throws a typed refusal naming the cutover, so an operator reading a log sees "this was
// refused because the Reorder source is frozen for migration" rather than something they would
// reasonably diagnose as a broken deployment or an expired token.

/** Every legacy Reorder SOURCE writer, mechanically enumerable. */
export const REORDER_SOURCE_WRITERS = Object.freeze([
  /** reorderCallables.persistCreatedReorderRequest -- creates the Firestore Reorder Request. */
  "createReorderRequest",
  /** reorderCallables.persistRecordedReorderPurchaseOrder -- writes the PO and moves the Reorder to ORDERED. */
  "recordReorderPurchaseOrder",
  /**
   * receiveInventoryStockCommand, LEGACY BRANCH ONLY -- the ORDERED -> RECEIVED write the first
   * census missed. The canonical branch of the same command is NOT frozen.
   */
  "receiveInventoryStockLegacyReorder",
] as const);
export type ReorderSourceWriter = (typeof REORDER_SOURCE_WRITERS)[number];

/**
 * IS THE LEGACY REORDER SOURCE FROZEN?
 *
 * A single constant rather than an environment variable, for the same reason the receiving
 * activation boundary is one: freezing the source is a reviewed, tested, deployed decision, not a
 * runtime setting whose value has to be discovered from a dashboard to know what the system does.
 *
 * FALSE today. The freeze is BUILT and INERT: the PostgreSQL authority exists, the purchase-order
 * migration exists, and neither the copy nor the cutover has been run against the real source. Every
 * legacy writer still answers.
 *
 * Flipping it to true is the freeze itself, and it must be accompanied by the Rules arms that stop
 * the browser -- neither half is sufficient alone.
 */
export const REORDER_SOURCE_FROZEN = false;

export class ReorderSourceFrozenError extends Error {
  readonly code = "REORDER_SOURCE_FROZEN";
  /** So a transport can answer FAILED_PRECONDITION rather than a generic internal error. */
  readonly category = "PRECONDITION_FAILED";
  constructor(readonly writer: ReorderSourceWriter) {
    super(
      `the legacy Reorder source is frozen for the PostgreSQL cutover, so ${writer} cannot write to Firestore. `
      + "The governed PostgreSQL authority answers this now; a write accepted here would be invisible to it.",
    );
    this.name = "ReorderSourceFrozenError";
  }
}

/**
 * The gate. Call this BEFORE any legacy Reorder write, and let it throw.
 *
 * Deliberately NOT a boolean a caller can ignore. A writer that forgot to check a predicate looks
 * identical to one that checked and proceeded, and the census beside this module proves every listed
 * writer calls THIS function by name.
 */
export function assertReorderSourceWritable(writer: ReorderSourceWriter): void {
  if (REORDER_SOURCE_FROZEN) throw new ReorderSourceFrozenError(writer);
}
