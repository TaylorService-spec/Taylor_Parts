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
const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY, SPINE_OVERRIDE_ELIGIBLE_IDS } = await import(
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
  // Seven governed Roles are in exactly this position today, by design. (This case used
  // accountingManager until the 2026-09-02 ruling granted it CONSOLIDATED; `controller` is now
  // the representative gate-only Role, and the full set is pinned in the MATRIX block below.)
  const auth = composeReach({ roleId: "controller", activationOverrides: SANDBOX() });
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

// THE APPROVED MATRIX (Owner ruling 2026-09-02). Every carrier and every scope is named here, so
// a Role that gains or loses financial reach cannot do so quietly — the diff has to say so.
const APPROVED_MATRIX = Object.freeze({
  owner: ["SELF", "TEAM", "BUSINESS_UNIT", "OPERATING_COMPANY", "CONSOLIDATED"],
  admin: ["SELF", "TEAM", "BUSINESS_UNIT", "OPERATING_COMPANY", "CONSOLIDATED"],
  generalManager: ["CONSOLIDATED"],
  financeManager: ["CONSOLIDATED"],
  accountingManager: ["CONSOLIDATED"],
  salesManager: ["TEAM"],
  salesperson: ["SELF"],
});

/** Scope names a Role carries, in the canonical FINANCIAL_VISIBILITY_CAPABILITIES key order. */
function carriedScopes(roleId) {
  const perms = new Set(ROLES[roleId].permissions);
  return Object.entries(VIS).filter(([, id]) => perms.has(id)).map(([scope]) => scope);
}

test("MATRIX — every approved carrier holds exactly its ruled scopes, and nothing more", () => {
  for (const [roleId, expected] of Object.entries(APPROVED_MATRIX)) {
    assert.ok(ROLES[roleId], `${roleId} must exist`);
    assert.deepEqual(carriedScopes(roleId).sort(), [...expected].sort(), `${roleId} carries the wrong scopes`);
    // A scope without the fact-family gate is unreachable by construction, so every carrier
    // must also hold finance.read. This is the pairing the ruling depends on.
    assert.ok(ROLES[roleId].permissions.includes(FACT_FAMILY), `${roleId} carries a scope but not ${FACT_FAMILY}`);
  }
});

test("MATRIX — NO Role outside the approved matrix carries any finance.visibility.*", () => {
  const unexpected = Object.keys(ROLES).filter((id) => !(id in APPROVED_MATRIX) && carriedScopes(id).length > 0);
  assert.deepEqual(unexpected, [], `these Roles gained financial reach without a ruling: ${unexpected.join(", ")}`);
});

test("MATRIX — BUSINESS_UNIT and OPERATING_COMPANY gained no new carrier", () => {
  // The ruling is explicit: those scope types stay valid architecture for future explicit use,
  // and this change establishes no new carrier. admin/owner held them before and still do.
  for (const scope of ["BUSINESS_UNIT", "OPERATING_COMPANY"]) {
    const carriers = Object.keys(ROLES).filter((id) => carriedScopes(id).includes(scope)).sort();
    assert.deepEqual(carriers, ["admin", "owner"], `${scope} carriers changed`);
  }
});

test("MATRIX — holding the gate with no scope stays an allowed, intentional fail-closed state", () => {
  const gateOnly = Object.keys(ROLES)
    .filter((id) => ROLES[id].permissions.includes(FACT_FAMILY) && carriedScopes(id).length === 0)
    .sort();
  assert.deepEqual(gateOnly, [
    "controller", "fieldManager", "partsAssociate", "partsManager",
    "purchasingManager", "shopAssociate", "shopManager",
  ], "the set of Roles holding finance.read WITHOUT reach changed");
  // Each of them genuinely reaches nothing — the state is intentional, not merely unlisted.
  for (const roleId of gateOnly) {
    const auth = composeReach({ roleId, activationOverrides: SANDBOX() });
    assert.equal(auth.factFamilyAllowed, true, `${roleId} should hold the gate`);
    assert.equal(auth.anyReach, false, `${roleId} must reach nothing`);
  }
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

// ════════════════════ Finance Manager parity — CLOSED by Owner ruling 2026-09-02 ════════════════

test("PARITY CLOSED — Finance Manager can now read financial facts, and matches Accounting Manager exactly", () => {
  // This test previously recorded the OPPOSITE as current state: financeManager held 5
  // permissions and zero `finance.*` ids while both descriptions claimed parity. It was written
  // to fail the day the Owner ruled, which is what happened. Exact set equality is proven at its
  // canonical home (governedBusinessRoles.test.mjs); what is proven HERE is the consequence that
  // matters to FIN-004 — the Role can actually reach a financial fact.
  const finance = new Set(GOVERNED_BUSINESS_ROLES.financeManager.permissions);
  const accounting = new Set(GOVERNED_BUSINESS_ROLES.accountingManager.permissions);
  assert.equal(finance.size, accounting.size);
  assert.ok([...accounting].every((id) => finance.has(id)) && [...finance].every((id) => accounting.has(id)));

  const auth = composeReach({ roleId: "financeManager", activationOverrides: SANDBOX() });
  assert.equal(auth.factFamilyAllowed, true, "the gate the drift had removed");
  assert.deepEqual([...auth.grantedScopes], ["CONSOLIDATED"]);
  assert.equal(auth.anyReach, true, "Finance Manager reaches financial facts in sandbox");
});

// ════════════════════ Activation state — measured, and deliberately NOT completed ═══════════════

test("ACTIVATION — CONSOLIDATED is sandbox-active; TEAM and SELF are neither eligible nor active", () => {
  // The ruling is explicit that the matrix must NOT be "completed" by activating TEAM/SELF here.
  // This asserts the measured state so that activating one later is a visible, deliberate change.
  assert.ok(SANDBOX().has(VIS.CONSOLIDATED), "CONSOLIDATED must be sandbox-active");
  for (const scope of ["TEAM", "SELF", "BUSINESS_UNIT", "OPERATING_COMPANY"]) {
    assert.ok(!SANDBOX().has(VIS[scope]), `${scope} must NOT be activated by this change`);
    assert.ok(!SPINE_OVERRIDE_ELIGIBLE_IDS.has(VIS[scope]), `${scope} must not even be ELIGIBLE`);
  }
  assert.equal(PRODUCTION().size, 0, "production activates nothing at all");
});

test("ACTIVATION — the CONSOLIDATED carriers reach in sandbox; salesManager and salesperson do not", () => {
  for (const roleId of ["owner", "admin", "generalManager", "financeManager", "accountingManager"]) {
    const auth = composeReach({ roleId, activationOverrides: SANDBOX() });
    assert.deepEqual([...auth.grantedScopes], ["CONSOLIDATED"], `${roleId} should resolve exactly CONSOLIDATED`);
    assert.equal(auth.anyReach, true, `${roleId} should reach in sandbox`);
  }
  // GRANT != ACTIVATION. These two hold a real, ruled grant and still reach nothing, because the
  // scope they carry is not active anywhere. That is the correct outcome, not an incomplete one.
  for (const roleId of ["salesManager", "salesperson"]) {
    assert.ok(carriedScopes(roleId).length === 1, `${roleId} carries its ruled scope`);
    const auth = composeReach({ roleId, activationOverrides: SANDBOX() });
    assert.equal(auth.factFamilyAllowed, true, `${roleId} holds the gate`);
    assert.deepEqual([...auth.grantedScopes], [], `${roleId} must resolve NO scope while TEAM/SELF are inactive`);
    assert.equal(auth.anyReach, false);
  }
});

test("ACTIVATION — production reaches nothing for any approved carrier, admin and owner included", () => {
  for (const roleId of Object.keys(APPROVED_MATRIX)) {
    const auth = composeReach({ roleId, activationOverrides: PRODUCTION() });
    assert.deepEqual([...auth.grantedScopes], [], `${roleId} must resolve no scope in production`);
    assert.equal(auth.anyReach, false, `${roleId} must reach nothing in production`);
  }
});

// ════════════════════ TEAM / SELF binding — fail-closed even once activated ═════════════════════
//
// The grants are ruled but their scopes are inactive, so the composition above cannot exercise the
// BINDING rules. These assert the binding contract directly at the authority layer, which is where
// loadFinancialVisibilityAuthority enforces it — so the fail-closed behaviour is pinned BEFORE any
// future activation, not discovered after one.

test("BINDING — TEAM with an unresolved team reaches nothing, and never widens", () => {
  // The loader pushes a TEAM grant only when visibleEmployeeIdsFor() returns a non-empty set; an
  // empty resolution becomes a BLOCKED scope instead. Both halves are asserted here.
  const unresolved = buildFinancialVisibilityAuthority({
    factFamilyAllowed: true,
    grants: [],
    blockedScopes: [{ scope: "TEAM", reason: "no visible employees resolved for this principal" }],
  });
  assert.equal(unresolved.anyReach, false, "an unresolved team must not reach");
  assert.equal(reaches(unresolved), 0);
  assert.equal(unresolved.blockedScopes.length, 1, "and the block is surfaced, not silent");

  // A resolved team reaches its own members and NOBODY else — never everything.
  const resolved = buildFinancialVisibilityAuthority({
    factFamilyAllowed: true,
    grants: [{ scope: "TEAM", visibleEmployeeIds: new Set(["emp-1"]) }],
  });
  assert.equal(resolved.isInvoiceVisible(INVOICE.taylorServiceMine), true, "own member");
  assert.equal(resolved.isInvoiceVisible(INVOICE.taylorPartsTeammate), false, "a non-member stays hidden");
  assert.equal(resolved.isInvoiceVisible(INVOICE.ventanaServiceStranger), false, "a stranger stays hidden");
  assert.equal(resolved.isInvoiceVisible(INVOICE.unattributed), false, "an unattributed record is nobody's team record");
  assert.ok(reaches(resolved) < ALL_INVOICES.length, "TEAM is never CONSOLIDATED");

  // An empty visible set is REFUSED at construction — stronger than matching nothing. It is not
  // expressible as a grant at all, so no code path can hold a TEAM grant that means "everyone"
  // or "nobody"; an unresolved team must travel as the BLOCKED scope asserted above.
  assert.throws(
    () => buildFinancialVisibilityAuthority({
      factFamilyAllowed: true,
      grants: [{ scope: "TEAM", visibleEmployeeIds: new Set() }],
    }),
    /non-empty visible-employee set/,
    "an empty team set must be refused, not silently treated as a wildcard or a no-op",
  );
});

test("BINDING — SELF without an employee binding reaches nothing", () => {
  const unbound = buildFinancialVisibilityAuthority({
    factFamilyAllowed: true,
    grants: [],
    blockedScopes: [{ scope: "SELF", reason: "principal has no linked employeeId" }],
  });
  assert.equal(unbound.anyReach, false, "no linked Employee ⇒ no reach");
  assert.equal(reaches(unbound), 0);

  // A bound SELF reaches only records credited to that employee — and credit is the frozen
  // FIN-002 attribution, never the acting user.
  const bound = buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants: [GRANT_FOR.SELF()] });
  assert.equal(bound.isInvoiceVisible(INVOICE.taylorServiceMine), true);
  assert.equal(bound.isInvoiceVisible(INVOICE.taylorPartsTeammate), false, "a teammate's record is not SELF");
  assert.equal(bound.isInvoiceVisible(INVOICE.unattributed), false, "an uncredited record is nobody's SELF record");

  // An empty or whitespace employeeId cannot be constructed into a reaching grant.
  for (const bad of ["", "   "]) {
    assert.throws(
      () => buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants: [{ scope: "SELF", employeeId: bad }] }),
      "a blank employeeId must be refused, not treated as a wildcard",
    );
  }
});
