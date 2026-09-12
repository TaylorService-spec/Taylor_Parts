// LEGACY INVENTORY MOVEMENT CUTOVER TOOLING: the RUN layer around the per-row mapping contract.
//
// MIGRATION_ONLY, and the same shape as its siblings (legacyInventoryMovementMapping.ts,
// inventoryWriterCapabilityCensus.ts, inventoryCapabilityGrantMigration.ts): PURE. No Firebase, no
// Firestore, no Postgres connection, no `pg` client, no clock, no randomness, no filesystem. It
// imports `node:crypto` for hashing and nothing else beyond its own sibling module.
//
// It DOES NOT CUT OVER. It reads no source store, writes no destination, executes no import, freezes
// no writer, repoints no reader and deploys nothing. Every function here takes values in and returns
// values out, so the whole thing is testable from fixtures and provable before anyone is asked to
// trust it with production rows.
//
// ════════════════════ WHAT THE MAPPER LEAVES OPEN ════════════════════
//
// `mapLegacyInventoryMovement` is total and deterministic for ONE row: it yields a candidate or a
// typed refusal, never silence. Four things are still missing between "one row mapped" and "an
// operator can run an export and be believed", and this module is exactly those four and nothing
// more:
//
//   1. A REJECT BUCKET. A refusal that is merely returned is a refusal that gets dropped by the
//      first `.filter(r => r.mapped)` someone writes. The bucket makes retention structural and
//      proves TOTALITY: planned + rejected === rowsRead, asserted, for every run.
//   2. REPLAY SAFETY. See the section below -- the mapper's `idempotencyKey` is NULLABLE, and a
//      NULL key is invisible to the destination's partial unique index, so a naive re-run
//      DOUBLE-POSTS every row. This module derives a non-null, namespaced, deterministic key and
//      refuses any row that cannot have one.
//   3. RECONCILIATION. Per-(operating company, part, location) signed sums, a refusal histogram,
//      and a verdict that is allowed to say "I could not verify this" rather than "balanced".
//   4. A MANIFEST. Counts, hashes, source project and destination tenant, deterministic, so two
//      operators running the same export produce byte-identical evidence or a visible difference.
//
// ════════════════════ REPLAY SAFETY: THE ACTUAL MECHANISM ════════════════════
//
// migrations/1757808000000_eos-ops-foundation.sql declares
//
//     CREATE UNIQUE INDEX inventory_movements_idempotency
//         ON inventory_movements (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
//
// PARTIAL. A row whose `idempotency_key` is NULL is not in the index at all, so the database will
// happily accept the same movement twice. `mapLegacyInventoryMovement` carries the legacy row's own
// `idempotencyKey` through verbatim and that field is absent on most historical rows, so relying on
// it means relying on the one guarantee the schema explicitly declines to give.
//
// So this module MINTS the key rather than hoping for one:
//
//     idempotencyKey = `${MIGRATION_IDEMPOTENCY_NAMESPACE}:${candidate.sourceTransactionId}`
//
// Three properties, each load-bearing:
//
//   · DETERMINISTIC. The same legacy document always produces the same key, on every run, on every
//     machine, with no clock and no counter. That -- not a bookkeeping table -- is what makes a
//     re-run safe: the second insert of a row collides with the unique index and can be discarded
//     (`ON CONFLICT DO NOTHING`) by whoever eventually writes the importer.
//   · NAMESPACED. The prefix keeps a migrated key from ever colliding with one minted by a live
//     writer (cycleCountSheetCommand.ts mints `cycmv_<sha256>`, updateWorkOrderExecutionData.ts
//     mints `wox_<sha256>`). A collision would make the import silently skip a row it never wrote.
//   · DERIVED FROM SOURCE IDENTITY, NEVER FROM CONTENT. A content hash was considered and REFUSED:
//      two legitimately distinct legacy rows (same part, same location, same quantity, same
//      millisecond) would hash identically, and the second would be swallowed by the conflict
//      clause as a "replay". That under-posts a balance, silently, which is the precise failure
//      this whole tranche exists to prevent.
//
// The cost of that choice is explicit and is paid in the reject bucket: a row with NO stable source
// identity cannot be made replay-safe, so it is REJECTED (`NO_STABLE_SOURCE_IDENTITY`) rather than
// imported unsafely. Likewise two rows sharing one source id would mint one key for two movements,
// so the SECOND and later occurrences are rejected (`DUPLICATE_SOURCE_TRANSACTION_ID`) instead of
// being quietly deduplicated by the database.
//
// RESUMABILITY falls out of the same key. `planImport()` takes the set of keys the destination
// already holds and partitions the planned movements into `toInsert` and `alreadyPresent`. An
// interrupted run is resumed by re-reading the source, re-planning (deterministic, so identical),
// and inserting only the difference. There is no cursor to lose and no partial-progress file to
// trust.
//
// ════════════════════ WHY THE VERDICT CAN SAY "UNVERIFIED" ════════════════════
//
// A reconciliation that compares a run against itself always balances and proves nothing. Real
// reconciliation compares the destination-side sums this module computes against SOURCE-SIDE
// expected sums, which are produced by a census of the legacy store -- something this module has no
// business reading. So expectations are an OPTIONAL INPUT, and when they are absent the verdict is
// `UNVERIFIED`, never `BALANCED`. A run that nobody checked must not be able to report that it
// checked out.
//
// ════════════════════ WHAT THIS DELIBERATELY DOES NOT DO ════════════════════
//
//   · No source read, no destination write, no connection of any kind, no SQL string.
//   · No tenant resolution. The destination tenant is an operator-supplied INPUT to the manifest;
//     the operating-company-key-to-tenant crosswalk is a separate authority.
//   · No reject-bucket TABLE. The bucket is a serializable value the operator writes alongside the
//     manifest. Adding an `eos_ops` table for it would be schema nobody has authorized, for a
//     writer that does not exist yet.
//   · No retention of source row bodies. See `RejectedRow` -- the bucket keeps identity, a stable
//     code, a short human detail and the mapper's already-truncated `observed` tokens. A reject
//     bucket must never become an uncontrolled second copy of production data.
import { createHash } from "node:crypto";

