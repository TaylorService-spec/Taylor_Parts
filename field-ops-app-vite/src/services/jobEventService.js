import { collection, doc, getDocs, query, where, orderBy, limit as fsLimit } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { JOB_EVENTS_COLLECTION } from "../domain/constants";
import { safeSetDoc } from "../lib/firebaseSafe";
import { isWriteBlocked } from "../config/env";

// Sprint 4.5: persisted job event log -- the ONLY place that writes to
// JOB_EVENTS_COLLECTION. Each event: { jobId, eventType, payload,
// timestamp }. This is a real, Firestore-backed history (unlike Sprint
// 3.5's domain/timelineBuilder.js, which derives an in-memory timeline
// from job.status/createdAt on every render and writes nothing). Both
// exist side by side -- this sprint doesn't touch or replace Sprint
// 3.5's derived timeline; that stays exactly as it was.
//
// logJobEvent() accepts an optional Firestore transaction (`tx`) so a
// caller already inside a transaction -- e.g.
// services/inventoryService.js's reservePart()/consumePart() -- can log
// the event atomically with its own writes, instead of as a separate,
// non-atomic follow-up call.

export function logJobEvent(tx, jobId, eventType, payload = {}) {
  const ref = doc(collection(db, JOB_EVENTS_COLLECTION));
  const event = { jobId, eventType, payload, timestamp: Date.now() };

  if (tx) {
    tx.set(ref, event);
    return { id: ref.id, ...event };
  }

  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (logJobEvent)", jobId, eventType);
    return Promise.resolve({ blocked: true });
  }

  return safeSetDoc(ref, event).then(() => ({ id: ref.id, ...event }));
}

// Most recent events for one job, newest first. Read-only, no write
// path here.
export async function getJobEvents(jobId, max = 50) {
  const q = query(
    collection(db, JOB_EVENTS_COLLECTION),
    where("jobId", "==", jobId),
    orderBy("timestamp", "desc"),
    fsLimit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Most recent events across all jobs, for the operational debug view
// (Task 4.12).
export async function getRecentJobEvents(max = 50) {
  const q = query(collection(db, JOB_EVENTS_COLLECTION), orderBy("timestamp", "desc"), fsLimit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
