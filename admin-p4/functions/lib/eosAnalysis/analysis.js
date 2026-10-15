"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEASURES = exports.ANALYSIS_AREAS = exports.AnalysisError = void 0;
exports.readAnalysisCatalog = readAnalysisCatalog;
exports.readAnalysisWorkspace = readAnalysisWorkspace;
exports.readMeasureAnalysis = readMeasureAnalysis;
const assignmentScopeRuntime_1 = require("../adminPolicy/assignmentScopeRuntime");
const reportingPeriod_1 = require("../reportingPeriod/reportingPeriod");
const reportingCalendar_1 = require("../reportingPeriod/reportingCalendar");
const measures_1 = require("./measures");
Object.defineProperty(exports, "MEASURES", { enumerable: true, get: function () { return measures_1.MEASURES; } });
const partsReads_1 = require("../eosOps/partsReads");
const reorderLifecycleCommands_1 = require("../eosOps/reorderLifecycleCommands");
class AnalysisError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "AnalysisError";
    }
}
exports.AnalysisError = AnalysisError;
const refuse = (code, category, message) => {
    throw new AnalysisError(code, category, message);
};
const ROW_LIMIT = 5000;
// ════════════════════ areas (the persona workspaces assemble these) ════════════════════
exports.ANALYSIS_AREAS = Object.freeze({
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
});
async function companyScope(db, tenantId, raw) {
    const { rows } = await db.query(`SELECT c.operating_company_id AS id, k.operating_company_key AS key FROM eos_policy.tenant_operating_companies c
       LEFT JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = c.tenant_id AND k.operating_company_id = c.operating_company_id AND k.status = 'ACTIVE'
      WHERE c.tenant_id = $1 AND c.status = 'ACTIVE' ORDER BY 1`, [tenantId]);
    const all = rows.map((r) => ({ id: String(r.id), key: r.key === null ? null : String(r.key) }));
    const pick = raw === undefined || raw === null || String(raw).toLowerCase() === "consolidated" ? all
        : all.filter((c) => c.id === raw);
    if (pick.length === 0)
        refuse("OPERATING_COMPANY_UNKNOWN", "INVALID_INPUT", "operatingCompanyId is an active operating company, or consolidated");
    const keyToId = new Map();
    for (const c of pick)
        if (c.key)
            keyToId.set(c.key, c.id);
    return { consolidated: pick.length !== 1 || String(raw ?? "").toLowerCase() === "consolidated" || raw === undefined || raw === null,
        companyIds: pick.map((c) => c.id), companyKeys: pick.filter((c) => c.key).map((c) => c.key), keyToId };
}
function resolvePeriod(scope, periodType, comparison, asOf) {
    const type = (periodType ?? "MTD");
    if (!reportingPeriod_1.PERIOD_TYPES.includes(type))
        refuse("PERIOD_TYPE_INVALID", "INVALID_INPUT", `periodType is one of ${reportingPeriod_1.PERIOD_TYPES.join(", ")}`);
    const cal = (0, reportingCalendar_1.resolveSharedReportingCalendar)(scope.companyIds);
    if (cal.state !== "RESOLVED" || !cal.calendar)
        refuse("REPORTING_CALENDAR_UNRESOLVED", "PRECONDITION_FAILED", `the companies in scope share no governed reporting calendar (${cal.state})`);
    const mode = comparison === "NONE" ? "NONE" : "PRIOR_COMPARABLE";
    const r = (0, reportingPeriod_1.resolveReportingPeriod)({ calendar: cal.calendar, periodType: type, asOfMillis: asOf.getTime(), comparisonMode: mode });
    return { start: new Date(r.current.startMillis), endExclusive: new Date(r.current.endExclusiveMillis),
        comparison: r.comparison ? { start: new Date(r.comparison.startMillis), endExclusive: new Date(r.comparison.endExclusiveMillis) } : null,
        metadata: { ...r.metadata, currentFirstDay: r.current.firstDayIso, currentLastDay: r.current.lastDayInclusiveIso,
            comparisonFirstDay: r.comparison?.firstDayIso ?? null, comparisonLastDay: r.comparison?.lastDayInclusiveIso ?? null } };
}
function measureAccess(actor, m, areaChannel) {
    const flat = m.readCapabilities.some((k) => actor.capabilities.has(k));
    if (m.channelScopedBy) {
        const scoped = flat ? null : (0, assignmentScopeRuntime_1.admittedScopeValues)(actor.scopedHeld, m.channelScopedBy, "salesChannel");
        if (!flat && (scoped === null || scoped.length === 0)) {
            return { allowed: false, reason: `requires ${m.readCapabilities.join(" or ")} (or a salesChannel-scoped holding of ${m.channelScopedBy})` };
        }
        let channels = scoped;
        if (areaChannel)
            channels = channels === null ? [areaChannel] : channels.filter((c) => c === areaChannel);
        if (channels !== null && channels.length === 0)
            return { allowed: false, reason: `outside your sales channel scope (${areaChannel})` };
        return { allowed: true, channels };
    }
    return flat ? { allowed: true, channels: null } : { allowed: false, reason: `requires ${m.readCapabilities.join(" or ")}` };
}
/**
 * The measure's source rows for one window, narrowed by EXACTLY the reach its records' own reads apply. Returns null with the
 * reason when the caller's Operational Scope reaches nothing in this scope (the aggregate would otherwise exceed the reads).
 */
