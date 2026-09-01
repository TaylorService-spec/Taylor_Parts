// Epic 4 Warehouse + Fulfillment System.
//
// A physical-reality layer on top of the ledger, NOT a second source
// of truth: `inventory_transactions` (Epic 2D) remains the sole
// authority for stock movement; these types model where physical
// stock actually sits (bin-level) and how it moves between physical
// locations, entirely separate from that authority.
import type { Timestamp } from "firebase-admin/firestore";

export interface Warehouse {
  id: string;
  name: string;
  location: string;
}

// Bin-level physical stock. Composite-unique on (warehouseId, partId,
// binCode) -- see warehouseService.ts's doc-id derivation.
export interface StockLocation {
  id: string;
  warehouseId: string;
  partId: string;
  quantity: number;
  binCode: string;
  updatedAt: Timestamp;
}

export type TransferOrderStatus = "REQUESTED" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED";

// Physical movement between warehouses. Never writes
// inventory_transactions -- a transfer moves where stock physically
// sits, not how much of it exists or is reserved/consumed against a
// Work Order.
export interface TransferOrder {
  id: string;
  partId: string;
  quantity: number;
  fromWarehouseId: string;
  toWarehouseId: string;
  fromBinCode: string;
  toBinCode: string;
  status: TransferOrderStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type DiscrepancySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// Output of a read-only comparison between physical stock (StockLocation)
// and ledger-derived expectation -- see warehouseReconciliationService.ts.
// Never triggers a correction; purely informational.
export interface WarehouseDiscrepancy {
  partId: string;
  warehouseId: string;
  expectedQuantity: number;
  actualQuantity: number;
  variance: number;
  severity: DiscrepancySeverity;
}

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
