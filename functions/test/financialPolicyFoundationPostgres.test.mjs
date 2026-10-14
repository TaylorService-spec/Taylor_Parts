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
  // #232 Phase 1: the finance Roles stay UNCHANGED; preparers hold a CUSTOM Financial Policy Preparer Role (created here,
  // in the test tenant only, with no capability until the grants below), assigned alongside their finance Role.
  assert.equal((await admin("createRole", { key: "financialPolicyPreparer", name: "Financial Policy Preparer",
    reason: "local test tenant only (#232 Phase 1: a custom Role with exactly read + prepare)" })).ok, true);
  const fm = await person("uid-fp-fm", ["financeManager", "financialPolicyPreparer"], { id: "e-fp-fm", name: "Frances Finance" });
  const ctrl = await person("uid-fp-ctrl", ["controller", "financialPolicyPreparer"], { id: "e-fp-ctrl", name: "Sage Controller" });
  const own = await person("uid-fp-owner", ["owner"], { id: "e-fp-owner", name: "Olive Owner" });
  const adm = await person("uid-fp-admin", ["admin"], { id: "e-fp-admin", name: "Rowan Administrator" });
  const dual = await person("uid-fp-dual", ["controller", "financialPolicyPreparer", "owner"], { id: "e-fp-dual", name: "Dana Dual" });
  const acct = await person("uid-fp-acct", ["accountingManager"], { id: "e-fp-acct", name: "Avery Accounting" });
  const gm = await person("uid-fp-gm", ["generalManager"], { id: "e-fp-gm", name: "Glen General" });
  const ctrlOnly = await person("uid-fp-ctrl-only", ["controller"], { id: "e-fp-ctrl-only", name: "Cal Controller" });
  const fmOnly = await person("uid-fp-fm-only", ["financeManager"], { id: "e-fp-fm-only", name: "Fay Finance" });
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
      assert.deepEqual([r.inForce, r.scheduled, r.inFlight], [null, null, null]);
      assert.equal(JSON.stringify(r).includes("defaultMethod"), false);
      assert.deepEqual(ok(await fn(adm, "listFinancialPolicyVersions", { operatingCompanyId: company })).items, []);
      const resolved = await fp.resolveFinancialPolicyInForce(pool, TENANT, company);
      assert.deepEqual({ ...resolved }, { state: "NOT_CONFIGURED", asOf: await businessDate(company), policy: null, version: null }, "the consumer read fails closed");
    }
    // Before the Owner's grants, nobody but the Administrator's standing reaches the keys.
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(own, "readFinancialPolicy", { operatingCompanyId: "taylor" }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(adm, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), 403, "CAPABILITY_REQUIRED",
      "standing never implies prepare (EDIT)");
  });

  // The #232 Phase 1 shape, executed here in the test tenant only: the Preparer Role gets read + prepare; the Owner Role its
  // reserved approve / activate (+ read). controller / financeManager / accountingManager get NOTHING.
  for (const key of ["finance.policy.read", "finance.policy.prepare"]) await grant("financialPolicyPreparer", key);
  for (const key of ["finance.policy.read", "finance.policy.approve", "finance.policy.activate"]) await grant("owner", key);

  await t.test("AUTH: unauthorized roles are refused every lifecycle action (CAPABILITY_REQUIRED), including accountingManager and generalManager", async () => {
    const ops = [
      ["readMyFinancialPolicyAuthority", {}],
      ["readFinancialPolicy", { operatingCompanyId: "taylor" }], ["listFinancialPolicyVersions", { operatingCompanyId: "taylor" }],
      ["saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }], ["submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x" }],
      ["approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x" }], ["rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x", reason: "r" }],
      ["activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: "x", effectiveDate: "2099-01-01" }],
    ];
    for (const [name, who] of [...Object.entries(outsiders), ["accountingManager", acct], ["generalManager", gm],
      ["controller (unchanged Role)", ctrlOnly], ["financeManager (unchanged Role)", fmOnly]]) {
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
      "financialPolicyPreparer/finance.policy.prepare", "financialPolicyPreparer/finance.policy.read", "owner/finance.policy.activate", "owner/finance.policy.approve", "owner/finance.policy.read"]);
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
    assert.deepEqual([read.state, read.inForce.id, read.scheduled, read.inFlight], ["CONFIGURED", taylorV1.id, null, null], "dated today: in force at once");
    assert.equal(read.inForce.policy.cogsRecognitionPointId, "INVOICE_ISSUE");
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
    // A write that raced past the server's check and hit the CHECK answers SEPARATION_OF_DUTIES (403), never a 500.
    const raced = await q(`UPDATE eos_finance.financial_policy_versions SET status = 'REJECTED', rejected_by = submitted_by, rejected_at = now(),
      decision_reason = 'own' WHERE id = $1`, [v.id]).then(() => null, (e) => e);
    assert.equal(raced?.code, "23514");
    const mapped = fp.translateDatabaseRefusal(raced);
    assert.deepEqual([mapped.name, mapped.code, mapped.category], ["FinancialPolicyRefusal", "SEPARATION_OF_DUTIES", "FORBIDDEN"]);
    // A reject needs a reason; an independent Owner rejects it -> final.
    refused(await fn(own, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), 400, "REASON_REQUIRED");
    const rej = ok(await fn(own, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, reason: "Ventana's accounting team chose weighted average" })).version;
    assert.deepEqual([rej.status, rej.rejectedBy], ["REJECTED", own.principalId]);
    assert.equal(ok(await fn(own, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id,
      reason: "Ventana's accounting team chose weighted average" })).replayed, true, "an identical reject is a replay");
    refused(await fn(own, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, reason: "a different reason" }),
      409, "FINANCIAL_POLICY_REPLAY_CONFLICT", "a re-sent reject with another reason is not silently dropped");
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
    assert.deepEqual([taylor.inForce.id, taylor.inForce.policy.inventoryCostMethod], [taylorV1.id, "WEIGHTED_AVERAGE"]);
    // Ventana's FIRST-EVER activation is dated business date + 3: SCHEDULED, and Ventana is NOT_CONFIGURED until then.
    assert.deepEqual([ventana.state, ventana.inForce, ventana.scheduled.id, ventana.scheduled.status], ["NOT_CONFIGURED", null, ventanaV2.id, "ACTIVE"]);
    assert.equal((await fp.resolveFinancialPolicyInForce(pool, TENANT, "ventana")).state, "NOT_CONFIGURED");
    assert.equal((await fp.resolveFinancialPolicyInForce(pool, TENANT, "ventana", await businessDate("ventana", 2))).state, "NOT_CONFIGURED");
    const onDate = ok(await fn(own, "readFinancialPolicy", { operatingCompanyId: "ventana", asOfDate: await businessDate("ventana", 3) }));
    assert.deepEqual([onDate.state, onDate.inForce.id, onDate.inForce.versionNumber, onDate.scheduled], ["CONFIGURED", ventanaV2.id, 2, null]);
    refused(await fn(own, "readFinancialPolicy", { operatingCompanyId: "ventana", asOfDate: "2030-13-01" }), 400, "DATE_INVALID");
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
    assert.deepEqual([mid.state, mid.inForce.id, mid.inFlight.id], ["CONFIGURED", taylorV1.id, v2.id], "the version in force governs while the revision is in flight");
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
    // FUTURE-DATED activation (business date + 1): v2 is ACTIVE (locked) and v1 SUPERSEDED, but v1 stays IN FORCE until v2's date.
    assert.equal(v1After.effectiveDate, taylorV1.effectiveDate, "the SUPERSEDED row keeps its own effective date");
    const today = await fp.resolveFinancialPolicyInForce(pool, TENANT, "taylor");
    assert.deepEqual([today.state, today.version.id, today.version.status, today.policy.inventoryCostMethod], ["IN_FORCE", taylorV1.id, "SUPERSEDED", "WEIGHTED_AVERAGE"]);
    const tomorrow = await fp.resolveFinancialPolicyInForce(pool, TENANT, "taylor", await businessDate("taylor", 1));
    assert.deepEqual([tomorrow.version.id, tomorrow.policy.inventoryCostMethod], [v2.id, "FIFO"]);
    const read = ok(await fn(fm, "readFinancialPolicy", { operatingCompanyId: "taylor" }));
    assert.deepEqual([read.state, read.inForce.id, read.scheduled.id], ["CONFIGURED", taylorV1.id, v2.id]);
    const later = ok(await fn(fm, "readFinancialPolicy", { operatingCompanyId: "taylor", asOfDate: await businessDate("taylor", 30) }));
    assert.deepEqual([later.inForce.id, later.scheduled], [v2.id, null]);
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
    assert.deepEqual([still.inFlight.id, still.inFlight.status, still.scheduled.policy.inventoryCostMethod], [v.id, "APPROVED", "FIFO"]);
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
    // A re-send that differs only by its note is NOT a replay: refused, never answered replayed with the note dropped.
    refused(await fn(fm, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: FIFO, reason: "a new note" }), 409, "FINANCIAL_POLICY_REPLAY_CONFLICT");
    refused(await fn(ctrl, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", versionId: id, policy: FIFO, reason: "a new note" }),
      409, "FINANCIAL_POLICY_REPLAY_CONFLICT");
    // DATABASE defence in depth on a DRAFT: authorship only grows, the preparer never changes, TRUNCATE is refused.
    // (Inside a rolled-back transaction: give the draft a second author, then try to drop it.)
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`UPDATE eos_finance.financial_policy_versions SET content_authors = content_authors || 'second-author'::text WHERE id = $1`, [id]);
      await assert.rejects(c.query(`UPDATE eos_finance.financial_policy_versions SET content_authors = content_authors[1:1], last_edited_by = prepared_by WHERE id = $1`, [id]),
        /FINANCIAL_POLICY_IMMUTABLE: content_authors is append-only/, "a DRAFT's authorship never shrinks");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    await dbRefusal(`UPDATE eos_finance.financial_policy_versions SET prepared_by = 'someone-else', content_authors = ARRAY['someone-else'], last_edited_by = 'someone-else' WHERE id = $1`,
      [id], /FINANCIAL_POLICY_IMMUTABLE/, "the preparer never changes, even in DRAFT");
    await dbRefusal(`TRUNCATE eos_finance.financial_policy_versions`, [], /TRUNCATE is refused/, "TRUNCATE");
    assert.deepEqual(await versions(), stateBefore);
    assert.equal(await auditCount(), auditBefore);
    const sub = ok(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }));
    const subAgain = ok(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }));
    assert.deepEqual([subAgain.replayed, subAgain.version], [true, sub.version]);
    refused(await fn(fm, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, reason: "late note" }), 409, "FINANCIAL_POLICY_REPLAY_CONFLICT");
    const app = ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }));
    assert.deepEqual(ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: id })).version, app.version);
    refused(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, reason: "a note after the fact" }), 409, "FINANCIAL_POLICY_REPLAY_CONFLICT");
    refused(await fn(adm, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: id }), 409, "FINANCIAL_POLICY_NOT_SUBMITTED",
      "a second approver is not a replay");
    const date = await businessDate("ventana", 10);
    const act = ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, effectiveDate: date }));
    const settled = await versions();
    const settledAudit = await auditCount();
    const actAgain = ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, effectiveDate: date }));
    assert.deepEqual([actAgain.replayed, actAgain.version], [true, act.version]);
    refused(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: id, effectiveDate: date, reason: "other" }),
      409, "FINANCIAL_POLICY_REPLAY_CONFLICT");
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

  await t.test("SCOPE (#232 Amendment A): finance.policy.* applies only at the companies a principal's assignments reach", async () => {
    // Free both companies: Taylor's APPROVED in-flight version (the VAL test) is activated, dated after Taylor's scheduled v2.
    const tInFlight = ok(await fn(own, "readFinancialPolicy", { operatingCompanyId: "taylor" })).inFlight;
    ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: tInFlight.id, effectiveDate: await businessDate("taylor", 5) }));
    // TEST-TENANT-ONLY Roles that model Option A: policy authority with NO Administration capability, so Administration
    // admits them at operatingCompany scope. Built and staffed through the governed Administration commands.
    const roleId = async (key) => (await one(`SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2`, [TENANT, key])).id;
    const defineRole = async (key, actions) => {
      assert.equal((await admin("createRole", { key, name: key, reason: "local test tenant only (#232 Amendment A)" })).ok, true, key);
      for (const actionKey of actions) {
        const r = await admin("grantObjectActionToRole", { roleKey: key, objectKey: "financialPolicy", actionKey, reason: "local test tenant only" });
        assert.equal(r.ok, true, `${key} ${actionKey} ${JSON.stringify(r).slice(0, 300)}`);
      }
    };
    await defineRole("policyPreparerTest", ["read", "prepare"]);
    // approve / activate are RESERVED to the Owner Role (#232 Phase 1): no other Role may be granted them.
    assert.equal((await admin("createRole", { key: "policyDeciderTest", name: "policyDeciderTest", reason: "local test tenant only" })).ok, true);
    const assign = async (who, roleKey, scopeValue) => {
      const r = await admin("assignRole", { principalId: who.principalId, roleId: await roleId(roleKey), reason: "scope staffing",
        ...(scopeValue ? { scopeType: "operatingCompany", scopeValue } : {}) });
      assert.equal(r.ok, true, `${roleKey}@${scopeValue ?? "global"} ${JSON.stringify(r).slice(0, 300)}`);
    };
    const pT = await person("uid-fp-sc-t", [], { id: "e-fp-sc-t", name: "Tara Taylor-Controller" });
    const pV = await person("uid-fp-sc-v", [], { id: "e-fp-sc-v", name: "Vic Ventana-Controller", company: "ventana" });
    const pB = await person("uid-fp-sc-b", [], { id: "e-fp-sc-b", name: "Bea Both-Companies" });
    const mixed = await person("uid-fp-sc-mx", ["owner"], { id: "e-fp-sc-mx", name: "Max Mixed" });
    const gP = await person("uid-fp-sc-g", [], { id: "e-fp-sc-g", name: "Gil Global-Preparer" });
    await assign(pT, "policyPreparerTest", "taylor");
    await assign(pV, "policyPreparerTest", "ventana");
    await assign(pB, "policyPreparerTest", "taylor");
    await assign(pB, "policyPreparerTest", "ventana");
    await assign(mixed, "policyPreparerTest", "taylor"); // + the (global, protected) Owner Role
    await assign(gP, "policyPreparerTest", null);
    const OUT = "OUTSIDE_OPERATING_COMPANY_SCOPE";

    // BOTH-COMPANY holder: separate, independently versioned policies for each company.
    const listNumbers = async (company) => ok(await fn(own, "listFinancialPolicyVersions", { operatingCompanyId: company })).items.map((v) => v.versionNumber);
    const tNext = Math.max(...(await listNumbers("taylor"))) + 1;
    const vNext = Math.max(...(await listNumbers("ventana"))) + 1;
    const vT = ok(await fn(pB, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: FIFO }), "both: Taylor").version;
    const vV = ok(await fn(pB, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }), "both: Ventana").version;
    assert.deepEqual([vT.operatingCompanyId, vT.versionNumber, vV.operatingCompanyId, vV.versionNumber], ["taylor", tNext, "ventana", vNext]);
    assert.notEqual(vT.id, vV.id);

    // TAYLOR-ONLY holder: works Taylor; refused Ventana -- the same refusal for a real and a non-existent Ventana id (no leak).
    assert.equal(ok(await fn(pT, "readFinancialPolicy", { operatingCompanyId: "taylor" })).inFlight.id, vT.id);
    for (const [op, input] of [
      ["readFinancialPolicy", { operatingCompanyId: "ventana" }],
      ["listFinancialPolicyVersions", { operatingCompanyId: "ventana" }],
      ["saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }],
      ["saveFinancialPolicyDraft", { operatingCompanyId: "ventana", versionId: vV.id, policy: FIFO }],
      ["submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: vV.id }],
      ["submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: "fpv-does-not-exist" }],
    ]) {
      const body = refused(await fn(pT, op, input), 403, OUT, `Taylor-only ${op}`);
      assert.equal(JSON.stringify(body).includes(vV.id), false, "no Ventana version id leaks");
      assert.equal(body.result, undefined);
    }
    ok(await fn(pT, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", versionId: vT.id, policy: { ...FIFO, cogsRecognitionPointId: "EQUIPMENT_INSTALL" } }));
    ok(await fn(pT, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: vT.id }), "Taylor-only submits Taylor");

    // VENTANA-ONLY holder: the mirror image.
    refused(await fn(pV, "readFinancialPolicy", { operatingCompanyId: "taylor" }), 403, OUT);
    refused(await fn(pV, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: vT.id }), 403, OUT);
    refused(await fn(pV, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), 403, OUT);
    ok(await fn(pV, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", versionId: vV.id, policy: { ...WA, cogsRecognitionPointId: "INVOICE_ISSUE" } }));
    ok(await fn(pV, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: vV.id }), "Ventana-only submits Ventana");

    // OUT OF SCOPE == MISSING for a scoped-only holder: an unknown, an inactive and an ACTIVE out-of-scope company get the
    // SAME refusal; a flat holder keeps the precise OPERATING_COMPANY_UNKNOWN; CONSOLIDATED is refused for everyone.
    const sameAs = refused(await fn(pT, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }), 403, OUT);
    for (const company of ["saratoga", "dormant", undefined]) {
      const body = refused(await fn(pT, "saveFinancialPolicyDraft", { operatingCompanyId: company, policy: WA }), 403, OUT, `scoped: ${company}`);
      assert.deepEqual(Object.keys(body).sort(), Object.keys(sameAs).sort());
    }
    refused(await fn(pT, "readFinancialPolicy", { operatingCompanyId: "saratoga" }), 403, OUT);
    refused(await fn(gP, "saveFinancialPolicyDraft", { operatingCompanyId: "saratoga", policy: WA }), 400, "OPERATING_COMPANY_UNKNOWN", "flat: precise");
    refused(await fn(gP, "readFinancialPolicy", { operatingCompanyId: "dormant" }), 400, "OPERATING_COMPANY_UNKNOWN", "flat: precise");
    refused(await fn(pT, "readFinancialPolicy", { operatingCompanyId: "consolidated" }), 400, "CONSOLIDATED_NOT_A_COMPANY");
    refused(await fn(gP, "saveFinancialPolicyDraft", { operatingCompanyId: "CONSOLIDATED", policy: WA }), 400, "CONSOLIDATED_NOT_A_COMPANY");
    // A scoped preparer holds nothing it was not granted.
    refused(await fn(pT, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: vT.id }), 403, "CAPABILITY_REQUIRED");

    // The Owner (global, reserved approve / activate) decides each company's own version.
    ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: vT.id }), "Owner approves Taylor");
    const tAct = ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: vT.id, effectiveDate: await businessDate("taylor", 6) }));
    assert.equal(tAct.version.status, "ACTIVE");

    // MULTIPLE ROLES: preparer @ Taylor + the Owner Role. Never approves NOR ACTIVATES its own Taylor version; decides another's
    // Ventana one. The approver may activate.
    const own2 = ok(await fn(mixed, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA })).version;
    ok(await fn(mixed, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: own2.id }));
    refused(await fn(mixed, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: own2.id }), 403, "SEPARATION_OF_DUTIES");
    refused(await fn(mixed, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }), 403, OUT, "its prepare is Taylor-only");
    ok(await fn(mixed, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: vV.id }), "a global approve reaches Ventana");
    ok(await fn(mixed, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: vV.id, effectiveDate: await businessDate("ventana", 11) }),
      "the approver activates (allowed)");
    ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: own2.id }), "an independent Owner approves mixed's version");
    // ACTIVATION SEPARATION OF DUTIES (#232 Phase 1): the preparer / submitter never activates, even after another approves.
    refused(await fn(mixed, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: own2.id, effectiveDate: await businessDate("taylor", 7) }),
      403, "SEPARATION_OF_DUTIES");
    // ...and the database refuses it on a direct write too, mapped to the same governed refusal.
    const rawSod = await q(`UPDATE eos_finance.financial_policy_versions SET status = 'ACTIVE', activated_by = submitted_by, activated_at = now(),
      effective_date = eos_policy.operating_company_business_date(tenant_id, operating_company_id, now()) + 7 WHERE id = $1`, [own2.id]).then(() => null, (e) => e);
    assert.equal(rawSod?.constraint, "financial_policy_activator_independent");
    assert.equal(fp.translateDatabaseRefusal(rawSod).code, "SEPARATION_OF_DUTIES");
    ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: own2.id, effectiveDate: await businessDate("taylor", 7) }),
      "the approving Owner activates");

    // RESERVED (#232 Phase 1): approve / activate never reach another Role, the Administrator Role's cell, or a principal directly.
    for (const actionKey of ["approve", "activate"]) {
      for (const roleKey of ["controller", "financeManager", "accountingManager", "generalManager", "policyDeciderTest", "policyPreparerTest", "admin"]) {
        const r = await admin("grantObjectActionToRole", { roleKey, objectKey: "financialPolicy", actionKey, reason: "try the reservation" });
        assert.equal(r.ok, false, `${roleKey} ${actionKey}`);
        assert.match(r.message, new RegExp(`may never hold finance\\.policy\\.${actionKey}`), `${roleKey} ${actionKey}`);
      }
      const d = await admin("grantObjectActionToPrincipal", { objectKey: "financialPolicy", actionKey, principalId: ctrl.principalId, reason: "exception" });
      assert.equal(d.ok, false);
      assert.match(d.message, /never a direct grant/);
    }
    assert.equal(Number((await one(`SELECT count(*) AS n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND c.key LIKE 'finance.policy.%'`, [TENANT])).n), 0, "no direct finance.policy.* row was written");
    // STANDING IS UNTOUCHED by the reservation: the Administrator's cells stay held through PROTECTED_ADMINISTRATOR (read /
    // approve / activate), never prepare -- and the Administrator still approves and activates at runtime (the AUTH test above).
    const matrix = await admin("getObjectActionGrantMatrix", { objectKey: "financialPolicy" });
    assert.equal(matrix.ok, true);
    const adminCell = (key) => matrix.data.actions.find((a) => a.capabilityKey === key).roles.find((r) => r.roleKey === "admin") ?? null;
    for (const key of ["finance.policy.read", "finance.policy.approve", "finance.policy.activate"]) {
      assert.deepEqual([adminCell(key)?.held, adminCell(key)?.source], [true, "PROTECTED_ADMINISTRATOR"], key);
    }
    assert.notEqual(adminCell("finance.policy.prepare")?.held, true, "standing never implies prepare");
    const ownerCell = (key) => matrix.data.actions.find((a) => a.capabilityKey === key).roles.find((r) => r.roleKey === "owner") ?? null;
    for (const key of ["finance.policy.approve", "finance.policy.activate"]) assert.deepEqual([ownerCell(key)?.held, ownerCell(key)?.source], [true, "ADMIN_GRANTED"], key);
    const detail = await admin("getSecurityRoleDetail", { roleKey: "admin" });
    const row = (key) => detail.data.actions.find((a) => a.capabilityKey === key);
    t.diagnostic(`admin role detail: ${JSON.stringify(["finance.policy.read", "finance.policy.prepare", "finance.policy.approve", "finance.policy.activate"]
      .map((k) => ({ k, held: row(k)?.held, source: row(k)?.source, forbiddenBy: row(k)?.forbiddenBy ?? null })))}`);
    for (const key of ["finance.policy.approve", "finance.policy.activate"]) assert.deepEqual([row(key).held, row(key).source], [true, "PROTECTED_ADMINISTRATOR"], key);

    // RUNTIME RESERVATION: a row that bypassed the write path (raw SQL, as an old or rogue grant would be) does not authorize.
    // Only the Owner Role or Administrator standing exercises approve / activate.
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-fp-rogue-' || c.action_key, $1, r.id, c.id, 'rogue', 'rogue', 'rogue' FROM eos_policy.roles r, eos_policy.capabilities c
              WHERE r.tenant_id = $1 AND r.key = 'accountingManager' AND c.key IN ('finance.policy.approve', 'finance.policy.activate')`, [TENANT]);
    const rogueDraft = ok(await fn(pT, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: FIFO })).version;
    ok(await fn(pT, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: rogueDraft.id }));
    refused(await fn(acct, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: rogueDraft.id }), 403, "RESERVED_CAPABILITY", "a bypassed row");
    refused(await fn(acct, "rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: rogueDraft.id, reason: "rogue" }), 403, "RESERVED_CAPABILITY");
    ok(await fn(adm, "rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: rogueDraft.id, reason: "standing still decides" }));
    refused(await fn(acct, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: own2.id, effectiveDate: await businessDate("taylor", 40) }),
      403, "RESERVED_CAPABILITY");
    await q(`DELETE FROM eos_policy.role_capabilities WHERE tenant_id = $1 AND id LIKE 'rc-fp-rogue-%'`, [TENANT]);

    // NULL-SAFE independence: content_authors may never hold a NULL element (it would blind every independence CHECK).
    const nullDraft = ok(await fn(pT, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA })).version;
    await dbRefusal(`UPDATE eos_finance.financial_policy_versions SET content_authors = content_authors || NULL::text WHERE id = $1`, [nullDraft.id],
      /financial_policy_content_authors_no_null/, "a NULL author");
    ok(await fn(pT, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: nullDraft.id }));
    ok(await fn(adm, "rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: nullDraft.id, reason: "test tidy-up" }));

    // GLOBAL holder: the current EOS meaning of a global assignment -- every company (pending the Owner's confirmation).
    for (const company of ["taylor", "ventana"]) {
      ok(await fn(gP, "readFinancialPolicy", { operatingCompanyId: company }), `global read ${company}`);
      ok(await fn(gP, "saveFinancialPolicyDraft", { operatingCompanyId: company, policy: FIFO }), `global prepare ${company}`);
    }

    // FUTURE COMPANIES (#232 Phase 1): a third ACTIVE company in the governed registry is selectable for a scoped Preparer
    // assignment and keeps its own isolated policy and history -- no code change (the registry row is the fixture pattern).
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'southco','ACTIVE','fixture','fixture','fixture')`, [TENANT]);
    const pS = await person("uid-fp-sc-s", [], { id: "e-fp-sc-s", name: "Sol Southco" });
    await assign(pS, "policyPreparerTest", "southco");
    refused(await fn(pS, "readFinancialPolicy", { operatingCompanyId: "taylor" }), 403, OUT);
    assert.equal(ok(await fn(pS, "readFinancialPolicy", { operatingCompanyId: "southco" })).state, "NOT_CONFIGURED");
    const vS = ok(await fn(pS, "saveFinancialPolicyDraft", { operatingCompanyId: "southco", policy: WA })).version;
    assert.deepEqual([vS.operatingCompanyId, vS.versionNumber], ["southco", 1], "its own numbering");
    ok(await fn(pS, "submitFinancialPolicy", { operatingCompanyId: "southco", versionId: vS.id }));
    ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "southco", versionId: vS.id }));
    ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "southco", versionId: vS.id, effectiveDate: await businessDate("southco") }));
    assert.deepEqual(ok(await fn(pS, "listFinancialPolicyVersions", { operatingCompanyId: "southco" })).items.map((v) => [v.id, v.status]), [[vS.id, "ACTIVE"]]);
    for (const company of ["taylor", "ventana"]) {
      assert.equal(ok(await fn(own, "listFinancialPolicyVersions", { operatingCompanyId: company })).items.some((v) => v.id === vS.id), false, company);
    }

    // A scoped holding for a company that becomes INACTIVE admits nothing (the dormant fixture pattern: the status row).
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'northco','ACTIVE','fixture','fixture','fixture')`, [TENANT]);
    const pN = await person("uid-fp-sc-n", [], { id: "e-fp-sc-n", name: "Nia Northco" });
    await assign(pN, "policyPreparerTest", "northco");
    ok(await fn(pN, "saveFinancialPolicyDraft", { operatingCompanyId: "northco", policy: WA }), "northco while ACTIVE");
    await q(`UPDATE eos_policy.tenant_operating_companies SET status = 'INACTIVE' WHERE tenant_id = $1 AND operating_company_id = 'northco'`, [TENANT]);
    refused(await fn(pN, "readFinancialPolicy", { operatingCompanyId: "northco" }), 403, OUT, "inactive company");
    refused(await fn(pN, "saveFinancialPolicyDraft", { operatingCompanyId: "northco", policy: FIFO }), 403, OUT, "inactive company");

    // CONDITIONED scoped holding: admits nothing (fail closed); an unconditioned holding admits only its own company.
    const holding = (condition, scopeValue = "taylor") => ({ capabilityKey: "finance.policy.read", scopeType: "operatingCompany", scopeValue,
      sourceRole: "policyPreparerTest", assignmentId: null, condition });
    const actor = (scopedHeld) => ({ tenantId: TENANT, principalId: pT.principalId, capabilities: new Set(), scopedHeld });
    await assert.rejects(fp.readFinancialPolicy(pool, actor([holding({ kind: "RECORD_ASSIGNMENT" })]), { operatingCompanyId: "taylor" }),
      (e) => e.code === "CAPABILITY_REQUIRED");
    await assert.rejects(fp.readFinancialPolicy(pool, actor([holding(null)]), { operatingCompanyId: "ventana" }), (e) => e.code === OUT);
    assert.equal((await fp.readFinancialPolicy(pool, actor([holding(null)]), { operatingCompanyId: "taylor" })).operatingCompanyId, "taylor");
    // The runtime resolved exactly these holdings for the both-company preparer (the transport's caller.operational.scopedHeld).
    const explained = await require("../lib/eosOps/effectiveAccessExplanation.js").explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: pB.principalId });
    assert.deepEqual(explained.scopedHeld.map((h) => `${h.capabilityKey}@${h.scopeValue}`).sort(),
      ["finance.policy.prepare@taylor", "finance.policy.prepare@ventana", "finance.policy.read@taylor", "finance.policy.read@ventana"]);
  });

  await t.test("OPTION C (#232): finance.policy.read / .prepare are held only through a Role assignment -- refused as direct grants, inert as direct rows", async () => {
    const rca = require("../lib/adminPolicy/roleCapabilityAdministration.js");
    // PIN: exactly the two keys, nothing else.
    assert.deepEqual([...rca.ROLE_ASSIGNMENT_ONLY_CAPABILITIES.keys()].sort(), ["finance.policy.prepare", "finance.policy.read"]);
    const directRows = async (principalId) => Number((await one(`SELECT count(*) AS n FROM eos_policy.principal_capabilities pc
      JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE pc.tenant_id = $1 AND pc.principal_id = $2 AND c.key LIKE 'finance.policy.%'`,
      [TENANT, principalId])).n);
    const roleId = async (key) => (await one(`SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2`, [TENANT, key])).id;

    // GRANT TIME: refused, nothing written.
    for (const actionKey of ["read", "prepare"]) {
      const r = await admin("grantObjectActionToPrincipal", { objectKey: "financialPolicy", actionKey, principalId: acct.principalId, reason: "exception" });
      assert.equal(r.ok, false, actionKey);
      assert.match(r.message, /ROLE_ASSIGNMENT_ONLY: finance\.policy\.(read|prepare) is held only through a Security Role assignment/);
    }
    // A CONDITIONED direct grant is refused the same way (refused before any condition is considered).
    const conditioned = await admin("grantObjectActionToPrincipal", { objectKey: "financialPolicy", actionKey: "prepare", principalId: acct.principalId,
      reason: "exception", condition: { kind: "RECORD_ASSIGNMENT", recordKind: "workOrder" } });
    assert.equal(conditioned.ok, false);
    assert.match(conditioned.message, /ROLE_ASSIGNMENT_ONLY/);
    assert.equal(await directRows(acct.principalId), 0, "no row written");
    // The grant-impact PREVIEW reproduces the refusal (the same command, simulated) -- it never reports WOULD_APPLY.
    const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
    const { createAuthorityChangePreview } = require("../lib/eosOps/authorityChangePreview.js");
    const preview = await executeAdminOperation({ repo, previewAuthorityChange: createAuthorityChangePreview({ pool }) },
      { caller: { externalSubject: "uid-finpol-admin", identityProvider: "firebase" }, operation: "previewAuthorityChange", requestId: "r-optc-preview",
        input: { change: { operation: "grantObjectActionToPrincipal",
          input: { objectKey: "financialPolicy", actionKey: "prepare", principalId: acct.principalId, reason: "exception" } } } });
    assert.equal(preview.ok, true, JSON.stringify(preview).slice(0, 400));
    assert.deepEqual([preview.data.outcome, preview.data.refusal?.code], ["WOULD_REFUSE", "ROLE_ASSIGNMENT_ONLY"]);
    // ROLE GRANTS are preserved: a custom Preparer Role is still created and granted read + prepare through Administration.
    assert.equal((await admin("createRole", { key: "optionCPreparer", name: "Option C Preparer", reason: "local test tenant only" })).ok, true);
    for (const actionKey of ["read", "prepare"]) {
      assert.equal((await admin("grantObjectActionToRole", { roleKey: "optionCPreparer", objectKey: "financialPolicy", actionKey, reason: "local" })).ok, true);
    }

    // REQUEST TIME: a pre-existing prohibited direct row (raw SQL) confers nothing.
    const rawRow = async (who, key) => q(`INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, created_by, updated_by, exception_reason)
      SELECT $1, $2, $3, c.id, 'rogue', 'rogue', 'rogue', 'pre-existing prohibited exception' FROM eos_policy.capabilities c WHERE c.key = $4`,
      [`pc-optc-${who.principalId}-${key}`, TENANT, who.principalId, key]);
    const rawOnly = await person("uid-fp-optc-raw", [], { id: "e-fp-optc-raw", name: "Rae Raw" });
    for (const key of ["finance.policy.read", "finance.policy.prepare"]) await rawRow(rawOnly, key);
    assert.equal(await directRows(rawOnly.principalId), 2);
    refused(await fn(rawOnly, "readFinancialPolicy", { operatingCompanyId: "taylor" }), 403, "CAPABILITY_REQUIRED");
    refused(await fn(rawOnly, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }), 403, "CAPABILITY_REQUIRED");
    const explained = await require("../lib/eosOps/effectiveAccessExplanation.js").explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: rawOnly.principalId });
    assert.equal(explained.capabilities.some((k) => k.startsWith("finance.policy.")), false, "the explanation agrees: nothing conferred");
    const readRow = explained.actions.find((a) => a.capabilityKey === "finance.policy.read");
    assert.deepEqual([readRow.result, readRow.directGrant], ["DENIED", null]);
    const eff = await admin("getPrincipalEffectiveAccess", { principalId: rawOnly.principalId });
    assert.equal(eff.ok, true);
    assert.equal(JSON.stringify(eff.data.effective).includes("finance.policy."), false, "the Administration effective-access read agrees");
    // NARROWNESS: a legitimate direct grant of an UNRELATED capability still confers at runtime, in BOTH resolvers.
    assert.equal((await admin("grantObjectActionToPrincipal", { objectKey: "account", actionKey: "read", principalId: rawOnly.principalId,
      reason: "unrelated governed exception" })).ok, true);
    const { resolveOperationalCapabilities } = require("../lib/eosOps/capabilityAuthority.js");
    const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");
    const flat = (await resolveOperationalCapabilities(pool, TENANT, rawOnly.principalId, [], postgresGrantConditionProvider(pool))).capabilities;
    assert.deepEqual([flat.has("customer.record.read"), flat.has("finance.policy.read"), flat.has("finance.policy.prepare")], [true, false, false]);
    // The Workforce command kernel's second resolver (withDirectCapabilityGrants) applies the same list.
    const { withDirectCapabilityGrants } = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");
    const bare = { tenantId: TENANT, principalId: rawOnly.principalId, capabilities: new Set(), entitlements: async () => Object.freeze([]) };
    assert.equal((await withDirectCapabilityGrants(pool, bare, "finance.policy.prepare")).capabilities.has("finance.policy.prepare"), false);
    const widened = await withDirectCapabilityGrants(pool, bare, "customer.record.read");
    assert.deepEqual([widened.capabilities.has("customer.record.read"), widened.capabilities.has("finance.policy.read")], [true, false]);
    assert.equal((await widened.entitlements()).some((e) => e.capabilityKey.startsWith("finance.policy.")), false);
    // ...and a direct row never WIDENS a company-scoped Role holding: Taylor-scoped stays Taylor-only.
    const rawScoped = await person("uid-fp-optc-scoped", [], { id: "e-fp-optc-scoped", name: "Sid Scoped" });
    assert.equal((await admin("assignRole", { principalId: rawScoped.principalId, roleId: await roleId("optionCPreparer"), reason: "scope staffing",
      scopeType: "operatingCompany", scopeValue: "taylor" })).ok, true);
    for (const key of ["finance.policy.read", "finance.policy.prepare"]) await rawRow(rawScoped, key);
    ok(await fn(rawScoped, "readFinancialPolicy", { operatingCompanyId: "taylor" }), "in scope through the Role");
    refused(await fn(rawScoped, "readFinancialPolicy", { operatingCompanyId: "ventana" }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
    refused(await fn(rawScoped, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
    // Standing is untouched: the Administrator still reads (never prepares).
    ok(await fn(adm, "readFinancialPolicy", { operatingCompanyId: "ventana" }));
    refused(await fn(adm, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: WA }), 403, "CAPABILITY_REQUIRED");
    // THE GRANT MATRIX (#232 Phase 2, item 9): a stored prohibited direct row is LISTED but never shown as effective --
    // enforced: false, with the ruling that makes it inert. The unrelated legitimate exception stays enforced.
    const fpMatrix = await admin("getObjectActionGrantMatrix", { objectKey: "financialPolicy" });
    assert.equal(fpMatrix.ok, true);
    for (const key of ["finance.policy.read", "finance.policy.prepare"]) {
      const cell = fpMatrix.data.actions.find((a) => a.capabilityKey === key).principals.find((p) => p.principalId === rawOnly.principalId);
      assert.deepEqual([cell.source, cell.enforced, cell.notEffectiveReason, cell.forbiddenBy], ["DIRECT_EXCEPTION", false, "ROLE_ASSIGNMENT_ONLY",
        rca.ROLE_ASSIGNMENT_ONLY_CAPABILITIES.get(key).ruling], key);
    }
    // A RESERVED key's stored direct row keeps its ordinary representation: it does enter the flat set (only
    // ROLE_ASSIGNMENT_ONLY keys are filtered), and the reservation is decided separately at runtime.
    await rawRow(rawOnly, "finance.policy.approve");
    const reservedMatrix = await admin("getObjectActionGrantMatrix", { objectKey: "financialPolicy" });
    const reservedCell = reservedMatrix.data.actions.find((a) => a.capabilityKey === "finance.policy.approve").principals
      .find((p) => p.principalId === rawOnly.principalId);
    assert.deepEqual([reservedCell.source, reservedCell.enforced, reservedCell.notEffectiveReason, reservedCell.forbiddenBy],
      ["DIRECT_EXCEPTION", true, null, null], "a reserved-key direct row is not re-labelled not-effective");
    const accountMatrix = await admin("getObjectActionGrantMatrix", { objectKey: "account" });
    const legit = accountMatrix.data.actions.find((a) => a.actionKey === "read").principals.find((p) => p.principalId === rawOnly.principalId);
    assert.deepEqual([legit.enforced, legit.notEffectiveReason, legit.forbiddenBy], [true, null, null], "a legitimate direct exception stays effective");
    // DRIFT: the verifier reports every stored prohibited direct row (list-driven, as for reserved keys).
    const report = rca.verifyTenantAuthority({ systemDefault: [], live: [], decisions: [],
      principals: [{ principalId: rawOnly.principalId, roleKeys: [], directCapabilityKeys: ["finance.policy.read", "finance.policy.prepare", "customer.record.read"] }] });
    assert.deepEqual(report.drift.filter((d) => d.kind === "FORBIDDEN_PRINCIPAL_HOLDING").map((d) => d.capabilityKey).sort(),
      ["finance.policy.prepare", "finance.policy.read"], "an unrelated direct grant is not flagged");
    await q(`DELETE FROM eos_policy.principal_capabilities WHERE tenant_id = $1 AND id LIKE 'pc-optc-%'`, [TENANT]);
  });

  await t.test("PHASE 2 (Administration UI): readMyFinancialPolicyAuthority and per-version yourActions are the commands' own answers", async () => {
    const roleId = async (key) => (await one(`SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2`, [TENANT, key])).id;
    const assign = async (who, roleKey, scopeValue) => {
      const r = await admin("assignRole", { principalId: who.principalId, roleId: await roleId(roleKey), reason: "phase 2 staffing",
        ...(scopeValue ? { scopeType: "operatingCompany", scopeValue } : {}) });
      assert.equal(r.ok, true, `${roleKey}@${scopeValue ?? "global"} ${JSON.stringify(r).slice(0, 300)}`);
    };
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'westco','ACTIVE','fixture','fixture','fixture')`, [TENANT]);
    const tOnly = await person("uid-fp-p2-t", [], { id: "e-fp-p2-t", name: "Tess Taylor-Preparer" });
    const vOnly = await person("uid-fp-p2-v", [], { id: "e-fp-p2-v", name: "Val Ventana-Preparer", company: "ventana" });
    const both = await person("uid-fp-p2-b", [], { id: "e-fp-p2-b", name: "Bo Both-Preparer" });
    const wPrep = await person("uid-fp-p2-w", [], { id: "e-fp-p2-w", name: "Wren Westco-Preparer" });
    const dualW = await person("uid-fp-p2-dw", ["owner"], { id: "e-fp-p2-dw", name: "Dee Owner-and-Westco-Preparer" });
    await assign(tOnly, "policyPreparerTest", "taylor");
    await assign(vOnly, "policyPreparerTest", "ventana");
    await assign(both, "policyPreparerTest", "taylor");
    await assign(both, "policyPreparerTest", "ventana");
    await assign(wPrep, "policyPreparerTest", "westco");
    await assign(dualW, "policyPreparerTest", "westco");
    const authority = async (who) => ok(await fn(who, "readMyFinancialPolicyAuthority", {}), "authority");
    const ids = (a) => a.companies.map((c) => c.operatingCompanyId);
    const actions = (a, company) => a.companies.find((c) => c.operatingCompanyId === company).actions;
    const yes = { allowed: true, reason: null };
    const no = (reason) => ({ allowed: false, reason });
    const activeCompanies = (await q(`SELECT operating_company_id AS id FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND status = 'ACTIVE'
      ORDER BY 1`, [TENANT])).rows.map((r) => r.id);
    assert.ok(activeCompanies.includes("westco") && !activeCompanies.includes("northco") && !activeCompanies.includes("dormant"));

    // SCOPED PREPARERS: exactly their companies; an out-of-scope company is never named.
    const aT = await authority(tOnly);
    assert.deepEqual([aT.principalId, ids(aT)], [tOnly.principalId, ["taylor"]]);
    assert.equal(aT.companies[0].name, "Taylor Freezer of Arizona", "the governed display name");
    assert.deepEqual(actions(aT, "taylor"), { read: yes, prepare: yes, approve: no("CAPABILITY_REQUIRED"), activate: no("CAPABILITY_REQUIRED") });
    assert.equal(JSON.stringify(aT).includes("ventana"), false, "no out-of-scope company leaks");
    assert.deepEqual(ids(await authority(vOnly)), ["ventana"]);
    const aB = await authority(both);
    assert.deepEqual(ids(aB), ["taylor", "ventana"]);
    for (const company of ["taylor", "ventana"]) assert.deepEqual(actions(aB, company).prepare, yes);
    // OWNER (global Role grants) and ADMINISTRATOR (standing): every ACTIVE company; decide, never prepare. CONSOLIDATED never listed.
    for (const who of [own, adm]) {
      const a = await authority(who);
      assert.deepEqual(ids(a), activeCompanies);
      assert.equal(ids(a).some((c) => c.toLowerCase() === "consolidated"), false);
      for (const company of activeCompanies) {
        assert.deepEqual(actions(a, company), { read: yes, prepare: no("CAPABILITY_REQUIRED"), approve: yes, activate: yes }, `${who.subject} ${company}`);
      }
    }
    // MIXED (Owner Role + Preparer @westco): decides everywhere, prepares at Westco only -- out of scope elsewhere.
    const aDW = await authority(dualW);
    assert.deepEqual(actions(aDW, "westco"), { read: yes, prepare: yes, approve: yes, activate: yes });
    assert.deepEqual(actions(aDW, "taylor").prepare, no("OUTSIDE_OPERATING_COMPANY_SCOPE"));
    // UNAUTHORIZED: refused, never answered empty.
    for (const who of [outsiders.salesperson, outsiders.technician, acct, gm, ctrlOnly]) {
      refused(await fn(who, "readMyFinancialPolicyAuthority", {}), 403, "CAPABILITY_REQUIRED", who.subject);
    }
    refused(await fn(tOnly, "readMyFinancialPolicyAuthority", { operatingCompanyId: "taylor" }), 400, "FIELD_NOT_ACCEPTED");
    // A RAW (pre-existing, prohibited) direct finance.policy.read row reaches nothing here either.
    const raw = await person("uid-fp-p2-raw", [], { id: "e-fp-p2-raw", name: "Ray Raw-Row" });
    await q(`INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, created_by, updated_by, exception_reason)
      SELECT 'pc-p2-raw', $1, $2, c.id, 'rogue', 'rogue', 'rogue', 'pre-existing prohibited exception' FROM eos_policy.capabilities c WHERE c.key = 'finance.policy.read'`,
    [TENANT, raw.principalId]);
    refused(await fn(raw, "readMyFinancialPolicyAuthority", {}), 403, "CAPABILITY_REQUIRED");
    await q(`DELETE FROM eos_policy.principal_capabilities WHERE tenant_id = $1 AND id = 'pc-p2-raw'`, [TENANT]);

    // PER-VERSION SEPARATION OF DUTIES, as the commands decide it -- and each "allowed: false" is the refusal the command gives.
    const readAs = async (who) => ok(await fn(who, "readFinancialPolicy", { operatingCompanyId: "westco" }));
    refused(await fn(tOnly, "readFinancialPolicy", { operatingCompanyId: "westco" }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
    const empty = await readAs(wPrep);
    assert.deepEqual([empty.state, empty.yourAuthority.principalId, empty.yourAuthority.createDraft], ["NOT_CONFIGURED", wPrep.principalId, yes]);
    assert.deepEqual((await readAs(own)).yourAuthority.createDraft, no("CAPABILITY_REQUIRED"), "the Owner never prepares");
    const v1 = ok(await fn(dualW, "saveFinancialPolicyDraft", { operatingCompanyId: "westco", policy: WA, reason: "initial" })).version;
    ok(await fn(wPrep, "saveFinancialPolicyDraft", { operatingCompanyId: "westco", versionId: v1.id, policy: FIFO }), "a second author");
    const asPrep = (await readAs(wPrep));
    assert.deepEqual(asPrep.yourAuthority.createDraft, no("FINANCIAL_POLICY_IN_FLIGHT_EXISTS"));
    refused(await fn(wPrep, "saveFinancialPolicyDraft", { operatingCompanyId: "westco", policy: WA }), 409, "FINANCIAL_POLICY_IN_FLIGHT_EXISTS");
    assert.deepEqual(asPrep.inFlight.yourActions, { edit: yes, submit: yes, approve: no("CAPABILITY_REQUIRED"), reject: no("CAPABILITY_REQUIRED"),
      activate: no("CAPABILITY_REQUIRED") });
    assert.deepEqual((await readAs(own)).inFlight.yourActions, { edit: no("CAPABILITY_REQUIRED"), submit: no("CAPABILITY_REQUIRED"),
      approve: no("FINANCIAL_POLICY_NOT_SUBMITTED"), reject: no("FINANCIAL_POLICY_NOT_SUBMITTED"), activate: no("FINANCIAL_POLICY_NOT_APPROVED") });
    refused(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "westco", versionId: v1.id }), 409, "FINANCIAL_POLICY_NOT_SUBMITTED");
    ok(await fn(dualW, "submitFinancialPolicy", { operatingCompanyId: "westco", versionId: v1.id }));
    // The preparer / submitter who ALSO holds the Owner Role: approve / reject blocked by separation of duties.
    const asDual = (await readAs(dualW)).inFlight.yourActions;
    assert.deepEqual([asDual.approve, asDual.reject, asDual.edit], [no("SEPARATION_OF_DUTIES"), no("SEPARATION_OF_DUTIES"), no("FINANCIAL_POLICY_NOT_EDITABLE")]);
    refused(await fn(dualW, "approveFinancialPolicy", { operatingCompanyId: "westco", versionId: v1.id }), 403, "SEPARATION_OF_DUTIES");
    refused(await fn(wPrep, "submitFinancialPolicy", { operatingCompanyId: "westco", versionId: v1.id }), 409, "FINANCIAL_POLICY_NOT_EDITABLE");
    // Another decider (the independent Owner, the Administrator by standing) may.
    for (const who of [own, adm]) {
      const y = (await readAs(who)).inFlight.yourActions;
      assert.deepEqual([y.approve, y.reject, y.activate], [yes, yes, no("FINANCIAL_POLICY_NOT_APPROVED")], who.subject);
    }
    ok(await fn(own, "approveFinancialPolicy", { operatingCompanyId: "westco", versionId: v1.id, reason: "reviewed with accounting" }));
    assert.deepEqual((await readAs(dualW)).inFlight.yourActions.activate, no("SEPARATION_OF_DUTIES"), "the preparer never activates");
    refused(await fn(dualW, "activateFinancialPolicy", { operatingCompanyId: "westco", versionId: v1.id, effectiveDate: await businessDate("westco") }),
      403, "SEPARATION_OF_DUTIES");
    assert.deepEqual((await readAs(own)).inFlight.yourActions.activate, yes, "the approver may activate");
    ok(await fn(own, "activateFinancialPolicy", { operatingCompanyId: "westco", versionId: v1.id, effectiveDate: await businessDate("westco"), reason: "go-live" }));

    // THE HISTORY the screen renders: versions with yourActions, the audit trail (who / what / when / reason), actor names.
    const listed = ok(await fn(wPrep, "listFinancialPolicyVersions", { operatingCompanyId: "westco" }));
    assert.deepEqual(listed.items.map((v) => [v.versionNumber, v.status, v.yourActions.edit]), [[1, "ACTIVE", no("FINANCIAL_POLICY_LOCKED")]]);
    assert.deepEqual(listed.auditTrail.map((e) => [e.action, e.actorPrincipalId, e.reason, e.versionNumber]), [
      ["finance.policy.activate", own.principalId, "go-live", 1],
      ["finance.policy.approve", own.principalId, "reviewed with accounting", 1],
      ["finance.policy.submit", dualW.principalId, null, 1],
      ["finance.policy.draft.edit", wPrep.principalId, null, 1],
      ["finance.policy.draft.create", dualW.principalId, "initial", 1],
    ]);
    assert.deepEqual(Object.keys(listed.actorNames).sort(), [dualW.principalId, own.principalId, wPrep.principalId].sort(), "names only for the actors shown");
    const inForce = await readAs(wPrep);
    assert.deepEqual([inForce.state, inForce.inForce.id, inForce.inForce.yourActions.activate, inForce.yourAuthority.createDraft],
      ["CONFIGURED", v1.id, no("CAPABILITY_REQUIRED"), yes]);
    // Another company's history never appears.
    refused(await fn(wPrep, "listFinancialPolicyVersions", { operatingCompanyId: "taylor" }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
  });

  await t.test("MIG: with versions recorded, the Down refuses to reverse", async () => {
    assert.throws(() => migrate("down", 1), (e) => /FINANCIAL_POLICY_FOUNDATION: refuses to reverse/.test(String(e.stderr ?? e.message)));
    assert.notEqual((await one(`SELECT to_regclass('eos_finance.financial_policy_versions') AS r`)).r, null);
  });
});
