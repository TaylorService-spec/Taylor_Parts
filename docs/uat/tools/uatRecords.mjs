// UAT census -- record-level, search, dashboard, route and unmerged-PR expectation rows.
// Derived from the same governed model as uatModel.mjs plus the Owner rulings cited per row. A ruling is cited by its DECISIONS anchor.
import { PROBES } from "./uatProbes.mjs";
import { EXTRA_ROUTES } from "./uatMaps.mjs";

// Rulings cited in `source`. (All are in docs/DECISIONS.md unless noted.)
export const RULINGS = Object.freeze({
  ADMIN_STANDING: "DECISIONS #223 (Owner 2026-10-09): protected Administrator standing implies ADMIN_ACTION + READ + system-administration Objects + 9 management keys; never business actions",
  COMMERCIAL_EXCL: "DECISIONS #230 (Owner 2026-10-12): commercial cost capabilities excluded from Administrator standing",
  COMPANY_V1: "DECISIONS #235 (Owner 2026-10-15): company authority = home company + OPERATIONAL company-scoped Role + explicit grant (#249)",
  FINANCE_ONLY: "DECISIONS #248: FINANCE_ONLY Roles supply Finance reach only; Finance reach = explicit per-company assignment (eosFinance/financeCompanyAccess.ts)",
  Q1A: "DECISIONS #Q-1a-company (Owner ruling Q1-11, 2026-10-20): capability, then company authority, then channel/ownership; a foreign-company Commercial record is NONEXISTENT; Administrator unrestricted; Owner follows own companies; company-less rule",
  P11_SALES: "P1-1 SALES SURFACES (Owner-approved 2026-10-13): channel-scoped holdings open the three commercial index doors; reads filter to the holding's channels",
  DQ016: "Controller ruling DQ-016 (2026-09-28): Technician Work Order read = workOrder.record.read + RECORD_ASSIGNMENT, no tenant-wide fallback",
  SAE1: "DECISIONS #SAE: the protected Owner is exempt from secondary approval and self-approval separation (Rule 1)",
  SAE2: "DECISIONS #SAE-2: delegated exemption keys approval.selfApproval.exempt*; registered with NO grants; only the protected Owner grants; global scope",
  DWO: "Owner decisions via lane DWO (PR #2200, pending merge): a foreign Work Order is nonexistent; an assigned technician keeps their own Work Order (even with an inactive company) but gains no office or scheduling authority from the assignment; DWO-1 the selling company sees ONLY a read-only service projection of a linked cross-company service Work Order; DWO-2 the Administrator reads Work Orders tenant-wide, mutations unchanged",
  CLC: "Owner decisions via lane CLC (PR #2199, pending merge): Set Operating Company (assignRecordOperatingCompany) is a named-only grant through the normal admin path (capability commercial.recordCompany.assign, registered with no grants); an Agreement inherits its Opportunity's company on assignment",
  OQ06: "Owner decision OQ-06 (2026-10-21), settled by data: the technician's workOrder.record.read RECORD_ASSIGNMENT condition is ACTIVE on nonprod",
  OQ07: "Owner decision OQ-07 (2026-10-21): shared customer Accounts -- readable across Taylor and Ventana with existing Account authorization; never grants the other company's Commercial or Finance records",
  OQ10: "Owner decision OQ-10 (2026-10-21): Retail Sales and National Accounts Sales are distinct Job Roles; a shared Security Role is acceptable only if channel restrictions enforce the separation, proved through search, lists, details and the API",
  BF_PERSONA:"Persona layouts: functions/src/eosExperience/myWork.ts PERSONA_LAYOUTS (layout only; authority is per section)",
});

