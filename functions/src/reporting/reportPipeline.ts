// THE REPORT PIPELINE -- the PURE in-memory query core of a report run: filter, sort, group, aggregate, project, and the two completeness
// judgements. Firebase exit B4 (DECISIONS #B4).
//
// This is a COPY (with ONE deliberate divergence, noted at sortRows) of the helpers that sit privately inside reportExecutionService.ts (the Firebase engine), made so the EOS report engine
// (eosOps/reportOperations.ts) can run the SAME query semantics over rows read from PostgreSQL WITHOUT importing a module that reaches
// firebase-admin. The Firebase engine is retirement-only (level C) and is deliberately not edited here, so the duplication is bounded and
// temporary: when that engine is retired this becomes the only copy. functions/test/reportPipeline.test.mjs pins each helper's behaviour with the
// cases the Firebase engine's own suites (reportExecutionService.test.mjs) assert, so the semantics are held by tests rather than by a promise.
//
// Everything here is a function of its arguments. No clock, no I/O, no module-level mutable state, and no authorization decision: which fields
// a runner may read is decided BEFORE a row reaches this file (reportOperations.ts), and only authorized fields are ever passed in.
import { getReportField, type ReportField } from "./reportCatalog";
import { isFieldlessAggregate } from "./reportQueryModel";

/** Spec sec10's starting bounds (an Owner decision still open: ADR-007 sec4 open decision 3). Stricter can only under-serve, never leak. */
export const MAX_RESULT_ROWS = 10_000;
export const MAX_GROUP_CARDINALITY = 1_000;
export const MAX_SCAN_DOCS = MAX_RESULT_ROWS * 2;

export type Doc = Record<string, unknown>;

// ---------------------------------------------------------------------
// completeness judgements (census X-9, FIN-004, RPT-FIX, CI-UNBLOCK-1899)
// ---------------------------------------------------------------------
export type ScanCompletenessVerdict = "complete" | "bounded-page" | "refuse-incomplete-total";

/** Only SCAN truncation can corrupt an aggregate: a total over a cut population is a number smaller than the truth, so it is REFUSED. */
export function judgeScanCompleteness(input: { scanTruncated: boolean; hasAggregates: boolean }): ScanCompletenessVerdict {
  if (!input.scanTruncated) return "complete";
  return input.hasAggregates ? "refuse-incomplete-total" : "bounded-page";
}

export type AbsenceVerdict = "proven-absence" | "refuse-unproven-absence" | "not-an-absence";

/** Zero rows out of a truncated scan (or an incomplete join) is not a proven "no results". */
export function judgeAbsenceProvenance(input: { scanTruncated: boolean; rowCount: number; joinIncomplete?: boolean }): AbsenceVerdict {
  if (input.rowCount > 0) return "not-an-absence";
  if (input.scanTruncated) return "refuse-unproven-absence";
  return input.joinIncomplete ? "refuse-unproven-absence" : "proven-absence";
}

// ---------------------------------------------------------------------
// field access
// ---------------------------------------------------------------------
/** fieldId is always `${objectId}.${rawPath}` by catalog construction, so the raw path is a prefix strip. */
export function rawFieldPath(field: ReportField): string {
  return field.fieldId.slice(field.objectId.length + 1);
}

export function getAtPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && !Array.isArray(acc)) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, doc);
}

/** The ONE place that resolves a field id (own or joined) to a value, for filter, group, aggregate, sort and project alike. */
export function getFieldValue(doc: Doc, baseObjectId: string, field: ReportField): unknown {
  if (field.objectId === baseObjectId) return getAtPath(doc, rawFieldPath(field));
  const related = doc[`__related__${field.objectId}`] as Doc | undefined;
  return related ? getAtPath(related, rawFieldPath(field)) : undefined;
}

// ---------------------------------------------------------------------
// filter
// ---------------------------------------------------------------------
export function toComparableDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

