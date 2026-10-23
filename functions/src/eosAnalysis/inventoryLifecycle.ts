// INVENTORY LIFECYCLE (EOS Insight, docs/design/eos-insight-inventory-lifecycle.md) -- the SHAPE of stock over time for the
// lifecycle dashboard: monthly flow by lifecycle stage, month-end on hand, stock age, slow movers, procure-to-receipt lead time.
//
// It sits beside the measure catalog (measures.ts answers "what is the number"; this answers "how did it move") and keeps the
// engine's authority unchanged: analysis grants NOTHING. Company scope is the engine's companyScope (#235); every section is
// decided on its own EXISTING read capability and the SAME reach its records' reads apply (WAREHOUSE / REORDER_QUEUE); a
// section the caller cannot read is REFUSED with its reason, never zero. Input is closed, the SQL is fixed, the output is
// aggregates only, and the whole read is one REPEATABLE READ READ ONLY snapshot under a statement timeout.
import type { Pool, PoolClient } from "pg";
import { AnalysisError, companyScope, type AnalysisActor } from "./analysis";
import { GOVERNING_WAREHOUSE, INVENTORY_ON_HAND_READ, RECEIPT_READ, SUPPLIER_READ, scopedWarehouseIds, withReadSnapshot } from "../eosOps/partsReads";
import { queueReachKeys } from "../eosOps/reorderLifecycleCommands";
import { resolveSharedReportingCalendar } from "../reportingPeriod/reportingCalendar";

type Queryable = Pick<PoolClient, "query">;

const PO_READ = "reorder.purchaseOrder.read";
const CATALOG_READ = "inventory.catalog.read";
const DORMANT_DAYS = 180;
const SLOW_MOVER_LIMIT = 15;

/** Movement type -> lifecycle stage. Relocations are internal handling: they move stock between bins, not through its life. */
export const LIFECYCLE_STAGES = Object.freeze([
  { stage: "RECEIVED", label: "Received", direction: "IN", types: ["RECEIVED"] },
  { stage: "RETURNED", label: "Returned", direction: "IN", types: ["RETURNED", "RENTAL_RETURN"] },
  { stage: "ISSUED", label: "Issued", direction: "OUT", types: ["WORK_ORDER_CONSUMPTION", "INTERCOMPANY_SALE_RELIEF", "RENTAL_DEPLOYMENT"] },
  { stage: "SCRAPPED", label: "Scrapped", direction: "OUT", types: ["SCRAPPED"] },
  { stage: "TRANSFER_ADJUST", label: "Transfers & adjustments", direction: "NET", types: ["TRANSFER_IN", "TRANSFER_OUT", "ADJUSTED"] },
] as const);
const ISSUE_TYPES = LIFECYCLE_STAGES.find((s) => s.stage === "ISSUED")!.types as readonly string[];

export const AGE_BUCKETS = Object.freeze([
  { key: "0-30", label: "0–30 days", min: 0, max: 30 },
  { key: "31-90", label: "31–90 days", min: 31, max: 90 },
  { key: "91-180", label: "91–180 days", min: 91, max: 180 },
  { key: "181-365", label: "181–365 days", min: 181, max: 365 },
  { key: "365+", label: "Over 365 days", min: 366, max: null },
] as const);

const refuse = (code: string, category: AnalysisError["category"], message: string): never => { throw new AnalysisError(code, category, message); };
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

// The movements in scope, as-of: the on-hand basis (WAREHOUSE / BIN / MOBILE) narrowed to the caller's warehouses.
// $1 tenant, $2 company keys, $3 warehouses, $4 as-of, $5 reporting time zone.
const MV = `mv AS (
  SELECT m.part_id, m.location_type::text AS lt, m.location_id AS li, m.movement_type::text AS t, m.quantity_delta::numeric AS q, m.occurred_at
    FROM eos_ops.inventory_movements m
   WHERE m.tenant_id = $1 AND m.operating_company_key = ANY($2) AND m.location_type::text IN ('WAREHOUSE', 'BIN', 'MOBILE')
     AND ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} = ANY($3) AND m.occurred_at < $4),
  win AS (SELECT (date_trunc('month', $4::timestamptz AT TIME ZONE $5) - interval '11 months') AT TIME ZONE $5 AS start)`;
