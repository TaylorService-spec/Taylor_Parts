// FIN-004 — financial visibility: the scope authority, pinned.
//
// CAN PERFORM WORK != CAN SEE FINANCIAL RESULT. These cases pin the reach semantics of every
// scope, the union rule, and the fail-closed edges: a principal with no scope sees nothing, a
// record with no credited person is nobody's SELF/TEAM record, a cross-unit invoice is hidden
// entirely under a BUSINESS_UNIT scope, and a valueless COMPANY/BU grant confers nothing
// (FIN-BLOCK-001) rather than everything.
//
// Run: node --test test/financialVisibility.test.mjs   (also the finance CI lane)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  FINANCIAL_VISIBILITY_SCOPES,
  FINANCIAL_VISIBILITY_CAPABILITIES,
  FinancialVisibilityError,
  buildFinancialVisibilityAuthority,
  invoiceVisibilityFacts,
} = await import("../lib/finance/financialVisibility.js");
const { findPermission } = await import("../lib/access/permissionCatalog.js");

const taylorInvoice = { companyId: "taylor", creditedSalespersonId: "emp-a", lineBusinessUnitIds: ["PARTS"] };
const ventanaInvoice = { companyId: "ventana", creditedSalespersonId: "emp-b", lineBusinessUnitIds: ["EQUIPMENT_SALES"] };
const mixedUnits = { companyId: "taylor", creditedSalespersonId: "emp-a", lineBusinessUnitIds: ["PARTS", "INSTALLATION"] };
const uncredited = { companyId: "taylor", creditedSalespersonId: null, lineBusinessUnitIds: ["PARTS"] };

const authority = (grants, factFamilyAllowed = true) =>
  buildFinancialVisibilityAuthority({ factFamilyAllowed, grants });

test("the five scopes are exactly the FIN-004 lattice, and each capability id is registered inactive", () => {
  assert.deepEqual([...FINANCIAL_VISIBILITY_SCOPES], ["SELF", "TEAM", "BUSINESS_UNIT", "OPERATING_COMPANY", "CONSOLIDATED"]);
  for (const id of Object.values(FINANCIAL_VISIBILITY_CAPABILITIES)) {
    const perm = findPermission(id);
    assert.ok(perm, `${id} must be registered in the catalog`);
    assert.equal(perm.active, false, `${id} must be registered active:false — REGISTER != GRANT != ACTIVATE`);
  }
});

test("no grants ⇒ nothing; fact family alone ⇒ nothing; scope alone without fact family ⇒ nothing", () => {
  assert.equal(authority([]).anyReach, false);
  assert.equal(authority([]).isInvoiceVisible(taylorInvoice), false);
  const scopeOnly = authority([{ scope: "CONSOLIDATED" }], false);
  assert.equal(scopeOnly.anyReach, false, "reach requires the fact family too");
  assert.equal(scopeOnly.isInvoiceVisible(taylorInvoice), false);
});

test("SELF: exactly my credited records — a peer's record and an uncredited record are invisible", () => {
  const a = authority([{ scope: "SELF", employeeId: "emp-a" }]);
  assert.equal(a.isInvoiceVisible(taylorInvoice), true);
  assert.equal(a.isInvoiceVisible(ventanaInvoice), false, "self cannot read a peer");
  assert.equal(a.isInvoiceVisible(uncredited), false, "an honest null credit is nobody's SELF record");
});

test("TEAM: my hierarchy-visible employees and nobody outside it", () => {
  const a = authority([{ scope: "TEAM", visibleEmployeeIds: new Set(["emp-a", "emp-c"]) }]);
  assert.equal(a.isInvoiceVisible(taylorInvoice), true);
  assert.equal(a.isInvoiceVisible(ventanaInvoice), false, "a manager cannot read outside the team");
  assert.equal(a.isInvoiceVisible(uncredited), false);
});

