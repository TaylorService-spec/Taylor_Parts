// THE SHARED FIRESTORE COLLECTION FENCE.
//
// ONE implementation of the question "does this code hand a banned collection name to a Firestore
// accessor?", so the same source file cannot be judged by a different rule depending on which suite
// happened to look at it. src/eosOps/migration/legacyInventoryMovementMapping.ts was being scanned by
// two probes with two different (and differently wrong) answers before this module existed.
//
// Extracted unchanged from test/adminPolicyNoFirebase.test.mjs, which carries the full reasoning and
// the positive/negative controls that prove the three clauses. That suite now imports from here.
//
// ════════════════════ WHY ANCHORED, AND NOT `source.includes('"warehouses"')` ════════════════════
//
// A collection NAME is only evidence of Firestore persistence when something HANDS IT TO a Firestore
// accessor. The bare-substring form is a false-positive generator: it fires on any legitimate EOS
// identifier that happens to spell the same word, and the only way to appease it is to rename real
// code -- a guard that trains people to damage the thing it is guarding.
//
// It is also STRICTLY WEAKER than what replaces it. The bare form misses the other quote style, a
// backtick path, a concatenated path, and a name held in a variable. All of those are refused here.

/**
 * Source with comments removed.
 *
 * Every check built on this is about CODE. A header explaining why a layer must never touch Firestore
 * is exactly the comment that should survive -- banning the word outright would delete the reasoning
 * along with the coupling, which is how a boundary loses the note saying why it exists.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** The Firestore accessors that take a collection or a document path, in both SDK spellings. */
export const FIRESTORE_ACCESSOR = "(?:collection|collectionGroup|doc|docRef)";

/** Receivers and handles that only a Firestore caller holds. */
export const FIRESTORE_HANDLE =
  "(?:db|firestore|firestoreDb|docRef|batch|bulkWriter|getFirestore\\s*\\(\\s*\\)|(?:admin\\s*\\.\\s*)?firestore\\s*\\(\\s*\\))";

/**
 * A Firestore accessor reached from a Firestore handle, WHATEVER it was handed.
 *
 * `db.collection(SOME_CONST)` and `collection(db, name)` hide the collection name behind a variable or
 * a computed string. A subsystem that has migrated off Firestore has no legitimate reason to hold one
 * at all, so the shape alone is the offence and the argument does not have to be readable.
 */
export function opaqueFirestoreAccess(code) {
  return (
    new RegExp(`\\b${FIRESTORE_HANDLE}\\s*\\.\\s*${FIRESTORE_ACCESSOR}\\s*\\(`).test(code) ||
    new RegExp(`\\b${FIRESTORE_ACCESSOR}\\s*\\(\\s*${FIRESTORE_HANDLE}\\b`).test(code)
  );
}

/**
 * A banned collection name REACHING a Firestore accessor. Two routes, because a name can arrive
 * directly or through one hop:
 *
 *   direct   db.collection("users") / collection(db, "users") / doc(db, "users", uid) /
 *            db.doc(`users/${uid}`) / .doc("tenants/t1/users/u1") / db.collection('users')
 *   bound    const COLLECTION = "users";  ...  store.collection(COLLECTION)
 *
 * `name` is the BARE name. The quote style and the `users/` path form are the anchor's job, which is
 * why callers no longer pass '"users"' and "users/" as separate list entries: they were spellings of
 * one name, and spelling them out is exactly what made the old probe match a plain string.
 */
export function namesFirestoreCollection(code, name) {
  if (new RegExp(`\\b${FIRESTORE_ACCESSOR}\\s*\\(\\s*[^)]*?['"\`][^'"\`]*\\b${name}\\b`).test(code)) return true;
  const bindings = code.matchAll(
    new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)[^=\\n]*=\\s*['"\`][^'"\`]*\\b${name}\\b`, "g"),
  );
  for (const [, bound] of bindings) {
    if (new RegExp(`\\b${FIRESTORE_ACCESSOR}\\s*\\([^)]*\\b${bound}\\b`).test(code)) return true;
  }
  return false;
}
