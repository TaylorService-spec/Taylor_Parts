// EOS Ownership Model v1 — parity between the CLIENT ownership authorities
// (src/domain/operatingCompanyAuthority.js, src/domain/typedOwner.js) and their trusted-side
// mirrors (functions/src/ownership/*.ts), plus the invariants that must hold on the client copy
// on its own.
//
// Why parity is tested rather than trusted: the repo already runs this discipline for
// inventoryControlLifecycle, and for the same reason. Two copies of a decision drift, and an
// ownership decision that differs between the client projection and the trusted one would show a
// user one owner while the server recorded another. The two modules are compared on the same
// canonical case table, so a change to one that is not made to the other fails here.
//
// The TypeScript mirror is read as SOURCE, not imported: this suite runs from the client package,
// which has no compiled `functions/lib`. Comparing the declared tables is enough to catch the
// drift that matters -- a company added on one side only, an owner type added on one side only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  OPERATING_COMPANIES,
  OPERATING_COMPANY_IDS,
  isOperatingCompanyIdShape,
  resolveOperatingCompany,
} from "../src/domain/operatingCompanyAuthority.js";
import {
  OWNER_TYPES,
  OWNERSHIP_RESOLUTION,
  combineOwnerDerivations,
  deriveAccountOwner,
  deriveCompanyOwner,
  deriveEmployeeRefOwner,
  isTypedOwner,
  typedOwner,
} from "../src/domain/typedOwner.js";
import { ACCOUNT_LINE_OF_BUSINESS } from "../src/domain/constants.js";
import { OWNERSHIP, resolveOwnershipTitle } from "../src/domain/inventoryControlLifecycle.js";

const here = dirname(fileURLToPath(import.meta.url));
const TS_COMPANY_SRC = join(here, "..", "..", "functions", "src", "ownership", "operatingCompanyAuthority.ts");
const TS_OWNER_SRC = join(here, "..", "..", "functions", "src", "ownership", "typedOwner.ts");

// ============================== parity with the trusted mirror ==============================

test("parity: the trusted mirror seeds the same companies, with the same ids and codes", () => {
  const ts = readFileSync(TS_COMPANY_SRC, "utf8");
  for (const company of OPERATING_COMPANIES) {
    assert.ok(ts.includes(`id: OPERATING_COMPANY_IDS.${company.code}`), `mirror is missing ${company.id}`);
    assert.ok(ts.includes(`code: "${company.code}"`), `mirror is missing code ${company.code}`);
    assert.ok(ts.includes(`displayName: "${company.displayName}"`), `mirror is missing ${company.displayName}`);
  }
  // And no EXTRA company on the trusted side that the client does not know about.
  const mirrorIds = [...ts.matchAll(/^\s{2}([A-Z]+): "([a-z-]+)",$/gm)].map((m) => m[2]);
  assert.deepEqual(mirrorIds.sort(), OPERATING_COMPANIES.map((c) => c.id).sort());
});

test("parity: both sides declare the same id shape and the same owner types", () => {
  const company = readFileSync(TS_COMPANY_SRC, "utf8");
  const owner = readFileSync(TS_OWNER_SRC, "utf8");
  assert.ok(company.includes("/^[a-z][a-z0-9_-]{1,62}$/"), "id shape regex differs between the mirrors");
  for (const type of Object.keys(OWNER_TYPES)) {
    assert.ok(owner.includes(`${type}: "${type}"`), `mirror is missing owner type ${type}`);
  }
  for (const state of Object.keys(OWNERSHIP_RESOLUTION)) {
    assert.ok(owner.includes(`${state}: "${state}"`), `mirror is missing resolution state ${state}`);
  }
});

// ============================== the canonical case table ==============================
//
// Every row is a decision both mirrors must make identically. The client side is asserted here;
// functions/test/ownershipModel.test.mjs asserts the same rows against the trusted copy.

