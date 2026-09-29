// CYCLE COUNT ZERO-POPULATION CENSUS -- the first gate of the EOS Cycle Count activation
// (cycleCountWriterState.ts; Controller ruling DQ-018; Owner ruling 2026-09-20).
//
// The 2026-09-20 ruling: Cycle Count is a ZERO-POPULATION RECONCILIATION. Its v1 records (the retired
// single-part model, schemaVersion 1) are LEGACY_HISTORICAL_EVIDENCE -- not migration volume, and never
// deleted. If ANY schemaVersion=2 sheet (the live sheet/line model) exists at the cutover window, STOP:
// that is real, open-or-closed work in the Firestore authority and it needs a genuine migration, which
// this cutover does not perform.
//
// PURE. It classifies the top-level `cycle_counts` documents of an offline snapshot. It repairs, deletes
// and migrates nothing; its only output is a verdict:
//   ZERO_POPULATION         no v2 sheet, no unclassifiable document -> the gate is open
//   V2_SHEETS_PRESENT       STOP (per ruling) -- lists the sheet ids and their statuses
//   UNCLASSIFIABLE_PRESENT  STOP -- a document that is neither v1 nor v2 is a governed-decision finding
export type CycleCountCensusVerdict = "ZERO_POPULATION" | "V2_SHEETS_PRESENT" | "UNCLASSIFIABLE_PRESENT";

export interface CycleCountCensus {
  readonly total: number;
  readonly legacyV1: number;
  readonly v2Sheets: number;
  readonly v2ByStatus: Readonly<Record<string, number>>;
  readonly v2SheetIds: readonly string[];
  readonly unclassifiable: number;
  readonly unclassifiableIds: readonly string[];
  readonly verdict: CycleCountCensusVerdict;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function censusCycleCountDocuments(docs: readonly { readonly id: string; readonly data: unknown }[]): CycleCountCensus {
  let legacyV1 = 0;
  const v2: string[] = [];
  const byStatus: Record<string, number> = {};
  const bad: string[] = [];
  for (const d of docs) {
    const data = d.data;
    if (!isPlain(data)) { bad.push(d.id); continue; }
    if (data.schemaVersion === 1) { legacyV1 += 1; continue; }
    if (data.schemaVersion === 2) {
      v2.push(d.id);
      const status = typeof data.status === "string" ? data.status : "UNKNOWN_STATUS";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      continue;
    }
    bad.push(d.id);
  }
  const verdict: CycleCountCensusVerdict = bad.length > 0 ? "UNCLASSIFIABLE_PRESENT" : v2.length > 0 ? "V2_SHEETS_PRESENT" : "ZERO_POPULATION";
  return Object.freeze({
    total: docs.length, legacyV1, v2Sheets: v2.length, v2ByStatus: Object.freeze({ ...byStatus }),
    v2SheetIds: Object.freeze([...v2].sort()), unclassifiable: bad.length, unclassifiableIds: Object.freeze([...bad].sort()), verdict,
  });
}
