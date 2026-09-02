// FIN-004 REACH COMPOSITION — the invariant, proven across BOTH layers at once.
// Run: node --test test/fin004ReachComposition.test.mjs   (after `npm run build`)
//
//     FINANCIAL REACH = finance.read fact-family authority + explicit finance.visibility.* reach
//     Either one alone reaches nothing.
//
// WHY THIS FILE EXISTS ALONGSIDE THE TWO THAT ALREADY TEST THESE PIECES.
// financialVisibility.test.mjs proves the AUTHORITY layer (given grants, what is visible).
// financialVisibilitySandboxActivation.test.mjs proves the RESOLVER layer (given a role and an
// environment, is a capability ALLOW). Neither drives the two together, so nothing pinned the
// composition that actually decides reach: a Role's declared grant, narrowed by per-environment
// activation, feeding the authority's fact-family-AND-scope rule.
//
// That seam is exactly where a census run went wrong. It measured Role grants by grepping the
// role source files for `finance.visibility.*`, found no literal occurrence, and concluded no
// Role carried any — reporting a fourteen-fact-family blocker that does not exist. admin's
// permissions are DERIVED (ADMIN_CURATED_PERMISSIONS + the whole PERMISSION_CATALOG), so the ids
// are real grants that never appear as literals. A test that composes the layers cannot make
// that mistake, because it asks the resolver instead of reading the file.
//
// composeReach() below mirrors loadFinancialVisibilityAuthority's own composition (the six
// capability decisions → buildFinancialVisibilityAuthority) with the Firestore reads removed. It
// is deliberately NOT a second opinion: it calls the same resolver and the same authority builder.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const { resolveEffectivePermission } = await import("../lib/access/resolveEffectivePermission.js");
const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
const { PERMISSION_CATALOG } = await import("../lib/access/permissionCatalog.js");
const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } = await import(
  "../lib/access/environmentCapabilityOverrides.js"
);
const {
  buildFinancialVisibilityAuthority,
  FINANCIAL_VISIBILITY_CAPABILITIES: VIS,
  FINANCE_READ_FACT_FAMILY_CAPABILITY: FACT_FAMILY,
} = await import("../lib/finance/financialVisibility.js");

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const SANDBOX = () => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");
const PRODUCTION = () => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts");

