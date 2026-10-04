// MY WORK + SITE-WIDE SEARCH (Final EOS Application Assembly, DECISIONS #209).
//
// The employee's landing answers -- what needs my attention, what is assigned to me, what I own and am accountable for, which
// exceptions require action, what changed -- composed from the EXISTING governed reads, in-process, with their own authority:
//
//   assigned work        listMyAssignedWorkOrders (the assignment-scoped technician read)
//   assigned reorders    readMyAssignedReorders (own reach)
//   reorder queue        readReorderQueue (REORDER_QUEUE reach)
//   dispatch queue       listWorkOrders (workOrder.record.read) -- shown to holders of a scheduling / dispatch capability
//   owned / accountable  the Commercial records whose OWNER / ACCOUNTABLE PERSON is the caller's Employee, decided on each
//                        family's read (flat, or the caller's salesChannel-scoped holdings) -- OWNER, ACCOUNTABLE and ASSIGNEE
//                        stay three different answers, never collapsed
//   attention / insight  the frozen Analysis engine for the persona's area (exceptions, insights, headline measures)
//   rental               readRentalWorkspace (rental.agreement.read)
//   transfers            listTransferOrders (warehouse / truck scope)
//
// THE PERSONA (the caller's current Job Role) chooses the LAYOUT only -- which sections, in which order, which Analysis area.
// It grants NOTHING: every section is decided by its own read, and a section the caller cannot read says so (NOT_AUTHORIZED)
// instead of disappearing silently or being widened. Read-only. No Firebase, no AI.
import type { Pool, PoolClient } from "pg";
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import { EOS_WORK_ORDER_OPERATIONS } from "../eosOps/workOrderOperations";
import { queueReachKeys, readMyAssignedReorders, readReorderQueue } from "../eosOps/reorderLifecycleCommands";
import { listTransferOrders } from "../eosOps/partsReads";
import { postgresPrincipalDimensionReader } from "../eosOps/contextualAuthorization";
import { admittedScopeValues } from "../adminPolicy/assignmentScopeRuntime";
import { readAnalysisCatalog, readAnalysisWorkspace, type AnalysisArea } from "../eosAnalysis/analysis";
import { readRentalWorkspace } from "../eosRental/rental";

type Queryable = Pick<PoolClient, "query">;

export class MyWorkError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "MyWorkError";
  }
}

// ════════════════════ the persona layouts (layout only -- authority is per section) ════════════════════

type SectionKey = "attention" | "assignedWork" | "dispatchQueue" | "assignedReorders" | "reorderQueue" | "transfers" | "rental"
  | "ownedRecords" | "accountableRecords" | "insights" | "measures" | "analysisCatalog" | "administration";

interface PersonaLayout { readonly label: string; readonly analysisArea: AnalysisArea | null; readonly sections: readonly SectionKey[] }