// Every position with stock, aged by its PART's last lifecycle movement anywhere in scope. Relocations do not count as
// activity: stock moved bin-to-bin is still the same idle stock, and aging it per position would make the move look like use.
const POS = `act AS (
  SELECT part_id, coalesce(max(occurred_at) FILTER (WHERE t NOT IN ('RELOCATION_IN', 'RELOCATION_OUT')), max(occurred_at)) AS last_act
    FROM mv GROUP BY part_id),
  pos AS (
  SELECT mv.part_id, mv.lt, mv.li, sum(mv.q) AS oh, act.last_act
    FROM mv JOIN act USING (part_id) GROUP BY mv.part_id, mv.lt, mv.li, act.last_act HAVING sum(mv.q) > 0)`;

function monthKeys(asOf: Date, timeZone: string): string[] {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(asOf).split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

async function stockSections(c: Queryable, actor: AnalysisActor, p: unknown[], months: string[]) {
  const [flowQ, scalarQ, ageQ, slowQ] = [
    await c.query(`WITH ${MV} SELECT to_char(date_trunc('month', mv.occurred_at AT TIME ZONE $5), 'YYYY-MM') AS month, mv.t, sum(mv.q) AS units
        FROM mv, win WHERE mv.occurred_at >= win.start GROUP BY 1, 2`, p),
    await c.query(`WITH ${MV} SELECT
        (SELECT coalesce(sum(q), 0) FROM mv, win WHERE mv.occurred_at < win.start) AS opening,
        (SELECT coalesce(sum(-q), 0) FROM mv WHERE t = ANY($6) AND occurred_at >= $4::timestamptz - interval '90 days') AS issued90`, [...p, ISSUE_TYPES]),
    await c.query(`WITH ${MV}, ${POS} SELECT floor(extract(epoch FROM ($4::timestamptz - last_act)) / 86400)::int AS age, sum(oh) AS units, count(*)::int AS positions
        FROM pos GROUP BY 1`, p),
    await c.query(`WITH ${MV}, ${POS} SELECT pos.part_id, sum(pos.oh) AS on_hand, max(pos.last_act) AS last_act,
          (SELECT coalesce(sum(-x.q), 0) FROM mv x, win WHERE x.part_id = pos.part_id AND x.t = ANY($6) AND x.occurred_at >= win.start) AS issued12
        FROM pos GROUP BY pos.part_id HAVING max(pos.last_act) < $4::timestamptz - make_interval(days => $7)
        ORDER BY 2 DESC, 1 LIMIT $8`, [...p, ISSUE_TYPES, DORMANT_DAYS, SLOW_MOVER_LIMIT]),
  ];

  // Flow: per stage per month, IN positive, OUT negative (as recorded), NET signed; plus the raw movement-type table twin.
  const byTypeMonth = new Map<string, number>();
  for (const r of flowQ.rows) byTypeMonth.set(`${r.t}|${r.month}`, num(r.units));
  const series = LIFECYCLE_STAGES.map((s) => ({ stage: s.stage, label: s.label, direction: s.direction, types: [...s.types],
    values: months.map((mo) => round(s.types.reduce((a, t) => a + (byTypeMonth.get(`${t}|${mo}`) ?? 0), 0))) }));
  const netByMonth = months.map((mo) => flowQ.rows.filter((r) => r.month === mo).reduce((a, r) => a + num(r.units), 0));
  const onHandTrend: number[] = [];
  netByMonth.reduce((bal, n) => { const v = bal + n; onHandTrend.push(round(v)); return v; }, num(scalarQ.rows[0].opening));

  const stage = (k: string) => series.find((s) => s.stage === k)!.values;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const onHand = onHandTrend[onHandTrend.length - 1] ?? 0;
  const issued12 = -sum(stage("ISSUED")), scrapped12 = -sum(stage("SCRAPPED"));
  const avgOnHand = sum(onHandTrend) / onHandTrend.length;
  const issued90 = num(scalarQ.rows[0].issued90);

  const buckets = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, units: 0, positions: 0 }));
  let dormantUnits = 0;
  for (const r of ageQ.rows) {
    const age = Math.max(0, num(r.age));
    const i = AGE_BUCKETS.findIndex((b) => age >= b.min && (b.max === null || age <= b.max));
    buckets[i].units = round(buckets[i].units + num(r.units)); buckets[i].positions += num(r.positions);
    if (age > DORMANT_DAYS) dormantUnits += num(r.units);
  }
  const totalPositioned = sum(buckets.map((b) => b.units));

  // Part identity is the catalog's to show: names only with its read; otherwise the part id alone (analysis grants nothing).
  const showNames = actor.capabilities.has(CATALOG_READ);
  const ids = slowQ.rows.map((r) => String(r.part_id));
  const names = new Map<string, { partNumber: string | null; name: string | null }>();
  if (showNames && ids.length) {
    const { rows } = await c.query(`SELECT id, internal_part_number, name FROM eos_ops.parts WHERE tenant_id = $1 AND id = ANY($2)`, [actor.tenantId, ids]);
    for (const r of rows) names.set(String(r.id), { partNumber: r.internal_part_number ?? null, name: r.name ?? null });
  }
  const asOf = p[3] as Date;
  const slowMovers = slowQ.rows.map((r) => ({ partId: String(r.part_id), ...(names.get(String(r.part_id)) ?? { partNumber: null, name: null }),
    onHand: round(num(r.on_hand)), lastActivity: new Date(r.last_act).toISOString(),
    daysIdle: Math.floor((asOf.getTime() - new Date(r.last_act).getTime()) / 86_400_000), issued12: round(num(r.issued12)) }));

  return {
    kpis: {
      onHand,
      received12: round(sum(stage("RECEIVED"))),
      issued12: round(issued12),
      turns: avgOnHand > 0 ? round(issued12 / avgOnHand) : null,
      daysOfSupply: issued90 > 0 ? Math.round(onHand / (issued90 / 90)) : null,
      dormantShare: totalPositioned > 0 ? round(dormantUnits / totalPositioned, 4) : null,
      scrapRate: issued12 + scrapped12 > 0 ? round(scrapped12 / (issued12 + scrapped12), 4) : null,
      issuedTrend: stage("ISSUED").map((v) => -v),
    },
    flow: { series, byMovementType: flowQ.rows.map((r) => ({ month: r.month, movementType: r.t, units: round(num(r.units)) }))
      .sort((a, b) => a.month.localeCompare(b.month) || a.movementType.localeCompare(b.movementType)) },
    onHandTrend,
    age: { dormantDays: DORMANT_DAYS, buckets },
    slowMovers: { dormantDays: DORMANT_DAYS, namesWithheld: !showNames, rows: slowMovers },
  };
}