/** Every scope needs a bound value except CONSOLIDATED; these are the values the loader would bind. */
const GRANT_FOR = {
  CONSOLIDATED: () => ({ scope: "CONSOLIDATED" }),
  SELF: () => ({ scope: "SELF", employeeId: "emp-1" }),
  TEAM: () => ({ scope: "TEAM", visibleEmployeeIds: new Set(["emp-1", "emp-2"]) }),
  BUSINESS_UNIT: () => ({ scope: "BUSINESS_UNIT", businessUnitId: "SERVICE" }),
  OPERATING_COMPANY: () => ({ scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" }),
};

/**
 * Resolve one principal's real financial reach.
 *
 * `activationOverrides` is the per-environment activation set; `assignments` defaults to one
 * active global assignment of `roleId`, which is the ordinary case.
 */
function composeReach({ roleId, activationOverrides, assignments }) {
  const grantList = assignments ?? [
    { id: "a1", principalUid: "u1", roleId, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 },
  ];
  const allows = (permissionId) =>
    resolveEffectivePermission({
      permissionId,
      assignments: grantList,
      roles: ROLES,
      currentAccessVersion: 0,
      target: { scope: { type: "global" }, condition: {} },
      activationOverrides,
    }).decision === "ALLOW";

  const factFamilyAllowed = allows(FACT_FAMILY);
  const grants = [];
  for (const [scope, capabilityId] of Object.entries(VIS)) {
    if (allows(capabilityId)) grants.push(GRANT_FOR[scope]());
  }
  return buildFinancialVisibilityAuthority({ factFamilyAllowed, grants });
}

/** One invoice per shape the scopes discriminate on. */
const INVOICE = {
  taylorServiceMine: { companyId: "taylor", creditedSalespersonId: "emp-1", lineBusinessUnitIds: ["SERVICE"] },
  taylorPartsTeammate: { companyId: "taylor", creditedSalespersonId: "emp-2", lineBusinessUnitIds: ["PARTS"] },
  ventanaServiceStranger: { companyId: "ventana", creditedSalespersonId: "emp-9", lineBusinessUnitIds: ["SERVICE"] },
  crossUnitTaylor: { companyId: "taylor", creditedSalespersonId: "emp-1", lineBusinessUnitIds: ["SERVICE", "PARTS"] },
  unattributed: { companyId: "taylor", creditedSalespersonId: null, lineBusinessUnitIds: [] },
};
const ALL_INVOICES = Object.values(INVOICE);
const reaches = (auth) => ALL_INVOICES.filter((i) => auth.isInvoiceVisible(i)).length;

// ════════════════════ The five required proofs ════════════════════

test("PROOF 1 — ELIGIBILITY ALONE gives zero reach", () => {
  // The environment activates consolidated, but the principal's Role does not carry it.
  // `technician` holds no finance capability of any kind.
  const auth = composeReach({ roleId: "technician", activationOverrides: SANDBOX() });
  assert.equal(auth.factFamilyAllowed, false);
  assert.deepEqual([...auth.grantedScopes], []);
  assert.equal(auth.anyReach, false);
  assert.equal(reaches(auth), 0, "an activated capability nobody holds must reach nothing");
  // And the activation genuinely IS in effect — otherwise this proves nothing.
  assert.ok(SANDBOX().has(VIS.CONSOLIDATED), "precondition: sandbox activates consolidated");
});

test("PROOF 2 — GRANT ALONE, WHILE INACTIVE, gives zero reach", () => {
  // admin carries every capability in the catalog, including all five visibility scopes.
  // Production activates none of them, so the grant resolves DENY inactivePermission.
  assert.equal(PRODUCTION().size, 0, "precondition: production activates nothing");
  const adminPerms = new Set(ROLES.admin.permissions);
  for (const id of Object.values(VIS)) {
    assert.ok(adminPerms.has(id), `precondition: admin must actually CARRY ${id}`);
  }
  const auth = composeReach({ roleId: "admin", activationOverrides: PRODUCTION() });
  assert.deepEqual([...auth.grantedScopes], [], "a held-but-inactive capability confers no scope");
  assert.equal(auth.anyReach, false);
  assert.equal(reaches(auth), 0, "GRANT != ACTIVATION — production must reach nothing");
});

test("PROOF 3 — finance.read WITHOUT visibility gives zero reach", () => {
  // Eleven governed Roles are in exactly this position today, by design.
  const auth = composeReach({ roleId: "accountingManager", activationOverrides: SANDBOX() });
  assert.equal(auth.factFamilyAllowed, true, "precondition: this Role does hold the fact-family gate");
  assert.deepEqual([...auth.grantedScopes], [], "it holds no visibility scope");
  assert.equal(auth.anyReach, false);
  assert.equal(reaches(auth), 0, "the fact family alone reaches nothing");
});

test("PROOF 4 — visibility WITHOUT finance.read gives zero reach", () => {
  // No Role is in this position, so it is constructed directly at the authority layer — which is
  // the layer that enforces it, and the reason a scope can never stand alone.
  for (const scope of Object.keys(GRANT_FOR)) {
    const auth = buildFinancialVisibilityAuthority({ factFamilyAllowed: false, grants: [GRANT_FOR[scope]()] });
    assert.deepEqual([...auth.grantedScopes], [scope], "the scope is genuinely granted");
    assert.equal(auth.anyReach, false, `${scope} without the fact family must reach nothing`);
    assert.equal(reaches(auth), 0, `${scope} without the fact family must see no invoice`);
  }
  // Including all five at once: absence of the fact family is not outvoted by breadth of scope.
  const everything = buildFinancialVisibilityAuthority({
    factFamilyAllowed: false,
    grants: Object.keys(GRANT_FOR).map((s) => GRANT_FOR[s]()),
  });
  assert.equal(everything.anyReach, false);
  assert.equal(reaches(everything), 0);
});

test("PROOF 5 — fact family + ACTIVE visibility grant reaches EXACTLY the governed scope, nothing broader", () => {
  // The real sandbox case: admin carries all five, but only consolidated is ACTIVE there.
  const auth = composeReach({ roleId: "admin", activationOverrides: SANDBOX() });
  assert.equal(auth.factFamilyAllowed, true);
  assert.deepEqual(
    [...auth.grantedScopes],
    ["CONSOLIDATED"],
    "exactly the activated scope — the four inactive ones must NOT appear despite being held",
  );
  assert.equal(auth.anyReach, true);
  assert.equal(reaches(auth), ALL_INVOICES.length, "consolidated is the one scope that spans companies");

  // "Nothing broader" is only meaningful against a scope that is genuinely narrower. Each
  // narrower scope, granted alone, must see strictly less — proving reach follows the scope
  // rather than the principal's identity.
  const narrower = {
    SELF: [INVOICE.taylorServiceMine, INVOICE.crossUnitTaylor],
    TEAM: [INVOICE.taylorServiceMine, INVOICE.taylorPartsTeammate, INVOICE.crossUnitTaylor],
    OPERATING_COMPANY: [INVOICE.taylorServiceMine, INVOICE.taylorPartsTeammate, INVOICE.crossUnitTaylor, INVOICE.unattributed],
    BUSINESS_UNIT: [INVOICE.taylorServiceMine, INVOICE.ventanaServiceStranger],
  };
  for (const [scope, expected] of Object.entries(narrower)) {
    const scoped = buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants: [GRANT_FOR[scope]()] });
    const seen = ALL_INVOICES.filter((i) => scoped.isInvoiceVisible(i));
    assert.deepEqual(seen, expected, `${scope} reached the wrong set`);
    assert.ok(seen.length < ALL_INVOICES.length, `${scope} must be strictly narrower than consolidated`);
  }
  // A cross-unit invoice stays hidden entirely from a BUSINESS_UNIT grant — one immutable
  // financial document is never partially redacted.
  const bu = buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants: [GRANT_FOR.BUSINESS_UNIT()] });
  assert.equal(bu.isInvoiceVisible(INVOICE.crossUnitTaylor), false);
  // An unattributed record is nobody's SELF/TEAM record.
  const self = buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants: [GRANT_FOR.SELF()] });
  assert.equal(self.isInvoiceVisible(INVOICE.unattributed), false);
});

