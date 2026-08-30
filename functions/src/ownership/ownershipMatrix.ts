// EOS Ownership Model v1 — the OWNERSHIP MATRIX as code (Owner rulings D-1..D-5, 2026-08-30).
//
// The reconciliation (docs/assessments/eos-ownership-model-reconciliation.md) produced the matrix
// as a table for a human to ratify. This is the same table in a form the census script and the
// handoff command both read, so "which families are governed, and how" has ONE answer rather than
// one per consumer that can drift from the other.
//
// Each row records four facts and nothing else:
//   collection    the Firestore collection
//   ownerType     USER (a person) or COMPANY (an operating company)
//   ownerFields   the EXISTING storage the typed owner is derived from, in the order tried.
//                 An empty list means the family has no ownership storage yet -- a known gap, not
//                 an error, and the census reports it as OWNERLESS rather than skipping it.
//   transfer      HANDOFF (an explicit auditable transfer is legitimate) or IMMUTABLE (historical
//                 -- an issued invoice, a posted ledger entry, a completed receipt keeps the owner
//                 it was created with)
//
// It records NO inheritance rule. Inheritance is a property of a CREATION PATH, not of a
// collection -- opportunityCommands.ts owns "a new Opportunity inherits the Account owner", and
// duplicating it here would create the second authority ruling D-1 forbids.
//
// EXCLUSIONS ARE DELIBERATE AND LISTED. users/employees/fieldops_technicians (identity),
// permissions/roles/roleAssignments/accessRequests (access), auditEvents (the trail itself),
// reportDefinitions (already private-by-owner, a platform record), sales_territories and
// commercial_coverage_assignments (coverage is not ownership), and the infrastructure collections
// (counters, idempotency keys, sync status, per-person scheduling) are NOT in this matrix. A
// reader who wonders whether a missing collection was forgotten should find the answer in the
// reconciliation's section D, which names every one and why.
//
// INERT: nothing here enforces anything. It is a description, consumed by a read-only census and
// by a command that is not yet wired to a callable.

import { OWNER_TYPES, type OwnerType } from "./typedOwner";

export type TransferBehavior = "HANDOFF" | "IMMUTABLE";

export interface OwnershipFamily {
  readonly family: string;
  readonly collection: string;
  readonly ownerType: OwnerType;
  readonly ownerFields: readonly string[];
  readonly transfer: TransferBehavior;
}

const usr = OWNER_TYPES.USER;
const cmp = OWNER_TYPES.COMPANY;

// `accountOwner` is named as the Account's owner field even though it is a MAP rather than a
// scalar -- deriveAccountOwner() knows how to read it. The matrix names the storage, not its shape.
export const OWNERSHIP_MATRIX: readonly OwnershipFamily[] = Object.freeze([
  // A. Commercial -- person-owned.
  { family: "account", collection: "accounts", ownerType: usr, ownerFields: ["accountOwner"], transfer: "HANDOFF" },
  { family: "contact", collection: "contacts", ownerType: usr, ownerFields: [], transfer: "HANDOFF" },
  { family: "location", collection: "locations", ownerType: usr, ownerFields: [], transfer: "HANDOFF" },
  { family: "opportunity", collection: "opportunities", ownerType: usr, ownerFields: ["ownerEmployeeId"], transfer: "HANDOFF" },
  { family: "salesAgreement", collection: "sales_agreements", ownerType: usr, ownerFields: ["ownerEmployeeId"], transfer: "HANDOFF" },
  { family: "salesOrder", collection: "sales_orders", ownerType: usr, ownerFields: ["ownerEmployeeId"], transfer: "HANDOFF" },
  { family: "invoice", collection: "invoices", ownerType: usr, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "payment", collection: "payments", ownerType: usr, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "paymentApplication", collection: "payment_applications", ownerType: usr, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "invoiceAdjustment", collection: "invoice_adjustments", ownerType: usr, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "refund", collection: "refunds", ownerType: usr, ownerFields: [], transfer: "IMMUTABLE" },

  // B. Service / operational. Work Orders live in two collections and both are governed -- a
  // census that read only one would report a clean half of the family.
  { family: "workOrder", collection: "fieldops_jobs", ownerType: usr, ownerFields: [], transfer: "HANDOFF" },
  { family: "workOrderLegacy", collection: "fieldops_wos", ownerType: usr, ownerFields: [], transfer: "HANDOFF" },
  { family: "reorderRequest", collection: "reorder_requests", ownerType: usr, ownerFields: [], transfer: "HANDOFF" },

  // C. Company-owned. Every ownerFields list here is empty because operatingCompanyId is stored
  // nowhere yet -- that is the finding the reconciliation surfaced and the reason ruling D-2
  // created the authority. The census will report this whole section as OWNERLESS, which is the
  // correct and expected answer for a first run, not a failure.
  { family: "part", collection: "parts", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "partAlias", collection: "part_aliases", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "partSupplierItem", collection: "part_supplier_items", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "manufacturer", collection: "manufacturers", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "equipmentModel", collection: "equipment_models", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "supplier", collection: "suppliers", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "supplierCatalogItem", collection: "supplier_catalog", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  // Ruling D-3: this record's owner is the operating company. explicitTitleHolder stays a
  // SEPARATE axis and is not an ownerField here -- a CUSTOMER may hold title without owning the
  // internal EOS record, and reading title as ownership is the exact collapse the ruling forbids.
  { family: "equipment", collection: "equipment", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "warehouse", collection: "warehouses", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "stockLocation", collection: "stock_locations", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "mobileLocation", collection: "mobile_locations", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "truck", collection: "trucks", ownerType: cmp, ownerFields: [], transfer: "HANDOFF" },
  { family: "purchaseOrder", collection: "purchase_orders", ownerType: cmp, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "reorderPurchaseOrder", collection: "reorder_purchase_orders", ownerType: cmp, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "receivingOrder", collection: "receiving_orders", ownerType: cmp, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "transferOrder", collection: "transfer_orders", ownerType: cmp, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "cycleCount", collection: "cycle_counts", ownerType: cmp, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "inventoryTransaction", collection: "inventory_transactions", ownerType: cmp, ownerFields: [], transfer: "IMMUTABLE" },
  { family: "inventoryAction", collection: "inventory_actions", ownerType: cmp, ownerFields: [], transfer: "IMMUTABLE" },
].map((row) => Object.freeze(row))) as readonly OwnershipFamily[];

const BY_FAMILY = new Map(OWNERSHIP_MATRIX.map((f) => [f.family, f] as const));

export function ownershipFamily(family: unknown): OwnershipFamily | null {
  return typeof family === "string" ? (BY_FAMILY.get(family) ?? null) : null;
}

/** Families whose ownership may legitimately be transferred. The rest are historical. */
export function transferableFamilies(): readonly OwnershipFamily[] {
  return OWNERSHIP_MATRIX.filter((f) => f.transfer === "HANDOFF");
}