export const PERSONA_LAYOUTS: Readonly<Record<string, PersonaLayout>> = Object.freeze({
  "owner-executive": { label: "Owner / Executive", analysisArea: "executive", sections: ["attention", "insights", "measures", "rental", "accountableRecords", "ownedRecords"] },
  "general-manager": { label: "General Manager", analysisArea: "executive", sections: ["attention", "insights", "measures", "dispatchQueue", "rental", "accountableRecords", "ownedRecords"] },
  "office-manager": { label: "Office Manager", analysisArea: "executive", sections: ["attention", "rental", "measures", "assignedWork", "ownedRecords"] },
  "office-administration": { label: "Office / Administration", analysisArea: null, sections: ["administration", "assignedWork", "ownedRecords"] },
  "service-manager": { label: "Service Manager", analysisArea: "service", sections: ["attention", "measures", "dispatchQueue", "rental", "insights", "assignedWork"] },
  "service-coordinator-dispatcher": { label: "Dispatcher", analysisArea: "service", sections: ["dispatchQueue", "attention", "rental", "assignedWork", "measures"] },
  "service-technician": { label: "Technician", analysisArea: null, sections: ["assignedWork", "assignedReorders"] },
  "parts-associate": { label: "Parts Associate", analysisArea: "purchasing", sections: ["assignedReorders", "attention", "measures"] },
  "parts-manager": { label: "Parts Manager", analysisArea: "purchasing", sections: ["reorderQueue", "attention", "measures", "assignedReorders", "insights"] },
  "warehouse-associate": { label: "Warehouse Associate", analysisArea: "warehouse", sections: ["transfers", "attention", "assignedReorders", "measures"] },
  "warehouse-manager": { label: "Warehouse Manager", analysisArea: "warehouse", sections: ["attention", "transfers", "rental", "measures", "insights"] },
  "retail-sales": { label: "Retail Sales", analysisArea: "salesRetail", sections: ["ownedRecords", "accountableRecords", "attention", "measures", "insights"] },
  "national-accounts-sales": { label: "National Accounts Sales", analysisArea: "salesNational", sections: ["ownedRecords", "accountableRecords", "attention", "measures", "insights"] },
  "finance-accounting": { label: "Finance / Accounting", analysisArea: "finance", sections: ["attention", "measures", "insights", "rental"] },
  "reporting-analyst": { label: "Reporting Analyst", analysisArea: null, sections: ["analysisCatalog"] },
  "general-employee": { label: "General Employee", analysisArea: null, sections: ["assignedWork", "ownedRecords"] },
});

const SECTION_TITLES: Readonly<Record<SectionKey, string>> = Object.freeze({
  attention: "Needs attention", assignedWork: "Work assigned to me", dispatchQueue: "Work to schedule and dispatch", assignedReorders: "Reorders assigned to me",
  reorderQueue: "Reorder queue", transfers: "Transfers in progress", rental: "Rental", ownedRecords: "Records I own", accountableRecords: "Records I am accountable for",
  insights: "What changed", measures: "Key figures", analysisCatalog: "Governed measures", administration: "Administration attention",
});

// Client destinations for governed records (the app's own routes; a record opens through its own governed read there).
const PATH = Object.freeze({
  workOrder: (id: string) => `/service/work-orders/${id}`,
  opportunity: (id: string) => `/customers/opportunities/${id}`,
  salesOrder: (id: string) => `/customers/opportunities/sales-order/${id}`,
  salesAgreement: (id: string) => `/customers/opportunities/sales-agreement/${id}`,
  account: (id: string) => `/customers/${id}`,
  equipment: (id: string) => `/equipment/${id}`,
  part: (id: string) => `/inventory/parts/${encodeURIComponent(id)}`,
  reorderRequest: () => "/inventory/reorder-queue",
  transferOrder: () => "/inventory/transfers",
  rentalAgreement: () => "/rental",
  fleetUnit: () => "/rental",
  obligation: () => "/financials",
  settlement: () => "/financials",
  employee: (id: string) => `/administration/users/${id}`,
} as Record<string, (id: string) => string>);
export const pathFor = (kind: string, id: string): string | null => (PATH[kind] ? PATH[kind](id) : null);

interface Item { readonly id: string; readonly kind: string; readonly label: string; readonly detail: string | null; readonly status: string | null;
  readonly severity?: string; readonly priority?: string; readonly path: string | null; readonly action?: unknown }
interface Section { readonly key: SectionKey; readonly title: string; readonly status: "READY" | "NOT_AUTHORIZED" | "UNAVAILABLE"; readonly reason: string | null;
  readonly count: number; readonly items: readonly Item[]; readonly summary?: unknown }

const ready = (key: SectionKey, items: Item[], summary?: unknown, count?: number): Section =>
  ({ key, title: SECTION_TITLES[key], status: "READY", reason: null, count: count ?? items.length, items: items.slice(0, 25), ...(summary === undefined ? {} : { summary }) });
const notAuthorized = (key: SectionKey, reason: string): Section => ({ key, title: SECTION_TITLES[key], status: "NOT_AUTHORIZED", reason, count: 0, items: [] });

