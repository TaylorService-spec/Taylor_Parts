import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// Part Alias — A-ENTITY-CATALOG-DEFINITIONS (continues A-ENTITY-MASS-DEFINITION). Describes the
// `part_aliases` collection (INV-1 Phase 1 PR 1.3, ADR-008 Accepted / Decision #40,
// functions/src/partMaster/partAliasRepository.ts's aliasToFirestore/aliasFromFirestore,
// PART_ALIASES_COLLECTION). Records an alternate identifier a Part is ALSO known by --
// UPC/EAN/GTIN barcodes, a manufacturer's own part number, a supplier SKU, a legacy internal
// number, a customer or vendor reference -- each resolving to exactly one canonical partId.
//
// THIS COLLECTION IS UNPOPULATED -- A DORMANT, NOT A LIVE, IDENTITY LAYER. Its own consumer's
// header says so directly: functions/src/partMaster/workOrderSnapshotCompatibility.ts describes
// alias lookups as "unconditional reads of the (still unpopulated, client-closed) part_aliases
// collection [that] return NOT_FOUND until data exists -- behavior today is therefore
// byte-identical passthrough." partAliasCommands.ts's resolvePartAlias exists and is exercised by
// unit tests, but no trusted command that CREATES an alias is wired to any deployed onCall
// adapter, and no seed or migration populates this collection anywhere in this repository. The
// contract below describes what a governed alias document WOULD contain if written through the
// one real repository, not a claim that any such document exists in a live project today.
//
// NO READ PATH OF ANY KIND EXISTS -- readVia IS HONESTLY UNKNOWN, THE SAME SHAPE PAYMENT.JS AND
// RECEIVING_ORDER.JS ALREADY RECORD FOR THEIR OWN COLLECTIONS. firestore.rules'
// `part_aliases/{aliasId}`: "allow read, write: if false" for every principal, admin included --
// stricter even than `parts` (which broadens to PARTS_MANAGER/WAREHOUSE_MANAGER) or
// `equipment_models` (deny-all in Rules but reachable through an undeployed callable,
// equipmentModel.js's own header). Grepping functions/src/index.ts and functions/src/partMaster
// for any exported onCall adapter that reads part_aliases finds none: PartAliasRepository's own
// getByAliasId is called only from resolvePartAlias (partAliasCommands.ts) and from
// workOrderSnapshotCompatibility.ts's server-internal enrichment step -- both trusted-service
// internals, neither exposed to a client. There is no `part.alias.read` (or similar) anywhere in
// the capability catalog. readVia is therefore UNKNOWN, readCallable and readCapability both
// null, and NO list view is declared in this file at all -- an INDEX or RELATED list over a
// collection with no read path of any kind, that is additionally unpopulated, would promise a
// surface nothing can serve twice over.
//
// IDENTITY IS A referenceField -- originalValue, THE ALIAS'S OWN IDENTIFIER STRING. Unlike
// inventoryTransaction.js's `type` (a shared enum member across many rows -- a category, not a
// name, per the Owner's ruling this program already records) or supplierCatalogItem.js's
// composite-key listing (SYSTEM_ONLY -- neither foreign key is unique to one row), originalValue
// genuinely and uniquely identifies THIS alias record: it is the caller-supplied identifier text
// (aliasToFirestore/aliasFromFirestore) that, together with aliasType and an optional
// manufacturerId scope, deterministically derives this document's own id (buildAliasKey /
// encodeAliasDocId) -- no two governed alias documents share the same originalValue within the
// same (aliasType, manufacturerId) scope. It is exactly the durable, human-legible reference a
// person reads to know what this alias record represents ("this is the UPC 012345678905 alias"),
// the same BUSINESS_REFERENCE shape workOrder.js's woNumber or invoice.js's invoiceNumber take,
// not a category label. Declared as referenceField, not nameField -- there is no separate
// free-text display name anywhere on this record.
//
// THE ALIAS-IDENTIFIER CONTRACT IS REUSED, NOT RE-DERIVED. functions/src/partMaster/
// normalization.ts's single normalization authority is the source of the length/encoding limits
// this definition respects rather than restates as a fresh rule: MAX_IDENTIFIER_LENGTH = 120
// (originalValue is rejected above 120 characters, OUT_OF_RANGE); encodeAliasDocId
// (partAliasRepository.ts) percent-encodes exactly two characters storage-unsafe for a Firestore
// doc-id segment -- "%" first, then "/" -- out of the normalized key before it becomes this
// document's own id. originalValue itself is declared as the caller-supplied display value
// (never percent-encoded -- that encoding only ever touches the derived DOCUMENT ID, a separate,
// undeclared-here field per the next paragraph), and normalizedValue is declared as its own
// separate, real, stored field below rather than assumed identical to it.
//
// aliasId (THE DOCUMENT ID) IS NOT DECLARED AS A FIELD -- AND THAT OMISSION IS DELIBERATE, NOT AN
// OVERSIGHT. Every other collection in this program with an enforced doc-id-equals-stored-field
// invariant (part.js's partId, supplier.js's supplierId, manufacturer.js's manufacturerId,
// equipmentModel.js's equipmentModelId) still declares that field as type ID, because the stored
// value there is a readable business-meaningful token in its own right even though it is not
// display identity. Here the document id is instead an ENCODED, DERIVED artifact -- percent-
// escaped, type-prefixed (`<type>__<normalizedValue>`, with MANUFACTURER_PN additionally
// embedding `<manufacturerId>|` inside the normalized value before encoding) -- a storage-layer
// construction a person would never read to identify anything, unlike partId or supplierId which
// ARE the readable identity. Declaring it here as a field would put a second, uglier, purely
// mechanical stand-in for originalValue into the same role DECISIONS #106 already forbids for a
// bare document id. aliasFromFirestore's own re-derivation check (recomputing the expected doc id
// from originalValue/aliasType/manufacturerId and rejecting a stored mismatch as a
// MalformedStoredRecordError) is the real invariant; it does not need a mirrored FieldDefinition
// to be described honestly.
//
// aliasType HAS NO CLIENT-SIDE VOCABULARY MODULE -- LABELS DECLARED INLINE, THE SAME IDIOM
// EQUIPMENTMODEL.JS'S status ALREADY USES FOR AN IDENTICAL GAP. ALIAS_TYPES (ten values:
// INTERNAL_PN/MANUFACTURER_PN/SUPPLIER_SKU/UPC/EAN/GTIN/LEGACY/CUSTOMER_REF/VENDOR_REF/
// BARCODE_OTHER, functions/src/partMaster/types.ts) has no field-ops-app-vite domain mirror
// anywhere in this repository (a full grep of src/domain finds none) -- creating one is a
// separate lane's write (this lane's writeScope is exactly three files), so labels are declared
// inline here rather than left undeclared.
//
// partId POINTS AT THE REGISTERED `part` ENTITY -- A REAL REFERENCE, THE SAME SHAPE
// EQUIPMENTMODEL.JS'S manufacturerId TAKES ONCE ITS TARGET EXISTED. Unlike supplierCatalogItem.js's
// legacy partId (a bare, unverified SKU string -- see that file's header), this collection's
// partId is parsed and validated by parsePartId (validation.ts) on every read
// (aliasFromFirestore throws MalformedStoredRecordError on a malformed value) and is the SAME
// branded PartId type Part Master's own repository enforces -- a genuine, resolvable edge into
// `parts/{partId}`.
//
// manufacturerId IS CONDITIONALLY REQUIRED, NOT UNIVERSALLY OPTIONAL -- A REAL STRUCTURAL RULE,
// NOT A LOOSE ONE. aliasFromFirestore enforces it BOTH ways: required when aliasType is
// MANUFACTURER_PN ("alias ... is MANUFACTURER_PN without manufacturer scope"), and FORBIDDEN
// otherwise ("alias ... carries a forbidden manufacturer scope for ${aliasType}"). Declared as a
// REFERENCE to the registered `manufacturer` entity (manufacturer.js), optional at the
// FieldDefinition level since the v1 contract (entityDefinition.js) has no per-field conditional-
// requirement vocabulary -- the conditional rule itself is recorded here in prose, matching the
// restraint part.js's own equipmentModelId field takes for its similarly conditional
// (wholeUnit-gated) legality rule.
//
// status IS THE TWO-VALUE LIFECYCLE ENUM (ACTIVE/INACTIVE, ALIAS_STATUSES). deactivatedAt/
// deactivatedBy ARE BOTH GENUINELY OPTIONAL -- StoredPartAlias declares them as optional fields
// (`?:`), present only once a governed deactivation command runs; a freshly created alias carries
// neither.
//
// effectiveFrom / effectiveTo ARE STORED AS PLAIN STRINGS, NOT DATE -- StoredPartAlias types both
// as `string`, never a Date/Timestamp; aliasFromFirestore reads them with a `typeof === "string"`
// guard, never `instanceof Timestamp`. Declaring DATE here would assert a stored representation
// this repository does not use.
//
// source IS A PLAIN, UNCONSTRAINED STRING -- aliasFromFirestore defaults it to the literal string
// "unknown" when the stored value is not a string, but the accepted-value set itself is not a
// closed vocabulary anywhere in partAliasRepository.ts or types.ts (no enum, no registry) -- the
// same restraint equipmentModel.js's own sourceAuthority field takes for an identical shape.
//
// PROVENANCE IS FULLY DECLARED AND GENUINELY ENFORCED. version/createdAt/createdBy/updatedAt/
// updatedBy are all required on every StoredPartAlias (StoredMeta, partMasterRepository.ts) --
// aliasFromFirestore rejects a record missing or malformed on any of the four ("has malformed
// version/audit metadata"), and createdAt/updatedAt are real Firestore server Timestamps
// (Timestamp.fromDate in aliasToFirestore), never epoch milliseconds -- the same strength of
// guarantee part.js's own provenance block already records for its sibling INV-1 collection.
export const partAliasEntity = makeEntityDefinition({
  id: "partAlias",
  label: "Part Alias",
  labelPlural: "Part Aliases",
  collection: "part_aliases",
  readVia: "UNKNOWN",
  readCapability: null,
  identity: makeIdentity({ referenceField: "originalValue" }),
  description:
    "An alternate identifier (UPC/EAN/GTIN, manufacturer part number, supplier SKU, legacy number, " +
    "customer/vendor reference) that resolves to one canonical Part (ADR-008 / Decision #40). Deny-all in " +
    "Rules with no read path of any kind, and still unpopulated -- see the file header.",
  fields: [
    makeFieldDefinition({
      id: "partId",
      entityId: "partAlias",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The canonical Part this alias resolves to. Parsed and validated (parsePartId) on every read; a malformed value throws rather than silently passing through.",
    }),
    makeFieldDefinition({
      id: "aliasType",
      entityId: "partAlias",
      label: "Alias Type",
      type: "ENUM",
      enumValues: ["INTERNAL_PN", "MANUFACTURER_PN", "SUPPLIER_SKU", "UPC", "EAN", "GTIN", "LEGACY", "CUSTOMER_REF", "VENDOR_REF", "BARCODE_OTHER"],
      enumLabels: {
        INTERNAL_PN: "Internal Part Number",
        MANUFACTURER_PN: "Manufacturer Part Number",
        SUPPLIER_SKU: "Supplier SKU",
        UPC: "UPC Barcode",
        EAN: "EAN Barcode",
        GTIN: "GTIN Barcode",
        LEGACY: "Legacy Number",
        CUSTOMER_REF: "Customer Reference",
        VENDOR_REF: "Vendor Reference",
        BARCODE_OTHER: "Other Barcode",
      },
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "The ten accepted alias types (functions/src/partMaster/types.ts ALIAS_TYPES). No client-side vocabulary module exists for this enum -- labels declared inline, the same idiom equipmentModel.js's status field already uses. See the file header.",
    }),
    makeFieldDefinition({
      id: "originalValue",
      entityId: "partAlias",
      label: "Value",
      type: "STRING",
      sortable: true,
      description: "The caller-supplied identifier text, preserved verbatim (never mutated by normalization). Required, non-empty, at most 120 characters (functions/src/partMaster/normalization.ts's MAX_IDENTIFIER_LENGTH). The referenceField half of identity -- see the file header.",
    }),
    makeFieldDefinition({
      id: "normalizedValue",
      entityId: "partAlias",
      label: "Normalized Value",
      type: "STRING",
      description: "Deterministic normalization of originalValue (normalizeIdentifier) -- upper-cased and whitespace-collapsed for text types, digits-only with preserved leading zeroes for UPC/EAN/GTIN, MANUFACTURER_PN additionally prefixed `<manufacturerId>|`. Re-derived and checked against the stored value on every read; a mismatch is a MalformedStoredRecordError, never silently renormalized.",
    }),
    makeFieldDefinition({
      id: "manufacturerId",
      entityId: "partAlias",
      label: "Manufacturer",
      type: "REFERENCE",
      referenceTo: "manufacturer",
      description: "Required when aliasType is MANUFACTURER_PN, and forbidden for every other alias type -- both directions enforced by aliasFromFirestore. See the file header for the exact rule.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "partAlias",
      label: "Status",
      type: "ENUM",
      enumValues: ["ACTIVE", "INACTIVE"],
      enumLabels: { ACTIVE: "Active", INACTIVE: "Inactive" },
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "ACTIVE/INACTIVE (functions/src/partMaster/types.ts ALIAS_STATUSES). No client-side vocabulary module exists for this enum -- labels declared inline, matching aliasType above.",
    }),
    makeFieldDefinition({
      id: "source",
      entityId: "partAlias",
      label: "Source",
      type: "STRING",
      description: "Free text describing where this alias came from. Not a closed vocabulary in the D1 contract -- defaults to the literal \"unknown\" when the stored value is not a string. Not filterable or sortable; nothing scans by it.",
    }),
    makeFieldDefinition({
      id: "effectiveFrom",
      entityId: "partAlias",
      label: "Effective From",
      type: "STRING",
      description: "Optional. Stored as a plain string, never a DATE/TIMESTAMP -- StoredPartAlias types this as `string`, and aliasFromFirestore reads it with a typeof guard, not instanceof Timestamp. See the file header.",
    }),
    makeFieldDefinition({
      id: "effectiveTo",
      entityId: "partAlias",
      label: "Effective To",
      type: "STRING",
      description: "Optional. Stored as a plain string, never a DATE/TIMESTAMP -- see effectiveFrom and the file header.",
    }),
    makeFieldDefinition({
      id: "deactivatedAt",
      entityId: "partAlias",
      label: "Deactivated",
      type: "TIMESTAMP",
      description: "Optional -- present only once a governed deactivation command runs on this alias. A real Firestore server Timestamp when present, never epoch milliseconds.",
    }),
    makeFieldDefinition({
      id: "deactivatedBy",
      entityId: "partAlias",
      label: "Deactivated By",
      type: "STRING",
      description: "Actor uid. Optional -- present only alongside deactivatedAt.",
    }),
    makeFieldDefinition({
      id: "version",
      entityId: "partAlias",
      label: "Version",
      type: "NUMBER",
      description: "Repository-owned optimistic-concurrency counter, starting at 1. Required on every stored record (StoredMeta) -- never caller-supplied.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "partAlias",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp (Timestamp.fromDate), never epoch milliseconds. Required on every stored record.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "partAlias",
      label: "Created By",
      type: "STRING",
      description: "Actor uid. Required on every stored record.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "partAlias",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, never epoch milliseconds. Required on every stored record.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "partAlias",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid. Required on every stored record.",
    }),
  ],
  // No relationships declared. The partId and manufacturerId edges are already expressed as
  // REFERENCE fields above -- a relationships[] entry would duplicate them, not add a new one.
});

// No list view is declared -- readVia is UNKNOWN because no read path of any kind exists (see the
// file header), and this collection is additionally still unpopulated. An INDEX or RELATED list
// over an unreachable, empty collection would promise a surface nothing can actually serve, the
// same restraint payment.js and salesTerritory.js already apply to their own unreachable reads.
