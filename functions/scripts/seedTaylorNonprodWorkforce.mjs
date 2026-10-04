#!/usr/bin/env node
// THE TAYLOR NONPROD WORKFORCE ORCHESTRATOR (Owner 2026-10-03; DECISIONS #210).
//
// Builds the scaled SAMPLE workforce in scripts/fixtures/taylorNonprodWorkforce.v1.json -- 30 employees covering all 16
// canonical Job Roles, 10 Technicians with 10 governed service trucks, 2 Sales Manager Security Role holders, 3 Retail and
// 3 National Accounts sellers, a Warehouse Manager and 2 Warehouse Associates, sample accounts, opportunities, an ownership
// reassignment and scheduled work orders.
//
// IT IS AN ORCHESTRATOR, NOT AN IMPLEMENTATION. Every write is an EXISTING governed command, reached through the SAME HTTP
// API the browser uses, as the employee whose job it is -- Administration as the Administrator, truck configuration as the
// holder of the configuration Role, customers and opportunities as the sellers, work orders as the Dispatcher. Nothing here
// writes a table. The one operator step (`--phase principals`) admits Principals through `ensureTenantPrincipal`, the single
// governed admission primitive (in nonprod: scripts/provisionGovernedPrincipal.js, one per subject). Each command enforces its
// own authority, so this script cannot widen anything: a refusal is reported, never worked around.
//
// IDEMPOTENT. `--phase api` first READS the current state (listWorkforceRoster, listJobRoles, listWarehouses, listTrucks,
// listAccounts) and plans only what is absent; a second run plans zero writes. PLAN BY DEFAULT: nothing is written without
// --apply. NO CREDENTIALS: sample Principals get EOS subjects and no sign-in; `--tokens local` produces local HARNESS tokens
// that only the local proof server accepts, and is refused for any non-localhost API.
//
//   node scripts/seedTaylorNonprodWorkforce.mjs --phase principals --out principals.json [--apply]   (DATABASE_URL, operator)
//   node scripts/seedTaylorNonprodWorkforce.mjs --phase api --api http://localhost:8791 --principals principals.json --tokens local [--apply]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, t, i, all) => {
  if (t.startsWith("--")) acc.push([t.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const MANIFEST = JSON.parse(readFileSync(resolve(HERE, args.manifest ?? "fixtures/taylorNonprodWorkforce.v1.json"), "utf8"));
const APPLY = args.apply === true;
const environment = (process.env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
if (environment === "production" || environment === "prod") { console.error("REFUSED: production"); process.exit(2); }
const plan = [];
const done = [];
const refused = [];

// ════════════════════ phase: principals (operator) ════════════════════
async function phasePrincipals() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the principals phase");
  const pg = require("pg");
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const repo = new PostgresPolicyRepository(pool);
  try {
    const tenant = (await pool.query(`SELECT id FROM eos_policy.tenants WHERE key = $1`, [MANIFEST.tenantKey])).rows[0]?.id;
    if (!tenant) throw new Error(`tenant ${MANIFEST.tenantKey} not found`);
    const admin = await repo.getPrincipalBySubject(MANIFEST.identityProvider, "nonprod-persona.administrator");
    if (!admin) throw new Error("the administrator persona Principal does not exist");
    const out = {};
    for (const e of MANIFEST.employees) {
      if (!e.principalSubject) continue;
      const existing = await repo.getPrincipalBySubject(MANIFEST.identityProvider, e.principalSubject);
      if (existing) { out[e.principalSubject] = existing.id; continue; }
      plan.push(`ensureTenantPrincipal ${e.principalSubject}`);
      if (!APPLY) continue;
      const p = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: e.principalSubject, identityProvider: MANIFEST.identityProvider,
        displayName: `${e.firstName} ${e.lastName}`, actorUid: admin.id, actorRoleKeys: ["admin"], reason: `SAMPLE workforce: Principal for ${e.employeeId}` });
      out[e.principalSubject] = p.id;
      done.push(`principal ${e.principalSubject}`);
    }
    const owner = await repo.getPrincipalBySubject(MANIFEST.identityProvider, "nonprod-persona.ownerExecutive");
    if (owner) out["nonprod-persona.ownerExecutive"] = owner.id;
    if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
  } finally { await pool.end(); }
}