/** Refusals of the composed read become NOT_AUTHORIZED; anything else is a real fault and propagates. */
async function guarded(key: SectionKey, fn: () => Promise<Section>): Promise<Section> {
  try { return await fn(); } catch (err) {
    const e = err as { category?: string; code?: string; message?: string };
    if (e?.category === "FORBIDDEN" || e?.category === "NOT_ACTIVATED" || /CAPABILITY|SCOPE|NOT_AUTHORIZED|REQUIRED/.test(String(e?.code ?? ""))) {
      return notAuthorized(key, String(e.message ?? e.code ?? "not authorized"));
    }
    throw err;
  }
}

async function callerEmployee(db: Queryable, tenantId: string, principalId: string) {
  const employeeId = await postgresPrincipalDimensionReader(db).linkedEmployeeId(tenantId, principalId);
  if (!employeeId) return { employeeId: null, displayName: null, jobRole: null as null | { id: string; label: string } };
  const { rows } = await db.query(
    `SELECT e.display_name, a.job_role_id, r.display_name AS job_role_label
       FROM eos_workforce.employees e
       LEFT JOIN eos_workforce.employee_job_role_assignments a ON a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.effective_to IS NULL
       LEFT JOIN eos_workforce.job_roles r ON r.tenant_id = a.tenant_id AND r.id = a.job_role_id
      WHERE e.tenant_id = $1 AND e.id = $2 ORDER BY a.effective_from DESC NULLS LAST LIMIT 1`, [tenantId, employeeId]);
  const r = rows[0];
  return { employeeId, displayName: r?.display_name ?? null, jobRole: r?.job_role_id ? { id: String(r.job_role_id), label: String(r.job_role_label ?? r.job_role_id) } : null };
}

// ════════════════════ owner / accountable (three answers, never collapsed) ════════════════════

const COMMERCIAL = [
  { kind: "opportunity", table: "eos_commercial.opportunities", number: "opportunity_number", state: "stage::text", capability: "opportunity.read", channel: "o.sales_channel::text" },
  { kind: "salesAgreement", table: "eos_commercial.sales_agreements", number: "sales_agreement_number", state: "state::text", capability: "salesAgreement.read",
    channel: "(SELECT op.sales_channel::text FROM eos_commercial.opportunities op WHERE op.tenant_id = o.tenant_id AND op.id = o.opportunity_id)" },
  { kind: "salesOrder", table: "eos_commercial.sales_orders", number: "sales_order_number", state: "state::text", capability: "salesOrder.read", channel: "o.sales_channel::text" },
] as const;

async function commercialRecordsFor(db: Queryable, caller: WorkOrderCaller, employeeId: string, column: "owner_employee_id" | "accountable_employee_id", key: SectionKey): Promise<Section> {
  const items: Item[] = [];
  const refusedFamilies: string[] = [];
  for (const f of COMMERCIAL) {
    const flat = caller.actor.capabilities.has(f.capability);
    const channels = flat ? null : admittedScopeValues(caller.operational?.scopedHeld as never, f.capability, "salesChannel");
    if (!flat && (!channels || channels.length === 0)) { refusedFamilies.push(f.kind); continue; }
    const { rows } = await db.query(
      `SELECT o.id, o.${f.number} AS number, o.${f.state} AS state, a.name AS account_name,
              o.owner_employee_id, o.accountable_employee_id, ow.display_name AS owner_name, ac.display_name AS accountable_name
         FROM ${f.table} o LEFT JOIN eos_crm.accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id
         LEFT JOIN eos_workforce.employees ow ON ow.tenant_id = o.tenant_id AND ow.id = o.owner_employee_id
         LEFT JOIN eos_workforce.employees ac ON ac.tenant_id = o.tenant_id AND ac.id = o.accountable_employee_id
        WHERE o.tenant_id = $1 AND o.${column} = $2 AND ($3::text[] IS NULL OR ${f.channel} = ANY($3::text[]))
        ORDER BY o.updated_at DESC LIMIT 25`, [caller.actor.tenantId, employeeId, channels]);
    for (const r of rows) {
      items.push({ id: String(r.id), kind: f.kind, label: String(r.number ?? r.id), detail: r.account_name ?? null, status: r.state ?? null, path: pathFor(f.kind, String(r.id)),
        action: { responsibility: { owner: r.owner_name ?? r.owner_employee_id ?? null, accountable: r.accountable_name ?? r.accountable_employee_id ?? null } } });
    }
  }
  if (refusedFamilies.length === COMMERCIAL.length) return notAuthorized(key, "requires a Commercial read (opportunity / agreement / order)");
  return ready(key, items, refusedFamilies.length ? { notReadable: refusedFamilies } : undefined);
}

