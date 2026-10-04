// THE DETERMINISTIC ANALYSIS ENGINE (Package C — Analysis & Reporting, DECISIONS #208; #192 / ANALYSIS_LAYER_ARCHITECTURE.md).
//
//   FACTS (governed source records, measures.ts) -> MEASURES (one versioned definition each) -> COMPARISONS (the prior comparable
//   period, by the reporting-period resolver) -> VARIANCES (current - comparison) -> DRIVERS (company and the measure's dimension)
//   -> EXCEPTIONS (named, rule-based, record-linked) -> INSIGHTS (deterministic findings over the figures, no generated prose)
//   -> AUTHORIZED ACTIONS (the governed command, offered only as the caller's EXISTING capability allows).
//
// AUTHORITY: analysis grants NOTHING. A measure is visible only with one of its EXISTING read capabilities; a Sales measure is
// narrowed to the sales channels the caller's salesChannel-scoped holdings admit; drill-through goes to the record's own governed
// read, which decides again; an action is shown as available only when the caller already holds its capability, and runs on its
// own route with its own enforcement. COMPANY: Taylor, Ventana, or CONSOLIDATED -- a projection over the companies that owns no
// record and is never written. AI: none -- this module and its catalog import nothing from ai/; EOS Core analyses with AI absent.
import type { Pool, PoolClient } from "pg";
import { admittedScopeValues, type ScopedHolding } from "../adminPolicy/assignmentScopeRuntime";
import { resolveReportingPeriod, PERIOD_TYPES, type PeriodType } from "../reportingPeriod/reportingPeriod";
import { resolveSharedReportingCalendar } from "../reportingPeriod/reportingCalendar";
import { MEASURES, measureById, type MeasureDefinition, type MeasureRow, type MeasureScope } from "./measures";
import { scopedWarehouseIds } from "../eosOps/partsReads";
import { queueReachKeys } from "../eosOps/reorderLifecycleCommands";

type Queryable = Pick<PoolClient, "query">;

export class AnalysisError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}
const refuse = (code: string, category: AnalysisError["category"], message: string): never => {
  throw new AnalysisError(code, category, message);
};

export interface AnalysisActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
  readonly scopedHeld?: readonly ScopedHolding<unknown>[];
}

const ROW_LIMIT = 5000;

// ════════════════════ areas (the persona workspaces assemble these) ════════════════════

export const ANALYSIS_AREAS = Object.freeze({
  executive: { label: "Owner / General Manager", channel: null,
    measures: ["finance.receivables.open", "finance.receivables.overdue", "finance.fundingReceivables.open", "finance.payables.open", "sales.orders.booked",
      "sales.pipeline.open", "service.workOrders.completed", "service.workOrders.open", "purchasing.orders.placed", "inventory.cycleCount.variances",
      "rental.utilization.timeWeighted", "rental.charges.billed", "finance.margin.gross", "plan.targetBudget"] },
  finance: { label: "Finance / Accounting", channel: null,
    measures: ["finance.receivables.open", "finance.receivables.overdue", "finance.fundingReceivables.open", "finance.payables.open", "finance.intercompany.open",
      "finance.settlements.received", "finance.settlements.unapplied", "finance.reconciliation.open", "finance.accountingHandoffs.exceptions",
      "finance.costEvidence.missing", "accounting.actual", "finance.margin.gross"] },
  salesRetail: { label: "Retail Sales", channel: "RETAIL",
    measures: ["sales.pipeline.open", "sales.orders.booked", "sales.fulfillment.lines", "sales.discounts.granted", "sales.tradeIns.consideration", "sales.mix.disposition", "plan.forecast"] },
  salesNational: { label: "National Accounts Sales", channel: "NATIONAL_ACCOUNTS",
    measures: ["sales.pipeline.open", "sales.orders.booked", "sales.fulfillment.lines", "sales.discounts.granted", "sales.tradeIns.consideration", "sales.mix.disposition", "plan.forecast"] },
  service: { label: "Service management", channel: null,
    measures: ["service.workOrders.opened", "service.workOrders.completed", "service.workOrders.open", "service.technician.workload", "service.parts.used"] },
  purchasing: { label: "Parts / Purchasing", channel: null,
    measures: ["purchasing.orders.placed", "purchasing.receipts.received", "purchasing.reorders.open", "finance.costEvidence.missing", "finance.payables.open"] },
  warehouse: { label: "Warehouse / Inventory", channel: null,
    measures: ["inventory.onHand.quantity", "inventory.transfers.inFlight", "inventory.cycleCount.variances", "inventory.serialized.installed"] },
  rental: { label: "Rental", channel: null,
    measures: ["rental.fleet.units", "rental.utilization.timeWeighted", "rental.downtime.unitDays", "rental.returns.received", "rental.charges.billed"] },
} as const);
export type AnalysisArea = keyof typeof ANALYSIS_AREAS;