const ALL = null;
// kind: id, label, family, company, channel, read, write, fixture
export const RECORD_KINDS = Object.freeze([
  // ---- Taylor (nonprod sample data; EXISTENCE UNVERIFIED -- the census holds no record counts)
  { id: "T-ACC", label: "Taylor customer account", family: "account", company: "taylor", read: "customer.record.read", write: "customer.record.update", fixture: "Taylor sample" },
  { id: "T-OPP-R", label: "Taylor RETAIL opportunity", family: "commercial", company: "taylor", channel: "RETAIL", read: "opportunity.read", write: "opportunity.write", fixture: "Taylor sample" },
  { id: "T-OPP-N", label: "Taylor NATIONAL_ACCOUNTS opportunity", family: "commercial", company: "taylor", channel: "NATIONAL_ACCOUNTS", read: "opportunity.read", write: "opportunity.write", fixture: "Taylor sample" },
  { id: "T-AGR-R", label: "Taylor RETAIL sales agreement", family: "commercial", company: "taylor", channel: "RETAIL", read: "salesAgreement.read", write: "salesAgreement.updateDraft", fixture: "Taylor sample" },
  { id: "T-AGR-N", label: "Taylor NATIONAL_ACCOUNTS sales agreement", family: "commercial", company: "taylor", channel: "NATIONAL_ACCOUNTS", read: "salesAgreement.read", write: "salesAgreement.updateDraft", fixture: "Taylor sample" },
  { id: "T-ORD-R", label: "Taylor RETAIL sales order", family: "commercial", company: "taylor", channel: "RETAIL", read: "salesOrder.read", write: "salesOrder.write", fixture: "Taylor sample" },
  { id: "T-ORD-N", label: "Taylor NATIONAL_ACCOUNTS sales order", family: "commercial", company: "taylor", channel: "NATIONAL_ACCOUNTS", read: "salesOrder.read", write: "salesOrder.write", fixture: "Taylor sample" },
  { id: "T-WO-A", label: "Taylor Work Order assigned to the serviceTechnician persona", family: "workOrder", company: "taylor", assignedTo: "serviceTechnician", read: "workOrder.record.read", write: "workOrder.lifecycle.schedule", fixture: "Taylor sample (assignment fixture)" },
  { id: "T-WO-U", label: "Taylor Work Order assigned to nobody (or to another technician)", family: "workOrder", company: "taylor", assignedTo: null, read: "workOrder.record.read", write: "workOrder.lifecycle.schedule", fixture: "Taylor sample" },
  { id: "T-INV", label: "Taylor stock position at a Taylor warehouse", family: "inventory", company: "taylor", read: "inventory.transaction.read", write: "inventory.stock.relocate", fixture: "Taylor sample" },
  { id: "T-REC", label: "Taylor receivable (obligation)", family: "finance", company: "taylor", read: "finance.payment.read", write: "finance.settlement.record", fixture: "Taylor sample (F-1/F-2 fixtures)" },
  // ---- Ventana (SYNTHETIC; created by the fixture script -- docs/uat/05-ventana-fixture-plan.md)
  { id: "V-ACC", label: "Ventana line-of-business customer account", family: "account", company: "ventana", read: "customer.record.read", write: "customer.record.update", fixture: "F-ACC" },
  { id: "V-OPP-R", label: "Ventana RETAIL opportunity", family: "commercial", company: "ventana", channel: "RETAIL", read: "opportunity.read", write: "opportunity.write", fixture: "F-OPP" },
  { id: "V-OPP-N", label: "Ventana NATIONAL_ACCOUNTS opportunity", family: "commercial", company: "ventana", channel: "NATIONAL_ACCOUNTS", read: "opportunity.read", write: "opportunity.write", fixture: "F-OPP-N (lane VFX S51n)" },
  { id: "V-AGR-R", label: "Ventana RETAIL sales agreement", family: "commercial", company: "ventana", channel: "RETAIL", read: "salesAgreement.read", write: "salesAgreement.updateDraft", fixture: "F-AGR" },
  { id: "V-ORD-R", label: "Ventana RETAIL sales order", family: "commercial", company: "ventana", channel: "RETAIL", read: "salesOrder.read", write: "salesOrder.write", fixture: "F-ORD" },
  { id: "V-WO", label: "Ventana Work Order", family: "workOrder", company: "ventana", assignedTo: null, read: "workOrder.record.read", write: "workOrder.lifecycle.schedule", fixture: "F-WO", dependsOn: ["#2200"] },
  { id: "V-INV", label: "Ventana stock position at a Ventana warehouse", family: "inventory", company: "ventana", read: "inventory.transaction.read", write: "inventory.stock.relocate", fixture: "F-INV" },
  { id: "V-REC", label: "Ventana receivable (obligation)", family: "finance", company: "ventana", read: "finance.payment.read", write: "finance.settlement.record", fixture: "EXISTING: 3 Ventana receivables from intercompany (PROTECTED: read-only for UAT); further F-REC rows only if the fixture lane adds them" },
  // ---- Cross-cutting
  { id: "X-OPP-NOCO", label: "Company-less Opportunity created by the generalManager persona (owner and creator: that persona)", family: "companyless", company: null, read: "opportunity.read", write: "opportunity.write", fixture: "F-NOCO (create via generalManager, no operatingCompanyId)" },
  { id: "X-WO-XSVC", label: "Taylor-selling Sales Order whose service Work Order is performed by Ventana (authorized service provider)", family: "xservice", company: "taylor", read: "salesOrder.read", write: null, fixture: "F-XSVC", dependsOn: ["#2200"] },
]);

