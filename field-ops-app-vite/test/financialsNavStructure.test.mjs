// FINANCIALS FRAME 0 — the governed section structure, pinned.
//
// Frame 0 promoted the hidden `future: true` Financials stub to a real first-class domain
// with the twenty Owner-approved sections. This file is that structure's contract:
// navigation/presentation ONLY, conservative default access, no invented capability
// identifiers, no route grammar surprises, and no honesty regressions in the placeholder
// copy. FIN-001+ compose real governed authority into these sections later
// (docs/financials/FINANCIALS_AUTHORITY_AND_REPORTING_BASELINE.md); nothing here is
// implemented merely because its destination exists.
//
// Run: node --test test/financialsNavStructure.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible, PLACEHOLDER_DEFAULT_ROLES } from "../src/navigation/navConfig.js";
import { ROLE_NAV_ACCESS } from "../src/domain/constants.js";

const financials = NAV_DOMAINS.find((domain) => domain.key === "financials");

// Sections whose real North Star composition has shipped (App.jsx branch exists; the item
// no longer renders PlaceholderPage and must not carry placeholder copy). Grows per wave.
const IMPLEMENTED_SECTION_KEYS = new Set([
  // Wave UX-1 — lifecycle read spine (design: docs/north-star/financials/).
  "overview",
  "invoices",
  "accountsReceivable",
  "payments",
  "customerFinancials",
  // Wave UX-2 — billing / corrections.
  "billingQueue",
  "creditsAdjustments",
  // Wave UX-3 — plan / forecast.
  "salesToGoal",
  "costToBudget",
  "forecasting",
  "budgets",
  "goals",
]);

const APPROVED_SECTION_KEYS = [
  "overview",
  "billingQueue",
  "invoices",
  "accountsReceivable",
  "payments",
  "creditsAdjustments",
  "customerFinancials",
  "salesToGoal",
  "costToBudget",
  "forecasting",
  "profitability",
  "budgets",
  "goals",
  "companyPerformance",
  "employeePerformance",
  "reconciliation",
  "intercompany",
  "audit",
  "reports",
  "governance",
];

test("Financials is a real first-class domain — no longer future, no longer hidden", () => {
  assert.ok(financials, "financials domain must exist");
  assert.notEqual(financials.future, true, "must not be future=true");
  assert.notEqual(financials.navHidden, true, "must not be navHidden=true");
  assert.equal(financials.path, "financials");
  assert.equal(financials.label, "Financials");
});

test("the retired future Financials stub no longer exists anywhere", () => {
  assert.equal(NAV_DOMAINS.filter((d) => d.key === "financials").length, 1, "exactly one financials domain");
  assert.equal(NAV_DOMAINS.some((d) => d.future === true && d.key === "financials"), false);
});

test("Financials contains exactly the approved section keys, in order", () => {
  assert.deepEqual(financials.subnav.map((item) => item.key), APPROVED_SECTION_KEYS);
});