// ════════════════════ scope ════════════════════

interface Scope { readonly consolidated: boolean; readonly companyIds: string[]; readonly companyKeys: string[]; readonly keyToId: Map<string, string> }

async function companyScope(db: Queryable, tenantId: string, raw: unknown): Promise<Scope> {
  const { rows } = await db.query(
    `SELECT c.operating_company_id AS id, k.operating_company_key AS key FROM eos_policy.tenant_operating_companies c
       LEFT JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = c.tenant_id AND k.operating_company_id = c.operating_company_id AND k.status = 'ACTIVE'
      WHERE c.tenant_id = $1 AND c.status = 'ACTIVE' ORDER BY 1`, [tenantId]);
  const all = rows.map((r) => ({ id: String(r.id), key: r.key === null ? null : String(r.key) }));
  const pick = raw === undefined || raw === null || String(raw).toLowerCase() === "consolidated" ? all
    : all.filter((c) => c.id === raw);
  if (pick.length === 0) refuse("OPERATING_COMPANY_UNKNOWN", "INVALID_INPUT", "operatingCompanyId is an active operating company, or consolidated");
  const keyToId = new Map<string, string>();
  for (const c of pick) if (c.key) keyToId.set(c.key, c.id);
  return { consolidated: pick.length !== 1 || String(raw ?? "").toLowerCase() === "consolidated" || raw === undefined || raw === null,
    companyIds: pick.map((c) => c.id), companyKeys: pick.filter((c) => c.key).map((c) => c.key as string), keyToId };
}

interface Period { readonly start: Date; readonly endExclusive: Date; readonly comparison: { start: Date; endExclusive: Date } | null; readonly metadata: Record<string, unknown> }

function resolvePeriod(scope: Scope, periodType: unknown, comparison: unknown, asOf: Date): Period {
  const type = (periodType ?? "MTD") as PeriodType;
  if (!PERIOD_TYPES.includes(type)) refuse("PERIOD_TYPE_INVALID", "INVALID_INPUT", `periodType is one of ${PERIOD_TYPES.join(", ")}`);
  const cal = resolveSharedReportingCalendar(scope.companyIds);
  if (cal.state !== "RESOLVED" || !cal.calendar) refuse("REPORTING_CALENDAR_UNRESOLVED", "PRECONDITION_FAILED", `the companies in scope share no governed reporting calendar (${cal.state})`);
  const mode = comparison === "NONE" ? "NONE" : "PRIOR_COMPARABLE";
  const r = resolveReportingPeriod({ calendar: cal.calendar!, periodType: type, asOfMillis: asOf.getTime(), comparisonMode: mode });
  return { start: new Date(r.current.startMillis), endExclusive: new Date(r.current.endExclusiveMillis),
    comparison: r.comparison ? { start: new Date(r.comparison.startMillis), endExclusive: new Date(r.comparison.endExclusiveMillis) } : null,
    metadata: { ...r.metadata, currentFirstDay: r.current.firstDayIso, currentLastDay: r.current.lastDayInclusiveIso,
      comparisonFirstDay: r.comparison?.firstDayIso ?? null, comparisonLastDay: r.comparison?.lastDayInclusiveIso ?? null } };
}

// ════════════════════ authority over a measure ════════════════════

type Access = { allowed: false; reason: string } | { allowed: true; channels: readonly string[] | null };

