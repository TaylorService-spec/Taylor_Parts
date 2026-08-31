// THE ONE VOCABULARY for non-PO acquisition reasons.
//
// The stored values are the closed set the governed command declares
// (`functions/src/serializedAsset/acquireSerializedAssetCommand.ts` → `ACQUISITION_REASONS`), and an
// unrecognised value is REFUSED there rather than coerced to a default. This module is the display
// half of the same rule: the machine values are never shown to a person, and the words are never
// invented at a call site.
//
// "WE BOUGHT IT" IS DELIBERATELY NOT IN THE SET, and that absence is the whole design. A purchased
// unit has a purchase order and belongs in Receiving; the moment acquisition could express a
// purchase, it would become a way around procurement rather than an exception beside it.
//
// The three that ARE here name real situations a business has:
//
//   OPENING_BALANCE          what was already in the building on the day EOS started counting
//   LEGACY_MIGRATION         what an older system recorded and this one has to inherit
//   EXISTING_COMPANY_ASSET   a machine the company owns that was never in any system

/** Stored values — the command's closed set, mirrored, never widened here. */
export const ACQUIRE_REASON = Object.freeze({
  OPENING_BALANCE: "OPENING_BALANCE",
  LEGACY_MIGRATION: "LEGACY_MIGRATION",
  EXISTING_COMPANY_ASSET: "EXISTING_COMPANY_ASSET",
});

/** Stored value -> the words a user reads. */
export const ACQUIRE_REASON_LABEL = Object.freeze({
  [ACQUIRE_REASON.OPENING_BALANCE]: "Opening balance",
  [ACQUIRE_REASON.LEGACY_MIGRATION]: "Legacy migration",
  [ACQUIRE_REASON.EXISTING_COMPANY_ASSET]: "Existing company asset",
});

/** What each one MEANS, for the person choosing. A label alone does not distinguish three reasons. */
export const ACQUIRE_REASON_HINT = Object.freeze({
  [ACQUIRE_REASON.OPENING_BALANCE]: "Already in the building when this system started counting.",
  [ACQUIRE_REASON.LEGACY_MIGRATION]: "Carried over from a system this one replaced.",
  [ACQUIRE_REASON.EXISTING_COMPANY_ASSET]: "A machine the company owns that was never recorded anywhere.",
});

/** Declaration order, for a picker that must not reorder itself between renders. */
export const ACQUIRE_REASON_VALUES = Object.freeze(Object.keys(ACQUIRE_REASON_LABEL));

/**
 * Display text for a stored reason.
 *
 * An unrecognised value returns null rather than the raw token or a guess — the same fail-closed
 * choice the command makes. A caller decides how to render "we don't know"; it must not print
 * LEGACY_MIGRATION at a person.
 */
export function acquireReasonLabel(reason) {
  return ACQUIRE_REASON_LABEL[reason] ?? null;
}