const has = (p, cap) => p.flatCaps.has(cap);
const scopedHas = (p, cap, scopeType, value) => (p.scopedCaps.get(cap) ?? []).some((s) => s.scopeType === scopeType && (value === undefined || s.scopeValue === value));
const isOwner = (p) => p.globalRoles.includes("owner");
const technicianLike = (p) => p.globalRoles.includes("technician");

function capDecision(p, cap, kind) {
  if (!cap) return { ok: false, why: "no such act" };
  if (has(p, cap)) return { ok: true, why: `flat ${cap}` };
  if (kind.channel && scopedHas(p, cap, "salesChannel", kind.channel)) return { ok: true, why: `scoped ${cap} @salesChannel=${kind.channel}` };
  if (kind.channel && scopedHas(p, cap, "salesChannel")) return { ok: false, why: `scoped ${cap} for another channel only` };
  return { ok: false, why: `${cap} not held` };
}

/** One expectation for (persona, record kind, operation). */
export function recordExpectation(p, kind, op) {
  const mk = (expected, basis, source, extra = {}) => ({ expected, basis, source, ...extra });
  const cap = op === "MUTATE" ? kind.write : kind.read;
  const needsFixtures = kind.id.startsWith("V-") || kind.id.startsWith("X-");
  const dep = kind.dependsOn ? { dependsOn: kind.dependsOn } : {};
  const f = { needsFixtures, ...dep };

  if (kind.family === "companyless") {
    const c = capDecision(p, cap, { channel: null });
    if (!c.ok) return mk("DENY", c.why, RULINGS.Q1A, f);
    if (p.standing) return mk("ALLOW", "protected Administrator: unrestricted Commercial reach incl. company-less", RULINGS.Q1A, f);
    if (isOwner(p)) return mk("ALLOW", "protected Owner additionally sees company-less records", RULINGS.Q1A, f);
    if (p.key === "generalManager") return mk("ALLOW", "creator and owner of the record", RULINGS.Q1A, f);
    return mk("DENY", "company-less: visible only to owner/creator/protected Administrator/protected Owner; others see NONEXISTENT (identical not-found)", RULINGS.Q1A, f);
  }
  if (kind.family === "xservice") {
    const c = capDecision(p, cap, { channel: null });
    const reachTaylor = p.standing || p.companyReach.includes("taylor");
    if (op === "MUTATE") return mk("NOT_APPLICABLE", "the selling company's projection is read-only; no mutation is offered", RULINGS.DWO, f);
    if (!c.ok || !reachTaylor) return mk("DENY", c.ok ? "no Taylor reach" : c.why, RULINGS.Q1A, f);
    return mk("ALLOW", op === "DETAIL" ? "the Sales Order detail shows ONLY a read-only service projection of the linked Ventana Work Order (no Work Order id, history, parts or labour)" : "the Sales Order is listed; the service projection is read-only", RULINGS.DWO, f);
  }
  if (kind.family === "account") {
    const c = capDecision(p, cap, kind);
    if (!c.ok) return mk("DENY", c.why, RULINGS.COMPANY_V1, f);
    if (kind.company === "ventana" && !p.standing && !p.companyReach.includes("ventana")) {
      return mk("ALLOW", `${c.why}; shared customer master: a Ventana-line Account is readable with the existing Account authorization WITHOUT Ventana company authority, and that never exposes Ventana Commercial or Finance records`, RULINGS.OQ07, f);
    }
    return mk("ALLOW", c.why, RULINGS.COMPANY_V1, f);
  }
  if (kind.family === "commercial") {
    const c = capDecision(p, cap, kind);
    if (!c.ok) return mk("DENY", c.why, kind.channel ? RULINGS.P11_SALES : RULINGS.Q1A, f);
    const reaches = p.standing || p.companyReach.includes(kind.company);
    if (!reaches) return mk("DENY", `no ${kind.company} company authority: the record is NONEXISTENT (identical not-found, zero trace)`, RULINGS.Q1A, f);
    return mk("ALLOW", `${c.why}; ${kind.company} reach (${p.standing ? "protected Administrator unrestricted" : p.companyReachWhy.join(",")})`, RULINGS.Q1A, f);
  }
  if (kind.family === "workOrder") {
    const wdep = { ...f, dependsOn: [...new Set([...(kind.dependsOn ?? []), "#2200"])] };
    const c = capDecision(p, cap, kind);
    if (kind.assignedTo === "serviceTechnician" && p.key === "serviceTechnician") {
      if (op === "MUTATE") return mk("DENY", "an assignment gives no office or scheduling authority; workOrder.lifecycle.schedule is not held", RULINGS.DWO, wdep);
      return mk("ALLOW", "own assigned Work Order (workOrder.record.read + RECORD_ASSIGNMENT); kept even with an inactive company", RULINGS.DWO + " ; " + RULINGS.DQ016, wdep);
    }
    const readSources = p.capSource.get("workOrder.record.read") ?? [];
    if (technicianLike(p) && has(p, "workOrder.record.read") && op !== "MUTATE" && readSources.every((r) => r === "technician")) {
      return mk("DENY", "the technician grant of workOrder.record.read carries an ACTIVE RECORD_ASSIGNMENT condition (controller data check 2026-10-21): an unassigned Work Order is refused", RULINGS.OQ06 + " ; " + RULINGS.DQ016, wdep);
    }
    if (!c.ok) return mk("DENY", c.why, RULINGS.COMPANY_V1, wdep);
    if (op !== "MUTATE" && p.standing) return mk("ALLOW", "DWO-2: the Administrator reads Work Orders tenant-wide", RULINGS.DWO, wdep);
    if (!p.companyReach.includes(kind.company)) return mk("DENY", `no ${kind.company} company authority: a foreign Work Order is nonexistent`, RULINGS.DWO, wdep);
    return mk("ALLOW", `${c.why}; ${kind.company} reach`, RULINGS.COMPANY_V1, wdep);
  }
  if (kind.family === "inventory") {
    const c = capDecision(p, cap, kind);
    if (!c.ok) return mk("DENY", c.why, RULINGS.COMPANY_V1, f);
    if (!p.companyReach.includes(kind.company)) return mk("DENY", `no ${kind.company} inventory company authority (inventory follows the governed company list; the Administrator is NOT unrestricted here)`, RULINGS.COMPANY_V1, f);
    if (op === "MUTATE") {
      const ws = p.operationalScopes.filter((s) => s.startsWith("WAREHOUSE:"));
      if (ws.length === 0) return mk("DENY", "no WAREHOUSE operational scope", RULINGS.COMPANY_V1, f);
      return mk("SCOPED", `only warehouses in scope: ${ws.join(", ")}`, RULINGS.COMPANY_V1, f);
    }
    return mk("ALLOW", `${c.why}; ${kind.company} reach`, RULINGS.COMPANY_V1, f);
  }
  if (kind.family === "finance") {
    const c = capDecision(p, cap, kind);
    const heldSomewhere = c.ok || scopedHas(p, cap, "operatingCompany", kind.company);
    if (!heldSomewhere) return mk("DENY", c.why, RULINGS.FINANCE_ONLY, f);
    if (!p.financeReach.includes(kind.company)) return mk("DENY", `no explicit Financials company assignment for ${kind.company} (a flat finance key reaches only the companies it admits)`, RULINGS.FINANCE_ONLY, f);
    return mk("ALLOW", `${cap} held; explicit ${kind.company} Financials assignment`, RULINGS.FINANCE_ONLY, f);
  }
  return mk("UNDETERMINED", "unmodelled family", "-", f);
}