const CASES = [
  { name: "seeded company id", fn: () => resolveOperatingCompany("taylor").state, expect: "RESOLVED" },
  { name: "company code is not an id", fn: () => resolveOperatingCompany("TAYLOR").state, expect: "INVALID" },
  { name: "display name is not an id", fn: () => resolveOperatingCompany("Ventana").state, expect: "INVALID" },
  { name: "well-formed unseeded id", fn: () => resolveOperatingCompany("third-company").state, expect: "UNKNOWN" },
  { name: "account owner projects", fn: () => deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "e1" } }).owner.id, expect: "e1" },
  { name: "account owner absent", fn: () => deriveAccountOwner({}).resolution, expect: "OWNERLESS" },
  { name: "account owner broken", fn: () => deriveAccountOwner({ accountOwner: {} }).resolution, expect: "UNRESOLVED" },
  { name: "employee ref projects", fn: () => deriveEmployeeRefOwner({ ownerEmployeeId: "e2" }).owner.type, expect: "USER" },
  { name: "company owner projects", fn: () => deriveCompanyOwner({ operatingCompanyId: "ventana" }).owner.id, expect: "ventana" },
  { name: "unseeded company owner", fn: () => deriveCompanyOwner({ operatingCompanyId: "acme" }).resolution, expect: "UNRESOLVED" },
];

for (const c of CASES) {
  test(`canonical case: ${c.name}`, () => assert.equal(c.fn(), c.expect));
}

test("conflicting owners are AMBIGUOUS on the client side too -- it never picks one", () => {
  const combined = combineOwnerDerivations([
    deriveEmployeeRefOwner({ ownerEmployeeId: "e1" }),
    deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "e2" } }),
  ]);
  assert.equal(combined.resolution, OWNERSHIP_RESOLUTION.AMBIGUOUS);
  assert.equal(combined.owner, null);
});

// ============================== the non-collapse invariants ==============================

test("a typed owner is exactly two fields, and there is no CUSTOMER or ROLE owner type", () => {
  assert.ok(isTypedOwner({ type: "USER", id: "e1" }));
  assert.ok(!isTypedOwner({ type: "USER", id: "e1", displayName: "Rudy" }));
  assert.equal(typedOwner("CUSTOMER", "acct-1"), null);
  assert.equal(typedOwner("ROLE", "PARTS_MANAGER"), null);
  assert.deepEqual(Object.keys(OWNER_TYPES).sort(), ["COMPANY", "USER"]);
});

test("D-3: title holder and record owner are separate axes and neither derives the other", () => {
  // A CUSTOMER may hold title. That fact is unchanged, and it produces no owner.
  assert.equal(resolveOwnershipTitle({ explicitTitleHolder: OWNERSHIP.CUSTOMER }), "CUSTOMER");
  assert.equal(typedOwner("COMPANY", "CUSTOMER"), null);
  // A record carrying a company owner says nothing about title, and vice versa.
  assert.deepEqual(deriveCompanyOwner({ operatingCompanyId: "taylor", explicitTitleHolder: "CUSTOMER" }).owner, {
    type: "COMPANY",
    id: "taylor",
  });
});

test("D-2: line of business is NOT the company authority -- it is multi-valued and cannot answer", () => {
  // The ruling forbids inferring the operating company from lineOfBusiness. The structural reason
  // is that an Account may legitimately be BOTH, so there is no single answer to infer.
  const both = [ACCOUNT_LINE_OF_BUSINESS.TAYLOR, ACCOUNT_LINE_OF_BUSINESS.VENTANA];
  assert.equal(both.length, 2);
  // And the tokens themselves are not valid company ids, so a mistaken hand-off of one fails closed.
  for (const token of both) {
    assert.ok(!isOperatingCompanyIdShape(token));
    assert.equal(deriveCompanyOwner({ operatingCompanyId: token }).resolution, OWNERSHIP_RESOLUTION.UNRESOLVED);
  }
  assert.equal(OPERATING_COMPANY_IDS.TAYLOR, "taylor");
});