// ════════════════════ readMyWork ════════════════════

const DISPATCH_CAPABILITIES = ["workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.ready"];

export async function readMyWork(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {}).filter((k) => !["operatingCompanyId"].includes(k));
  if (extra.length) throw new MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const pool: Pool = deps.pool;
  const actor = caller.actor;
  const me = await callerEmployee(pool, actor.tenantId, actor.principalId);
  const personaKey = me.jobRole && PERSONA_LAYOUTS[me.jobRole.id] ? me.jobRole.id : "general-employee";
  const layout = PERSONA_LAYOUTS[personaKey];
  const company = input.operatingCompanyId ?? (layout.analysisArea === "executive" || layout.analysisArea === "finance" ? "consolidated" : undefined);
  const analysisActor = { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: actor.capabilities, scopedHeld: caller.operational?.scopedHeld };
  let analysis: Awaited<ReturnType<typeof readAnalysisWorkspace>> | null = null;
  let analysisRefusal: string | null = null;
  if (layout.analysisArea) {
    try { analysis = await readAnalysisWorkspace(pool, analysisActor, { area: layout.analysisArea, ...(company ? { operatingCompanyId: company } : {}) }, deps.now); }
    catch (err) { analysisRefusal = String((err as Error).message); }
  }
  const sections: Section[] = [];
  for (const key of layout.sections) {
    sections.push(await guarded(key, async (): Promise<Section> => {
      switch (key) {
        case "attention": {
          if (!analysis) return notAuthorized(key, analysisRefusal ?? "no analysis area for this persona");
          return ready(key, analysis.exceptions.map((x) => ({ id: x.recordId, kind: x.recordKind, label: x.label ?? x.recordId, detail: x.rule, status: x.kind,
            // ONE severity vocabulary on the workspace (ATTENTION / BLOCKING, the AttentionBand's words). An Analysis exception is
            // never "blocking" -- nothing stops -- so it is ATTENTION, and the Analysis rank survives verbatim as `priority`.
            severity: "ATTENTION", priority: x.severity, path: pathFor(x.recordKind, x.recordId), action: x.action })), undefined, analysis.exceptions.length);
        }
        case "insights": {
          if (!analysis) return notAuthorized(key, analysisRefusal ?? "no analysis area for this persona");
          const name = (id: unknown) => analysis!.measures.find((mm) => mm.id === id)?.name ?? String(id);
          return ready(key, analysis.insights.map((i, n) => ({ id: `${String(i.measureId)}-${n}`, kind: String(i.kind), label: name(i.measureId),
            detail: i.kind === "DATA_INCOMPLETE" ? `incomplete (${String(i.finding)})` : i.kind === "LARGEST_DRIVER" ? `largest driver: ${String(i.dimension)}`
              : `${i.kind === "INCREASED_VS_PRIOR" ? "up" : "down"}${i.percent === null || i.percent === undefined ? "" : ` ${Math.abs(Number(i.percent))}%`} vs the prior comparable period`,
            status: null, path: "/analysis" })));
        }
        case "measures": {
          if (!analysis) return notAuthorized(key, analysisRefusal ?? "no analysis area for this persona");
          return ready(key, [], { period: analysis.period, scope: analysis.scope, measures: analysis.measures.map((mm) => ({ id: mm.id, name: mm.name, basis: mm.basis, unit: mm.unit,
            status: mm.status, reason: mm.reason ?? null, value: (mm as Record<string, unknown>).value ?? null, aggregate: (mm as Record<string, unknown>).aggregate ?? null,
            variance: ((mm as Record<string, any>).comparison?.variance) ?? null })) }, analysis.measures.filter((mm) => mm.status === "COMPUTED").length);
        }
        case "assignedWork": {
          const r = await EOS_WORK_ORDER_OPERATIONS.listMyAssignedWorkOrders(deps as never, caller as never, {}) as { items: readonly Record<string, any>[] };
          return ready(key, r.items.map((w) => ({ id: String(w.workOrderId), kind: "workOrder", label: String(w.workOrderNumber ?? w.workOrderId),
            detail: [w.customerName, w.locationName, w.complaint].filter(Boolean).join(" · ") || null, status: String(w.status), path: pathFor("workOrder", String(w.workOrderId)),
            action: { scheduledStart: w.scheduledStart ?? null, equipmentId: w.equipmentId ?? null, workOrderType: w.workOrderType, assignee: w.assigneeDisplayName ?? null } })));
        }
        case "dispatchQueue": {
          if (!DISPATCH_CAPABILITIES.some((c) => actor.capabilities.has(c))) return notAuthorized(key, `requires ${DISPATCH_CAPABILITIES.join(" or ")}`);
          const r = await EOS_WORK_ORDER_OPERATIONS.listWorkOrders(deps as never, caller as never, { statuses: ["CREATED", "READY_TO_DISPATCH", "SCHEDULED"] }) as { items: readonly Record<string, any>[] };
          return ready(key, r.items.map((w) => ({ id: String(w.workOrderId), kind: "workOrder", label: String(w.workOrderNumber ?? w.workOrderId),
            detail: [w.customerName, w.locationName].filter(Boolean).join(" · ") || null, status: String(w.status), path: pathFor("workOrder", String(w.workOrderId)),
            severity: w.status === "CREATED" ? "ATTENTION" : undefined, action: { assignee: w.assigneeDisplayName ?? null, scheduledStart: w.scheduledStart ?? null } })));
        }
        case "assignedReorders": {
          const r = await readMyAssignedReorders({ pool }, actor);
          return ready(key, r.map((x) => ({ id: x.reorderRequestId, kind: "reorderRequest", label: String(x.reorderRequestNumber ?? x.reorderRequestId),
            detail: `${x.partId} × ${x.requestedQty}`, status: x.status, path: pathFor("reorderRequest", x.reorderRequestId) })));
        }
        case "reorderQueue": {
          const r = await readReorderQueue({ pool }, actor, { statuses: ["PENDING_REVIEW", "APPROVED", "READY_FOR_PARTS_MANAGER", "ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS", "ORDERED"] });
          return ready(key, r.map((x) => ({ id: x.reorderRequestId, kind: "reorderRequest", label: String(x.reorderRequestNumber ?? x.reorderRequestId),
            detail: `${x.partId} × ${x.requestedQty}`, status: x.status, severity: x.status === "PENDING_REVIEW" ? "ATTENTION" : undefined, path: pathFor("reorderRequest", x.reorderRequestId) })));
        }
        case "transfers": {
          const r = await listTransferOrders({ pool }, actor, {}) as { items: readonly Record<string, any>[] };
          return ready(key, r.items.filter((t) => !["COMPLETED", "CANCELLED"].includes(String(t.status))).map((t) => ({ id: String(t.transferOrderId ?? t.id),
            kind: "transferOrder", label: String(t.transferOrderNumber ?? t.transferOrderId ?? t.id), detail: `${t.partId ?? ""} × ${t.quantity ?? ""}`, status: String(t.status),
            path: pathFor("transferOrder", String(t.id ?? "")) })));
        }
        case "rental": {
          const ws = await readRentalWorkspace(pool, actor, {});
          const items: Item[] = [
            ...ws.dueBack.map((d) => ({ id: d.agreementId, kind: "rentalAgreement", label: d.number, detail: d.overdue ? `overdue by ${-d.daysUntilDue} day(s)` : `due back in ${d.daysUntilDue} day(s)`,
              status: d.overdue ? "OVERDUE" : "DUE_BACK", severity: "ATTENTION", path: "/rental" })),
            ...ws.billingExceptions.map((b) => ({ id: `${b.kind}-${b.agreementId}`, kind: "rentalAgreement", label: b.number,
              detail: b.kind === "RENTAL_PACKAGE_HELD" ? "charge held" : "equipment out with no current charge", status: b.kind, severity: "ATTENTION", path: "/rental" })),
            ...ws.inspection.map((u) => ({ id: u.id, kind: "fleetUnit", label: u.displayName, detail: "awaiting inspection", status: "INSPECTION", path: "/rental" })),
            ...ws.returnPending.map((u) => ({ id: u.id, kind: "fleetUnit", label: u.displayName, detail: "return pending", status: "RETURN_PENDING", path: "/rental" })),
          ];
          return ready(key, items, { counts: ws.counts, utilization: ws.utilization });
        }
        case "ownedRecords":
        case "accountableRecords": {
          if (!me.employeeId) return notAuthorized(key, "no Employee is linked to this sign-in, so no record can be yours");
          return commercialRecordsFor(pool, caller, me.employeeId, key === "ownedRecords" ? "owner_employee_id" : "accountable_employee_id", key);
        }
        case "analysisCatalog": {
          const c = readAnalysisCatalog(analysisActor);
          return ready(key, c.measures.map((mm) => ({ id: mm.id, kind: "measure", label: mm.name, detail: `${mm.basis}${mm.availability !== "AVAILABLE" ? ` · ${mm.availability}` : ""}`,
            status: mm.visible ? "READABLE" : "NO_UNDERLYING_READ", path: "/analysis" })), { areas: c.areas });
        }
        case "administration": {
          if (!actor.capabilities.has("admin.principalAccess.read") && !actor.capabilities.has("employee.record.read")) {
            return notAuthorized(key, "requires admin.principalAccess.read or employee.record.read");
          }
          const { rows } = await pool.query(
            `SELECT e.id, e.display_name, e.employment_status FROM eos_workforce.employees e
              WHERE e.tenant_id = $1 AND e.employment_status IN ('ACTIVE', 'CONTRACTOR')
                AND NOT EXISTS (SELECT 1 FROM eos_workforce.employee_job_role_assignments a WHERE a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.effective_to IS NULL)
              ORDER BY e.display_name LIMIT 25`, [actor.tenantId]);
          return ready(key, rows.map((r) => ({ id: String(r.id), kind: "employee", label: String(r.display_name ?? r.id), detail: "active employee with no current Job Role",
            status: String(r.employment_status), severity: "ATTENTION", path: pathFor("employee", String(r.id)) })));
        }
      }
    }));
  }
  return Object.freeze({
    me: { principalId: actor.principalId, employeeId: me.employeeId, displayName: me.displayName, jobRole: me.jobRole },
    persona: { key: personaKey, label: layout.label, fromJobRole: personaKey === me.jobRole?.id, analysisArea: layout.analysisArea },
    operatingCompanyId: company ?? null,
    sections,
    aiRequired: false,
  });
}

