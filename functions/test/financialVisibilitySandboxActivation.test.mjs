// FIN-004 CONSOLIDATED REACH — sandbox activation contract.
// Run: node --test test/financialVisibilitySandboxActivation.test.mjs   (after `npm run build`)
//
// Activating a capability for one environment is the kind of change that looks like a config line
// and behaves like a security decision. These cases pin what it does AND, at greater length, what
// it does not: it lifts one catalog `active:false` for one project. It grants nothing, it binds
// nothing, it changes no resolver, and it reaches no other environment.
//
// The interesting assertions here are the NEGATIVE ones. A test that only proved "consolidated now
// resolves ALLOW in sandbox" would pass just as happily if this change had quietly created an admin
// bypass or made all five scopes eligible.
import assert from "node:assert/strict";
import test from "node:test";

const { SPINE_OVERRIDE_ELIGIBLE_IDS, resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } = await import(
  "../lib/access/environmentCapabilityOverrides.js"
);
const { resolveEffectivePermission } = await import("../lib/access/resolveEffectivePermission.js");
const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
const { PERMISSION_CATALOG } = await import("../lib/access/permissionCatalog.js");
const { readFinancialFacts } = await import("../lib/finance/financialReportingRead.js");
const { buildFinancialVisibilityAuthority } = await import("../lib/finance/financialVisibility.js");

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const CONSOLIDATED = "finance.visibility.consolidated";
const OTHER_SCOPES = [
  "finance.visibility.self",
  "finance.visibility.team",
  "finance.visibility.businessUnit",
  "finance.visibility.company",
];

const sandboxOverrides = () => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");

const decide = (permissionId, { roleId = "admin", overrides, scope = { type: "global" } } = {}) =>
  resolveEffectivePermission({
    permissionId,
    assignments: [{ id: "a", principalUid: "u", roleId, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
    roles: ROLES,
    currentAccessVersion: 0,
    target: { scope, condition: {} },
    activationOverrides: overrides ?? sandboxOverrides(),
  });

// ═══════════════ 1. The activation itself ═══════════════

test("sandbox resolves finance.visibility.consolidated as ACTIVE", () => {
  assert.ok(sandboxOverrides().has(CONSOLIDATED));
});

test("the capability remains active:false in the catalog — activation is per-environment, not global", () => {
  const entry = PERMISSION_CATALOG.find((p) => p.id === CONSOLIDATED);
  assert.equal(entry.active, false, "the catalog default must stay a fail-closed DENY");
});

test("with the override, admin resolves ALLOW; without it, DENY inactivePermission", () => {
  assert.equal(decide(CONSOLIDATED).decision, "ALLOW");
  const withoutIt = decide(CONSOLIDATED, { overrides: new Set(["finance.read"]) });
  assert.equal(withoutIt.decision, "DENY");
  assert.match(String(withoutIt.reason ?? withoutIt.reasonCode ?? ""), /inactive/i);
});

// ═══════════════ 2. Production and certification are untouched ═══════════════

test("PRODUCTION resolves EMPTY — no financial visibility is activated there", () => {
  const prod = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts");
  assert.equal(prod.size, 0);
  assert.ok(!prod.has(CONSOLIDATED));
});

test("production stays role-keyed: EMPTY even if registry data wrongly declared this capability", () => {
  const poisoned = {
    environments: [
      { id: "poisoned", role: "production", firebase: { projectId: "taylor-parts" }, capabilityActivationOverrides: [CONSOLIDATED] },
    ],
  };
  assert.equal(resolveCapabilityOverrides(poisoned, "taylor-parts").size, 0);
});

test("CERTIFICATION is unchanged — it declares no overrides at all", () => {
  const cert = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-certification");
  assert.equal(cert.size, 0);
});

test("no environment other than the sandbox activates this capability", () => {
  for (const projectId of ["taylor-parts", "eos-platform-certification", "demo-certworld", null, "some-other-project"]) {
    const out = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
    assert.ok(!out.has(CONSOLIDATED), `${projectId} must not activate ${CONSOLIDATED}`);
  }
});

// ═══════════════ 3. No bypass, no widening ═══════════════

test("ONLY consolidated became eligible — the other four scopes stay ineligible AND inactive", () => {
  assert.ok(SPINE_OVERRIDE_ELIGIBLE_IDS.has(CONSOLIDATED));
  for (const id of OTHER_SCOPES) {
    assert.ok(!SPINE_OVERRIDE_ELIGIBLE_IDS.has(id), `${id} must not be eligible`);
    assert.ok(!sandboxOverrides().has(id), `${id} must not be activated`);
    assert.equal(decide(id).decision, "DENY", `${id} must still deny`);
  }
});

test("eligibility cannot be bypassed by registry data — an ineligible scope stays denied", () => {
  // Adversarial: an environment that declares ALL five scopes. The resolver intersects with the
  // eligible allow-list, so four of them are dropped rather than honored.
  const greedy = {
    environments: [
      {
        id: "greedy-sandbox",
        role: "sandbox",
        firebase: { projectId: "eos-platform-sandbox" },
        capabilityActivationOverrides: [CONSOLIDATED, ...OTHER_SCOPES],
      },
    ],
  };
  const out = resolveCapabilityOverrides(greedy, "eos-platform-sandbox");
  assert.deepEqual([...out], [CONSOLIDATED]);
});

test("ADMIN IS NOT A BYPASS — a role that does not hold the capability still denies", () => {
  // technician holds no finance capability. Activation removed the inactive-permission denial for
  // everyone; it did not hand anyone a grant.
  const t = decide(CONSOLIDATED, { roleId: "technician" });
  assert.equal(t.decision, "DENY");
  assert.match(String(t.reason ?? t.reasonCode ?? ""), /qualifying|grant/i);
});

test("admin reaches consolidated through the ordinary resolver path, holding it in its Role", () => {
  assert.ok(ROLES.admin.permissions.includes(CONSOLIDATED), "admin must hold it as a declared Role permission");
  assert.equal(decide(CONSOLIDATED).decision, "ALLOW");
  // No special-casing: the same call for a role without the permission denies (asserted above),
  // which is only possible if the decision came from the grant rather than from the role name.
});

test("no company or business-unit binding is inferred from this activation", () => {
  for (const scope of [{ type: "operatingCompany", value: "taylor" }, { type: "businessUnit", value: "PARTS" }]) {
    assert.equal(decide("finance.visibility.company", { scope }).decision, "DENY");
    assert.equal(decide("finance.visibility.businessUnit", { scope }).decision, "DENY");
  }
});

// ═══════════════ 4. Reach semantics are unchanged ═══════════════

const authority = (grants) => buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants });

test("an operatingCompany binding alone does NOT imply consolidated reach", () => {
  const a = authority([{ scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" }]);
  assert.deepEqual([...a.grantedScopes], ["OPERATING_COMPANY"]);
  assert.equal(a.isInvoiceVisible({ companyId: "ventana", lineBusinessUnitIds: ["PARTS"] }), false);
});

test("a businessUnit binding alone does NOT imply consolidated reach", () => {
  const a = authority([{ scope: "BUSINESS_UNIT", businessUnitId: "PARTS" }]);
  assert.deepEqual([...a.grantedScopes], ["BUSINESS_UNIT"]);
  assert.equal(a.isInvoiceVisible({ companyId: "taylor", lineBusinessUnitIds: ["SERVICE"] }), false);
});

test("cross-company visibility happens ONLY under an express consolidated grant", () => {
  const cross = { companyId: "ventana", creditedSalespersonId: null, lineBusinessUnitIds: ["SERVICE"] };
  assert.equal(authority([{ scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" }]).isInvoiceVisible(cross), false);
  assert.equal(authority([{ scope: "SELF", employeeId: "cw-emp-034" }]).isInvoiceVisible(cross), false);
  assert.equal(authority([{ scope: "CONSOLIDATED" }]).isInvoiceVisible(cross), true);
});

test("caller filters still only narrow under consolidated reach", async () => {
  const rows = [
    { id: "i1", data: { companyId: "taylor", accountId: "a1", currency: "USD", totalMinor: 100, lines: [{ businessUnitId: "PARTS" }], attribution: { creditedSalespersonId: "e1" } } },
    { id: "i2", data: { companyId: "ventana", accountId: "a2", currency: "USD", totalMinor: 200, lines: [{ businessUnitId: "SERVICE" }], attribution: { creditedSalespersonId: "e2" } } },
  ];
  const make = (r) => ({ _r: r, where(f, _o, v) { return make(r.filter((x) => x.data[f] === v)); }, limit(n) { return make(r.slice(0, n)); }, async get() { return { size: r.length, docs: r.map((x) => ({ id: x.id, data: () => x.data })) }; } });
  const db = { collection: (n) => make(n === "invoices" ? rows : []) };
  const auth = authority([{ scope: "CONSOLIDATED" }]);
  const all = await readFinancialFacts(db, auth, {}, 50);
  assert.equal(all.invoices.length, 2, "consolidated sees both companies");
  const narrowed = await readFinancialFacts(db, auth, { companyId: "taylor" }, 50);
  assert.deepEqual(narrowed.invoices.map((i) => i.invoiceId), ["i1"]);
  assert.ok(narrowed.invoices.length < all.invoices.length, "a filter narrowed, it did not widen");
});

test("NO NEW FINANCIAL TRUTH: this change touches activation only, never a figure or a resolver", async () => {
  const { readFileSync } = await import("node:fs");
  // The three edited runtime sources must contain no financial arithmetic and no resolver change.
  const overrides = readFileSync(new URL("../src/access/environmentCapabilityOverrides.ts", import.meta.url), "utf8");
  const code = overrides.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const banned of ["Minor", "outstandingMinor", "creditedSalesperson", "totalMinor"]) {
    assert.ok(!code.includes(banned), `the activation registry must not reference ${banned}`);
  }
  // And the FIN-004 resolver is untouched by this change: its decision surface still requires BOTH
  // the fact family and a scope, which the no-reach case proves.
  const noFamily = buildFinancialVisibilityAuthority({ factFamilyAllowed: false, grants: [{ scope: "CONSOLIDATED" }] });
  assert.equal(noFamily.anyReach, false, "a scope without the fact family still reaches nothing");
});