import {
  mapLegacyInventoryMovements,
  type MappingRefusalCode,
  type MappingResult,
  type MappingDeps,
  type OpsMovementCandidate,
  type OpsLocationType,
} from "./legacyInventoryMovementMapping.js";

// ---------------------------------------------------------------------------------------------
// Hashing (the house idiom -- see warehouseGovernanceEvidence.ts, which defines these identically)
// ---------------------------------------------------------------------------------------------

/** Key-sorted, array-order-preserving JSON. Two structurally equal values serialize identically. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

// ---------------------------------------------------------------------------------------------
// Replay safety
// ---------------------------------------------------------------------------------------------

/**
 * The prefix on every idempotency key this migration mints. It is what keeps a migrated key from
 * colliding with one minted by a live writer; see this file's header.
 */
export const MIGRATION_IDEMPOTENCY_NAMESPACE = "legacy-inv-txn";

/**
 * The deterministic destination idempotency key for a legacy source document id. Same id in, same
 * key out, always -- no clock, no counter, no content.
 */
export function migrationIdempotencyKey(sourceTransactionId: string): string {
  return `${MIGRATION_IDEMPOTENCY_NAMESPACE}:${sourceTransactionId}`;
}

/**
 * Refusals raised by THIS layer rather than by the per-row mapper. Both are replay-safety facts: a
 * row can be a perfectly valid movement and still be unimportable because it cannot be made
 * non-duplicating. Stable, like the mapper's codes, and disjoint from them.
 */
export const RUN_REFUSAL_CODES = [
  /**
   * The mapped candidate carries no source document id, so no deterministic key can be derived from
   * its identity and a content-derived key would risk swallowing a genuinely distinct movement.
   */
  "NO_STABLE_SOURCE_IDENTITY",
  /**
   * A second (or later) row in the same batch claiming a source id already seen. One key cannot
   * address two movements; deduplicating them in the database would silently lose one.
   */
  "DUPLICATE_SOURCE_TRANSACTION_ID",
] as const;
export type RunRefusalCode = (typeof RUN_REFUSAL_CODES)[number];