function measureAccess(actor: AnalysisActor, m: MeasureDefinition, areaChannel: string | null): Access {
  const flat = m.readCapabilities.some((k) => actor.capabilities.has(k));
  if (m.channelScopedBy) {
    const scoped = flat ? null : admittedScopeValues(actor.scopedHeld as never, m.channelScopedBy, "salesChannel");
    if (!flat && (scoped === null || scoped.length === 0)) {
      return { allowed: false, reason: `requires ${m.readCapabilities.join(" or ")} (or a salesChannel-scoped holding of ${m.channelScopedBy})` };
    }
    let channels: readonly string[] | null = scoped;
    if (areaChannel) channels = channels === null ? [areaChannel] : channels.filter((c) => c === areaChannel);
    if (channels !== null && channels.length === 0) return { allowed: false, reason: `outside your sales channel scope (${areaChannel})` };
    return { allowed: true, channels };
  }
  return flat ? { allowed: true, channels: null } : { allowed: false, reason: `requires ${m.readCapabilities.join(" or ")}` };
}

/**
 * The measure's source rows for one window, narrowed by EXACTLY the reach its records' own reads apply. Returns null with the
 * reason when the caller's Operational Scope reaches nothing in this scope (the aggregate would otherwise exceed the reads).
 */
async function rowsFor(db: Queryable, actor: AnalysisActor, m: MeasureDefinition, scope: Scope, channels: readonly string[] | null,
  start: Date | null, end: Date | null, limit: number): Promise<{ rows: MeasureRow[] } | { refused: string }> {
  let companyKeys = scope.companyKeys, warehouses: readonly string[] | null = null;
  if (m.reach === "REORDER_QUEUE") {
    const reach = await queueReachKeys(db, actor);
    companyKeys = companyKeys.filter((k) => reach.includes(k));
    if (companyKeys.length === 0) return { refused: "requires the REORDER_QUEUE Operational Scope over the company in view" };
  } else if (m.reach === "WAREHOUSE") {
    warehouses = await scopedWarehouseIds(db, actor);
    if (warehouses.length === 0) return { refused: "requires a WAREHOUSE Operational Scope" };
  }
  const companyIds = companyKeys.map((k) => scope.keyToId.get(k)).filter((x): x is string => !!x);
  return { rows: await m.rows!(db, { tenantId: actor.tenantId, companyKeys, companyIds: m.reach ? companyIds : scope.companyIds,
    start, endExclusive: end, channels, warehouses, limit }) };
}

// ════════════════════ aggregation ════════════════════

interface Aggregate { readonly count: number; readonly quantity: number; readonly money: Record<string, string>; readonly missingAmount: number; readonly ratio: number | null }

function aggregate(m: MeasureDefinition, rows: readonly MeasureRow[]): Aggregate {
  const money: Record<string, bigint> = {};
  let missing = 0, qty = 0;
  for (const r of rows) {
    qty += r.qty;
    if (m.unit === "MONEY") {
      if (r.amount === null) { missing += 1; continue; }
      const cur = r.currency ?? "USD";
      money[cur] = (money[cur] ?? 0n) + BigInt(r.amount);
    }
  }
  let ratio: number | null = null;
  if (m.unit === "RATIO") {
    const num = rows.filter((r) => (m.ratioNumerator ?? []).includes(String(r.dim))).reduce((a, r) => a + r.qty, 0);
    ratio = qty > 0 ? Math.round((num / qty) * 10_000) / 10_000 : null;
  }
  return Object.freeze({ count: new Set(rows.map((r) => r.recordId)).size, quantity: Math.round(qty * 100) / 100,
    money: Object.fromEntries(Object.entries(money).map(([c, v]) => [c, v.toString()])), missingAmount: missing, ratio });
}

/** The single headline number of an aggregate, by the measure's unit; null when it is not derivable (never coerced to zero). */
function headline(m: MeasureDefinition, a: Aggregate): { value: string | number | null; currencies: string[] } {
  if (m.unit === "MONEY") { const cs = Object.keys(a.money); return { value: cs.length === 1 ? a.money[cs[0]] : null, currencies: cs }; }
  if (m.unit === "RATIO") return { value: a.ratio, currencies: [] };
  if (m.unit === "COUNT") return { value: a.count, currencies: [] };
  return { value: a.quantity, currencies: [] };
}

