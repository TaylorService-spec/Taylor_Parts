// Serialized Asset REGISTRATION -- the activation of a Serialized Asset at receipt (Wave 7 slice B,
// authorized by the Owner decision recorded in
// docs/releases/serialized-asset-registry-slice-b-boundary.md).
//
// THERE IS NO SECOND INTAKE AUTHORITY. This module is a pure helper: it derives identity and builds the
// document, and it NEVER reads, writes or commits anything. The ONLY caller is the governed Receiving
// command (functions/src/inventoryReceiving/receiveInventoryStockCommand.ts), inside that command's
// single existing transaction, so the Serialized Asset is created atomically with the receipt that
// justifies it. Specification §F: receiving is "the authority-changing supplier->internal-stock
// handoff", and serial capture at receipt activates the asset at its put-away location.
//
// It also creates no second registry and no second contract: the document shape is the M.1 contract
// already merged in PR #1004 (./types.js), reused verbatim.
//
// NOT here, deliberately: no transfer, no delivery, no CUSTOMER relocation, no installation link, no
// ownership transfer. Those remain blocked on Enterprise Inventory Phase 4 (Transfer Orders) and §H.

import { createHash } from "node:crypto";
import { SERIALIZED_ASSET_SCHEMA_VERSION, type SerializedAssetState } from "./types.js";

// The lifecycle state a newly received unit enters. Specification §F: serial capture at receipt
// "activates the Serialized Asset at its put-away location (RECEIVED)". Not AVAILABLE -- availability is
// a separate determination this slice does not make.
export const RECEIPT_INVENTORY_STATE: SerializedAssetState = "RECEIVED";

// Ownership at receipt into company stock. VENDOR_CONSIGNMENT (§4.13) is a referenced, unbuilt
// authority; nothing in a receipt can currently establish consignment, so assuming COMPANY is the only
// honest value here rather than a placeholder.
export const RECEIPT_OWNERSHIP = "COMPANY" as const;

// DETERMINISTIC, PATH-SAFE identity -- and the uniqueness mechanism.
//
// Scoped to (partId, serialNo), NOT serialNo alone: serial numbers are manufacturer identity and are
// only unique within a manufacturer's product line, so two different Parts may legitimately carry the
// same printed serial. Scoping to the pair is what makes "duplicate serial" mean the real thing --
// the SAME unit received twice -- instead of colliding two unrelated units.
//
// Because the id is derived rather than allocated, `create` on this path is itself the uniqueness
// check: Firestore rejects a create on an existing document, and inside the receiving transaction that
// rejection aborts the whole receipt. There is no separate "does it exist" race window.
//
// JSON-tuple hashing (not raw concatenation) so the components are unambiguous -- a serial containing
// the delimiter cannot forge a different pair's id. Same construction as the receiving/ledger keys.
export function serializedAssetDocId(partId: string, serialNo: string): string {
  return "sa_" + createHash("sha256").update(JSON.stringify([partId, serialNo])).digest("hex").slice(0, 40);
}

export interface SerializedAssetRegistrationInput {
  readonly partId: string;
  readonly serialNo: string;
  readonly locationId: string;
  readonly receivingId: string;
  readonly actorId: string;
  readonly now: Date;
}

// Build the stored `serialized_assets/{id}` document for a unit activated by receipt.
//
// `currentLocationId` is the put-away location's id (Specification §D names the persisted field as a
// scalar id). `currentEquipmentId` is explicitly null: a received unit is in inventory, not installed --
// the install link is §H's job and §H is not built. Provenance mirrors the convention the receiving
// repository already uses (server-authored actor + clock, never accepted from untrusted input), and
// records the receiving order that created this asset so the asset's origin is auditable from the
// document itself.
export function buildSerializedAssetForReceipt(input: SerializedAssetRegistrationInput): Record<string, unknown> {
  return {
    schemaVersion: SERIALIZED_ASSET_SCHEMA_VERSION,
    serialNo: input.serialNo,
    partId: input.partId,
    currentLocationId: input.locationId,
    inventoryState: RECEIPT_INVENTORY_STATE,
    currentEquipmentId: null,
    ownership: RECEIPT_OWNERSHIP,
    // Origin of this asset. Also what makes a REPLAY of the same receipt distinguishable from a genuine
    // duplicate-serial collision: same receivingId means this exact receipt already created it.
    activatedByReceivingId: input.receivingId,
    createdAtMillis: input.now.getTime(),
    createdByUid: input.actorId,
    updatedAtMillis: input.now.getTime(),
    updatedByUid: input.actorId,
  };
}
