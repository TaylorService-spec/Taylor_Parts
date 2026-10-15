"use strict";
// Supplier Master -- reorder-PO supplier-linkage migration EXECUTE tooling. Production-CAPABLE but
// SANDBOX-ONLY in this repo: it is manifest-gated, fails closed on any ambiguity/drift, defaults to
// DRY_RUN (EXECUTE is impossible by accidental default -- it requires an explicit mode, a target
// confirmation token, AND the connected db to actually BE the named target project/database), only ever
// ADDS the two additive fields (supplierId + supplierNameSnapshot), and NEVER destroys or replaces the
// historical supplierName. It writes per-PO in isolated transactions with bounded failure reporting
// (row-level drift AND post-write verification failures are RECORDED, never thrown, so the caller always
// receives the result + rollback artifact), is re-runnable (idempotent for already-linked rows), and emits
// a rollback artifact + evidence suitable for a later governed production run.
//
// It executes NOTHING here. A real production run is a separate, Owner-authorized protected step
// (see docs/releases/supplier-master-promotion-package.md §6.6/§13). Mirrors warehouseGovernanceMigration's
// manifest/fingerprint discipline; differs by being additive-field + per-PO rather than whole-doc replace.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierMigrationExecuteError = void 0;
exports.validateExecutionManifest = validateExecutionManifest;
exports.executeSupplierLinkageMigration = executeSupplierLinkageMigration;
exports.rollbackSupplierLinkageMigration = rollbackSupplierLinkageMigration;
const firestore_1 = require("firebase-admin/firestore");
const reorderPurchaseOrderSupplierMigration_js_1 = require("./reorderPurchaseOrderSupplierMigration.js");
const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";
class SupplierMigrationExecuteError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SupplierMigrationExecuteError";
    }
}
exports.SupplierMigrationExecuteError = SupplierMigrationExecuteError;
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonBlank(v) {
    return typeof v === "string" && v.length > 0;
}
// Validate a manifest against the frozen dry-run plan. Fails closed on: not-object / wrong-target /
// wrong-commit / plan-fingerprint drift / non-array / malformed / duplicate / unknown-po / not-migratable
// (HISTORICAL/UNMATCHED) / supplierId not permitted by the plan (EXACT must match the derived id;
// AMBIGUOUS/INACTIVE must be one of the candidateIds) / snapshot != the plan's verbatim snapshot.
function validateExecutionManifest(manifest, plan, target) {
    const bad = (reason) => ({ valid: false, reason, entries: [] });
    if (!isPlainObject(manifest))
        return bad("manifest_not_object");
    if (!isPlainObject(manifest.target) || manifest.target.projectId !== target.projectId || manifest.target.databaseId !== target.databaseId)
        return bad("wrong_target");
    if (manifest.governedCommit !== plan.governedCommit)
        return bad("wrong_commit");
    if (manifest.planFingerprint !== plan.planFingerprint)
        return bad("plan_fingerprint_drift");
    if (!Array.isArray(manifest.entries))
        return bad("entries_not_array");
    const byId = new Map(plan.classified.map((c) => [c.poId, c]));
    const seen = new Set();
    const out = [];
    for (const e of manifest.entries) {
        if (!isPlainObject(e) || !isNonBlank(e.poId) || !isNonBlank(e.supplierId) || typeof e.supplierNameSnapshot !== "string" || !isNonBlank(e.preStateFingerprint))
            return bad("entry_malformed");
        if (seen.has(e.poId))
            return bad("duplicate_entry");
        seen.add(e.poId);
        const row = byId.get(e.poId);
        if (!row)
            return bad("unknown_po");
        if (row.classification === "HISTORICAL" || row.classification === "UNMATCHED")
            return bad("not_migratable");
        // supplierId must be permitted by the plan for this row.
        if (row.classification === "EXACT") {
            if (e.supplierId !== row.supplierId)
                return bad("exact_supplier_override");
        }
        else if (!row.candidateIds.includes(e.supplierId)) {
            // AMBIGUOUS / INACTIVE: the human-chosen id must be one the plan surfaced as a candidate.
            return bad("supplier_not_a_candidate");
        }
        // The snapshot is the verbatim historical name the plan captured -- the manifest cannot rewrite history.
        if (e.supplierNameSnapshot !== row.supplierNameSnapshot)
            return bad("snapshot_mismatch");
        out.push({ poId: e.poId, supplierId: e.supplierId, supplierNameSnapshot: e.supplierNameSnapshot, preStateFingerprint: e.preStateFingerprint });
    }
    return { valid: true, reason: null, entries: out };
}
// The connected Firestore's project/database (Admin SDK exposes both as getters). Read defensively so a
// missing getter reads as undefined and fails the EXECUTE destination check closed.
function firestoreLocation(db) {
    const d = db;
    return { projectId: d.projectId, databaseId: d.databaseId };
}
// Accidental-execute guard: EXECUTE is refused unless the caller explicitly names the target, passes a
// confirmation token equal to `${projectId}/${databaseId}`, AND the CONNECTED db actually IS that target.
// DRY_RUN needs no confirmation and does not write. The destination check is the crucial part: the token
// only proves the caller's strings are self-consistent (intent); comparing against db.projectId/databaseId
// proves the writes will land where the operator named (destination) -- so a db built against the wrong
// project/database fails closed instead of being silently written to.
function assertExecutable(mode, target, confirmExecute, db) {
    if (!isNonBlank(target?.projectId) || !isNonBlank(target?.databaseId)) {
        throw new SupplierMigrationExecuteError("AMBIGUOUS_TARGET", "target.projectId and target.databaseId are required");
    }
    if (mode !== "EXECUTE")
        return;
    if (confirmExecute !== `${target.projectId}/${target.databaseId}`) {
        throw new SupplierMigrationExecuteError("AMBIGUOUS_TARGET", "EXECUTE requires confirmExecute === `${projectId}/${databaseId}`");
    }
    const loc = firestoreLocation(db);
    if (loc.projectId !== target.projectId || loc.databaseId !== target.databaseId) {
        throw new SupplierMigrationExecuteError("AMBIGUOUS_TARGET", "connected database does not match the named target");
    }
}
// Execute (or dry-run) the frozen manifest against the live reorder POs. Per-PO isolated transactions;
// row-level drift is a bounded failure (recorded, run continues), setup failures throw (nothing written).
// Only ever writes the two additive fields; never touches supplierName. Idempotent: a PO already carrying
// the exact intended link is `already_linked` (no write); a PO carrying a DIFFERENT link fails closed
// (UNEXPECTED_EXISTING_LINK) rather than being overwritten.
async function executeSupplierLinkageMigration(args) {
    const mode = args.mode ?? "DRY_RUN"; // impossible-by-default: DRY_RUN unless asked
    if (!isNonBlank(args.actorUid))
        throw new SupplierMigrationExecuteError("INVALID_INPUT", "actorUid is required");
    assertExecutable(mode, args.target, args.confirmExecute, args.db);
    if (args.manifest === undefined || args.manifest === null)
        throw new SupplierMigrationExecuteError("MANIFEST_MISSING", "manifest is required");
    const check = validateExecutionManifest(args.manifest, args.plan, args.target);
    if (!check.valid) {
        const code = check.reason === "plan_fingerprint_drift" ? "PLAN_FINGERPRINT_DRIFT" : "MANIFEST_INVALID";
        throw new SupplierMigrationExecuteError(code, `manifest invalid: ${check.reason}`);
    }
    const outcomes = [];
    const linkedPoIds = [];
    const ref = (poId) => args.db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).doc(poId);
    for (const entry of check.entries) {
        try {
            const outcome = await args.db.runTransaction(async (txn) => {
                const snap = await txn.get(ref(entry.poId));
                if (!snap.exists)
                    throw new SupplierMigrationExecuteError("SOURCE_MISSING", `PO ${entry.poId} not found`);
                const data = snap.data();
                // Idempotency / unexpected-existing-link gate FIRST: a linked PO's own additive fields change its
                // fingerprint, so the pre-state gate below cannot distinguish "already linked by us" from drift --
                // the link decision must be made before it. An already-linked-to-the-intended-supplier PO is a
                // re-runnable no-op; a link to a DIFFERENT supplier fails closed (never overwritten).
                if ("supplierId" in data) {
                    if (data.supplierId === entry.supplierId && data.supplierNameSnapshot === entry.supplierNameSnapshot) {
                        return "already_linked";
                    }
                    throw new SupplierMigrationExecuteError("UNEXPECTED_EXISTING_LINK", `PO ${entry.poId} already linked to a different supplier`);
                }
                // NOT yet linked -> guard the source state before writing.
                // (pre) source-state drift gate.
                if ((0, reorderPurchaseOrderSupplierMigration_js_1.reorderPurchaseOrderRecordFingerprint)(data) !== entry.preStateFingerprint) {
                    throw new SupplierMigrationExecuteError("STALE_PRESTATE", `PO ${entry.poId} changed since manifest`);
                }
                // (pre) the snapshot must equal the PO's CURRENT historical supplierName (never replaced).
                if (data.supplierName !== entry.supplierNameSnapshot) {
                    throw new SupplierMigrationExecuteError("SNAPSHOT_MISMATCH", `PO ${entry.poId} supplierName != manifest snapshot`);
                }
                if (mode === "DRY_RUN")
                    return "would_apply";
                // Additive write ONLY -- update touches exactly the two governed fields; supplierName untouched.
                txn.update(ref(entry.poId), { supplierId: entry.supplierId, supplierNameSnapshot: entry.supplierNameSnapshot });
                return "applied";
            });
            if (outcome === "applied")
                linkedPoIds.push(entry.poId);
            outcomes.push({ poId: entry.poId, result: outcome });
        }
        catch (err) {
            const code = err instanceof SupplierMigrationExecuteError ? err.code : "INVALID_INPUT";
            outcomes.push({ poId: entry.poId, result: "failed", code });
        }
    }
    // (post) verify every applied PO now carries exactly the intended link and an intact supplierName.
    // CRITICAL: a postcondition failure must NOT throw -- the writes already committed, so the caller MUST
    // still receive the ExecuteResult + rollbackArtifact (which covers everything actually applied) to be
    // able to undo them. Failures are recorded (bounded), never discarded. The re-read is a plain
    // (non-transactional) read after each write's transaction closed: it is best-effort verification, not
    // transactionally coupled to the write, so a value reverted by a concurrent process between commit and
    // re-read would surface here as a postcondition failure rather than silent success.
    const postconditionFailures = [];
    if (mode === "EXECUTE") {
        for (const poId of linkedPoIds) {
            const entry = check.entries.find((e) => e.poId === poId);
            const data = (await ref(poId).get()).data();
            if (data.supplierId !== entry.supplierId || data.supplierNameSnapshot !== entry.supplierNameSnapshot || data.supplierName !== entry.supplierNameSnapshot) {
                // The PO keeps its single `applied` outcome (the write DID commit) and is flagged here so the
                // caller can investigate/roll it back; it stays in linkedPoIds so the rollback artifact covers it.
                postconditionFailures.push(poId);
            }
        }
    }
    const counts = {
        applied: outcomes.filter((o) => o.result === "applied").length,
        wouldApply: outcomes.filter((o) => o.result === "would_apply").length,
        alreadyLinked: outcomes.filter((o) => o.result === "already_linked").length,
        failed: outcomes.filter((o) => o.result === "failed").length,
    };
    const rollbackArtifact = {
        target: args.target,
        governedCommit: args.plan.governedCommit,
        planFingerprint: args.plan.planFingerprint,
        linkedPoIds,
    };
    return { mode, target: args.target, planFingerprint: args.plan.planFingerprint, outcomes, counts, postconditionFailures, rollbackArtifact };
}
// Undo a run using its rollback artifact: remove supplierId + supplierNameSnapshot from each linked PO.
// Never touches supplierName. Same accidental-execute guard + per-PO isolation + idempotency (a PO whose
// fields are already absent is `already_linked`-equivalent no-op).
async function rollbackSupplierLinkageMigration(args) {
    const mode = args.mode ?? "DRY_RUN";
    if (!isNonBlank(args.actorUid))
        throw new SupplierMigrationExecuteError("INVALID_INPUT", "actorUid is required");
    assertExecutable(mode, args.rollbackArtifact?.target, args.confirmExecute, args.db);
    const ref = (poId) => args.db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).doc(poId);
    const outcomes = [];
    for (const poId of args.rollbackArtifact.linkedPoIds ?? []) {
        try {
            const outcome = await args.db.runTransaction(async (txn) => {
                const snap = await txn.get(ref(poId));
                if (!snap.exists)
                    return "already_absent";
                const data = snap.data();
                if (!("supplierId" in data) && !("supplierNameSnapshot" in data))
                    return "already_absent"; // idempotent
                if (mode === "DRY_RUN")
                    return "would_remove";
                txn.update(ref(poId), { supplierId: firestore_1.FieldValue.delete(), supplierNameSnapshot: firestore_1.FieldValue.delete() });
                return "removed";
            });
            outcomes.push({ poId, result: outcome });
        }
        catch (err) {
            const code = err instanceof SupplierMigrationExecuteError ? err.code : "INVALID_INPUT";
            outcomes.push({ poId, result: "failed", code });
        }
    }
    return {
        mode,
        outcomes,
        counts: {
            removed: outcomes.filter((o) => o.result === "removed").length,
            wouldRemove: outcomes.filter((o) => o.result === "would_remove").length,
            alreadyAbsent: outcomes.filter((o) => o.result === "already_absent").length,
            failed: outcomes.filter((o) => o.result === "failed").length,
        },
    };
}
//# sourceMappingURL=reorderPurchaseOrderSupplierMigrationExecute.js.map