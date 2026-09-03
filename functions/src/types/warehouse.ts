// Warehouse authority types.
//
// ============================ WHAT USED TO LIVE HERE, AND WHY IT DOES NOT ============================
//
// This file once carried the Epic 4 "physical-reality layer": `StockLocation` (a per-warehouse,
// per-part, per-binCode quantity row), an Epic-4 `TransferOrder` keyed on from/to bin codes, and a
// `WarehouseDiscrepancy` whose only job was comparing the two against the ledger.
//
// BIN-P2 retired all of it under Decision #160 / ADR-014. `stock_locations` was never written by
// anything in this repository -- it was a seeded legacy projection -- and in the sandbox it diverged
// from the ledger in BOTH directions: a part holding three genuinely received units read as 0, and a
// part with nothing ever received read as 40. A source that can both refuse real stock and promise
// imaginary stock is not an authority, and keeping its TYPES alive was an invitation to write a
// second one.
//
// The surviving authorities are elsewhere and unchanged:
//   quantity            inventory_transactions (NONE) / serialized_assets (SERIAL)
//   physical movement   functions/src/inventoryTransfer/* -- the governed Enterprise Inventory
//                       Transfer authority, which uses the SAME `transfer_orders` collection and is
//                       NOT what was retired here
//   bin identity        functions/src/inventoryLocation/* (BIN-P1)
//
// What remains below is the governed §3A Warehouse eligibility record, which is live and load-bearing
// for Receiving, Transfer, Cycle Count and ownership.
import type { Timestamp } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Receiving Location Authority -- I-LA C2 (ratified: docs/specifications/
// receiving-location-authority-i-la-c2-warehouse-status.md). The governed
// §3A warehouse-eligibility record. These constants + the GovernedWarehouse
// shape are the SHARED contract consumed by the pure validator/deserializer
// (governedWarehouseValidation.ts) and, in later gates, by the migration,
// verifier, trusted writer, and Receiving resolver. INERT here: this gate adds
// types + a pure validator only -- no writer, migration, resolver, or Rules.
// ---------------------------------------------------------------------------

// Governed eligibility state. Receiving treats ONLY "ACTIVE" as eligible; the
// resolver fails closed on anything else (spec §3/§6).
export const WAREHOUSE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];

// Governance-initialization provenance discriminator (spec §3A.1). NATIVE =
// created by the trusted writer; MIGRATED = governance applied by the I-LA3
// migration to a legacy document.
export const WAREHOUSE_PROVENANCES = ["NATIVE", "MIGRATED"] as const;
export type WarehouseProvenance = (typeof WAREHOUSE_PROVENANCES)[number];

// The governed warehouse record (post-initialization), spec §3A. `createdAt/By`
// are optional (present for NATIVE; absent-or-both-present for MIGRATED, never
// fabricated). `governanceInitializedAt/By` are present iff MIGRATED. A legacy
// `active` field must NOT appear on a governed record.
export interface GovernedWarehouse {
  id: string;
  name: string;
  location: string;
  status: WarehouseStatus;
  version: number;
  updatedAt: Timestamp;
  updatedBy: string;
  provenance: WarehouseProvenance;
  createdAt?: Timestamp;
  createdBy?: string;
  governanceInitializedAt?: Timestamp;
  governanceInitializedBy?: string;
  /**
   * EOS Ownership Model v1 -- the operating company this physical root belongs to
   * (Owner ruling R-18, DECISIONS #149). A Warehouse IS a company root, and this is where that
   * fact is persisted.
   *
   * OPTIONAL, DELIBERATELY. Warehouses legitimately predate Ownership v1, no governed
   * root-authority writer exists yet, and no migration is authorized -- so requiring it would
   * strand every historical record. A warehouse without it is a VALID LEGACY GOVERNED WAREHOUSE.
   * Whether it becomes required for NEWLY created roots is the ownership-enforcement phase's
   * decision, not this compatibility amendment's.
   *
   * Storage validity is not write authority: nothing in this repository may author this field
   * yet. See 2A.1B.
   */
  operatingCompanyId?: string;
}

// Sanitized, non-throwing result of the shared §3A validator/deserializer. On
// failure `reason` is a bounded governed token (never a raw stored value).
export type GovernedWarehouseValidationResult =
  | { readonly valid: true; readonly value: GovernedWarehouse; readonly reason: null }
  | { readonly valid: false; readonly value: null; readonly reason: string };
