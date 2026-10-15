"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUN_REFUSAL_CODES = exports.MIGRATION_IDEMPOTENCY_NAMESPACE = void 0;
exports.migrationIdempotencyKey = migrationIdempotencyKey;
exports.planLegacyInventoryMovementRun = planLegacyInventoryMovementRun;
exports.summarizeBalances = summarizeBalances;
exports.reconcileRun = reconcileRun;
exports.planImport = planImport;
exports.buildExportManifest = buildExportManifest;
exports.describeMigrationRun = describeMigrationRun;
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
const node_crypto_1 = require("node:crypto");
const legacyInventoryMovementMapping_js_1 = require("./legacyInventoryMovementMapping.js");
// ---------------------------------------------------------------------------------------------
// Hashing (the house idiom -- see warehouseGovernanceEvidence.ts, which defines these identically)
// ---------------------------------------------------------------------------------------------
/** Key-sorted, array-order-preserving JSON. Two structurally equal values serialize identically. */
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const rec = value;
        return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function sha256(value) { return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex"); }
// ---------------------------------------------------------------------------------------------
// Replay safety
// ---------------------------------------------------------------------------------------------
/**
 * The prefix on every idempotency key this migration mints. It is what keeps a migrated key from
 * colliding with one minted by a live writer; see this file's header.
 */
exports.MIGRATION_IDEMPOTENCY_NAMESPACE = "legacy-inv-txn";
/**
 * The deterministic destination idempotency key for a legacy source document id. Same id in, same
 * key out, always -- no clock, no counter, no content.
 */
function migrationIdempotencyKey(sourceTransactionId) {
    return `${exports.MIGRATION_IDEMPOTENCY_NAMESPACE}:${sourceTransactionId}`;
}
/**
 * Refusals raised by THIS layer rather than by the per-row mapper. Both are replay-safety facts: a
 * row can be a perfectly valid movement and still be unimportable because it cannot be made
 * non-duplicating. Stable, like the mapper's codes, and disjoint from them.
 */
exports.RUN_REFUSAL_CODES = [
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
];
function balanceKeyOf(key) {
    return canonicalJson([key.operatingCompanyKey, key.partId, key.locationType, key.locationId]);
}
function sortedCounts(counts) {
    const out = {};
    for (const code of [...counts.keys()].sort())
        out[code] = counts.get(code);
    return Object.freeze(out);
}
/**
 * PLAN a run: map every row, mint a replay-safe key for every candidate, retain every rejection, and
 * reconcile. Deterministic and side-effect free; `input.rows` is never mutated and nothing is read
 * from or written to any store, clock or environment.
 *
 * Named `plan`, not `execute`: producing this value imports nothing.
 */
function planLegacyInventoryMovementRun(input) {
    const rows = input.rows ?? [];
    const results = (0, legacyInventoryMovementMapping_js_1.mapLegacyInventoryMovements)(rows, input.deps ?? {});
    const planned = [];
    const rejected = [];
    const seenSourceIds = new Map();
    results.forEach((result, sourceOrdinal) => {
        if (!result.mapped) {
            const refusal = result.refusal;
            rejected.push(Object.freeze({
                sourceOrdinal,
                sourceTransactionId: refusal.sourceTransactionId,
                stage: "MAPPING",
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
                stage: "REPLAY_SAFETY",
                code: "NO_STABLE_SOURCE_IDENTITY",
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
                stage: "REPLAY_SAFETY",
                code: "DUPLICATE_SOURCE_TRANSACTION_ID",
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
    const countsByCode = new Map();
    for (const entry of rejected)
        countsByCode.set(entry.code, (countsByCode.get(entry.code) ?? 0) + 1);
    const rejectBucket = Object.freeze({
        kind: "legacy-inventory-movement-reject-bucket",
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
        kind: "legacy-inventory-movement-run",
        runId: input.runId,
        rowsRead: rows.length,
        planned: Object.freeze([...planned]),
        rejectBucket,
        reconciliation,
    });
}
/** Destination-side sums at the balance grain, sorted deterministically by key. */
function summarizeBalances(planned) {
    const byKey = new Map();
    for (const movement of planned) {
        const c = movement.candidate;
        const key = {
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
        }
        else {
            byKey.set(k, { key, movementCount: 1, quantityDelta: c.quantityDelta });
        }
    }
    return Object.freeze([...byKey.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([, v]) => Object.freeze({ ...v.key, movementCount: v.movementCount, quantityDelta: v.quantityDelta })));
}
/** Build the report. Exported so a caller can reconcile a plan it assembled itself. */
function reconcileRun(input) {
    const balances = summarizeBalances(input.planned);
    const accountedFor = input.planned.length + input.rejectBucket.entries.length;
    const complete = accountedFor === input.rowsRead;
    let expectation = null;
    if (input.expectedBalances !== undefined) {
        const actualByKey = new Map(balances.map((b) => [balanceKeyOf(b), b]));
        const expectedByKey = new Map(input.expectedBalances.map((e) => [balanceKeyOf(e), e]));
        const mismatched = [];
        const missing = [];
        const unexpected = [];
        let matched = 0;
        for (const [k, expected] of [...expectedByKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            const actual = actualByKey.get(k);
            if (!actual) {
                missing.push(expected);
                continue;
            }
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
            if (!expectedByKey.has(k))
                unexpected.push(actual);
        }
        expectation = Object.freeze({
            supplied: input.expectedBalances.length,
            matched,
            mismatched: Object.freeze(mismatched),
            missing: Object.freeze(missing),
            unexpected: Object.freeze(unexpected),
        });
    }
    const verdict = !complete
        ? "UNBALANCED"
        : expectation === null
            ? "UNVERIFIED"
            : expectation.mismatched.length === 0 && expectation.missing.length === 0 && expectation.unexpected.length === 0
                ? "BALANCED"
                : "UNBALANCED";
    return Object.freeze({
        kind: "legacy-inventory-movement-reconciliation",
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
/**
 * RESUME. Given the idempotency keys the destination already holds for this tenant, split the plan.
 *
 * The keys are an INPUT, not something this module queries: reading the destination is the
 * importer's job. Because `migrationIdempotencyKey` is deterministic, re-planning the same source
 * produces the same keys, so resuming an interrupted run needs no cursor and no progress file --
 * and re-running a COMPLETED run yields an empty `toInsert`, which is the idempotence claim stated
 * as a testable property.
 */
function planImport(run, alreadyImportedKeys = []) {
    const present = new Set(alreadyImportedKeys);
    const toInsert = [];
    const alreadyPresent = [];
    for (const movement of run.planned) {
        (present.has(movement.idempotencyKey) ? alreadyPresent : toInsert).push(movement);
    }
    return Object.freeze({
        kind: "legacy-inventory-movement-import-plan",
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
/**
 * Build the operator-facing manifest. Deterministic: the same run plus the same context always
 * produces the same hashes, so a second operator can reproduce an export and compare one string.
 */
function buildExportManifest(run, context) {
    const plannedHash = sha256(canonicalJson(run.planned));
    const rejectBucketHash = sha256(canonicalJson(run.rejectBucket));
    const reconciliationHash = sha256(canonicalJson(run.reconciliation));
    const body = {
        kind: "legacy-inventory-movement-export-manifest",
        runId: run.runId,
        sourceProjectId: context.sourceProjectId,
        destinationTenantId: context.destinationTenantId,
        generatedAt: context.generatedAt,
        idempotencyNamespace: exports.MIGRATION_IDEMPOTENCY_NAMESPACE,
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
function describeMigrationRun(run, manifest) {
    const r = run.reconciliation;
    const lines = [
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
        lines.push(`expected keys        ${r.expectation.supplied}`, `  matched            ${r.expectation.matched}`, `  mismatched         ${r.expectation.mismatched.length}`, `  missing            ${r.expectation.missing.length}`, `  unexpected         ${r.expectation.unexpected.length}`);
    }
    if (manifest) {
        lines.push(`source project       ${manifest.sourceProjectId}`, `destination tenant   ${manifest.destinationTenantId}`, `manifest sha256      ${manifest.manifestHash}`);
    }
    lines.push(r.verdict === "BALANCED"
        ? "=> BALANCED -- every source-side expectation matched"
        : r.verdict === "UNVERIFIED"
            ? "=> UNVERIFIED -- no source-side census was supplied; this is NOT a pass and is not a basis for cutover"
            : "=> UNBALANCED -- do not cut over");
    return lines.join("\n");
}
//# sourceMappingURL=legacyInventoryMovementRun.js.map