// ════════════════════ The measured Role/scope matrix, pinned ════════════════════

test("MATRIX — exactly admin and owner carry finance.visibility.*; eleven Roles hold the gate alone", () => {
  const carriers = [];
  const gateOnly = [];
  for (const [id, role] of Object.entries(ROLES)) {
    const perms = new Set(role.permissions);
    const scopes = Object.values(VIS).filter((v) => perms.has(v));
    if (scopes.length) carriers.push([id, scopes.length]);
    else if (perms.has(FACT_FAMILY)) gateOnly.push(id);
  }
  assert.deepEqual(carriers.sort(), [["admin", 5], ["owner", 5]], "carrying Roles changed — that is an Owner decision");
  assert.deepEqual(gateOnly.sort(), [
    "accountingManager", "controller", "fieldManager", "generalManager", "partsAssociate",
    "partsManager", "purchasingManager", "salesManager", "salesperson", "shopAssociate", "shopManager",
  ], "the set of Roles holding finance.read WITHOUT reach changed");
});

test("MATRIX — admin's five scopes are DERIVED from the catalog, not listed literally", () => {
  // The census defect, pinned so it cannot recur silently: the ids are real grants that appear
  // nowhere as literals in the Role source. Anyone measuring grants by grep gets the wrong answer.
  const source = readFileSync(new URL("../src/access/compatibilityRoles.ts", import.meta.url), "utf8");
  const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const id of Object.values(VIS)) {
    assert.ok(!code.includes(id), `${id} should NOT appear literally — admin holds it by derivation`);
    assert.ok(ROLES.admin.permissions.includes(id), `${id} must nonetheless be a real admin grant`);
    assert.ok(PERMISSION_CATALOG.some((p) => p.id === id), `${id} must be in the catalog it derives from`);
  }
});