function variance(m: MeasureDefinition, cur: Aggregate, prev: Aggregate | null) {
  if (!prev) return null;
  if (m.unit === "MONEY") {
    const cs = new Set([...Object.keys(cur.money), ...Object.keys(prev.money)]);
    const byCurrency: Record<string, { current: string; comparison: string; delta: string; percent: number | null }> = {};
    for (const c of cs) {
      const a = BigInt(cur.money[c] ?? "0"), b = BigInt(prev.money[c] ?? "0");
      byCurrency[c] = { current: a.toString(), comparison: b.toString(), delta: (a - b).toString(), percent: b === 0n ? null : Math.round(Number(((a - b) * 10000n) / b)) / 100 };
    }
    return { byCurrency, comparable: cur.missingAmount === 0 && prev.missingAmount === 0 };
  }
  const a = Number(headline(m, cur).value ?? 0), b = Number(headline(m, prev).value ?? 0);
  return { current: headline(m, cur).value, comparison: headline(m, prev).value, delta: Math.round((a - b) * 10_000) / 10_000,
    percent: b === 0 ? null : Math.round(((a - b) / b) * 10_000) / 100, comparable: true };
}

function drivers(m: MeasureDefinition, rows: readonly MeasureRow[], scope: Scope) {
  const group = (keyOf: (r: MeasureRow) => string) => {
    const by = new Map<string, MeasureRow[]>();
    for (const r of rows) by.set(keyOf(r), [...(by.get(keyOf(r)) ?? []), r]);
    return [...by.entries()].map(([key, rs]) => ({ key, ...aggregate(m, rs) }))
      .sort((x, y) => Number(headline(m, y).value ?? 0) - Number(headline(m, x).value ?? 0) || x.key.localeCompare(y.key));
  };
  return { byCompany: group((r) => scope.keyToId.get(r.company) ?? r.company), byDimension: m.dimension ? group((r) => r.dim ?? "UNSPECIFIED") : [] };
}

function quality(m: MeasureDefinition, a: Aggregate, rows: readonly MeasureRow[]): { state: string; notes: string[] } {
  const notes: string[] = [];
  if (a.missingAmount > 0) notes.push(`${a.missingAmount} contributing record(s) have no price -- excluded from the money total, never counted as zero`);
  if (m.unit === "MONEY" && Object.keys(a.money).length > 1) notes.push("more than one currency -- shown per currency, never summed");
  if (rows.length >= ROW_LIMIT) notes.push(`the source exceeded ${ROW_LIMIT} records; the figure covers the first ${ROW_LIMIT}`);
  const state = rows.length >= ROW_LIMIT ? "PARTIAL" : a.missingAmount > 0 ? "MISSING_PRICE" : "COMPLETE";
  return { state, notes };
}

export interface MeasureResult {
  readonly id: string; readonly name: string; readonly domain: string; readonly basis: string; readonly unit: string; readonly timeBasis: string;
  readonly status: "COMPUTED" | "REFUSED" | "ABSENT" | "STRUCTURALLY_UNKNOWN";
  readonly reason?: string;
  readonly [k: string]: unknown;
}