/** Order-to-receipt days for receipts in the window, per month. Each source kind is admitted only on its own order read. */
async function leadTimeSection(c: Queryable, actor: AnalysisActor, companyKeys: string[], warehouses: string[], asOf: Date, timeZone: string, months: string[]) {
  if (!actor.capabilities.has(RECEIPT_READ)) return { status: "REFUSED" as const, reason: `requires ${RECEIPT_READ}` };
  const poKeys = actor.capabilities.has(PO_READ) ? (await queueReachKeys(c, actor as never)).filter((k: string) => companyKeys.includes(k)) : [];
  const supplier = actor.capabilities.has(SUPPLIER_READ);
  if (poKeys.length === 0 && !supplier) return { status: "REFUSED" as const, reason: `requires ${PO_READ} (with a REORDER_QUEUE Operational Scope) or ${SUPPLIER_READ}` };
  const { rows } = await c.query(
    `WITH win AS (SELECT (date_trunc('month', $4::timestamptz AT TIME ZONE $5) - interval '11 months') AT TIME ZONE $5 AS start),
     x AS (SELECT r.received_at, (r.received_at AT TIME ZONE $5)::date
                  - CASE r.source_kind::text WHEN 'PURCHASE_ORDER' THEN (sp.sent_at AT TIME ZONE $5)::date ELSE po.ordered_date END AS days
             FROM eos_ops.receiving_orders r
             LEFT JOIN eos_ops.purchase_orders po ON r.source_kind::text = 'REORDER_PURCHASE_ORDER' AND po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id
             LEFT JOIN eos_ops.supplier_purchase_orders sp ON r.source_kind::text = 'PURCHASE_ORDER' AND sp.tenant_id = r.tenant_id AND sp.id = r.source_purchase_order_id,
                  win
            WHERE r.tenant_id = $1 AND r.operating_company_key = ANY($2) AND r.received_at >= win.start AND r.received_at < $4
              AND ${GOVERNING_WAREHOUSE("r.tenant_id", "r.receiving_location_type", "r.receiving_location_id")} = ANY($3)
              AND ((r.source_kind::text = 'REORDER_PURCHASE_ORDER' AND r.operating_company_key = ANY($6)) OR (r.source_kind::text = 'PURCHASE_ORDER' AND $7)))
     SELECT to_char(date_trunc('month', received_at AT TIME ZONE $5), 'YYYY-MM') AS month, count(*)::int AS receipts,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS median, percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS p90
       FROM x WHERE days IS NOT NULL AND days >= 0 GROUP BY 1`,
    [actor.tenantId, companyKeys, warehouses, asOf, timeZone, poKeys, supplier]);
  const by = new Map(rows.map((r) => [String(r.month), r]));
  return { status: "COMPUTED" as const,
    sources: [...(poKeys.length ? ["REORDER_PURCHASE_ORDER"] : []), ...(supplier ? ["SUPPLIER_PURCHASE_ORDER"] : [])],
    months: months.map((mo) => { const r = by.get(mo); return { month: mo, receipts: r ? num(r.receipts) : 0,
      medianDays: r ? round(num(r.median), 1) : null, p90Days: r ? round(num(r.p90), 1) : null }; }) };
}