export type RejectStage = "MAPPING" | "REPLAY_SAFETY";

// ---------------------------------------------------------------------------------------------
// The reject bucket
// ---------------------------------------------------------------------------------------------

/**
 * ONE retained rejection. EXACTLY what it keeps, and nothing else:
 *
 *   · `sourceOrdinal`   -- the row's zero-based position in the batch that was read, so a rejection
 *                          is locatable even when the row carried no id at all.
 *   · `sourceTransactionId` -- the legacy document id, or null when the row had none.
 *   · `stage` + `code`  -- which layer refused, and the stable reason.
 *   · `detail`          -- a short human sentence, written by the refusing layer.
 *   · `observed`        -- the refusing layer's small map of vocabulary-level tokens (a type name, a
 *                          location type, a truncated value). The mapper already truncates these to
 *                          64 characters, so a bucket entry cannot carry a payload.
 *
 * It does NOT keep the source row. Retaining bodies would make the bucket an uncontrolled second
 * copy of production data living outside the store that governs it.
 */
export interface RejectedRow {
  readonly sourceOrdinal: number;
  readonly sourceTransactionId: string | null;
  readonly stage: RejectStage;
  readonly code: MappingRefusalCode | RunRefusalCode;
  readonly detail: string;
  readonly observed: Readonly<Record<string, string>>;
}

