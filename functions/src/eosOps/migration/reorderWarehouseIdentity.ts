// WAREHOUSE IDENTITY -- the pre-COPY gate the Controller set on 2026-09-28: "Do not assume Firestore warehouse IDs equal
// EOS warehouse IDs. Census both authorities before Reorder COPY. Produce exact mapping evidence."
//
// The Reorder copy carries a legacy `warehouseId` into eos_ops.reorder_requests.warehouse_id VERBATIM; the object
// classifier already refuses an id that names no warehouse in the tenant. This module makes that identity question an
// explicit, per-warehouse piece of evidence rather than a side effect of per-record refusals:
//
//   EXACT_MATCH          the legacy id IS an eos_ops.warehouses id in this tenant, and every Reorder naming it binds to
//                        that warehouse's operating company key.
//   MISSING_IN_EOS       no warehouse in this tenant carries the id. NEVER translated here: a mapping, if one is ever
//                        needed, is an explicit governed artifact, and an ambiguous real-world identity is a decision.
//   COMPANY_MISMATCH     the warehouse exists but at least one Reorder naming it binds to a different company key.
//   MISSING_WAREHOUSE_ID a Reorder states no warehouse id at all.
//
// Nothing is inferred, nothing translated, no near-match is suggested. Pure: the caller supplies both populations.

export type WarehouseIdentityVerdict = "EXACT_MATCH" | "MISSING_IN_EOS" | "COMPANY_MISMATCH" | "MISSING_WAREHOUSE_ID";

export interface EosWarehouseRow {
  readonly id: string;
  readonly operatingCompanyKey: string;
  readonly status: string;
}

export interface LegacyReorderWarehouseRef {
  readonly reorderId: string;
  readonly warehouseId: unknown;
  /** The operating-company key the Reorder binds to, or null when it does not bind (the classifier's own finding). */
  readonly boundCompanyKey: string | null;
}

export interface WarehouseIdentityEntry {
  readonly legacyWarehouseId: string | null;
  readonly verdict: WarehouseIdentityVerdict;
  readonly reorderCount: number;
  readonly eosWarehouse: { readonly id: string; readonly operatingCompanyKey: string; readonly status: string } | null;
  /** Reorder ids whose bound key disagrees with the warehouse's key (COMPANY_MISMATCH only). */
  readonly mismatchedReorderIds: readonly string[];
}

export interface WarehouseIdentityCensus {
  readonly entries: readonly WarehouseIdentityEntry[];
  readonly allExact: boolean;
  readonly verdictCounts: Readonly<Record<WarehouseIdentityVerdict, number>>;
}

export function censusWarehouseIdentity(
  refs: readonly LegacyReorderWarehouseRef[],
  eosWarehouses: readonly EosWarehouseRow[],
): WarehouseIdentityCensus {
  const eos = new Map(eosWarehouses.map((w) => [w.id, w]));
  const groups = new Map<string | null, LegacyReorderWarehouseRef[]>();
  for (const r of refs) {
    const id = typeof r.warehouseId === "string" && r.warehouseId.trim() !== "" ? r.warehouseId : null;
    const list = groups.get(id) ?? [];
    list.push(r);
    groups.set(id, list);
  }

  const entries: WarehouseIdentityEntry[] = [];
  for (const [id, list] of [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    if (id === null) {
      entries.push({ legacyWarehouseId: null, verdict: "MISSING_WAREHOUSE_ID", reorderCount: list.length, eosWarehouse: null,
        mismatchedReorderIds: [] });
      continue;
    }
    const w = eos.get(id);
    if (w === undefined) {
      entries.push({ legacyWarehouseId: id, verdict: "MISSING_IN_EOS", reorderCount: list.length, eosWarehouse: null,
        mismatchedReorderIds: [] });
      continue;
    }
    const mismatched = list.filter((r) => r.boundCompanyKey !== null && r.boundCompanyKey !== w.operatingCompanyKey)
      .map((r) => r.reorderId).sort();
    entries.push({
      legacyWarehouseId: id,
      verdict: mismatched.length > 0 ? "COMPANY_MISMATCH" : "EXACT_MATCH",
      reorderCount: list.length,
      eosWarehouse: { id: w.id, operatingCompanyKey: w.operatingCompanyKey, status: w.status },
      mismatchedReorderIds: mismatched,
    });
  }

  const verdictCounts = { EXACT_MATCH: 0, MISSING_IN_EOS: 0, COMPANY_MISMATCH: 0, MISSING_WAREHOUSE_ID: 0 };
  for (const e of entries) verdictCounts[e.verdict] += 1;
  return { entries, allExact: entries.every((e) => e.verdict === "EXACT_MATCH"), verdictCounts };
}
