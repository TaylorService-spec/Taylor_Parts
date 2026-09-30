// THE THIRTEEN PROTECTED POSTGRESQL WORK ORDERS -- classification and a READ-ONLY replacement plan.
//
// WORK ORDER DOMAIN CUTOVER AUTHORIZATION (2026-09-30): "Do NOT delete, overwrite, repair, reassign, repoint or
// otherwise mutate these 13 rows yet." WO-2026-000001..000008 and WO-2026-000060..000064 sit in eos_ops.work_orders
// in taylor-nonprod, provenance MIGRATED. The DQ-S2 reconciliation against the fieldops_wos snapshot (FP-WO-0,
// sourceDataSha256 3cfccd4d...) found every one of them to be OBSOLETE/BAD_COPY:
//
//   * operating_company_key `taylor` where the source states NO operating company -- the company was INFERRED,
//     which the DQ-S2 census refuses (OPERATING_COMPANY_UNRESOLVED);
//   * one shared created_at across all 13 where the source carries 13 distinct creation times -- the copy stamped
//     its own clock over the record's history;
//   * five source assignments dropped (the source names a technician; PostgreSQL holds one assignment row total);
//   * number, status, priority and location otherwise match, so these ARE copies of real source records, not
//     independent native Work Orders -- which is why none is MATCHED_REAL_RECORD and none is SYNTHETIC_FIXTURE.
//
// This module encodes that classification and plans -- never performs -- what each Owner option would require.
// It performs no I/O. Its CLI (scripts/workOrderProtectedRowsPlanCli.js) reads inside a READ ONLY transaction and
// has no INSERT / UPDATE / DELETE anywhere; a test pins both facts.

export const PROTECTED_WORK_ORDERS = Object.freeze([
  { number: "WO-2026-000001", id: "GN2tk1DgoxdOX0jMU7IO" },
  { number: "WO-2026-000002", id: "yqFPzsUCs8XSvRUdSjTy" },
  { number: "WO-2026-000003", id: "0XgbOsl56EJKBu7QNe8k" },
  { number: "WO-2026-000004", id: "NEz9qGYpNLtrbFHfisXE" },
  { number: "WO-2026-000005", id: "DxeWmMoTAgS7uMbo9l4U" },
  { number: "WO-2026-000006", id: "FkA7SbwObO2tkORMgpCl" },
  { number: "WO-2026-000007", id: "ckY5gqO26LdKBMASmo5g" },
  { number: "WO-2026-000008", id: "Hdsqhww2bosPHalW04C1" },
  { number: "WO-2026-000060", id: "rRTHrgl8Z667xFmyKuQ1" },
  { number: "WO-2026-000061", id: "v6EsG4QU477L64QQerWC" },
  { number: "WO-2026-000062", id: "g0SNuHqL41o0eGEgbXJ5" },
  { number: "WO-2026-000063", id: "dDas6xXNgcPi3WYPPCIL" },
  { number: "WO-2026-000064", id: "zcyG6tdnsgzOnjpMMnpS" },
].map((w) => Object.freeze(w)));

export type ProtectedClassification = "MATCHED_REAL_RECORD" | "SYNTHETIC_FIXTURE" | "OBSOLETE/BAD_COPY" | "UNKNOWN";

/** The DQ-S2 reconciliation outcome, row by row. All thirteen: OBSOLETE/BAD_COPY. */
export const PROTECTED_CLASSIFICATION: Readonly<Record<string, ProtectedClassification>> =
  Object.freeze(Object.fromEntries(PROTECTED_WORK_ORDERS.map((w) => [w.id, "OBSOLETE/BAD_COPY" as const])));

export const BAD_COPY_EVIDENCE = Object.freeze([
  "OPERATING_COMPANY_INFERRED: target operating_company_key is set; the source record states none",
  "CREATION_TIME_OVERWRITTEN: one shared created_at across all 13; the source has 13 distinct creation times",
  "ASSIGNMENTS_DROPPED: the source names technicians on 5 of these; the target holds one assignment row in total",
]);

/** Dependent rows that reference a Work Order, and whether the relation refuses deletion at the database. */
export const DEPENDENT_RELATIONS = Object.freeze([
  { table: "work_order_transitions", deleteRefused: true, note: "append-only trigger" },
  { table: "work_order_assignments", deleteRefused: true, note: "no-delete trigger: an assignment is ENDED, never deleted" },
  { table: "work_order_schedule_history", deleteRefused: false, note: "" },
  { table: "work_order_parts_plan", deleteRefused: false, note: "ON DELETE RESTRICT from work_orders" },
  { table: "work_order_sales_order_lines", deleteRefused: false, note: "" },
  { table: "work_order_execution_records", deleteRefused: true, note: "append-only trigger" },
  { table: "work_order_inventory_effects", deleteRefused: false, note: "" },
].map((d) => Object.freeze(d)));