async function computeMeasure(db: Queryable, actor: AnalysisActor, m: MeasureDefinition, scope: Scope, period: Period, areaChannel: string | null,
  opts: { readonly sources: number }): Promise<MeasureResult> {
  const base = { id: m.id, name: m.name, domain: m.domain, basis: m.basis, unit: m.unit, timeBasis: m.timeBasis, definitionVersion: m.version };
  if (m.availability !== "AVAILABLE") return Object.freeze({ ...base, status: m.availability, reason: m.absenceReason ?? "not available" });
  const access = measureAccess(actor, m, areaChannel);
  if (!access.allowed) return Object.freeze({ ...base, status: "REFUSED" as const, reason: access.reason });
  const isPeriod = m.timeBasis === "PERIOD";
  const got = await rowsFor(db, actor, m, scope, access.channels, isPeriod ? period.start : null, isPeriod ? period.endExclusive : null, ROW_LIMIT);
  if ("refused" in got) return Object.freeze({ ...base, status: "REFUSED" as const, reason: got.refused });
  const rows = got.rows;
  const prevGot = isPeriod && period.comparison ? await rowsFor(db, actor, m, scope, access.channels, period.comparison.start, period.comparison.endExclusive, ROW_LIMIT) : null;
  const prevRows = prevGot && "rows" in prevGot ? prevGot.rows : null;
  const cur = aggregate(m, rows), prev = prevRows ? aggregate(m, prevRows) : null;
  return Object.freeze({
    ...base, status: "COMPUTED" as const,
    value: headline(m, cur), aggregate: cur, quality: quality(m, cur, rows),
    comparison: isPeriod ? (prev ? { aggregate: prev, value: headline(m, prev), variance: variance(m, cur, prev) } : { notComparableReason: "no comparison window" })
      : { notComparableReason: "a point-in-time measure has no governed history snapshot to compare against" },
    drivers: drivers(m, rows, scope),
    channels: access.channels,
    provenance: {
      definition: { formula: m.formula, description: m.description, sourceFacts: m.sourceFacts, periodEvent: m.periodEvent, dimension: m.dimension,
        readCapabilities: m.readCapabilities, version: m.version },
      contributingRecords: cur.count,
      sources: rows.slice(0, opts.sources).map((r) => ({ recordKind: r.recordKind, recordId: r.recordId, label: r.label, operatingCompanyId: scope.keyToId.get(r.company) ?? r.company,
        dimension: r.dim, currency: r.currency, amountMinor: r.amount, quantity: r.qty,
        drill: drillOf(m, r.recordId) })),
    },
  });
}

/** The contributing record's OWN governed read (which decides again). */
const drillOf = (m: MeasureDefinition, id: string) => m.drill
  ? { route: m.drill.route, operation: m.drill.operation, input: { [m.drill.idField]: m.drill.asList ? [id] : id } } : null;

// ════════════════════ exceptions -> authorized actions ════════════════════

interface ExceptionRule {
  readonly kind: string; readonly measureId: string | null; readonly severity: "HIGH" | "MEDIUM" | "LOW"; readonly rule: string;
  readonly action: { readonly operation: string; readonly route: string; readonly capability: string; readonly label: string } | null;
  readonly filter?: (r: MeasureRow) => boolean;
}

const EXCEPTION_RULES: readonly ExceptionRule[] = Object.freeze([
  { kind: "OVERDUE_RECEIVABLE", measureId: "finance.receivables.overdue", severity: "HIGH", rule: "a receivable is past its governed due date at the company's business date",
    action: { operation: "recordSettlement", route: "/operations/finance", capability: "finance.settlement.record", label: "Record the customer's payment" } },
  { kind: "PROVIDER_FUNDING_OUTSTANDING", measureId: "finance.fundingReceivables.open", severity: "MEDIUM", rule: "the financing provider has not yet paid an entitled amount",
    action: { operation: "recordSettlement", route: "/operations/finance", capability: "finance.settlement.record", label: "Record the provider funding received" } },
  { kind: "ACCOUNTING_HANDOFF_PENDING_DESTINATION", measureId: "finance.accountingHandoffs.exceptions", severity: "MEDIUM", rule: "a handoff waits for the company's accounting destination",
    filter: (r) => r.dim === "PENDING_DESTINATION",
    action: { operation: "configureAccountingDestination", route: "/admin/policy", capability: "finance.configuration.manage", label: "Configure the accounting destination" } },
  { kind: "ACCOUNTING_HANDOFF_REFUSED", measureId: "finance.accountingHandoffs.exceptions", severity: "HIGH", rule: "the accounting destination rejected or failed a handoff",
    filter: (r) => r.dim !== "PENDING_DESTINATION", action: null },
  { kind: "SETTLEMENT_UNRECONCILED", measureId: "finance.reconciliation.open", severity: "LOW", rule: "a recorded settlement has no reconciliation evidence, or a mismatch",
    action: { operation: "reconcileSettlement", route: "/operations/finance", capability: "finance.reconciliation.record", label: "Record reconciliation evidence" } },
  { kind: "MISSING_RECEIPT_COST_EVIDENCE", measureId: "finance.costEvidence.missing", severity: "HIGH", rule: "a received purchase line has no cost evidence",
    action: { operation: "supplyReceiptCostEvidence", route: "/operations/finance", capability: "inventory.receipt.correct", label: "Supply the late cost evidence" } },
  { kind: "CYCLE_COUNT_DIFFERENCE_PENDING", measureId: "inventory.cycleCount.variances", severity: "MEDIUM", rule: "a counted difference awaits review",
    filter: (r) => r.dim === "PENDING_REVIEW",
    action: { operation: "reconcileCycleCountLine", route: "/operations/cycle-count", capability: "inventory.cycleCount.reconcile", label: "Review the count difference" } },
]);

