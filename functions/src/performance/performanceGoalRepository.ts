// PERFORMANCE GOALS -- the Firestore repository. Pure mappers plus a transaction-aware repo, in the
// shape supplierMasterRepository/partMasterRepository already established.
//
// A stored record is re-validated through buildPerformanceGoal on the way OUT, not merely trusted.
// That matters more here than in a reference collection: a malformed goal is a TARGET, and a target
// that fails validation but renders anyway would put a number on someone's performance review that
// no authority can vouch for. A malformed record fails LOUD.
//
// NO UPDATE-IN-PLACE OF A NUMBER. `stageCreate` is the only way a version enters the collection.
// `stageLifecycleChange` exists for the two things that legitimately change on an EXISTING version --
// its status, and the closing of its effective window during supersession -- and it writes nothing
// else, so a target value cannot be edited by any path in this file.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { PERFORMANCE_GOALS_COLLECTION } from "../constants/collections.js";
import { MalformedStoredRecordError } from "../partMaster/partMasterRepository.js";
import { buildPerformanceGoal, type PerformanceGoal, type GoalStatus } from "./performanceGoal.js";

export function goalToFirestore(g: PerformanceGoal): Record<string, unknown> {
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
export function goalFromFirestore(docId: string, data: Record<string, unknown> | undefined): PerformanceGoal {
  if (data === undefined) throw new MalformedStoredRecordError(`performance goal ${docId} has no data`);
  try {
    return buildPerformanceGoal({ ...(data as Record<string, unknown>), goalId: docId } as never);
  } catch (err) {
    throw new MalformedStoredRecordError(
      `performance goal ${docId} is malformed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface GoalTargetKey {
  metricId: string;
  targetScopeType: string;
  targetScopeId: string | null;
}

export interface PerformanceGoalRepository {
  getById(txn: Transaction | null, goalId: string): Promise<PerformanceGoal | null>;
  stageCreate(txn: Transaction, goal: PerformanceGoal): void;
  /** The ONLY mutation of an existing version, and it touches exactly these fields. */
  stageLifecycleChange(
    txn: Transaction,
    goalId: string,
    change: { status: GoalStatus; effectiveTo?: string | null; approvedByUid?: string; approvedAtMillis?: number },
  ): void;
  /** Every version for one target, malformed neighbours excluded rather than fatal. */
  listForTarget(txn: Transaction | null, target: GoalTargetKey): Promise<PerformanceGoal[]>;
}

export function buildFirestorePerformanceGoalRepository(db: Firestore): PerformanceGoalRepository {
  const ref = (id: string) => db.collection(PERFORMANCE_GOALS_COLLECTION).doc(id);
  return {
    async getById(txn, goalId) {
      const snap = txn ? await txn.get(ref(goalId)) : await ref(goalId).get();
      if (!snap.exists) return null;
      return goalFromFirestore(snap.id, snap.data());
    },
    stageCreate(txn, goal) {
      txn.create(ref(goal.goalId), goalToFirestore(goal));
    },
    stageLifecycleChange(txn, goalId, change) {
      const patch: Record<string, unknown> = { status: change.status };
      if (change.effectiveTo !== undefined) patch.effectiveTo = change.effectiveTo;
      if (change.approvedByUid !== undefined) patch.approvedByUid = change.approvedByUid;
      if (change.approvedAtMillis !== undefined) patch.approvedAtMillis = change.approvedAtMillis;
      txn.update(ref(goalId), patch);
    },
    async listForTarget(txn, target) {
      // Three equality clauses, no ordering: servable without a composite index. Ordering happens in
      // memory because the result set for ONE target is a version chain, not a collection scan.
      let q = db
        .collection(PERFORMANCE_GOALS_COLLECTION)
        .where("metricId", "==", target.metricId)
        .where("targetScopeType", "==", target.targetScopeType);
      q = q.where("targetScopeId", "==", target.targetScopeId);
      const snap = txn ? await txn.get(q) : await q.get();
      const out: PerformanceGoal[] = [];
      for (const doc of snap.docs) {
        try {
          out.push(goalFromFirestore(doc.id, doc.data()));
        } catch {
          // A malformed sibling must not make a well-formed target chain unreadable. It IS excluded
          // rather than repaired: this repository never rewrites a record to make it parse.
          continue;
        }
      }
      return out.sort((a, b) => a.version - b.version);
    },
  };
}
