// Supplier Master (S2) -- shared types for the governed Supplier business object.
// Spec: docs/architecture/supplier-master-architecture.md (DECISIONS #78). Supplier is a
// catalog-governed reference object (like Part/Manufacturer); it OWNS the supplierId space that
// the governed part_supplier_items authority already references. `status` is the authority; a
// legacy `active` field is FORBIDDEN on a governed record (same discipline as governed warehouses).

import type { Timestamp } from "firebase-admin/firestore";

export const SUPPLIER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

// supplierId conforms to the internal governed id pattern already used by part_supplier_items
// (functions/src/partMaster/partSupplierItems.ts SUPPLIER_ID_PATTERN) -- storage-safe by
// construction and tenant-prefixable.
export const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Optional business fields the current business needs. Each, when present, must be a non-blank
// string (no speculative ERP structure). paymentTermsRef is a label/reference, not a terms engine.
export const SUPPLIER_OPTIONAL_STRING_FIELDS = [
  "vendorNumber",
  "contactName",
  "phone",
  "email",
  "address",
  "paymentTermsRef",
  "notes",
] as const;

export interface GovernedSupplier {
  id: string;
  name: string; // canonical display name
  normalizedKey: string; // deterministic normalization of `name`, for dedup DETECTION only (never an auto-merge key)
  status: SupplierStatus;
  version: number; // whole number >= 1
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
  vendorNumber?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  paymentTermsRef?: string;
  notes?: string;
}

export type GovernedSupplierValidationResult =
  | { valid: true; value: GovernedSupplier; reason: null }
  | { valid: false; value: null; reason: string };