// ════════════════════ site-wide search ════════════════════

interface SearchKind {
  readonly kind: string; readonly label: string; readonly capabilities: readonly string[]; readonly channelScopedBy?: string; readonly reach?: "REORDER_QUEUE";
  readonly sql: string;   // $1 tenant, $2 pattern, $3 channels (text[] | null), $4 reach keys (text[] | null)
}

const SEARCH_KINDS: readonly SearchKind[] = Object.freeze([
  { kind: "workOrder", label: "Work Order", capabilities: ["workOrder.record.read"],
    sql: `SELECT w.id, w.work_order_number AS label, concat_ws(' · ', a.name, w.status::text) AS detail FROM eos_ops.work_orders w
            LEFT JOIN eos_crm.accounts a ON a.tenant_id = w.tenant_id AND a.id = w.customer_id
           WHERE w.tenant_id = $1 AND (w.work_order_number ILIKE $2 OR a.name ILIKE $2 OR w.complaint ILIKE $2) ORDER BY w.updated_at DESC LIMIT 8` },
  { kind: "opportunity", label: "Opportunity", capabilities: ["opportunity.read"], channelScopedBy: "opportunity.read",
    sql: `SELECT o.id, o.opportunity_number AS label, concat_ws(' · ', a.name, o.sales_channel::text, o.stage::text) AS detail FROM eos_commercial.opportunities o
            LEFT JOIN eos_crm.accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id
           WHERE o.tenant_id = $1 AND (o.opportunity_number ILIKE $2 OR a.name ILIKE $2 OR o.need ILIKE $2) AND ($3::text[] IS NULL OR o.sales_channel::text = ANY($3))
           ORDER BY o.updated_at DESC LIMIT 8` },
  { kind: "salesOrder", label: "Sales Order", capabilities: ["salesOrder.read"], channelScopedBy: "salesOrder.read",
    sql: `SELECT o.id, o.sales_order_number AS label, concat_ws(' · ', a.name, o.sales_channel::text, o.state::text) AS detail FROM eos_commercial.sales_orders o
            LEFT JOIN eos_crm.accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id
           WHERE o.tenant_id = $1 AND (o.sales_order_number ILIKE $2 OR a.name ILIKE $2) AND ($3::text[] IS NULL OR o.sales_channel::text = ANY($3))
           ORDER BY o.updated_at DESC LIMIT 8` },
  { kind: "salesAgreement", label: "Sales Agreement", capabilities: ["salesAgreement.read"], channelScopedBy: "salesAgreement.read",
    sql: `SELECT g.id, g.sales_agreement_number AS label, concat_ws(' · ', a.name, g.state::text) AS detail FROM eos_commercial.sales_agreements g
            LEFT JOIN eos_crm.accounts a ON a.tenant_id = g.tenant_id AND a.id = g.account_id
            LEFT JOIN eos_commercial.opportunities op ON op.tenant_id = g.tenant_id AND op.id = g.opportunity_id
           WHERE g.tenant_id = $1 AND (g.sales_agreement_number ILIKE $2 OR a.name ILIKE $2) AND ($3::text[] IS NULL OR op.sales_channel::text = ANY($3))
           ORDER BY g.updated_at DESC LIMIT 8` },
  { kind: "account", label: "Customer", capabilities: ["customer.record.read"],
    sql: `SELECT a.id, a.name AS label, concat_ws(' · ', a.customer_number, a.status::text) AS detail FROM eos_crm.accounts a
           WHERE a.tenant_id = $1 AND (a.name ILIKE $2 OR a.customer_number ILIKE $2) ORDER BY lower(a.name) LIMIT 8` },
  { kind: "part", label: "Part", capabilities: ["inventory.catalog.read"],
    sql: `SELECT p.id, concat_ws(' — ', p.internal_part_number, p.name) AS label, p.status::text AS detail FROM eos_ops.parts p
           WHERE p.tenant_id = $1 AND (p.id ILIKE $2 OR p.internal_part_number ILIKE $2 OR p.name ILIKE $2) ORDER BY p.internal_part_number LIMIT 8` },
  { kind: "equipment", label: "Equipment", capabilities: ["equipment.record.read"],
    sql: `SELECT e.id, e.name AS label, concat_ws(' · ', e.serial_number, a.name, e.status::text) AS detail FROM eos_ops.equipment e
            LEFT JOIN eos_crm.accounts a ON a.tenant_id = e.tenant_id AND a.id = e.account_id
           WHERE e.tenant_id = $1 AND (e.name ILIKE $2 OR e.serial_number ILIKE $2 OR a.name ILIKE $2) ORDER BY e.updated_at DESC LIMIT 8` },
  { kind: "rentalAgreement", label: "Rental Agreement", capabilities: ["rental.agreement.read"],
    sql: `SELECT g.id, g.rental_agreement_number AS label, concat_ws(' · ', a.name, g.status) AS detail FROM eos_rental.rental_agreements g
            LEFT JOIN eos_crm.accounts a ON a.tenant_id = g.tenant_id AND a.id = g.account_id
           WHERE g.tenant_id = $1 AND (g.rental_agreement_number ILIKE $2 OR a.name ILIKE $2) ORDER BY g.created_at DESC LIMIT 8` },
  { kind: "reorderRequest", label: "Reorder Request", capabilities: ["reorder.request.read"], reach: "REORDER_QUEUE",
    sql: `SELECT r.id, r.reorder_request_number AS label, concat_ws(' · ', r.part_id, r.status::text) AS detail FROM eos_ops.reorder_requests r
           WHERE r.tenant_id = $1 AND (r.reorder_request_number ILIKE $2 OR r.part_id ILIKE $2) AND r.operating_company_key = ANY($4) ORDER BY r.created_at DESC LIMIT 8` },
  { kind: "employee", label: "Employee", capabilities: ["employee.record.read"],
    sql: `SELECT e.id, e.display_name AS label, e.employment_status::text AS detail FROM eos_workforce.employees e
           WHERE e.tenant_id = $1 AND e.display_name ILIKE $2 ORDER BY lower(e.display_name) LIMIT 8` },
]);

