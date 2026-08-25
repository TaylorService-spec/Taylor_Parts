import { collection, getDocs, doc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "../domain/constants";
import { safeAddDoc, safeUpdateDoc, safeDeleteDoc } from "../lib/firebaseSafe";

// Thin wrapper so the module components don't each need to know
// Firestore's API shape. Every write goes through lib/firebaseSafe.js's
// safe* wrappers, so demo/panic mode (config/env.js) blocks writes here
// the same way it does everywhere else.

// ════════════════════ TIMESTAMP SHAPE IS A COLLECTION'S OWN DECISION ════════════════════
//
// THE DEFECT THIS CLOSES. This writer stamped `Date.now()` -- an epoch NUMBER -- for every
// collection. Firestore orders across types by TYPE FIRST (number < timestamp), so on a collection
// whose existing population stores Firestore Timestamps, a freshly created document sorts BELOW
// every one of them under `updatedAt DESC`. It is not excluded; it is last. On a 106-row list with
// a 50-row page, "last" and "invisible" are the same thing, and the count still said 106.
//
// A newly created Customer was therefore unreachable from the list it was created in -- findable
// only by switching to a name-ordered sort. Observed live in sandbox, and reproducible: under
// ASCENDING date order the new records were rows 1-3.
//
// WHY THIS IS NOT ONE GLOBAL FIX. The repository's own metadata governs these fields, and it does
// not give one answer:
//
//     accounts            createdAt TIMESTAMP   updatedAt TIMESTAMP
//     equipment           createdAt NUMBER      updatedAt NUMBER
//     locations           createdAt NUMBER      updatedAt NUMBER
//     inventory_actions   createdAt NUMBER      (never updated)
//     reorder_requests    createdAt NUMBER      (never updated)
//
// inventoryAction.js states it outright: "Epoch milliseconds ... never FieldValue.serverTimestamp(),
// never a Firestore Timestamp." So switching the shared writer to Timestamps would fix accounts and
// break four collections in exactly the same way, in the other direction.
//
// EXPLICIT, NOT INFERRED. The policy is declared per store from the collection's governed metadata
// -- never guessed from a field's name. A "fields called *At get timestamps" heuristic would be a
// second, invisible authority competing with the entity definitions, and it would silently decide
// the answer for the next collection somebody adds.
export const TIMESTAMP_SHAPE = Object.freeze({
  /** Epoch milliseconds from the CALLER'S clock. The default, and what five collections govern. */
  EPOCH_MILLIS: "EPOCH_MILLIS",
  /** Firestore server timestamp. For collections whose entity definition declares TIMESTAMP. */
  SERVER_TIMESTAMP: "SERVER_TIMESTAMP",
});

/**
 * @param {string} collectionName
 * @param {{ timestamps?: "EPOCH_MILLIS" | "SERVER_TIMESTAMP" }} [options]
 *   `timestamps` MUST match the collection's governed metadata type. Omitting it keeps the
 *   historical EPOCH_MILLIS behaviour, so every existing store is byte-identical.
 */
export function makeCollectionStore(collectionName, { timestamps = TIMESTAMP_SHAPE.EPOCH_MILLIS } = {}) {
  const colRef = collection(db, collectionName);
  // Resolved ONCE per store, from the declared policy. serverTimestamp() returns a fresh sentinel
  // per call, so it is invoked per write rather than captured.
  const stamp = () =>
    timestamps === TIMESTAMP_SHAPE.SERVER_TIMESTAMP ? serverTimestamp() : Date.now();
  return {
    /** The collection's governed timestamp value, exposed so a domain writer stamps the SAME shape
     *  its own create path does. `updateAccount` used to hardcode Date.now(), which reintroduced
     *  the defect on every edit -- a record created correctly and then edited sank again. */
    timestampValue: stamp,
    list() {
      return getDocs(colRef).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    add(data) {
      // `updatedAt` IS STAMPED ON CREATE, not only on update.
      //
      // Firestore's orderBy SILENTLY EXCLUDES any document missing the ordered field. The Customers
      // index sorts by updatedAt DESC server-side (metadata/definitions/account.js), so a freshly
      // created Account -- which had only createdAt -- satisfied every filter and was still dropped
      // from the list and from the Prospect view. It remained findable by name search, which orders
      // by `name`, which is exactly the symptom that was reported: "the Prospect I just created is
      // not there, but I can search for it."
      //
      // Introduced by bd576a92 (#1137), which moved ordering from an in-memory subscription to a
      // server-ordered metadata list. The write path never changed; the field-existence requirement
      // simply became load-bearing and nothing said so.
      //
      // This repository had already written the warning down -- see the note in
      // metadata/definitions/inventoryTransaction.js about orderBy excluding documents missing the
      // sorted field. Stamping here fixes it for EVERY collection through this shared writer, rather
      // than for accounts alone.
      // ONE call, so createdAt and updatedAt cannot disagree on a slow clock, and BOTH follow the
      // collection's governed shape.
      const now = stamp();
      return safeAddDoc(colRef, { createdAt: now, updatedAt: now, ...data }).then((ref) =>
        ref.blocked ? ref : { id: ref.id, ...data }
      );
    },
    update(id, data) {
      return safeUpdateDoc(doc(db, collectionName, id), data).then((result) =>
        result?.blocked ? result : { id, ...data }
      );
    },
    remove(id) {
      return safeDeleteDoc(doc(db, collectionName, id));
    },
  };
}

export const jobsStore = makeCollectionStore(JOBS_COLLECTION);
export const techniciansStore = makeCollectionStore(TECHNICIANS_COLLECTION);