interface ExceptionItem { kind: string; severity: string; rule: string; recordKind: string; recordId: string; label: string | null; operatingCompanyId: string;
  drill: unknown; action: { operation: string; route: string; capability: string; label: string; available: boolean; input: Record<string, string> } | null }

async function exceptionsFor(db: Queryable, actor: AnalysisActor, scope: Scope, period: Period, measureIds: readonly string[]): Promise<ExceptionItem[]> {
  const out: ExceptionItem[] = [];
  for (const rule of EXCEPTION_RULES) {
    if (!rule.measureId || !measureIds.includes(rule.measureId)) continue;
    const m = measureById(rule.measureId)!;
    const access = measureAccess(actor, m, null);
    if (!access.allowed) continue;   // an exception is never visible without the read of its records
    const got = await rowsFor(db, actor, m, scope, access.channels, m.timeBasis === "PERIOD" ? new Date(0) : null, m.timeBasis === "PERIOD" ? period.endExclusive : null, 200);
    if ("refused" in got) continue;
    const rows = got.rows
      .filter((r) => !rule.filter || rule.filter(r));
    for (const r of rows) {
      out.push({ kind: rule.kind, severity: rule.severity, rule: rule.rule, recordKind: r.recordKind, recordId: r.recordId, label: r.label,
        operatingCompanyId: scope.keyToId.get(r.company) ?? r.company,
        drill: drillOf(m, r.recordId),
        action: rule.action ? { ...rule.action, available: actor.capabilities.has(rule.action.capability), input: {} } : null });
    }
  }
  return out;
}

/** Rental due-back / late and uncharged deployments, from the governed Rental records (rental.agreement.read). */
async function rentalExceptions(db: Queryable, actor: AnalysisActor, scope: Scope): Promise<ExceptionItem[]> {
  if (!actor.capabilities.has("rental.agreement.read")) return [];
  const { rows } = await db.query(
    `SELECT g.id, g.rental_agreement_number AS label, g.operating_company_key AS company, te.expected_end_date,
            eos_policy.operating_company_business_date(g.tenant_id, k.operating_company_id, now()) AS today,
            (SELECT max(c.period_end) FROM eos_rental.rental_charges c WHERE c.agreement_id = g.id AND c.kind = 'PERIOD') AS charged_through
       FROM eos_rental.rental_agreements g
       JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = g.tenant_id AND k.operating_company_key = g.operating_company_key AND k.status = 'ACTIVE'
       JOIN LATERAL (SELECT expected_end_date FROM eos_rental.rental_agreement_terms x WHERE x.agreement_id = g.id ORDER BY version DESC LIMIT 1) te ON TRUE
      WHERE g.tenant_id = $1 AND g.operating_company_key = ANY($2) AND g.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM eos_rental.rental_assignments s WHERE s.agreement_id = g.id AND s.status IN ('DEPLOYED', 'RETURN_PENDING'))`,
    [actor.tenantId, scope.companyKeys]);
  const out: ExceptionItem[] = [];
  const drill = (id: string) => ({ route: "/operations/rental", operation: "readRentalAgreement", input: { agreementId: id } });
  for (const r of rows) {
    const company = scope.keyToId.get(String(r.company)) ?? String(r.company);
    const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    if (day(r.expected_end_date) < day(r.today)) {
      out.push({ kind: "RENTAL_OVERDUE_RETURN", severity: "HIGH", rule: "equipment is still out after the agreed expected end", recordKind: "rentalAgreement", recordId: String(r.id),
        label: r.label, operatingCompanyId: company, drill: drill(String(r.id)),
        action: { operation: "initiateRentalReturn", route: "/operations/rental", capability: "rental.unit.return", label: "Start the return", available: actor.capabilities.has("rental.unit.return"), input: {} } });
    }
    if (r.charged_through === null || day(r.charged_through) <= day(r.today)) {
      out.push({ kind: "RENTAL_DEPLOYED_WITHOUT_CURRENT_CHARGE", severity: "MEDIUM", rule: "equipment is out and no rental period is charged through today", recordKind: "rentalAgreement",
        recordId: String(r.id), label: r.label, operatingCompanyId: company, drill: drill(String(r.id)),
        action: { operation: "recordRentalCharge", route: "/operations/rental", capability: "rental.charge.record", label: "Record the rental period charge", available: actor.capabilities.has("rental.charge.record"), input: {} } });
    }
  }
  return out;
}

