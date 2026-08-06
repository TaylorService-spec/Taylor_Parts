// Supplier Master (S4) -- migration PLANNING + DRY-RUN for linking existing reorder_purchase_orders
// to governed Suppliers. Mirrors warehouseGovernanceMigration's dry-run discipline: deterministic
// classification of the WHOLE live set into a plan with counts and an opaque plan fingerprint; PURE
// planning with NO writes. The Admin-SDK readers below only READ (suppliers + reorder_purchase_orders).
//
// This tool NEVER writes. Persisting the derived linkage is a separate, protected promotion step that
// FIRST requires a reorder_purchase_orders Rules update to allow the supplierId/supplierNameSnapshot
// fields (see reorderPurchaseOrderSupplierCompatibility.ts header). Rollback of the eventual real run
// is trivial and non-destructive: both fields are additive, so rollback = remove them; supplierName
// (the historical authority) is never touched.

import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { SUPPLIERS_COLLECTION } from "../constants/collections.js";
import {
  buildGovernedSupplierIndex,
  deriveSupplierLinkage,
  type RawGovernedSupplierRow,
  type SupplierLinkage,
  type SupplierMatchClassification,
} from "./reorderPurchaseOrderSupplierCompatibility.js";

const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";

// Local copies of the canonical-JSON/sha256 helpers (warehouseGovernanceMigration.ts does not export
// them). NOTE: unlike the warehouse version, this canonicalJson has no Timestamp branch -- deliberate,
// because the S4 fingerprint hashes ONLY primitives ({poId, classification, supplierId}). Do not reuse
// this helper for a payload containing Timestamps without re-adding that branch; if a third consumer of
// this pattern appears, extract a shared, Timestamp-aware utility instead.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface LiveReorderPurchaseOrder {
  readonly poId: string;
  readonly data: unknown;
}

export interface ClassifiedReorderPurchaseOrder extends SupplierLinkage {
  readonly poId: string;
}

export interface SupplierLinkageCounts {
  readonly total: number;
  readonly exact: number;
  readonly ambiguous: number;
  readonly inactive: number;
  readonly unmatched: number;
  readonly historical: number;
}

export interface SupplierLinkageMigrationPlan {
  readonly projectId: string;
  readonly governedCommit: string;
  readonly classified: readonly ClassifiedReorderPurchaseOrder[];
  readonly counts: SupplierLinkageCounts;
  // POs needing human resolution before any real run: AMBIGUOUS + INACTIVE (never auto-linked).
  readonly needsResolution: readonly ClassifiedReorderPurchaseOrder[];
  // Opaque, deterministic fingerprint over the plan's decisions -- any drift changes it (a manifest
  // authored against a prior plan would fail closed at a future execute step).
  readonly planFingerprint: string;
}

function emptyCounts(): Record<SupplierMatchClassification, number> {
  return { EXACT: 0, AMBIGUOUS: 0, INACTIVE: 0, UNMATCHED: 0, HISTORICAL: 0 };
}

// Dry-run plan: classify the WHOLE live PO set against the governed suppliers deterministically.
// Pure; no writes. `pos` order is preserved; classification is sorted into the plan by poId for a
// stable, fingerprint-able result.
export function planSupplierLinkageMigration(
  pos: readonly LiveReorderPurchaseOrder[],
  suppliers: readonly RawGovernedSupplierRow[],
  pins: { projectId: string; governedCommit: string },
): SupplierLinkageMigrationPlan {
  const index = buildGovernedSupplierIndex(suppliers ?? []);
  const classified: ClassifiedReorderPurchaseOrder[] = [];
  const tally = emptyCounts();
  for (const po of pos ?? []) {
    const linkage = deriveSupplierLinkage((po?.data ?? {}) as { supplierName?: unknown }, index);
    tally[linkage.classification] += 1;
    classified.push({ poId: po.poId, ...linkage });
  }
  classified.sort((a, b) => (a.poId < b.poId ? -1 : a.poId > b.poId ? 1 : 0));
  const counts: SupplierLinkageCounts = {
    total: classified.length,
    exact: tally.EXACT,
    ambiguous: tally.AMBIGUOUS,
    inactive: tally.INACTIVE,
    unmatched: tally.UNMATCHED,
    historical: tally.HISTORICAL,
  };
  const needsResolution = classified.filter((c) => c.classification === "AMBIGUOUS" || c.classification === "INACTIVE");
  // Fingerprint the DECISIONS only (poId -> classification + supplierId), not raw PO data, so it is an
  // opaque, stable summary of what the plan would do.
  const decisions = classified.map((c) => ({ poId: c.poId, classification: c.classification, supplierId: c.supplierId }));
  const planFingerprint = sha256(canonicalJson({ projectId: pins.projectId, governedCommit: pins.governedCommit, decisions }));
  return { projectId: pins.projectId, governedCommit: pins.governedCommit, classified, counts, needsResolution, planFingerprint };
}

// --- Admin-SDK READ-ONLY loaders (no writes anywhere) -----------------------------------------

export async function readGovernedSuppliers(db: Firestore): Promise<RawGovernedSupplierRow[]> {
  const snap = await db.collection(SUPPLIERS_COLLECTION).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

export async function readLiveReorderPurchaseOrders(db: Firestore): Promise<LiveReorderPurchaseOrder[]> {
  const snap = await db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).get();
  return snap.docs.map((d) => ({ poId: d.id, data: d.data() }));
}

// DRY-RUN entry point: read live suppliers + reorder POs, produce the plan. READ-ONLY -- writes
// nothing. Callers use the returned plan/counts for evidence; a real run is a separate gated step.
export async function dryRunSupplierLinkageMigration(
  db: Firestore,
  pins: { projectId: string; governedCommit: string },
): Promise<SupplierLinkageMigrationPlan> {
  const [suppliers, pos] = await Promise.all([readGovernedSuppliers(db), readLiveReorderPurchaseOrders(db)]);
  return planSupplierLinkageMigration(pos, suppliers, pins);
}