export function matchesFilter(doc: Doc, objectId: string, flt: { fieldId: string; op: string; value: unknown }): boolean {
  const field = getReportField(flt.fieldId);
  if (!field) return true; // unresolvable somehow; the validator already guarantees this never happens for an active filter
  const raw = getFieldValue(doc, objectId, field);
  switch (flt.op) {
    case "eq":
      if (field.dataType === "date") {
        const r = toComparableDate(raw);
        const v = toComparableDate(flt.value);
        return r !== null && v !== null && r === v;
      }
      return raw === flt.value;
    case "ne":
      if (field.dataType === "date") {
        const r = toComparableDate(raw);
        const v = toComparableDate(flt.value);
        // `eq`'s complement exactly: unresolvable dates never match either "equal" or "not equal" (fail closed).
        return r !== null && v !== null && r !== v;
      }
      return raw !== flt.value;
    case "gt": return typeof raw === "number" && typeof flt.value === "number" && raw > flt.value;
    case "gte": return typeof raw === "number" && typeof flt.value === "number" && raw >= flt.value;
    case "lt": return typeof raw === "number" && typeof flt.value === "number" && raw < flt.value;
    case "lte": return typeof raw === "number" && typeof flt.value === "number" && raw <= flt.value;
    case "contains":
      if (Array.isArray(raw)) return typeof flt.value === "string" && (raw as unknown[]).includes(flt.value);
      return typeof raw === "string" && typeof flt.value === "string" && raw.includes(flt.value);
    case "startsWith": return typeof raw === "string" && typeof flt.value === "string" && raw.startsWith(flt.value);
    case "in": return Array.isArray(flt.value) && flt.value.includes(raw);
    case "before": return toComparableDate(raw) !== null && toComparableDate(flt.value) !== null && (toComparableDate(raw) as number) < (toComparableDate(flt.value) as number);
    case "after": return toComparableDate(raw) !== null && toComparableDate(flt.value) !== null && (toComparableDate(raw) as number) > (toComparableDate(flt.value) as number);
    case "between": {
      if (!Array.isArray(flt.value) || flt.value.length !== 2) return false;
      const r = toComparableDate(raw);
      const lo = toComparableDate(flt.value[0]);
      const hi = toComparableDate(flt.value[1]);
      return r !== null && lo !== null && hi !== null && r >= lo && r <= hi;
    }
    case "containsAny":
      return Array.isArray(raw) && Array.isArray(flt.value) && flt.value.some((v) => (raw as unknown[]).includes(v));
    default:
      return false; // unknown operator -- fail closed, never match
  }
}

// ---------------------------------------------------------------------
// group / aggregate
// ---------------------------------------------------------------------
export function groupDocuments(docs: Doc[], objectId: string, groupBy: readonly string[]): Map<string, Doc[]> {
  const groups = new Map<string, Doc[]>();
  for (const doc of docs) {
    const key = groupBy
      .map((fieldId) => {
        const field = getReportField(fieldId);
        if (!field) return "";
        return JSON.stringify(getFieldValue(doc, objectId, field) ?? null);
      })
      .join(" ");
    const bucket = groups.get(key);
    if (bucket) bucket.push(doc);
    else groups.set(key, [doc]);
  }
  return groups;
}

export function aggregateResultKey(agg: { fieldId?: string; fn: string }): string {
  return isFieldlessAggregate(agg.fn) ? agg.fn : `${agg.fn}(${agg.fieldId})`;
}

export function computeAggregate(rows: Doc[], objectId: string, agg: { fieldId?: string; fn: string }): number {
  if (isFieldlessAggregate(agg.fn)) return rows.length; // countRows: bounded by the runner's own authorized/filtered row set
  const field = getReportField(agg.fieldId as string);
  if (!field) return 0;
  const values = rows.map((doc) => getFieldValue(doc, objectId, field)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  switch (agg.fn) {
    case "count": return values.length;
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case "min": return values.length > 0 ? Math.min(...values) : 0;
    case "max": return values.length > 0 ? Math.max(...values) : 0;
    default: return 0;
  }
}

// ---------------------------------------------------------------------
// sort / project
// ---------------------------------------------------------------------
function toTimestampMillis(value: unknown): number | null {
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

/** Two numbers compare numerically; a Timestamp-shaped value by millis; everything else as a string. null/undefined always sort LAST. */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const aMillis = toTimestampMillis(a);
  const bMillis = toTimestampMillis(b);
  if (aMillis !== null && bMillis !== null) return aMillis - bMillis;
  return String(a).localeCompare(String(b));
}

/** Keys applied in REVERSE with a stable sort, so the first key is the primary one. */
export function sortRows(rows: Doc[], objectId: string, sort: readonly { fieldId: string; direction: "asc" | "desc" }[]): Doc[] {
  if (sort.length === 0) return rows;
  const sorted = [...rows];
  for (const s of [...sort].reverse()) {
    const field = getReportField(s.fieldId);
    if (!field) continue;
    sorted.sort((a, b) => {
      const av = getFieldValue(a, objectId, field);
      const bv = getFieldValue(b, objectId, field);
      // NULLS LAST IN BOTH DIRECTIONS -- the documented intent of the Firebase engine ("always sorts last, regardless of asc/desc"). Its code flips the sign of
      // compareValues for `desc`, which puts an absent value FIRST; that quirk is deliberately NOT carried across (DECISIONS #B4 records the one divergence).
      const aAbsent = av === undefined || av === null;
      const bAbsent = bv === undefined || bv === null;
      if (aAbsent || bAbsent) return aAbsent && bAbsent ? 0 : aAbsent ? 1 : -1;
      const cmp = compareValues(av, bv);
      return s.direction === "desc" ? -cmp : cmp;
    });
  }
  return sorted;
}

/** A field the runner may not read is ABSENT from the payload -- never blanked, never returned-then-hidden. */
export function projectDoc(doc: Doc, baseObjectId: string, activeFields: readonly string[]): Doc {
  const projected: Doc = {};
  for (const fieldId of activeFields) {
    const field = getReportField(fieldId);
    if (!field) continue;
    projected[fieldId] = getFieldValue(doc, baseObjectId, field) ?? null;
  }
  return projected;
}
