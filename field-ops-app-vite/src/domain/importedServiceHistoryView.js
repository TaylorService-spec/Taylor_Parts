// Imported historical service -- the PURE view model.
//
// No React, no firebase, no DOM. What this decides is how a record of somebody else's system
// is presented next to EOS's own work, and the whole design is one rule:
//
//   AN IMPORTED RECORD MUST NEVER BE MISTAKEN FOR A WORK ORDER.
//
// Not in the label, not in the counts, not in the shape of a row, and not by an absence that
// looks the same as a Work Order's absence. It is a separate source, separately stated, and it
// is the caller's job to render it separately -- this module makes that easy and makes the
// alternative awkward.
//
// ============================ WHY IT IS NOT MERGED INTO THE TIMELINE ============================
//
// One chronological list containing both would read better and be worse. A Work Order row
// carries a status, a schedule and an assigned technician -- live facts about a job EOS is
// running. An imported row has none of those and never will: it describes work another system
// finished years ago. Interleaving them would put four empty cells beside every historical row
// and invite exactly the reading this must prevent, that the blank ones are jobs EOS somehow
// lost track of.
//
// So: two lists, two headings, one page.

/**
 * The inert source: nothing was asked.
 *
 * Lives HERE rather than in the access seam because it is a pure value, and the seam exists to
 * keep `firebase` away from everything testable without it -- a test importing the seam for one
 * constant would drag the SDK in behind it.
 *
 * It is NOT the same as an empty successful read, and the builder below keeps the two apart.
 */
export function inertImportedServiceHistorySource() {
  return { ok: true, rows: [], truncated: false, inert: true };
}

/** The label every imported row carries. One string, so it cannot be worded two ways. */
export const IMPORTED_HISTORY_LABEL = "IMPORTED HISTORY";

export const IMPORTED_HISTORY_STATE = Object.freeze({
  /** Nothing was asked -- not the same as asked-and-found-nothing. */
  INERT: "INERT",
  LOADING: "LOADING",
  /** The caller may not read this customer. Distinct from a failure. */
  DENIED: "DENIED",
  ERROR: "ERROR",
  EMPTY: "EMPTY",
  READY: "READY",
});

/**
 * Build the section's view.
 *
 * `source` is what the seam returned: `{ ok, rows, truncated, code?, inert? }`.
 */
export function buildImportedServiceHistoryView({ loading = false, source = null } = {}) {
  if (loading) {
    return { state: IMPORTED_HISTORY_STATE.LOADING, rows: [], label: IMPORTED_HISTORY_LABEL };
  }
  if (!source || source.inert === true) {
    // INERT renders nothing at all. A customer page must not grow a permanent "no imported
    // history" line for the overwhelming majority of customers who never had any -- that is
    // noise about a migration that is over, on every record, forever.
    return { state: IMPORTED_HISTORY_STATE.INERT, rows: [], label: IMPORTED_HISTORY_LABEL };
  }
  if (source.ok !== true) {
    return {
      state: source.code === "denied" ? IMPORTED_HISTORY_STATE.DENIED : IMPORTED_HISTORY_STATE.ERROR,
      rows: [],
      label: IMPORTED_HISTORY_LABEL,
    };
  }

  const rows = (Array.isArray(source.rows) ? source.rows : []).map(toDisplayRow);
  if (rows.length === 0) {
    // Also renders nothing, for the same reason as INERT: a customer with no imported history
    // is the normal case, and stating it on every customer page is a sentence nobody needs.
    return { state: IMPORTED_HISTORY_STATE.EMPTY, rows: [], label: IMPORTED_HISTORY_LABEL };
  }

  return {
    state: IMPORTED_HISTORY_STATE.READY,
    rows,
    label: IMPORTED_HISTORY_LABEL,
    truncated: source.truncated === true,
    heading: "Imported historical service",
    // Said once, above the list, rather than implied by the badge alone. Somebody scanning a
    // customer page needs to know what they are looking at before they read a row.
    lede:
      "Service performed before EOS, loaded from your previous system. These are records, not Work Orders: nothing here was scheduled, dispatched or worked in EOS.",
  };
}

/**
 * One stored row -> one display row.
 *
 * Every historical field states its own absence rather than rendering blank, in the same
 * grammar the Work Order rows beside it use ("Not scheduled", "Unassigned") -- because a blank
 * cell reads as a rendering failure and these rows genuinely often lack a technician.
 *
 * The technician and the serial are labelled AS RECORDED, which is the honest description:
 * they are text a former system held, they were never resolved to an EOS employee or an EOS
 * equipment record, and the canonical model does not prove either identity.
 */
function toDisplayRow(row) {
  return Object.freeze({
    id: String(row?.id ?? ""),
    reference: nonEmpty(row?.externalReference) ?? "No reference recorded",
    serviceDate: nonEmpty(row?.serviceDate) ?? "Date not recorded",
    summary: nonEmpty(row?.summary) ?? "No description recorded",
    technician: nonEmpty(row?.technicianName),
    equipmentSerial: nonEmpty(row?.equipmentSerialNumber),
    location: nonEmpty(row?.locationName),
    label: IMPORTED_HISTORY_LABEL,
    /**
     * FALSE, always, and asserted by a test.
     *
     * A consumer asking "is this a Work Order" must get a definite no from the data rather
     * than having to know. A code path that had to remember would eventually forget.
     */
    isWorkOrder: false,
  });
}

function nonEmpty(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

/**
 * Does this view contribute to Work Order counts? Never.
 *
 * Exists as a function rather than as a comment so the answer is executable: the Service
 * Activity counts are Work Order counts, and imported history must not move them by one.
 */
export function importedHistoryWorkOrderCount() {
  return 0;
}