/**
 * ONE search across the governed records the caller can already read -- each kind decided on its EXISTING read (Sales narrowed
 * to the caller's sales channels, Reorder to its REORDER_QUEUE reach). A kind the caller cannot read is not searched and is
 * named as such; nothing is widened. Results link to the record's own page, where its own read decides again.
 */
export async function searchEos(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {}).filter((k) => !["query"].includes(k));
  if (extra.length) throw new MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const q = typeof input.query === "string" ? input.query.trim() : "";
  if (q.length < 2 || q.length > 100) throw new MyWorkError("QUERY_INVALID", "INVALID_INPUT", "query is 2 to 100 characters");
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const actor = caller.actor;
  const results: Array<{ kind: string; kindLabel: string; id: string; label: string; detail: string | null; path: string | null }> = [];
  const notSearched: string[] = [];
  let reachKeys: readonly string[] | null = null;
  for (const k of SEARCH_KINDS) {
    const flat = k.capabilities.some((c) => actor.capabilities.has(c));
    const channels = k.channelScopedBy && !flat ? admittedScopeValues(caller.operational?.scopedHeld as never, k.channelScopedBy, "salesChannel") : null;
    if (!flat && (!channels || channels.length === 0)) { notSearched.push(k.kind); continue; }
    let reach: readonly string[] | null = null;
    if (k.reach === "REORDER_QUEUE") {
      const keys: readonly string[] = reachKeys ?? await queueReachKeys(deps.pool, actor);
      reachKeys = keys;
      if (keys.length === 0) { notSearched.push(k.kind); continue; }
      reach = keys;
    }
    const used = Math.max(...[...k.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    const { rows } = await deps.pool.query(k.sql, [actor.tenantId, pattern, channels, reach].slice(0, used));
    for (const r of rows) results.push({ kind: k.kind, kindLabel: k.label, id: String(r.id), label: String(r.label ?? r.id), detail: r.detail ?? null, path: pathFor(k.kind, String(r.id)) });
  }
  const notSearchedLabels = notSearched.map((kind) => SEARCH_KINDS.find((k) => k.kind === kind)?.label ?? kind);
  return Object.freeze({ query: q, results, notSearched, notSearchedLabels });
}
