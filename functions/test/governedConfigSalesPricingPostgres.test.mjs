// POST-FBR GOVERNED CONFIGURATION + COMMERCIAL PRICING (Controller, 2026-10-02; DECISIONS #203 + Owner rulings #204;
// migration 1764500000000). Proofs against real PostgreSQL: #203 A–AC (FINANCING_PROVIDER, operating-company business time,
// accounting destinations and payment terms, the customer discount, the trade-in as consideration and incoming equipment,
// used-equipment value never a resale price, Finance unchanged) and #204 A–AK (configuration authority assigned through
// Administration to Security Roles, System Configuration, per-user discount authority, trade-in proposal and approval).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { deterministicAccountingAdapter, TEST_ADAPTER_KEY } from "./support/deterministicAccountingAdapter.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const ic = require("../lib/eosFinance/intercompany.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const fsale = require("../lib/eosFinance/financedSale.js");
const delivery = require("../lib/eosFinance/accountingDelivery.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const saRead = require("../lib/eosCommercial/reads/salesAgreementReadProjection.js");
const crm = require("../lib/eosCrm/accountAuthority.js");
const bt = require("../lib/eosOps/operatingCompanyBusinessTime.js");
const recv = require("../lib/eosOps/receiveReorderStockCommand.js");
const { createFinanceConfigurationAdministration, isFinanceConfigurationOperation } = require("../lib/eosFinance/financeConfigurationAdministration.js");
const { createSystemConfigurationAdministration, isSystemConfigurationOperation } = require("../lib/eosOps/systemConfigurationAdministration.js");
const { createSalesDiscountAuthorityAdministration } = require("../lib/salesAuthority/salesDiscountAuthority.js");
const { bootstrapFirstOwner } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const closure = require("../lib/adminPolicy/purchasingFinanceClosureDelta.js");
const partsDelta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const purchasing = require("../lib/eosOps/purchasingRepository.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-gcsp";
const INV = "/operations/inventory";
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

test("V / W / AC. static: no trade-in credit or acquisition value ever reaches a selling price; time zone never hardcoded; no Firebase", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const pricing = ["salesAgreement/salesAgreementCommands.ts", "eosCommercial/commands/salesAgreementCommandService.ts", "eosCommercial/commands/commercialRecordStore.ts"]
    .map((f) => strip(readFileSync(join(SRC, f), "utf8"))).join("\n");
  assert.equal(/inventory_acquisition_costs|(approved_credit|proposed_value)_minor\s*[,)]*\s*(AS|as)\s*unit_price|unit_price_minor\s*=\s*[^,;]*(approved_credit|proposed_value)/i.test(pricing), false,
    "no pricing path reads an acquisition value or a trade-in value into a price");
  // Business-date creation (Finance, Commercial, the business-time resolver) never names a zone -- it asks the resolver.
  for (const f of walk(SRC).filter((f) => f.endsWith(".ts") && /\/(eosFinance|eosCommercial)\/|operatingCompanyBusinessTime\.ts$/.test(f))) {
    const s = strip(readFileSync(f, "utf8"));
    assert.equal(/America\/Phoenix|AT TIME ZONE 'UTC'\s*,\s*'YYYY-MM-DD'\)/.test(s), false, `${f}: no hardcoded business zone or UTC calendar cut`);
  }
  for (const f of ["eosFinance/financeConfigurationAdministration.ts", "eosOps/operatingCompanyBusinessTime.ts", "eosOps/systemConfigurationAdministration.ts",
    "salesAuthority/salesDiscountAuthority.ts"]) {
    assert.equal(/firebase/i.test(strip(readFileSync(join(SRC, f), "utf8"))), false, `${f}: no Firebase`);
  }
});