test("MATRIX — every visibility capability stays active:false in the catalog", () => {
  for (const id of Object.values(VIS)) {
    const entry = PERMISSION_CATALOG.find((p) => p.id === id);
    assert.ok(entry, `${id} must be registered`);
    assert.equal(entry.active, false, `${id} must stay fail-closed by default — activation is per-environment`);
  }
});

test("MATRIX — no admin bypass: reach comes from the grant, not the role name", () => {
  // Same environment, same call shape, different Role: the only thing that changed is the grant.
  const asAdmin = composeReach({ roleId: "admin", activationOverrides: SANDBOX() });
  const asTechnician = composeReach({ roleId: "technician", activationOverrides: SANDBOX() });
  assert.equal(asAdmin.anyReach, true);
  assert.equal(asTechnician.anyReach, false);
  // An admin assignment that is not active confers nothing either — status is not decoration.
  const revoked = composeReach({
    roleId: "admin",
    activationOverrides: SANDBOX(),
    assignments: [
      { id: "a1", principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "revoked", accessVersionAtGrant: 0 },
    ],
  });
  assert.equal(revoked.anyReach, false, "a revoked assignment must confer no reach");
});

// ════════════════════ The Finance Manager contradiction, recorded as a failing-open fact ════════

test("CONTRADICTION — Finance Manager holds NO finance capability, while both descriptions claim parity", () => {
  // Recorded, NOT fixed: which Role is the financial-oversight Role is an Owner decision, and
  // granting one by inference is exactly what this test exists to prevent. This asserts the
  // CURRENT state so the day it is ruled, this test fails and forces the record to be updated.
  const finance = new Set(GOVERNED_BUSINESS_ROLES.financeManager.permissions);
  const accounting = new Set(GOVERNED_BUSINESS_ROLES.accountingManager.permissions);

  assert.equal(finance.size, 5);
  assert.equal(accounting.size, 17);
  assert.deepEqual(
    [...finance].filter((id) => id.startsWith("finance.")),
    [],
    "financeManager holds no finance.* capability at all — it fails the fact-family gate outright",
  );
  assert.ok(accounting.has(FACT_FAMILY), "accountingManager does hold the gate");

  // Both descriptions claim intentional identity. They are not identical.
  for (const roleId of ["financeManager", "accountingManager"]) {
    assert.match(
      GOVERNED_BUSINESS_ROLES[roleId].description,
      /[Ii]ntentionally identical/,
      `${roleId}'s description claims parity`,
    );
  }
  assert.notEqual(finance.size, accounting.size, "...but the two sets differ by twelve permissions");

  // The existing pinning test permits this because it is DIRECTIONAL (accounting ⊇ finance,
  // length >=), which both holds and hides the divergence. Assert the containment it does check,
  // so this file agrees with it rather than contradicting it.
  for (const id of finance) assert.ok(accounting.has(id), `accounting must retain ${id}`);

  // The load-bearing consequence, stated as a decision-forcing assertion.
  const auth = composeReach({ roleId: "financeManager", activationOverrides: SANDBOX() });
  assert.equal(auth.factFamilyAllowed, false);
  assert.equal(auth.anyReach, false, "Finance Manager cannot read a single financial fact anywhere");
});
