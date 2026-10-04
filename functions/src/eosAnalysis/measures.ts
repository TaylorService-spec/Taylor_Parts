// THE GOVERNED MEASURE CATALOG (Package C — Analysis & Reporting, DECISIONS #208; the design of #192 /
// docs/financials/ANALYSIS_LAYER_ARCHITECTURE.md §2 / §7). ONE definition per measure, versioned, in code: what it means, its
// formula, its BASIS (never mixed), its source facts, its dimensions, its time basis, the EXISTING read capability that may see
// it, and where a figure drills to. Each measure reads its source records through one bounded SQL query; the engine
// (analysis.ts) aggregates, compares, explains and links -- nothing is computed in the browser, nothing is invented.
//
// MISSING IS NEVER ZERO: a measure whose source does not exist is ABSENT / STRUCTURALLY_UNKNOWN with its reason; a money figure
// with a missing price is PARTIAL (MISSING_PRICE) and says so; money is never summed across currencies.
import type { PoolClient } from "pg";
import { GOVERNING_WAREHOUSE } from "../eosOps/partsReads";

type Queryable = Pick<PoolClient, "query">;

export const BASIS = Object.freeze({
  ACCOUNTING_ACTUAL: "ACCOUNTING_ACTUAL",
  EOS_OPERATIONAL_ACTUAL: "EOS_OPERATIONAL_ACTUAL",
  EOS_OPERATIONAL_ESTIMATE: "EOS_OPERATIONAL_ESTIMATE",
  FORECAST: "FORECAST",
  TARGET_BUDGET: "TARGET_BUDGET",
} as const);
export type Basis = (typeof BASIS)[keyof typeof BASIS];

export const ANALYSIS_DOMAINS = Object.freeze(["finance", "sales", "service", "purchasing", "inventory", "rental", "plan"] as const);
export type AnalysisDomain = (typeof ANALYSIS_DOMAINS)[number];

/** A source row: one contributing record. The engine aggregates rows; provenance lists them. */
export interface MeasureRow {
  readonly company: string;            // operating company KEY of the record (the attribution, never a location)
  readonly dim: string | null;         // the measure's driver dimension value (channel, status, technician, ...)
  readonly currency: string | null;    // money rows only
  readonly amount: string | null;      // integer minor units as text; null = missing (never zero)
  readonly qty: number;                // count / quantity contribution
  readonly recordKind: string;
  readonly recordId: string;
  readonly label: string | null;
}

export interface MeasureScope {
  readonly tenantId: string;
  readonly companyKeys: readonly string[];
  readonly companyIds: readonly string[];
  /** Period measures: [start, endExclusive) instants; point-in-time measures ignore it. */
  readonly start: Date | null;
  readonly endExclusive: Date | null;
  /** Sales channel admission: null = every channel (the read is held globally); [] = none. */
  readonly channels: readonly string[] | null;
  /** WAREHOUSE-reach measures: the warehouses the caller's Operational Scope covers (null = not a warehouse-scoped measure). */
  readonly warehouses: readonly string[] | null;
  readonly limit: number;
}

export interface MeasureDefinition {
  readonly id: string;
  readonly version: number;
  readonly domain: AnalysisDomain;
  readonly name: string;
  readonly description: string;
  readonly formula: string;
  readonly basis: Basis;
  readonly unit: "MONEY" | "COUNT" | "QUANTITY" | "RATIO" | "UNIT_DAYS";
  readonly timeBasis: "POINT_IN_TIME" | "PERIOD";
  /** The governed event that places a record in a period (never a record's createdAt for financial measures -- FIN-002). */
  readonly periodEvent: string | null;
  readonly sourceFacts: readonly string[];
  readonly dimension: string | null;
  /** ANY of these EXISTING capabilities may see the measure. Analysis grants nothing. */
  readonly readCapabilities: readonly string[];
  /** The read capability whose salesChannel-scoped holdings narrow this measure (Retail vs National Accounts). */
  readonly channelScopedBy: string | null;
  /**
   * The SAME reach the record reads apply (an aggregate never exceeds what its records' reads allow):
   * REORDER_QUEUE -- the companies the caller's REORDER_QUEUE Operational Scope covers (the Reorder queue / PO reads);
   * WAREHOUSE     -- the warehouses the caller's WAREHOUSE Operational Scope covers (on-hand, receipts, transfers, cycle counts).
   */
  readonly reach?: "REORDER_QUEUE" | "WAREHOUSE";
  /** Where a contributing record drills to: its own governed read. */
  readonly drill: { readonly route: string; readonly operation: string; readonly idField: string; readonly asList?: boolean } | null;
  /** ABSENT / STRUCTURALLY_UNKNOWN measures carry the reason and no query. */
  readonly availability: "AVAILABLE" | "ABSENT" | "STRUCTURALLY_UNKNOWN";
  /** RATIO measures: the driver values that form the numerator (the denominator is every row). */
  readonly ratioNumerator?: readonly string[];
  readonly absenceReason: string | null;
  readonly rows: ((db: Queryable, s: MeasureScope) => Promise<MeasureRow[]>) | null;
}

const money = (r: Record<string, any>, kind: string, label: string | null = null): MeasureRow => ({
  company: String(r.company), dim: r.dim ?? null, currency: r.currency ?? null, amount: r.amount === null || r.amount === undefined ? null : String(r.amount),
  qty: Number(r.qty ?? 1), recordKind: kind, recordId: String(r.id), label: label ?? (r.label ?? null),
});
const run = async (db: Queryable, sql: string, params: unknown[], kind: string) => (await db.query(sql, params)).rows.map((r) => money(r, kind));

// Finance measures read eos_finance, attributed by operating_company_id; the engine passes both ids and keys.
const FIN_OPEN = (kinds: string[], extra = "TRUE") => async (db: Queryable, s: MeasureScope) => run(db,
  `SELECT o.id, o.operating_company_id AS company_id, k.operating_company_key AS company, o.kind AS dim, o.currency, b.outstanding_minor AS amount, 1 AS qty,
          coalesce(a.name, cp.operating_company_id, cp.crm_account_id) AS label
     FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
     JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = o.tenant_id AND k.operating_company_id = o.operating_company_id AND k.status = 'ACTIVE'
     JOIN eos_finance.financial_counterparties cp ON cp.tenant_id = o.tenant_id AND cp.id = o.counterparty_id
     LEFT JOIN eos_crm.accounts a ON a.tenant_id = cp.tenant_id AND a.id = cp.crm_account_id
    WHERE o.tenant_id = $1 AND o.operating_company_id = ANY($2) AND o.kind = ANY($3) AND o.status IN ('OPEN', 'PARTIAL') AND ${extra}
    ORDER BY b.outstanding_minor DESC, o.id LIMIT $4`, [s.tenantId, s.companyIds, kinds, s.limit], "obligation");

