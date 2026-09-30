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
// OWNER DECISION 3 (WORK ORDER CUTOVER COMPLETION PASS, 2026-09-30): "C -- PINNED QUARANTINE". The rows are
// PRESERVED for migration traceability and QUARANTINED from operations (migration 1764310000000 +
// eosOps/workOrderQuarantine.ts). Each pin below is the id, the number and the FINGERPRINT observed by a read-only
// job on 2026-09-30 under eos_ops.work_order_pin_fingerprint (sha256 over the original Work Order columns, epoch
// timestamps). The quarantine relation's CHECK constraint names exactly these triples; a test asserts the two agree.
//
// This module performs no I/O. The read-only planner (scripts/workOrderProtectedRowsPlanCli.js) and the quarantine
// CLI (scripts/workOrderQuarantineCli.js, plan by default, --apply writes all thirteen or none) read through it.

export const PROTECTED_WORK_ORDERS = Object.freeze([
  { number: "WO-2026-000001", id: "GN2tk1DgoxdOX0jMU7IO", fingerprint: "2a794935df15ca40a21bf42a3a46ae7a2dc67661af6dd08913810f170b0df8f2" },
  { number: "WO-2026-000002", id: "yqFPzsUCs8XSvRUdSjTy", fingerprint: "83b81368ee54d40ecff48fe69be98410a2e37ec604fed6fcebc571e71f086d89" },
  { number: "WO-2026-000003", id: "0XgbOsl56EJKBu7QNe8k", fingerprint: "7d160b166df714b59b54caa0c39c445658b1392685a0f36f24a37f293b5d44c2" },
  { number: "WO-2026-000004", id: "NEz9qGYpNLtrbFHfisXE", fingerprint: "c1f007c37a0069cc7107c49f5ba35ffd9d0e8d899f4a29c508a822c67912badb" },
  { number: "WO-2026-000005", id: "DxeWmMoTAgS7uMbo9l4U", fingerprint: "c90b5e8e41cda102d192e24a33035f6d6e5a2e5a67e4889a919922a6e77e6d06" },
  { number: "WO-2026-000006", id: "FkA7SbwObO2tkORMgpCl", fingerprint: "6e18fea984eecd09f81c0c97bc3e5218b9174deef4b4a72b2e160c72cec029c1" },
  { number: "WO-2026-000007", id: "ckY5gqO26LdKBMASmo5g", fingerprint: "7d78fa6376fef3a25d6d3cc6f28b6bd6c57bed307ef00ee56db323f05b0f2650" },
  { number: "WO-2026-000008", id: "Hdsqhww2bosPHalW04C1", fingerprint: "a790a437450a70d17bd2061f9061b3e3ba161a64c6aa789236a1c49157375259" },
  { number: "WO-2026-000060", id: "rRTHrgl8Z667xFmyKuQ1", fingerprint: "abcffc10ee2cf5e3560a1cb99b090bdac690c77e5eac7a39e3fff7bc3bdb5170" },
  { number: "WO-2026-000061", id: "v6EsG4QU477L64QQerWC", fingerprint: "4492d39266548ca9477c20318bf219acbdc38c89e3ef2dce5f5871ee4edb8cd1" },
  { number: "WO-2026-000062", id: "g0SNuHqL41o0eGEgbXJ5", fingerprint: "74d28fe92a5ce184044dcad6eed67ca0de5f57a4b2e3ef1313be74ce6de2938a" },
  { number: "WO-2026-000063", id: "dDas6xXNgcPi3WYPPCIL", fingerprint: "c5e9810715abee0327b62684795b914cada23ada609321bd278b4ef7c4516009" },
  { number: "WO-2026-000064", id: "zcyG6tdnsgzOnjpMMnpS", fingerprint: "34c81767678cc556f33fd18e75df523651cd24d0240ae4fd1e5ab06d88f49d49" },
].map((w) => Object.freeze(w)));

/** The Owner's ruled option. */
export const OWNER_DECISION = "C_QUARANTINE" as const;
export const QUARANTINE_REASON = "Owner DECISION 3 (2026-09-30): pinned quarantine of an OBSOLETE/BAD_COPY migrated Work Order -- preserved for traceability, excluded from operations";
export const QUARANTINE_PROVENANCE = "DQ-S2 reconciliation vs fieldops_wos snapshot FP-WO-0; fingerprint by read-only job 2026-09-30";

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
  /** eos_ops.work_order_pin_fingerprint(row) as observed NOW -- compared to the pin; a mismatch refuses. */
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
    const pin = PROTECTED_WORK_ORDERS.find((w) => w.id === row.id)!.fingerprint;
    if (row.fingerprint !== pin) {
      throw new ProtectedRowsError("FINGERPRINT_MISMATCH", `row ${row.id} (${row.number}) changed since it was pinned: ${row.fingerprint} != ${pin}`);
    }
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