export interface RejectBucket {
  readonly kind: "legacy-inventory-movement-reject-bucket";
  readonly runId: string;
  /** Batch order preserved, so the bucket reads in the same order the source was read. */
  readonly entries: readonly RejectedRow[];
  /** Code -> count, key-sorted. Present even when zero rows were rejected (an empty object). */
  readonly countsByCode: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------------------------
// The planned movement
// ---------------------------------------------------------------------------------------------

/**
 * A candidate that has ALSO been proven replay-safe. `idempotencyKey` here is non-nullable by type,
 * which is the whole point: an importer handed a `PlannedMovement` cannot write a row that the
 * destination's partial unique index would ignore.
 */
export interface PlannedMovement {
  readonly sourceOrdinal: number;
  readonly candidate: OpsMovementCandidate;
  /** Minted by `migrationIdempotencyKey`. Never null. This is what the importer must write. */
  readonly idempotencyKey: string;
  /**
   * Whatever the legacy row itself carried, retained as EVIDENCE only. It is deliberately not used
   * as the destination key: a legacy key is scoped to the legacy writer, so reusing it could collide
   * with a row a live writer already wrote under the same value.
   */
  readonly sourceIdempotencyKey: string | null;
}

// ---------------------------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------------------------

/** The grain reconciliation is done at: the destination's own balance grain, minus tenant. */
export interface BalanceKey {
  readonly operatingCompanyKey: string;
  readonly partId: string;
  readonly locationType: OpsLocationType;
  readonly locationId: string;
}

export interface BalanceLine extends BalanceKey {
  readonly movementCount: number;
  /** Sum of the candidates' DERIVED signed deltas. Never a sum of raw source quantities. */
  readonly quantityDelta: number;
}

/** An operator-supplied source-side expectation, at the same grain. */
export interface ExpectedBalance extends BalanceKey {
  readonly quantityDelta: number;
}

export interface BalanceMismatch extends BalanceKey {
  readonly expectedQuantityDelta: number;
  readonly actualQuantityDelta: number;
}

export interface ExpectationOutcome {
  readonly supplied: number;
  readonly matched: number;
  /** A key present on both sides whose sums differ. */
  readonly mismatched: readonly BalanceMismatch[];
  /** Expected by the source census, produced by no planned movement. */
  readonly missing: readonly ExpectedBalance[];
  /** Produced by the plan, expected by nobody. */
  readonly unexpected: readonly BalanceLine[];
}

export type ReconciliationVerdict = "BALANCED" | "UNBALANCED" | "UNVERIFIED";

export interface ReconciliationReport {
  readonly kind: "legacy-inventory-movement-reconciliation";
  readonly runId: string;
  readonly counts: {
    readonly rowsRead: number;
    readonly planned: number;
    readonly rejected: number;
  };
  /**
   * The TOTALITY proof: `accountedFor` is planned + rejected and `complete` says it equals
   * `rowsRead`. A false here means rows went missing between reading and accounting, which is the
   * one failure no downstream count can detect on its own.
   */
  readonly totality: { readonly accountedFor: number; readonly complete: boolean };
  /** Stable code -> count for every rejection, key-sorted. */
  readonly rejectedByCode: Readonly<Record<string, number>>;
  /** Destination-side sums, sorted by key, computed from derived deltas. */
  readonly balances: readonly BalanceLine[];
  /** Null when the operator supplied no source-side census. */
  readonly expectation: ExpectationOutcome | null;
  /**
   * BALANCED   -- totality holds AND a census was supplied AND every key matches exactly.
   * UNBALANCED -- totality failed, or the census disagrees anywhere.
   * UNVERIFIED -- totality holds but no census was supplied. NOT a pass.
   */
  readonly verdict: ReconciliationVerdict;
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export interface MigrationRun {
  readonly kind: "legacy-inventory-movement-run";
  readonly runId: string;
  readonly rowsRead: number;
  readonly planned: readonly PlannedMovement[];
  readonly rejectBucket: RejectBucket;
  readonly reconciliation: ReconciliationReport;
}

export interface MigrationRunInput {
  /** Operator-chosen label for this run. Carried into the bucket, report and manifest. */
  readonly runId: string;
  /** The legacy rows, exactly as read, in read order. Never mutated. */
  readonly rows: readonly unknown[];
  /** Optional source-side census. Absent means the verdict cannot be better than UNVERIFIED. */
  readonly expectedBalances?: readonly ExpectedBalance[];
  /** Passed straight through to the mapper (e.g. to inject a Part-id authority in tests). */
  readonly deps?: MappingDeps;
}

function balanceKeyOf(key: BalanceKey): string {
  return canonicalJson([key.operatingCompanyKey, key.partId, key.locationType, key.locationId]);
}

function sortedCounts(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const code of [...counts.keys()].sort()) out[code] = counts.get(code) as number;
  return Object.freeze(out);
}

/**
 * PLAN a run: map every row, mint a replay-safe key for every candidate, retain every rejection, and
 * reconcile. Deterministic and side-effect free; `input.rows` is never mutated and nothing is read
 * from or written to any store, clock or environment.
 *
 * Named `plan`, not `execute`: producing this value imports nothing.
 */
export function planLegacyInventoryMovementRun(input: MigrationRunInput): MigrationRun {
  const rows = input.rows ?? [];
  const results: readonly MappingResult[] = mapLegacyInventoryMovements(rows, input.deps ?? {});

  const planned: PlannedMovement[] = [];
  const rejected: RejectedRow[] = [];
  const seenSourceIds = new Map<string, number>();

  results.forEach((result, sourceOrdinal) => {
    if (!result.mapped) {
      const refusal = result.refusal;
      rejected.push(Object.freeze({
        sourceOrdinal,
        sourceTransactionId: refusal.sourceTransactionId,
        stage: "MAPPING" as const,
        code: refusal.code,
        detail: refusal.detail,
        observed: refusal.observed,
      }));
      return;
    }

    const candidate = result.candidate;
    const sourceTransactionId = candidate.sourceTransactionId;
    if (sourceTransactionId === null) {
      rejected.push(Object.freeze({
        sourceOrdinal,
        sourceTransactionId: null,
        stage: "REPLAY_SAFETY" as const,
        code: "NO_STABLE_SOURCE_IDENTITY" as const,
        detail: "the row carries no source document id, so no deterministic idempotency key can be " +
          "derived from its identity; a content-derived key could swallow a genuinely distinct movement",
        observed: Object.freeze({ movementType: candidate.movementType }),
      }));
      return;
    }
    const firstOrdinal = seenSourceIds.get(sourceTransactionId);
    if (firstOrdinal !== undefined) {
      rejected.push(Object.freeze({
        sourceOrdinal,
        sourceTransactionId,
        stage: "REPLAY_SAFETY" as const,
        code: "DUPLICATE_SOURCE_TRANSACTION_ID" as const,
        detail: "a second row claims a source document id already seen in this batch; one " +
          "idempotency key cannot address two movements and the database would discard one silently",
        observed: Object.freeze({ firstSourceOrdinal: String(firstOrdinal), movementType: candidate.movementType }),
      }));
      return;
    }
    seenSourceIds.set(sourceTransactionId, sourceOrdinal);
    planned.push(Object.freeze({
      sourceOrdinal,
      candidate,
      idempotencyKey: migrationIdempotencyKey(sourceTransactionId),
      sourceIdempotencyKey: candidate.idempotencyKey,
    }));
  });

  const countsByCode = new Map<string, number>();
  for (const entry of rejected) countsByCode.set(entry.code, (countsByCode.get(entry.code) ?? 0) + 1);

  const rejectBucket: RejectBucket = Object.freeze({
    kind: "legacy-inventory-movement-reject-bucket" as const,
    runId: input.runId,
    entries: Object.freeze([...rejected]),
    countsByCode: sortedCounts(countsByCode),
  });

  const reconciliation = reconcileRun({
    runId: input.runId,
    rowsRead: rows.length,
    planned,
    rejectBucket,
    expectedBalances: input.expectedBalances,
  });

  return Object.freeze({
    kind: "legacy-inventory-movement-run" as const,
    runId: input.runId,
    rowsRead: rows.length,
    planned: Object.freeze([...planned]),
    rejectBucket,
    reconciliation,
  });
}

/** Destination-side sums at the balance grain, sorted deterministically by key. */
export function summarizeBalances(planned: readonly PlannedMovement[]): readonly BalanceLine[] {
  const byKey = new Map<string, { key: BalanceKey; movementCount: number; quantityDelta: number }>();
  for (const movement of planned) {
    const c = movement.candidate;
    const key: BalanceKey = {
      operatingCompanyKey: c.operatingCompanyKey,
      partId: c.partId,
      locationType: c.locationType,
      locationId: c.locationId,
    };
    const k = balanceKeyOf(key);
    const existing = byKey.get(k);
    if (existing) {
      existing.movementCount += 1;
      existing.quantityDelta += c.quantityDelta;
    } else {
      byKey.set(k, { key, movementCount: 1, quantityDelta: c.quantityDelta });
    }
  }
  return Object.freeze(
    [...byKey.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, v]) => Object.freeze({ ...v.key, movementCount: v.movementCount, quantityDelta: v.quantityDelta })),
  );
}

