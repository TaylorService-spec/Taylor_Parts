import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// Receiving Order — A-ENTITY-PROCUREMENT-DEFINITIONS. Describes the `receiving_orders` collection
// (EI Phase-2 Receiving, docs/specifications/enterprise-inventory-receiving-phase2.md; functions/src/
// inventoryReceiving/receivingTypes.ts's ReceivingOrderValue/DeserializedReceivingOrder types and
// receivingRepository.ts's serializeReceivingOrder() — the collection's only writer, invoked from
// receiveInventoryStockCommand.ts INSIDE a Firestore transaction via `txn.create()`, never `.update()` or
// `.set()`).
//
// readVia IS UNKNOWN, NOT CALLABLE, EVEN THOUGH THIS COLLECTION IS DENY-ALL. firestore.rules'
// `match /receiving_orders/{receivingId} { allow read, create, update, delete: if false; }` is real and
// unconditional (docs comment: "FULLY BACKEND-PRIVATE ... Deny ALL client reads AND writes for every
// principal, admin included"). Per entityDefinition.js's own contract, deny-all normally means
// `readVia: "CALLABLE"` with the real `readCallable` named — but no such callable exists. Grepping
// functions/src/inventoryReceiving/receivingCallables.ts finds exactly two exported callables:
// `receiveInventoryStockCallable` (a WRITE — it CREATES a receiving order, matching
// `inventory.stock.receive`) and `listReceivingLocationOptionsCallable` (reads eligible WAREHOUSE
// options for the receiving-location picker, never a receiving_orders document). No function anywhere
// in this repository reads back a receiving_orders document by id, by query, or in bulk. There is
// therefore no honest `readCallable` to name — `readVia` is `UNKNOWN` and `readCallable` stays `null`,
// per the identity/readVia contract's own instruction for exactly this case, rather than inventing one.
//
// inventory.stock.receive IS REAL AND GRANTED, BUT IT GATES THE WRITE PATH, NOT ANY READ.
// functions/src/access/permissionCatalog.ts registers `inventory.stock.receive`
// ("Receive inbound stock into an inventory location against a reorder purchase order"), and
// functions/src/access/compatibilityRoles.ts's COMPATIBILITY_BASE_PERMISSIONS grants it DIRECTLY to
// admin + dispatcher (Owner-ratified, Codex round 1) — Owner inherits by composition, so the effective
// holder set is {admin, dispatcher, owner}. This CONTRADICTS functions/src/index.ts's own export
// comment above `receiveInventoryStock`/`listReceivingLocationOptions`
// ("REGISTERED BUT UNGRANTED -- so every real user is denied until a separate grant gate") — that
// comment describes an earlier state the grant in compatibilityRoles.ts has since superseded; recorded
// here as a documentation-drift finding, not silently reconciled. Separately, and independently of the
// grant, "export is not deployment" (index.ts's own words) — the callable is not deployed to production.
// None of this changes `readCapability`: `inventory.stock.receive` authorizes CREATING a receiving
// order, never reading one back, so `readCapability` stays `null` rather than citing a capability that
// gates a different action.
//
// IDENTITY: NEITHER A nameField NOR A referenceField EXISTS, AND THAT IS A RECORDED GAP. Every stored
// field was checked against receivingRepository.ts's serializeReceivingOrder():
//   - `receivingId` is the document id, `"rcv_" + sha256(idempotencyKey).slice(0, 40)` — a deterministic
//     hash, never typed or read by a human, and promoting a document id into identity is exactly what
//     DECISIONS #106 forbids (the same document-id-as-label pattern this program has corrected five
//     times elsewhere — see reorderRequest.js's own header for the sixth instance this leaf lane found).
//   - `idempotencyKey` is a caller-supplied opaque string (receivingCallables.ts validates only
//     `isNonBlankString` — no format, no human-facing convention) used purely for replay-safety, not a
//     name or reference a person reads.
//   - `fingerprint` is a 16-hex sha256 digest over the request value — a technical dedup checksum, not
//     an identity.
//   - No field anywhere in this schema is a server-allocated sequential business reference (no
//     REC-YYYY-###### family member the way WO-/OPP-/SO- exist), and there is no live UI surface at all
//     to have established a de facto human-facing label the way purchaseOrder.js's externalPoNumber was
//     (this collection is unreadable by any client or callable read path — see readVia above).
//   Recorded here rather than nominating a category field as a stand-in, the same discipline
//   reorderRequest.js's header applies and the orchestration ledger's X-INVENTORY-TRANSACTION-NO-IDENTITY
//   / X-TRANSFER-ORDER-NO-REFERENCE entries already established as this program's precedent.
//   validateEntityDefinition is EXPECTED to report this gap — see test/metadataProcurementDefinitions.
//   test.mjs, which asserts the exact single problem string.
//
// source / receivingLocation / actor ARE NESTED MAPS, FLATTENED TO INDIVIDUALLY-DESCRIBED SCALARS —
// FIELD_TYPE v1 has no composite/struct type (location.js's header already establishes this idiom for
// its own `address` map; the same restraint applies here).
//
// source.type HAS EXACTLY ONE LEGAL VALUE TODAY. receivingTypes.ts's RECEIVING_SOURCE_TYPES is
// `["REORDER_PURCHASE_ORDER"]` — the first (and only) supported source per spec §2. Declared ENUM with
// that one value, not filterable — the same "exactly one legal value" restraint purchaseOrder.js applies
// to its own single-value `status`.
//
// source.reorderRequestId / source.purchaseOrderId ARE REFERENCES TO THE REGISTERED `reorderRequest`
// (this leaf lane's own reorderRequest.js) AND `purchaseOrder` (purchaseOrder.js) ENTITIES.
// receivingTypes.ts's own comment on `purchaseOrderId` says so directly: "== reorderRequestId (spec §2)"
// — both fields hold the same value, one per name, mirroring the 1:1 doc-id invariant purchaseOrder.js
// already documents. No relationship is declared FROM this entity for either (see readVia above: there
// is no established read path for a runtime to ever traverse FROM a receiving order at all), but the
// REFERENCE typing itself stands, matching the same restraint stockLocation.js applies to its own
// warehouseId/partId REFERENCE fields that are declared without an owning relationship.
//
// receivingLocation.type IS PINNED TO EXACTLY "WAREHOUSE" BY THE RECEIVING-SPECIFIC VALIDATOR, TIGHTER
// THAN THE SHARED LocationRef's GENERAL 6-VALUE VOCABULARY. The generic
// inventoryLedger/operationalMovementValidation.ts's validateLocationRef() (reused here) permits
// INVENTORY_LOCATION_TYPES = [WAREHOUSE, BIN, MOBILE, VENDOR, CUSTOMER, VIRTUAL], but
// receivingCallables.ts's own input guard is strictly narrower: `if (loc.type !== "WAREHOUSE") throw
// invalidArg(...)` — the governed §3A ACTIVE-warehouse resolver this program's Receiving Location
// Authority work established. Declared ENUM with the one value the actual command accepts, not the
// shared type's wider vocabulary it never reaches in practice. Because it is pinned to WAREHOUSE,
// receivingLocation.locationId is safely declared REFERENCE to the registered `warehouse` entity
// (warehouse.js) — unlike the polymorphic LocationRef the ledger types generally allow, there is no
// ambiguity about what this specific field points at.
//
// lines DOES NOT EXIST AS A FIELD — AN EMBEDDED ARRAY, LEFT UNDECLARED. Same restraint salesOrder.js
// applies to its own `lines`: FIELD_TYPE v1 has no struct/array-of-struct type, and each line
// (lineId/partId/trackingMode/expectedQuantity/receivedQuantity/status/serialNumbers?) is itself a
// multi-field record, not a flat column any list here could render.
//
// createdAt/updatedAt ARE TIMESTAMP, NOT NUMBER — receivingRepository.ts's serializeReceivingOrder()
// writes `Timestamp.fromDate(now)` for both, a real Firestore Timestamp (unlike reorderRequest.js's/
// purchaseOrder.js's epoch-millisecond NUMBER fields, written by a different client-side write path).
// DeserializedReceivingOrder's own TypeScript comment ("Server timestamps are exposed as epoch millis —
// no Timestamp leak") describes the READ-side conversion a future read service would perform, not the
// STORED shape this definition describes.
//
// PROVENANCE IS PRESENT BUT STRUCTURALLY INERT: updatedAt/updatedBy ALWAYS EQUAL createdAt/createdBy.
// serializeReceivingOrder() sets both pairs from the SAME `now`/`actor.id` in one call, and
// receivingRepository.ts's `txn.create()` is the only write this collection ever receives — no update
// path exists to ever make them diverge. Declared as real fields (they are genuinely written), with
// this append-only fact recorded rather than implied by their mere presence.
export const receivingOrderEntity = makeEntityDefinition({
  id: "receivingOrder",
  label: "Receiving Order",
  labelPlural: "Receiving Orders",
  // No client-side RECEIVING_ORDERS_COLLECTION constant exists in domain/constants.js (only
  // functions/src/inventoryReceiving/receivingTypes.ts's own RECEIVING_ORDERS_COLLECTION, a backend-only
  // module this frontend metadata layer does not import) — the literal here matches that backend
  // constant, the same "no client constant exists" restraint warehouse.js records for its own
  // `collection` value.
  collection: "receiving_orders",
  // Deny-all in firestore.rules, and no read callable exists to name — see the file header.
  readVia: "UNKNOWN",
  readCallable: null,
  // inventory.stock.receive gates the WRITE path only; no capability gates reading this collection at
  // all, because nothing reads it — see the file header.
  readCapability: null,
  // Neither nameField nor referenceField exists — a recorded gap, not an omission. See the file header.
  identity: makeIdentity(),
  description:
    "The governed receipt record for inbound stock — receiving_orders. Backend-private: deny-all in " +
    "firestore.rules, staged only by the trusted receiveInventoryStock command inside its own " +
    "transaction. No read path (client or callable) exists anywhere in this repository today. See the " +
    "file header for why identity has neither a nameField nor a referenceField.",
  fields: [
    makeFieldDefinition({
      id: "receivingId",
      entityId: "receivingOrder",
      label: "Receiving Order ID",
      type: "ID",
      description: "The Firestore document id, also written into the document body. Server-derived — \"rcv_\" + sha256(idempotencyKey).slice(0, 40) — never accepted from input.",
    }),
    makeFieldDefinition({
      id: "schemaVersion",
      entityId: "receivingOrder",
      label: "Schema Version",
      type: "NUMBER",
      description: "Storage-schema discriminator (RECEIVING_SCHEMA_VERSION). Currently always 1.",
    }),
    makeFieldDefinition({
      id: "sourceType",
      entityId: "receivingOrder",
      label: "Source Type",
      type: "ENUM",
      enumValues: ["REORDER_PURCHASE_ORDER"],
      enumLabels: { REORDER_PURCHASE_ORDER: "Reorder Purchase Order" },
      description: "Stored at `source.type`. Exactly one legal value today (receivingTypes.ts's RECEIVING_SOURCE_TYPES) — not filterable, the same restraint purchaseOrder.js applies to its own single-value status.",
    }),
    makeFieldDefinition({
      id: "sourceReorderRequestId",
      entityId: "receivingOrder",
      label: "Source Reorder Request",
      type: "REFERENCE",
      referenceTo: "reorderRequest",
      description: "Stored at `source.reorderRequestId`. The Reorder Request this receipt is against.",
    }),
    makeFieldDefinition({
      id: "sourcePurchaseOrderId",
      entityId: "receivingOrder",
      label: "Source Purchase Order",
      type: "REFERENCE",
      referenceTo: "purchaseOrder",
      description: "Stored at `source.purchaseOrderId`. Equal to sourceReorderRequestId by the 1:1 doc-id invariant (receivingTypes.ts's own comment: \"== reorderRequestId (spec §2)\").",
    }),
    makeFieldDefinition({
      id: "receivingLocationType",
      entityId: "receivingOrder",
      label: "Receiving Location Type",
      type: "ENUM",
      enumValues: ["WAREHOUSE"],
      enumLabels: { WAREHOUSE: "Warehouse" },
      description: "Stored at `receivingLocation.type`. Pinned to exactly WAREHOUSE by receivingCallables.ts's own input guard — see the file header for why this is narrower than the shared LocationRef vocabulary.",
    }),
    makeFieldDefinition({
      id: "receivingLocationId",
      entityId: "receivingOrder",
      label: "Receiving Location",
      type: "REFERENCE",
      referenceTo: "warehouse",
      description: "Stored at `receivingLocation.locationId`. Safe to declare REFERENCE to `warehouse` because receivingLocationType is pinned to WAREHOUSE — see the file header.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "receivingOrder",
      label: "Status",
      type: "ENUM",
      enumValues: ["PUTAWAY_COMPLETE"],
      enumLabels: { PUTAWAY_COMPLETE: "Putaway complete" },
      description:
        "receivingTypes.ts's ReceivingOrderValue.status is the TypeScript literal \"PUTAWAY_COMPLETE\" — the " +
        "first slice creates directly at this one status (spec's fuller EXPECTED/CHECKED_IN/PUTAWAY_COMPLETE/" +
        "CANCELLED lifecycle is specified for later multi-step gates, not yet reachable). Not filterable — the " +
        "same \"exactly one legal value\" restraint purchaseOrder.js applies to its own status.",
    }),
    makeFieldDefinition({
      id: "version",
      entityId: "receivingOrder",
      label: "Version",
      type: "NUMBER",
      description: "RECEIVING_INITIAL_VERSION. Currently always 1 — the first slice writes no later version.",
    }),
    makeFieldDefinition({
      id: "idempotencyKey",
      entityId: "receivingOrder",
      label: "Idempotency Key",
      type: "STRING",
      description: "Caller-supplied opaque replay-safety key (receivingCallables.ts validates only non-blank). Not a human-facing name — see the file header.",
    }),
    makeFieldDefinition({
      id: "actorKind",
      entityId: "receivingOrder",
      label: "Actor Kind",
      type: "ENUM",
      enumValues: ["USER", "SYSTEM"],
      enumLabels: { USER: "User", SYSTEM: "System" },
      description: "Stored at `actor.kind`. Server-authored from the trusted caller's actor, never accepted from untrusted input.",
    }),
    makeFieldDefinition({
      id: "actorId",
      entityId: "receivingOrder",
      label: "Actor ID",
      type: "STRING",
      description: "Stored at `actor.id`. The acting uid (kind USER) or system identifier (kind SYSTEM). Same value as createdBy/updatedBy below.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "receivingOrder",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore Timestamp (Timestamp.fromDate(now)) — see the file header for why this differs from reorderRequest.js's/purchaseOrder.js's epoch-millisecond NUMBER fields.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "receivingOrder",
      label: "Created By",
      type: "STRING",
      description: "== actor.id. Every stored record carries one.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "receivingOrder",
      label: "Updated",
      type: "TIMESTAMP",
      description: "A real, written field — but always equal to createdAt, since this document is only ever created (txn.create()), never updated. See the file header.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "receivingOrder",
      label: "Updated By",
      type: "STRING",
      description: "A real, written field — but always equal to createdBy, for the same reason as updatedAt. See the file header.",
    }),
    makeFieldDefinition({
      id: "fingerprint",
      entityId: "receivingOrder",
      label: "Fingerprint",
      type: "STRING",
      description: "A 16-hex sha256 digest over the request-derived value (fingerprintReceivingOrder()) — a technical replay/idempotency checksum, not a human identity. See the file header.",
    }),
  ],
  // No relationships declared — there is no established read path for any runtime to traverse FROM
  // this entity. See the file header.
});

// No ListViewDefinition is declared for this entity. This collection has no read path at all (client
// or callable) — see the file header's readVia finding — so there is no real query, filtered or
// unfiltered, for an index to describe honestly. Declaring one would promise a list a runtime can never
// actually load.
