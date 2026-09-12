// MIGRATION_ONLY -- the eos_ops PART-ID CONTRACT (P1B ruling R1).
//
// ════════════════════ THE ONE THING THIS ENFORCES ════════════════════
//
// Canonical inventory part identity is `Part.partId` -- the Part Master record's own id, which
// during the transition is also the Firestore `parts` document id. Nothing else is a part id:
// not an alias, not a supplier SKU, not a manufacturer part number, not a spreadsheet column, not
// a display name, and not one of the hardcoded catalog SKUs in `src/data/partsCatalog.ts` (that
// file is metadata with no identity authority -- see its own header).
//
// ════════════════════ WHY A FUNCTION AND NOT A CODE REVIEW ════════════════════
//
// Every eos_ops row that carries a `part_id` -- a cycle-count line, an inventory movement -- takes
// that value from whatever string its caller passed. `openLine(pool, tenant, actor, sheetId,
// partId, ...)` in ../cycleCountRepository.ts accepts ANY string. A migration that hands it a
// display name instead of a Part id does not fail: it writes a row that looks correct and joins to
// nothing, and the mistake is only discoverable later, as a reconciliation that does not balance.
//
// So the refusal has to be mechanical and it has to happen at the boundary, before the value
// reaches SQL. Migration code calls requireCanonicalPartId(value) and gets back the SAME string or
// an exception -- never a different string.
//
// ════════════════════ WHAT THIS DELIBERATELY DOES NOT DO ════════════════════
//
//   * NO ALIAS TRANSLATION. It never consults part_aliases, the alias resolver, or the scanner
//     lookup. An alias is a way to FIND a part; it is not the part's identity. A translating
//     validator would make "identity" depend on alias-table state at migration time, so the same
//     input could migrate to two different part ids on two different runs.
//   * NO CATALOG FALLBACK. It never reads `src/data/partsCatalog.ts`. There is no "if it is not a
//     Part id, try the catalog" branch, which is exactly the branch that would quietly accept a
//     legacy SKU or a part NAME and make up an identity for it.
//   * NO SUBSTITUTE ID. The function takes ONE value and has no second parameter, no options
//     object, and no field-picking: a caller cannot pass `{ partId, displayId }`, `{ sku }`, or any
//     other shape and have a substitute selected. A non-string is refused outright.
//   * NO REWRITING. A value that is not ALREADY canonical is refused rather than trimmed or
//     upper-cased into one. Silent normalization is how a migration ends up writing an id the
//     source system never had.
//
// It also performs no lookup of any kind, so it needs no Firestore, no Pool, and no I/O: this is a
// FORMAT + EXACTNESS gate. Whether the part actually EXISTS is a separate question, answered by
// the authority that owns the parts table -- never guessed here.
//
// ════════════════════ WHY IT BORROWS THE PART MASTER FORMAT RULE ════════════════════
//
// `parsePartId` in ../../partMaster/validation.ts is the single existing definition of what a
// well-formed `Part.partId` looks like, and it is pure (no firebase, no persistence -- see that
// module's header). Re-stating the pattern here would create a second definition of "canonical",
// and the two would drift. Importing it means canonical means exactly what Part Master says it
// means, by construction. This file adds the STRICTER half -- exactness and the no-fallback
// guarantees above -- that a migration boundary needs and a create-time parser does not.
import { parsePartId } from "../../partMaster/validation";

export type PartIdContractCode =
  /** The caller passed something that is not a string at all (object, number, null, undefined). */
  | "NOT_A_STRING"
  /** Empty, or nothing but whitespace. */
  | "EMPTY"
  /** A string, but not a well-formed canonical Part.partId. */
  | "NOT_CANONICAL"
  /** Canonical once trimmed -- refused rather than silently rewritten into the canonical form. */
  | "NOT_EXACT";

/** eos_ops error idiom (see CycleCountRepositoryError): a stable `code` plus a human message. */
export class PartIdContractError extends Error {
  constructor(readonly code: PartIdContractCode, message: string) {
    super(message);
  }
}

/**
 * THE migration boundary gate. Returns the value UNCHANGED when it is a canonical `Part.partId`;
 * throws PartIdContractError otherwise. It never returns a different string than it was given.
 *
 * `context` is a label for the error message only (e.g. "cycle_count_lines.part_id"). It cannot
 * influence acceptance, and it is never a place to pass a fallback id.
 */
export function requireCanonicalPartId(value: unknown, context = "part_id"): string {
  if (typeof value !== "string") {
    throw new PartIdContractError(
      "NOT_A_STRING",
      `${context} must be the canonical Part.partId string; received ${describe(value)}`,
    );
  }
  if (value.trim().length === 0) {
    throw new PartIdContractError("EMPTY", `${context} must be a non-empty canonical Part.partId`);
  }
  const parsed = parsePartId(value);
  if (!parsed.valid) {
    throw new PartIdContractError(
      "NOT_CANONICAL",
      `${context} ${JSON.stringify(value)} is not a canonical Part.partId; an alias, SKU, ` +
        "manufacturer number or display name is never substituted for one",
    );
  }
  if (parsed.value !== value) {
    // parsePartId trims; a migration must not. If the source value needs rewriting to become
    // canonical, the source value is not the identity -- fix it upstream, visibly.
    throw new PartIdContractError(
      "NOT_EXACT",
      `${context} ${JSON.stringify(value)} is not already canonical; it is never trimmed or ` +
        "rewritten into one",
    );
  }
  return value;
}

/** Non-throwing companion for callers that need to PARTITION rows rather than fail the first one. */
export function isCanonicalPartId(value: unknown): boolean {
  try {
    requireCanonicalPartId(value);
    return true;
  } catch {
    return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
