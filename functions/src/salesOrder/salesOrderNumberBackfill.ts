// X-SALES-ORDER-NUMBER-BACKFILL -- INERT, UNEXPORTED backfill core for Sales Orders created before governed
// numbering existed (functions/src/salesOrder/salesOrderNumbering.ts). PURE and DETERMINISTIC classification +
// planning + the execute staging that assigns a `salesOrderNumber` to each unnumbered record THROUGH an
// injected transaction/store seam -- mirrors functions/src/warehouseGovernance/warehouseGovernanceMigration.ts's
// dry-run-default / fingerprint-bound / all-or-nothing pattern. NOT exported from functions/src/index.ts; no
// callable; no production read/write here (the operator CLI, functions/scripts/salesOrderNumberBackfillCli.js,
// wires real deps lazily and is dry-run by default). Reuses `formatSalesOrderNumber` /
// `salesOrderCounterDocId` from salesOrderNumbering.ts rather than reimplementing the format or the counter
// identity -- one format authority, never two.
//
// YEAR ASSIGNMENT POLICY (documented per the backfill authorization -- restated in
// docs/operations/sales-order-number-backfill-runbook.md):
//   - When a record's stored `createdAt` is a genuine Firestore Timestamp, it is AUTHORITATIVE: the year
//     portion of the assigned number is that Timestamp's UTC calendar year. This is the only case where the
//     assigned number's year carries real chronological meaning.
//   - When `createdAt` is missing, null, or not a Timestamp, historical ordering CANNOT be established from
//     the stored record. This tool does NOT invent a chronology it has no evidence for. Those records are
//     assigned the SENTINEL year `UNKNOWN_YEAR_SENTINEL` (0, rendered "SO-0000-######") -- a value that can
//     never collide with a real calendar year and is never presented as meaning "created in year 0". Within
//     the sentinel bucket, records are ordered by their Firestore document id (a stable, arbitrary, but fully
//     deterministic tiebreak) -- NOT by any inferred creation order.
//
// DETERMINISM: given the same live record set and the same counter state, `planBackfill` always produces the
// same assignment for every record, run after run. Ordering key: (year, createdAt millis when the year came
// from createdAt else a fixed value, salesOrderId) -- salesOrderId is always the final tiebreak so ties are
// never arbitrary between runs.
//
// IDEMPOTENCY: a record with ANY existing non-blank `salesOrderNumber` is classified ALREADY_NUMBERED and is
// never included in a plan's assignments -- never renumbered, never touched. Because `planBackfill` always
// reads live state fresh, a rerun after a partial execute naturally excludes everything already assigned and
// completes only the remainder.
//
// COLLISION DETECTION: every candidate number computed for assignment is checked against the FULL set of
// already-existing `salesOrderNumber` values (legacy or governed) live in the collection at plan time. Any
// candidate that would duplicate an existing value is a COLLISION -- recorded in the plan's `collisions` list,
// EXCLUDED from `assignments`, and its presence in a plan REFUSES the whole execute (zero writes) until the
// operator resolves the underlying data problem and reruns for a fresh plan. Once a year has a collision, no
// further NEEDS_ASSIGNMENT record in that same year is evaluated -- the deterministic sequence for that year is
// broken by the collision and cannot be safely continued -- those records are reported as `blocked` instead.
//
// EXECUTE SAFETY: execute is bound to a specific dry-run plan (content-hash-pinned by the CLI). It re-reads
// live state and recomputes the pre-state fingerprint of every planned record, plus the counter document for
// every touched year, before staging a single write; ANY drift -- a record that already got a number, a
// counter that moved, a record that vanished -- fails the WHOLE batch closed. This mirrors
// warehouseGovernanceMigration.ts's STALE_PRESTATE contract.

import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { formatSalesOrderNumber } from "./salesOrderNumbering.js";

export const UNKNOWN_YEAR_SENTINEL = 0;

// -------- sanitized error taxonomy --------
export type BackfillFailureCode =
  | "INVALID_INPUT"
  | "COLLISION_DETECTED"
  | "STALE_PRESTATE"
  | "COUNTER_DRIFT"
  | "LIVE_SET_DRIFT"
  | "PLAN_MISMATCH";