export function buildRecordRows(m) {
  const rows = [];
  for (const p of m.personasAll) for (const k of RECORD_KINDS) for (const op of ["LIST", "DETAIL", "MUTATE"]) {
    if (k.write === null && op === "MUTATE" && k.family !== "xservice") continue;
    let e = recordExpectation(p, k, op);
    if (k.id === "V-REC" && op === "MUTATE" && ["ALLOW", "SCOPED"].includes(e.expected)) {
      e = { ...e, expected: "NOT_APPLICABLE", basis: "the three existing Ventana intercompany receivables are PROTECTED: UAT never mutates them (refusals for personas without the act are still tested)" };
    }
    rows.push({ id: `${p.key}:record:${k.id}:${op}`, persona: p.key, tier: "record-reach", recordKind: k.id, company: k.company ?? "none", op, ...e, fixture: k.fixture });
  }
  return rows;
}

// -------- search (10 governed kinds, myWork.ts SEARCH_KINDS)
export const SEARCH_KINDS = Object.freeze([
  { kind: "workOrder", cap: "workOrder.record.read" }, { kind: "opportunity", cap: "opportunity.read", commercial: true }, { kind: "salesOrder", cap: "salesOrder.read", commercial: true },
  { kind: "salesAgreement", cap: "salesAgreement.read", commercial: true }, { kind: "account", cap: "customer.record.read" }, { kind: "part", cap: "inventory.catalog.read" },
  { kind: "equipment", cap: "equipment.record.read" }, { kind: "rentalAgreement", cap: "rental.agreement.read" }, { kind: "reorderRequest", cap: "reorder.request.read" }, { kind: "employee", cap: "employee.record.read" },
]);
export function buildSearchRows(m) {
  const rows = [];
  for (const p of m.personasAll) for (const s of SEARCH_KINDS) {
    const flat = has(p, s.cap); const sc = scopedHas(p, s.cap, "salesChannel") || scopedHas(p, s.cap, "operatingCompany");
    const expected = flat ? "ALLOW" : sc ? "SCOPED" : "DENY";
    rows.push({ id: `${p.key}:search:${s.kind}`, persona: p.key, tier: "search", object: s.kind, op: "searchEos", capability: s.cap, expected,
      basis: expected === "DENY" ? "kind absent from results (capability not held)" : "results limited to the company/channel the persona reaches (a foreign-company record, and its text, never matches)",
      source: s.commercial ? RULINGS.Q1A : RULINGS.COMPANY_V1, company: "reach-dependent", needsFixtures: false });
  }
  return rows;
}

