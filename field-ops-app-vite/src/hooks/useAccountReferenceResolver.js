import { useCallback, useMemo } from "react";
import { useAccountNamesWithStatus, ACCOUNT_NAMES_STATUS } from "./useAccountNames.js";
import { REFERENCE_STATE } from "../metadata/referenceResolution.js";

// RESOLVE ACCOUNT REFERENCES FOR A METADATA LIST, IN ONE BATCHED READ.
//
// ============================ WHAT THIS REPLACES ============================
//
// Every REFERENCE column on every metadata-driven list rendered "Unresolved reference". The Sales
// Orders list showed it on all 14 rows while all 14 `accountId` values resolved to a real customer
// -- the data was never the problem. `useMetadataList` accepted no resolver, so `cellValue` had no
// way to turn an id into a name and correctly refused to print the id itself.
//
// This is the resolver those lists were missing. It exists as a hook rather than as a copy inside
// each screen because the same reference (an account id) appears on Sales Orders, Opportunities,
// Invoices, Equipment, Contacts and Locations -- six chances to write six slightly different
// fallbacks, one of which would eventually print an id.
//
// ============================ ONE READ, NOT ONE PER ROW ============================
//
// The ids are collected from the loaded rows and resolved with a single chunked
// `documentId() in` read. Resolving inside the cell renderer would issue a read per row, which the
// presentation contract rules out by name.
//
// ============================ IT REPORTS WHY, NOT JUST THAT ============================
//
// A missing name means different things depending on how the read went, and the hook that fetches
// them now says which:
//
//   LOADING  -> the answer has not arrived. Not "missing".
//   DENIED   -> the caller may not read accounts. Says NOTHING about whether the record exists,
//               and the rendered label deliberately carries no name or id.
//   READY    -> the read completed. An id with no name genuinely does not exist -> NOT_FOUND.
//   ERROR    -> resolution failed; a retry may work.
//
// Collapsing these into one label is what made the original defect unreadable: "Unresolved
// reference" gave an operator no way to tell a broken fixture from a narrow role.

/** Account-id-shaped reference fields, and the entity they point at. */
const ACCOUNT_REFERENCE_FIELDS = Object.freeze(["accountId", "customerId"]);

/**
 * Build a `resolveReference` for a metadata list whose rows carry account references.
 *
 * @param rows loaded list rows (from useMetadataList's `rows`)
 * @param fieldIds which REFERENCE columns are account-shaped; defaults to accountId/customerId
 * @returns { resolveReference, status, names }
 */
export function useAccountReferenceResolver(rows, fieldIds = ACCOUNT_REFERENCE_FIELDS) {
  const fields = useMemo(() => new Set(fieldIds), [fieldIds]);

  // Sorted + de-duplicated so the identity is stable across renders that changed nothing relevant;
  // the underlying hook keys its effect on exactly this shape.
  const accountIds = useMemo(() => {
    const ids = new Set();
    for (const row of rows ?? []) {
      for (const f of fields) {
        const v = row?.[f];
        if (typeof v === "string" && v) ids.add(v);
      }
    }
    return Array.from(ids).sort();
  }, [rows, fields]);

  const { names, status } = useAccountNamesWithStatus(accountIds);

  const resolveReference = useCallback(
    (fieldId, id) => {
      // Not an account reference. Returning undefined leaves the field to any other resolver and
      // renders the honest unresolved label -- it does NOT claim the reference is broken.
      if (!fields.has(fieldId)) return undefined;

      const name = names.get(id);
      if (name) return name;

      // No name yet. WHY decides what the reader is told.
      if (status === ACCOUNT_NAMES_STATUS.DENIED) return { state: REFERENCE_STATE.DENIED };
      if (status === ACCOUNT_NAMES_STATUS.ERROR) return { state: REFERENCE_STATE.ERROR };
      if (status === ACCOUNT_NAMES_STATUS.LOADING || status === ACCOUNT_NAMES_STATUS.IDLE) {
        return { state: REFERENCE_STATE.LOADING };
      }
      // READY and still absent: the read succeeded and this id was not among the results.
      return { state: REFERENCE_STATE.NOT_FOUND };
    },
    [fields, names, status],
  );

  return { resolveReference, status, names };
}