/** Deterministic findings over computed figures: a governed comparison moved, or a figure is incomplete. Never generated prose. */
function insightsFor(results: readonly MeasureResult[]) {
  const out: Array<Record<string, unknown>> = [];
  for (const r of results) {
    if (r.status !== "COMPUTED") continue;
    const q = r.quality as { state: string; notes: string[] };
    if (q.state !== "COMPLETE") out.push({ kind: "DATA_INCOMPLETE", measureId: r.id, finding: q.state, detail: q.notes });
    const v = (r.comparison as { variance?: Record<string, any> } | undefined)?.variance;
    if (v && r.unit !== "MONEY" && typeof v.delta === "number" && v.delta !== 0) {
      out.push({ kind: v.delta > 0 ? "INCREASED_VS_PRIOR" : "DECREASED_VS_PRIOR", measureId: r.id, current: v.current, comparison: v.comparison, delta: v.delta, percent: v.percent });
    }
    if (v && r.unit === "MONEY") {
      for (const [c, x] of Object.entries(v.byCurrency as Record<string, { delta: string; percent: number | null; current: string; comparison: string }>)) {
        if (x.delta !== "0") out.push({ kind: BigInt(x.delta) > 0n ? "INCREASED_VS_PRIOR" : "DECREASED_VS_PRIOR", measureId: r.id, currency: c, current: x.current,
          comparison: x.comparison, delta: x.delta, percent: x.percent });
      }
    }
    const top = (r.drivers as { byDimension: Array<{ key: string }> } | undefined)?.byDimension?.[0];
    if (top && (r.drivers as { byDimension: unknown[] }).byDimension.length > 1) out.push({ kind: "LARGEST_DRIVER", measureId: r.id, dimension: top.key });
  }
  return out;
}

// ════════════════════ operations ════════════════════

export function readAnalysisCatalog(actor: AnalysisActor) {
  return Object.freeze({
    areas: Object.entries(ANALYSIS_AREAS).map(([key, a]) => ({ key, label: a.label, channel: a.channel, measures: [...a.measures],
      available: a.measures.some((id) => { const m = measureById(id)!; return m.availability === "AVAILABLE" && measureAccess(actor, m, a.channel).allowed; }) })),
    measures: MEASURES.map((m) => ({ id: m.id, version: m.version, domain: m.domain, name: m.name, description: m.description, formula: m.formula, basis: m.basis, unit: m.unit,
      timeBasis: m.timeBasis, periodEvent: m.periodEvent, sourceFacts: m.sourceFacts, dimension: m.dimension, readCapabilities: m.readCapabilities, availability: m.availability,
      absenceReason: m.absenceReason, visible: m.availability !== "AVAILABLE" || measureAccess(actor, m, null).allowed })),
    exceptionRules: [...EXCEPTION_RULES.map((r) => ({ kind: r.kind, measureId: r.measureId, severity: r.severity, rule: r.rule, action: r.action })),
      { kind: "RENTAL_OVERDUE_RETURN", measureId: null, severity: "HIGH", rule: "equipment is still out after the agreed expected end", action: { operation: "initiateRentalReturn", capability: "rental.unit.return" } },
      { kind: "RENTAL_DEPLOYED_WITHOUT_CURRENT_CHARGE", measureId: null, severity: "MEDIUM", rule: "equipment is out and no rental period is charged through today", action: { operation: "recordRentalCharge", capability: "rental.charge.record" } }],
    aiRequired: false,
  });
}