// -------- dashboards (persona layouts)
export const PERSONA_LAYOUTS = Object.freeze({
  "owner-executive": ["attention", "insights", "measures", "rental", "accountableRecords", "ownedRecords"],
  "general-manager": ["attention", "insights", "measures", "dispatchQueue", "rental", "accountableRecords", "ownedRecords"],
  "office-manager": ["attention", "rental", "measures", "assignedWork", "ownedRecords"],
  "office-administration": ["administration", "assignedWork", "ownedRecords"],
  "service-manager": ["attention", "measures", "dispatchQueue", "rental", "insights", "assignedWork"],
  "service-coordinator-dispatcher": ["dispatchQueue", "attention", "rental", "assignedWork", "measures"],
  "service-technician": ["assignedWork", "assignedReorders"],
  "parts-associate": ["assignedReorders", "attention", "measures"],
  "parts-manager": ["reorderQueue", "attention", "measures", "assignedReorders", "insights"],
  "warehouse-associate": ["transfers", "attention", "assignedReorders", "measures"],
  "warehouse-manager": ["attention", "transfers", "rental", "measures", "insights"],
  "retail-sales": ["ownedRecords", "accountableRecords", "attention", "measures", "insights"],
  "national-accounts-sales": ["ownedRecords", "accountableRecords", "attention", "measures", "insights"],
  "finance-accounting": ["attention", "measures", "insights", "rental"],
  "reporting-analyst": ["analysisCatalog"],
  "general-employee": ["assignedWork", "ownedRecords"],
});
export function buildDashboardRows(m) {
  const rows = [];
  for (const p of m.personasAll) {
    const layoutKey = p.jobRoleId && PERSONA_LAYOUTS[p.jobRoleId] ? p.jobRoleId : "general-employee";
    for (const section of PERSONA_LAYOUTS[layoutKey]) {
      rows.push({ id: `${p.key}:dashboard:${section}`, persona: p.key, tier: "dashboard", object: "(My Dashboard section)", op: `section ${section}`, expected: "PRESENT",
        basis: `layout for job role '${layoutKey}'; each section is decided again on its own read authority, so a layout section may render as 'not authorized' without that being a defect`,
        source: RULINGS.BF_PERSONA, company: "reach-dependent", needsFixtures: false });
    }
  }
  return rows;
}