export async function readInventoryLifecycle(pool: Pool, actor: AnalysisActor, input: Record<string, unknown>, now: () => Date = () => new Date()) {
  const extra = Object.keys(input ?? {}).filter((k) => k !== "operatingCompanyId");
  if (extra.length) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  if (!actor.capabilities.has(INVENTORY_ON_HAND_READ)) refuse("INVENTORY_LIFECYCLE_NOT_AUTHORIZED", "FORBIDDEN", `requires ${INVENTORY_ON_HAND_READ}`);
  const asOf = now();
  return withReadSnapshot(pool, async (c) => {
    await c.query("SET LOCAL statement_timeout = '10s'");
    const scope = await companyScope(c, actor, input?.operatingCompanyId);
    const cal = resolveSharedReportingCalendar(scope.companyIds);
    if (cal.state !== "RESOLVED" || !cal.calendar) refuse("REPORTING_CALENDAR_UNRESOLVED", "PRECONDITION_FAILED", `the companies in scope share no governed reporting calendar (${cal.state})`);
    const timeZone = cal.calendar!.reportingTimeZone;
    const warehouses = await scopedWarehouseIds(c, actor as never, { companyKeys: scope.companyKeys });
    if (warehouses.length === 0) refuse("WAREHOUSE_SCOPE_REQUIRED", "FORBIDDEN", "requires a WAREHOUSE Operational Scope");
    const months = monthKeys(asOf, timeZone);
    const stock = await stockSections(c, actor, [actor.tenantId, scope.companyKeys, warehouses, asOf, timeZone], months);
    const leadTime = await leadTimeSection(c, actor, scope.companyKeys, warehouses, asOf, timeZone, months);
    return Object.freeze({
      scope: { operatingCompanyId: scope.consolidated ? "consolidated" : scope.companyIds[0], companies: scope.companyIds, warehouses: warehouses.length },
      asOf: asOf.toISOString(), timeZone, months,
      ...stock,
      leadTime,
      definitions: {
        onHand: "Σ quantity_delta of inventory movements at WAREHOUSE / BIN / MOBILE locations in your warehouses",
        turns: "issued units over the 12 months ÷ average month-end on hand",
        daysOfSupply: "on hand ÷ (units issued in the last 90 days ÷ 90)",
        stockAge: "days since the part's last movement in your warehouses, relocations excluded",
        dormantShare: `share of on-hand units idle more than ${DORMANT_DAYS} days`,
        scrapRate: "scrapped ÷ (issued + scrapped), 12 months",
        leadTime: "days from the order date (reorder PO ordered date, or supplier PO sent date) to receipt",
      },
      aiRequired: false,
    });
  });
}
