// Supplier Master (S4) -- PURE compatibility layer that links a live reorder_purchase_orders record
// to a governed Supplier (Supplier Master) WHEN RESOLVABLE, while preserving the historical free-text
// supplierName verbatim as supplierNameSnapshot. Same discipline as workOrderSnapshotCompatibility
// (INV-1 PR 1.7): no I/O, never throws, never mutates/backfills a document, and it adds identity only
// when it can be resolved -- an unresolved record passes through as a readable historical row.
//
// IMPORTANT (integration boundary): this module DERIVES the linkage; it does NOT persist it. The live
// reorder_purchase_orders create Rule pins its fields with keys().hasOnly([...]) and that allowlist
// does NOT yet include supplierId/supplierNameSnapshot, so actually WRITING these fields (client
// writer OR migration) requires a protected reorder_purchase_orders Rules update first. That delta is
// a separate promotion step; nothing here writes.

import { normalizeSupplierName } from "./supplierMasterValidation.js";

// Classification of a reorder PO's supplierName against the governed Supplier set. Mirrors the
// Owner's S4 taxonomy (exact / ambiguous(=duplicate) / unmatched / inactive / historical).
// Declared in deriveSupplierLinkage's evaluation-precedence order (HISTORICAL -> EXACT -> AMBIGUOUS
// -> INACTIVE -> UNMATCHED) so declaration and resolution order read the same.
export type SupplierMatchClassification =
  | "HISTORICAL" // the record carries no usable supplierName -> readable history, nothing to link
  | "EXACT" //     exactly one ACTIVE governed supplier matches the normalized name -> linkable
  | "AMBIGUOUS" // more than one ACTIVE governed supplier shares the normalized name (duplicate) -> needs human choice
  | "INACTIVE" //  no ACTIVE match, but one+ INACTIVE governed supplier matches -> not linkable for active purchasing
  | "UNMATCHED"; // no governed supplier (active or inactive) matches the name -> candidate for supplier creation

export interface GovernedSupplierIndexEntry {
  readonly activeIds: readonly string[];
  readonly inactiveIds: readonly string[];
}

// A raw governed-supplier row as read from the `suppliers` collection (only the fields the linkage
// needs). `normalizedKey` is used when present (the stored governed key); otherwise it is recomputed
// deterministically from `name` so the index is robust to legacy docs that predate the stored key.
export interface RawGovernedSupplierRow {
  readonly id: string;
  readonly name?: unknown;
  readonly normalizedKey?: unknown;
  readonly status?: unknown;
}

function keyFor(row: RawGovernedSupplierRow): string {
  if (typeof row.normalizedKey === "string" && row.normalizedKey.length > 0) return row.normalizedKey;
  return normalizeSupplierName(row.name);
}

// Build a normalizedKey -> {activeIds, inactiveIds} index. Deterministic: ids are sorted; a supplier
// whose status is neither ACTIVE nor INACTIVE, or whose key is empty, is skipped (cannot be a match
// target). Pure.
export function buildGovernedSupplierIndex(suppliers: readonly RawGovernedSupplierRow[]): Map<string, GovernedSupplierIndexEntry> {
  const active = new Map<string, string[]>();
  const inactive = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, key: string, id: string) => {
    const list = m.get(key);
    if (list) list.push(id);
    else m.set(key, [id]);
  };
  for (const s of suppliers ?? []) {
    if (!s || typeof s.id !== "string" || s.id.length === 0) continue;
    const key = keyFor(s);
    if (key === "") continue;
    if (s.status === "ACTIVE") push(active, key, s.id);
    else if (s.status === "INACTIVE") push(inactive, key, s.id);
  }
  const keys = new Set<string>([...active.keys(), ...inactive.keys()]);
  const index = new Map<string, GovernedSupplierIndexEntry>();
  for (const key of keys) {
    index.set(key, {
      activeIds: (active.get(key) ?? []).slice().sort(),
      inactiveIds: (inactive.get(key) ?? []).slice().sort(),
    });
  }
  return index;
}

export interface SupplierLinkage {
  // The historical free-text supplier name, preserved verbatim (or null when the record has none).
  readonly supplierNameSnapshot: string | null;
  // The governed supplierId to link, present ONLY for an EXACT single-ACTIVE match. null otherwise.
  readonly supplierId: string | null;
  readonly classification: SupplierMatchClassification;
  // Non-leaking diagnostic detail (e.g. candidate ids for AMBIGUOUS/INACTIVE), for the migration plan.
  readonly candidateIds: readonly string[];
}

// A raw reorder_purchase_orders record (only the field the linkage reads).
export interface RawReorderPurchaseOrder {
  readonly supplierName?: unknown;
}

// Derive the supplier linkage for ONE reorder PO. Never throws. Preserves supplierName verbatim as the
// snapshot; assigns supplierId only for an unambiguous ACTIVE match. Order of precedence: HISTORICAL
// (no name) -> EXACT (1 active) -> AMBIGUOUS (>1 active) -> INACTIVE (0 active, >=1 inactive) ->
// UNMATCHED (nothing).
export function deriveSupplierLinkage(
  po: RawReorderPurchaseOrder,
  index: ReadonlyMap<string, GovernedSupplierIndexEntry>,
): SupplierLinkage {
  const rawName = po && typeof po.supplierName === "string" ? po.supplierName : "";
  const snapshot = rawName.trim().length > 0 ? rawName : null;
  if (snapshot === null) {
    return { supplierNameSnapshot: null, supplierId: null, classification: "HISTORICAL", candidateIds: [] };
  }
  const key = normalizeSupplierName(snapshot);
  const entry = key === "" ? undefined : index.get(key);
  if (!entry) {
    return { supplierNameSnapshot: snapshot, supplierId: null, classification: "UNMATCHED", candidateIds: [] };
  }
  if (entry.activeIds.length === 1) {
    return { supplierNameSnapshot: snapshot, supplierId: entry.activeIds[0], classification: "EXACT", candidateIds: [entry.activeIds[0]] };
  }
  if (entry.activeIds.length > 1) {
    return { supplierNameSnapshot: snapshot, supplierId: null, classification: "AMBIGUOUS", candidateIds: entry.activeIds };
  }
  // activeIds.length === 0 here, and entry exists only if there was at least one active OR inactive id.
  return { supplierNameSnapshot: snapshot, supplierId: null, classification: "INACTIVE", candidateIds: entry.inactiveIds };
}