test("governed configuration + sales pricing over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "gcsp" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const inv = (who, operation, input) => call(who, INV, operation, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, category, message, what = "") => {
    assert.deepEqual([r.status, r.body.code], [status, category], `${what} ${JSON.stringify(r.body)}`);
    if (message) assert.match(r.body.message, message, what);
  };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 200)}`);
  };
  for (const key of ["reorder.request.approve", "reorder.request.assign", "reorder.request.read"]) await grant("partsManager", key);
  for (const key of ["reorder.request.create.manual", "reorder.request.markReceived", "reorder.request.postPurchasingUpdate", "reorder.request.read",
    "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"]) await grant("partsAssociate", key);
  // The correction authority is granted to NOBODY by the migration. The OWNER-RULED holders (Warehouse Manager, Parts Manager)
  // and the Parts Manager finance-defect revocation arrive exactly as an activation window issues them: the reviewed
  // Administration delta, through ordinary Administration operations (purchasingFinanceClosureDelta.ts).
  // The LIVE Parts / Purchasing / Receiving delta (supplier.record.read for the purchasing Roles) -- what nonprod already holds.
  // (Only its supplier rows: the Operational Configuration Administrator Role it also grants is a nonprod Administration Role.)
  for (const { operation, input } of partsDelta.partsPurchasingReceivingOperations().filter((o) => o.input.objectKey === "supplier")) {
    const r = await admin(operation, input);
    assert.equal(r.ok, true, `${operation} ${JSON.stringify(input)} ${JSON.stringify(r).slice(0, 200)}`);
  }
  const partsManagerFinanceBefore = await capabilitiesForRoleKeys(pool, TENANT, ["partsManager"]);
  for (const { operation, input } of closure.purchasingFinanceClosureOperations()) {
    const r = await admin(operation, input);
    assert.equal(r.ok, true, `${operation} ${JSON.stringify(input)} ${JSON.stringify(r).slice(0, 200)}`);
  }

  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan Manager" });
  const corrector = await person("uid-corr", ["warehouseManager", "inventoryReceivingClerk"], { id: "e-corr", name: "Casey Corrector" });
  const partsMgr = await person("uid-pmgr", ["partsManager"], { id: "e-pmgr", name: "Parker Parts-Manager" });
  const whAssoc = await person("uid-wa", ["warehouseAssociate"], { id: "e-wa", name: "Wren Warehouse" });
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-t',$1,'taylor','Shared Building -- Taylor','Shared Building','ACTIVE','NATIVE','fixture','fixture'),
                  ('wh-v',$1,'ventana','Shared Building -- Ventana','Shared Building','ACTIVE','NATIVE','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_ops.bins (id, tenant_id, warehouse_id, area, aisle, bay, position, code, status, idempotency_key, created_by, updated_by)
           VALUES ('bin_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$1,'wh-t','MAIN','A',1,1,'MAIN-A-1-1','ACTIVE','bin_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','fixture','fixture')`, [TENANT]);
  for (const e of ["e-pa", "e-pm", "e-corr", "e-pmgr", "e-wa"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ($1,$2,$3,$4,now(),'fixture')`, [`ewe-${e}`, TENANT, e, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
    for (const [kind, id] of [["REORDER_QUEUE", "taylor"], ["REORDER_QUEUE", "ventana"], ["WAREHOUSE", "wh-t"], ["WAREHOUSE", "wh-v"]]) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-${e}-${kind}-${id}`, TENANT, e, kind, id]);
    }
  }
  const PARTS = ["P-TZ-1", "P-TZ-2", "P-USED"];
  for (const p of PARTS) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [p, TENANT]);
  }
  // The EXTERNAL supplier: a governed supplier profile, linked to its CRM organization (a VENDOR).
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-acme',$1,'Acme Refrigeration','ACTIVE','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-acme','VENDOR')`, [TENANT]);
  await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
           VALUES ($1,'SUP-ACME','Acme Refrigeration','acme refrigeration','ACTIVE',1,'fixture','fixture')`, [TENANT]);
  await fin.linkSupplierToOrganization(pool, { tenantId: TENANT, principalId: "ops" }, { supplierId: "SUP-ACME", crmAccountId: "acct-acme" });

  let n = 0;
  const toPurchasing = async (partId, warehouseId, qty) => {
    const rr = ok(await inv(pa, "createReorderRequest", { partId, warehouseId, requestedQuantity: qty, recommendationStatus: "BELOW_MIN",
      quantitySource: "MANUAL", idempotencyKey: `rr-${++n}` }), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr }), "start");
    return rr;
  };
  const poInput = (rr, qty, supplier, price) => ({ reorderRequestId: rr, ...supplier, externalPoNumber: `PO-${rr.slice(-6)}`, orderedQuantity: qty,
    orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08", ...(price === undefined ? {} : { unitPriceMinor: price, currency: "USD" }) });
  const ordered = async ({ partId, warehouseId, qty, supplier, price }) => {
    const rr = await toPurchasing(partId, warehouseId, qty);
    ok(await inv(pa, "recordReorderPurchaseOrder", poInput(rr, qty, supplier, price)), "PO");
    return rr;
  };
  const receive = (rr, partId, location, qty, key = `rcv-${rr}`) => inv(pa, "receiveReorderStock", {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rr, purchaseOrderId: rr }, receivingLocation: location,
    lines: [{ lineId: "L1", partId, receivedQuantity: qty }], idempotencyKey: key });
  const WH_T = { type: "WAREHOUSE", locationId: "wh-t" };
  const WH_V = { type: "WAREHOUSE", locationId: "wh-v" };
  const EXT = { supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-ACME" } };
  const INTERNAL = (operatingCompanyId) => ({ supplier: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId } });
  const po = (rr) => one(`SELECT * FROM eos_ops.purchase_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, rr]);
  const factsOf = (receivingId) => q(`SELECT * FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id=$2 ORDER BY created_at, id`, [TENANT, receivingId]);
  const counterparty = async (id) => (id === null ? null : fin.readCounterparty(pool, TENANT, id));
  const onHand = (partId, type, id) => count(`SELECT COALESCE(SUM(quantity_delta),0)::int n FROM eos_ops.inventory_movements
      WHERE tenant_id=$1 AND part_id=$2 AND location_type=$3 AND location_id=$4`, [TENANT, partId, type, id]);
  const crmAccounts = () => count(`SELECT count(*)::int n FROM eos_crm.accounts WHERE tenant_id=$1`, [TENANT]);


  const sys = { tenantId: TENANT, principalId: "finance-system" };
  const inTx = async (fn) => { const c = await pool.connect(); try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); } };
  const finance = createFinanceConfigurationAdministration(pool);
  const system = createSystemConfigurationAdministration(pool);
  const discounts = createSalesDiscountAuthorityAdministration(pool);
  const configuration = (operation, ...rest) => (isFinanceConfigurationOperation(operation) ? finance
    : isSystemConfigurationOperation(operation) ? system : discounts)(operation, ...rest);
  const adminAs = (who, operation, input) => executeAdminOperation({ repo, configuration },
    { caller: { externalSubject: who.subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  const refusedWith = async (p, code) => { await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; }); };

  // ── #204: the Owner-ruled holders are written by the GRANT-BEARING migration (Owner ruling E; the R1 vehicle -- the only one
  // that reaches the designated Administrator Role, which Administration never edits for itself). This tenant's Roles existed
  // when it ran (serviceBaselineTenant seeds at the seed boundary, then migrates the rest), exactly as nonprod's do. ──
  const MIGRATION_SQL = readFileSync(resolve(HERE, "../migrations/1764500000000_governed-config-and-sales-pricing.sql"), "utf8").split("-- Down Migration")[0];
  const GRANT_SQL = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("INSERT INTO role_capabilities"),
    MIGRATION_SQL.indexOf("ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;") + "ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;".length);
  const RULED = [...GRANT_SQL.matchAll(/\('([a-zA-Z.]+)', '([a-zA-Z]+)'\)/g)].map((m) => [m[1], m[2]]);
  const outsider = await person("uid-outsider", ["partsAssociate"], { id: "e-outsider", name: "Ollie Outsider" });
  // The protected Owner is never appointed by ordinary role administration: the tenant's first Owner is bootstrapped.
  const ownerP = await person("uid-owner", [], { id: "e-owner", name: "Avery Owner" });
  await bootstrapFirstOwner(repo, { tenantId: TENANT, principalId: ownerP.principalId, performedBy: "operator-test", reason: "local test tenant" });
  const gmP = await person("uid-gm", ["generalManager"], { id: "e-gm", name: "Gale General-Manager" });
  const controllerP = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const sysAdminP = await person("uid-sysadmin", ["admin"], { id: "e-sysadmin", name: "Rowan System-Administrator" });
  const finAdmin = controllerP;
  const actorOfRoles = async (who, roles) => ({ tenantId: TENANT, principalId: who.principalId, capabilities: new Set(await capabilitiesForRoleKeys(pool, TENANT, roles)) });

  await t.test("#204 A / B / C / D / E / F. finance.configuration.manage is assigned through Administration to Security Roles, and revoked the same way", async () => {
    assert.equal(RULED.length, 16, "exactly the sixteen Owner-ruled (capability, Security Role) pairs (#204 as amended by #205)");
    const written = await q(`SELECT c.key, r.key AS role FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      JOIN eos_policy.roles r ON r.id = rc.role_id WHERE rc.tenant_id = $1 AND rc.granted_by = 'migration:1764500000000' ORDER BY 1, 2`, [TENANT]);
    // Both sides ordered in JS: database collation differs between environments.
    const byPair = (a, b) => (`${a[0]}|${a[1]}` < `${b[0]}|${b[1]}` ? -1 : 1);
    assert.deepEqual(written.rows.map((x) => [x.key, x.role]).sort(byPair), [...RULED].sort(byPair), "the ruled holders, nothing else");
    // A: the capability is an ordinary Object action in the Administration security model (the Roles & Permissions checkbox).
    const matrix = await admin("getObjectSecurityMatrix", { objectKey: "financeConfiguration" });
    assert.equal(matrix.ok, true, JSON.stringify(matrix).slice(0, 300));
    assert.match(JSON.stringify(matrix.data), /finance\.configuration\.manage/, "A: shown under its Object as an assignable action");
    for (const [who, label] of [[ownerP, "B Owner / Executive"], [gmP, "C General Manager"], [controllerP, "D Finance / Accounting"], [sysAdminP, "E System Administrator"]]) {
      assert.equal((await adminAs(who, "listAccountingDestinations", {})).ok, true, `${label} holds finance.configuration.manage`);
    }
    assert.equal((await adminAs(outsider, "listAccountingDestinations", {})).ok, false, "a Parts Associate does not");
    // A / F: an ordinary checkbox -- any Role, granted then revoked through Administration, no source change.
    assert.equal((await admin("createRole", { key: "financeConfigurationAdministrator", name: "Finance Configuration Administrator", reason: "test tenant" })).ok, true);
    const grantIt = await admin("grantObjectActionToRole", { roleKey: "financeConfigurationAdministrator", objectKey: "financeConfiguration", actionKey: "manage", reason: "assign" });
    assert.equal(grantIt.ok, true, JSON.stringify(grantIt).slice(0, 300));
    const delegate = await person("uid-findelegate", ["financeConfigurationAdministrator"], { id: "e-findelegate", name: "Dana Delegate" });
    assert.equal((await adminAs(delegate, "listAccountingDestinations", {})).ok, true, "A: assigned");
    const revoked = await admin("revokeObjectActionFromRole", { roleKey: "financeConfigurationAdministrator", objectKey: "financeConfiguration", actionKey: "manage", reason: "revoke" });
    assert.equal(revoked.ok, true, JSON.stringify(revoked).slice(0, 300));
    assert.equal((await adminAs(delegate, "listAccountingDestinations", {})).ok, false, "F: revocation removes configuration authority");
  });

  await t.test("#204 G / Z / AA. administration and finance configuration confer no business approval; trade-in approval is Owner / GM only", async () => {
    const holds = async (roles) => new Set(await capabilitiesForRoleKeys(pool, TENANT, roles));
    for (const [role, label] of [["admin", "G / AA System Administrator"], ["controller", "Z Finance / Accounting"], ["salesperson", "Y salesperson"]]) {
      assert.equal((await holds([role])).has("salesAgreement.tradeIn.approve"), false, `${label} holds no trade-in approval`);
    }
    assert.equal((await holds(["owner"])).has("salesAgreement.tradeIn.approve"), true);
    assert.equal((await holds(["generalManager"])).has("salesAgreement.tradeIn.approve"), true);
    assert.equal((await holds(["admin"])).has("admin.systemConfiguration.manage"), true, "system administration is the System Administrator's");
    // OWNER RULING #205 -- the exact holder sets, measured in the database (no unintended grant).
    const holdersIn = async (key) => (await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = $2`, [TENANT, key])).rows.map((x) => x.key).sort();
    const SIX = ["accountingManager", "admin", "controller", "financeManager", "generalManager", "owner"];
    assert.deepEqual(await holdersIn("finance.configuration.manage"), SIX, "#205: six ruled roles hold Finance configuration");
    assert.deepEqual(await holdersIn("sales.discountAuthority.manage"), SIX, "#205: six ruled roles manage Sales discount limits");
    assert.deepEqual(await holdersIn("admin.systemConfiguration.manage"), ["admin", "owner"], "#205: owner + admin govern System Configuration");
    assert.deepEqual(await holdersIn("salesAgreement.tradeIn.approve"), ["generalManager", "owner"], "#205: trade-in approval unchanged");
    for (const role of ["accountingManager", "financeManager"]) {
      const h = await holds([role]);
      assert.equal(h.size, 19, `${role}: the 17 finance capabilities + the two #205 configuration authorities, nothing else`);
      assert.equal(h.has("admin.systemConfiguration.manage") || h.has("salesAgreement.tradeIn.approve"), false, role);
    }
    assert.equal((await holds(["controller"])).has("admin.systemConfiguration.manage"), false, "Finance configuration is not system configuration");
    assert.deepEqual(RULED.filter(([k]) => k === "salesAgreement.tradeIn.approve").map(([, r]) => r).sort(), ["generalManager", "owner"],
      "the migration rules exactly Owner / GM as trade-in approvers");
  });

  await t.test("#204 H / I / J. System Configuration: company time zone and default language, validated, audited, authority-guarded", async () => {
    assert.equal((await adminAs(controllerP, "listSystemConfiguration", {})).ok, false, "Finance / Accounting is not system administration");
    assert.equal((await adminAs(gmP, "listSystemConfiguration", {})).ok, false, "#205: the General Manager is not granted System Configuration");
    assert.equal((await adminAs(ownerP, "listSystemConfiguration", {})).ok, true, "#205: the Owner governs company settings without the Administrator Role");
    for (const company of ["taylor", "ventana"]) {
      const r = await adminAs(sysAdminP, "setSystemConfigurationSetting", { operatingCompanyId: company, settingKey: "businessTimeZone", value: "America/Phoenix", reason: "Arizona business day" });
      assert.equal(r.ok, true, `H ${JSON.stringify(r)}`);
    }
    const lang = await adminAs(sysAdminP, "setSystemConfigurationSetting", { operatingCompanyId: "ventana", settingKey: "defaultLanguage", value: "es-US", reason: "Ventana staff" });
    assert.deepEqual([lang.ok, lang.data.previous, lang.data.value], [true, "en-US", "es-US"], "I: language configurable; the previous value was the default");
    for (const [settingKey, value, why] of [["businessTimeZone", "Mars/Olympus", /not an IANA time zone/], ["defaultLanguage", "xx-ZZ", /not a supported language/],
      ["defaultLanguage", "english", /not a supported language/], ["favouriteColour", "blue", /not a governed setting/]]) {
      const r = await adminAs(sysAdminP, "setSystemConfigurationSetting", { operatingCompanyId: "taylor", settingKey, value, reason: "x" });
      assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], `J: ${settingKey}=${value} ${JSON.stringify(r)}`);
      assert.match(r.message, why, `J: ${settingKey}=${value}`);
    }
    assert.equal((await adminAs(sysAdminP, "setSystemConfigurationSetting", { operatingCompanyId: "taylor", settingKey: "defaultLanguage", value: "en-US" })).ok, false, "a change states its reason");
    await assert.rejects(q(`INSERT INTO eos_policy.operating_company_settings (tenant_id, operating_company_id, setting_key, value, updated_by) VALUES ($1,'taylor','defaultLanguage','xx-ZZ','x')`, [TENANT]),
      /LANGUAGE_UNSUPPORTED/, "the database refuses an unsupported language too");
    const cfg = (await adminAs(sysAdminP, "listSystemConfiguration", {})).data;
    const byCo = Object.fromEntries(cfg.companies.map((c) => [c.operatingCompanyId, c.values]));
    assert.deepEqual([byCo.taylor.businessTimeZone.value, byCo.taylor.defaultLanguage, byCo.ventana.defaultLanguage],
      ["America/Phoenix", { value: "en-US", source: "DEFAULT" }, { value: "es-US", source: "CONFIGURED" }], "company-aware; an unset language reads as its default, said so");
    assert.deepEqual(cfg.supportedLanguages.map((l) => l.languageTag), ["en-US", "es-US"]);
    const audits = await q(`SELECT target_id, before, after, actor_uid FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='admin.systemConfiguration.set' ORDER BY occurred_at`, [TENANT]);
    assert.deepEqual(audits.rows.map((a) => a.target_id), ["taylor:businessTimeZone", "ventana:businessTimeZone", "ventana:defaultLanguage"]);
    assert.deepEqual([audits.rows[2].before, audits.rows[2].after, audits.rows[2].actor_uid], [{ defaultLanguage: "en-US" }, { defaultLanguage: "es-US" }, sysAdminP.principalId]);
  });

  await t.test("G / H. accounting destinations through Administration: configure, activate, deactivate, history, company-separated", async () => {
    const refused = await adminAs(outsider, "listAccountingDestinations", {});
    assert.equal(refused.ok, false, "no finance.configuration.manage -> refused");
    const a = await adminAs(finAdmin, "configureAccountingDestination", { operatingCompanyId: "taylor", displayName: "Taylor Ledger A", providerKey: TEST_ADAPTER_KEY, activate: true, reason: "initial" });
    assert.equal(a.ok, true, JSON.stringify(a));
    const missingReason = await adminAs(finAdmin, "configureAccountingDestination", { operatingCompanyId: "taylor", displayName: "x" });
    assert.equal(missingReason.ok, false, "a change states its reason");
    const cons = await adminAs(finAdmin, "configureAccountingDestination", { operatingCompanyId: "consolidated", displayName: "x", reason: "x" });
    assert.equal(cons.ok, false, "CONSOLIDATED owns no destination");
    const b = await adminAs(finAdmin, "configureAccountingDestination", { operatingCompanyId: "taylor", displayName: "Taylor Ledger B", providerKey: TEST_ADAPTER_KEY, activate: true, reason: "switch" });
    const v = await adminAs(finAdmin, "configureAccountingDestination", { operatingCompanyId: "ventana", displayName: "Ventana Ledger", providerKey: TEST_ADAPTER_KEY, activate: true, reason: "initial" });
    const list = (await adminAs(finAdmin, "listAccountingDestinations", {})).data.items;
    assert.deepEqual(list.map((d) => [d.operatingCompanyId, d.displayName, d.status]), [["taylor", "Taylor Ledger B", "ACTIVE"], ["taylor", "Taylor Ledger A", "INACTIVE"], ["ventana", "Ventana Ledger", "ACTIVE"]],
      "H: history kept, one ACTIVE per company, Taylor and Ventana independent");
    const reA = await adminAs(finAdmin, "setAccountingDestinationStatus", { destinationId: a.data.destination.id, status: "ACTIVE", reason: "back to A" });
    assert.equal(reA.data.changed, true);
    const off = await adminAs(finAdmin, "setAccountingDestinationStatus", { destinationId: a.data.destination.id, status: "INACTIVE", reason: "pause" });
    assert.equal(off.data.destination.status, "INACTIVE");
    assert.equal((await adminAs(finAdmin, "listAccountingDestinations", { operatingCompanyId: "taylor" })).data.items.filter((d) => d.status === "ACTIVE").length, 0);
    await adminAs(finAdmin, "setAccountingDestinationStatus", { destinationId: b.data.destination.id, status: "ACTIVE", reason: "B live" });
    const audits = await q(`SELECT action FROM eos_policy.audit_events WHERE tenant_id=$1 AND action LIKE 'finance.configuration.accountingDestination.%'`, [TENANT]);
    assert.ok(audits.rows.length >= 6, "every change audited");
    void v;
  });

  await t.test("C / D / I. business time (set through System Configuration above) and payment terms through Finance configuration (Taylor -> Ventana NET 90; nothing mirrored)", async () => {
    const zones = (await adminAs(sysAdminP, "listSystemConfiguration", {})).data.companies;
    assert.deepEqual(zones.map((z) => [z.operatingCompanyId, z.values.businessTimeZone.value]), [["taylor", "America/Phoenix"], ["ventana", "America/Phoenix"]]);
    // C / E: the shared resolver.
    assert.equal(await bt.businessDateOn(pool, TENANT, "taylor", "2026-10-03T04:40:00Z"), "2026-10-02", "E: 04:40 UTC is still 2 October in Arizona");
    assert.equal(await bt.businessDateOn(pool, TENANT, "taylor", "2026-10-03T07:00:00Z"), "2026-10-03");
    // I: payment terms.
    const terms = await adminAs(finAdmin, "setCounterpartyPaymentTerms", { operatingCompanyId: "taylor", counterparty: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: "ventana" },
      paymentTermsNetDays: 90, reason: "Taylor's NET 90 terms with Ventana" });
    assert.deepEqual([terms.ok, terms.data.profile.paymentTermsNetDays, terms.data.profile.paymentTerms, terms.data.appliesTo], [true, 90, "Net 90", "FUTURE_OBLIGATIONS"]);
    assert.equal((await adminAs(finAdmin, "setCounterpartyPaymentTerms", { operatingCompanyId: "taylor", counterparty: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: "taylor" },
      paymentTermsNetDays: 30, reason: "x" })).ok, false, "no terms with itself");
    const listed = (await adminAs(finAdmin, "listCounterpartyPaymentTerms", {})).data.items;
    assert.deepEqual(listed.map((p) => [p.operatingCompanyId, p.counterparty.operatingCompanyId, p.paymentTermsNetDays]), [["taylor", "ventana", 90]], "Ventana -> Taylor is not assumed");
  });

  await t.test("D / E / F / J. a receipt at 2026-10-03 04:40 UTC: Arizona business date 2026-10-02, NET 90 due 2026-12-31; later terms rewrite nothing", async () => {
    const actorOf = async (who, roles) => ({ tenantId: TENANT, principalId: who.principalId, capabilities: new Set(await capabilitiesForRoleKeys(pool, TENANT, roles)) });
    const paActor = await actorOf(pa, ["partsAssociate", "inventoryReceivingClerk"]);
    const receiveAt = async (rr, partId, instant) => recv.receiveReorderStock({ pool, now: () => new Date(instant) }, paActor, {
      source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rr, purchaseOrderId: rr }, receivingLocation: WH_T,
      lines: [{ lineId: "L1", partId, receivedQuantity: 1 }], idempotencyKey: `rcv-${rr}` });
    const rr = await ordered({ partId: "P-TZ-1", warehouseId: "wh-t", qty: 1, supplier: INTERNAL("ventana"), price: 400000 });
    const r = await receiveAt(rr, "P-TZ-1", "2026-10-03T04:40:00Z");
    const c = await one(`SELECT *, to_char(obligation_date,'YYYY-MM-DD') od, to_char(due_on,'YYYY-MM-DD') dd FROM eos_finance.intercompany_transactions WHERE source_record_id=$1`, [r.receivingId]);
    const instant = await one(`SELECT to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') ts FROM eos_ops.receiving_orders WHERE id=$1`, [r.receivingId]);
    assert.equal(instant.ts, "2026-10-03T04:40:00Z", "D: the UTC event timestamp is preserved");
    assert.deepEqual([c.od, c.payment_terms_net_days, c.dd, c.status], ["2026-10-02", 90, "2026-12-31", "ESTABLISHED"], "E / F");
    const dues = await q(`SELECT to_char(due_on,'YYYY-MM-DD') d FROM eos_finance.obligations WHERE source_record_id=$1`, [c.id]);
    assert.deepEqual(dues.rows.map((x) => x.d), ["2026-12-31", "2026-12-31"]);
    // J: new terms govern only FUTURE obligations.
    await adminAs(finAdmin, "setCounterpartyPaymentTerms", { operatingCompanyId: "taylor", counterparty: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: "ventana" },
      paymentTermsNetDays: 60, reason: "renegotiated" });
    assert.deepEqual((await q(`SELECT to_char(due_on,'YYYY-MM-DD') d FROM eos_finance.obligations WHERE source_record_id=$1`, [c.id])).rows.map((x) => x.d), ["2026-12-31", "2026-12-31"],
      "J: the historical due date is not rewritten");
    const rr2 = await ordered({ partId: "P-TZ-2", warehouseId: "wh-t", qty: 1, supplier: INTERNAL("ventana"), price: 1000 });
    const r2 = await receiveAt(rr2, "P-TZ-2", "2026-10-05T18:00:00Z");
    const c2 = await one(`SELECT to_char(obligation_date,'YYYY-MM-DD') od, payment_terms_net_days n, to_char(due_on,'YYYY-MM-DD') dd FROM eos_finance.intercompany_transactions WHERE source_record_id=$1`, [r2.receivingId]);
    assert.deepEqual([c2.od, c2.n, c2.dd], ["2026-10-05", 60, "2026-12-04"], "the new terms govern the next obligation");
  });

  // ── Commercial fixtures for pricing ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-cust',$1,'Harbor Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-cust','CUSTOMER')`, [TENANT]);
  for (const ch of ["RETAIL"]) await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,$2,'ACTIVE','f','f','f') ON CONFLICT DO NOTHING`, [TENANT, ch]);
  const seller = await person("uid-seller", [], { id: "e-seller", name: "Riley Retail" });
  const sellerActor = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept"]) };
  const commercialDeps = { pool, catalog: { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } } };
  let gn = 0;
  const opportunity = async () => {
    const id = `opp-gp-${++gn}`;
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, stage, operating_company_key,
               credited_salesperson_employee_id, created_by, updated_by) VALUES ($1,$2,$1,'acct-cust','e-seller','RETAIL','DECISION','taylor','e-seller','f','f')`, [id, TENANT]);
    return id;
  };
  const agreement = async (extra) => (await sa.createSalesAgreement(commercialDeps, sellerActor, { idempotencyKey: `sa-${++gn}-${Date.now()}`, opportunityId: await opportunity(),
    ownerEmployeeId: "e-seller", isLease: false, taxEvidence: { status: "DETERMINED", amountMinor: 0, currency: "USD" },
    lines: [{ kind: "SERVICE", ref: "ICE-MACHINE-X", quantity: 1, unitPrice: 40000, businessUnitId: "SERVICE" }], ...extra }).then((r) => r.result ?? r)).salesAgreementId;
  const update = (id, patch) => sa.updateSalesAgreementDraft(commercialDeps, sellerActor, { idempotencyKey: `u-${++gn}-${Date.now()}`, salesAgreementId: id, ...patch });
  const reader = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesAgreement.read"]) };
  const detail = (id) => saRead.getSalesAgreementDetail({ pool }, reader, { salesAgreementId: id });

  await t.test("#204 K / L / M / N / O / P / Q / R / S / T. per-user maximum customer discount: governed, audited, enforced on the server", async () => {
    // T: NOT CONFIGURED fails closed -- no discount at all, and said so (never read as unlimited).
    await refusedWith(agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 100 } }), "DISCOUNT_AUTHORITY_NOT_CONFIGURED");
    const listed0 = (await adminAs(gmP, "listSalesDiscountAuthorities", {})).data.items.find((i) => i.principalId === seller.principalId);
    assert.deepEqual([listed0.state, listed0.maxDiscountBasisPoints], ["NOT_CONFIGURED", null], "T: missing is its own state");
    // M: the salesperson cannot set their own maximum.
    const self = await adminAs(seller, "setSalesDiscountAuthority", { principalId: seller.principalId, maxDiscountBasisPoints: 10000, reason: "me" });
    assert.equal(self.ok, false, "M: no sales.discountAuthority.manage -> refused");
    // K / L: the General Manager gives the salesperson an individual 10% maximum; audited (who, previous, new, actor, reason).
    const set = await adminAs(gmP, "setSalesDiscountAuthority", { principalId: seller.principalId, maxDiscountBasisPoints: 1000, reason: "standard retail authority" });
    assert.deepEqual([set.ok, set.data?.previousMaxDiscountBasisPoints, set.data?.maxDiscountBasisPoints], [true, null, 1000], `L ${JSON.stringify(set)}`);
    for (const who of [ownerP, controllerP, sysAdminP]) assert.equal((await adminAs(who, "listSalesDiscountAuthorities", {})).ok, true, "every ruled administrator may manage it");
    assert.equal((await adminAs(outsider, "listSalesDiscountAuthorities", {})).ok, false);
    assert.equal((await adminAs(gmP, "setSalesDiscountAuthority", { principalId: seller.principalId, maxDiscountBasisPoints: 10001, reason: "x" })).ok, false, "at most 100%");
    const audit = await one(`SELECT target_id, before, after, actor_uid, reason, occurred_at FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='sales.discountAuthority.set'`, [TENANT]);
    assert.deepEqual([audit.target_id, audit.before, audit.after, audit.actor_uid],
      [seller.principalId, { state: "NOT_CONFIGURED" }, { state: "CONFIGURED", maxDiscountBasisPoints: 1000 }, gmP.principalId]);
    assert.match(audit.reason, /^standard retail authority \[request r-/, "the stated reason, correlated to its request (the Administration convention)");
    assert.ok(audit.occurred_at instanceof Date);
    // N / O / P: percentage below, at, above.
    assert.ok(await agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 525 } }), "N: 5.25% <= 10%");
    assert.ok(await agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 1000 } }), "O: exactly 10%");
    await refusedWith(agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 1001 } }), "DISCOUNT_EXCEEDS_AUTHORITY");
    // Q / R: fixed amounts against the 40000 selling price -> at most 4000 (integer arithmetic).
    assert.ok(await agreement({ customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 3500 } }), "Q: 3500 of 40000 = 8.75%");
    const atMax = await agreement({ customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 4000 } });
    await refusedWith(agreement({ customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 4001 } }), "DISCOUNT_EXCEEDS_AUTHORITY");
    await refusedWith(agreement({ customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 5000 } }), "DISCOUNT_EXCEEDS_AUTHORITY");
    // A standing fixed discount over a LOWER selling price is a larger percentage: lowering the price is held to the same ceiling.
    await refusedWith(update(atMax, { lines: [{ kind: "SERVICE", ref: "ICE-MACHINE-X", quantity: 1, unitPrice: 30000, businessUnitId: "SERVICE" }] }), "DISCOUNT_EXCEEDS_AUTHORITY");
    // The client cannot bypass: an update path is held to the same ceiling.
    await refusedWith(update(atMax, { customerDiscount: { kind: "PERCENT", percentBasisPoints: 1500 } }), "DISCOUNT_EXCEEDS_AUTHORITY");
    // S: 0% is NO discount authority -- explicit and CONFIGURED, distinct from NOT_CONFIGURED.
    await adminAs(controllerP, "setSalesDiscountAuthority", { principalId: seller.principalId, maxDiscountBasisPoints: 0, reason: "suspended" });
    const listed = (await adminAs(gmP, "listSalesDiscountAuthorities", {})).data.items.find((i) => i.principalId === seller.principalId);
    assert.deepEqual([listed.state, listed.maxDiscountBasisPoints], ["CONFIGURED", 0]);
    await refusedWith(agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 1 } }), "DISCOUNT_EXCEEDS_AUTHORITY");
    assert.ok(await agreement({}), "S: no discount needs no authority");
    await adminAs(gmP, "setSalesDiscountAuthority", { principalId: seller.principalId, maxDiscountBasisPoints: 1000, reason: "restored" });
  });

  await t.test("K / L / M / N. the salesperson's customer discount: PERCENT or FIXED_AMOUNT; net selling price only; line prices untouched", async () => {
    const id = await agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 525 } });
    let d = await detail(id);
    assert.deepEqual([d.totals.subtotalMinor, d.totals.customerDiscountMinor, d.totals.netSellingMinor, d.customerDiscount], [40000, 2100, 37900, { kind: "PERCENT", percentBasisPoints: 525 }], "K: 5.25% of 400.00 = 21.00");
    await update(id, { customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 2000 } });
    d = await detail(id);
    assert.deepEqual([d.totals.customerDiscountMinor, d.totals.netSellingMinor, d.totals.totalMinor, d.lines[0].unitPriceMinor], [2000, 38000, 38000, 40000],
      "L / M / N: net selling price changes; the line's selling price stays 400.00");
    const half = await agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 1 }, lines: [{ kind: "SERVICE", ref: "X", quantity: 1, unitPrice: 50, businessUnitId: "SERVICE" }] });
    assert.equal((await detail(half)).totals.customerDiscountMinor, 0, "0.01% of 0.50 rounds half-up to 0.00 (0.005 -> 0)");
    const exact = await agreement({ customerDiscount: { kind: "PERCENT", percentBasisPoints: 5 }, lines: [{ kind: "SERVICE", ref: "X", quantity: 1, unitPrice: 10000, businessUnitId: "SERVICE" }] });
    assert.equal((await detail(exact)).totals.customerDiscountMinor, 5, "0.05% of 100.00 = 0.05");
    await refusedWith(update(id, { customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 40001 } }), "DISCOUNT_EXCEEDS_SELLING_PRICE");
    await refusedWith(update(id, { customerDiscount: { kind: "PERCENT", percentBasisPoints: 10001 } }), "DISCOUNT_INVALID");
    await refusedWith(update(id, { customerDiscount: { kind: "PERCENT", percentBasisPoints: 5.5 } }), "DISCOUNT_INVALID");
    await update(id, { customerDiscount: null });
    assert.deepEqual([(await detail(id)).customerDiscount, (await detail(id)).totals.customerDiscountMinor], [null, 0], "cleared");
  });

  const ownerActor = await actorOfRoles(ownerP, ["owner"]);
  const gmActor = await actorOfRoles(gmP, ["generalManager"]);
  const decide = (who, op, input) => sa[op](commercialDeps, who, { idempotencyKey: `d-${++gn}-${Date.now()}`, ...input }).then((r) => ({ result: r.result ?? r }));
  let financedAgreement;
  const ITEM = { description: "Used ice machine (SAMPLE)", manufacturer: "Acme", modelNumber: "IM-500", serialNumber: "SN-OLD-1", proposedValueMinor: 5500,
    notes: "Runs; compressor noisy", evidenceReference: "photo-set-77" };
  await t.test("#204 U / V / Y / Z / AA / W / AB / AE. a proposed trade-in reduces nothing until Owner / GM approval; then 40000 - 2000 - 5000 - 3000 = 30000", async () => {
    financedAgreement = await agreement({ customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 2000 }, downPaymentMinor: 3000, tradeIns: [ITEM] });
    let d = await detail(financedAgreement);
    assert.deepEqual([d.totals.netSellingMinor, d.totals.tradeInMinor, d.totals.downPaymentMinor, d.totals.balanceMinor], [38000, 0, 3000, 35000],
      "U / V: proposed (5500) -- the balance is not reduced");
    assert.deepEqual(d.tradeIns.map((ti) => [ti.description, ti.manufacturer, ti.modelNumber, ti.serialNumber, ti.proposedValueMinor, ti.notes, ti.evidenceReference,
      ti.approvalStatus, ti.approvedCreditMinor, ti.receivingOperatingCompanyId, ti.acquisitionStatus]),
    [["Used ice machine (SAMPLE)", "Acme", "IM-500", "SN-OLD-1", 5500, "Runs; compressor noisy", "photo-set-77", "PROPOSED", null, "taylor", "AGREED"]], "U: the proposal and its provenance");
    assert.equal(d.accountId, "acct-cust", "U: the customer is the Agreement's");
    // No client path states a credit.
    await refusedWith(update(financedAgreement, { tradeInMinor: 5000 }), "TRADE_IN_REQUIRES_APPROVAL");
    await refusedWith(update(financedAgreement, { tradeIns: [{ description: "x", creditMinor: 5000 }] }), "TRADE_IN_REQUIRES_APPROVAL");
    // Y / Z / AA: not the salesperson, not Finance / Accounting, not the System Administrator.
    await refusedWith(decide(sellerActor, "approveSalesAgreementTradeIn", { salesAgreementId: financedAgreement, itemNumber: 1, approvedCreditMinor: 5500 }), "CAPABILITY_REQUIRED");
    await refusedWith(decide(await actorOfRoles(controllerP, ["controller"]), "approveSalesAgreementTradeIn", { salesAgreementId: financedAgreement, itemNumber: 1, approvedCreditMinor: 5500 }), "CAPABILITY_REQUIRED");
    await refusedWith(decide(await actorOfRoles(sysAdminP, ["admin"]), "approveSalesAgreementTradeIn", { salesAgreementId: financedAgreement, itemNumber: 1, approvedCreditMinor: 5500 }), "CAPABILITY_REQUIRED");
    // Acceptance waits for the decision.
    await refusedWith(sa.acceptSalesAgreement(commercialDeps, sellerActor, { idempotencyKey: `acc-pend-${Date.now()}`, salesAgreementId: financedAgreement }), "TRADE_IN_APPROVAL_PENDING");
    // W: the Owner approves, ASSIGNING the value (5000, not the proposed 5500).
    const w = await decide(ownerActor, "approveSalesAgreementTradeIn", { salesAgreementId: financedAgreement, itemNumber: 1, approvedCreditMinor: 5000, reason: "condition" });
    assert.deepEqual([w.result.approvalStatus, w.result.tradeInCreditMinor, w.result.balanceMinor], ["APPROVED", 5000, 30000], "W / AB");
    d = await detail(financedAgreement);
    assert.deepEqual([d.totals.subtotalMinor, d.totals.customerDiscountMinor, d.totals.netSellingMinor, d.totals.tradeInMinor, d.totals.downPaymentMinor, d.totals.balanceMinor],
      [40000, 2000, 38000, 5000, 3000, 30000], "AB: the APPROVED credit buys down the balance");
    assert.equal(d.totals.customerDiscountMinor + d.totals.netSellingMinor, d.totals.subtotalMinor, "AE: the trade-in credit is not in the discount");
    assert.deepEqual([d.tradeIns[0].approvalStatus, d.tradeIns[0].approvedCreditMinor, d.tradeIns[0].decidedBy, d.tradeIns[0].proposedValueMinor], ["APPROVED", 5000, ownerP.principalId, 5500]);
    await refusedWith(decide(gmActor, "approveSalesAgreementTradeIn", { salesAgreementId: financedAgreement, itemNumber: 1, approvedCreditMinor: 9000 }), "TRADE_IN_ALREADY_DECIDED");
    // A changed proposal is decided again: an approval never survives a change to what was approved.
    await update(financedAgreement, { tradeIns: [{ ...ITEM, serialNumber: "SN-OLD-2" }] });
    assert.deepEqual([(await detail(financedAgreement)).tradeIns[0].approvalStatus, (await detail(financedAgreement)).totals.tradeInMinor], ["PROPOSED", 0]);
    await update(financedAgreement, { tradeIns: [ITEM] });
    await decide(ownerActor, "approveSalesAgreementTradeIn", { salesAgreementId: financedAgreement, itemNumber: 1, approvedCreditMinor: 5000 });
    // An unchanged edit keeps the decision.
    await update(financedAgreement, { tradeIns: [ITEM], specialInstructions: "deliver Tuesday" });
    assert.deepEqual([(await detail(financedAgreement)).tradeIns[0].approvalStatus, (await detail(financedAgreement)).totals.balanceMinor], ["APPROVED", 30000]);
    // Decline states a reason and carries no credit.
    const other = await agreement({ tradeIns: [{ description: "Older reach-in cooler, identity unknown", proposedValueMinor: 1000 }] });
    assert.deepEqual((await detail(other)).tradeIns.map((ti) => [ti.serialNumber, ti.modelNumber]), [[null, null]], "identity is never invented");
    await refusedWith(decide(gmActor, "declineSalesAgreementTradeIn", { salesAgreementId: other, itemNumber: 1 }), "REASON_REQUIRED");
    const dec = await decide(gmActor, "declineSalesAgreementTradeIn", { salesAgreementId: other, itemNumber: 1, reason: "scrap value only" });
    assert.deepEqual([dec.result.approvalStatus, dec.result.tradeInCreditMinor], ["DECLINED", 0]);
    await refusedWith(decide(ownerActor, "approveSalesAgreementTradeIn", { salesAgreementId: other, itemNumber: 1, approvedCreditMinor: 50000 }), "TRADE_IN_ALREADY_DECIDED");
  });

  await t.test("#204 AC / AD / AI (and #203 S / Z / P / AB). financed: provider finances 30000 = net - APPROVED trade-in - cash; the trade-in is neither cash nor A/R", async () => {
    await sa.acceptSalesAgreement(commercialDeps, sellerActor, { idempotencyKey: `acc-${Date.now()}`, salesAgreementId: financedAgreement });
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-lessor',$1,'Sample Lessor','ACTIVE','f','f')`, [TENANT]);
    await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-lessor','FINANCING_PROVIDER')`, [TENANT]);
    const arr = await fsale.recordFinancingArrangement(pool, sys, { salesAgreementId: financedAgreement, financingProviderAccountId: "acct-lessor", arrangementKind: "LEASE",
      customerContributionMinor: 3000, idempotencyKey: "gp-arr-1" });
    const so = "so-gp-fin";
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, sales_agreement_id, created_by, updated_by)
             VALUES ($1,$2,$1,'acct-cust','e-seller','taylor','IN_FULFILLMENT','RETAIL','USD',$3,'f','f')`, [so, TENANT, financedAgreement]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,1,'SERVICE','ICE-MACHINE-X','INSTALLATION',1,40000)`, [TENANT, so]);
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
             VALUES ('ful-gp-fin',$1,$2,1,'SERVICE','ICE-MACHINE-X',1,'WORK_ORDER_COMPLETION','wo-gp','SERVICE_PERFORMED','taylor','taylor','acct-cust',now(),'f')`, [TENANT, so]);
    const out = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    const p = await one(`SELECT * FROM eos_finance.billing_packages WHERE id=$1`, [out.packageId]);
    assert.deepEqual([out.status, p.subtotal_minor, p.customer_discount_minor, p.total_minor, p.trade_in_minor, p.customer_contribution_minor, p.financed_amount_minor],
      ["READY", "40000", "2000", "38000", "5000", "3000", "30000"], "S: 38000 = 3000 cash + 5000 trade-in + 30000 financed");
    const fsEvidence = await fsale.recordFinancingApprovalEvidence(pool, sys, { arrangementId: arr.arrangementId, documentReference: "DOC-GP", signed: true, approved: true, idempotencyKey: "gp-ev" });
    await fsale.transitionFinancingArrangement(pool, sys, { arrangementId: arr.arrangementId, toStatus: "APPROVED", reason: "x", idempotencyKey: "gp-ap" });
    const ent = await fsale.transitionFinancingArrangement(pool, sys, { arrangementId: arr.arrangementId, toStatus: "FUNDING_ENTITLED", reason: "signed + approved", evidenceId: fsEvidence.evidenceId, idempotencyKey: "gp-en" });
    const obs = (await q(`SELECT o.kind, b.originated_minor::text amt, cp.crm_account_id FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.obligation_id=o.id
        JOIN eos_finance.financial_counterparties cp ON cp.id=o.counterparty_id WHERE o.source_record_id=$1 ORDER BY o.kind`, [out.packageId])).rows;
    assert.deepEqual(obs.map((o) => [o.kind, o.amt, o.crm_account_id]), [["FUNDING_RECEIVABLE", "30000", "acct-lessor"], ["RECEIVABLE", "3000", "acct-cust"]],
      "P / AB / AC: the trade-in creates no receivable; exactly one of each kind");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.payments WHERE tenant_id=$1`, [TENANT]), 0, "AD: no cash receipt (payment) for the trade-in");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id=$2 AND (fact_type ILIKE '%PAYMENT%' OR fact_type ILIKE '%CASH%')`,
      [TENANT, out.packageId]), 0, "AD: no cash fact");
    // The financed handoff v2 carries the trade-in credit in the composition.
    const built = await delivery.buildAccountingPayload(pool, TENANT, ent.consequences[0].handoff.id);
    assert.deepEqual([built.payload.contract.version, built.payload.composition.tradeInCreditMinor, built.payload.composition.totalCommercialMinor,
      built.payload.billingPackage.amounts.customerDiscountMinor], [2, "5000", "38000", "2000"]);
  });

  await t.test("#204 X / AH (and #203 Y / AB). direct sales: discount -> the discounted total; a GM-approved trade-in -> the total less the APPROVED credit", async () => {
    const direct = async (extra, soId, approve) => {
      const id = await agreement(extra);
      if (approve) await approve(id);
      await sa.acceptSalesAgreement(commercialDeps, sellerActor, { idempotencyKey: `acc-${soId}`, salesAgreementId: id });
      await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, sales_agreement_id, created_by, updated_by)
               VALUES ($1,$2,$1,'acct-cust','e-seller','taylor','IN_FULFILLMENT','RETAIL','USD',$3,'f','f')`, [soId, TENANT, id]);
      await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,1,'SERVICE','ICE-MACHINE-X','INSTALLATION',1,40000)`, [TENANT, soId]);
      await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
               VALUES ($1,$2,$3,1,'SERVICE','ICE-MACHINE-X',1,'WORK_ORDER_COMPLETION','wo-d','SERVICE_PERFORMED','taylor','taylor','acct-cust',now(),'f')`, [`ful-${soId}`, TENANT, soId]);
      return pkg.prepareBillingPackage(pool, sys, { salesOrderId: soId });
    };
    const disc = await direct({ customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 2000 } }, "so-gp-d1");
    const ar1 = (await q(`SELECT b.originated_minor::text amt FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.obligation_id=o.id WHERE o.source_record_id=$1`, [disc.packageId])).rows;
    assert.deepEqual([disc.status, disc.totalMinor, ar1.map((r) => r.amt)], ["READY", "38000", ["38000"]]);
    // X: the General Manager approves the proposed 6000 trade-in at 5000.
    const trade = await direct({ tradeIns: [{ description: "Old unit", proposedValueMinor: 6000 }] }, "so-gp-d2",
      (id) => decide(gmActor, "approveSalesAgreementTradeIn", { salesAgreementId: id, itemNumber: 1, approvedCreditMinor: 5000 }));
    const ar2 = (await q(`SELECT b.originated_minor::text amt FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.obligation_id=o.id WHERE o.source_record_id=$1`, [trade.packageId])).rows;
    assert.deepEqual([trade.totalMinor, ar2.map((r) => r.amt)], ["40000", ["35000"]], "the customer owes the total less the trade-in credit -- never cash for the trade-in");
    const built = await delivery.buildAccountingPayload(pool, TENANT, trade.consequence.handoff.id);
    assert.deepEqual([built.payload.contract.version, built.payload.receivable.amountMinor, built.payload.billingPackage.amounts.tradeInMinor, "customerDiscountMinor" in built.payload.billingPackage.amounts],
      [1, "35000", "5000", false], "v1 unchanged in shape for a sale without a discount");
    const plain = await direct({}, "so-gp-d3");
    assert.equal(plain.totalMinor, "40000", "Y: an undiscounted, trade-in-free direct sale is exactly as before");
  });

  await t.test("#204 AF / AG (and #203 V / W / X). acquisition, proposed and approved trade-in values never become book value or a resale price", async () => {
    // AF: approval wrote no acquisition / book value -- the item is still only AGREED incoming equipment.
    const approved = await one(`SELECT acquisition_status, acquired_receiving_id FROM eos_commercial.sales_agreement_trade_ins WHERE serial_number='SN-OLD-1' AND approval_status='APPROVED'`);
    assert.deepEqual([approved.acquisition_status, approved.acquired_receiving_id], ["AGREED", null], "AF: acquisition / book value HELD");
    const costsBefore = await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1`, [TENANT]);
    // W: a used unit bought for 4000 -> acquisition-cost evidence 4000.
    const rr = await ordered({ partId: "P-USED", warehouseId: "wh-t", qty: 1, supplier: EXT, price: 4000 });
    ok(await receive(rr, "P-USED", WH_T, 1), "used purchase");
    assert.equal((await one(`SELECT extended_cost_minor::text v FROM eos_finance.inventory_acquisition_costs WHERE purchase_order_id=$1`, [rr])).v, "4000");
    // X: selling that unit -- and the traded-in unit -- needs an explicit price; nothing defaults from 4000 or the 5000 trade-in credit.
    const unpriced = await agreement({ lines: [{ kind: "PART", ref: "P-USED", quantity: 1, businessUnitId: "PARTS" }] }).catch((e) => e);
    if (!(unpriced instanceof Error)) assert.equal((await detail(unpriced)).lines[0].unitPriceMinor, null, "no price is inferred");
    const priced = await agreement({ lines: [{ kind: "PART", ref: "P-USED", quantity: 1, unitPrice: 10000, businessUnitId: "PARTS" }] });
    assert.equal((await detail(priced)).lines[0].unitPriceMinor, 10000, "X: the future sale price is established by the Sales process");
    assert.equal((await one(`SELECT approved_credit_minor::text v FROM eos_commercial.sales_agreement_trade_ins WHERE serial_number='SN-OLD-1' AND approval_status='APPROVED'`)).v, "5000",
      "V: the approved credit stays what it was");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1`, [TENANT]), costsBefore + 1,
      "AF: the only new acquisition evidence is the explicitly purchased unit's, never a trade-in's");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1 AND extended_cost_minor IN (5000, 5500, 6000)`, [TENANT]), 0,
      "AF: no trade-in value became acquisition evidence");
    // AG: approving a 5000 credit set no price anywhere.
    assert.equal(await count(`SELECT count(*)::int n FROM eos_commercial.sales_agreement_lines WHERE tenant_id=$1 AND unit_price_minor IN (5000, 5500, 6000)`, [TENANT]), 0,
      "AG: no trade-in value became a selling price");
  });

  await t.test("A / B. FINANCING_PROVIDER: assigned only through the governed CRM path by governed-field authority; an ordinary org cannot act as one", async () => {
    const crmDeps = { pool };
    const salesCaps = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["customer.record.read", "customer.record.create", "customer.record.update"]) };
    const governed = { ...salesCaps, capabilities: new Set([...salesCaps.capabilities, "customer.governedField.write"]) };
    await refusedWith(crm.createAccount(crmDeps, salesCaps, { idempotencyKey: "crm-1", name: "Lessor Co", status: "ACTIVE", relationshipTypes: ["FINANCING_PROVIDER"], ownerEmployeeId: "e-seller" }),
      "CAPABILITY_REQUIRED");
    const created = (await crm.createAccount(crmDeps, salesCaps, { idempotencyKey: "crm-2", name: "Lessor Co", status: "ACTIVE", relationshipTypes: ["VENDOR"], ownerEmployeeId: "e-seller" }));
    const acct = { id: created.accountId ?? created.id ?? created.account?.accountId };
    // B: not yet governed -> cannot be a financing provider.
    const id2 = await agreement({});
    await refusedWith(fsale.recordFinancingArrangement(pool, sys, { salesAgreementId: id2, financingProviderAccountId: acct.id, arrangementKind: "LEASE",
      customerContributionMinor: 0, idempotencyKey: "gp-arr-b" }), "FINANCING_PROVIDER_NOT_GOVERNED");
    await refusedWith(crm.updateAccount(crmDeps, salesCaps, { accountId: acct.id, relationshipTypes: ["VENDOR", "FINANCING_PROVIDER"] }), "CAPABILITY_REQUIRED");
    const updated = await crm.updateAccount(crmDeps, governed, { accountId: acct.id, relationshipTypes: ["VENDOR", "FINANCING_PROVIDER"] });
    assert.deepEqual(updated.relationshipTypes, ["VENDOR", "FINANCING_PROVIDER"], "A: governed; VENDOR kept; CUSTOMER not implied");
    const arr = await fsale.recordFinancingArrangement(pool, sys, { salesAgreementId: id2, financingProviderAccountId: acct.id, arrangementKind: "LEASE",
      customerContributionMinor: 0, idempotencyKey: "gp-arr-a" });
    assert.equal(arr.status, "APPLIED", "Finance consumes the governed relationship");
    await refusedWith(crm.updateAccount(crmDeps, governed, { accountId: acct.id, relationshipTypes: ["VENDOR"] }), "FINANCING_PROVIDER_IN_USE");
  });

  await t.test("G (handoffs). activation attaches untouched handoffs; a handoff with delivery history is never re-pointed", async () => {
    const dests = (await adminAs(finAdmin, "listAccountingDestinations", { operatingCompanyId: "taylor" })).data.items;
    const active = dests.find((d) => d.status === "ACTIVE");
    const delivered = await q(`SELECT id, accounting_destination_id FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND status='READY_FOR_DELIVERY' AND operating_company_id='taylor' ORDER BY created_at LIMIT 2`, [TENANT]);
    assert.ok(delivered.rows.length >= 2, "two untouched READY handoffs exist");
    const [h1, h2] = delivered.rows;
    const adapter = deterministicAccountingAdapter(["RETRYABLE"]);
    const r = await delivery.deliverAccountingHandoff({ pool, adapters: { [adapter.key]: adapter } }, sys, { handoffId: h1.id, idempotencyKey: "gp-dl-1" });
    assert.equal(r.attemptOutcome, "FAILED_RETRYABLE");
    const c = await adminAs(finAdmin, "configureAccountingDestination", { operatingCompanyId: "taylor", displayName: "Taylor Ledger C", providerKey: TEST_ADAPTER_KEY, activate: true, reason: "replacement" });
    const after = Object.fromEntries((await q(`SELECT id, accounting_destination_id FROM eos_finance.accounting_handoffs WHERE id = ANY($1)`, [[h1.id, h2.id]])).rows.map((x) => [x.id, x.accounting_destination_id]));
    assert.equal(after[h1.id], h1.accounting_destination_id, "the attempted handoff keeps the destination it was attempted against");
    assert.equal(after[h2.id], c.data.destination.id, "the untouched READY handoff follows the company's new active destination");
    assert.ok(c.data.repointedUntouchedHandoffs >= 1, "Administration reports how many untouched handoffs followed the new destination");
    void active;
  });
});