// ════════════════════ phase: api (governed commands, as the employee whose job it is) ════════════════════
function tokenFor(subject) {
  if (args.tokens !== "local") throw new Error("only --tokens local is implemented (the local proof harness); nonprod uses persona sessions");
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(args.api))) throw new Error("--tokens local is refused for a non-localhost API");
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${b({ alg: "EdDSA", typ: "JWT", kid: "local-harness" })}.${b({ sub: subject, iat: now, exp: now + 3600 })}.bG9jYWw`;
}

async function call(subject, route, operation, input) {
  const res = await fetch(`${args.api}${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokenFor(subject)}` },
    body: JSON.stringify(input === undefined ? { operation } : { operation, input }) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && body.ok !== false, body };
}

async function write(label, subject, route, operation, input) {
  plan.push(`${label}: ${operation} as ${subject}`);
  if (!APPLY) return null;
  const r = await call(subject, route, operation, input);
  if (!r.ok) { refused.push(`${label}: ${operation} -> ${r.status} ${r.body.code ?? ""} ${String(r.body.message ?? "").slice(0, 200)}`); return null; }
  done.push(`${label}: ${operation}`);
  return r.body.result ?? r.body.data ?? r.body;
}

async function read(subject, route, operation, input) {
  const r = await call(subject, route, operation, input);
  if (!r.ok) throw new Error(`${operation} -> ${r.status} ${r.body.code} ${r.body.message}`);
  return r.body.result ?? r.body.data;
}

async function phaseApi() {
  const principals = JSON.parse(readFileSync(args.principals, "utf8"));
  const byId = new Map(MANIFEST.employees.map((e) => [e.employeeId, e]));
  const subjectOf = (employeeId) => byId.get(employeeId)?.principalSubject;
  const ADMIN = subjectOf(MANIFEST.actors.workforceAdministration);
  const OWNER = "nonprod-persona.ownerExecutive";
  const CONFIG = subjectOf(MANIFEST.actors.configuration);
  const DISPATCH = subjectOf(MANIFEST.actors.dispatch);
  const WF = "/workforce/employees";
  const AP = "/admin/policy";
  const why = (s) => `SAMPLE workforce (Owner 2026-10-03): ${s}`;

  // 1. Job Role catalog (the canonical 16 only)
  const vocabulary = require("../lib/eosWorkforce/jobRoleVocabulary.js");
  const catalog = new Set(((await read(ADMIN, WF, "listJobRoles", {})).items ?? []).map((r) => r.jobRoleId));
  for (const r of vocabulary.CANONICAL_JOB_ROLES) {
    if (!catalog.has(r.jobRoleId)) await write(`jobRole ${r.jobRoleId}`, ADMIN, WF, "createJobRole", { jobRoleId: r.jobRoleId, displayName: r.displayName });
  }

  // 2. Employees, links, Job Roles, eligibility, scopes, managers -- planned against the roster
  const rosterOf = async () => new Map(((await read(ADMIN, WF, "listWorkforceRoster", {})).items ?? []).map((i) => [i.employeeId, i]));
  let roster = await rosterOf();
  for (const e of MANIFEST.employees) {
    if (!roster.has(e.employeeId)) {
      await write(`employee ${e.employeeId}`, ADMIN, WF, "createEmployee", { employeeId: e.employeeId, employmentStatus: e.employmentStatus, operatingCompanyId: e.operatingCompanyId,
        profile: { firstName: e.firstName, lastName: e.lastName, displayName: `${e.firstName} ${e.lastName}`, employeeNumber: e.employeeNumber, jobTitle: e.jobTitle,
          workEmail: `${e.firstName}.${e.lastName}@sample.invalid`.toLowerCase() }, reason: why("sample employee") });
    }
  }
  roster = APPLY ? await rosterOf() : roster;
  for (const e of MANIFEST.employees) {
    const r = roster.get(e.employeeId);
    if (e.principalSubject && !e.ownerViaBootstrap && (!r || r.applicationUser !== "LINKED")) {
      const pid = principals[e.principalSubject];
      if (pid) await write(`link ${e.employeeId}`, ADMIN, WF, "linkEmployeePrincipal", { employeeId: e.employeeId, linkedPrincipalId: pid, reason: why("application user") });
      else refused.push(`link ${e.employeeId}: no Principal for ${e.principalSubject} (run --phase principals)`);
    }
    if (!r || r.jobRole?.id !== e.jobRoleId) await write(`jobRole ${e.employeeId}`, ADMIN, WF, "assignEmployeeJobRole", { employeeId: e.employeeId, jobRoleId: e.jobRoleId, reason: why("job performed") });
    for (const q of e.workEligibility) {
      if (!r || !r.workEligibility.includes(q)) await write(`eligibility ${e.employeeId} ${q}`, ADMIN, WF, "assignEmployeeWorkEligibility", { employeeId: e.employeeId, qualificationCode: q, reason: why("work eligibility") });
    }
    for (const s of e.scopes) {
      if (!r || !r.operationalScopes.some((x) => x.scopeType === s.scopeType && x.scopeId === s.scopeId)) {
        plan.push(`(after warehouses) scope ${e.employeeId} ${s.scopeType}:${s.scopeId}`);
      }
    }
    if (e.manager && (!r || r.manager?.employeeId !== e.manager)) {
      await write(`manager ${e.employeeId}`, ADMIN, WF, "establishReportingRelationship", { employeeId: e.employeeId, managerEmployeeId: e.manager, reason: why("reporting line") });
    }
  }

  // 3. Security Roles (assignRole through Administration; the configuration Role by the Owner -- nobody assigns to themselves)
  const roles = new Map(((await read(ADMIN, AP, "listRoles")) ?? []).map((r) => [r.key, r.id]));
  roster = APPLY ? await rosterOf() : roster;
  for (const e of MANIFEST.employees) {
    const r = roster.get(e.employeeId);
    const pid = e.principalSubject ? principals[e.principalSubject] : null;
    for (const s of e.securityRoles) {
      const held = (r?.securityRoles ?? []).some((x) => x.roleKey === s.role && (x.scopeType ?? "global") === (s.scopeType ?? "global") && (x.scopeValue ?? null) === (s.scopeValue ?? null));
      if (held || !pid) continue;
      const actor = s.assignedBy === "owner" ? OWNER : ADMIN;
      await write(`role ${e.employeeId} ${s.role}${s.scopeValue ? `@${s.scopeValue}` : ""}`, actor, AP, "assignRole",
        { principalId: pid, roleId: roles.get(s.role), ...(s.scopeType ? { scopeType: s.scopeType, scopeValue: s.scopeValue } : {}), reason: why(`Security Role ${s.role}`) });
    }
  }

  // 4. Warehouses + trucks (configuration authority), then the scopes that name them
  const warehouses = new Set(((await read(CONFIG, AP, "listWarehouses", {}).catch(() => ({ items: [] }))).items ?? []).map((w) => w.warehouseId));
  for (const w of MANIFEST.warehouses) {
    if (!warehouses.has(w.warehouseId)) await write(`warehouse ${w.warehouseId}`, CONFIG, AP, "createWarehouse", { ...w, reason: why("warehouse master") });
  }
  const trucksNow = await read(CONFIG, AP, "listTrucks", {}).catch(() => ({ trucks: [] }));
  const locsNow = await read(CONFIG, AP, "listMobileLocations", {}).catch(() => ({ mobileLocations: [] }));
  const haveTruck = new Set((trucksNow.trucks ?? []).map((t) => t.truckId));
  const haveLoc = new Set((locsNow.mobileLocations ?? []).map((l) => l.locationId));
  for (const t of MANIFEST.trucks) {
    if (!haveLoc.has(t.mobileLocationId)) await write(`mobileLocation ${t.mobileLocationId}`, CONFIG, AP, "createMobileLocation", { locationId: t.mobileLocationId, displayLabel: t.displayLabel, operatingCompanyId: MANIFEST.operatingCompanyId, reason: why("truck stock location") });
    if (!haveTruck.has(t.truckId)) await write(`truck ${t.truckId}`, CONFIG, AP, "createTruck", { truckId: t.truckId, vehicleNumber: t.vehicleNumber, displayLabel: t.displayLabel, homeWarehouseId: t.homeWarehouseId, mobileLocationId: t.mobileLocationId, reason: why("service truck") });
  }
  roster = APPLY ? await rosterOf() : roster;
  for (const e of MANIFEST.employees) {
    const r = roster.get(e.employeeId);
    const scopes = [...e.scopes, ...(e.truck ? [{ scopeType: "MOBILE", scopeId: e.truck }] : [])];
    for (const s of scopes) {
      if (!r || !r.operationalScopes.some((x) => x.scopeType === s.scopeType && x.scopeId === s.scopeId)) {
        await write(`scope ${e.employeeId} ${s.scopeType}:${s.scopeId}`, ADMIN, WF, "assignEmployeeOperationalScope", { employeeId: e.employeeId, scopeType: s.scopeType, scopeId: s.scopeId, reason: why(s.scopeType === "MOBILE" ? "current service truck" : "operational scope") });
      }
    }
  }

  // 5. Customers, sites, opportunities, ownership reassignment (as the sellers), work orders (as the Dispatcher)
  if (args.skipBusiness) return;
  // Existing sample customers are found by name (as the seller who manages them) and resumed, never re-created.
  const created = new Map();
  for (const a of MANIFEST.accounts) {
    const actor = subjectOf(a.actor);
    const listed = await read(actor, "/crm/customer", "listAccounts", {}).catch(() => null);
    const existing = ((listed?.items ?? listed?.accounts) ?? []).find((x) => x.name === a.name);
    if (existing) {
      const sites = await read(actor, "/crm/customer", "listAccountLocations", { accountId: existing.accountId }).catch(() => null);
      created.set(a.accountId, { accountId: existing.accountId, locationId: ((sites?.items ?? []).find((x) => x.name === a.location) ?? {}).accountLocationId, existed: true });
      continue;
    }
    const acct = await write(`account ${a.accountId}`, actor, "/crm/customer", "createAccount", { idempotencyKey: `${a.accountId}-create`, name: a.name, status: "ACTIVE", ownerEmployeeId: a.owner });
    if (!acct) continue;
    const accountId = acct.accountId ?? acct.account?.accountId ?? acct.id;
    const loc = await write(`site ${a.accountId}`, actor, "/crm/customer", "createAccountLocation", { idempotencyKey: `${a.accountId}-site`, accountId, name: a.location });
    created.set(a.accountId, { accountId, locationId: loc?.accountLocationId });
    await write(`opportunity ${a.accountId}`, subjectOf(a.owner) ?? actor, "/commercial/sales", "createOpportunity", { idempotencyKey: `${a.accountId}-opp`, accountId,
      salesChannel: a.channel, operatingCompanyId: MANIFEST.operatingCompanyId, need: `SAMPLE: ${a.channel === "RETAIL" ? "walk-in cooler service plan" : "multi-site refrigeration program"}`,
      accountableEmployeeId: a.accountable });
  }
  for (const h of MANIFEST.reassignments) {
    const c = created.get(h.accountId);
    if (!c || c.existed) continue;
    await write(`reassign ${h.accountId}`, subjectOf(h.actor), "/crm/customer", "updateAccount", { accountId: c.accountId, ownerEmployeeId: h.to, ownershipHandoff: { reason: h.reason } });
  }
  const DAY = 86_400_000;
  // A weekday at `hour` America/Phoenix (UTC-7, no DST): the next business days, never a weekend.
  const startOf = (dayOffset, hour) => {
    const d = new Date(); d.setUTCHours(hour + 7, 0, 0, 0);
    let t = d.getTime(); let added = 0;
    while (added < dayOffset) { t += DAY; const wd = new Date(t - 7 * 3_600_000).getUTCDay(); if (wd !== 0 && wd !== 6) added += 1; }
    return t;
  };
  // Work orders: created once -- skipped when the Dispatcher already sees work for the sample customers.
  const sampleCustomers = new Set([...created.values()].map((c) => c.accountId));
  const existingWork = await read(DISPATCH, "/operations/work-orders", "listWorkOrders", {}).catch(() => ({ items: [] }));
  if ((existingWork.items ?? []).some((w) => sampleCustomers.has(w.customerId))) return;
  // Technician working hours (setTechnicianWorkingHours, the Service Manager's governed availability command): availability is
  // never assumed, so scheduling needs it. America/Phoenix, Monday-Friday 07:00-16:00, SAMPLE.
  const SERVICE_MANAGER = subjectOf(MANIFEST.actors.serviceManager ?? "synthetic-np-emp-service-manager");
  const WEEKDAYS = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "07:00", end: "16:00" }]]));
  for (const e of MANIFEST.employees.filter((x) => x.jobRoleId === "service-technician" && x.employmentStatus !== "ON_LEAVE")) {
    await write(`hours ${e.employeeId}`, SERVICE_MANAGER, "/operations/work-orders", "setTechnicianWorkingHours",
      { employeeId: e.employeeId, timeZone: "America/Phoenix", weeklyHours: WEEKDAYS, reason: why("working hours") });
  }
  for (const w of MANIFEST.workOrders) {
    const c = created.get(w.accountId);
    if (!c?.locationId) continue;
    const made = await write(`workOrder ${w.key}`, DISPATCH, "/operations/work-orders", "createWorkOrder", { operatingCompanyId: MANIFEST.operatingCompanyId,
      customerId: c.accountId, locationId: c.locationId, workOrderType: w.workOrderType, priority: 2 });
    if (!made || !w.assignee) continue;
    const workOrderId = made.workOrderId;
    await write(`ready ${w.key}`, DISPATCH, "/operations/work-orders", "markWorkOrderReady", { workOrderId });
    const s = startOf(w.dayOffset, w.hour);
    await write(`schedule ${w.key}`, DISPATCH, "/operations/work-orders", "scheduleWorkOrder", { workOrderId, employeeId: w.assignee, scheduledStart: s, scheduledEnd: s + 2 * 3_600_000 });
  }
}

try {
  if (args.phase === "principals") await phasePrincipals();
  else if (args.phase === "api") await phaseApi();
  else throw new Error("--phase principals | api");
  console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "PLAN", planned: plan.length, done: done.length, refused, ...(args.verbose ? { plan } : {}) }, null, 1));
  process.exit(refused.length ? 1 : 0);
} catch (err) {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
