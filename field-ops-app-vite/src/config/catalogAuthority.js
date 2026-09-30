// THE CLIENT'S STATEMENT OF WHICH CATALOG AUTHORITY IS CURRENT -- the single seam that client surfaces
// consult before offering anything that would reach the retired Firestore catalog.
//
// It MIRRORS the committed server constant functions/src/catalogMaster/catalogWriterState.ts
// CATALOG_WRITER_AUTHORITY, which the activation change moved to { firestore: FROZEN, postgres: ACTIVE }
// (ACTIVATE_POSTGRES) together with this mirror. It is a committed constant, not a runtime probe and not a per-environment flag,
// for the same reason the server's is: the Catalog authority is one decision for the whole platform, and
// the client already reads the Catalog ONLY through the PostgreSQL transport (services/catalogApiClient.js,
// no Firestore path exists). test/catalogAuthorityClientGate.test.mjs pins this value to the server's, so
// the two cannot drift.
//
// WHAT IT GATES. The Firebase Functions deployed in nonprod pre-date the Catalog freeze, so none of the
// server-side refusals (catalogWriterState FROZEN, CATALOG_AUTHORITY_MOVED in executeDataImport) exist
// there, and Firebase is retirement-only: they will not be deployed. The CLIENT therefore refuses, itself,
// to offer or execute anything whose execution on that runtime writes a Catalog collection or treats the
// frozen Firestore catalog as current truth.
//
// DORMANT WHILE INACTIVE. The refusal keys off this constant (importRefusedByCatalogAuthority,
// buildDataImportView, dataImportSubtitle): while PostgreSQL is INACTIVE the Firestore catalog is still the
// current (frozen) catalog, so PARTS/INVENTORY are offered and executed exactly as before. It turns on with
// the activation flip, in the same change as the server constant.
export const CATALOG_AUTHORITY_POSTGRES_ACTIVE = true;

/**
 * Data Import entity types whose EXECUTION on the deployed Firebase runtime depends on the Firestore catalog.
 *
 *   PARTS      WRITES the Firestore `parts` collection (partMaster createPart).
 *   INVENTORY  resolves every row's Part reference against the Firestore `parts` collection and writes an
 *              opening-balance ledger movement against it -- the frozen snapshot treated as current truth.
 *
 * CUSTOMERS, EQUIPMENT and SERVICE_HISTORY reach no Catalog collection (EQUIPMENT stores manufacturer and
 * model as free text on the customer's equipment, not a reference to equipment_models).
 */
export const CATALOG_BOUND_IMPORT_ENTITY_TYPES = Object.freeze(["PARTS", "INVENTORY"]);

/** The import entity types this client knows. Anything else is refused rather than guessed at. */
export const KNOWN_IMPORT_ENTITY_TYPES = Object.freeze(["PARTS", "CUSTOMERS", "EQUIPMENT", "INVENTORY", "SERVICE_HISTORY"]);

export const CATALOG_AUTHORITY_MOVED = "CATALOG_AUTHORITY_MOVED";

/** The explicit, truthful sentence for each refused entity type. */
export const CATALOG_IMPORT_REFUSAL_MESSAGE = Object.freeze({
  PARTS:
    "Part Import is unavailable: the Catalog authority has moved to PostgreSQL, and this import would write Parts "
    + "into the retired Firestore catalog. Part import through the PostgreSQL catalog is not built yet.",
  INVENTORY:
    "Inventory Import is unavailable: it resolves each row's Part against the Firestore catalog, which stopped "
    + "being current when the Catalog authority moved to PostgreSQL. Opening balances imported that way could "
    + "reference Parts that are not the current catalog.",
});

/**
 * Is executing (or offering) an import of this entity type refused under the current Catalog authority?
 * Fails CLOSED: an unknown or missing entity type is refused too.
 */
export function importRefusedByCatalogAuthority(entityType, postgresActive = CATALOG_AUTHORITY_POSTGRES_ACTIVE) {
  if (typeof entityType !== "string" || !KNOWN_IMPORT_ENTITY_TYPES.includes(entityType)) return true;
  return postgresActive === true && CATALOG_BOUND_IMPORT_ENTITY_TYPES.includes(entityType);
}
