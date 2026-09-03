import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// Inventory Transaction — A-ENTITY-INVENTORY-MOVEMENT-DEFINITIONS. Describes the LIVE
// `inventory_transactions` collection: the SINGLE append-only stock-movement ledger (Epic
// 2D/3, ADR-003; functions/src/inventoryService.ts's own header: "the ONLY source of truth
// for stock movement... availability is always computed by summing this append-only
// ledger"). Never a second ledger — every writer below targets this one collection.
//
// TWO GENUINELY DISJOINT STORED SHAPES SHARE ONE COLLECTION, BOTH LIVE. This is the load-
// bearing fact this definition has to describe honestly, and it is why several fields below
// are legal on only ONE of the two shapes rather than on every document.
//
//   LEGACY (no schemaVersion). Written only by functions/src/inventoryService.ts's
//   reserveParts/releaseParts/consumeParts (writeLedgerEntry(): `tx.set(ref, { ...entry,
//   timestamp: FieldValue.serverTimestamp() })`, entry = {workOrderId, partId, type,
//   quantity}). type is RESERVED | RELEASED | CONSUMED. Carries workOrderId + timestamp;
//   carries no actor, no location, no schemaVersion.
//
//   OPERATIONAL (schemaVersion === 2, functions/src/inventoryLedger/
//   operationalMovementRepository.ts's serializeOperationalMovement()). type is RECEIVED |
//   TRANSFER_IN | TRANSFER_OUT | ADJUSTED. Written by three separate live trusted commands
//   that all funnel through the SAME stageOperationalMovement()/serializeOperationalMovement()
//   pair: functions/src/inventoryReceiving/receiveInventoryStockCommand.ts (RECEIVED),
//   functions/src/inventoryTransfer/transferOrderCommand.ts's dispatchTransferOrder/
//   receiveTransferOrder (TRANSFER_OUT/TRANSFER_IN), functions/src/cycleCount/
//   cycleCountCommand.ts's reconcile step (ADJUSTED). Carries direction, trackingMode,
//   location, sourceObject, idempotencyKey, actor, occurredAt, recordedAt, fingerprint, and
//   conditionally serialNo/lotId/counterpartyLocation; carries no workOrderId, no `timestamp`.
//   classifyLedgerDoc() in that same repository file is the actual runtime discriminator this
//   header mirrors: schemaVersion === 2 ⇒ operational, schemaVersion undefined + a legacy type
//   ⇒ legacy, anything else ⇒ malformed.
//
//   RETURNED / SCRAPPED do NOT appear in the storage type union at all.
//   functions/src/inventoryLedger/operationalMovementTypes.ts's OPERATIONAL_MOVEMENT_TYPES
//   (the design-time taxonomy) includes all six operational names, but the actual STORED
//   type — functions/src/types/inventoryTransaction.ts's InventoryTransactionType — is a
//   narrower union of exactly seven values total: RESERVED | RELEASED | CONSUMED | RECEIVED |
//   TRANSFER_IN | TRANSFER_OUT | ADJUSTED. RETURNED/SCRAPPED have no live writer anywhere (no
//   RMA or Scrap command exists in this repository). The enum below is the seven-value STORED
//   union, not the wider design taxonomy — declaring the wider taxonomy would assert values this
//   collection has never actually held.
//
//   COUNTED was in that design taxonomy and was retired by CERT-LEDGER-COUNTED-08 for exactly the
//   reason this header already gave: it never had a live writer. A cycle count's reconcile step
//   writes ADJUSTED, and "COUNTED" now names only a cycle-count document's own status.
//
// EMBEDDED OBJECTS ARE DELIBERATELY ABSENT — NO v1 FIELD_TYPE FITS A STRUCT. location
// {type, locationId}, sourceObject {type, id}, actor {kind, id} and counterpartyLocation
// (same shape as location) are all real, validated, stored objects on every OPERATIONAL
// record — but FIELD_TYPE (entityDefinition.js) has no STRUCT member, the same gap part.js's
// `flags` and salesOrder.js's `lines` already leave undeclared rather than approximate with a
// STRING or a fabricated REFERENCE. They are not declared here for the same reason.
//
// lotId IS A LEGAL STORED KEY THAT NO LIVE WRITER HAS EVER POPULATED — A REAL, NAMED GAP, NOT
// AN OMISSION. deserializeOperationalMovement()/validateOperationalMovementEvent() both admit
// (and validateOperationalMovementEvent's `mode === "LOT" && !isNonEmptyString(event.lotId)`
// check REQUIRES) a non-empty lotId whenever the moving Part's trackingMode is LOT — LOT is a
// real, reachable Part tracking mode (functions/src/partMaster's CONTROL_TYPES resolves LOT/
// SERIALIZED_LOT parts to it; see cycleCountCallableWiring.ts/receivingCallableWiring.ts/
// transferCallableWiring.ts, all of which route a LOT-mode Part through unchanged). But none
// of the three live callers (receiveInventoryStockCommand.ts, transferOrderCommand.ts,
// cycleCountCommand.ts) ever sets `lotId` on the ledger event object it builds — grep across
// all three finds no `lotId` write anywhere. A LOT-tracked movement through any of the three
// live commands today would therefore fail validateOperationalMovementEvent's own
// "lot_id_invalid" check rather than ever reach storage. Declared as a legal field per the
// storage contract, with this gap recorded rather than silently declared as though it worked.
//
// IDENTITY: SYSTEM_ONLY, PER THE OWNER'S RULING (A-IDENTITY-MODES,
// X-INVENTORY-TRANSACTION-NO-IDENTITY). This entity has neither a human nameField nor a
// server-allocated referenceField — the first entity in this program where that is genuinely
// true. Every other entity here (including purchaseOrder.js's own "no referenceField" finding)
// still has SOME human-typed or human-read string to fall back to. A ledger entry has none: it
// is a system-generated, append-only movement record nobody names or numbers.
//
// AN EARLIER VERSION OF THIS DEFINITION NOMINATED `type` AS nameField — THAT WAS THE EXACT
// ANTI-PATTERN THE RULING REJECTED, AND IT IS NOT REPEATED HERE. `type` resolves the identity
// contract mechanically (HUMAN_NAME, since nameField was set) but is not a name in any real
// sense — many rows share the same type value, and a shared enum member is a category, not an
// identity. The ledger's own X-INVENTORY-TRANSACTION-NO-IDENTITY entry names "nominating a
// category field" as the reason this definition was held rather than merged. `identity:
// makeIdentity({ mode: "SYSTEM_ONLY" })` is the corrected, explicit declaration — SYSTEM_ONLY is
// never derived (resolveIdentityMode, entityDefinition.js), so writing it out is required, not
// stylistic.
//
// A SURFACE THAT NEEDS TO DESCRIBE ONE OF THESE ROWS TO A HUMAN MUST COMPOSE A DESCRIPTION FROM
// SEVERAL FIELDS, NOT READ A SINGLE IDENTITY FIELD. The shipped Recent Transactions table
// (field-ops-app-vite/src/modules/inventory/PartDetail.jsx) already does this: it leads with
// Type, then Quantity, Work Order, When — a composed row, not a single label. The fields a
// composed description should draw from are: `type` (what happened), `partId` (what moved),
// `quantity` (how much), the location fields where present (source/destination — currently
// undeclared embedded structs, see below), `timestamp`/`recordedAt` (when), and, where one
// applies, a related business reference on the record that caused the movement (e.g. a Work
// Order, Transfer Order, or Receiving Order id) rather than any field of this record itself.
//
// PROVENANCE IS APPEND-ONLY, BUT ITS SHAPE DIFFERS BY ERA — DECLARED AS WHAT EACH ACTUALLY
// HAS, NOT NORMALIZED INTO ONE PAIR. This collection is genuinely immutable once written:
// firestore.rules denies `create, update, delete` to every client unconditionally (Admin-SDK-
// only), and every write path (writeLedgerEntry's tx.set on a brand-new doc ref;
// stageOperationalMovement's tx.create) only ever creates a new document, never updates an
// existing one — so there is no updatedAt/updatedBy to omit, structurally, for either era. But
// the two eras do NOT share a createdAt/createdBy pair: LEGACY records carry only a server
// `timestamp` (Timestamp) and NO actor/createdBy field of any kind — nothing in
// writeLedgerEntry's entry shape names who acted. OPERATIONAL records carry a genuine
// provenance pair under different names — `actor` {kind, id} (WHO) and server-authored
// `recordedAt` (WHEN, Timestamp.fromDate(now) in serializeOperationalMovement(), never a
// client-suppliable value — validateOperationalMovementEvent explicitly forbids a caller from
// setting recordedAt at all). Both are declared below, on the era that actually carries them.
//
// partId IS A REFERENCE TO THE REGISTERED `part` ENTITY (part.js). Present on every document
// in both eras (functions/src/inventoryService.ts's legacy writes and every operational
// movement both key on partId), and `part` is registered in this program, so the edge can be
// validated rather than left a plain string the way part.js itself had to leave
// primaryManufacturerId/equipmentModelId (no manufacturer/equipmentModel entity registered).
//
// NEITHER type NOR partId IS DECLARED FILTERABLE. The real server-side queries this
// collection actually serves are narrow equality reads by partId alone
// (getAvailableQuantity()) or by workOrderId+partId together (getOutstandingReservation()) —
// both scoped, single-purpose transactional reads inside a trusted command, never a list
// query a metadata-driven surface would issue. The one real CLIENT read
// (services/operationsQueries.ts's fetchInventoryTransactions()) is an unbounded, unfiltered
// `getDocs` of the whole collection — no `where`, no `orderBy` — filtered and summed
// afterward in JS (domain/inventoryAnalyticsEngine.ts). Declaring a filter here would promise
// an indexed query this collection has never needed to serve, the same restraint
// purchaseOrder.js applies to its own partId.
//
// NO INDEX LIST VIEW IS DECLARED — A DELIBERATE OMISSION, NOT A GAP TO FILL LATER. Every
// other definition in this program (part.index, warehouse.index, purchaseOrder.index) still
// authors a forward-looking INDEX list even with no live route, because each of those
// collections has ONE clean, total-order sortable field spanning every stored document.
// This collection does not: LEGACY documents carry `timestamp`, OPERATIONAL documents carry
// `recordedAt`, and NO document carries both. Firestore's orderBy silently excludes any
// document missing the ordered field, so a defaultSort on either field would make an entire
// era of real, live ledger entries vanish from that list without any error — not a filter
// gap CI's requiredIndexes() check would ever catch, since the demand itself would look
// well-formed. The one real UI table that renders these rows today
// (PartDetail.jsx's Recent Transactions) does not use this metadata's list-view runtime at
// all — it maps the array useInventoryLedger() already fetched, unsorted-by-Firestore,
// client-side. Declaring an INDEX list here would describe a query capability nothing serves
// and nothing needs, the exact category error this program's other definitions avoid.
//
// READ PATH: CLIENT_DIRECT, GATED BY ROLE, NEVER BY A CAPABILITY THAT ACTUALLY EVALUATES.
// firestore.rules' `inventory_transactions/{transactionId}` admits isAdminOrDispatcher() OR
// isActiveOperationalRole("PARTS_MANAGER") OR isActiveOperationalRole("WAREHOUSE_MANAGER") —
// a direct role/relationship check, the same shape part.js/warehouse.js/purchaseOrder.js
// already record. `inventory.transaction.read` DOES exist in the real capability catalog
// (functions/src/access/permissionCatalog.ts: "Read inventory_transactions records.") and its
// declared audience (compatibilityRoles.ts's MANAGER_OR_WAREHOUSE operational-role condition)
// even matches the Rules gate's PARTS_MANAGER/WAREHOUSE_MANAGER arms. But nothing evaluates
// this id to authorize the actual Firestore read — no callable stands between the client and
// this collection; the client's own Firestore SDK call is gated by Rules alone, directly, and
// this catalog id lives in the separate governed-effective-access mirror (used elsewhere for
// reporting/status parity, e.g. governedBusinessRoles.ts/compatibilityRoles.ts), never
// consulted on this read path. Declaring readCapability here would conflate a parallel,
// unconsumed governance mirror with the mechanism that actually decides this read — the exact
// restraint purchaseOrder.js already applies to the unrelated `report.purchaseOrder.read` id.
// readCapability stays null.
export const inventoryTransactionEntity = makeEntityDefinition({
  id: "inventoryTransaction",
  label: "Inventory Transaction",
  labelPlural: "Inventory Transactions",
  collection: "inventory_transactions",
  readVia: "CLIENT_DIRECT",
  // A matching capability id exists in the catalog but nothing evaluates it on this read
  // path — see the header. Recorded as null rather than invented.
  readCapability: null,
  // SYSTEM_ONLY, per the Owner's ruling — explicitly declared, never derived. See the file header.
  identity: makeIdentity({ mode: "SYSTEM_ONLY" }),
  description:
    "An append-only stock-movement ledger entry — the sole source of stock-movement truth (ADR-003). " +
    "Two disjoint stored shapes share this collection: legacy Work-Order reservation entries and " +
    "operational movement entries (Receiving/Transfer/Cycle Count) — see the file header.",
  fields: [
    // The document id. Never re-asserted inside the document body by any live writer (both
    // writeLedgerEntry and stageOperationalMovement's tx.create supply only the fields listed
    // below), the same shape warehouse.js's warehouseId takes. Not part of identity.
    makeFieldDefinition({
      id: "transactionId",
      entityId: "inventoryTransaction",
      label: "Transaction ID",
      type: "ID",
      description: "The Firestore document id. Not written into the document body by any live writer.",
    }),
    // Present on every document in both eras. Registered `part` entity exists — see the header.
    makeFieldDefinition({
      id: "partId",
      entityId: "inventoryTransaction",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The Part this movement concerns. Present on every stored document, legacy or operational. Not filtered — see the file header.",
    }),
    // The seven-value STORED union, not the wider design-time taxonomy — see the file header.
    // Not filterable — see the file header for why no real query narrows by it.
    makeFieldDefinition({
      id: "type",
      entityId: "inventoryTransaction",
      label: "Type",
      type: "ENUM",
      enumValues: ["RESERVED", "RELEASED", "CONSUMED", "RECEIVED", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTED"],
      enumLabels: {
        RESERVED: "Reserved (Work Order)",
        RELEASED: "Released (Work Order)",
        CONSUMED: "Consumed (Work Order)",
        RECEIVED: "Received",
        TRANSFER_IN: "Transfer In",
        TRANSFER_OUT: "Transfer Out",
        ADJUSTED: "Adjusted",
      },
      description: "This entity is identityMode SYSTEM_ONLY — `type` is NOT identity, it is the first field a composed description should draw from. See the file header. RESERVED/RELEASED/CONSUMED are legacy-only; RECEIVED/TRANSFER_IN/TRANSFER_OUT/ADJUSTED are operational-only.",
    }),
    makeFieldDefinition({
      id: "quantity",
      entityId: "inventoryTransaction",
      label: "Quantity",
      type: "NUMBER",
      description:
        "A unit count, never a monetary amount. Positive on RESERVED/RELEASED/CONSUMED/RECEIVED/TRANSFER_IN/TRANSFER_OUT " +
        "(and always exactly 1 when the moving Part is SERIAL-tracked); signed (nonzero, may be negative) on ADJUSTED, " +
        "the one direction: SIGNED movement type (validateQuantityReason, operationalMovementValidation.ts).",
    }),
    // Legacy-only. Absent on every operational-schema document.
    makeFieldDefinition({
      id: "workOrderId",
      entityId: "inventoryTransaction",
      label: "Work Order",
      type: "STRING",
      description: "Legacy-only (RESERVED/RELEASED/CONSUMED). Absent on every operational (RECEIVED/TRANSFER_IN/TRANSFER_OUT/ADJUSTED) document — see the file header.",
    }),
    // Legacy-only. The legacy era's sole temporal/provenance field — see the file header.
    makeFieldDefinition({
      id: "timestamp",
      entityId: "inventoryTransaction",
      label: "Recorded",
      type: "TIMESTAMP",
      description: "Legacy-only. Server-authored (FieldValue.serverTimestamp() in writeLedgerEntry()). Absent on every operational document, which carries recordedAt instead — see the file header.",
    }),
    // Operational-only. The runtime discriminator itself (classifyLedgerDoc()) — see the file header.
    makeFieldDefinition({
      id: "schemaVersion",
      entityId: "inventoryTransaction",
      label: "Schema Version",
      type: "NUMBER",
      description:
        "Operational-only; always 2 (OPERATIONAL_LEDGER_SCHEMA_VERSION). Absent on every legacy document — its absence is " +
        "the actual runtime discriminator classifyLedgerDoc() switches on. Not filterable or sortable: one constant value.",
    }),
    // Operational-only. Derived from type by MOVEMENT_DIRECTION but stored and independently
    // re-validated (deserializeOperationalMovement() rejects a stored record where direction
    // is inconsistent with type) — a real, checked field, not a convenience alias.
    makeFieldDefinition({
      id: "direction",
      entityId: "inventoryTransaction",
      label: "Direction",
      type: "ENUM",
      enumValues: ["IN", "OUT", "SIGNED"],
      enumLabels: { IN: "In", OUT: "Out", SIGNED: "Adjustment" },
      description: "Operational-only. Derived from type at write time and independently re-validated for consistency on read. Absent on every legacy document.",
    }),
    // Operational-only.
    makeFieldDefinition({
      id: "trackingMode",
      entityId: "inventoryTransaction",
      label: "Tracking Mode",
      type: "ENUM",
      enumValues: ["NONE", "SERIAL", "LOT"],
      enumLabels: { NONE: "Untracked", SERIAL: "Serialized", LOT: "Lot" },
      description: "Operational-only. The moving Part's tracking mode at write time, mirrored from partTrackingMode.js's PART_TRACKING_MODES. Absent on every legacy document.",
    }),
    // Operational-only, and only when trackingMode is SERIAL.
    makeFieldDefinition({
      id: "serialNo",
      entityId: "inventoryTransaction",
      label: "Serial #",
      type: "STRING",
      description: "Operational-only, and legal ONLY when trackingMode is SERIAL (validateOperationalMovementEvent rejects it otherwise). Absent everywhere else.",
    }),
    // Operational-only, and only when trackingMode is LOT. See the file header's lotId note —
    // no live writer has ever actually populated this key.
    makeFieldDefinition({
      id: "lotId",
      entityId: "inventoryTransaction",
      label: "Lot #",
      type: "STRING",
      description: "Operational-only, and legal ONLY when trackingMode is LOT. No live writer has ever populated it — a real, named gap; see the file header.",
    }),
    // Operational-only. Caller-supplied idempotency identity (also the seed of the deterministic
    // doc id, operationalMovementDocId()) — internal replay-detection machinery, not a
    // human-facing reference. Not filterable or sortable: nothing queries by it.
    makeFieldDefinition({
      id: "idempotencyKey",
      entityId: "inventoryTransaction",
      label: "Idempotency Key",
      type: "STRING",
      description: "Operational-only. Caller-supplied replay-detection identity, not a human-facing reference. Absent on every legacy document.",
    }),
    // Operational-only. Business time, caller-supplied, plain epoch millis (not a Firestore
    // Timestamp) — the same NUMBER-not-TIMESTAMP reasoning purchaseOrder.js's createdAt gives
    // for its own Date.now() field.
    makeFieldDefinition({
      id: "occurredAt",
      entityId: "inventoryTransaction",
      label: "Occurred At",
      type: "NUMBER",
      sortable: true,
      description: "Operational-only. Caller-supplied business time, epoch milliseconds — never a Firestore Timestamp. Absent on every legacy document.",
    }),
    // Operational-only. Server-authored WHEN half of this era's provenance pair — see the file header.
    makeFieldDefinition({
      id: "recordedAt",
      entityId: "inventoryTransaction",
      label: "Recorded At",
      type: "TIMESTAMP",
      description: "Operational-only. Server-authored (Timestamp.fromDate(now) in serializeOperationalMovement()); a caller-supplied recordedAt is explicitly rejected. Absent on every legacy document, which carries `timestamp` instead — see the file header.",
    }),
    // Operational-only. Internal replay/conflict-detection hash — not human-meaningful.
    makeFieldDefinition({
      id: "fingerprint",
      entityId: "inventoryTransaction",
      label: "Fingerprint",
      type: "STRING",
      description: "Operational-only. A 16-hex payload hash (fingerprintMovement()) used only to distinguish a genuine replay from an idempotency-key conflict. Not human-meaningful; not filterable or sortable.",
    }),
  ],
  // No relationships declared. The one real edge this record has beyond partId (a
  // reorderRequest/receivingOrder/transferOrder/cycleCount sourceObject, embedded — see the
  // file header) is unrepresentable both because it is inside an undeclared embedded object
  // and because receiving_orders/cycle_counts have no registered EntityDefinition in this
  // program either. See REGISTRATION_PENDING.
});
