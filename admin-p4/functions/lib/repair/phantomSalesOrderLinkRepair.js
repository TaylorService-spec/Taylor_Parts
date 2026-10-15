"use strict";
// X-PHANTOM-SALES-ORDER-LINK-REPAIR -- INERT, UNEXPORTED pure repair core for the four+one Work Orders
// (wo-c713-1, -2, -3, -4, -5) whose `salesOrderId` points at "so-harbor-c713", a Sales Order that does not
// exist among the live `sales_orders` records. transitionWorkOrder() gated its Sales Order fulfillment
// write-back on `if (soSnap.exists)` and silently proceeded when false (fixed going forward by the H19 audit
// event -- see transitionWorkOrder.ts), so these five Work Orders completed/cancelled with NO audit trace of
// the skip. This module is the DETERMINISTIC classification + planning + execute-staging core for the repair,
// mirroring functions/src/salesOrder/salesOrderNumberBackfill.ts's dry-run-default / fingerprint-bound /
// all-or-nothing pattern. NOT exported from functions/src/index.ts; no callable; no production read/write
// here (the operator CLI, functions/scripts/phantomSalesOrderLinkRepairCli.js, wires real deps lazily and is
// dry-run by default).
//
// THE JUDGEMENT CALL (restated in docs/operations/phantom-sales-order-link-repair-runbook.md Section C, where
// it is justified at length -- this comment gives the short version):
//
//   Three materially different repairs were considered for the dangling `salesOrderId` reference:
//     (A) CLEAR it (delete the field).
//     (B) TOMBSTONE it -- leave `salesOrderId` byte-identical, add new fields that make the invalidity
//         EXPLICIT and audited instead of silent.
//     (C) POINT it at a real Sales Order (either an existing unrelated one, or a freshly fabricated one).
//
//   fulfillment/coordinatedVisit.ts groups Work Orders into one coordinated visit by an EXACT STRING MATCH on
//   `salesOrderId` (see its own header comment) -- nothing else ties these five records together as "one
//   customer, one install day, five units" in any UI. (A) breaks that grouping outright: the five Work Orders
//   become invisible to each other. (C) is worse: repointing at an existing unrelated Sales Order fabricates
//   a false commercial relationship, and fabricating a brand-new Sales Order retroactively invents a
//   provenance (Opportunity -> WON -> Sales Order) that never happened -- exactly the kind of history-rewrite
//   "preserve history" rules out.
//
//   THIS MODULE IMPLEMENTS (B). `salesOrderId` is never read as a write target and never modified -- the
//   coordinated-visit grouping key is untouched, byte-for-byte, so grouping continues to work exactly as it
//   does today. What changes is that the previously-silent invalidity becomes an explicit, durable,
//   audited fact: `salesOrderLinkStatus: "ORPHANED"` plus a reason, a repair-package pointer, and a
//   server timestamp, staged in the SAME transaction as a durable Audit Event
//   (action: "repairPhantomSalesOrderLink"). Nothing about `status`, `inventorySnapshot`, or any other field
//   is read or touched.
//
// IDEMPOTENCY: a Work Order already carrying `salesOrderLinkStatus` is classified ALREADY_REPAIRED and is
// never included in a plan's assignments -- reruns after a partial execute naturally exclude what already
// landed and complete only the remainder.
//
// SCOPE: only Work Orders whose LIVE `salesOrderId` equals the exact phantom id under repair are ever
// classified NEEDS_REPAIR. Every other Work Order is NOT_TARGET and is never touched -- this tool never goes
// looking for "similar" dangling references; each phantom id gets its own explicitly-scoped repair run.
//
// EXECUTE SAFETY: execute is bound to a specific dry-run plan (content-hash-pinned by the CLI, exactly like
// the Sales Order number backfill). It re-reads live state and recomputes the pre-state fingerprint of every
// planned record, PLUS re-confirms the phantom Sales Order id still does not resolve to a live document,
// before staging a single write; ANY drift -- a record already repaired, a record whose salesOrderId or
// status or inventorySnapshot changed, or the phantom Sales Order suddenly existing -- fails the WHOLE batch
// closed. This mirrors salesOrderNumberBackfill.ts's STALE_PRESTATE / LIVE_SET_DRIFT contract.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPAIR_FIELD_NAMES = exports.PhantomSalesOrderLinkRepairError = void 0;
exports.recordFingerprint = recordFingerprint;
exports.classifyRecord = classifyRecord;
exports.planRepair = planRepair;
exports.executeRepair = executeRepair;
const node_crypto_1 = require("node:crypto");
class PhantomSalesOrderLinkRepairError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.PhantomSalesOrderLinkRepairError = PhantomSalesOrderLinkRepairError;
// The exact set of fields this repair ever writes on a Work Order document. Both `planRepair` (to build the
// proposed-change manifest) and the CLI's rollback path (to know precisely what to clear, and nothing else)
// read from this single list -- one authority, never two.
exports.REPAIR_FIELD_NAMES = [
    "salesOrderLinkStatus",
    "salesOrderLinkOrphanedReason",
    "salesOrderLinkRepairedAt",
    "salesOrderLinkRepairPackageId",
];
function isNonBlank(v) {
    return typeof v === "string" && v.trim() !== "";
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const rec = value;
        return `{${Object.keys(rec)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
// Fingerprint over exactly the fields this repair depends on (to detect drift) plus the fields it is about to
// write (so a rerun after a partial repair, or ANY change to status/inventorySnapshot since planning, is
// caught) -- so an unrelated field change elsewhere on the Work Order never blocks execute, but any change
// that matters to this repair does.
function recordFingerprint(fields) {
    return sha256(canonicalJson({
        salesOrderId: fields.salesOrderId ?? null,
        status: fields.status ?? null,
        inventorySnapshot: fields.inventorySnapshot ?? null,
        salesOrderLinkStatus: fields.salesOrderLinkStatus ?? null,
    }));
}
function classifyRecord(record, phantomSalesOrderId) {
    const fingerprint = recordFingerprint(record);
    if (record.salesOrderId !== phantomSalesOrderId) {
        return { workOrderId: record.workOrderId, category: "NOT_TARGET", fingerprint };
    }
    if (isNonBlank(record.salesOrderLinkStatus)) {
        return { workOrderId: record.workOrderId, category: "ALREADY_REPAIRED", fingerprint };
    }
    return { workOrderId: record.workOrderId, category: "NEEDS_REPAIR", fingerprint };
}
function planRepair(records, ctx) {
    if (!isNonBlank(ctx.phantomSalesOrderId)) {
        throw new PhantomSalesOrderLinkRepairError("INVALID_INPUT", "phantomSalesOrderId invalid");
    }
    if (!isNonBlank(ctx.reason))
        throw new PhantomSalesOrderLinkRepairError("INVALID_INPUT", "reason invalid");
    if (!isNonBlank(ctx.repairPackageId)) {
        throw new PhantomSalesOrderLinkRepairError("INVALID_INPUT", "repairPackageId invalid");
    }
    const seen = new Set();
    for (const r of records) {
        if (!isNonBlank(r.workOrderId))
            throw new PhantomSalesOrderLinkRepairError("INVALID_INPUT", "workOrderId invalid");
        if (seen.has(r.workOrderId))
            throw new PhantomSalesOrderLinkRepairError("INVALID_INPUT", "duplicate workOrderId in input");
        seen.add(r.workOrderId);
    }
    const classified = records.map((r) => ({ raw: r, c: classifyRecord(r, ctx.phantomSalesOrderId) }));
    const needsRepair = classified
        .filter((x) => x.c.category === "NEEDS_REPAIR")
        .slice()
        .sort((a, b) => (a.raw.workOrderId < b.raw.workOrderId ? -1 : a.raw.workOrderId > b.raw.workOrderId ? 1 : 0));
    const alreadyRepaired = classified.filter((x) => x.c.category === "ALREADY_REPAIRED");
    const notTarget = classified.filter((x) => x.c.category === "NOT_TARGET");
    const assignments = needsRepair.map(({ raw, c }) => ({
        workOrderId: raw.workOrderId,
        salesOrderIdBefore: raw.salesOrderId,
        statusBefore: raw.status,
        inventorySnapshotBefore: raw.inventorySnapshot,
        fingerprint: c.fingerprint,
        proposedChange: {
            salesOrderId: "UNCHANGED",
            salesOrderLinkStatus: "ORPHANED",
            salesOrderLinkOrphanedReason: ctx.reason,
            salesOrderLinkRepairPackageId: ctx.repairPackageId,
        },
    }));
    return {
        phantomSalesOrderId: ctx.phantomSalesOrderId,
        repairPackageId: ctx.repairPackageId,
        reason: ctx.reason,
        assignments,
        alreadyRepaired: alreadyRepaired.map((x) => x.raw.workOrderId),
        notTargetCount: notTarget.length,
        counts: {
            totalConsidered: records.length,
            needsRepair: assignments.length,
            alreadyRepaired: alreadyRepaired.length,
            notTarget: notTarget.length,
        },
    };
}
async function executeRepair(args) {
    if (!isNonBlank(args.actorId))
        throw new PhantomSalesOrderLinkRepairError("INVALID_INPUT", "actorId invalid");
    if (args.plan.assignments.length === 0) {
        return { repaired: [], counts: { repaired: 0, skippedAlreadyRepaired: args.plan.alreadyRepaired.length } };
    }
    // (1) The phantom Sales Order must STILL not exist. If it now does, the world has changed since the plan
    // was made (someone created it out of band, or a different repair already ran) -- abort closed rather than
    // silently repairing a link that may no longer be phantom.
    const stillPhantom = !(await args.store.readSalesOrderExists(args.plan.phantomSalesOrderId));
    if (!stillPhantom) {
        throw new PhantomSalesOrderLinkRepairError("PHANTOM_RESOLVED", `Sales Order ${args.plan.phantomSalesOrderId} now exists; the phantom condition this plan was built against no longer holds -- rerun with a fresh plan (or a different repair) rather than executing this one`);
    }
    // (2) Re-read every planned record and require it still exists and its pre-state fingerprint is unchanged.
    const ids = args.plan.assignments.map((a) => a.workOrderId);
    const live = await args.store.readWorkOrders(ids);
    const liveById = new Map(live.map((r) => [r.workOrderId, r]));
    if (liveById.size !== ids.length) {
        throw new PhantomSalesOrderLinkRepairError("LIVE_SET_DRIFT", "one or more planned Work Order records could not be re-read; aborting (zero writes)");
    }
    for (const a of args.plan.assignments) {
        const current = liveById.get(a.workOrderId);
        if (current === undefined) {
            throw new PhantomSalesOrderLinkRepairError("LIVE_SET_DRIFT", `planned record ${a.workOrderId} missing from live re-read`);
        }
        const currentFingerprint = recordFingerprint(current);
        if (currentFingerprint !== a.fingerprint) {
            throw new PhantomSalesOrderLinkRepairError("STALE_PRESTATE", `record ${a.workOrderId} changed since the plan was generated (e.g. already repaired, or salesOrderId/status/inventorySnapshot changed); rerun with a fresh plan`);
        }
    }
    // (3) All pre-checks passed for the WHOLE batch -- stage every write. The caller's transaction makes this
    // all-or-nothing: either every planned Work Order is repaired, or none is.
    for (const a of args.plan.assignments) {
        args.store.stageRepair(a.workOrderId, a.proposedChange);
    }
    return {
        repaired: args.plan.assignments.map((a) => ({ workOrderId: a.workOrderId })),
        counts: { repaired: args.plan.assignments.length, skippedAlreadyRepaired: args.plan.alreadyRepaired.length },
    };
}
//# sourceMappingURL=phantomSalesOrderLinkRepair.js.map