test("every Financials child has a unique path and a unique key", () => {
  const paths = financials.subnav.map((item) => item.path);
  assert.equal(new Set(paths).size, paths.length, `duplicate paths: ${paths.join(", ")}`);
  const keys = financials.subnav.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys.join(", ")}`);
});

test('exactly one Financials child uses path "" and it is Overview', () => {
  const indexItems = financials.subnav.filter((item) => item.path === "");
  assert.equal(indexItems.length, 1);
  assert.equal(indexItems[0].key, "overview");
});

test("every child resolves through the normal subnav route grammar", () => {
  // App.jsx's generic loop emits <Route path={item.path || undefined} index={item.path === ""}>
  // under <Route path={domain.path}>. That grammar admits only single, static, lowercase-kebab
  // segments — no slashes, no params, no leading/trailing separators.
  for (const item of financials.subnav) {
    assert.match(item.path, /^$|^[a-z]+(-[a-z]+)*$/, `'${item.key}' path '${item.path}' breaks the subnav route grammar`);
  }
});

test("no Financials item declares a newly invented capabilityAccess (or any other access mechanism)", () => {
  // The Financial Visibility capability model (financial.reporting.*, financial.revenue.read, ...)
  // is a FIN-001/FIN-004 DESIGN INPUT. Declaring identifiers here would make navigation look
  // governed with no authority behind it. Frame 0 items must carry NONE of the access fields,
  // so every one falls to the conservative PLACEHOLDER_DEFAULT_ROLES path.
  for (const item of financials.subnav) {
    assert.equal(item.capabilityAccess, undefined, `'${item.key}' must not declare capabilityAccess`);
    assert.equal(item.operationalRoleAccess, undefined, `'${item.key}' must not declare operationalRoleAccess`);
    assert.equal(item.legacyKey, undefined, `'${item.key}' must not declare a legacyKey`);
    assert.equal(item.alwaysVisible, undefined, `'${item.key}' must not be alwaysVisible`);
  }
});

test("Financials visibility follows existing conservative nav semantics — admin/dispatcher yes, technician no", () => {
  for (const role of PLACEHOLDER_DEFAULT_ROLES) {
    assert.equal(isDomainVisible(financials, role, ROLE_NAV_ACCESS[role]), true, `${role} must see Financials`);
    for (const item of financials.subnav) {
      assert.equal(isNavItemVisible(item, role, ROLE_NAV_ACCESS[role]), true, `${role} must see ${item.key}`);
    }
  }
  assert.equal(isDomainVisible(financials, "technician", ROLE_NAV_ACCESS.technician), false);
  for (const item of financials.subnav) {
    assert.equal(isNavItemVisible(item, "technician", ROLE_NAV_ACCESS.technician), false, `technician must NOT see ${item.key}`);
  }
});

test("technician access is not broadened anywhere by this change", () => {
  // The technician's whole visible destination set must contain nothing under /financials.
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.subnav ?? []) {
      if (domain.key !== "financials") continue;
      assert.equal(
        isNavItemVisible(item, "technician", ROLE_NAV_ACCESS.technician, undefined),
        false,
        `technician gained ${domain.key}/${item.key}`,
      );
    }
  }
});

test("implemented sections carry no placeholder copy — the real page renders, not PlaceholderPage", () => {
  for (const item of financials.subnav) {
    if (!IMPLEMENTED_SECTION_KEYS.has(item.key)) continue;
    assert.equal(
      item.placeholderExplanation,
      undefined,
      `'${item.key}' is implemented and must not carry stale placeholder copy`,
    );
  }
});

test("placeholder explanations never claim that financial authority already exists", () => {
  for (const item of financials.subnav) {
    if (IMPLEMENTED_SECTION_KEYS.has(item.key)) continue;
    const copy = item.placeholderExplanation;
    assert.ok(typeof copy === "string" && copy.length > 0, `'${item.key}' must carry honest placeholder copy`);
    // Future-tense contract: every explanation describes what the section WILL do.
    assert.match(copy, /\bwill\b/, `'${item.key}' copy must be future-tense ("will ...")`);
    // No claim of present authority/implementation.
    assert.doesNotMatch(
      copy,
      /\b(is (now )?(implemented|available|live|built)|already (exists|implemented|available))\b/i,
      `'${item.key}' copy claims authority already exists`,
    );
  }
});

test("no existing domain's routes changed — every non-financials domain path set is pinned", () => {
  const routes = (domain) => (domain.subnav ?? []).map((i) => `/${domain.path}${i.path ? `/${i.path}` : ""}`);
  const byKey = Object.fromEntries(NAV_DOMAINS.map((d) => [d.key, routes(d)]));
  assert.deepEqual(byKey.dashboard, ["/dashboard", "/dashboard/operations", "/dashboard/notifications"]);
  assert.deepEqual(byKey.customers, ["/customers", "/customers/opportunities", "/customers/sales-orders"]);
  assert.deepEqual(byKey.serviceOperations, ["/service-operations"]);
  assert.deepEqual(byKey.equipment, ["/equipment"]);
  assert.deepEqual(byKey.service, [
    "/service", "/service/job-assignments", "/service/dispatch", "/service/coordinated-visits",
    "/service/coordinated-mission", "/service/technician-workspace", "/service/scan",
    "/service/dispatcher-board", "/service/scheduling", "/service/dispatch-scheduling", "/service/warranty",
  ]);
  assert.deepEqual(byKey.inventory, [
    "/inventory", "/inventory/part-master", "/inventory/manufacturers", "/inventory/warehouse-workspace",
    "/inventory/warehouses", "/inventory/truck-inventory", "/inventory/transfers", "/inventory/receiving",
    "/inventory/cycle-counts", "/inventory/back-orders",
  ]);
  assert.deepEqual(byKey.inventoryRole, ["/inventory-role/manager", "/inventory-role/warehouse", "/inventory-role/mine"]);
  assert.deepEqual(byKey.purchasing, [
    "/purchasing", "/purchasing/suppliers", "/purchasing/quotes", "/purchasing/receipts", "/purchasing/demand-planning",
  ]);
  assert.deepEqual(byKey.reporting, [
    "/reporting/builder", "/reporting/saved", "/reporting", "/reporting/service", "/reporting/inventory",
    "/reporting/purchasing", "/reporting/warehouse", "/reporting/employees", "/reporting/customers", "/reporting/financial",
  ]);
  assert.deepEqual(byKey.administration, [
    "/administration/overview", "/administration", "/administration/users", "/administration/roles-permissions",
    "/administration/objects", "/administration/permission-preview", "/administration/vehicles",
    "/administration/regions", "/administration/company-settings", "/administration/duplicate-rules",
    "/administration/integrations", "/administration/audit-logs",
  ]);
});

test("the exact Financials route inventory", () => {
  const routes = financials.subnav.map((i) => `/financials${i.path ? `/${i.path}` : ""}`);
  assert.deepEqual(routes, [
    "/financials",
    "/financials/billing-queue",
    "/financials/invoices",
    "/financials/accounts-receivable",
    "/financials/payments",
    "/financials/credits-adjustments",
    "/financials/customer-financials",
    "/financials/sales-to-goal",
    "/financials/cost-to-budget",
    "/financials/forecasting",
    "/financials/profitability",
    "/financials/budgets",
    "/financials/goals",
    "/financials/company-performance",
    "/financials/employee-performance",
    "/financials/reconciliation",
    "/financials/intercompany",
    "/financials/audit",
    "/financials/reports",
    "/financials/governance",
  ]);
});

test("no duplicate keys or routes across the entire nav tree", () => {
  const routes = [];
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.subnav ?? []) {
      routes.push(`/${domain.path}${item.path ? `/${item.path}` : ""}`);
      // Keys are unique WITHIN a domain (cross-domain reuse like reporting/inventory is established).
    }
    const keys = (domain.subnav ?? []).map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys inside domain '${domain.key}'`);
  }
  const dupes = routes.filter((r, i) => routes.indexOf(r) !== i);
  assert.deepEqual(dupes, [], `duplicate routes: ${dupes.join(", ")}`);
});