interface ReconcileInput {
  readonly runId: string;
  readonly rowsRead: number;
  readonly planned: readonly PlannedMovement[];
  readonly rejectBucket: RejectBucket;
  readonly expectedBalances?: readonly ExpectedBalance[];
}

/** Build the report. Exported so a caller can reconcile a plan it assembled itself. */
export function reconcileRun(input: ReconcileInput): ReconciliationReport {
  const balances = summarizeBalances(input.planned);
  const accountedFor = input.planned.length + input.rejectBucket.entries.length;
  const complete = accountedFor === input.rowsRead;

  let expectation: ExpectationOutcome | null = null;
  if (input.expectedBalances !== undefined) {
    const actualByKey = new Map(balances.map((b) => [balanceKeyOf(b), b]));
    const expectedByKey = new Map(input.expectedBalances.map((e) => [balanceKeyOf(e), e]));
    const mismatched: BalanceMismatch[] = [];
    const missing: ExpectedBalance[] = [];
    const unexpected: BalanceLine[] = [];
    let matched = 0;
    for (const [k, expected] of [...expectedByKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const actual = actualByKey.get(k);
      if (!actual) { missing.push(expected); continue; }
      if (actual.quantityDelta !== expected.quantityDelta) {
        mismatched.push(Object.freeze({
          operatingCompanyKey: expected.operatingCompanyKey,
          partId: expected.partId,
          locationType: expected.locationType,
          locationId: expected.locationId,
          expectedQuantityDelta: expected.quantityDelta,
          actualQuantityDelta: actual.quantityDelta,
        }));
        continue;
      }
      matched += 1;
    }
    for (const [k, actual] of [...actualByKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!expectedByKey.has(k)) unexpected.push(actual);
    }
    expectation = Object.freeze({
      supplied: input.expectedBalances.length,
      matched,
      mismatched: Object.freeze(mismatched),
      missing: Object.freeze(missing),
      unexpected: Object.freeze(unexpected),
    });
  }

  const verdict: ReconciliationVerdict = !complete
    ? "UNBALANCED"
    : expectation === null
      ? "UNVERIFIED"
      : expectation.mismatched.length === 0 && expectation.missing.length === 0 && expectation.unexpected.length === 0
        ? "BALANCED"
        : "UNBALANCED";

  return Object.freeze({
    kind: "legacy-inventory-movement-reconciliation" as const,
    runId: input.runId,
    counts: Object.freeze({
      rowsRead: input.rowsRead,
      planned: input.planned.length,
      rejected: input.rejectBucket.entries.length,
    }),
    totality: Object.freeze({ accountedFor, complete }),
    rejectedByCode: input.rejectBucket.countsByCode,
    balances,
    expectation,
    verdict,
  });
}

// ---------------------------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------------------------

export interface ImportPlan {
  readonly kind: "legacy-inventory-movement-import-plan";
  readonly runId: string;
  /** Movements whose key the destination does not yet hold. */
  readonly toInsert: readonly PlannedMovement[];
  /** Movements a previous (possibly interrupted) run already wrote. Never re-inserted. */
  readonly alreadyPresent: readonly PlannedMovement[];
  readonly counts: {
    readonly planned: number;
    readonly toInsert: number;
    readonly alreadyPresent: number;
  };
}

/**
 * RESUME. Given the idempotency keys the destination already holds for this tenant, split the plan.
 *
 * The keys are an INPUT, not something this module queries: reading the destination is the
 * importer's job. Because `migrationIdempotencyKey` is deterministic, re-planning the same source
 * produces the same keys, so resuming an interrupted run needs no cursor and no progress file --
 * and re-running a COMPLETED run yields an empty `toInsert`, which is the idempotence claim stated
 * as a testable property.
 */
export function planImport(run: MigrationRun, alreadyImportedKeys: Iterable<string> = []): ImportPlan {
  const present = new Set<string>(alreadyImportedKeys);
  const toInsert: PlannedMovement[] = [];
  const alreadyPresent: PlannedMovement[] = [];
  for (const movement of run.planned) {
    (present.has(movement.idempotencyKey) ? alreadyPresent : toInsert).push(movement);
  }
  return Object.freeze({
    kind: "legacy-inventory-movement-import-plan" as const,
    runId: run.runId,
    toInsert: Object.freeze(toInsert),
    alreadyPresent: Object.freeze(alreadyPresent),
    counts: Object.freeze({
      planned: run.planned.length,
      toInsert: toInsert.length,
      alreadyPresent: alreadyPresent.length,
    }),
  });
}

// ---------------------------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------------------------

export interface ManifestContext {
  /** The legacy Firebase project the rows were read from. Operator-supplied; never guessed. */
  readonly sourceProjectId: string;
  /** The destination `eos_policy.tenants.id`. Operator-supplied; the crosswalk is not owned here. */
  readonly destinationTenantId: string;
  /** Epoch millis, INJECTED. This module reads no clock, so a manifest is reproducible. */
  readonly generatedAt: number;
}

export interface ExportManifest {
  readonly kind: "legacy-inventory-movement-export-manifest";
  readonly runId: string;
  readonly sourceProjectId: string;
  readonly destinationTenantId: string;
  readonly generatedAt: number;
  readonly idempotencyNamespace: string;
  readonly counts: ReconciliationReport["counts"];
  readonly rejectedByCode: Readonly<Record<string, number>>;
  readonly verdict: ReconciliationVerdict;
  /** sha256 over the canonical serialization of the planned movements, in batch order. */
  readonly plannedHash: string;
  /** sha256 over the canonical serialization of the reject bucket. */
  readonly rejectBucketHash: string;
  /** sha256 over the canonical serialization of the reconciliation report. */
  readonly reconciliationHash: string;
  /** sha256 over every field above. Two identical exports hash identically, or differ visibly. */
  readonly manifestHash: string;
}

/**
 * Build the operator-facing manifest. Deterministic: the same run plus the same context always
 * produces the same hashes, so a second operator can reproduce an export and compare one string.
 */
export function buildExportManifest(run: MigrationRun, context: ManifestContext): ExportManifest {
  const plannedHash = sha256(canonicalJson(run.planned));
  const rejectBucketHash = sha256(canonicalJson(run.rejectBucket));
  const reconciliationHash = sha256(canonicalJson(run.reconciliation));
  const body = {
    kind: "legacy-inventory-movement-export-manifest" as const,
    runId: run.runId,
    sourceProjectId: context.sourceProjectId,
    destinationTenantId: context.destinationTenantId,
    generatedAt: context.generatedAt,
    idempotencyNamespace: MIGRATION_IDEMPOTENCY_NAMESPACE,
    counts: run.reconciliation.counts,
    rejectedByCode: run.reconciliation.rejectedByCode,
    verdict: run.reconciliation.verdict,
    plannedHash,
    rejectBucketHash,
    reconciliationHash,
  };
  return Object.freeze({ ...body, manifestHash: sha256(canonicalJson(body)) });
}

// ---------------------------------------------------------------------------------------------
// Operator summary
// ---------------------------------------------------------------------------------------------

/**
 * A plain aligned block for a human operator, in the idiom of `describeReconcileReport` and
 * `describeParity`. It states the verdict in words an operator can act on, and it NEVER prints
 * "ready" for an UNVERIFIED run -- an unchecked run and a checked one must not read the same.
 */
export function describeMigrationRun(run: MigrationRun, manifest?: ExportManifest): string {
  const r = run.reconciliation;
  const lines: string[] = [
    `run                  ${run.runId}`,
    `rows read            ${r.counts.rowsRead}`,
    `planned movements    ${r.counts.planned}`,
    `rejected rows        ${r.counts.rejected}`,
    `all rows accounted   ${r.totality.complete ? "yes" : `NO (${r.totality.accountedFor} of ${r.counts.rowsRead})`}`,
    `balance keys         ${r.balances.length}`,
  ];
  for (const code of Object.keys(r.rejectedByCode)) {
    lines.push(`  reject ${code.padEnd(30)} ${r.rejectedByCode[code]}`);
  }
  if (r.expectation) {
    lines.push(
      `expected keys        ${r.expectation.supplied}`,
      `  matched            ${r.expectation.matched}`,
      `  mismatched         ${r.expectation.mismatched.length}`,
      `  missing            ${r.expectation.missing.length}`,
      `  unexpected         ${r.expectation.unexpected.length}`,
    );
  }
  if (manifest) {
    lines.push(
      `source project       ${manifest.sourceProjectId}`,
      `destination tenant   ${manifest.destinationTenantId}`,
      `manifest sha256      ${manifest.manifestHash}`,
    );
  }
  lines.push(
    r.verdict === "BALANCED"
      ? "=> BALANCED -- every source-side expectation matched"
      : r.verdict === "UNVERIFIED"
        ? "=> UNVERIFIED -- no source-side census was supplied; this is NOT a pass and is not a basis for cutover"
        : "=> UNBALANCED -- do not cut over",
  );
  return lines.join("\n");
}
