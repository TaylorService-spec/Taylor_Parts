import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { TRANSFER_ORDER_STATUSES } from "../../domain/inventoryTransferPairing.js";
import { TRANSFER_STATUS_META } from "../../domain/transfersView.js";

// Transfer Order — S-INV-TRANSFER-MANUFACTURER-DEFINITIONS. Describes the LIVE `transfer_orders`
// collection (Enterprise Inventory Phase 4 operating authority, functions/src/inventoryTransfer/
// transferOrderRepository.ts's serializeTransferOrder/deserializeTransferOrder — the SAME
// collection the pure EI-P1c-1 read adapter (domain/transferOrderView.js's toTransferRef) and
// firestore.rules' `transfer_orders` match block already govern; no second collection, no Rules
// change, per that repository file's own header).
//
// IDENTITY: BUSINESS_REFERENCE, PER THE OWNER'S RULING (A-IDENTITY-MODES,
// X-TRANSFER-ORDER-NO-REFERENCE). This definition previously held identity empty — genuinely no
// nameField (nothing on the stored document or the read model is a human-entered name) and, at
// the time, no referenceField either, because no allocateTransferOrderNumber (or equivalent)
// existed anywhere in functions/src or field-ops-app-vite/src. modules/inventory/Transfers.jsx's
// table never even falls back to the id — transferOrderId is used ONLY as the React `key` and the
// opaque argument to dispatch/receive/cancel action handlers, never printed on screen.
// Inventing a nameField (or promoting partId, a REFERENCE to a DIFFERENT entity describing what
// moves, not this record's own identity) would have been exactly the "fallback to normalize" the
// contract's docstring names as the wrong move — that finding stands and is why this lane held
// rather than invented one on its own authority.
//
// The Owner has now ruled: Transfer Order gets identityMode BUSINESS_REFERENCE, referenceField
// `transferOrderNumber` (TO-YYYY-######), the same numbering FAMILY as WO-/OPP-/SO- and the sibling
// RO-/RR- references this program's other held definitions now also declare. `identity:
// makeIdentity({ referenceField: "transferOrderNumber" })` records the ruling — see the
// transferOrderNumber field below for what is and is not true about it TODAY: the number is
// server-allocated at creation by a numbering lane that has not been built yet, and the field is
// absent on every existing (legacy) document. Declaring the reference field is not a claim that
// numbering is live; it is the identity contract this entity now carries, with the honest gap
// recorded on the field itself rather than papered over with a documentId fallback (the Owner's
// ruling is explicit that documentId must never be exposed while legacy references are absent).
// Numbering + backfill tooling remain a separate lane's work — REGISTRATION_PENDING below.
//
// READ: CLIENT_DIRECT, GATED BY ROLE/RELATIONSHIP, NEVER BY A CAPABILITY. firestore.rules'
// `transfer_orders` match block: `allow read: if isAdminOrDispatcher() ||
// isAssignedToWarehouse(resource.data.fromWarehouseId) || isAssignedToWarehouse(
// resource.data.toWarehouseId)`, `allow create, update, delete: if false` (all writes flow
// through the governed transferOrderCommand.ts family instead). There is no `transferOrder.read`
// (or similar) in the capability catalog. readCapability is therefore null, the same finding
// warehouse.js/supplier.js/purchaseOrder.js already record for their own role-gated collections.
// NOTE, NOT ASSERTED AS METADATA: a WAREHOUSE<->MOBILE transfer carries neither legacy field (see
// fromWarehouseId/toWarehouseId below), so isAssignedToWarehouse(undefined) is false on both
// branches of the OR — only isAdminOrDispatcher() can read that shape. This is a real Rules
// consequence of the additive legacy-field design, not something this v1 metadata contract has a
// way to express (there is no per-shape conditional read gate concept here).
//
// fromWarehouseId / toWarehouseId ARE REFERENCES TO THE NOW-REGISTERED `warehouse` ENTITY,
// OPTIONAL, LEGACY-SHAPED. serializeTransferOrder writes them ADDITIVELY, "WHEN both endpoints
// are WAREHOUSE" (transferOrderRepository.ts's own header) — a WAREHOUSE<->MOBILE(truck) transfer
// (Phase 4's TRANSFER_ENDPOINT_TYPES fence: WAREHOUSE + MOBILE only) carries neither. These are
// also, not incidentally, the EXACT two fields firestore.rules reads for the OR-gated read check
// above — declaring them as REFERENCE fields is honest now that warehouse.js exists to point at
// (it did not when transferOrderView.js's own GOVERNANCE section was written). Not filterable —
// fetchTransferOrderDocs (services/operationsQueries.ts) runs `getDocs(collection(db,
// TRANSFER_ORDERS_COLLECTION))` with no `.where()` at all; nothing queries by either field.
//
// origin / destination, serialNumbers, AND actor ARE DELIBERATELY NOT DECLARED — EMBEDDED
// STRUCTURES WITH NO v1 FIELD_TYPE. origin/destination are the GENERALIZED Location references
// (`{ type, locationId }`, EI-P1b-1/-2 convention) transferOrderRepository.ts always writes
// alongside the legacy scalars; serialNumbers is a string array present only when
// trackingMode === "SERIAL" (TransferOrderValue.serialNumbers, quantity === serialNumbers.length);
// actor is `{ kind: "USER" | "SYSTEM", id }`. None has a FIELD_TYPE this v1 vocabulary fits — the
// same gap part.js's `flags` and salesOrder.js's `lines` leave undeclared rather than approximated
// with a flat column that would misdescribe a struct.
//
// trackingMode IS DECLARED AS STORED, WHICH CONTRADICTS AN EARLIER GOVERNANCE COMMENT — RECORDED,
// NOT SILENCED. transferOrderRepository.ts's serializeTransferOrder writes
// `trackingMode: value.trackingMode` onto every document (TRANSFER_SUPPORTED_TRACKING_MODES:
// NONE | SERIAL, the same NONE/SERIAL subset Receiving supports, LOT deferred). But the EARLIER
// pure read adapter this same collection already had (domain/transferOrderView.js's own
// GOVERNANCE section) states as an authorized EI-P1c-1 decision: "trackingMode is Part authority
// -- never stored on, derived from, or copied out of a transfer order. This adapter neither reads
// nor emits it." The Phase 4 governed writer that came after does exactly what that earlier
// decision said never to do. This definition describes what firestore.rules and the repository
// actually persist (readVia is CLIENT_DIRECT — an authorized reader gets the WHOLE document, not
// the narrow projection toTransferRef() builds), and records the contradiction rather than
// silently resolving it one way or the other; reconciling the two governance statements is a
// decision this lane does not own.
//
// status VOCABULARY COMES FROM EXISTING MODULES, NEVER A SECOND COPY HERE.
// TRANSFER_ORDER_STATUSES is inventoryTransferPairing.js's canonical machine-value export (the
// WORKFLOW authority — see that module's own header); TRANSFER_STATUS_META (label+tone) already
// exists in domain/transfersView.js, the label+tone pairing warehouse.js/supplier.js already
// established for their own status fields. The exact "no canonical label map exists" gap this
// program's other new vocabulary modules exist to close does NOT exist here, so none is added.
// filterable/sortable, forward-looking (see the index list doc below), mirroring the client-side
// TRANSFER_FILTERS split transfersView.js already offers over the unbounded fetch.
//
// idempotencyKey AND fingerprint ARE DECLARED, RENDERED-ONLY, INTERNAL. idempotencyKey is the
// caller-supplied replay key (assertIdempotencyKey); fingerprint is a 16-hex sha256 over the
// CREATE value (fingerprintTransferOrder) used only to distinguish an applied write from a
// replayed one. Both are genuinely stored on every document, so omitting them would be its own
// kind of dishonesty, but neither is business data a person reads or a query narrows by.
//
// schemaVersion IS DELIBERATELY NOT DECLARED. TRANSFER_SCHEMA_VERSION is a pure internal
// deserialize-compatibility gate (deserializeTransferOrder throws if it does not match) — no
// precedent definition in this program declares an analogous internal format-version field, and
// this one carries no business or query meaning either.
//
// quantity IS A PLAIN NUMBER, NOT A CURRENCY_MINOR OR A COMPUTED STOCK FIGURE. A unit count at
// CREATE time (`quantity === serialNumbers.length` when SERIAL, enforced by
// deserializeTransferOrder), never re-derived from ledger events — the pure pairing contract
// (inventoryTransferPairing.js) computes per-serial state separately and never sums quantities,
// the same restraint its own header names.
export const transferOrderEntity = makeEntityDefinition({
  id: "transferOrder",
  label: "Transfer Order",
  labelPlural: "Transfer Orders",
  collection: "transfer_orders",
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role/relationship (admin/dispatcher, or a WAREHOUSE_MANAGER assigned to
  // either endpoint warehouse), not by a capability. Recorded as null rather than invented — see
  // the header.
  readCapability: null,
  // BUSINESS_REFERENCE, per the Owner's ruling. See the file header.
  identity: makeIdentity({ referenceField: "transferOrderNumber" }),
  description:
    "The Enterprise Inventory Phase 4 operating record moving stock between two Locations (WAREHOUSE/MOBILE " +
    "only). Identity is transferOrderNumber (TO-YYYY-######), server-allocated by a numbering lane not yet " +
    "built and absent on every existing document — see the file header.",
  fields: [
    makeFieldDefinition({
      id: "transferOrderId",
      entityId: "transferOrder",
      label: "Transfer Order ID",
      type: "ID",
      description:
        "The Firestore document id: \"trf_\" + sha256(idempotencyKey).slice(0,40) (transferOrderDocId), a " +
        "deterministic replay key, never a caller-supplied slug. NOT written into the document body — " +
        "serializeTransferOrder omits it, and toTransferRef()/deserializeTransferOrder both treat a stored " +
        "`id` field as untrusted, failing closed on any conflict rather than trusting it. Not part of " +
        "identity — see the file header.",
    }),
    // THE identity.referenceField, PER THE OWNER'S RULING — see the file header.
    makeFieldDefinition({
      id: "transferOrderNumber",
      entityId: "transferOrder",
      label: "Transfer Order",
      type: "STRING",
      sortable: true,
      description:
        "TO-YYYY-######, the identity.referenceField per the Owner's identity-modes ruling (A-IDENTITY-MODES, " +
        "X-TRANSFER-ORDER-NO-REFERENCE). Server-allocated at creation by a numbering lane that does not yet " +
        "exist — no allocateTransferOrderNumber (or equivalent) is implemented anywhere in functions/src or " +
        "field-ops-app-vite/src as of this definition. ABSENT ON EVERY EXISTING (LEGACY) transfer_orders " +
        "document — the collection predates this field and no backfill has run. A renderer must not fall " +
        "back to the Firestore document id when this field is missing; an honest empty/placeholder state is " +
        "required instead, per the Owner's ruling that documentId must never be exposed while legacy " +
        "references are absent.",
    }),
    makeFieldDefinition({
      id: "partId",
      entityId: "transferOrder",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The single Part this Transfer Order moves — Phase 4 is single-part per order. Not filtered — no query narrows by it today.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "transferOrder",
      label: "Status",
      type: "ENUM",
      enumValues: [...TRANSFER_ORDER_STATUSES],
      enumLabels: Object.fromEntries(TRANSFER_ORDER_STATUSES.map((s) => [s, TRANSFER_STATUS_META[s].label])),
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "REQUESTED / IN_TRANSIT / COMPLETED / CANCELLED. Filterable/sortable as a forward-looking declaration — see the file header.",
    }),
    makeFieldDefinition({
      id: "fromWarehouseId",
      entityId: "transferOrder",
      label: "From Warehouse",
      type: "REFERENCE",
      referenceTo: "warehouse",
      description:
        "Legacy scalar, written ONLY when both origin and destination are WAREHOUSE (serializeTransferOrder). " +
        "Absent on a WAREHOUSE<->MOBILE transfer. Also the field firestore.rules reads for the read-authorization " +
        "OR-check — see the file header. Not filterable — no query narrows by it today.",
    }),
    makeFieldDefinition({
      id: "toWarehouseId",
      entityId: "transferOrder",
      label: "To Warehouse",
      type: "REFERENCE",
      referenceTo: "warehouse",
      description: "Legacy scalar, written ONLY when both origin and destination are WAREHOUSE — see fromWarehouseId and the file header.",
    }),
    // NONE/SERIAL only (TRANSFER_SUPPORTED_TRACKING_MODES) — a subset of domain/
    // partTrackingMode.js's PART_TRACKING_MODES (which also has LOT; LOT is out of Phase 4's
    // scope). No existing client label map covers this two-value subset, so labels are inlined
    // here rather than adding a module for a single consumer — the same restraint
    // purchaseOrder.js applies to its own single-value status enum.
    makeFieldDefinition({
      id: "trackingMode",
      entityId: "transferOrder",
      label: "Tracking Mode",
      type: "ENUM",
      enumValues: ["NONE", "SERIAL"],
      enumLabels: { NONE: "Not tracked", SERIAL: "Serialized" },
      description: "Stored on every document — see the file header for why this contradicts an earlier, still-committed governance comment on this same collection.",
    }),
    makeFieldDefinition({
      id: "quantity",
      entityId: "transferOrder",
      label: "Quantity",
      type: "NUMBER",
      description: "A unit count at CREATE time (== serialNumbers.length when SERIAL-tracked), never re-derived from ledger events. See the file header.",
    }),
    makeFieldDefinition({
      id: "idempotencyKey",
      entityId: "transferOrder",
      label: "Idempotency Key",
      type: "STRING",
      description: "The caller-supplied replay key this Transfer Order was created with. Internal; not business data a person reads.",
    }),
    makeFieldDefinition({
      id: "version",
      entityId: "transferOrder",
      label: "Version",
      type: "NUMBER",
      description: "Starts at 1 (INITIAL_VERSION); incremented by transitionFields on every status transition. Not filterable or sortable — nothing scans by it.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "transferOrder",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp (Timestamp.fromDate in serializeTransferOrder), never epoch milliseconds.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "transferOrder",
      label: "Created By",
      type: "STRING",
      description: "Actor uid (actor.id at create). Every stored record carries one.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "transferOrder",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, updated by transitionFields on every status transition. Never epoch milliseconds.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "transferOrder",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid of the most recent transition (create or status change).",
    }),
    makeFieldDefinition({
      id: "fingerprint",
      entityId: "transferOrder",
      label: "Fingerprint",
      type: "STRING",
      description: "16-hex sha256 over the CREATE value (fingerprintTransferOrder), used only to distinguish an applied write from a replay. Internal; not business data.",
    }),
  ],
  // No relationships declared. warehouse.transferOrders / part.transferOrders would be real
  // outbound edges FROM those entities, but neither warehouse.js nor part.js is in this lane's
  // writeScope. See REGISTRATION_PENDING.
});

/**
 * The Transfer Order registry index. modules/inventory/Transfers.jsx already renders the real
 * live workspace, but through useTransferOrders/transferOrdersViewModel's own narrow
 * { transferOrderId, partId, status, origin, destination } row shape, not through this metadata
 * contract — a definition is not a surface, the same restraint every other *.index in this
 * program applies.
 *
 * status IS THE ONE DECLARED FILTER, matching transfersView.js's own TRANSFER_FILTERS split
 * (active/in_transit/completed/cancelled/all) — applied CLIENT-SIDE today over the fully
 * unbounded fetchTransferOrderDocs read (no `.where()` at all), the same "forward-looking, single
 * filter" restraint warehouse.js/supplier.js already apply to their own status fields.
 *
 * defaultSort is createdAt DESC (most recent transfer first) — unlike warehouse/supplier's
 * catalog-order default, a Transfer Order is operational, in-flight work; an operator wants what
 * moved most recently, the same activity-order reasoning purchaseOrder.js's own header gives for
 * its createdAt DESC default. transferOrdersViewModel's client-side sort (by transferOrderId, an
 * opaque replay key never shown on screen) is a rendering-stability tiebreak for that specific
 * view, not a business ordering worth mirroring here.
 */
export const transferOrderIndexList = makeListViewDefinition({
  id: "transferOrder.index",
  entityId: "transferOrder",
  label: "Transfer Orders",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "partId" }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "fromWarehouseId" }),
    makeColumn({ fieldId: "toWarehouseId" }),
    makeColumn({ fieldId: "quantity" }),
    makeColumn({ fieldId: "createdAt", sortable: true }),
  ],
  filters: [makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] })],
  defaultSort: [makeSort({ fieldId: "createdAt", direction: "DESC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active",
      // Mirrors TRANSFER_FILTERS' own "active" grouping (REQUESTED + IN_TRANSIT), the
      // operationally-urgent in-flight set.
      filters: [{ fieldId: "status", operator: "IN", value: ["REQUESTED", "IN_TRANSIT"] }],
      sort: [makeSort({ fieldId: "createdAt", direction: "DESC" })],
    }),
  ],
});
