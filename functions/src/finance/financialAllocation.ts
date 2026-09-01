// Finance — PURE allocation & consolidation core (F10 / FIN-009). Two policy-free pieces:
//
// 1) EXACT INTEGER ALLOCATION (allocateAmountExactly): splitting one integer amount across weighted
//    targets so the parts sum EXACTLY to the whole — largest-remainder method, deterministic, no
//    rounding leak (a cent that vanishes in allocation is a reconciliation failure by construction).
//    WHAT gets allocated by WHICH weights (shared labor? overhead? freight?) is Owner policy — this is
//    only the arithmetic every such policy must use.
//
// 2) HONEST CONSOLIDATION (summarizeByCompany): per-company totals are always derivable; the
//    consolidated figure is an UNELIMINATED_SUM — an arithmetic sum that has NOT removed any
//    Taylor↔Ventana activity, and says so. FIN-001 (FIN-GAP-011): no intercompany record type exists,
//    Owner ruling D-3 models Ventana as an upstream SUPPLIER (not a peer), and ELIMINATION LOGIC IS
//    PROHIBITED TO INVENT. Whether intercompany activity becomes governed events (vs ordinary supplier
//    transactions) and what elimination policy applies is FIN-BLOCK-004 — until ruled, no code path may
//    present a consolidated figure as eliminated. Integer minor units; pure; no I/O.

export class AllocationError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "AllocationError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export interface AllocationTarget {
  ref: string;
  weight: number; // positive finite; relative share
}

export interface AllocationLine {
  ref: string;
  amountMinor: number;
}

// Split amountMinor across targets proportionally to weight, exactly. Largest-remainder assignment;
// ties broken by input order (deterministic). Negative amounts allocate symmetrically (a credit
// allocates like a charge). Empty targets / non-positive weights refuse.
export function allocateAmountExactly(amountMinor: number, targets: AllocationTarget[]): AllocationLine[] {
  if (!isInt(amountMinor)) throw new AllocationError("AMOUNT_INVALID", "amountMinor must be an integer (minor units)");
  const list = Array.isArray(targets) ? targets : [];
  if (list.length === 0) throw new AllocationError("TARGETS_REQUIRED", "at least one allocation target is required");
  let totalWeight = 0;
  for (const t of list) {
    if (!nonEmpty(t?.ref)) throw new AllocationError("TARGET_INVALID", "every allocation target requires a ref");
    if (typeof t.weight !== "number" || !Number.isFinite(t.weight) || t.weight <= 0) {
      throw new AllocationError("TARGET_INVALID", `target ${t.ref}: weight must be a positive finite number`);
    }
    totalWeight += t.weight;
  }
  const sign = amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(amountMinor);
  const raw = list.map((t) => (magnitude * t.weight) / totalWeight);
  const floors = raw.map(Math.floor);
  let remainder = magnitude - floors.reduce((n, v) => n + v, 0);
  // Assign the leftover units to the largest fractional remainders (stable: ties keep input order).
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.slice();
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return list.map((t, i) => ({ ref: t.ref, amountMinor: sign * out[i] }));
}

/** One fact entering a company rollup — company-stamped, integer minor units. */
export interface CompanyFact {
  ref: string;
  operatingCompanyId: string;
  amountMinor: number;
}

export interface CompanyRollup {
  /** total per company, every company that appears */
  byCompany: { operatingCompanyId: string; totalMinor: number; factCount: number }[];
  /**
   * The consolidated figure is an UNELIMINATED arithmetic sum: NO intercompany activity has been
   * removed, because no elimination policy exists (FIN-BLOCK-004) and inventing one is prohibited
   * (FIN-001 D-3). It must never be presented as an eliminated consolidated total.
   */
  consolidated: { status: "UNELIMINATED_SUM"; totalMinor: number };
}

// Roll company-stamped facts up per company + the honestly-labeled uneliminated consolidated sum.
// Facts without a company are a thrown defect (FIN-002: no reportable number without its company).
export function summarizeByCompany(facts: CompanyFact[]): CompanyRollup {
  const list = Array.isArray(facts) ? facts : [];
  const totals = new Map<string, { totalMinor: number; factCount: number }>();
  let consolidatedMinor = 0;
  for (const f of list) {
    if (!nonEmpty(f?.ref)) throw new AllocationError("FACT_INVALID", "every fact requires a ref");
    if (!nonEmpty(f.operatingCompanyId)) {
      throw new AllocationError("COMPANY_REQUIRED", `fact ${f.ref} carries no operatingCompanyId — a company-less number cannot enter any company rollup`);
    }
    if (!isInt(f.amountMinor)) throw new AllocationError("FACT_INVALID", `fact ${f.ref}: amountMinor must be an integer (minor units)`);
    const key = f.operatingCompanyId.trim();
    const cur = totals.get(key) ?? { totalMinor: 0, factCount: 0 };
    cur.totalMinor += f.amountMinor;
    cur.factCount += 1;
    totals.set(key, cur);
    consolidatedMinor += f.amountMinor;
  }
  return {
    byCompany: [...totals.entries()]
      .map(([operatingCompanyId, v]) => ({ operatingCompanyId, ...v }))
      .sort((a, b) => (a.operatingCompanyId < b.operatingCompanyId ? -1 : 1)),
    consolidated: { status: "UNELIMINATED_SUM", totalMinor: consolidatedMinor },
  };
}
