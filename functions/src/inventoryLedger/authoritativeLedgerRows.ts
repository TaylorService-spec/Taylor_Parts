// AUTHORITATIVE LEDGER ROWS -- the one fail-closed read of `inventory_transactions` for any result
// that decides something (transfer sufficiency, relocation sufficiency, a cycle count's expected
// quantity, a truck's presence, ...).
//
// ════════════════════ WHY SKIPPING A MALFORMED ROW IS NOT SAFE (Controller ruling DQ-019) ════════════════════
//
// Every reader used to `continue` past a row it could not classify or deserialize, with the comment
// "a malformed row is skipped, never trusted -- it never inflates on-hand". That is only true of a
// malformed CREDIT. A malformed DEBIT (a TRANSFER_OUT, a consumption, a negative ADJUSTED) that is
// skipped RAISES the sum: a transfer passes an INSUFFICIENT_STOCK check it should fail, a count
// "expects" stock that already left. A row whose meaning cannot be read cannot be signed either, so
// no reader can know which way skipping it errs. The only honest answer is to refuse.
//
// So a result computed over a set of rows that contains ANY unreadable row is not a result: it
// throws LedgerRowIntegrityError, and each domain maps that to its own integrity refusal. Nothing
// is repaired here -- repairing ambiguous ledger data is a governed decision, never a reader's.
//
// ════════════════════ WHAT IS STILL EXCLUDED, AND WHY THAT IS NOT A SKIP ════════════════════
//
// A LEGACY row (no schemaVersion, a legacy Work-Order transaction type) is well-formed and classified:
// it is a different population that carries no location and was never part of location-aware on-hand.
// Excluding it is a governed modelling rule (classifyLedgerDoc), not a silent skip of something
// unreadable, and it is counted separately by the pre-activation census below.
//
// PURE: no Firestore, no clock. Callers pass the documents their own transaction already read.
import { classifyLedgerDoc, deserializeOperationalMovement } from "./operationalMovementRepository.js";
import type { OperationalMovementValue } from "./operationalMovementTypes.js";

export class LedgerRowIntegrityError extends Error {
  constructor(readonly docId: string, readonly reason: "UNCLASSIFIABLE" | "UNREADABLE_OPERATIONAL") {
    super(`ledger row ${docId} is ${reason === "UNCLASSIFIABLE" ? "not a recognised ledger record" : "an operational record that cannot be read"}; the result is refused`);
    this.name = "LedgerRowIntegrityError";
  }
}

export interface LedgerDocLike {
  readonly id: string;
  data(): unknown;
}

/**
 * The operational movements in `docs`, or a refusal. Legacy rows are excluded (see header); ANY
 * malformed row -- unclassifiable, or classified operational but failing the strict deserializer --
 * throws LedgerRowIntegrityError naming the row id (never its contents).
 */
export function authoritativeOperationalMovements(docs: readonly LedgerDocLike[]): OperationalMovementValue[] {
  const out: OperationalMovementValue[] = [];
  for (const doc of docs) {
    const data = doc.data();
    const cls = classifyLedgerDoc(data);
    if (cls === "legacy") continue;
    if (cls !== "operational") throw new LedgerRowIntegrityError(doc.id, "UNCLASSIFIABLE");
    try {
      out.push(deserializeOperationalMovement(data).value);
    } catch {
      throw new LedgerRowIntegrityError(doc.id, "UNREADABLE_OPERATIONAL");
    }
  }
  return out;
}

// ════════════════════ THE PRE-ACTIVATION CENSUS ════════════════════
//
// The fail-closed read turns every malformed row into a refused action on its part. Before any
// inventory authority is activated (or copied to PostgreSQL), the population must be MEASURED so that
// refusal is a known quantity rather than a surprise on the warehouse floor. This census is that
// measurement: it classifies a snapshot of `inventory_transactions` and reports counts plus the ids
// (never the contents) of every row the authoritative read would refuse, and the parts they block.
// It repairs nothing; a non-zero malformed count is a finding for a governed decision.

export interface LedgerCensus {
  readonly total: number;
  readonly operational: number;
  readonly legacy: number;
  readonly malformed: number;
  readonly malformedByReason: Readonly<Record<"UNCLASSIFIABLE" | "UNREADABLE_OPERATIONAL", number>>;
  /** Row ids only, sorted. */
  readonly malformedRowIds: readonly string[];
  /** Parts whose authoritative reads would be refused (a malformed row naming a partId string), sorted. */
  readonly blockedPartIds: readonly string[];
  /** Malformed rows with no readable partId: they block nothing by part, but block any unfiltered read. */
  readonly malformedWithoutPartId: number;
  /** READY iff there is nothing the authoritative read would refuse. */
  readonly verdict: "READY" | "MALFORMED_ROWS_PRESENT";
}

export function censusLedgerRows(docs: readonly LedgerDocLike[]): LedgerCensus {
  let operational = 0;
  let legacy = 0;
  const byReason = { UNCLASSIFIABLE: 0, UNREADABLE_OPERATIONAL: 0 };
  const malformedIds: string[] = [];
  const blocked = new Set<string>();
  let withoutPart = 0;
  for (const doc of docs) {
    const data = doc.data();
    const cls = classifyLedgerDoc(data);
    if (cls === "legacy") { legacy += 1; continue; }
    let reason: "UNCLASSIFIABLE" | "UNREADABLE_OPERATIONAL" | null = null;
    if (cls !== "operational") reason = "UNCLASSIFIABLE";
    else {
      try { deserializeOperationalMovement(data); operational += 1; } catch { reason = "UNREADABLE_OPERATIONAL"; }
    }
    if (reason === null) continue;
    byReason[reason] += 1;
    malformedIds.push(doc.id);
    const partId = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).partId : undefined;
    if (typeof partId === "string" && partId.trim() !== "") blocked.add(partId);
    else withoutPart += 1;
  }
  const malformed = byReason.UNCLASSIFIABLE + byReason.UNREADABLE_OPERATIONAL;
  return Object.freeze({
    total: docs.length,
    operational,
    legacy,
    malformed,
    malformedByReason: Object.freeze({ ...byReason }),
    malformedRowIds: Object.freeze([...malformedIds].sort()),
    blockedPartIds: Object.freeze([...blocked].sort()),
    malformedWithoutPartId: withoutPart,
    verdict: malformed === 0 ? "READY" : "MALFORMED_ROWS_PRESENT",
  });
}
