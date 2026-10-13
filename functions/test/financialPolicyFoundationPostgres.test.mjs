// FINANCIAL POLICY FOUNDATION (DECISIONS #232; migration 1764560000000; functions/src/eosFinance/financialPolicy.ts).
// Proofs over real PostgreSQL through the governed /operations/finance transport, in a LOCAL TEST TENANT built from the
// authority baseline (serviceBaselineTenant). Every grant below is made IN THIS TEST TENANT ONLY, through Administration,
// exactly as the Owner would; the migration itself grants nothing.
//
//   MIG    the migration registers four keys with ZERO grants, leaves every existing grant untouched, and its Down is guarded.
//   AUTH   Finance Manager / Controller prepare + submit; Owner approves + activates (grants); the Administrator reads,
//          approves and activates by STANDING (no grant) and cannot prepare; Sales / Service / Parts / Warehouse refused.
//   SOD    the preparer, an editor and the submitter can never approve or reject their own version -- even holding approve.
//   CO     Taylor and Ventana are independent; CONSOLIDATED / unknown / inactive companies refused.
//   LOCK   ACTIVE / SUPERSEDED / REJECTED immutable at the API and at the database; supersession keeps the old version intact.
//   VAL    the domain validator's rules: LIFO / STANDARD refused; unknown fields refused; the WORK_ORDER_CONSUMPTION gate.
//   NC     a company without an ACTIVE version reads NOT_CONFIGURED; no default method anywhere.
//   REPLAY re-sent commands change nothing; the history rebuilt from audit_events equals the stored versions.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const require = createRequire(import.meta.url);
const fp = require("../lib/eosFinance/financialPolicy.js");
const domain = require("../lib/finance/financialPolicyProfile.js");
const { PHYSICAL_CONSUMPTION_ACTIVE } = require("../lib/workOrderConsumption/consumptionActivation.js");
const { isImpliedForProtectedAdministrator, PROTECTED_ADMINISTRATOR_EXCLUSIONS } = require("../lib/adminPolicy/protectedAdministrator.js");
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-finpol";
const FIN = "/operations/finance";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS_DIR, "src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const KEYS = ["finance.policy.read", "finance.policy.prepare", "finance.policy.approve", "finance.policy.activate"];
const MIGRATION = "1764560000000_financial-policy-profiles";

const WA = Object.freeze({ inventoryCostMethod: "WEIGHTED_AVERAGE", serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION",
  cogsRecognitionPointId: "SALES_ORDER_FULFILLMENT", freightTreatment: "EXCLUDED", landedCostTreatment: "EXCLUDED" });
const FIFO = Object.freeze({ ...WA, inventoryCostMethod: "FIFO", cogsRecognitionPointId: "INVOICE_ISSUE" });

// ════════════════════ static ════════════════════

