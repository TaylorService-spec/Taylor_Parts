// FINAL EOS APPLICATION ASSEMBLY (DECISIONS #209) -- the employee landing (readMyWork) and site-wide search (searchEos) over real
// PostgreSQL through /operations/workspace:
//   PERSONA    the caller's current Job Role chooses the LAYOUT; with no Job Role the General Employee layout applies.
//   AUTHORITY  every section is decided by its own read; an unreadable section says NOT_AUTHORIZED, never widened.
//   RESPONSIBILITY  OWNER, ACCOUNTABLE and ASSIGNEE stay three answers; a Retail seller sees only RETAIL records it owns.
//   SEARCH     only what the caller's reads (channel scope, queue reach) allow; unreadable kinds are named, not searched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const myWork = require("../lib/eosExperience/myWork.js");
const vocabulary = require("../lib/eosWorkforce/jobRoleVocabulary.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-mywork";
const WS = "/operations/workspace", WO = "/operations/work-orders";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("static: every canonical Job Role has exactly one layout; the workspace is read-only, Firebase-free and AI-free", () => {
  assert.deepEqual(Object.keys(myWork.PERSONA_LAYOUTS).sort(), [...vocabulary.CANONICAL_JOB_ROLE_IDS].sort());
  for (const f of readdirSync(join(SRC, "eosExperience"))) {
    const s = strip(readFileSync(join(SRC, "eosExperience", f), "utf8"));
    assert.doesNotMatch(s, /firebase|firestore/i, `${f}: no Firebase`);
    assert.doesNotMatch(s, /from\s+["'][^"']*\/ai\//, `${f}: no AI`);
    assert.doesNotMatch(s, /\b(INSERT\s+INTO|UPDATE\s+\w+\.\w+\s+SET|DELETE\s+FROM)\b/i, `${f}: writes nothing`);
  }
});

test("my work + search over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "myw" });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 700)}`); return r.body.result; };
  const refused = (r, status, code) => assert.deepEqual([r.status, r.body.code], [status, code], JSON.stringify(r.body).slice(0, 300));
  const mw = (who, input = {}) => call(who, WS, "readMyWork", input);
  const search = (who, query) => call(who, WS, "searchEos", { query });
  const section = (w, key) => w.sections.find((s) => s.key === key);

  // ── job roles (the persona) and people ──
  for (const r of vocabulary.CANONICAL_JOB_ROLES) {
    await q(`INSERT INTO eos_workforce.job_roles (id, tenant_id, display_name, status, created_by, updated_by) VALUES ($1,$2,$3,'ACTIVE','f','f') ON CONFLICT DO NOTHING`, [r.jobRoleId, TENANT, r.displayName]);
  }
  for (const ch of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,$2,'ACTIVE','f','f','f')`, [TENANT, ch]);
  }
  let jr = 0;
  const jobRole = (employeeId, jobRoleId) => q(`INSERT INTO eos_workforce.employee_job_role_assignments (id, tenant_id, employee_id, job_role_id, effective_from, assigned_by, reason)
      VALUES ($1,$2,$3,$4,now(),'f','fixture')`, [`ejr-${++jr}`, TENANT, employeeId, jobRoleId]);
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Finley Tech", technician: true });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Kai PM" });
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const analyst = await person("uid-analyst", ["reportViewer"], { id: "e-analyst", name: "Riley Analyst" });
  const nobody = await person("uid-nobody", [], { id: "e-nobody", name: "Gen Employee" });
  const retail = await person("uid-retail", [], { id: "e-retail", name: "Robin Retail" });
  const r = await admin("assignRole", { principalId: retail.principalId, roleId: (await repo.getRoleByKey(TENANT, "salesperson")).id, scopeType: "salesChannel", scopeValue: "RETAIL", reason: "retail" });
  assert.equal(r.ok, true);
  for (const [e, role] of [["e-tech", "service-technician"], ["e-dispatch", "service-coordinator-dispatcher"], ["e-pm", "parts-manager"], ["e-ctrl", "finance-accounting"],
    ["e-analyst", "reporting-analyst"], ["e-retail", "retail-sales"]]) await jobRole(e, role);

  // ── records ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-1',$1,'Harbor Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-1',$1,'acct-1','Downtown','f','f')`, [TENANT]);
  // Retail: owned by the seller, accountable to the dispatcher (three distinct answers). National: owned by the seller too -- must stay invisible.
  await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, sales_channel, currency, state, booked_at, created_by, updated_by)
           VALUES ('so-r',$1,'SO-2026-900001','acct-1','e-retail','e-dispatch','taylor','RETAIL','USD','CONFIRMED',now(),'f','f'),
                  ('so-n',$1,'SO-2026-900002','acct-1','e-retail','e-retail','taylor','NATIONAL_ACCOUNTS','USD','CONFIRMED',now(),'f','f')`, [TENANT]);
  // Service: one Work Order assigned to the technician, one waiting to be dispatched.
  const ROUND = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId: "e-tech", timeZone: "UTC", weeklyHours: ROUND, reason: "fixture" }), "hours");
  const create = async () => ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-1", locationId: "loc-1", workOrderType: "SERVICE_CALL", priority: 2 }), "create").workOrderId;
  const assigned = await create();
  ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: assigned }), "ready");
  ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: assigned, plan: [] }), "plan");
  const start = Date.now() + 2 * 24 * HOUR;
  ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: assigned, employeeId: "e-tech", scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");
  const waiting = await create();

  await t.test("TECHNICIAN: the layout is its own assigned work; nothing else is composed for it", async () => {
    const w = ok(await mw(tech));
    assert.deepEqual([w.persona.key, w.persona.fromJobRole, w.me.jobRole.id], ["service-technician", true, "service-technician"]);
    const a = section(w, "assignedWork");
    assert.equal(a.status, "READY");
    assert.deepEqual(a.items.map((i) => [i.id, i.path]), [[assigned, `/service/work-orders/${assigned}`]]);
    assert.equal(a.items.some((i) => i.id === waiting), false, "an unassigned job is not the technician's work");
    assert.equal(w.aiRequired, false);
  });

  await t.test("DISPATCHER: the dispatch queue (governed read + a scheduling capability); the queue holds what awaits action", async () => {
    const w = ok(await mw(dispatcher));
    assert.equal(w.persona.key, "service-coordinator-dispatcher");
    const d = section(w, "dispatchQueue");
    assert.equal(d.status, "READY");
    assert.ok(d.items.some((i) => i.id === waiting && i.status === "CREATED" && i.severity === "ATTENTION"));
    assert.ok(d.items.some((i) => i.id === assigned && i.status === "SCHEDULED" && i.action.assignee === "Finley Tech"), "the ASSIGNEE is shown as the assignee");
  });

  await t.test("RETAIL SALES: owner and accountable are distinct answers; channel scope holds -- National records never appear", async () => {
    const w = ok(await mw(retail));
    assert.equal(w.persona.key, "retail-sales");
    const owned = section(w, "ownedRecords");
    assert.deepEqual(owned.items.map((i) => i.id), ["so-r"], "the National Accounts order the seller owns stays invisible to a Retail-scoped seller");
    assert.deepEqual(owned.items[0].action.responsibility, { owner: "Robin Retail", accountable: "Emerson Dispatch" }, "OWNER and ACCOUNTABLE are different people, shown as such");
    assert.deepEqual(section(w, "accountableRecords").items.map((i) => i.id), [], "the seller is accountable only for the National order, which its scope cannot read");
  });

  await t.test("PARTS MANAGER: the reorder queue needs the REORDER_QUEUE scope -- NOT_AUTHORIZED without it, never widened", async () => {
    const w = ok(await mw(pm));
    assert.equal(w.persona.key, "parts-manager");
    assert.deepEqual([section(w, "reorderQueue").status, /REORDER_QUEUE/.test(section(w, "reorderQueue").reason)], ["NOT_AUTHORIZED", true]);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by) VALUES ('os-pm',$1,'e-pm','REORDER_QUEUE','taylor',now(),'f')`, [TENANT]);
    assert.equal(section(ok(await mw(pm)), "reorderQueue").status, "READY");
  });

  await t.test("FINANCE / REPORTING ANALYST / NO JOB ROLE: Analysis attention for Finance; the catalog only for the analyst; General Employee by default", async () => {
    const f = ok(await mw(ctrl));
    assert.deepEqual([f.persona.key, section(f, "attention").status, section(f, "measures").status], ["finance-accounting", "READY", "READY"]);
    // ONE severity vocabulary: an Analysis exception is ATTENTION (nothing is "blocking"), its rank kept verbatim as priority.
    assert.ok(section(f, "attention").items.every((i) => i.severity === "ATTENTION" && ["HIGH", "MEDIUM", "LOW"].includes(i.priority)));
    const a = ok(await mw(analyst));
    assert.equal(a.persona.key, "reporting-analyst");
    const cat = section(a, "analysisCatalog");
    assert.equal(cat.count, 37, "the analyst sees the whole governed catalog (items are capped at 25 per section; count is the total)");
    assert.ok(cat.items.filter((i) => !i.detail.includes("·")).every((i) => i.status === "NO_UNDERLYING_READ"), "and no computed business measure is readable to it");
    const g = ok(await mw(nobody));
    assert.deepEqual([g.persona.key, g.persona.fromJobRole], ["general-employee", false]);
    assert.ok(g.sections.every((s) => s.status !== "READY" || s.items.length === 0), "a person who holds nothing sees nothing of anyone's work");
  });

  await t.test("SEARCH: only what the caller can already read; channel scope and queue reach hold; unreadable kinds are named", async () => {
    const rs = ok(await search(retail, "SO-2026-9000"));
    assert.deepEqual(rs.results.filter((x) => x.kind === "salesOrder").map((x) => [x.id, x.path]), [["so-r", "/customers/opportunities/sales-order/so-r"]], "Retail seller never finds the National order");
    assert.ok(rs.notSearched.includes("workOrder") && rs.notSearched.includes("employee"));
    assert.equal(rs.notSearchedLabels.length, rs.notSearched.length);
    assert.ok(rs.notSearchedLabels.includes("Work Order") && rs.notSearchedLabels.includes("Employee"));
    const ts = ok(await search(tech, "Harbor"));
    assert.ok(ts.notSearched.includes("salesOrder") && ts.notSearched.includes("account"), "a Technician searches no commercial or customer records");
    const ds = ok(await search(dispatcher, "Harbor"));
    assert.ok(ds.results.some((x) => x.kind === "workOrder"));
    refused(await search(tech, "x"), 400, "QUERY_INVALID");
  });

  await t.test("readMyWorkOrderCapabilities: the caller's OWN workOrder.* keys, nothing else, no input", async () => {
    const dc = ok(await call(dispatcher, WO, "readMyWorkOrderCapabilities", {}));
    assert.ok(dc.capabilities.includes("workOrder.create"));
    assert.ok(dc.capabilities.every((k) => k.startsWith("workOrder.")));
    const tc = ok(await call(tech, WO, "readMyWorkOrderCapabilities", {}));
    assert.equal(tc.capabilities.includes("workOrder.create"), false, "a technician is not offered New Work Order");
    const nc = ok(await call(nobody, WO, "readMyWorkOrderCapabilities", {}));
    assert.deepEqual(nc.capabilities, []);
    refused(await call(dispatcher, WO, "readMyWorkOrderCapabilities", { principalId: "someone-else" }), 400, "INPUT_FIELD_NOT_ACCEPTED");
  });

  await t.test("resolvePrincipalDisplayNames: display names only, caller's tenant only, for record readers -- not Principal administration", async () => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, display_name, status) VALUES ('pr-foreign','foreign-subject','eos','Foreign Person','active') ON CONFLICT DO NOTHING`);
    const ids = [dispatcher.principalId, tech.principalId, "pr-foreign", "pr-unknown"];
    // A channel-scoped seller (opportunity.read only within RETAIL) may name the actors on records it reads.
    const r = ok(await call(retail, WS, "resolvePrincipalDisplayNames", { principalIds: ids }));
    assert.deepEqual(r.names.map((n) => n.key).sort(), [dispatcher.principalId, tech.principalId].sort(), "a Principal outside the tenant, or unknown, is absent");
    for (const n of r.names) assert.deepEqual(Object.keys(n).sort(), ["displayName", "key"], "no Employee id, Role, subject or status");
    // A record written outside EOS stores the actor's external subject; it is named under THAT key -- the answer never
    // translates a subject into a Principal id -- and a subject of another tenant's Principal is absent.
    const bySubject = ok(await call(retail, WS, "resolvePrincipalDisplayNames", { actorSubjects: ["uid-dispatch", "foreign-subject"] }));
    assert.deepEqual(bySubject.names.map((n) => n.key), ["uid-dispatch"]);
    assert.ok(!JSON.stringify(bySubject).includes(dispatcher.principalId));
    // Someone who reads none of the record kinds that show actors is refused, never answered empty.
    refused(await call(nobody, WS, "resolvePrincipalDisplayNames", { principalIds: ids }), 403, "CAPABILITY_REQUIRED");
    refused(await call(retail, WS, "resolvePrincipalDisplayNames", { principalIds: [] }), 400, "PRINCIPAL_IDS_INVALID");
    refused(await call(retail, WS, "resolvePrincipalDisplayNames", { principalIds: Array.from({ length: 101 }, (_, i) => `p${i}`) }), 400, "PRINCIPAL_IDS_INVALID");
    refused(await call(retail, WS, "resolvePrincipalDisplayNames", { principalIds: ids, tenantId: "other" }), 400, "FIELD_NOT_ACCEPTED");
    // The seller still cannot read the tenant's Principal population (Administration).
    const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
    const adminRead = await executeAdminOperation({ repo }, { caller: { externalSubject: "uid-retail", identityProvider: "firebase" }, operation: "listTenantPrincipals", input: {}, requestId: "r-np" });
    assert.equal(adminRead.ok, false);
  });

  await t.test("SEARCH employees (UI corrections item E): a flat holder is global; an operatingCompany-scoped holder is searched inside its companies only", async () => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,first_name,last_name,employee_number) VALUES
             ('e-q-t',$1,'ACTIVE','taylor','Quinn','Northside','Q-T'), ('e-q-v',$1,'ACTIVE','ventana','Quinn','Southside','Q-V')`, [TENANT]);
    const flat = await person("uid-gm-flat", ["generalManager"], { id: "e-gm-flat", name: "Glen Flat" });
    const fs = ok(await search(flat, "Quinn"));
    assert.deepEqual(fs.results.filter((x) => x.kind === "employee").map((x) => x.id).sort(), ["e-q-t", "e-q-v"]);
    const scoped = await person("uid-gm-scoped", [], { id: "e-gm-scoped", name: "Gail Scoped" });
    // A role that reads Employees and carries no Administration authority (only those may be scoped), in this disposable tenant.
    assert.equal((await admin("createRole", { key: "companyStaffReader", name: "Company Staff Reader", reason: "scope fixture" })).ok, true);
    assert.equal((await admin("grantObjectActionToRole", { objectKey: "employee", actionKey: "read", roleKey: "companyStaffReader", reason: "scope fixture" })).ok, true);
    const a = await admin("assignRole", { principalId: scoped.principalId, roleId: (await repo.getRoleByKey(TENANT, "companyStaffReader")).id, scopeType: "operatingCompany", scopeValue: "ventana", reason: "ventana only" });
    assert.equal(a.ok, true, JSON.stringify(a).slice(0, 300));
    const ss = ok(await search(scoped, "Quinn"));
    assert.deepEqual(ss.results.filter((x) => x.kind === "employee").map((x) => x.id), ["e-q-v"], "the scoped holder never finds the Taylor employee");
    // The employee number is searchable too, and the label is the governed name.
    assert.deepEqual(ok(await search(flat, "Q-V")).results.filter((x) => x.kind === "employee").map((x) => x.label), ["Quinn Southside"]);
    refused(await call(tech, WS, "readMyWork", { asEmployee: "e-dispatch" }), 400, "FIELD_NOT_ACCEPTED");
  });
});
