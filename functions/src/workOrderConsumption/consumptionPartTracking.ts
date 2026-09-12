// HOW A CONSUMED PART IS COUNTED IS THE PART'S ANSWER — never the writer's, and never the caller's.
//
// ════════════════════ THE DIVERGENCE THIS FILE EXISTS TO REMOVE ════════════════════
//
// Work Order usage capture had TWO answers to "what tracking mode is this part?", and neither of
// them asked the Part:
//
//   · The WRITE path hardcoded `const trackingMode = "NONE"` (planPhysicalConsumption.ts). Every
//     physical consumption row was posted as quantity-tracked stock regardless of what the part is.
//   · The READ path took `trackingMode` off the callable REQUEST (consumptionSourceCallables.ts),
//     defaulting to "NONE" — so the caller asserted a fact the Part owns, and no shipped client
//     ever sent it, making the resolver's SERIAL branch unreachable in practice.
//
// The consequence was not cosmetic. `trackingMode` is what the ledger uses to decide whether a row
// is quantity stock at all: inventoryLedger/locationOnHand.ts skips every row whose mode is not
// "NONE", and inventoryLedger/mobileLocationPresenceProbe.ts skips them because "SERIAL custody is
// authoritative via serialized_assets". A SERIALIZED part consumed on a Work Order therefore posted
// a NONE row that WAS counted against quantity on-hand, while serialized_assets still showed the
// unit sitting where it had been — one physical unit, two contradicting authorities. It also walked
// past the shape rules the ledger validator applies per mode (SERIAL means quantity exactly 1 and a
// required serialNo — operationalMovementValidation.ts), because a NONE row is never asked for them.
//
// ════════════════════ WHY REFUSE RATHER THAN SUPPORT ════════════════════
//
// Work Order usage capture is a QUANTITY workflow end to end: the technician presses + and -, and
// nothing in it ever names a serial number or a lot. There is no serial identity to record, so the
// honest answer is that this path cannot record this part's usage — not that it can, as a number.
// This is the same refusal, for the same reason, that dataImport/openingInventoryBalance.ts already
// makes for the same shape of input ("a quantity-only row cannot establish SERIAL identity").
//
// ════════════════════ WHAT THIS DELIBERATELY DOES NOT DO ════════════════════
//
//   * NO SECOND MAPPING. controlType → trackingMode is partMaster/controlTypeTrackingMode.ts's one
//     definition, imported, never restated. Part identity and the `parts` collection are Part
//     Master's; this module defines neither, and does not read them either: the Firestore read lives
//     in consumptionSourceService.ts with the workflow's other reads, so this file stays PURE —
//     no persistence import, independently testable, and adding no Firebase dependency.
//   * NO NEW EXISTENCE REQUIREMENT. A Work Order whose planned line resolves to no Part document
//     gets the behaviour it has today. The Part authority said nothing, so nothing is inferred from
//     its silence: whether a plan line must resolve to a real Part is a separate question, owned by
//     the planning producer, and answering it here would be this change quietly becoming another.
//   * NO CORRECTION BLOCKING. Only ADDING physical consumption consults this. Reversing consumption
//     that already exists reverses the lineage it actually has — see planPhysicalConsumption.ts's
//     ruling on pre-authority records.
import {
  controlTypeToTrackingMode,
  type ControlTypeTrackingMode,
} from "../partMaster/controlTypeTrackingMode.js";

/** The only mode Work Order usage capture can record: a quantity, with no identity of its own. */
export const WORK_ORDER_CONSUMPTION_TRACKING_MODE: ControlTypeTrackingMode = "NONE";

/** The refusal code a caller sees, and the one the client branches on. */
export const PART_NOT_QUANTITY_TRACKED = "PART_NOT_QUANTITY_TRACKED";

/** Concrete and actionable, never a code — the wording rule the rest of this workflow follows. */
export function partNotQuantityTrackedMessage(trackingMode: string): string {
  return (
    `Work Order usage capture records quantities only. This part is ${trackingMode}-tracked, and a ` +
    `quantity-only entry cannot establish ${trackingMode} identity, so its usage cannot be recorded here.`
  );
}

export function isQuantityTracked(trackingMode: string): boolean {
  return trackingMode === WORK_ORDER_CONSUMPTION_TRACKING_MODE;
}

/** The mode to use for `partId`, with the Part's silence meaning today's behaviour (see the header). */
export function consumptionTrackingModeFor(
  modes: ReadonlyMap<string, ControlTypeTrackingMode>,
  partId: string,
): ControlTypeTrackingMode {
  return modes.get(partId) ?? WORK_ORDER_CONSUMPTION_TRACKING_MODE;
}

/**
 * Derive one Part's mode from its stored `controlType`, for the reader that fetched it.
 *
 * `?? "STANDARD"` matches the existing Part reader (dataImport/firestoreInventoryImportAdapters.ts):
 * a stored Part with no controlType is ordinary countable stock. An UNRECOGNIZED controlType is a
 * different case and is NOT defaulted — controlTypeToTrackingMode resolves it to LOT, which this
 * workflow refuses, exactly as that mapping's own header intends.
 */
export function trackingModeFromStoredControlType(controlType: unknown): ControlTypeTrackingMode {
  return controlTypeToTrackingMode(String(controlType ?? "STANDARD"));
}
