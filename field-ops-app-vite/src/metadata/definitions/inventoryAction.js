import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { INVENTORY_ACTIONS_COLLECTION, INVENTORY_ACTION_TYPE } from "../../domain/constants.js";

// Inventory Action — A-ENTITY-INVENTORY-ACTION-DEFINITIONS, the final DEFINE item of the
// entity-coverage reconciliation (docs/orchestration/metadata-program/
// entity-coverage-reconciliation.md §1.11). Describes the LIVE `inventory_actions` collection:
// a separate, append-only audit trail for HUMAN-INITIATED inventory adjustments (Receive Stock /
// Adjust Stock / Correct Mistake), Sprint 2.1.9. domain/inventoryActions.js's own header states
// it is "the ONLY writer of inventory_actions — no component calls addDoc/setDoc directly", wired
// LIVE into modules/inventory/PartDetail.jsx (lines 127, 1104).
//
// NEVER THE SAME LEDGER AS inventory_transactions (ADR-003, inventoryTransaction.js). That
// collection is the Work-Order-driven, Admin-SDK-only stock-movement source of truth; this one is
// a client-direct-write companion audit trail for a person's own Receive/Adjust/Correct action.
// domain/constants.js's own comment on INVENTORY_ACTIONS_COLLECTION records the same boundary:
// "this mirrors how `reorder_requests` was added ... as a new parallel Business Object rather than
// touching the ledger". The two collections are never joined or reconciled by any code in this
// repository.
//
// WRITE AND READ ARE BOTH LIVE AND ACTIVELY AUTHORIZED TODAY — the reconciliation's decisive
// finding, confirmed directly against firestore.rules (`match /inventory_actions/{actionId}`):
// `allow read: if isAdminOrDispatcher() || isActiveOperationalRole("WAREHOUSE_MANAGER"); allow
// create: if isAdminOrDispatcher(); allow update, delete: if false.` No inactive capability, no
// Rules deny-all, no pending Owner decision — unlike almost every other candidate the
// reconciliation classified. The reader is modules/inventoryRole/WarehouseManagerHome.jsx's
// useInventoryActionsForPart(partId), a scoped, client-direct query — also LIVE.
//
// THE CREATE RULE HAS NO FIELD-LEVEL VALIDATION AT ALL — unlike reorder_purchase_order_voids
// (purchaseOrderVoid.js) or purchaseOrder.js's own collection, `allow create: if
// isAdminOrDispatcher();` carries no `hasOnly([...])`, no per-field type/shape check, and no
// `request.resource.data.createdBy == request.auth.uid` binding. Every field below is therefore
// shaped by recordInventoryAction() alone (domain/inventoryActions.js), which the file's own
// comment calls "the sole write path" — a real, enforced discipline at the application layer, but
// NOT a Rules-enforced contract the way most other entities in this program get. Recorded here
// rather than glossed over: `createdBy` in particular is a CLIENT-SUPPLIED CLAIM
// (`auth.currentUser?.uid ?? null`), never checked against `request.auth.uid` by Rules — a real
// difference in provenance trust from purchaseOrder.js's own `createdBy` (server-validated ==
// writer's uid) and from purchaseOrderVoid.js's `voidedBy` (same, cross-document-validated). See
// the createdBy field below.
//
// createdAt IS CLIENT-CLOCK-STAMPED, NOT A SERVER TIMESTAMP. src/firebase/collectionStore.js's
// makeCollectionStore().add() stamps `createdAt: Date.now()` itself (not
// FieldValue.serverTimestamp(), and not something recordInventoryAction() sets) — a plain epoch-
// millisecond number computed in the caller's browser, the same NUMBER-not-TIMESTAMP treatment
// purchaseOrder.js's own createdAt already documents for its own Date.now() field. Declared NUMBER
// below, never TIMESTAMP.
//
// IDENTITY: SYSTEM_ONLY, EXPLICITLY DECLARED — matches inventoryTransaction.js's Owner-ruled
// precedent (A-IDENTITY-MODES, X-INVENTORY-TRANSACTION-NO-IDENTITY) exactly. No human types or
// reads a name for one of these rows; no server-allocated business reference exists. `partId` is a
// REFERENCE to another entity, not a name of this one; `transactionType` is a shared enum value
// across many rows, a category rather than an identity — the same "nominating a category field"
// anti-pattern that ruling rejected for inventory_transactions' own `type`. `identity: makeIdentity({
// mode: "SYSTEM_ONLY" })` records the decision explicitly — SYSTEM_ONLY is never derived
// (resolveIdentityMode, entityDefinition.js).
//
// A SURFACE THAT NEEDS TO DESCRIBE ONE OF THESE ROWS TO A HUMAN MUST COMPOSE A DESCRIPTION FROM
// SEVERAL FIELDS, exactly the discipline inventoryTransaction.js's own header names. The fields a
// composed description should draw from are: `transactionType` (what kind of action), `partId`
// (which Part), `quantityDelta` (how much and in which direction), `reason`/`notes` where present
// (why), `createdBy` (who claimed to act — see the provenance note above), and `createdAt` (when).
// There is no related business reference on this record — it is not linked to a Work Order,
// Reorder Request, or any other entity this program registers.
//
// readVia IS CLIENT_DIRECT, READ CAPABILITY IS null. A matching id — `inventory.action.read` —
// exists in the real capability catalog (functions/src/access/permissionCatalog.ts) with a
// declared WAREHOUSE_MANAGER-operational-role condition (compatibilityRoles.ts) that matches the
// Rules gate's own arm. But nothing evaluates this id to authorize the actual Firestore read: no
// callable stands between the client and this collection, and
// functions/src/partMaster/manufacturerReadService.ts's own header names `inventory.action.read`
// (alongside its sibling `inventory.transaction.read`) as living only in the separate governed
// effective-access mirror (effectiveAccessFeed.ts) — used elsewhere for reporting/status parity,
// never consulted on this read path. The client's own Firestore SDK call is gated by Rules alone.
// Declaring readCapability here would conflate that unconsumed governance mirror with the
// mechanism that actually decides this read — the exact restraint inventoryTransaction.js and
// purchaseOrder.js already apply to their own unrelated catalog ids. readCapability stays null.
//
// NO INDEX LIST VIEW IS DECLARED. The one real client query
// (useInventoryActionsForPart(partId), WarehouseManagerHome.jsx) is a scoped, per-Part related
// read, never an unfiltered cross-collection index — there is no live or planned surface that
// browses every inventory_actions row across every Part. Declaring an INDEX list here would
// describe a query capability nothing serves, the same restraint inventoryTransaction.js applies
// to its own collection for a different reason (no total-order sortable field). A RELATED list is
// not declared either: it would need a `partId`-scoped relationship owned by the registered `part`
// entity (part.js), which does not declare one — adding it here would target an edge this registry
// cannot validate from part.js's own side. See REGISTRATION_PENDING.
export const inventoryActionEntity = makeEntityDefinition({
  id: "inventoryAction",
  label: "Inventory Action",
  labelPlural: "Inventory Actions",
  collection: INVENTORY_ACTIONS_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // A matching capability id exists in the catalog but nothing evaluates it on this read
  // path — see the file header.
  readCapability: null,
  // SYSTEM_ONLY, matching inventoryTransaction.js's Owner-ruled precedent. Explicitly
  // declared, never derived. See the file header.
  identity: makeIdentity({ mode: "SYSTEM_ONLY" }),
  description:
    "An append-only audit record of a human-initiated inventory adjustment (Receive Stock / Adjust Stock / " +
    "Correct Mistake) — a separate companion trail to the inventory_transactions ledger, never a second " +
    "source of stock-movement truth. See the file header.",
  fields: [
    // The Firestore document id (auto-generated by addDoc via safeAddDoc). Never re-asserted
    // inside the document body — recordInventoryAction() writes no id-shaped field.
    makeFieldDefinition({
      id: "actionId",
      entityId: "inventoryAction",
      label: "Action ID",
      type: "ID",
      description: "The Firestore document id, auto-generated. Not written into the document body by the sole writer.",
    }),
    makeFieldDefinition({
      id: "partId",
      entityId: "inventoryAction",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The Part this action concerns. Present on every stored document — the registered `part` entity exists.",
    }),
    makeFieldDefinition({
      id: "transactionType",
      entityId: "inventoryAction",
      label: "Action Type",
      type: "ENUM",
      enumValues: Object.values(INVENTORY_ACTION_TYPE),
      enumLabels: {
        [INVENTORY_ACTION_TYPE.RECEIVE_STOCK]: "Receive Stock",
        [INVENTORY_ACTION_TYPE.ADJUST_STOCK]: "Adjust Stock",
        [INVENTORY_ACTION_TYPE.CORRECT_MISTAKE]: "Correct Mistake",
      },
      description:
        "This entity is identityMode SYSTEM_ONLY — transactionType is NOT identity, it is the first field a " +
        "composed description should draw from. See the file header. Validated by recordInventoryAction() " +
        "against INVENTORY_ACTION_TYPE, not by firestore.rules (no field-level validation on this collection).",
    }),
    makeFieldDefinition({
      id: "quantityDelta",
      entityId: "inventoryAction",
      label: "Quantity",
      type: "NUMBER",
      description:
        "A signed, non-zero unit count (recordInventoryAction() rejects zero). Positive on RECEIVE_STOCK " +
        "(enforced > 0); may be positive or negative on ADJUST_STOCK/CORRECT_MISTAKE. Never a monetary amount.",
    }),
    makeFieldDefinition({
      id: "reason",
      entityId: "inventoryAction",
      label: "Reason",
      type: "TEXT",
      description:
        "Optional free text on RECEIVE_STOCK/ADJUST_STOCK; required (with notes) on CORRECT_MISTAKE " +
        "(recordInventoryAction()'s own validation). Stored null when blank, never an empty string.",
    }),
    makeFieldDefinition({
      id: "notes",
      entityId: "inventoryAction",
      label: "Notes",
      type: "TEXT",
      description:
        "Optional free text on RECEIVE_STOCK/ADJUST_STOCK; required (with reason) on CORRECT_MISTAKE " +
        "(recordInventoryAction()'s own validation). Stored null when blank, never an empty string.",
    }),
    // CLIENT-SUPPLIED CLAIM, NOT SERVER-VALIDATED — see the file header. Unlike
    // purchaseOrder.js's own createdBy or purchaseOrderVoid.js's voidedBy, firestore.rules never
    // checks this value equals request.auth.uid; it is whatever recordInventoryAction() read from
    // auth.currentUser?.uid at write time (possibly null).
    makeFieldDefinition({
      id: "createdBy",
      entityId: "inventoryAction",
      label: "Created By",
      type: "STRING",
      description:
        "Actor uid claimed by the writing client (auth.currentUser?.uid ?? null) — NOT validated by " +
        "firestore.rules against request.auth.uid on this collection. A client-supplied claim, not a " +
        "server-authoritative fact. See the file header.",
    }),
    // Client-clock-stamped, not a Firestore server timestamp — see the file header.
    makeFieldDefinition({
      id: "createdAt",
      entityId: "inventoryAction",
      label: "Created",
      type: "NUMBER",
      sortable: true,
      description:
        "Epoch milliseconds, stamped by makeCollectionStore().add() as Date.now() in the caller's browser — " +
        "never FieldValue.serverTimestamp(), never a Firestore Timestamp. No updatedAt/updatedBy — this " +
        "document is never updated after creation (allow update, delete: if false).",
    }),
  ],
  // No relationships declared. The one real edge (Part -> Inventory Actions) has no owning
  // relationship declared on the registered `part` entity — see the file header and
  // REGISTRATION_PENDING.
});