const channelClause = (alias: string, idx: number) => `($${idx}::text[] IS NULL OR ${alias}.sales_channel::text = ANY($${idx}::text[]))`;

export const MEASURES: readonly MeasureDefinition[] = Object.freeze([
  // ════════════════════ FINANCE (operational subledger -- #145: EOS is not the GL) ════════════════════
  {
    id: "finance.receivables.open", version: 1, domain: "finance", name: "Open receivables", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "POINT_IN_TIME",
    description: "What customers owe the company now: outstanding customer RECEIVABLE obligations (sales and rental).", formula: "Σ outstanding_minor of RECEIVABLE obligations OPEN / PARTIAL, per currency",
    periodEvent: null, sourceFacts: ["eos_finance.obligations", "eos_finance.obligation_balances", "eos_finance.financial_facts"], dimension: "obligation kind",
    readCapabilities: ["finance.payment.read"], channelScopedBy: null, drill: { route: "/operations/finance", operation: "readObligation", idField: "obligationId" },
    availability: "AVAILABLE", absenceReason: null, rows: FIN_OPEN(["RECEIVABLE"]),
  },
  {
    id: "finance.receivables.overdue", version: 1, domain: "finance", name: "Overdue receivables", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "POINT_IN_TIME",
    description: "Receivables past their governed due date at the owning company's business date. A receivable with no governed due date is never overdue.",
    formula: "Σ outstanding_minor of RECEIVABLE OPEN / PARTIAL with due_on < company business date", periodEvent: null,
    sourceFacts: ["eos_finance.obligations", "eos_finance.obligation_balances"], dimension: "obligation kind", readCapabilities: ["finance.payment.read"], channelScopedBy: null,
    drill: { route: "/operations/finance", operation: "readObligation", idField: "obligationId" }, availability: "AVAILABLE", absenceReason: null,
    rows: FIN_OPEN(["RECEIVABLE"], "o.due_on IS NOT NULL AND o.due_on < eos_policy.operating_company_business_date(o.tenant_id, o.operating_company_id, now())"),
  },
  {
    id: "finance.fundingReceivables.open", version: 1, domain: "finance", name: "Provider funding outstanding", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY",
    timeBasis: "POINT_IN_TIME", description: "Financed-sale amounts the financing provider has not yet paid (FUNDING_RECEIVABLE).", formula: "Σ outstanding of FUNDING_RECEIVABLE OPEN / PARTIAL",
    periodEvent: null, sourceFacts: ["eos_finance.obligations", "eos_commercial.financing_arrangements"], dimension: "obligation kind", readCapabilities: ["finance.payment.read"],
    channelScopedBy: null, drill: { route: "/operations/finance", operation: "readObligation", idField: "obligationId" }, availability: "AVAILABLE", absenceReason: null,
    rows: FIN_OPEN(["FUNDING_RECEIVABLE"]),
  },
  {
    id: "finance.payables.open", version: 1, domain: "finance", name: "Open payables", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "POINT_IN_TIME",
    description: "What the company owes suppliers for received purchases (received-not-invoiced PAYABLE obligations).", formula: "Σ outstanding of PAYABLE OPEN / PARTIAL",
    periodEvent: null, sourceFacts: ["eos_finance.obligations", "eos_ops.receiving_orders"], dimension: "obligation kind", readCapabilities: ["finance.payment.read"], channelScopedBy: null,
    drill: { route: "/operations/finance", operation: "readObligation", idField: "obligationId" }, availability: "AVAILABLE", absenceReason: null, rows: FIN_OPEN(["PAYABLE"]),
  },
  {
    id: "finance.intercompany.open", version: 1, domain: "finance", name: "Intercompany balances", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "POINT_IN_TIME",
    description: "Open intercompany payables and receivables, each company's side separately -- never netted, never eliminated.",
    formula: "Σ outstanding of INTERCOMPANY_PAYABLE and INTERCOMPANY_RECEIVABLE, by kind", periodEvent: null, sourceFacts: ["eos_finance.obligations", "eos_finance.intercompany_transactions"],
    dimension: "obligation kind", readCapabilities: ["finance.payment.read"], channelScopedBy: null, drill: { route: "/operations/finance", operation: "readObligation", idField: "obligationId" },
    availability: "AVAILABLE", absenceReason: null, rows: FIN_OPEN(["INTERCOMPANY_PAYABLE", "INTERCOMPANY_RECEIVABLE"]),
  },
  {
    id: "finance.settlements.received", version: 1, domain: "finance", name: "Money received", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "PERIOD",
    description: "Settlements EOS has evidence of receiving (customer payments, provider funding, intercompany receipts) by their business date.",
    formula: "Σ amount_minor of RECORDED receipt settlements with business_date in the period, per currency", periodEvent: "settlement business date",
    sourceFacts: ["eos_finance.settlements"], dimension: "settlement kind", readCapabilities: ["finance.payment.read"], channelScopedBy: null,
    drill: { route: "/operations/finance", operation: "readSettlement", idField: "settlementId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT st.id, k.operating_company_key AS company, st.kind AS dim, st.currency, st.amount_minor AS amount, 1 AS qty, st.source_reference AS label
        FROM eos_finance.settlements st JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = st.tenant_id AND k.operating_company_id = st.operating_company_id AND k.status = 'ACTIVE'
       WHERE st.tenant_id = $1 AND st.operating_company_id = ANY($2) AND st.status = 'RECORDED' AND st.direction = 'RECEIPT'
         AND st.business_date >= eos_policy.operating_company_business_date(st.tenant_id, st.operating_company_id, $3::timestamptz)
         AND st.business_date <= eos_policy.operating_company_business_date(st.tenant_id, st.operating_company_id, $4::timestamptz - interval '1 millisecond')
       ORDER BY st.business_date, st.id LIMIT $5`, [s.tenantId, s.companyIds, s.start, s.endExclusive, s.limit], "settlement"),
  },
  {
    id: "finance.settlements.unapplied", version: 1, domain: "finance", name: "Unapplied settlements", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "POINT_IN_TIME",
    description: "Money recorded but not yet applied to any obligation.", formula: "Σ unapplied_minor of RECORDED settlements with unapplied > 0", periodEvent: null,
    sourceFacts: ["eos_finance.settlements", "eos_finance.settlement_balances"], dimension: "settlement kind", readCapabilities: ["finance.payment.read"], channelScopedBy: null,
    drill: { route: "/operations/finance", operation: "readSettlement", idField: "settlementId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT st.id, k.operating_company_key AS company, st.kind AS dim, st.currency, b.unapplied_minor AS amount, 1 AS qty, st.source_reference AS label
        FROM eos_finance.settlements st JOIN eos_finance.settlement_balances b ON b.tenant_id = st.tenant_id AND b.settlement_id = st.id
        JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = st.tenant_id AND k.operating_company_id = st.operating_company_id AND k.status = 'ACTIVE'
       WHERE st.tenant_id = $1 AND st.operating_company_id = ANY($2) AND st.status = 'RECORDED' AND b.unapplied_minor > 0 ORDER BY b.unapplied_minor DESC LIMIT $3`,
    [s.tenantId, s.companyIds, s.limit], "settlement"),
  },
  {
    id: "finance.accountingHandoffs.exceptions", version: 1, domain: "finance", name: "Accounting handoffs needing attention", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT",
    timeBasis: "POINT_IN_TIME", description: "Handoffs not yet ready for, or refused by, the company's own accounting destination.",
    formula: "count of handoffs in PENDING_DESTINATION / REJECTED / FAILED_RETRYABLE / FAILED_FINAL", periodEvent: null, sourceFacts: ["eos_finance.accounting_handoffs"],
    dimension: "handoff status", readCapabilities: ["finance.payment.read"], channelScopedBy: null, drill: null, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT h.id, k.operating_company_key AS company, h.status AS dim, NULL AS currency, NULL AS amount, 1 AS qty, h.payload_kind AS label
        FROM eos_finance.accounting_handoffs h JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = h.tenant_id AND k.operating_company_id = h.operating_company_id AND k.status = 'ACTIVE'
       WHERE h.tenant_id = $1 AND h.operating_company_id = ANY($2) AND h.status IN ('PENDING_DESTINATION', 'REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL') ORDER BY h.created_at LIMIT $3`,
    [s.tenantId, s.companyIds, s.limit], "accountingHandoff"),
  },
  {
    id: "finance.reconciliation.open", version: 1, domain: "finance", name: "Settlements not reconciled", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Recorded settlements with no reconciliation evidence, or whose latest evidence is a MISMATCH.", formula: "count of RECORDED settlements whose latest reconciliation is none or MISMATCH",
    periodEvent: null, sourceFacts: ["eos_finance.settlements", "eos_finance.settlement_reconciliations"], dimension: "reconciliation state", readCapabilities: ["finance.payment.read"],
    channelScopedBy: null, drill: { route: "/operations/finance", operation: "readSettlement", idField: "settlementId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT st.id, k.operating_company_key AS company, coalesce(l.outcome, 'UNRECONCILED') AS dim, st.currency, st.amount_minor AS amount, 1 AS qty, st.source_reference AS label
        FROM eos_finance.settlements st JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = st.tenant_id AND k.operating_company_id = st.operating_company_id AND k.status = 'ACTIVE'
        LEFT JOIN LATERAL (SELECT outcome FROM eos_finance.settlement_reconciliations r WHERE r.tenant_id = st.tenant_id AND r.settlement_id = st.id ORDER BY recorded_at DESC, id DESC LIMIT 1) l ON TRUE
       WHERE st.tenant_id = $1 AND st.operating_company_id = ANY($2) AND st.status = 'RECORDED' AND (l.outcome IS NULL OR l.outcome = 'MISMATCH') ORDER BY st.business_date LIMIT $3`,
    [s.tenantId, s.companyIds, s.limit], "settlement"),
  },
  {
    id: "finance.costEvidence.missing", version: 1, domain: "finance", name: "Receipts missing cost evidence", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT",
    timeBasis: "POINT_IN_TIME", description: "Received purchase lines whose cost is unknown -- never valued at zero.", formula: "count of cost-evidence exceptions with no resolution",
    periodEvent: null, sourceFacts: ["eos_finance.cost_evidence_exceptions"], dimension: "part", readCapabilities: ["finance.payment.read"], channelScopedBy: null,
    drill: null, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT x.id, k.operating_company_key AS company, x.part_id AS dim, NULL AS currency, NULL AS amount, x.received_quantity AS qty, x.receiving_id AS label
        FROM eos_finance.cost_evidence_exceptions x JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = x.tenant_id AND k.operating_company_id = x.operating_company_id AND k.status = 'ACTIVE'
       WHERE x.tenant_id = $1 AND x.operating_company_id = ANY($2) AND NOT EXISTS (SELECT 1 FROM eos_finance.cost_evidence_exception_resolutions z WHERE z.exception_id = x.id)
       ORDER BY x.detected_at LIMIT $3`, [s.tenantId, s.companyIds, s.limit], "costEvidenceException"),
  },

  // ════════════════════ SALES (Retail and National Accounts kept distinct by the governed sales channel) ════════════════════
  {
    id: "sales.pipeline.open", version: 1, domain: "sales", name: "Open opportunities", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Opportunities not yet closed, by sales channel. Expected value is a currency-less estimate (FIN-002) and is not summed as money.",
    formula: "count of opportunities with no outcome", periodEvent: null, sourceFacts: ["eos_commercial.opportunities"], dimension: "sales channel",
    readCapabilities: ["opportunity.read"], channelScopedBy: "opportunity.read", drill: { route: "/commercial/sales", operation: "getOpportunityDetail", idField: "opportunityId" },
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT o.id, o.operating_company_key AS company, o.sales_channel::text AS dim, NULL AS currency, NULL AS amount, 1 AS qty, o.opportunity_number AS label
        FROM eos_commercial.opportunities o WHERE o.tenant_id = $1 AND o.operating_company_key = ANY($2) AND o.outcome IS NULL AND ${channelClause("o", 3)}
       ORDER BY o.updated_at DESC LIMIT $4`, [s.tenantId, s.companyKeys, s.channels, s.limit], "opportunity"),
  },
  {
    id: "sales.orders.booked", version: 1, domain: "sales", name: "Orders booked", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "PERIOD",
    description: "Sales Orders booked in the period at their accepted line prices, by channel. A line without a price makes the figure PARTIAL (MISSING_PRICE) -- never zero.",
    formula: "Σ ordered_qty × unit_price_minor of the lines of Sales Orders with booked_at in the period, per currency", periodEvent: "sales order booked_at",
    sourceFacts: ["eos_commercial.sales_orders", "eos_commercial.sales_order_lines"], dimension: "sales channel", readCapabilities: ["salesOrder.read"], channelScopedBy: "salesOrder.read",
    drill: { route: "/commercial/sales", operation: "getSalesOrderDetail", idField: "salesOrderId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT so.id, so.operating_company_key AS company, so.sales_channel::text AS dim, coalesce(so.currency, 'USD') AS currency,
            CASE WHEN bool_and(l.unit_price_minor IS NOT NULL) THEN sum(l.ordered_qty::bigint * l.unit_price_minor) END AS amount, 1 AS qty, so.sales_order_number AS label
        FROM eos_commercial.sales_orders so JOIN eos_commercial.sales_order_lines l ON l.tenant_id = so.tenant_id AND l.sales_order_id = so.id
       WHERE so.tenant_id = $1 AND so.operating_company_key = ANY($2) AND so.booked_at >= $3 AND so.booked_at < $4 AND ${channelClause("so", 5)}
       GROUP BY so.id ORDER BY so.booked_at LIMIT $6`, [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.channels, s.limit], "salesOrder"),
  },
  {
    id: "sales.fulfillment.lines", version: 1, domain: "sales", name: "Order lines fulfilled", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "QUANTITY", timeBasis: "PERIOD",
    description: "Quantity fulfilled on Sales Orders in the period (Work Order completion evidence), by channel.", formula: "Σ quantity of sales_order_fulfillments with fulfilled_at in the period",
    periodEvent: "fulfillment fulfilled_at", sourceFacts: ["eos_commercial.sales_order_fulfillments"], dimension: "sales channel", readCapabilities: ["salesOrder.read"],
    channelScopedBy: "salesOrder.read", drill: { route: "/commercial/sales", operation: "getSalesOrderDetail", idField: "salesOrderId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT f.sales_order_id AS id, f.operating_company_key AS company, so.sales_channel::text AS dim, NULL AS currency, NULL AS amount, f.quantity AS qty, so.sales_order_number AS label
        FROM eos_commercial.sales_order_fulfillments f JOIN eos_commercial.sales_orders so ON so.tenant_id = f.tenant_id AND so.id = f.sales_order_id
       WHERE f.tenant_id = $1 AND f.operating_company_key = ANY($2) AND f.fulfilled_at >= $3 AND f.fulfilled_at < $4 AND ${channelClause("so", 5)}
       ORDER BY f.fulfilled_at LIMIT $6`, [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.channels, s.limit], "salesOrder"),
  },
  {
    id: "sales.discounts.granted", version: 1, domain: "sales", name: "Customer discounts granted", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "PERIOD",
    description: "Customer sales discounts carried by billing packages prepared in the period (current versions only).",
    formula: "Σ customer_discount_minor of current billing packages of Sales Orders prepared in the period", periodEvent: "billing package prepared_at",
    sourceFacts: ["eos_finance.billing_packages", "eos_commercial.sales_orders"], dimension: "sales channel", readCapabilities: ["salesOrder.read"], channelScopedBy: "salesOrder.read",
    drill: { route: "/commercial/sales", operation: "getSalesOrderDetail", idField: "salesOrderId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT p.sales_order_id AS id, p.operating_company_key AS company, so.sales_channel::text AS dim, p.currency, p.customer_discount_minor AS amount, 1 AS qty, so.sales_order_number AS label
        FROM eos_finance.billing_packages p JOIN eos_commercial.sales_orders so ON so.tenant_id = p.tenant_id AND so.id = p.sales_order_id
       WHERE p.tenant_id = $1 AND p.operating_company_key = ANY($2) AND p.source_kind = 'SALES_ORDER' AND p.status IN ('HELD', 'READY') AND p.customer_discount_minor IS NOT NULL
         AND p.prepared_at >= $3 AND p.prepared_at < $4 AND ${channelClause("so", 5)} ORDER BY p.prepared_at LIMIT $6`,
    [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.channels, s.limit], "salesOrder"),
  },
  {
    id: "sales.tradeIns.consideration", version: 1, domain: "sales", name: "Trade-in consideration", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "PERIOD",
    description: "Approved trade-in credit accepted as non-cash consideration on packages prepared in the period -- never cash, never a discount.",
    formula: "Σ trade_in_minor of current Sales Order billing packages prepared in the period", periodEvent: "billing package prepared_at",
    sourceFacts: ["eos_finance.billing_packages", "eos_commercial.sales_agreement_trade_ins"], dimension: "sales channel", readCapabilities: ["salesOrder.read"], channelScopedBy: "salesOrder.read",
    drill: { route: "/commercial/sales", operation: "getSalesOrderDetail", idField: "salesOrderId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT p.sales_order_id AS id, p.operating_company_key AS company, so.sales_channel::text AS dim, p.currency, p.trade_in_minor AS amount, 1 AS qty, so.sales_order_number AS label
        FROM eos_finance.billing_packages p JOIN eos_commercial.sales_orders so ON so.tenant_id = p.tenant_id AND so.id = p.sales_order_id
       WHERE p.tenant_id = $1 AND p.operating_company_key = ANY($2) AND p.source_kind = 'SALES_ORDER' AND p.status IN ('HELD', 'READY') AND coalesce(p.trade_in_minor, 0) > 0
         AND p.prepared_at >= $3 AND p.prepared_at < $4 AND ${channelClause("so", 5)} ORDER BY p.prepared_at LIMIT $6`,
    [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.channels, s.limit], "salesOrder"),
  },
  {
    id: "sales.mix.disposition", version: 1, domain: "sales", name: "Direct vs financed mix", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "PERIOD",
    description: "Sales Order billing packages prepared in the period, by commercial disposition (SALE / DIRECT_ORDER / FINANCED_SALE / LEASE).",
    formula: "count of current Sales Order billing packages prepared in the period, by disposition", periodEvent: "billing package prepared_at",
    sourceFacts: ["eos_finance.billing_packages"], dimension: "commercial disposition", readCapabilities: ["salesOrder.read"], channelScopedBy: "salesOrder.read",
    drill: { route: "/commercial/sales", operation: "getSalesOrderDetail", idField: "salesOrderId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT p.sales_order_id AS id, p.operating_company_key AS company, p.commercial_disposition AS dim, NULL AS currency, NULL AS amount, 1 AS qty, so.sales_order_number AS label
        FROM eos_finance.billing_packages p JOIN eos_commercial.sales_orders so ON so.tenant_id = p.tenant_id AND so.id = p.sales_order_id
       WHERE p.tenant_id = $1 AND p.operating_company_key = ANY($2) AND p.source_kind = 'SALES_ORDER' AND p.status IN ('HELD', 'READY')
         AND p.prepared_at >= $3 AND p.prepared_at < $4 AND ${channelClause("so", 5)} ORDER BY p.prepared_at LIMIT $6`,
    [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.channels, s.limit], "salesOrder"),
  },

  // ════════════════════ SERVICE ════════════════════
  {
    id: "service.workOrders.opened", version: 1, domain: "service", name: "Work Orders opened", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "PERIOD",
    description: "Work Orders created in the period (the governed create transition), by type.", formula: "count of work_order_transitions action = 'create' occurred in the period",
    periodEvent: "work order create transition", sourceFacts: ["eos_ops.work_orders", "eos_ops.work_order_transitions"], dimension: "work order type",
    readCapabilities: ["workOrder.record.read"], channelScopedBy: null, drill: { route: "/operations/work-orders", operation: "readWorkOrder", idField: "workOrderId" },
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT w.id, w.operating_company_key AS company, w.work_order_type::text AS dim, NULL AS currency, NULL AS amount, 1 AS qty, w.work_order_number AS label
        FROM eos_ops.work_order_transitions t JOIN eos_ops.work_orders w ON w.tenant_id = t.tenant_id AND w.id = t.work_order_id
       WHERE t.tenant_id = $1 AND w.operating_company_key = ANY($2) AND t.action = 'create' AND t.occurred_at >= $3 AND t.occurred_at < $4
         AND NOT EXISTS (SELECT 1 FROM eos_ops.work_order_quarantine qz WHERE qz.tenant_id = w.tenant_id AND qz.work_order_id = w.id)
       ORDER BY t.occurred_at LIMIT $5`, [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit], "workOrder"),
  },
  {
    id: "service.workOrders.completed", version: 1, domain: "service", name: "Work Orders completed", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "PERIOD",
    description: "Work Orders completed in the period, by type.", formula: "count of work orders with completed_at in the period", periodEvent: "work order completed_at",
    sourceFacts: ["eos_ops.work_orders"], dimension: "work order type", readCapabilities: ["workOrder.record.read"], channelScopedBy: null,
    drill: { route: "/operations/work-orders", operation: "readWorkOrder", idField: "workOrderId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT w.id, w.operating_company_key AS company, w.work_order_type::text AS dim, NULL AS currency, NULL AS amount, 1 AS qty, w.work_order_number AS label
        FROM eos_ops.work_orders w WHERE w.tenant_id = $1 AND w.operating_company_key = ANY($2) AND w.completed_at >= $3 AND w.completed_at < $4
         AND NOT EXISTS (SELECT 1 FROM eos_ops.work_order_quarantine qz WHERE qz.tenant_id = w.tenant_id AND qz.work_order_id = w.id)
       ORDER BY w.completed_at LIMIT $5`, [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit], "workOrder"),
  },
  {
    id: "service.workOrders.open", version: 1, domain: "service", name: "Open Work Orders", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Work Orders not completed, closed or cancelled, by status.", formula: "count of work orders in an open status", periodEvent: null, sourceFacts: ["eos_ops.work_orders"],
    dimension: "status", readCapabilities: ["workOrder.record.read"], channelScopedBy: null, drill: { route: "/operations/work-orders", operation: "readWorkOrder", idField: "workOrderId" },
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT w.id, w.operating_company_key AS company, w.status::text AS dim, NULL AS currency, NULL AS amount, 1 AS qty, w.work_order_number AS label
        FROM eos_ops.work_orders w WHERE w.tenant_id = $1 AND w.operating_company_key = ANY($2) AND w.status::text NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')
         AND NOT EXISTS (SELECT 1 FROM eos_ops.work_order_quarantine qz WHERE qz.tenant_id = w.tenant_id AND qz.work_order_id = w.id)
       ORDER BY w.created_at LIMIT $3`, [s.tenantId, s.companyKeys, s.limit], "workOrder"),
  },
  {
    id: "service.technician.workload", version: 1, domain: "service", name: "Technician workload", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Open Work Orders currently assigned, by technician (governed assignment, Employee against Employee).",
    formula: "count of open work orders with a current assignment, by assignee", periodEvent: null, sourceFacts: ["eos_ops.work_order_assignments", "eos_ops.work_orders"],
    dimension: "technician", readCapabilities: ["workOrder.record.read"], channelScopedBy: null, drill: { route: "/operations/work-orders", operation: "readWorkOrder", idField: "workOrderId" },
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT w.id, w.operating_company_key AS company, coalesce(e.display_name, a.assignee_employee_id) AS dim, NULL AS currency, NULL AS amount, 1 AS qty, w.work_order_number AS label
        FROM eos_ops.work_order_assignments a JOIN eos_ops.work_orders w ON w.tenant_id = a.tenant_id AND w.id = a.work_order_id
        LEFT JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.assignee_employee_id
       WHERE a.tenant_id = $1 AND w.operating_company_key = ANY($2) AND a.effective_to IS NULL AND w.status::text NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')
       ORDER BY 6 LIMIT $3`, [s.tenantId, s.companyKeys, s.limit], "workOrder"),
  },
  {
    id: "service.parts.used", version: 1, domain: "service", name: "Parts used on Work Orders", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "QUANTITY", timeBasis: "PERIOD",
    description: "Part quantities recorded as used on Work Orders in the period, by part.", formula: "Σ applied_delta of PART_USAGE execution records in the period",
    periodEvent: "execution record recorded_at", sourceFacts: ["eos_ops.work_order_execution_records"], dimension: "part", readCapabilities: ["workOrder.record.read"], channelScopedBy: null,
    drill: { route: "/operations/work-orders", operation: "readWorkOrder", idField: "workOrderId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT r.work_order_id AS id, w.operating_company_key AS company, r.part_id AS dim, NULL AS currency, NULL AS amount, abs(coalesce(r.applied_delta, 0)) AS qty, w.work_order_number AS label
        FROM eos_ops.work_order_execution_records r JOIN eos_ops.work_orders w ON w.tenant_id = r.tenant_id AND w.id = r.work_order_id
       WHERE r.tenant_id = $1 AND w.operating_company_key = ANY($2) AND r.kind = 'PART_USAGE' AND r.recorded_at >= $3 AND r.recorded_at < $4 ORDER BY r.recorded_at LIMIT $5`,
    [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit], "workOrder"),
  },

  // ════════════════════ PARTS / PURCHASING ════════════════════
  {
    id: "purchasing.orders.placed", version: 1, domain: "purchasing", name: "Purchase orders placed", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "PERIOD",
    description: "Purchase orders by ordered date, at their recorded price; an unpriced order makes the figure PARTIAL (MISSING_PRICE).",
    formula: "Σ ordered_quantity × unit_price_minor of purchase orders with ordered_date in the period, per currency", periodEvent: "purchase order ordered_date",
    sourceFacts: ["eos_ops.purchase_orders"], dimension: "supplier", readCapabilities: ["reorder.request.read", "reorder.purchaseOrder.read"], channelScopedBy: null, reach: "REORDER_QUEUE",
    drill: { route: "/operations/inventory", operation: "readReorderRequest", idField: "reorderRequestId" },
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT p.id, p.operating_company_key AS company, coalesce(p.supplier_name, p.supplier_operating_company_id, p.supplier_id) AS dim, coalesce(p.currency, 'USD') AS currency,
            CASE WHEN p.unit_price_minor IS NULL THEN NULL ELSE p.ordered_quantity::bigint * p.unit_price_minor END AS amount, 1 AS qty, p.external_po_number AS label
        FROM eos_ops.purchase_orders p
        JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = p.tenant_id AND k.operating_company_key = p.operating_company_key AND k.status = 'ACTIVE'
       WHERE p.tenant_id = $1 AND p.operating_company_key = ANY($2)
         AND p.ordered_date >= eos_policy.operating_company_business_date(p.tenant_id, k.operating_company_id, $3::timestamptz)
         AND p.ordered_date <= eos_policy.operating_company_business_date(p.tenant_id, k.operating_company_id, $4::timestamptz - interval '1 millisecond')
       ORDER BY p.ordered_date LIMIT $5`, [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit], "purchaseOrder"),
  },
  {
    id: "purchasing.receipts.received", version: 1, domain: "purchasing", name: "Receipts", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "PERIOD",
    description: "Receiving orders received in the period, by status (a corrected or voided receipt keeps its history).", formula: "count of receiving orders with received_at in the period",
    periodEvent: "receiving order received_at", sourceFacts: ["eos_ops.receiving_orders"], dimension: "receipt status", readCapabilities: ["receivingOrder.record.read"],
    channelScopedBy: null, reach: "WAREHOUSE", drill: { route: "/operations/inventory", operation: "readReceipt", idField: "receiptId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT r.id, r.operating_company_key AS company, r.status::text AS dim, NULL AS currency, NULL AS amount, 1 AS qty, r.receiving_order_number AS label
        FROM eos_ops.receiving_orders r WHERE r.tenant_id = $1 AND r.operating_company_key = ANY($2) AND r.received_at >= $3 AND r.received_at < $4
         AND ${GOVERNING_WAREHOUSE("r.tenant_id", "r.receiving_location_type", "r.receiving_location_id")} = ANY($6) ORDER BY r.received_at LIMIT $5`,
    [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit, s.warehouses], "receivingOrder"),
  },
  {
    id: "purchasing.reorders.open", version: 1, domain: "purchasing", name: "Open reorder requests", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Reorder requests still in progress, by status.", formula: "count of reorder requests not RECEIVED / CANCELLED / REJECTED", periodEvent: null,
    sourceFacts: ["eos_ops.reorder_requests"], dimension: "status", readCapabilities: ["reorder.request.read", "reorder.purchaseOrder.read"], channelScopedBy: null, reach: "REORDER_QUEUE",
    drill: { route: "/operations/inventory", operation: "readReorderRequest", idField: "reorderRequestId" },
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT r.id, r.operating_company_key AS company, r.status::text AS dim, NULL AS currency, NULL AS amount, 1 AS qty, r.reorder_request_number AS label
        FROM eos_ops.reorder_requests r WHERE r.tenant_id = $1 AND r.operating_company_key = ANY($2) AND r.status::text NOT IN ('RECEIVED', 'CANCELLED', 'REJECTED', 'VOIDED')
       ORDER BY r.created_at LIMIT $3`, [s.tenantId, s.companyKeys, s.limit], "reorderRequest"),
  },

  // ════════════════════ INVENTORY / WAREHOUSE ════════════════════
  {
    id: "inventory.onHand.quantity", version: 1, domain: "inventory", name: "On-hand quantity", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "QUANTITY", timeBasis: "POINT_IN_TIME",
    description: "Units on hand from the inventory ledger, by owning company and location type (warehouse / bin / truck). No valuation basis is invented.",
    formula: "Σ quantity_delta of inventory movements at WAREHOUSE / BIN / MOBILE locations, by part and location", periodEvent: null, sourceFacts: ["eos_ops.inventory_movements"],
    dimension: "location type", readCapabilities: ["inventory.transaction.read"], channelScopedBy: null, reach: "WAREHOUSE",
    drill: { route: "/operations/inventory", operation: "readInventoryOnHand", idField: "partIds", asList: true }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT m.part_id AS id, m.operating_company_key AS company, m.location_type::text AS dim, NULL AS currency, NULL AS amount,
            sum(m.quantity_delta)::int AS qty, m.part_id AS label
        FROM eos_ops.inventory_movements m WHERE m.tenant_id = $1 AND m.operating_company_key = ANY($2) AND m.location_type::text IN ('WAREHOUSE', 'BIN', 'MOBILE')
         AND ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} = ANY($4)
       GROUP BY m.part_id, m.location_id, m.location_type, m.operating_company_key HAVING sum(m.quantity_delta) <> 0 ORDER BY 6 DESC LIMIT $3`,
    [s.tenantId, s.companyKeys, s.limit, s.warehouses], "stockLocation"),
  },
  {
    id: "inventory.transfers.inFlight", version: 1, domain: "inventory", name: "Transfers in flight", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Transfer orders not yet received or cancelled, by status.", formula: "count of transfer orders in an open status", periodEvent: null, sourceFacts: ["eos_ops.transfer_orders"],
    dimension: "status", readCapabilities: ["warehouse.transferOrder.read"], channelScopedBy: null, reach: "WAREHOUSE", drill: null, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT t.id, t.source_operating_company_key AS company, t.status::text AS dim, NULL AS currency, NULL AS amount, t.quantity AS qty, t.transfer_order_number AS label
        FROM eos_ops.transfer_orders t WHERE t.tenant_id = $1 AND t.source_operating_company_key = ANY($2) AND t.status::text NOT IN ('CANCELLED', 'COMPLETED')
         AND (${GOVERNING_WAREHOUSE("t.tenant_id", "t.origin_location_type", "t.origin_location_id")} = ANY($4) OR ${GOVERNING_WAREHOUSE("t.tenant_id", "t.destination_location_type", "t.destination_location_id")} = ANY($4))
       ORDER BY t.created_at LIMIT $3`, [s.tenantId, s.companyKeys, s.limit, s.warehouses], "transferOrder"),
  },
  {
    id: "inventory.cycleCount.variances", version: 1, domain: "inventory", name: "Cycle-count differences", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "QUANTITY", timeBasis: "PERIOD",
    description: "Counted lines whose count differed from the expected quantity, submitted in the period (absolute units), by review decision.",
    formula: "Σ |variance| of cycle count lines with variance <> 0 submitted in the period", periodEvent: "cycle count line submitted_at",
    sourceFacts: ["eos_ops.cycle_count_lines", "eos_ops.cycle_count_sheets"], dimension: "review decision",
    readCapabilities: ["inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.reconcile", "inventory.cycleCount.close"], channelScopedBy: null, reach: "WAREHOUSE", drill: null,
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT l.id, sh.operating_company_key AS company, coalesce(l.review_decision::text, 'PENDING_REVIEW') AS dim, NULL AS currency, NULL AS amount, abs(l.variance) AS qty, l.part_id AS label
        FROM eos_ops.cycle_count_lines l JOIN eos_ops.cycle_count_sheets sh ON sh.tenant_id = l.tenant_id AND sh.id = l.sheet_id
       WHERE l.tenant_id = $1 AND sh.operating_company_key = ANY($2) AND coalesce(l.variance, 0) <> 0 AND l.submitted_at >= $3 AND l.submitted_at < $4
         AND ${GOVERNING_WAREHOUSE("sh.tenant_id", "sh.location_type", "sh.location_id")} = ANY($6) ORDER BY l.submitted_at LIMIT $5`,
    [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit, s.warehouses], "cycleCountLine"),
  },
  {
    id: "inventory.serialized.installed", version: 1, domain: "inventory", name: "Serialized equipment installed", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Serialized units installed at customer sites (custody EQUIPMENT), by part.", formula: "count of serialized custody rows INSTALLED", periodEvent: null,
    sourceFacts: ["eos_ops.serialized_custody", "eos_ops.equipment"], dimension: "part", readCapabilities: ["equipment.record.read"], channelScopedBy: null, drill: null,
    availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT c.id, c.operating_company_key AS company, c.part_id AS dim, NULL AS currency, NULL AS amount, 1 AS qty, c.serial_number AS label
        FROM eos_ops.serialized_custody c WHERE c.tenant_id = $1 AND c.operating_company_key = ANY($2) AND c.status = 'INSTALLED' ORDER BY c.part_id, c.serial_number LIMIT $3`,
    [s.tenantId, s.companyKeys, s.limit], "serializedUnit"),
  },

  // ════════════════════ RENTAL ════════════════════
  {
    id: "rental.fleet.units", version: 1, domain: "rental", name: "Rental fleet", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "POINT_IN_TIME",
    description: "Fleet units by availability (available / reserved / on rent / service hold / return pending / inspection / unavailable).",
    formula: "count of fleet units, by availability", periodEvent: null, sourceFacts: ["eos_rental.fleet_units"], dimension: "availability", readCapabilities: ["rental.agreement.read"],
    channelScopedBy: null, drill: { route: "/operations/rental", operation: "readFleetUnit", idField: "fleetUnitId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT f.id, f.owner_operating_company_key AS company, f.availability AS dim, NULL AS currency, NULL AS amount, 1 AS qty, f.display_name AS label
        FROM eos_rental.fleet_units f WHERE f.tenant_id = $1 AND f.owner_operating_company_key = ANY($2) ORDER BY f.display_name LIMIT $3`, [s.tenantId, s.companyKeys, s.limit], "fleetUnit"),
  },
  {
    id: "rental.utilization.timeWeighted", version: 1, domain: "rental", name: "Rental utilization", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "RATIO", timeBasis: "PERIOD",
    description: "Share of fleet unit-days spent at customers (ON_RENT or RETURN_PENDING) over unit-days in the fleet during the period, from the fleet event log.",
    formula: "Σ unit-days in ON_RENT / RETURN_PENDING ÷ Σ unit-days in the fleet, within the period", periodEvent: "fleet unit availability events",
    sourceFacts: ["eos_rental.fleet_unit_events"], dimension: "availability", readCapabilities: ["rental.agreement.read"], channelScopedBy: null,
    drill: { route: "/operations/rental", operation: "readFleetUnit", idField: "fleetUnitId" }, availability: "AVAILABLE", absenceReason: null,
    ratioNumerator: ["ON_RENT", "RETURN_PENDING"], rows: async (db, s) => fleetDays(db, s),
  },
  {
    id: "rental.downtime.unitDays", version: 1, domain: "rental", name: "Rental downtime", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "UNIT_DAYS", timeBasis: "PERIOD",
    description: "Unit-days in SERVICE_HOLD, INSPECTION or UNAVAILABLE during the period.", formula: "Σ unit-days in SERVICE_HOLD / INSPECTION / UNAVAILABLE within the period",
    periodEvent: "fleet unit availability events", sourceFacts: ["eos_rental.fleet_unit_events"], dimension: "availability", readCapabilities: ["rental.agreement.read"], channelScopedBy: null,
    drill: { route: "/operations/rental", operation: "readFleetUnit", idField: "fleetUnitId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => (await fleetDays(db, s)).filter((r) => ["SERVICE_HOLD", "INSPECTION", "UNAVAILABLE"].includes(String(r.dim))),
  },
  {
    id: "rental.returns.received", version: 1, domain: "rental", name: "Rental returns received", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "COUNT", timeBasis: "PERIOD",
    description: "Units received back into company custody in the period.", formula: "count of RETURN_RECEIVED fleet events in the period", periodEvent: "RETURN_RECEIVED event",
    sourceFacts: ["eos_rental.fleet_unit_events"], dimension: null, readCapabilities: ["rental.agreement.read"], channelScopedBy: null,
    drill: { route: "/operations/rental", operation: "readFleetUnit", idField: "fleetUnitId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT e.fleet_unit_id AS id, e.owner_operating_company_key AS company, NULL AS dim, NULL AS currency, NULL AS amount, 1 AS qty, f.display_name AS label
        FROM eos_rental.fleet_unit_events e JOIN eos_rental.fleet_units f ON f.id = e.fleet_unit_id
       WHERE e.tenant_id = $1 AND e.owner_operating_company_key = ANY($2) AND e.event_type = 'RETURN_RECEIVED' AND e.occurred_at >= $3 AND e.occurred_at < $4 ORDER BY e.occurred_at LIMIT $5`,
    [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit], "fleetUnit"),
  },
  {
    id: "rental.charges.billed", version: 1, domain: "rental", name: "Rental charges billed", basis: BASIS.EOS_OPERATIONAL_ACTUAL, unit: "MONEY", timeBasis: "PERIOD",
    description: "READY rental billing packages prepared in the period (rent, delivery, install; tax included as recorded).",
    formula: "Σ total_minor of READY RENTAL_CHARGE billing packages prepared in the period, per currency", periodEvent: "billing package prepared_at",
    sourceFacts: ["eos_finance.billing_packages", "eos_rental.rental_charges"], dimension: "charge kind", readCapabilities: ["rental.agreement.read"], channelScopedBy: null,
    drill: { route: "/operations/rental", operation: "readRentalAgreement", idField: "agreementId" }, availability: "AVAILABLE", absenceReason: null,
    rows: async (db, s) => run(db, `SELECT p.rental_agreement_id AS id, p.operating_company_key AS company, c.kind AS dim, p.currency, p.total_minor AS amount, 1 AS qty, g.rental_agreement_number AS label
        FROM eos_finance.billing_packages p JOIN eos_rental.rental_charges c ON c.id = p.rental_charge_id JOIN eos_rental.rental_agreements g ON g.id = p.rental_agreement_id
       WHERE p.tenant_id = $1 AND p.operating_company_key = ANY($2) AND p.source_kind = 'RENTAL_CHARGE' AND p.status = 'READY' AND p.prepared_at >= $3 AND p.prepared_at < $4
       ORDER BY p.prepared_at LIMIT $5`, [s.tenantId, s.companyKeys, s.start, s.endExclusive, s.limit], "rentalAgreement"),
  },

  // ════════════════════ PLAN / ACCOUNTING -- ABSENT, with their reasons (never a zero) ════════════════════
  {
    id: "plan.targetBudget", version: 1, domain: "plan", name: "Targets and budgets", basis: BASIS.TARGET_BUDGET, unit: "MONEY", timeBasis: "PERIOD",
    description: "Plan figures to compare actuals against.", formula: "—", periodEvent: null, sourceFacts: [], dimension: null,
    readCapabilities: ["finance.payment.read", "salesOrder.read", "workOrder.record.read", "reorder.purchaseOrder.read", "inventory.transaction.read", "rental.agreement.read"],
    channelScopedBy: null, drill: null, availability: "ABSENT",
    absenceReason: "No governed target or budget data exists: the FIN-003 plan-vs-actual core is dormant (no storage, capability or surface). Variance against plan is therefore not shown.",
    rows: null,
  },
  {
    id: "plan.forecast", version: 1, domain: "plan", name: "Forecast", basis: BASIS.FORECAST, unit: "MONEY", timeBasis: "PERIOD", description: "Forward-looking projections.",
    formula: "—", periodEvent: null, sourceFacts: [], dimension: null,
    readCapabilities: ["finance.payment.read", "salesOrder.read", "workOrder.record.read", "reorder.purchaseOrder.read", "inventory.transaction.read", "rental.agreement.read"],
    channelScopedBy: null, drill: null, availability: "ABSENT",
    absenceReason: "No governed forecast exists: the FIN-005 forecasting core is dormant and its methodology is not ruled. Opportunity expected value is a currency-less estimate (FIN-002) and is not a forecast.",
    rows: null,
  },
  {
    id: "finance.margin.gross", version: 1, domain: "plan", name: "Gross margin", basis: BASIS.EOS_OPERATIONAL_ESTIMATE, unit: "MONEY", timeBasis: "PERIOD",
    description: "Selling price less cost of what was sold.", formula: "—", periodEvent: null, sourceFacts: [], dimension: null,
    readCapabilities: ["finance.payment.read"], channelScopedBy: null, drill: null, availability: "STRUCTURALLY_UNKNOWN",
    absenceReason: "Cost of goods sold is structurally unknown (FIN-BLOCK-003): no governed cost-relief basis, service labor rates or rental depreciation exist, and EOS invents no allocation.",
    rows: null,
  },
  {
    id: "accounting.actual", version: 1, domain: "plan", name: "Accounting actuals", basis: BASIS.ACCOUNTING_ACTUAL, unit: "MONEY", timeBasis: "PERIOD",
    description: "Figures confirmed by the accounting system of record.", formula: "—", periodEvent: null, sourceFacts: [], dimension: null,
    readCapabilities: ["finance.payment.read"], channelScopedBy: null, drill: null, availability: "ABSENT",
    absenceReason: "EOS is the operational subledger, not the GL (#145). No accounting provider is connected, so no accounting actual exists; EOS operational actuals are never relabelled as accounting truth.",
    rows: null,
  },
]);

/** Unit-days per availability inside [start, end) for each fleet unit, from the append-only event log. */
async function fleetDays(db: Queryable, s: MeasureScope): Promise<MeasureRow[]> {
  if (!s.start || !s.endExclusive) return [];
  const { rows } = await db.query(
    `SELECT e.fleet_unit_id, e.to_availability, e.occurred_at, e.owner_operating_company_key, f.display_name
       FROM eos_rental.fleet_unit_events e JOIN eos_rental.fleet_units f ON f.id = e.fleet_unit_id
      WHERE e.tenant_id = $1 AND e.owner_operating_company_key = ANY($2) AND e.occurred_at < $3 ORDER BY e.fleet_unit_id, e.occurred_at, e.id`,
    [s.tenantId, s.companyKeys, s.endExclusive]);
  const start = s.start.getTime(), end = Math.min(s.endExclusive.getTime(), Date.now());
  const out: MeasureRow[] = [];
  const byUnit = new Map<string, Record<string, any>[]>();
  for (const r of rows) byUnit.set(String(r.fleet_unit_id), [...(byUnit.get(String(r.fleet_unit_id)) ?? []), r]);
  for (const [unit, evs] of byUnit) {
    const acc = new Map<string, number>();
    for (let i = 0; i < evs.length; i++) {
      const from = Math.max(new Date(evs[i].occurred_at).getTime(), start);
      const to = Math.min(i + 1 < evs.length ? new Date(evs[i + 1].occurred_at).getTime() : end, end);
      if (to > from) acc.set(String(evs[i].to_availability), (acc.get(String(evs[i].to_availability)) ?? 0) + (to - from) / 86_400_000);
    }
    for (const [state, days] of acc) {
      out.push({ company: String(evs[0].owner_operating_company_key), dim: state, currency: null, amount: null, qty: Math.round(days * 100) / 100,
        recordKind: "fleetUnit", recordId: unit, label: evs[0].display_name ?? null });
    }
  }
  return out.slice(0, s.limit);
}

export const measureById = (id: string): MeasureDefinition | undefined => MEASURES.find((m) => m.id === id);
