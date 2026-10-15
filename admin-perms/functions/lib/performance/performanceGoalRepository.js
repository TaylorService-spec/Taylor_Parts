"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalToFirestore = goalToFirestore;
exports.goalFromFirestore = goalFromFirestore;
exports.buildFirestorePerformanceGoalRepository = buildFirestorePerformanceGoalRepository;
const collections_js_1 = require("../constants/collections.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const performanceGoal_js_1 = require("./performanceGoal.js");
function goalToFirestore(g) {
    return {
        goalId: g.goalId,
        metricId: g.metricId,
        targetScopeType: g.targetScopeType,
        targetScopeId: g.targetScopeId,
        targetValue: g.targetValue,
        unit: g.unit,
        direction: g.direction,
        currency: g.currency,
        effectiveFrom: g.effectiveFrom,
        effectiveTo: g.effectiveTo,
        status: g.status,
        version: g.version,
        createdByUid: g.createdByUid,
        createdAtMillis: g.createdAtMillis,
        approvedByUid: g.approvedByUid,
        approvedAtMillis: g.approvedAtMillis,
        supersedesGoalId: g.supersedesGoalId,
    };
}
/** Deserialize + REVALIDATE. A stored record that would not be accepted today is not served today. */
function goalFromFirestore(docId, data) {
    if (data === undefined)
        throw new partMasterRepository_js_1.MalformedStoredRecordError(`performance goal ${docId} has no data`);
    try {
        return (0, performanceGoal_js_1.buildPerformanceGoal)({ ...data, goalId: docId });
    }
    catch (err) {
        throw new partMasterRepository_js_1.MalformedStoredRecordError(`performance goal ${docId} is malformed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function buildFirestorePerformanceGoalRepository(db) {
    const ref = (id) => db.collection(collections_js_1.PERFORMANCE_GOALS_COLLECTION).doc(id);
    return {
        async getById(txn, goalId) {
            const snap = txn ? await txn.get(ref(goalId)) : await ref(goalId).get();
            if (!snap.exists)
                return null;
            return goalFromFirestore(snap.id, snap.data());
        },
        stageCreate(txn, goal) {
            txn.create(ref(goal.goalId), goalToFirestore(goal));
        },
        stageLifecycleChange(txn, goalId, change) {
            const patch = { status: change.status };
            if (change.effectiveTo !== undefined)
                patch.effectiveTo = change.effectiveTo;
            if (change.approvedByUid !== undefined)
                patch.approvedByUid = change.approvedByUid;
            if (change.approvedAtMillis !== undefined)
                patch.approvedAtMillis = change.approvedAtMillis;
            txn.update(ref(goalId), patch);
        },
        async listForTarget(txn, target) {
            // Three equality clauses, no ordering: servable without a composite index. Ordering happens in
            // memory because the result set for ONE target is a version chain, not a collection scan.
            let q = db
                .collection(collections_js_1.PERFORMANCE_GOALS_COLLECTION)
                .where("metricId", "==", target.metricId)
                .where("targetScopeType", "==", target.targetScopeType);
            q = q.where("targetScopeId", "==", target.targetScopeId);
            const snap = txn ? await txn.get(q) : await q.get();
            const out = [];
            for (const doc of snap.docs) {
                try {
                    out.push(goalFromFirestore(doc.id, doc.data()));
                }
                catch {
                    // A malformed sibling must not make a well-formed target chain unreadable. It IS excluded
                    // rather than repaired: this repository never rewrites a record to make it parse.
                    continue;
                }
            }
            return out.sort((a, b) => a.version - b.version);
        },
    };
}
//# sourceMappingURL=performanceGoalRepository.js.map