export async function readAnalysisWorkspace(pool: Pool, actor: AnalysisActor, input: Record<string, unknown>, now: () => Date = () => new Date()) {
  const allowed = ["area", "operatingCompanyId", "periodType", "comparison"];
  const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const areaKey = (input.area ?? "executive") as AnalysisArea;
  const area = ANALYSIS_AREAS[areaKey] ?? refuse("AREA_UNKNOWN", "INVALID_INPUT", `area is one of ${Object.keys(ANALYSIS_AREAS).join(", ")}`);
  const scope = await companyScope(pool, actor.tenantId, input.operatingCompanyId);
  const period = resolvePeriod(scope, input.periodType, input.comparison, now());
  const visible = area.measures.map((id) => measureById(id)!);
  if (!visible.some((m) => m.availability === "AVAILABLE" && measureAccess(actor, m, area.channel).allowed)) {
    refuse("ANALYSIS_AREA_NOT_AUTHORIZED", "FORBIDDEN", `none of the ${area.label} measures is readable with your capabilities`);
  }
  const results: MeasureResult[] = [];
  for (const m of visible) results.push(await computeMeasure(pool, actor, m, scope, period, area.channel, { sources: 5 }));
  const exceptions = [...await exceptionsFor(pool, actor, scope, period, area.measures as readonly string[]),
    ...(areaKey === "rental" || areaKey === "executive" ? await rentalExceptions(pool, actor, scope) : [])];
  return Object.freeze({
    area: { key: areaKey, label: area.label, channel: area.channel },
    scope: { operatingCompanyId: scope.consolidated ? "consolidated" : scope.companyIds[0], projection: scope.consolidated ? "CONSOLIDATED_REPORTING_PROJECTION" : "OPERATING_COMPANY",
      companies: scope.companyIds, note: scope.consolidated ? "Consolidated is an un-eliminated projection over the companies; it owns no record." : null },
    period: period.metadata,
    exceptions: exceptions.sort((a, b) => ["HIGH", "MEDIUM", "LOW"].indexOf(a.severity) - ["HIGH", "MEDIUM", "LOW"].indexOf(b.severity)),
    measures: results,
    insights: insightsFor(results),
    aiRequired: false,
  });
}

/** One measure in full: every driver, the comparison, and its contributing records (paged) -- the drill-through report. */
export async function readMeasureAnalysis(pool: Pool, actor: AnalysisActor, input: Record<string, unknown>, now: () => Date = () => new Date()) {
  const allowed = ["measureId", "operatingCompanyId", "periodType", "comparison", "channel"];
  const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const m = measureById(String(input.measureId ?? "")) ?? refuse("MEASURE_UNKNOWN", "NOT_FOUND", "no governed measure with that id");
  if (input.channel !== undefined && input.channel !== "RETAIL" && input.channel !== "NATIONAL_ACCOUNTS") refuse("CHANNEL_INVALID", "INVALID_INPUT", "channel is RETAIL or NATIONAL_ACCOUNTS");
  const scope = await companyScope(pool, actor.tenantId, input.operatingCompanyId);
  const period = resolvePeriod(scope, input.periodType, input.comparison, now());
  const r = await computeMeasure(pool, actor, m, scope, period, (input.channel as string | undefined) ?? null, { sources: 200 });
  if (r.status === "REFUSED") refuse("MEASURE_NOT_AUTHORIZED", "FORBIDDEN", `this measure ${r.reason}`);
  return Object.freeze({ scope: { operatingCompanyId: scope.consolidated ? "consolidated" : scope.companyIds[0], companies: scope.companyIds }, period: period.metadata, measure: r });
}

export { MEASURES };
