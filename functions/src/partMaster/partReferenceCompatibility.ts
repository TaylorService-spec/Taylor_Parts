// INV-1 Phase 1, PR 1.6 -- Part Master inventory reference compatibility
// (ADR-008 Accepted / Decision #40). A FLAG-GUARDED, read-only resolver that
// future availability/analytics consumers use to resolve part references
// through the canonical Part Master, with the current static catalog as the
// always-safe fallback.
//
// PARITY BY CONSTRUCTION: the only field availability math consumes today is
// the static catalog's warehouseQty baseline (inventoryService.
// getAvailableQuantity / analytics engines). Part Master records carry NO
// stock baseline (stock truth is the ledger, ADR-003/ADR-008) -- so BOTH
// paths source warehouseQty from the static catalog, and the ON path only
// enriches descriptive identity (name/category/unit-code) + diagnostics
// from the canonical Part record. Availability outputs are therefore
// byte-identical whether the flag is ON or OFF; divergence between the two
// descriptive sources is surfaced explicitly (never silently) through
// comparePartReferenceParity.
//
// FLAG (existing convention family: an explicit config gate, like the
// client's trustedCompletion.js D1 gate): defaults OFF; enabled ONLY when
// PART_MASTER_REFERENCE=enabled is present in the environment, or via the
// test-only deps override. Nothing in this repository sets it -- enabling
// it anywhere is a later, separately governed gate.
//
// SCOPE GUARANTEES: no engine file is modified by this module's
// introduction; no inventory write path, trigger, reservation, or reorder
// mutation is touched; no quantities or history are recalculated.

import { getFirestore } from "firebase-admin/firestore";
import { getCatalogItem, type PartCatalogItem } from "../data/partsCatalog";
import { buildFirestorePartRepository, MalformedStoredRecordError } from "./partMasterRepository";
import { parsePartId } from "./validation";
import type { Part } from "./types";
import type { PartMasterDeps } from "./partMasterCommands";

export type FallbackReason =
  | "FLAG_DISABLED"
  | "INVALID_PART_ID"
  | "PART_NOT_FOUND"
  | "PART_INACTIVE"
  | "MALFORMED_RECORD"
  | "READ_ERROR";

export interface PartReferenceResolution {
  readonly partId: string;
  /** Which source supplied the DESCRIPTIVE identity. */
  readonly source: "STATIC_CATALOG" | "PART_MASTER";
  /** Present when the resolver fell back to the static catalog. */
  readonly fallbackReason?: FallbackReason;
  /** The static catalog record (or null if the id is unknown there too) --
   * ALWAYS resolved, because warehouseQty (the availability baseline) only
   * exists here until a governed ledger aggregate replaces it (later gate). */
  readonly catalogItem: PartCatalogItem | null;
  /** The availability baseline BOTH paths use -- identical by construction. */
  readonly warehouseQtyBaseline: number;
  /** Canonical descriptive identity when source === PART_MASTER. */
  readonly part?: Pick<Part, "partId" | "internalPartNumber" | "name" | "category" | "status" | "stockingUnit">;
}

export interface CompatibilityDeps extends PartMasterDeps {
  /** TEST-ONLY flag override; real callers rely on the environment gate. */
  __flagOverride?: boolean;
}

export function isPartMasterReferenceEnabled(deps?: CompatibilityDeps): boolean {
  if (deps?.__flagOverride !== undefined) return deps.__flagOverride;
  return process.env.PART_MASTER_REFERENCE === "enabled"; // defaults OFF
}

function staticResolution(partId: string, reason: FallbackReason): PartReferenceResolution {
  const catalogItem = getCatalogItem(partId) ?? null;
  return {
    partId,
    source: "STATIC_CATALOG",
    fallbackReason: reason,
    catalogItem,
    warehouseQtyBaseline: catalogItem?.warehouseQty ?? 0,
  };
}

/** Resolve one part reference. NEVER throws; every failure mode falls back
 * to the static catalog with a structured reason -- the OFF path and every
 * fallback are behaviorally identical to current production logic. */
export async function resolvePartReference(
  partId: string,
  deps?: CompatibilityDeps
): Promise<PartReferenceResolution> {
  if (!isPartMasterReferenceEnabled(deps)) return staticResolution(partId, "FLAG_DISABLED");
  const parsed = parsePartId(partId);
  if (!parsed.valid) return staticResolution(partId, "INVALID_PART_ID");
  try {
    const db = deps?.db ?? getFirestore();
    const stored = await buildFirestorePartRepository(db).getById(null, parsed.value);
    if (stored === null) return staticResolution(partId, "PART_NOT_FOUND");
    if (stored.part.status !== "ACTIVE") return staticResolution(partId, "PART_INACTIVE");
    const catalogItem = getCatalogItem(partId) ?? null;
    return {
      partId,
      source: "PART_MASTER",
      catalogItem,
      // Baseline stays static-catalog-sourced on BOTH paths (see header).
      warehouseQtyBaseline: catalogItem?.warehouseQty ?? 0,
      part: {
        partId: stored.part.partId,
        internalPartNumber: stored.part.internalPartNumber,
        name: stored.part.name,
        ...(stored.part.category !== undefined ? { category: stored.part.category } : {}),
        status: stored.part.status,
        stockingUnit: stored.part.stockingUnit,
      },
    };
  } catch (err) {
    return staticResolution(
      partId,
      err instanceof MalformedStoredRecordError ? "MALFORMED_RECORD" : "READ_ERROR"
    );
  }
}

export interface ParityDivergence {
  readonly partId: string;
  readonly field: "name" | "category" | "presence";
  readonly staticValue: string | null;
  readonly partMasterValue: string | null;
}

/** Explicit, test-visible parity comparison between the two descriptive
 * sources for a set of part ids. Baseline parity needs no comparison (both
 * paths share one source by construction); this surfaces DESCRIPTIVE
 * divergence so it can never be silent. */
export async function comparePartReferenceParity(
  partIds: readonly string[],
  deps?: CompatibilityDeps
): Promise<ParityDivergence[]> {
  const divergences: ParityDivergence[] = [];
  for (const partId of partIds) {
    const resolved = await resolvePartReference(partId, { ...(deps ?? {}), __flagOverride: true });
    const catalogItem = getCatalogItem(partId) ?? null;
    if (resolved.source !== "PART_MASTER") {
      if (catalogItem !== null && resolved.fallbackReason === "PART_NOT_FOUND") {
        divergences.push({ partId, field: "presence", staticValue: catalogItem.sku, partMasterValue: null });
      }
      continue;
    }
    if (catalogItem === null) {
      divergences.push({ partId, field: "presence", staticValue: null, partMasterValue: resolved.part?.partId ?? partId });
      continue;
    }
    if (resolved.part !== undefined && resolved.part.name !== catalogItem.name) {
      divergences.push({ partId, field: "name", staticValue: catalogItem.name, partMasterValue: resolved.part.name });
    }
    if (resolved.part !== undefined && (resolved.part.category ?? null) !== catalogItem.category) {
      divergences.push({ partId, field: "category", staticValue: catalogItem.category, partMasterValue: resolved.part.category ?? null });
    }
  }
  return divergences;
}
