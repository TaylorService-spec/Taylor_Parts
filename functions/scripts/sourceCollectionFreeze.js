// THE OPERATOR-SCRIPT FREEZE GATE for the Firestore Catalog and Reorder SOURCE collections.
//
// The Firestore Catalog and Reorder SOURCES are frozen for the PostgreSQL cutover (catalogWriterState.ts
// CATALOG_WRITER_AUTHORITY.firestore = FROZEN -- PostgreSQL goes ACTIVE only with the separate activation change;
// reorderSourceFreeze.ts REORDER_SOURCE_FROZEN = true). The runtime writers refuse through
// those constants, but a seed, fixture or backfill script writing the Admin SDK straight into one of these
// collections goes round every one of them -- Firestore Rules do not constrain the Admin SDK. A write
// accepted that way lands in a frozen snapshot PostgreSQL never reads, and makes the snapshot disagree
// with the COPY that was verified at activation.
//
// SO EVERY OPERATOR SCRIPT THAT CAN WRITE ONE OF THESE COLLECTIONS ASKS HERE FIRST, using the SAME
// committed constants the runtime writers use (the pattern seedSandboxTransactional.js already follows for
// its Reorder portion). There is no flag, environment variable or parameter that reopens a collection: the
// only way to write one again is the reviewed constant itself.
//
// A script that ALSO writes collections outside this list keeps writing those; it skips (or, where a
// partial result would be incoherent, refuses) only the frozen ones.
const { CATALOG_WRITER_AUTHORITY, assertCatalogWriterAuthorityCoherent } = require("../lib/catalogMaster/catalogWriterState.js");
const { REORDER_SOURCE_FROZEN } = require("../lib/reorderRequest/reorderSourceFreeze.js");

/** The Firestore Catalog collections (Owner, 2026-09-28). */
const CATALOG_SOURCE_COLLECTIONS = Object.freeze([
  "parts", "equipment_models", "part_aliases", "manufacturers", "suppliers", "part_supplier_items",
  "equipment_model_aliases", "equipment_part_compatibility", "equipment_compatibility_sources", "supplier_catalog",
]);

/** The Firestore Reorder collections (Owner, 2026-09-28). */
const REORDER_SOURCE_COLLECTIONS = Object.freeze([
  "reorder_requests", "reorder_purchase_orders", "reorder_purchase_order_voids",
]);

class FrozenSourceCollectionError extends Error {
  constructor(collection, reason, script) {
    super(`${script}: refusing to write '${collection}': ${reason}`);
    this.name = "FrozenSourceCollectionError";
    this.code = "FROZEN_SOURCE_COLLECTION";
    this.collection = collection;
  }
}

/**
 * Why `collection` may not be written from an operator script, or null when it may.
 *
 * Reads ONLY the committed constants. It takes no override, so no caller can reopen a frozen collection.
 */
function frozenSourceReason(collection) {
  if (CATALOG_SOURCE_COLLECTIONS.includes(collection)) {
    assertCatalogWriterAuthorityCoherent(CATALOG_WRITER_AUTHORITY);
    if (CATALOG_WRITER_AUTHORITY.firestore !== "OPEN") {
      return `the Firestore Catalog is ${CATALOG_WRITER_AUTHORITY.firestore} `
        + `(PostgreSQL ${CATALOG_WRITER_AUTHORITY.postgres}); Catalog data is written through the PostgreSQL Catalog authority`;
    }
    return null;
  }
  if (REORDER_SOURCE_COLLECTIONS.includes(collection) && REORDER_SOURCE_FROZEN) {
    return "the legacy Reorder source is frozen for the PostgreSQL cutover; seed Reorder data through the governed "
      + "PostgreSQL commands (src/sandboxFixtures/reorderScenarioPostgresSeed.ts)";
  }
  return null;
}

/** Throw before any write to a frozen collection. */
function assertSourceCollectionWritable(collection, script) {
  const reason = frozenSourceReason(collection);
  if (reason) throw new FrozenSourceCollectionError(collection, reason, script);
}

/** The frozen collections among `collections`, each with its reason. Empty when all may be written. */
function frozenSourceCollections(collections) {
  return [...new Set(collections)]
    .map((collection) => ({ collection, reason: frozenSourceReason(collection) }))
    .filter((x) => x.reason !== null);
}

module.exports = {
  CATALOG_SOURCE_COLLECTIONS,
  REORDER_SOURCE_COLLECTIONS,
  FrozenSourceCollectionError,
  frozenSourceReason,
  assertSourceCollectionWritable,
  frozenSourceCollections,
};