export interface ObservedProtectedRow {
  readonly id: string;
  readonly number: string | null;
  readonly status: string;
  readonly provenance: string;
  /** sha256 of to_jsonb(row)::text under TimeZone UTC -- the pin any later destructive step must present. */
  readonly fingerprint: string;
  readonly dependents: Readonly<Record<string, number>>;
}

export class ProtectedRowsError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ProtectedRowsError"; }
}

export interface ProtectedRowPlan {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly classification: ProtectedClassification;
  readonly fingerprint: string;
  readonly dependents: Readonly<Record<string, number>>;
  /** Dependents whose relation refuses DELETE -- a replacement that removes the row must first answer for these. */
  readonly deleteBlockedBy: readonly string[];
}

export interface ProtectedRowsPlan {
  readonly rows: readonly ProtectedRowPlan[];
  readonly evidence: readonly string[];
  /** The Owner options, each with what it would require. Nothing here is executed. */
  readonly options: readonly { readonly option: string; readonly effect: string; readonly requires: readonly string[] }[];
}

/**
 * Plan the thirteen. EXACT SET: an observed row outside the pinned set, a pinned row missing, a number that does
 * not match its pinned id, or a provenance other than MIGRATED refuses -- the plan is only ever about these rows.
 */
export function planProtectedWorkOrders(observed: readonly ObservedProtectedRow[]): ProtectedRowsPlan {
  const pinned = new Map(PROTECTED_WORK_ORDERS.map((w) => [w.id, w.number]));
  const seen = new Set<string>();
  for (const row of observed) {
    if (!pinned.has(row.id)) throw new ProtectedRowsError("UNPINNED_ROW", `row ${row.id} is not one of the thirteen protected Work Orders`);
    if (seen.has(row.id)) throw new ProtectedRowsError("DUPLICATE_ROW", `row ${row.id} observed twice`);
    seen.add(row.id);
    if (row.number !== pinned.get(row.id)) {
      throw new ProtectedRowsError("NUMBER_MISMATCH", `row ${row.id} carries ${String(row.number)}, pinned as ${pinned.get(row.id)}`);
    }
    if (row.provenance !== "MIGRATED") throw new ProtectedRowsError("PROVENANCE_MISMATCH", `row ${row.id} is ${row.provenance}, not MIGRATED`);
    if (!/^[0-9a-f]{64}$/.test(row.fingerprint)) throw new ProtectedRowsError("FINGERPRINT_INVALID", `row ${row.id} has no sha256 fingerprint`);
  }
  const missing = PROTECTED_WORK_ORDERS.filter((w) => !seen.has(w.id)).map((w) => w.number);
  if (missing.length > 0) throw new ProtectedRowsError("PINNED_ROW_MISSING", `pinned rows not observed: ${missing.join(", ")}`);

  const refused = new Set(DEPENDENT_RELATIONS.filter((d) => d.deleteRefused).map((d) => d.table));
  const rows = [...observed].sort((a, b) => String(a.number).localeCompare(String(b.number))).map((r) => Object.freeze({
    id: r.id, number: r.number as string, status: r.status, classification: PROTECTED_CLASSIFICATION[r.id],
    fingerprint: r.fingerprint, dependents: Object.freeze({ ...r.dependents }),
    deleteBlockedBy: Object.freeze(Object.entries(r.dependents).filter(([t, n]) => n > 0 && refused.has(t)).map(([t, n]) => `${t}:${n}`)),
  }));
  return Object.freeze({
    rows: Object.freeze(rows),
    evidence: BAD_COPY_EVIDENCE,
    options: Object.freeze([
      Object.freeze({ option: "A_RETAIN_UNTOUCHED", effect: "keep all 13 as they are; the governed runtime may act on them (they are real-looking SCHEDULED/COMPLETED rows)",
        requires: Object.freeze(["an Owner statement that inferred company and overwritten creation time are acceptable history"]) }),
      Object.freeze({ option: "B_REMOVE_AND_RECOPY", effect: "remove the 13 bad copies and their dependents, then COPY the source records once their DQ-S2 HOLD blockers are resolved",
        requires: Object.freeze([
          "Owner authorization for a destructive nonprod action pinned to these 13 ids AND their fingerprints",
          "a reviewed one-shot migration or governed command for the delete-refusing dependents (assignments are no-delete by trigger)",
          "resolution of the source HOLD blockers: OPERATING_COMPANY_UNRESOLVED (13), REFERENCE_NOT_FOUND (13)",
        ]) }),
      Object.freeze({ option: "C_QUARANTINE", effect: "leave the rows, but exclude them from every runtime read and command by an explicit pinned exclusion until B is authorized",
        requires: Object.freeze(["an Owner ruling that a pinned exclusion (not a generic filter) is acceptable", "a runtime exclusion list pinned by id + fingerprint"]) }),
    ]),
  });
}
