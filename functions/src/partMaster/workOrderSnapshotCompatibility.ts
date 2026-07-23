// INV-1 Phase 1, PR 1.7 -- Work Order inventory-snapshot compatibility
// (ADR-008 Accepted / Decision #40). Pure, read-only enrichment: adds
// canonical partId to snapshot items WHEN RESOLVABLE while preserving the
// historical snapshot shape verbatim. Construction stays where it is today
// (the client wizard writes inventorySnapshot; createWorkOrder/
// transitionWorkOrder deliberately never touch it -- types/workOrder.ts
// header) -- this module is the compatibility layer future consumers adopt
// at their own gates. NOTHING here mutates Work Orders, rewrites history,
// backfills documents, or recalculates quantities.
//
// Type note: the shared InventorySnapshotItem contract (mirrored client/
// server) is NOT modified -- enrichment returns a module-local extension
// (item & { partId?: string }), so no mirror-sync obligation is created
// and historical snapshots without partId remain first-class readable.
//
// Resolution order (deterministic):
//   1. sku as grandfathered canonical partId via the flag-guarded PR 1.6
//      resolver (ACTIVE Part Master record) -- ADR-008's sku-grandfathering
//      makes this the canonical hit for migrated parts;
//   2. sku as an INTERNAL_PN alias, then a LEGACY alias (PR 1.3 lookup) --
//      covers renumbered parts whose historical sku became an alias;
//   3. unresolved -> item passes through UNCHANGED (current behavior),
//      with a structured reason for diagnostics.
// The PR 1.6 flag gates step 1; alias lookups are unconditional reads of
// the (still unpopulated, client-closed) part_aliases collection and
// return NOT_FOUND until data exists -- behavior today is therefore
// byte-identical passthrough.

import type { InventorySnapshotItem } from "../types/workOrder";
import { resolvePartReference, type CompatibilityDeps } from "./partReferenceCompatibility";
import { resolvePartAlias } from "./partAliasCommands";

export type SnapshotResolutionOutcome =
  | "CANONICAL_PART" // sku resolved as a grandfathered canonical partId
  | "ALIAS_INTERNAL_PN"
  | "ALIAS_LEGACY"
  | "UNRESOLVED"; // passthrough -- current production behavior

export interface EnrichedInventorySnapshotItem extends InventorySnapshotItem {
  /** Canonical Part Master identity, present only when resolvable. */
  readonly partId?: string;
}

export interface SnapshotItemEnrichment {
  readonly item: EnrichedInventorySnapshotItem;
  readonly outcome: SnapshotResolutionOutcome;
}

/** Enrich ONE snapshot item. Never throws; every failure mode is an
 * UNRESOLVED passthrough of the original item, fields untouched. */
export async function enrichSnapshotItem(
  item: InventorySnapshotItem,
  deps?: CompatibilityDeps
): Promise<SnapshotItemEnrichment> {
  const passthrough: SnapshotItemEnrichment = { item, outcome: "UNRESOLVED" };
  if (typeof item?.sku !== "string" || item.sku.length === 0) return passthrough;
  try {
    // 1. Grandfathered canonical id (flag-guarded PR 1.6 resolver).
    const ref = await resolvePartReference(item.sku, deps);
    if (ref.source === "PART_MASTER" && ref.part !== undefined) {
      return { item: { ...item, partId: ref.part.partId }, outcome: "CANONICAL_PART" };
    }
    // 2. Alias resolution (INTERNAL_PN, then LEGACY).
    for (const [aliasType, outcome] of [
      ["INTERNAL_PN", "ALIAS_INTERNAL_PN"],
      ["LEGACY", "ALIAS_LEGACY"],
    ] as const) {
      const alias = await resolvePartAlias({ aliasType, rawValue: item.sku }, deps);
      if (alias.result === "FOUND") {
        return { item: { ...item, partId: alias.partId }, outcome };
      }
    }
    return passthrough;
  } catch {
    return passthrough; // current behavior preserved on ANY failure
  }
}

/** Enrich a whole snapshot array, order preserved, items independent.
 * Historical items (no sku / no resolvable identity) pass through
 * unchanged -- shape-compatible with every existing reader. */
export async function enrichInventorySnapshot(
  snapshot: readonly InventorySnapshotItem[] | undefined,
  deps?: CompatibilityDeps
): Promise<SnapshotItemEnrichment[]> {
  if (!Array.isArray(snapshot)) return [];
  const out: SnapshotItemEnrichment[] = [];
  for (const item of snapshot) out.push(await enrichSnapshotItem(item, deps));
  return out;
}

/** Read-compatibility guard for historical snapshots: an item is readable
 * with or without partId; this helper canonicalizes access so consumers
 * never branch on document age. */
export function snapshotItemPartReference(item: EnrichedInventorySnapshotItem): {
  readonly partId: string | null;
  readonly legacySku: string;
} {
  return {
    partId: typeof item.partId === "string" && item.partId.length > 0 ? item.partId : null,
    legacySku: item.sku,
  };
}