// -------- analysis measure families (door analysis.workspace; each measure decided on its own read)
export const ANALYSIS_FAMILIES = Object.freeze([
  ["payment", "finance.payment.read"], ["opportunity", "opportunity.read"], ["salesOrder", "salesOrder.read"], ["workOrder", "workOrder.record.read"], ["purchaseOrder", "reorder.purchaseOrder.read"],
  ["reorderRequest", "reorder.request.read"], ["receivingOrder", "receivingOrder.record.read"], ["inventoryTransaction", "inventory.transaction.read"], ["rentalAgreement", "rental.agreement.read"], ["reportCatalog", "reportDefinition.read"],
]);
export function buildAnalysisRows(m) {
  const rows = [];
  for (const p of m.personasAll) for (const [fam, cap] of ANALYSIS_FAMILIES) {
    const flat = has(p, cap); const sc = (p.scopedCaps.get(cap) ?? []).length > 0;
    rows.push({ id: `${p.key}:analysis:${fam}`, persona: p.key, tier: "analysis", object: fam, op: "readMeasureAnalysis", capability: cap, expected: flat ? "ALLOW" : sc ? "SCOPED" : "DENY",
      basis: fam === "payment" ? "finance measures are decided against the explicit Financials company assignment" : "measure family decided on its own read capability and company key", source: "DECISIONS #208 (analysis doors confer no data)", company: "reach-dependent", needsFixtures: false });
  }
  return rows;
}

// -------- direct routes (detail/aux pages mounted outside the nav loop)
export function buildRouteRows(m) {
  const rows = [];
  const gateSurface = { "/customers/:accountId": "crm.accounts", "/customers/opportunities/:opportunityId": "commercial.opportunities", "/customers/opportunities/sales-order/:salesOrderId": "commercial.salesOrders",
    "/customers/opportunities/sales-agreement/:salesAgreementId": "commercial.agreements", "/equipment/:equipmentId": "equipment.register", "/inventory/:partId": "inventory.catalog",
    "/financials/invoices/:invoiceId": "financials.invoices", "/financials/payments/:paymentId": "financials.payments", "/administration/users/:employeeId": "administration.users", "/administration/users/functional-roles": "administration.users" };
  for (const p of m.personasAll) for (const r of EXTRA_ROUTES) {
    const surf = gateSurface[r.path];
    let expected, basis;
    if (r.path === "/my-profile") { expected = "ALLOW"; basis = "self view for any signed-in session"; }
    else if (r.path === "/account/security") { expected = "ALLOW"; basis = "any EOS human-login session; own password/two-step/sessions"; }
    else if (r.path === "/opportunities/sales-order/:salesOrderId") { expected = p.surfaces.includes("commercial.salesOrders") ? "ALLOW" : "DENY"; basis = "redirect to the canonical Sales Order route, then salesOrder.read decides"; }
    else if (r.path === "/service/work-orders/new") { expected = has(p, "workOrder.create") ? "ALLOW" : "DENY"; basis = "workOrder.create"; }
    else if (r.path === "/service/work-orders/:workOrderId") { expected = has(p, "workOrder.record.read") ? "ALLOW" : "DENY"; basis = "workOrder.record.read (+ record assignment/company for the record id)"; }
    else { expected = surf && p.surfaces.includes(surf) ? "ALLOW" : "DENY"; basis = surf ? `door surface ${surf}` : "-"; }
    rows.push({ id: `${p.key}:route:${r.path}`, persona: p.key, tier: "direct-route", object: r.objects.join("|"), op: `GET ${r.path}`, expected, basis, source: `App.jsx route; ${r.gate}`, company: "reach-dependent", needsFixtures: /:/.test(r.path) });
  }
  return rows;
}