export class SalesOrderBackfillError extends Error {
  readonly code: BackfillFailureCode;
  constructor(code: BackfillFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

// -------- pure helpers --------
function isNonBlank(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}
function isTimestampLike(v: unknown): v is Timestamp {
  return v instanceof Timestamp;
}
function canonicalJson(value: unknown): string {
  if (value instanceof Timestamp) return `T:${value.toMillis()}`;
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Fingerprint over exactly the two fields the plan depends on -- so an unrelated field change elsewhere on
// the doc never blocks execute, but ANY change to salesOrderNumber or createdAt does.
export function recordFingerprint(fields: { salesOrderNumber: unknown; createdAt: unknown }): string {
  return sha256(canonicalJson({ salesOrderNumber: fields.salesOrderNumber ?? null, createdAt: fields.createdAt ?? null }));
}

// -------- classification --------
export type RecordCategory = "ALREADY_NUMBERED" | "NEEDS_ASSIGNMENT";
export type YearPolicy = "CREATED_AT" | "UNKNOWN_SENTINEL";

export interface RawSalesOrderRecord {
  readonly salesOrderId: string; // the Firestore document id -- identity, never reassigned
  readonly salesOrderNumber: unknown; // raw stored value; undefined/null/blank => unnumbered
  readonly createdAt: unknown; // raw stored value; only a real Timestamp is authoritative
}

export interface ClassifiedRecord {
  readonly salesOrderId: string;
  readonly category: RecordCategory;
  readonly year: number | null; // null when ALREADY_NUMBERED
  readonly yearPolicy: YearPolicy | null;
  readonly createdAtMillis: number | null;
  readonly fingerprint: string;
}

export function classifyRecord(record: RawSalesOrderRecord): ClassifiedRecord {
  const fingerprint = recordFingerprint(record);
  if (isNonBlank(record.salesOrderNumber)) {
    return {
      salesOrderId: record.salesOrderId,
      category: "ALREADY_NUMBERED",
      year: null,
      yearPolicy: null,
      createdAtMillis: null,
      fingerprint,
    };
  }
  if (isTimestampLike(record.createdAt)) {
    const millis = record.createdAt.toMillis();
    const year = new Date(millis).getUTCFullYear();
    return {
      salesOrderId: record.salesOrderId,
      category: "NEEDS_ASSIGNMENT",
      year,
      yearPolicy: "CREATED_AT",
      createdAtMillis: millis,
      fingerprint,
    };
  }
  return {
    salesOrderId: record.salesOrderId,
    category: "NEEDS_ASSIGNMENT",
    year: UNKNOWN_YEAR_SENTINEL,
    yearPolicy: "UNKNOWN_SENTINEL",
    createdAtMillis: null,
    fingerprint,
  };
}

// Deterministic sort key: (year, createdAt millis when known else a fixed max sentinel, salesOrderId).
// salesOrderId is always the final tiebreak, so ordering is never arbitrary between runs -- and within the
// UNKNOWN_SENTINEL year bucket, id is the ONLY tiebreak (there is no chronology to sort by).
function sortKey(c: ClassifiedRecord): string {
  const year = c.year ?? 0;
  const yearPart = String(year).padStart(6, "0");
  const millisPart = c.createdAtMillis === null ? "9".repeat(20) : String(c.createdAtMillis).padStart(20, "0");
  return `${yearPart}:${millisPart}:${c.salesOrderId}`;
}

// -------- planning --------
export interface CounterSnapshotEntry {
  readonly year: number;
  readonly sequenceBefore: number; // 0 when no counter doc exists yet for this year
}
export interface PlannedAssignment {
  readonly salesOrderId: string;
  readonly year: number;
  readonly yearPolicy: YearPolicy;
  readonly sequence: number;
  readonly salesOrderNumber: string;
  readonly fingerprint: string; // the record's pre-state fingerprint (unnumbered), re-checked at execute
}
export interface CollisionEntry {
  readonly salesOrderId: string;
  readonly year: number;
  readonly candidateSalesOrderNumber: string;
  readonly reason: "DUPLICATES_EXISTING_NUMBER";
}
export interface BlockedEntry {
  readonly salesOrderId: string;
  readonly year: number;
  readonly reason: "YEAR_BLOCKED_BY_EARLIER_COLLISION";
}
export interface BackfillPlan {
  readonly assignments: readonly PlannedAssignment[];
  readonly collisions: readonly CollisionEntry[];
  readonly blocked: readonly BlockedEntry[];
  readonly alreadyNumbered: readonly string[]; // ids skipped -- never renumbered
  readonly counterSnapshot: readonly CounterSnapshotEntry[]; // years touched, pinned "before" values
  readonly counts: {
    readonly total: number;
    readonly alreadyNumbered: number;
    readonly toAssign: number;
    readonly collisions: number;
    readonly blocked: number;
  };
}

// Read the counter's CURRENT sequence for a year, 0 if no counter doc exists yet. Pure function injected by
// the caller (the CLI reads real counters; tests supply a fixed map) -- planBackfill never touches Firestore.
export type CounterReader = (year: number) => number;

export function planBackfill(records: readonly RawSalesOrderRecord[], readCounterSequence: CounterReader): BackfillPlan {
  const seen = new Set<string>();
  const classified: ClassifiedRecord[] = [];
  for (const r of records) {
    if (!isNonBlank(r.salesOrderId)) throw new SalesOrderBackfillError("INVALID_INPUT", "salesOrderId invalid");
    if (seen.has(r.salesOrderId)) throw new SalesOrderBackfillError("INVALID_INPUT", "duplicate salesOrderId in input");
    seen.add(r.salesOrderId);
    classified.push(classifyRecord(r));
  }

  const alreadyNumbered = classified.filter((c) => c.category === "ALREADY_NUMBERED");
  const existingNumbers = new Set<string>();
  for (const r of records) {
    if (isNonBlank(r.salesOrderNumber)) existingNumbers.add(r.salesOrderNumber);
  }

  const needsAssignment = classified.filter((c) => c.category === "NEEDS_ASSIGNMENT").slice().sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const runningSequence = new Map<number, number>(); // year -> last sequence USED in this plan
  const touchedYears = new Set<number>();
  const blockedYears = new Set<number>();
  const assignments: PlannedAssignment[] = [];
  const collisions: CollisionEntry[] = [];
  const blocked: BlockedEntry[] = [];

  for (const c of needsAssignment) {
    const year = c.year as number;
    touchedYears.add(year);
    if (blockedYears.has(year)) {
      blocked.push({ salesOrderId: c.salesOrderId, year, reason: "YEAR_BLOCKED_BY_EARLIER_COLLISION" });
      continue;
    }
    if (!runningSequence.has(year)) runningSequence.set(year, readCounterSequence(year));
    const nextSeq = (runningSequence.get(year) as number) + 1;
    const candidate = formatSalesOrderNumber(year, nextSeq);
    if (existingNumbers.has(candidate)) {
      collisions.push({ salesOrderId: c.salesOrderId, year, candidateSalesOrderNumber: candidate, reason: "DUPLICATES_EXISTING_NUMBER" });
      blockedYears.add(year); // the sequence for this year is now undecidable -- do not keep guessing
      continue;
    }
    runningSequence.set(year, nextSeq);
    existingNumbers.add(candidate); // reserve within this plan too, so two backfilled records never collide
    assignments.push({
      salesOrderId: c.salesOrderId,
      year,
      yearPolicy: c.yearPolicy as YearPolicy,
      sequence: nextSeq,
      salesOrderNumber: candidate,
      fingerprint: c.fingerprint,
    });
  }

  const counterSnapshot: CounterSnapshotEntry[] = [...touchedYears]
    .sort((a, b) => a - b)
    .map((year) => ({ year, sequenceBefore: readCounterSequence(year) }));

  return {
    assignments,
    collisions,
    blocked,
    alreadyNumbered: alreadyNumbered.map((c) => c.salesOrderId),
    counterSnapshot,
    counts: {
      total: classified.length,
      alreadyNumbered: alreadyNumbered.length,
      toAssign: assignments.length,
      collisions: collisions.length,
      blocked: blocked.length,
    },
  };
}

// -------- execute (injected store seam; the CLI binds this to a real Firestore transaction) --------
export interface LiveSalesOrderRead {
  readonly salesOrderId: string;
  readonly salesOrderNumber: unknown;
  readonly createdAt: unknown;
}
export interface BackfillStore {
  // Re-read exactly the planned ids (through the caller's transaction).
  readAllSalesOrders(ids: readonly string[]): Promise<readonly LiveSalesOrderRead[]>;
  // Re-read the counter's current sequence for a year (through the same transaction); 0 if absent.
  readCounterSequence(year: number): Promise<number>;
  // Stage writes -- nothing commits until the caller's transaction commits.
  stageCounter(year: number, newSequence: number): void;
  stageAssignment(salesOrderId: string, salesOrderNumber: string): void;
}
export interface BackfillExecuteResult {
  readonly assigned: readonly { readonly salesOrderId: string; readonly salesOrderNumber: string }[];
  readonly counts: { readonly assigned: number; readonly skippedAlreadyNumbered: number };
}

export async function executeBackfill(args: {
  plan: BackfillPlan;
  store: BackfillStore;
  actorId: string;
}): Promise<BackfillExecuteResult> {
  if (!isNonBlank(args.actorId)) throw new SalesOrderBackfillError("INVALID_INPUT", "actorId invalid");
  if (args.plan.collisions.length > 0 || args.plan.blocked.length > 0) {
    throw new SalesOrderBackfillError(
      "COLLISION_DETECTED",
      `plan contains ${args.plan.collisions.length} collision(s) and ${args.plan.blocked.length} blocked record(s); zero writes -- resolve and rerun for a fresh plan`
    );
  }
  if (args.plan.assignments.length === 0) {
    return { assigned: [], counts: { assigned: 0, skippedAlreadyNumbered: args.plan.alreadyNumbered.length } };
  }

  // (1) Counter drift check -- re-read every touched year's counter and require it still equals the value
  // the plan was computed against. ANY mismatch means something else advanced the counter since planning (a
  // new live Sales Order created through the normal app path, or a separate concurrent backfill run) --
  // abort closed. This is why the runbook requires running execute during a window with no concurrent Sales
  // Order creation: this check makes any such overlap fail safely rather than silently reordering sequences.
  for (const snap of args.plan.counterSnapshot) {
    const live = await args.store.readCounterSequence(snap.year);
    if (live !== snap.sequenceBefore) {
      throw new SalesOrderBackfillError(
        "COUNTER_DRIFT",
        `counter for year ${snap.year} moved since the plan was generated (was ${snap.sequenceBefore}, now ${live}); rerun with a fresh plan`
      );
    }
  }

  // (2) Re-read every planned record and require it still exists and its pre-state fingerprint is unchanged.
  const ids = args.plan.assignments.map((a) => a.salesOrderId);
  const live = await args.store.readAllSalesOrders(ids);
  const liveById = new Map(live.map((r) => [r.salesOrderId, r] as const));
  if (liveById.size !== ids.length) {
    throw new SalesOrderBackfillError("LIVE_SET_DRIFT", "one or more planned Sales Order records could not be re-read; aborting (zero writes)");
  }
  for (const a of args.plan.assignments) {
    const current = liveById.get(a.salesOrderId);
    if (current === undefined) {
      throw new SalesOrderBackfillError("LIVE_SET_DRIFT", `planned record ${a.salesOrderId} missing from live re-read`);
    }
    const currentFingerprint = recordFingerprint(current);
    if (currentFingerprint !== a.fingerprint) {
      throw new SalesOrderBackfillError(
        "STALE_PRESTATE",
        `record ${a.salesOrderId} changed since the plan was generated (e.g. already numbered by another run); rerun with a fresh plan`
      );
    }
  }

  // (3) All pre-checks passed for the WHOLE batch -- stage every write. The caller's transaction (see the
  // CLI's production deps) makes this all-or-nothing: either every counter and every record commits, or none
  // does. Sequence numbers written are EXACTLY the plan's -- never renegotiated at execute time.
  const perYearFinalSequence = new Map<number, number>();
  for (const a of args.plan.assignments) {
    const priorInYear =
      perYearFinalSequence.get(a.year) ?? args.plan.counterSnapshot.find((s) => s.year === a.year)?.sequenceBefore ?? 0;
    if (a.sequence <= priorInYear) {
      throw new SalesOrderBackfillError("PLAN_MISMATCH", `assignment sequence out of order for year ${a.year}`);
    }
    perYearFinalSequence.set(a.year, a.sequence);
  }
  for (const [year, finalSequence] of perYearFinalSequence) {
    args.store.stageCounter(year, finalSequence);
  }
  for (const a of args.plan.assignments) {
    args.store.stageAssignment(a.salesOrderId, a.salesOrderNumber);
  }

  return {
    assigned: args.plan.assignments.map((a) => ({ salesOrderId: a.salesOrderId, salesOrderNumber: a.salesOrderNumber })),
    counts: { assigned: args.plan.assignments.length, skippedAlreadyNumbered: args.plan.alreadyNumbered.length },
  };
}