test("static: no Firebase in the PG Financial Policy module; PG-native keys only; the domain module is imported, not copied", () => {
  const src = strip(readFileSync(join(SRC, "eosFinance/financialPolicy.ts"), "utf8"));
  assert.doesNotMatch(src, /firebase|firestore|financialPolicyProfileCommand|permissionCatalog/i, "no Firebase, no Firestore command, no Firebase catalog");
  assert.match(src, /from "\.\.\/finance\/financialPolicyProfile"/, "validation is the pure domain module's");
  const domainSrc = strip(readFileSync(join(SRC, "finance/financialPolicyProfile.ts"), "utf8"));
  assert.doesNotMatch(domainSrc, /firebase|firestore/i, "the imported domain module is pure");
  const catalogIds = new Set(PERMISSION_CATALOG.map((p) => p.id));
  for (const k of KEYS) assert.equal(catalogIds.has(k), false, `${k} is PG-native -- absent from the Firebase PERMISSION_CATALOG (no reconcile grant to admin)`);
  assert.doesNotMatch(src, /\b(unlock|reopen|forceActivate|override)\w*\s*\(/i, "no unlock / reopen / force path");
});

test("static: the migration's vocabularies are exactly the domain module's", () => {
  const sql = readFileSync(join(FUNCTIONS_DIR, "migrations", `${MIGRATION}.sql`), "utf8");
  const listOf = (constraint) => {
    const m = new RegExp(`${constraint}\\s+CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`).exec(sql);
    assert.ok(m, constraint);
    return m[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  };
  assert.deepEqual(listOf("financial_policy_inventory_cost_method_supported"), [...domain.INVENTORY_COST_METHODS].sort());
  assert.deepEqual(listOf("financial_policy_serialized_cost_method_supported"), [...domain.SERIALIZED_COST_METHODS].sort());
  assert.deepEqual(listOf("financial_policy_recognition_point_known"), [...domain.COGS_RECOGNITION_POINT_IDS].sort());
  assert.deepEqual(listOf("financial_policy_freight_treatment_supported"), [...domain.FREIGHT_TREATMENTS].sort());
  assert.deepEqual(listOf("financial_policy_landed_cost_treatment_supported"), [...domain.LANDED_COST_TREATMENTS].sort());
  assert.doesNotMatch(sql.split("-- Down Migration")[0].replace(/--.*$/gm, ""), /INSERT INTO role_capabilities|INSERT INTO principal_capabilities|role_capability_decisions \(/,
    "the Up migration grants nothing");
});

test("standing: the Administrator's standing implies read / approve / activate and NOT prepare (#232, #223)", () => {
  const meta = { "finance.policy.read": "READ", "finance.policy.prepare": "EDIT", "finance.policy.approve": "ADMIN_ACTION", "finance.policy.activate": "ADMIN_ACTION" };
  const implied = Object.fromEntries(KEYS.map((k) => [k, isImpliedForProtectedAdministrator({ key: k, objectKey: "financialPolicy", actionKind: meta[k] })]));
  assert.deepEqual(implied, { "finance.policy.read": true, "finance.policy.prepare": false, "finance.policy.approve": true, "finance.policy.activate": true });
  for (const k of KEYS) assert.equal(PROTECTED_ADMINISTRATOR_EXCLUSIONS.has(k), false, `${k} needs no exclusion: its kind already gives the #232 outcome`);
});

test("validation: the domain validator's rules, and the WORK_ORDER_CONSUMPTION gate", () => {
  const code = (fn) => { try { fn(); return "OK"; } catch (e) { return e.code; } };
  const v = (policy, options) => code(() => fp.validateFinancialPolicyContent("taylor", policy, options));
  assert.equal(v(WA), "OK");
  assert.equal(v({ ...WA, inventoryCostMethod: "LIFO" }), "METHOD_UNSUPPORTED");
  assert.equal(v({ ...WA, inventoryCostMethod: "STANDARD_COST" }), "METHOD_UNSUPPORTED");
  assert.equal(v({ ...WA, inventoryCostMethod: "STANDARD" }), "METHOD_UNSUPPORTED");
  assert.equal(v({ ...WA, serializedInventoryCostMethod: "LIFO" }), "METHOD_UNSUPPORTED");
  assert.equal(v({ ...WA, cogsRecognitionPointId: "WAREHOUSE_TRANSFER" }), "RECOGNITION_UNSUPPORTED");
  assert.equal(v({ ...WA, freightTreatment: "CAPITALIZED" }), "TREATMENT_UNSUPPORTED");
  assert.equal(v({ ...WA, landedCostTreatment: "ALLOCATED" }), "TREATMENT_UNSUPPORTED");
  assert.equal(v({ ...WA, unknownCostTreatment: "ZERO" }), "PROFILE_MALFORMED", "an invariant is never a field");
  assert.equal(v({ ...WA, status: "LOCKED" }), "PROFILE_MALFORMED", "lifecycle is never content");
  assert.equal(v({ ...WA, inventoryCostMethod: undefined }), "METHOD_UNSUPPORTED", "a missing method is refused, never defaulted");
  assert.equal(v(null), "PROFILE_MALFORMED");
  // The real gate, read from the physical authority: WORK_ORDER_CONSUMPTION is selectable exactly when consumption is active.
  assert.equal(v({ ...WA, cogsRecognitionPointId: "WORK_ORDER_CONSUMPTION" }), PHYSICAL_CONSUMPTION_ACTIVE ? "OK" : "RECOGNITION_UNAVAILABLE");
  // With PHYSICAL_CONSUMPTION_ACTIVE false (the domain's own blocked shape), the same choice is refused.
  const gated = domain.COGS_RECOGNITION_POINTS.map((p) => p.id === "WORK_ORDER_CONSUMPTION" ? { ...p, available: false, blockedReason: "physical consumption is not active" } : p);
  assert.equal(v({ ...WA, cogsRecognitionPointId: "WORK_ORDER_CONSUMPTION" }, { recognitionPoints: gated }), "RECOGNITION_UNAVAILABLE");
  assert.equal(v({ ...WA, cogsRecognitionPointId: "EQUIPMENT_INSTALL" }, { recognitionPoints: gated }), "OK");
});

// ════════════════════ PostgreSQL ════════════════════

test("financial policy foundation over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person: staff, pool, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "finpol" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const fn = (who, operation, input) => call(who, FIN, operation, input);
  const dbUrl = pool.options.connectionString;
  const migrate = (direction, count) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", direction,
    "--migrations-dir", "migrations", "--no-check-order", String(count)], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });
  const grantSnapshot = async () => (await q(`SELECT r.key AS role, c.key AS cap FROM eos_policy.role_capabilities rc
      JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 ORDER BY 1, 2`, [TENANT])).rows;
  const directSnapshot = async () => (await q(`SELECT principal_id, capability_id FROM eos_policy.principal_capabilities WHERE tenant_id = $1 ORDER BY 1, 2`, [TENANT])).rows;
  const businessDate = async (company, plusDays = 0) =>
    (await one(`SELECT (eos_policy.operating_company_business_date($1, $2, now()) + $3::int)::text AS d`, [TENANT, company, plusDays])).d;
  const auditCount = async () => Number((await one(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = $2`,
    [TENANT, fp.FINANCIAL_POLICY_AUDIT_TARGET])).n);
  const dbRefusal = async (sql, v, pattern, what) => {
    await assert.rejects(q(sql, v), (e) => { assert.match(String(e.message), pattern, what); return true; }, what);
  };

  await t.test("MIG: four keys on financialPolicy, ZERO grants; existing grants untouched; Down guarded and reversible while empty", async () => {
    const caps = (await q(`SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key LIKE 'finance.policy.%' ORDER BY key`)).rows;
    assert.deepEqual(caps, [
      { key: "finance.policy.activate", object_key: "financialPolicy", action_key: "activate", action_kind: "ADMIN_ACTION" },
      { key: "finance.policy.approve", object_key: "financialPolicy", action_key: "approve", action_kind: "ADMIN_ACTION" },
      { key: "finance.policy.prepare", object_key: "financialPolicy", action_key: "prepare", action_kind: "EDIT" },
      { key: "finance.policy.read", object_key: "financialPolicy", action_key: "read", action_kind: "READ" },
    ]);
    const held = await one(`SELECT (SELECT count(*) FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key LIKE 'finance.policy.%')
      + (SELECT count(*) FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key LIKE 'finance.policy.%') AS n`);
    assert.equal(Number(held.n), 0, "after the seed, the baseline and the live Service delta, NO Role and no Principal holds a finance.policy.* key");
    const grantsBefore = await grantSnapshot();
    const directBefore = await directSnapshot();
    const capCount = async () => Number((await one(`SELECT count(*) AS n FROM eos_policy.capabilities`)).n);
    const capsUp = await capCount();
    migrate("down", 1);
    assert.equal(await capCount(), capsUp - 4, "Down removes exactly the four keys");
    assert.equal((await one(`SELECT to_regclass('eos_finance.financial_policy_versions') AS r`)).r, null);
    assert.deepEqual(await grantSnapshot(), grantsBefore, "the migration's presence moves no existing grant");
    migrate("up", 1);
    assert.equal(await capCount(), capsUp);
    assert.deepEqual(await grantSnapshot(), grantsBefore, "re-applied: every existing Role grant is exactly as before");
    assert.deepEqual(await directSnapshot(), directBefore);
    // The existing Finance read, pinned as the baseline measures it: the migration moves none of its holders.
    assert.deepEqual(grantsBefore.filter((g) => g.cap === "finance.payment.read").map((g) => g.role), ["accountingManager", "admin", "controller",
      "fieldManager", "financeManager", "generalManager", "owner", "partsAssociate", "partsManager", "purchasingManager", "salesManager", "salesperson",
      "shopAssociate", "shopManager"]);
  });

  // ── people (test tenant only). The protected Owner Role is staffed by the fixture seam (Administration never assigns it). ──
  const person = async (subject, roleKeys, employee) => {
    const who = await staff(subject, roleKeys.filter((k) => k !== "owner"), employee);
    if (roleKeys.includes("owner")) await seedProtectedOwner(repo, { tenantId: TENANT, principalId: who.principalId });
    return who;
  };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only (#232 proposed grant)" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 300)}`);
  };
  const fm = await person("uid-fp-fm", ["financeManager"], { id: "e-fp-fm", name: "Frances Finance" });
  const ctrl = await person("uid-fp-ctrl", ["controller"], { id: "e-fp-ctrl", name: "Sage Controller" });
  const own = await person("uid-fp-owner", ["owner"], { id: "e-fp-owner", name: "Olive Owner" });
  const adm = await person("uid-fp-admin", ["admin"], { id: "e-fp-admin", name: "Rowan Administrator" });
  const dual = await person("uid-fp-dual", ["controller", "owner"], { id: "e-fp-dual", name: "Dana Dual" });
  const acct = await person("uid-fp-acct", ["accountingManager"], { id: "e-fp-acct", name: "Avery Accounting" });
  const gm = await person("uid-fp-gm", ["generalManager"], { id: "e-fp-gm", name: "Glen General" });
  const outsiders = {
    salesperson: await person("uid-fp-sales", ["salesperson"], { id: "e-fp-sales", name: "Riley Retail" }),
    technician: await person("uid-fp-tech", ["technician"], { id: "e-fp-tech", name: "Finley Tech", technician: true }),
    partsManager: await person("uid-fp-pm", ["partsManager", "purchasingManager"], { id: "e-fp-pm", name: "Morgan Parts" }),
    warehouseManager: await person("uid-fp-whm", ["warehouseManager"], { id: "e-fp-whm", name: "Casey Warehouse" }),
    dispatcher: await person("uid-fp-disp", ["dispatcher"], { id: "e-fp-disp", name: "Emerson Dispatch" }),
  };

  await t.test("NC: before any grant or version, Taylor and Ventana read NOT_CONFIGURED with no default (Administrator by standing)", async () => {
    for (const company of ["taylor", "ventana"]) {
      const r = ok(await fn(adm, "readFinancialPolicy", { operatingCompanyId: company }), `admin read ${company}`);
      assert.equal(r.state, "NOT_CONFIGURED");
      assert.equal(r.active, null);
      assert.equal(r.inFlight, null);
      assert.equal(JSON.stringify(r).includes("defaultMethod"), false);
      assert.deepEqual(ok(await fn(adm, "listFinancialPolicyVersions", { operatingCompanyId: company })).items, []);
      const resolved = await fp.resolveActiveFinancialPolicy(pool, TENANT, company);
      assert.deepEqual({ ...resolved }, { state: "NOT_CONFIGURED", policy: null, version: null }, "the consumer read fails closed");
    }
    // Before the Owner's grants, nobody but the Administrator's standing reaches the keys.
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(own, "readFinancialPolicy", { operatingCompanyId: "taylor" }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(adm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), 403, "CAPABILITY_REQUIRED",
      "standing never implies prepare (EDIT)");
  });

  // The PROPOSED #232 grants, executed here in the test tenant only.
  for (const role of ["financeManager", "controller"]) for (const key of ["finance.policy.read", "finance.policy.prepare"]) await grant(role, key);
  for (const key of ["finance.policy.read", "finance.policy.approve", "finance.policy.activate"]) await grant("owner", key);

  await t.test("AUTH: unauthorized roles are refused every lifecycle action (CAPABILITY_REQUIRED), including accountingManager and generalManager", async () => {
    const ops = [
      ["readFinancialPolicy", { operatingCompanyId: "taylor" }], ["listFinancialPolicyVersions", { operatingCompanyId: "taylor" }],
      ["saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }], ["submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x" }],
      ["approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x" }], ["rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x", reason: "r" }],
      ["activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x", effectiveDate: "2099-01-01" }],
    ];
    for (const [name, who] of [...Object.entries(outsiders), ["accountingManager", acct], ["generalManager", gm]]) {
      for (const [op, input] of ops) refused(await fn(who, op, input), 403, "CAPABILITY_REQUIRED", `${name} ${op}`);
    }
    // Preparers cannot decide; approvers cannot prepare.
    refused(await fn(fm, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x" }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(ctrl, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x", effectiveDate: "2099-01-01" }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(own, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), 403, "CAPABILITY_REQUIRED");
    // No Sales / Service / Parts / Warehouse role holds anything on financialPolicy.
    const leaked = (await q(`SELECT r.key, c.key AS cap FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.object_key = 'financialPolicy' ORDER BY 1, 2`, [TENANT])).rows;
    assert.deepEqual(leaked.map((x) => `${x.key}/${x.cap}`), [
      "controller/finance.policy.prepare", "controller/finance.policy.read", "financeManager/finance.policy.prepare", "financeManager/finance.policy.read",
      "owner/finance.policy.activate", "owner/finance.policy.approve", "owner/finance.policy.read"]);
  });

  await t.test("VAL + CO: refusals through the transport; company scope", async () => {
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: { ...WA, inventoryCostMethod: "LIFO" } }), 400, "METHOD_UNSUPPORTED");
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: { ...WA, inventoryCostMethod: "STANDARD_COST" } }), 400, "METHOD_UNSUPPORTED");
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: { ...WA, unknownCostTreatment: "ZERO" } }), 400, "PROFILE_MALFORMED");
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: { ...WA, freightTreatment: "CAPITALIZED" } }), 400, "TREATMENT_UNSUPPORTED");
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA, status: "ACTIVE" }), 400, "FIELD_NOT_ACCEPTED");
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "consolidated", policy: WA }), 400, "CONSOLIDATED_NOT_A_COMPANY");
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "saratoga", policy: WA }), 400, "OPERATING_COMPANY_UNKNOWN");
    refused(await fn(fm, "saveFinancialPolicyDraft", { policy: WA }), 400, "OPERATING_COMPANY_UNKNOWN");
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'dormant','INACTIVE','fixture','fixture','fixture')`, [TENANT]);
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "dormant", policy: WA }), 400, "OPERATING_COMPANY_UNKNOWN", "an inactive company");
    refused(await fn(fm, "readFinancialPolicy", { operatingCompanyId: "dormant" }), 400, "OPERATING_COMPANY_UNKNOWN");
    assert.equal(await auditCount(), 0, "no refusal wrote anything");
    // The database refuses an unsupported method even on a direct write.
    await dbRefusal(`INSERT INTO eos_finance.financial_policy_versions (id, tenant_id, operating_company_id, version_number, status, inventory_cost_method,
        serialized_inventory_cost_method, cogs_recognition_point, freight_treatment, landed_cost_treatment, prepared_by, content_authors, last_edited_by)
      VALUES ('fpv-lifo',$1,'taylor',99,'DRAFT','LIFO','FIFO','INVOICE_ISSUE','EXCLUDED','EXCLUDED','x',ARRAY['x'],'x')`, [TENANT], /inventory_cost_method_supported/, "LIFO");
    await dbRefusal(`INSERT INTO eos_finance.financial_policy_versions (id, tenant_id, operating_company_id, version_number, status, inventory_cost_method,
        serialized_inventory_cost_method, cogs_recognition_point, freight_treatment, landed_cost_treatment, prepared_by, content_authors, last_edited_by, submitted_by, submitted_at)
      VALUES ('fpv-born-active',$1,'taylor',98,'SUBMITTED','FIFO','FIFO','INVOICE_ISSUE','EXCLUDED','EXCLUDED','x',ARRAY['x'],'x','x',now())`, [TENANT],
    /FINANCIAL_POLICY_TRANSITION_ILLEGAL/, "a version is born DRAFT");
  });

  let taylorV1;
  await t.test("AUTH + SOD: Finance Manager prepares, Controller edits, Finance Manager submits; no preparer decides; Owner approves + activates", async () => {
    const created = ok(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA, reason: "deployment" }), "fm draft");
    assert.equal(created.replayed, false);
    taylorV1 = created.version;
    assert.deepEqual([taylorV1.status, taylorV1.versionNumber, taylorV1.preparedBy, taylorV1.locked], ["DRAFT", 1, fm.principalId, false]);
    refused(await fn(ctrl, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: FIFO }), 409, "FINANCIAL_POLICY_IN_FLIGHT_EXISTS",
      "one version in flight per company");
    const edited = ok(await fn(ctrl, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", versionId: taylorV1.id,
      policy: { ...WA, cogsRecognitionPointId: "INVOICE_ISSUE" } }), "controller edit").version;
    assert.deepEqual(edited.contentAuthors, [fm.principalId, ctrl.principalId]);
    const submitted = ok(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id }), "fm submit").version;
    assert.equal(submitted.status, "SUBMITTED");
    refused(await fn(ctrl, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", versionId: taylorV1.id, policy: WA }), 409, "FINANCIAL_POLICY_NOT_EDITABLE",
      "content freezes at submit");
    // The Controller edited it: even holding approve (dual: controller + owner), an author never decides.
    const dualEdit = ok(await fn(dual, "readFinancialPolicy", { operatingCompanyId: "taylor" }));
    assert.equal(dualEdit.inFlight.status, "SUBMITTED");
    refused(await fn(fm, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id, effectiveDate: await businessDate("taylor") }),
      409, "FINANCIAL_POLICY_NOT_APPROVED", "a SUBMITTED version is not activated");
    const approved = ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id, reason: "accounting team sign-off" }), "owner approve").version;
    assert.deepEqual([approved.status, approved.approvedBy, approved.decisionReason], ["APPROVED", own.principalId, "accounting team sign-off"]);
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id, effectiveDate: await businessDate("taylor", -1) }),
      400, "EFFECTIVE_DATE_PAST");
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id, effectiveDate: "2030-02-30" }), 400, "EFFECTIVE_DATE_REQUIRED");
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id }), 400, "EFFECTIVE_DATE_REQUIRED");
    const activeDate = await businessDate("taylor");
    const act = ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id, effectiveDate: activeDate }), "owner activate");
    assert.equal(act.superseded, null);
    taylorV1 = act.version;
    assert.deepEqual([taylorV1.status, taylorV1.locked, taylorV1.activatedBy, taylorV1.effectiveDate], ["ACTIVE", true, own.principalId, activeDate]);
    const read = ok(await fn(fm, "readFinancialPolicy", { operatingCompanyId: "taylor" }));
    assert.deepEqual([read.state, read.active.id, read.inFlight], ["CONFIGURED", taylorV1.id, null]);
    assert.equal(read.active.policy.cogsRecognitionPointId, "INVOICE_ISSUE");
  });

  await t.test("SOD: the preparer / submitter never approves or rejects their own version, even holding approve", async () => {
    // Ventana v1: prepared and submitted by `dual` (controller + owner -- holds prepare AND approve).
    const v = ok(await fn(dual, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: FIFO }), "dual draft").version;
    ok(await fn(dual, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), "dual submit");
    refused(await fn(dual, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), 403, "SEPARATION_OF_DUTIES");
    refused(await fn(dual, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, reason: "own" }), 403, "SEPARATION_OF_DUTIES");
    // The database holds the same line even against a direct write.
    await dbRefusal(`UPDATE eos_finance.financial_policy_versions SET status = 'APPROVED', approved_by = submitted_by, approved_at = now() WHERE id = $1`,
      [v.id], /financial_policy_approver_independent/, "approver == submitter");
    // A reject needs a reason; an independent Owner rejects it -> final.
    refused(await fn(own, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), 400, "REASON_REQUIRED");
    const rej = ok(await fn(own, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, reason: "Ventana's accounting team chose weighted average" })).version;
    assert.deepEqual([rej.status, rej.rejectedBy], ["REJECTED", own.principalId]);
    refused(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), 409, "FINANCIAL_POLICY_NOT_SUBMITTED");
    refused(await fn(dual, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", versionId: v.id, policy: WA }), 409, "FINANCIAL_POLICY_NOT_EDITABLE");
    await dbRefusal(`UPDATE eos_finance.financial_policy_versions SET status = 'SUBMITTED' WHERE id = $1`, [v.id], /FINANCIAL_POLICY_TRANSITION_ILLEGAL/, "REJECTED is final");
    await dbRefusal(`DELETE FROM eos_finance.financial_policy_versions WHERE id = $1`, [v.id], /FINANCIAL_POLICY_IMMUTABLE/, "never deleted");
  });

  let ventanaV2;
  await t.test("AUTH: Controller prepares + submits; the Administrator approves + activates by STANDING (no grant), with provenance", async () => {
    const v = ok(await fn(ctrl, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }), "ctrl draft").version;
    assert.equal(v.versionNumber, 2, "Ventana's own numbering: v1 was rejected and kept");
    ok(await fn(ctrl, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }));
    const adminGrants = await one(`SELECT count(*) AS n FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND r.key = 'admin' AND c.key LIKE 'finance.policy.%'`, [TENANT]);
    assert.equal(Number(adminGrants.n), 0, "the Administrator holds no finance.policy.* grant");
    ok(await fn(adm, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), "admin approve");
    ventanaV2 = ok(await fn(adm, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, effectiveDate: await businessDate("ventana", 3) }),
      "admin activate").version;
    assert.deepEqual([ventanaV2.status, ventanaV2.approvedBy, ventanaV2.activatedBy], ["ACTIVE", adm.principalId, adm.principalId]);
    const ev = await one(`SELECT after FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = $2 AND action = 'finance.policy.activate'`, [TENANT, v.id]);
    assert.equal(ev.after.authorizedBy?.standing, "PROTECTED_ADMINISTRATOR", "the standing-authorized act is marked in the audit trail");
  });

  await t.test("CO: Taylor and Ventana are independent", async () => {
    const taylor = ok(await fn(own, "readFinancialPolicy", { operatingCompanyId: "taylor" }));
    const ventana = ok(await fn(own, "readFinancialPolicy", { operatingCompanyId: "ventana" }));
    assert.deepEqual([taylor.active.id, taylor.active.policy.inventoryCostMethod], [taylorV1.id, "WEIGHTED_AVERAGE"]);
    assert.deepEqual([ventana.active.id, ventana.active.versionNumber], [ventanaV2.id, 2]);
    // A version id is reachable only through its own company.
    refused(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: ventanaV2.id }), 404, "FINANCIAL_POLICY_VERSION_NOT_FOUND");
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: taylorV1.id, effectiveDate: await businessDate("ventana", 9) }),
      404, "FINANCIAL_POLICY_VERSION_NOT_FOUND");
    assert.deepEqual(ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "taylor" })).items.map((v) => v.versionNumber), [1]);
    assert.deepEqual(ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "ventana" })).items.map((v) => [v.versionNumber, v.status]),
      [[2, "ACTIVE"], [1, "REJECTED"]]);
    // The database refuses a cross-company supersession.
    await dbRefusal(`UPDATE eos_finance.financial_policy_versions SET status = 'SUPERSEDED', superseded_by_version_id = $2, superseded_at = now() WHERE id = $1`,
      [taylorV1.id, ventanaV2.id], /FINANCIAL_POLICY_LOCKED/, "cross-company supersession");
  });

  await t.test("LOCK: an ACTIVE version is immutable at the API and at the database", async () => {
    const before = ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "taylor" })).items;
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", versionId: taylorV1.id, policy: FIFO }), 409, "FINANCIAL_POLICY_LOCKED");
    refused(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id }), 409, "FINANCIAL_POLICY_LOCKED");
    refused(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id }), 409, "FINANCIAL_POLICY_NOT_SUBMITTED");
    refused(await fn(own, "rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id, reason: "undo" }), 409, "FINANCIAL_POLICY_NOT_SUBMITTED");
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: taylorV1.id, effectiveDate: await businessDate("taylor", 30) }),
      409, "FINANCIAL_POLICY_LOCKED");
    for (const [sql, what] of [
      [`UPDATE eos_finance.financial_policy_versions SET inventory_cost_method = 'FIFO' WHERE id = $1`, "method"],
      [`UPDATE eos_finance.financial_policy_versions SET effective_date = effective_date + 1 WHERE id = $1`, "effective date"],
      [`UPDATE eos_finance.financial_policy_versions SET activated_by = 'someone-else' WHERE id = $1`, "activator"],
      [`UPDATE eos_finance.financial_policy_versions SET status = 'DRAFT', submitted_by = NULL, submitted_at = NULL, approved_by = NULL, approved_at = NULL,
          decision_reason = NULL, activated_by = NULL, activated_at = NULL, effective_date = NULL WHERE id = $1`, "unlock to DRAFT"],
      [`UPDATE eos_finance.financial_policy_versions SET updated_at = now() WHERE id = $1`, "a no-op touch"],
      [`DELETE FROM eos_finance.financial_policy_versions WHERE id = $1`, "delete"],
    ]) await dbRefusal(sql, [taylorV1.id], /FINANCIAL_POLICY_(IMMUTABLE|TRANSITION_ILLEGAL|LOCKED)/, what);
    // A supersession that does not commit with an activation is refused at COMMIT (deferred).
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const draft = await c.query(`INSERT INTO eos_finance.financial_policy_versions (id, tenant_id, operating_company_id, version_number, status, inventory_cost_method,
          serialized_inventory_cost_method, cogs_recognition_point, freight_treatment, landed_cost_treatment, prepared_by, content_authors, last_edited_by)
        VALUES ('fpv-orphan',$1,'taylor',50,'DRAFT','FIFO','FIFO','INVOICE_ISSUE','EXCLUDED','EXCLUDED','p',ARRAY['p'],'p') RETURNING id`, [TENANT]);
      await c.query(`UPDATE eos_finance.financial_policy_versions SET status = 'SUBMITTED', submitted_by = 'p', submitted_at = now() WHERE id = $1`, [draft.rows[0].id]);
      await c.query(`UPDATE eos_finance.financial_policy_versions SET status = 'APPROVED', approved_by = 'q', approved_at = now() WHERE id = $1`, [draft.rows[0].id]);
      await c.query(`UPDATE eos_finance.financial_policy_versions SET status = 'SUPERSEDED', superseded_by_version_id = 'fpv-orphan', superseded_at = now() WHERE id = $1`, [taylorV1.id]);
      await assert.rejects(c.query("COMMIT"), /FINANCIAL_POLICY_SUPERSESSION_INCOMPLETE/);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
    assert.deepEqual(ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "taylor" })).items, before, "nothing moved");
  });

  await t.test("REVISION: a new version supersedes the ACTIVE one in the same transaction; the old one is preserved intact", async () => {
    const v1Before = ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "taylor" })).items.find((v) => v.id === taylorV1.id);
    const v2 = ok(await fn(ctrl, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: FIFO, reason: "governed revision" })).version;
    assert.equal(v2.versionNumber, 2);
    const mid = ok(await fn(fm, "readFinancialPolicy", { operatingCompanyId: "taylor" }));
    assert.deepEqual([mid.state, mid.active.id, mid.inFlight.id], ["CONFIGURED", taylorV1.id, v2.id], "the ACTIVE version governs while the revision is in flight");
    ok(await fn(ctrl, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: v2.id }));
    ok(await fn(adm, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: v2.id }));
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: v2.id, effectiveDate: taylorV1.effectiveDate }),
      400, "EFFECTIVE_DATE_NOT_AFTER_PRIOR");
    const out = ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: v2.id, effectiveDate: await businessDate("taylor", 1) }));
    assert.equal(out.version.status, "ACTIVE");
    assert.equal(out.superseded.id, taylorV1.id);
    const v1After = ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "taylor" })).items.find((v) => v.id === taylorV1.id);
    assert.equal(v1After.status, "SUPERSEDED");
    assert.equal(v1After.supersededByVersionId, v2.id);
    const keep = ({ status, locked, supersededByVersionId, supersededAt, ...rest }) => rest;
    assert.deepEqual(keep(v1After), keep(v1Before), "every recorded fact of the superseded version is intact");
    await dbRefusal(`UPDATE eos_finance.financial_policy_versions SET status = 'ACTIVE', superseded_by_version_id = NULL, superseded_at = NULL WHERE id = $1`,
      [taylorV1.id], /FINANCIAL_POLICY_(TRANSITION_ILLEGAL|IMMUTABLE)/, "SUPERSEDED never returns");
    assert.equal(Number((await one(`SELECT count(*) AS n FROM eos_finance.financial_policy_versions WHERE tenant_id = $1 AND operating_company_id = 'taylor' AND status = 'ACTIVE'`, [TENANT])).n), 1);
    const resolved = await fp.resolveActiveFinancialPolicy(pool, TENANT, "taylor");
    assert.deepEqual([resolved.state, resolved.policy.inventoryCostMethod], ["ACTIVE", "FIFO"]);
  });

  await t.test("VAL + SOD: an editor never approves; an activation re-validates -- a recognition gate that closed after approval stops it", async () => {
    const v = ok(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor",
      policy: { ...WA, cogsRecognitionPointId: "EQUIPMENT_INSTALL" } }), "draft").version;
    // `dual` (controller + owner) EDITS it; Finance Manager submits. An editor is an author: dual may not decide it.
    ok(await fn(dual, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", versionId: v.id,
      policy: { ...WA, cogsRecognitionPointId: "WORK_ORDER_CONSUMPTION" } }), "WORK_ORDER_CONSUMPTION edit (gate open)");
    ok(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id }));
    refused(await fn(dual, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id }), 403, "SEPARATION_OF_DUTIES", "an editor never approves");
    ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id }));
    const gated = domain.COGS_RECOGNITION_POINTS.map((p) => p.id === "WORK_ORDER_CONSUMPTION" ? { ...p, available: false, blockedReason: "physical consumption is not active" } : p);
    const owner = { tenantId: TENANT, principalId: own.principalId, capabilities: new Set(["finance.policy.activate"]) };
    await assert.rejects(fp.activateFinancialPolicy(pool, owner, { operatingCompanyId: "taylor", versionId: v.id, effectiveDate: await businessDate("taylor", 5) },
      { recognitionPoints: gated }), (e) => e.code === "RECOGNITION_UNAVAILABLE");
    const still = ok(await fn(fm, "readFinancialPolicy", { operatingCompanyId: "taylor" }));
    assert.deepEqual([still.inFlight.id, still.inFlight.status, still.active.policy.inventoryCostMethod], [v.id, "APPROVED", "FIFO"]);
  });

  await t.test("REPLAY: re-sent commands change nothing; the history rebuilt from audit_events equals the stored versions", async () => {
    const versions = async () => [...ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "taylor" })).items,
      ...ok(await fn(fm, "listFinancialPolicyVersions", { operatingCompanyId: "ventana" })).items];
    // A fresh Ventana revision, then every command re-sent.
    const draft = ok(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: FIFO }));
    const again = ok(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: FIFO }));
    assert.deepEqual([again.replayed, again.version], [true, draft.version]);
    const auditBefore = await auditCount();
    const stateBefore = await versions();
    const id = draft.version.id;
    assert.equal(ok(await fn(ctrl, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", versionId: id, policy: FIFO })).replayed, true,
      "identical content from another preparer is a replay, and does not make them an author");
    assert.deepEqual(await versions(), stateBefore);
    assert.equal(await auditCount(), auditBefore);
    const sub = ok(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }));
    const subAgain = ok(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }));
    assert.deepEqual([subAgain.replayed, subAgain.version], [true, sub.version]);
    const app = ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }));
    assert.deepEqual(ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: id })).version, app.version);
    refused(await fn(adm, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }), 409, "FINANCIAL_POLICY_NOT_SUBMITTED",
      "a second approver is not a replay");
    const date = await businessDate("ventana", 10);
    const act = ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, effectiveDate: date }));
    const settled = await versions();
    const settledAudit = await auditCount();
    const actAgain = ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, effectiveDate: date }));
    assert.deepEqual([actAgain.replayed, actAgain.version], [true, act.version]);
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, effectiveDate: await businessDate("ventana", 11) }),
      409, "FINANCIAL_POLICY_LOCKED", "a different activation of a locked version is not a replay");
    assert.deepEqual(await versions(), settled, "replays leave the state identical");
    assert.equal(await auditCount(), settledAudit, "replays write no audit");
    // Rebuild every version from the audit trail alone.
    const events = (await q(`SELECT action, target_id, before, after FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = $2
      ORDER BY occurred_at, id`, [TENANT, fp.FINANCIAL_POLICY_AUDIT_TARGET])).rows.map((e) => ({ action: e.action, targetId: e.target_id, before: e.before, after: e.after }));
    const rebuilt = fp.rebuildFinancialPolicyVersions(events);
    const stored = (await q(`SELECT *, effective_date::text AS effective_date_text FROM eos_finance.financial_policy_versions WHERE tenant_id = $1`, [TENANT])).rows
      .map(fp.versionView);
    assert.equal(rebuilt.size, stored.length);
    for (const v of stored) assert.deepEqual(rebuilt.get(v.id), JSON.parse(JSON.stringify(v)), `version ${v.operatingCompanyId} v${v.versionNumber} rebuilt from history`);
    const actions = [...new Set(events.map((e) => e.action))].sort();
    assert.deepEqual(actions, ["finance.policy.activate", "finance.policy.approve", "finance.policy.draft.create", "finance.policy.draft.edit",
      "finance.policy.reject", "finance.policy.submit", "finance.policy.supersede"]);
    // A tampered history does not rebuild.
    const tampered = events.map((e, i) => (i === 1 ? { ...e, before: { ...e.before, status: "ACTIVE" } } : e));
    assert.throws(() => fp.rebuildFinancialPolicyVersions(tampered), /FINANCIAL_POLICY_HISTORY_BROKEN/);
  });

  await t.test("MIG: with versions recorded, the Down refuses to reverse", async () => {
    assert.throws(() => migrate("down", 1), (e) => /FINANCIAL_POLICY_FOUNDATION: refuses to reverse/.test(String(e.stderr ?? e.message)));
    assert.notEqual((await one(`SELECT to_regclass('eos_finance.financial_policy_versions') AS r`)).r, null);
  });
});