// -------- unmerged / merged-recent decision rows (SAE, CLC, DWO)
export function buildDecisionRows(m) {
  const rows = [];
  const scopes = ["Financials", "Purchasing", "Sales", "Inventory", "Service", "Goals"];
  for (const p of m.personasAll) {
    for (const s of scopes) {
      rows.push({ id: `${p.key}:sae:self-approve:${s}`, persona: p.key, tier: "sae-self-approval", object: "selfApprovalExemption", op: `self-approve a ${s} decision`,
        expected: isOwner(p) ? "ALLOW" : "DENY",
        basis: isOwner(p) ? "protected Owner is exempt from secondary approval (Rule 1)" : "no delegated key held (approval.selfApproval.exempt* are granted to no Role in nonprod); the Administrator's derived standing never supplies a family key",
        source: isOwner(p) ? RULINGS.SAE1 : RULINGS.SAE2, company: "any", needsFixtures: true });
    }
    rows.push({ id: `${p.key}:sae:grant-family`, persona: p.key, tier: "sae-grant", object: "selfApprovalExemption", op: "previewAuthorityChange / grantObjectActionToRole on the exemption family",
      expected: isOwner(p) ? "ALLOW_PREVIEW_ONLY" : "DENY", basis: isOwner(p) ? "only the verified protected Owner may preview or grant the family; UAT previews and NEVER commits" : "FORBIDDEN before anything is read about the request; zero trace (even for the Administrator holding admin.securityPolicy.write)",
      source: RULINGS.SAE2, company: "any", needsFixtures: false });
    rows.push({ id: `${p.key}:clc:assign-company`, persona: p.key, tier: "clc", object: "opportunity|salesAgreement", op: "assignRecordOperatingCompany (commercial.recordCompany.assign)",
      expected: "DENY", basis: "named-only grant: the capability is registered with NO grants, so every persona is refused until the Owner grants it through the normal admin path", source: RULINGS.CLC, company: "any", needsFixtures: true, dependsOn: ["#2199"] });
  }
  return rows;
}

// -------- Retail vs National Accounts channel boundary (Owner OQ-10): distinct Job Roles; the shared Security Role is acceptable only because the channel
// restriction enforces the separation, so it is proved through SEARCH, LIST, DETAIL and the direct API for each channel-scoped persona and BOTH channels.
const CHANNEL_KINDS = [["opportunity", "opportunity.read", "T-OPP"], ["salesAgreement", "salesAgreement.read", "T-AGR"], ["salesOrder", "salesOrder.read", "T-ORD"]];
export function buildChannelRows(m) {
  const rows = [];
  for (const p of m.personas.filter((x) => x.channels.length > 0)) {
    for (const [kind, cap, prefix] of CHANNEL_KINDS) for (const ch of ["RETAIL", "NATIONAL_ACCOUNTS"]) for (const op of ["SEARCH", "LIST", "DETAIL", "API-DETAIL-BY-ID"]) {
      const own = p.channels.includes(ch);
      rows.push({ id: `${p.key}:channel:${prefix}-${ch === "RETAIL" ? "R" : "N"}:${op}`, persona: p.key, tier: "channel-boundary", object: kind, op: `${op} of a ${ch} ${kind}`, capability: cap,
        expected: own ? "SCOPED" : "DENY",
        basis: own ? `the persona's own channel (${ch}); the scoped ${cap} admits it` : `another channel: invisible in search, list, detail and the API (identical not-found); a write is refused OUTSIDE_SALES_CHANNEL_SCOPE after the company check. National Accounts is a channel, never a company`,
        source: RULINGS.OQ10 + " ; " + RULINGS.P11_SALES, company: "taylor", needsFixtures: false, recordKind: `${prefix}-${ch === "RETAIL" ? "R" : "N"}` });
    }
  }
  return rows;
}
