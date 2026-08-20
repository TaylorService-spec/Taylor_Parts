import {
  collection,
  documentId,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { interpretPage } from "./listRuntime.js";

// Executes a query descriptor against Firestore. The ONLY place the metadata list runtime
// touches a database.
//
// The runtime is pure and decided everything already: which filters are legal, the total
// sort order, the bound, and the +1 truncation probe. This translates that decision into
// SDK calls and translates nothing back — it adds no filter, no limit and no ordering of
// its own, because anything invented here would be a query nobody proved has an index.
//
// §9 — THERE IS NO UNBOUNDED PATH THROUGH THIS FUNCTION. `descriptor.limit` is always
// present (buildQueryDescriptor clamps rather than omits), so a caller cannot obtain the
// whole collection by leaving a field out.

const OPERATOR_TO_FIRESTORE = Object.freeze({
  EQUALS: "==",
  NOT_EQUALS: "!=",
  IN: "in",
  GREATER_THAN: ">",
  GREATER_OR_EQUAL: ">=",
  LESS_THAN: "<",
  LESS_OR_EQUAL: "<=",
  ARRAY_CONTAINS: "array-contains",
  ARRAY_CONTAINS_ANY: "array-contains-any",
});

/** The Firestore field reference for a sort clause. */
const sortField = (fieldId) => (fieldId === "__name__" ? documentId() : fieldId);

/**
 * Build the SDK query constraints for a descriptor.
 *
 * Exported so the translation is testable without a database. A test that had to stand up
 * Firestore to prove "the tiebreaker is ordered last" would not get written.
 */
export function toConstraints(descriptor, cursorDoc = null) {
  const constraints = [];
  for (const f of descriptor.filters ?? []) {
    const op = OPERATOR_TO_FIRESTORE[f.operator];
    // An unmapped operator means the runtime allowed something this translator cannot
    // express. Failing loudly beats silently dropping the filter, which would widen the
    // query to rows the caller never asked for.
    if (!op) throw new Error(`operator "${f.operator}" has no Firestore equivalent`);
    constraints.push(where(f.fieldId, op, f.value));
  }
  for (const s of descriptor.sort ?? []) {
    constraints.push(orderBy(sortField(s.fieldId), s.direction === "DESC" ? "desc" : "asc"));
  }
  if (cursorDoc) constraints.push(startAfter(cursorDoc));
  constraints.push(fsLimit(descriptor.limit));
  return constraints;
}

/**
 * Fetch one page.
 *
 * Returns the interpreted page plus the raw snapshot for the row the cursor points at, so
 * a caller can request the next page without the component having to know that Firestore
 * cursors are documents rather than values.
 */
export async function fetchPage(descriptor, { cursorDoc = null } = {}) {
  const snap = await getDocs(query(collection(db, descriptor.collection), ...toConstraints(descriptor, cursorDoc)));
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const page = interpretPage(descriptor, docs);
  // The cursor document is the LAST RETURNED row, matching interpretPage's rule that the
  // probe row is never the cursor — using the probe would skip a record on the next page,
  // invisibly and permanently.
  const nextCursorDoc = page.hasMore && page.rows.length ? snap.docs[page.rows.length - 1] : null;
  return { ...page, nextCursorDoc };
}