test("BUSINESS_UNIT: wholly-attributable only — a cross-unit invoice stays hidden entirely", () => {
  const a = authority([{ scope: "BUSINESS_UNIT", businessUnitId: "PARTS" }]);
  assert.equal(a.isInvoiceVisible(taylorInvoice), true);
  assert.equal(a.isInvoiceVisible(ventanaInvoice), false, "BU scope cannot cross BU");
  assert.equal(a.isInvoiceVisible(mixedUnits), false,
    "a mixed invoice contains numbers outside the scope — visibility follows the number");
  assert.equal(a.isInvoiceVisible({ ...taylorInvoice, lineBusinessUnitIds: [] }), false, "nothing attributable — fail closed");
  assert.equal(a.isInvoiceVisible({ ...taylorInvoice, lineBusinessUnitIds: ["PARTS", null] }), false, "an unattributed line hides the document");
});

test("OPERATING_COMPANY: exact governed company match, never cross-company", () => {
  const a = authority([{ scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" }]);
  assert.equal(a.isInvoiceVisible(taylorInvoice), true);
  assert.equal(a.isInvoiceVisible(ventanaInvoice), false, "company scope cannot cross company");
  assert.equal(a.isInvoiceVisible({ ...taylorInvoice, companyId: null }), false, "a company-less record matches no company scope");
});

test("CONSOLIDATED sees everything — and only when expressly granted", () => {
  const a = authority([{ scope: "CONSOLIDATED" }]);
  for (const inv of [taylorInvoice, ventanaInvoice, mixedUnits, uncredited]) {
    assert.equal(a.isInvoiceVisible(inv), true);
  }
  // No other scope combination reaches everything:
  const partial = authority([
    { scope: "SELF", employeeId: "emp-a" },
    { scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" },
  ]);
  assert.equal(partial.isInvoiceVisible(ventanaInvoice), false);
});

test("reach is the UNION of granted scopes", () => {
  const a = authority([
    { scope: "SELF", employeeId: "emp-b" },
    { scope: "BUSINESS_UNIT", businessUnitId: "PARTS" },
  ]);
  assert.equal(a.isInvoiceVisible(taylorInvoice), true, "via BU");
  assert.equal(a.isInvoiceVisible(ventanaInvoice), true, "via SELF");
  assert.equal(a.isInvoiceVisible({ companyId: "x", creditedSalespersonId: "emp-z", lineBusinessUnitIds: ["SERVICE"] }), false);
});

test("a valueless COMPANY/BU/SELF/TEAM grant is refused at build time — never 'everything of that kind'", () => {
  for (const bad of [
    { scope: "OPERATING_COMPANY", operatingCompanyId: "" },
    { scope: "BUSINESS_UNIT", businessUnitId: "  " },
    { scope: "SELF", employeeId: "" },
    { scope: "TEAM", visibleEmployeeIds: new Set() },
  ]) {
    assert.throws(() => authority([bad]), (e) => e instanceof FinancialVisibilityError && e.code === "SCOPE_VALUE_REQUIRED");
  }
});

test("blocked scopes are carried for reporting and confer no reach", () => {
  const a = buildFinancialVisibilityAuthority({
    factFamilyAllowed: true,
    grants: [],
    blockedScopes: [{ scope: "OPERATING_COMPANY", reason: "FIN-BLOCK-001" }],
  });
  assert.equal(a.anyReach, false);
  assert.equal(a.blockedScopes.length, 1);
  assert.equal(a.isInvoiceVisible(taylorInvoice), false);
});

test("invoiceVisibilityFacts extracts raw stored facts tolerantly (pre-FIN-002 shapes → honest nulls)", () => {
  const facts = invoiceVisibilityFacts({
    companyId: "taylor",
    attribution: { creditedSalespersonId: "emp-a" },
    lines: [{ businessUnitId: "PARTS" }, {}],
  });
  assert.deepEqual(facts, { companyId: "taylor", creditedSalespersonId: "emp-a", lineBusinessUnitIds: ["PARTS", null] });
  assert.deepEqual(invoiceVisibilityFacts({}), { companyId: null, creditedSalespersonId: null, lineBusinessUnitIds: [] });
});

test("there is no role-name bypass anywhere in the authority — decisions are grants, not identities", () => {
  // Admin's 'full governed access' is a CONSOLIDATED grant like anyone else's; the module has no
  // notion of who the principal is. Source-asserted: the pure authority never mentions a role.
  const src = readFileSync(new URL("../src/finance/financialVisibility.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\badmin\b(?!istration)/i, "no admin special-case");
  assert.doesNotMatch(src, /roleId|ROLES\./, "no role branch");
});