async function rowsFor(db, actor, m, scope, channels, start, end, limit) {
    let companyKeys = scope.companyKeys, warehouses = null;
    if (m.reach === "REORDER_QUEUE") {
        const reach = await (0, reorderLifecycleCommands_1.queueReachKeys)(db, actor);
        companyKeys = companyKeys.filter((k) => reach.includes(k));
        if (companyKeys.length === 0)
            return { refused: "requires the REORDER_QUEUE Operational Scope over the company in view" };
    }
    else if (m.reach === "WAREHOUSE") {
        warehouses = await (0, partsReads_1.scopedWarehouseIds)(db, actor);
        if (warehouses.length === 0)
            return { refused: "requires a WAREHOUSE Operational Scope" };
    }
    const companyIds = companyKeys.map((k) => scope.keyToId.get(k)).filter((x) => !!x);
    return { rows: await m.rows(db, { tenantId: actor.tenantId, companyKeys, companyIds: m.reach ? companyIds : scope.companyIds,
            start, endExclusive: end, channels, warehouses, limit }) };
}
function aggregate(m, rows) {
    const money = {};
    let missing = 0, qty = 0;
    for (const r of rows) {
        qty += r.qty;
        if (m.unit === "MONEY") {
            if (r.amount === null) {
                missing += 1;
                continue;
            }
            const cur = r.currency ?? "USD";
            money[cur] = (money[cur] ?? 0n) + BigInt(r.amount);
        }
    }
    let ratio = null;
    if (m.unit === "RATIO") {
        const num = rows.filter((r) => (m.ratioNumerator ?? []).includes(String(r.dim))).reduce((a, r) => a + r.qty, 0);
        ratio = qty > 0 ? Math.round((num / qty) * 10_000) / 10_000 : null;
    }
    return Object.freeze({ count: new Set(rows.map((r) => r.recordId)).size, quantity: Math.round(qty * 100) / 100,
        money: Object.fromEntries(Object.entries(money).map(([c, v]) => [c, v.toString()])), missingAmount: missing, ratio });
}
/** The single headline number of an aggregate, by the measure's unit; null when it is not derivable (never coerced to zero). */
function headline(m, a) {
    if (m.unit === "MONEY") {
        const cs = Object.keys(a.money);
        return { value: cs.length === 1 ? a.money[cs[0]] : null, currencies: cs };
    }
    if (m.unit === "RATIO")
        return { value: a.ratio, currencies: [] };
    if (m.unit === "COUNT")
        return { value: a.count, currencies: [] };
    return { value: a.quantity, currencies: [] };
}
function variance(m, cur, prev) {
    if (!prev)
        return null;
    if (m.unit === "MONEY") {
        const cs = new Set([...Object.keys(cur.money), ...Object.keys(prev.money)]);
        const byCurrency = {};
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
function drivers(m, rows, scope) {
    const group = (keyOf) => {
        const by = new Map();
        for (const r of rows)
            by.set(keyOf(r), [...(by.get(keyOf(r)) ?? []), r]);
        return [...by.entries()].map(([key, rs]) => ({ key, ...aggregate(m, rs) }))
            .sort((x, y) => Number(headline(m, y).value ?? 0) - Number(headline(m, x).value ?? 0) || x.key.localeCompare(y.key));
    };
    return { byCompany: group((r) => scope.keyToId.get(r.company) ?? r.company), byDimension: m.dimension ? group((r) => r.dim ?? "UNSPECIFIED") : [] };
}
function quality(m, a, rows) {
    const notes = [];
    if (a.missingAmount > 0)
        notes.push(`${a.missingAmount} contributing record(s) have no price -- excluded from the money total, never counted as zero`);
    if (m.unit === "MONEY" && Object.keys(a.money).length > 1)
        notes.push("more than one currency -- shown per currency, never summed");
    if (rows.length >= ROW_LIMIT)
        notes.push(`the source exceeded ${ROW_LIMIT} records; the figure covers the first ${ROW_LIMIT}`);
    const state = rows.length >= ROW_LIMIT ? "PARTIAL" : a.missingAmount > 0 ? "MISSING_PRICE" : "COMPLETE";
    return { state, notes };
}
async function computeMeasure(db, actor, m, scope, period, areaChannel, opts) {
    const base = { id: m.id, name: m.name, domain: m.domain, basis: m.basis, unit: m.unit, timeBasis: m.timeBasis, definitionVersion: m.version };
    if (m.availability !== "AVAILABLE")
        return Object.freeze({ ...base, status: m.availability, reason: m.absenceReason ?? "not available" });
    const access = measureAccess(actor, m, areaChannel);
    if (!access.allowed)
        return Object.freeze({ ...base, status: "REFUSED", reason: access.reason });
    const isPeriod = m.timeBasis === "PERIOD";
    const got = await rowsFor(db, actor, m, scope, access.channels, isPeriod ? period.start : null, isPeriod ? period.endExclusive : null, ROW_LIMIT);
    if ("refused" in got)
        return Object.freeze({ ...base, status: "REFUSED", reason: got.refused });
    const rows = got.rows;
    const prevGot = isPeriod && period.comparison ? await rowsFor(db, actor, m, scope, access.channels, period.comparison.start, period.comparison.endExclusive, ROW_LIMIT) : null;
    const prevRows = prevGot && "rows" in prevGot ? prevGot.rows : null;
    const cur = aggregate(m, rows), prev = prevRows ? aggregate(m, prevRows) : null;
    return Object.freeze({
        ...base, status: "COMPUTED",
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
const drillOf = (m, id) => m.drill
    ? { route: m.drill.route, operation: m.drill.operation, input: { [m.drill.idField]: m.drill.asList ? [id] : id } } : null;
const EXCEPTION_RULES = Object.freeze([
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
async function exceptionsFor(db, actor, scope, period, measureIds) {
    const out = [];
    for (const rule of EXCEPTION_RULES) {
        if (!rule.measureId || !measureIds.includes(rule.measureId))
            continue;
        const m = (0, measures_1.measureById)(rule.measureId);
        const access = measureAccess(actor, m, null);
        if (!access.allowed)
            continue; // an exception is never visible without the read of its records
        const got = await rowsFor(db, actor, m, scope, access.channels, m.timeBasis === "PERIOD" ? new Date(0) : null, m.timeBasis === "PERIOD" ? period.endExclusive : null, 200);
        if ("refused" in got)
            continue;
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
async function rentalExceptions(db, actor, scope) {
    if (!actor.capabilities.has("rental.agreement.read"))
        return [];
    const { rows } = await db.query(`SELECT g.id, g.rental_agreement_number AS label, g.operating_company_key AS company, te.expected_end_date,
            eos_policy.operating_company_business_date(g.tenant_id, k.operating_company_id, now()) AS today,
            (SELECT max(c.period_end) FROM eos_rental.rental_charges c WHERE c.agreement_id = g.id AND c.kind = 'PERIOD') AS charged_through
       FROM eos_rental.rental_agreements g
       JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = g.tenant_id AND k.operating_company_key = g.operating_company_key AND k.status = 'ACTIVE'
       JOIN LATERAL (SELECT expected_end_date FROM eos_rental.rental_agreement_terms x WHERE x.agreement_id = g.id ORDER BY version DESC LIMIT 1) te ON TRUE
      WHERE g.tenant_id = $1 AND g.operating_company_key = ANY($2) AND g.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM eos_rental.rental_assignments s WHERE s.agreement_id = g.id AND s.status IN ('DEPLOYED', 'RETURN_PENDING'))`, [actor.tenantId, scope.companyKeys]);
    const out = [];
    const drill = (id) => ({ route: "/operations/rental", operation: "readRentalAgreement", input: { agreementId: id } });
    for (const r of rows) {
        const company = scope.keyToId.get(String(r.company)) ?? String(r.company);
        const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
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
function insightsFor(results) {
    const out = [];
    for (const r of results) {
        if (r.status !== "COMPUTED")
            continue;
        const q = r.quality;
        if (q.state !== "COMPLETE")
            out.push({ kind: "DATA_INCOMPLETE", measureId: r.id, finding: q.state, detail: q.notes });
        const v = r.comparison?.variance;
        if (v && r.unit !== "MONEY" && typeof v.delta === "number" && v.delta !== 0) {
            out.push({ kind: v.delta > 0 ? "INCREASED_VS_PRIOR" : "DECREASED_VS_PRIOR", measureId: r.id, current: v.current, comparison: v.comparison, delta: v.delta, percent: v.percent });
        }
        if (v && r.unit === "MONEY") {
            for (const [c, x] of Object.entries(v.byCurrency)) {
                if (x.delta !== "0")
                    out.push({ kind: BigInt(x.delta) > 0n ? "INCREASED_VS_PRIOR" : "DECREASED_VS_PRIOR", measureId: r.id, currency: c, current: x.current,
                        comparison: x.comparison, delta: x.delta, percent: x.percent });
            }
        }
        const top = r.drivers?.byDimension?.[0];
        if (top && r.drivers.byDimension.length > 1)
            out.push({ kind: "LARGEST_DRIVER", measureId: r.id, dimension: top.key });
    }
    return out;
}
// ════════════════════ operations ════════════════════
function readAnalysisCatalog(actor) {
    return Object.freeze({
        areas: Object.entries(exports.ANALYSIS_AREAS).map(([key, a]) => ({ key, label: a.label, channel: a.channel, measures: [...a.measures],
            available: a.measures.some((id) => { const m = (0, measures_1.measureById)(id); return m.availability === "AVAILABLE" && measureAccess(actor, m, a.channel).allowed; }) })),
        measures: measures_1.MEASURES.map((m) => ({ id: m.id, version: m.version, domain: m.domain, name: m.name, description: m.description, formula: m.formula, basis: m.basis, unit: m.unit,
            timeBasis: m.timeBasis, periodEvent: m.periodEvent, sourceFacts: m.sourceFacts, dimension: m.dimension, readCapabilities: m.readCapabilities, availability: m.availability,
            absenceReason: m.absenceReason, visible: m.availability !== "AVAILABLE" || measureAccess(actor, m, null).allowed })),
        exceptionRules: [...EXCEPTION_RULES.map((r) => ({ kind: r.kind, measureId: r.measureId, severity: r.severity, rule: r.rule, action: r.action })),
            { kind: "RENTAL_OVERDUE_RETURN", measureId: null, severity: "HIGH", rule: "equipment is still out after the agreed expected end", action: { operation: "initiateRentalReturn", capability: "rental.unit.return" } },
            { kind: "RENTAL_DEPLOYED_WITHOUT_CURRENT_CHARGE", measureId: null, severity: "MEDIUM", rule: "equipment is out and no rental period is charged through today", action: { operation: "recordRentalCharge", capability: "rental.charge.record" } }],
        aiRequired: false,
    });
}
async function readAnalysisWorkspace(pool, actor, input, now = () => new Date()) {
    const allowed = ["area", "operatingCompanyId", "periodType", "comparison"];
    const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
    if (extra.length)
        refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    const areaKey = (input.area ?? "executive");
    const area = exports.ANALYSIS_AREAS[areaKey] ?? refuse("AREA_UNKNOWN", "INVALID_INPUT", `area is one of ${Object.keys(exports.ANALYSIS_AREAS).join(", ")}`);
    const scope = await companyScope(pool, actor.tenantId, input.operatingCompanyId);
    const period = resolvePeriod(scope, input.periodType, input.comparison, now());
    const visible = area.measures.map((id) => (0, measures_1.measureById)(id));
    if (!visible.some((m) => m.availability === "AVAILABLE" && measureAccess(actor, m, area.channel).allowed)) {
        refuse("ANALYSIS_AREA_NOT_AUTHORIZED", "FORBIDDEN", `none of the ${area.label} measures is readable with your capabilities`);
    }
    const results = [];
    for (const m of visible)
        results.push(await computeMeasure(pool, actor, m, scope, period, area.channel, { sources: 5 }));
    const exceptions = [...await exceptionsFor(pool, actor, scope, period, area.measures),
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
async function readMeasureAnalysis(pool, actor, input, now = () => new Date()) {
    const allowed = ["measureId", "operatingCompanyId", "periodType", "comparison", "channel"];
    const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
    if (extra.length)
        refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    const m = (0, measures_1.measureById)(String(input.measureId ?? "")) ?? refuse("MEASURE_UNKNOWN", "NOT_FOUND", "no governed measure with that id");
    if (input.channel !== undefined && input.channel !== "RETAIL" && input.channel !== "NATIONAL_ACCOUNTS")
        refuse("CHANNEL_INVALID", "INVALID_INPUT", "channel is RETAIL or NATIONAL_ACCOUNTS");
    const scope = await companyScope(pool, actor.tenantId, input.operatingCompanyId);
    const period = resolvePeriod(scope, input.periodType, input.comparison, now());
    const r = await computeMeasure(pool, actor, m, scope, period, input.channel ?? null, { sources: 200 });
    if (r.status === "REFUSED")
        refuse("MEASURE_NOT_AUTHORIZED", "FORBIDDEN", `this measure ${r.reason}`);
    return Object.freeze({ scope: { operatingCompanyId: scope.consolidated ? "consolidated" : scope.companyIds[0], companies: scope.companyIds }, period: period.metadata, measure: r });
}
//# sourceMappingURL=analysis.js.map