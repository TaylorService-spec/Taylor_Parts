"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setWorkOrderPartsPlan = exports.PartsPlanError = exports.PLAN_CAPABILITY = void 0;
exports.validatePartsPlan = validatePartsPlan;
exports.applyPartsPlan = applyPartsPlan;
// WO Parts Planning — Phase 2: the DEDICATED GOVERNED PLANNED PRODUCER.
//
// Business action: "plan these parts for this Work Order." A deliberately separate callable from
// transitionWorkOrder (planning is an operational decision that happens BEFORE dispatch and changes
// independently of lifecycle transitions) and from updateWorkOrderExecutionData (which owns qtyUsed). It is
// NOT a generic persistence API — the intent is the governed business action, not "update an array".
//
// INVARIANT: PLAN PARTS != RESERVE PARTS != USE PARTS. This command writes ONLY qtyPlanned (+ the part
// identity + a planning timestamp) on WorkOrder.inventorySnapshot[]. It never reserves, consumes, moves,
// procures, or touches qtyUsed / required / returned / equipment authority. Reservation stays with the
// existing DISPATCHED -> reserveParts trigger; this command deliberately does NOT call triggerInventoryEffects.
//
// IDENTITY (canonical): `partId` and `sku` are DISTINCT governed identifiers.
//   partId  -> canonical Part Master identity (the parts/{partId} doc).
//   sku     -> a compatibility/display identifier that MUST equal the canonical Part's `internalPartNumber`
//              (kept so the live updateWorkOrderExecutionData, which matches by `sku`, is unaffected).
// We NEVER fabricate `sku = partId` and NEVER infer `partId == sku`. sku is resolved from Part Master; if a
// canonical Part or its internalPartNumber cannot be resolved, the command FAILS CLOSED.
//
// Authorization is a NEW governed capability `workOrder.parts.plan` (permissionCatalog, active:false =>
// fail-closed for everyone until a separate Owner grant). NOT a role/device/UI check. Readiness is NEVER a
// prerequisite. Structural pattern mirrors updateWorkOrderExecutionData.ts: onCall + one runTransaction
// doing read-verify-write. Export != deploy; register != grant.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const partMasterRepository_1 = require("../partMaster/partMasterRepository");
exports.PLAN_CAPABILITY = "workOrder.parts.plan";
class PartsPlanError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PartsPlanError";
    }
}
exports.PartsPlanError = PartsPlanError;
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
// Validate + normalize the business intent. PURE. Throws PartsPlanError("INVALID") — never a partial plan.
// Note: a client-supplied `sku` is deliberately NOT accepted — sku is resolved canonically from Part Master.
function validatePartsPlan(raw) {
    const input = raw;
    if (!input || typeof input !== "object")
        throw new PartsPlanError("INVALID", "Request data must be an object.");
    if (!isNonEmptyString(input.workOrderId))
        throw new PartsPlanError("INVALID", "workOrderId is required.");
    if (!Array.isArray(input.plan))
        throw new PartsPlanError("INVALID", "plan must be a list.");
    const seen = new Set();
    const plan = [];
    for (const raw2 of input.plan) {
        const line = raw2;
        if (!line || typeof line !== "object")
            throw new PartsPlanError("INVALID", "Each plan line must be an object.");
        if (!isNonEmptyString(line.partId))
            throw new PartsPlanError("INVALID", "Each plan line requires a partId.");
        const partId = line.partId.trim();
        if (seen.has(partId))
            throw new PartsPlanError("INVALID", `Duplicate partId "${partId}" in plan.`);
        if (!isPositiveInt(line.qtyPlanned))
            throw new PartsPlanError("INVALID", "Each plan line requires a positive integer qtyPlanned.");
        seen.add(partId);
        plan.push({ partId, name: isNonEmptyString(line.name) ? line.name.trim() : undefined, qtyPlanned: line.qtyPlanned });
    }
    return { workOrderId: input.workOrderId.trim(), plan };
}
// The AUTHORITATIVE merge. PURE (Part Master resolution is injected). Computes the new inventorySnapshot
// from the current one + the validated plan, deriving each item's canonical sku from Part Master.
//
// Fail-closed identity rules (Owner-ratified):
//   - Every plan line's partId MUST resolve to a canonical Part (found) with a valid internalPartNumber
//     (the sku). Otherwise FAIL CLOSED (PART_NOT_FOUND / SKU_UNRESOLVED). Never fabricate sku = partId.
//   - Match an existing row by canonical partId, OR a LEGACY (partId-less) row whose sku === canonical sku.
//     More than one match => IDENTITY_AMBIGUOUS (fail closed; never silently choose or duplicate).
//   - A partId-identified row whose stored sku disagrees with the canonical internalPartNumber =>
//     SKU_CONFLICT (fail closed; never silently "fix" an inconsistent governed record).
//   - On match: preserve the row (qtyUsed + unrelated fields), backfill canonical partId, set sku to the
//     canonical internalPartNumber, update qtyPlanned. A prior sku is retained only because it was proven
//     equal to the canonical sku (that is how the legacy row matched); it is never retained arbitrarily.
//   - A currently-planned part with recorded usage cannot be un-planned (USED_PART_REMOVAL).
function applyPartsPlan(current, plan, resolvePart) {
    const existing = Array.isArray(current) ? current : [];
    // 1) Resolve canonical sku for every plan line up front; fail closed on any unresolved identity.
    const canonicalSku = new Map();
    for (const line of plan) {
        const r = resolvePart(line.partId);
        if (!r.found)
            throw new PartsPlanError("PART_NOT_FOUND", `No canonical Part record for partId "${line.partId}".`);
        if (!isNonEmptyString(r.sku))
            throw new PartsPlanError("SKU_UNRESOLVED", `Canonical Part "${line.partId}" has no valid internalPartNumber.`);
        canonicalSku.set(line.partId, r.sku.trim());
    }
    // 2) Removal-guard: an existing planned part NOT represented in the new plan cannot be dropped if it has
    //    recorded usage. "Represented" = same partId, or a legacy (partId-less) row whose sku equals a
    //    canonical sku in the plan.
    const planPartIds = new Set(plan.map((p) => p.partId));
    const planSkus = new Set([...canonicalSku.values()]);
    for (const it of existing) {
        const represented = (it.partId && planPartIds.has(it.partId)) || (!it.partId && planSkus.has(it.sku));
        if (!represented && (it.qtyUsed ?? 0) > 0) {
            throw new PartsPlanError("USED_PART_REMOVAL", `Cannot remove planned part "${it.partId ?? it.sku}" — it already has recorded usage.`);
        }
    }
    // 3) Build the next snapshot from the plan, matching + merging each line against existing rows.
    return plan.map((line) => {
        const sku = canonicalSku.get(line.partId);
        const matches = existing.filter((it) => (it.partId ? it.partId === line.partId : it.sku === sku));
        if (matches.length > 1) {
            throw new PartsPlanError("IDENTITY_AMBIGUOUS", `Ambiguous existing identity for partId "${line.partId}" — refuse to guess.`);
        }
        const prev = matches[0];
        if (prev && prev.partId === line.partId && isNonEmptyString(prev.sku) && prev.sku !== sku) {
            throw new PartsPlanError("SKU_CONFLICT", `Stored sku for partId "${line.partId}" conflicts with the canonical internalPartNumber.`);
        }
        const item = {
            ...(prev ?? {}),
            partId: line.partId, // backfill / set canonical identity
            sku, // canonical internalPartNumber — NEVER partId
            qtyPlanned: line.qtyPlanned,
        };
        if (line.name !== undefined)
            item.name = line.name;
        return item; // qtyUsed + unrelated fields carried through the spread; planning never writes them
    });
}
function mapError(err) {
    if (err instanceof PartsPlanError) {
        return new https_1.HttpsError(err.code === "INVALID" ? "invalid-argument" : "failed-precondition", err.message);
    }
    if (err instanceof https_1.HttpsError)
        return err;
    return new https_1.HttpsError("internal", "Could not set the parts plan.");
}
exports.setWorkOrderPartsPlan = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    // Fail-closed capability check. A throwing resolver is treated as a denial (never an allow).
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: request.auth.uid, permissionIds: [exports.PLAN_CAPABILITY] });
        allowed = decisions[exports.PLAN_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to plan parts for a Work Order.");
    let input;
    try {
        input = validatePartsPlan(request.data);
    }
    catch (err) {
        throw mapError(err);
    }
    const db = (0, firestore_1.getFirestore)();
    const woRef = db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(input.workOrderId);
    const partsCol = db.collection(partMasterRepository_1.PARTS_COLLECTION);
    const distinctPartIds = [...new Set(input.plan.map((l) => l.partId))];
    try {
        const plannedCount = await db.runTransaction(async (tx) => {
            // All reads BEFORE any write (Firestore transaction rule): the WO + every referenced Part.
            const [woSnap, ...partSnaps] = await Promise.all([
                tx.get(woRef),
                ...distinctPartIds.map((id) => tx.get(partsCol.doc(id))),
            ]);
            if (!woSnap.exists)
                throw new https_1.HttpsError("not-found", `No Work Order with id ${input.workOrderId}`);
            const resolved = new Map();
            distinctPartIds.forEach((id, i) => {
                const s = partSnaps[i];
                if (!s.exists) {
                    resolved.set(id, { found: false, sku: null });
                }
                else {
                    const ipn = s.data().internalPartNumber;
                    resolved.set(id, { found: true, sku: typeof ipn === "string" && ipn.trim().length > 0 ? ipn.trim() : null });
                }
            });
            const wo = woSnap.data();
            const nextSnapshot = applyPartsPlan(wo.inventorySnapshot, input.plan, (id) => resolved.get(id) ?? { found: false, sku: null });
            // ONLY inventorySnapshot + a planning timestamp. Never status, assignment, reservation, or usage.
            tx.update(woRef, { inventorySnapshot: nextSnapshot, partsPlanUpdatedAt: firestore_1.FieldValue.serverTimestamp() });
            return nextSnapshot.length;
        });
        return { success: true, workOrderId: input.workOrderId, plannedCount };
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=setWorkOrderPartsPlan.js.map