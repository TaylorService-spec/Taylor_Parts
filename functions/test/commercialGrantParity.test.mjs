// COMMERCIAL GRANT PARITY -- lane S5, 2026-09-25. MEASUREMENT + PREPARED PROPOSAL. APPLIES NOTHING.
//
// Report: docs/security/commercial-grant-parity-2026-09-25.md
//
// For every commercial capability (opportunity.*, salesAgreement.*, salesOrder.*, coverage.*) this
// pins, across the three sources that answer "who holds it", what each one says TODAY for
// salesperson / salesManager / owner, with dispatcher / generalManager / admin for context:
//
//   CATALOG    the compiled Role catalog (access/compatibilityRoles.ts + access/governedBusinessRoles.ts),
//              read through the SAME derivation the governed reconcile tool uses (deriveLegacyRoleGrants).
//   BASELINE   adminPolicy/seed/roleCapabilityAuthorityBaseline.json -- the deterministic rebuild of the
//              repository's PostgreSQL authority (migrations + seed + catalog reconcile), which
//              roleCapabilityAuthorityBaselinePostgres.test.mjs proves equals nonprod (413).
//   MATRIX     docs/governance/role-capability-contract.json -- the canonical business-intent
//              Object matrix (generated from docs/assessments/detailed-crud.json, workbook v2).
//
// TWO KINDS OF TEST, deliberately separated:
//
//   CURRENT STATE  run now, must pass now. When the Owner rules and the correction lands, the ones
//                  that describe the gap WILL go red on purpose -- that is the reviewed diff, and they
//                  move in the same change as the migration (see the report's fan-out list).
//   PROPOSED STATE skipped until `OWNER_RULING` below names the ruling. They describe the authority
//                  the proposal would produce; they are written now so the correction lane flips one
//                  constant instead of re-deriving the expectation. Skipped tests never make CI red.
//
// Dependency-free: node:test + assert against compiled lib/ and committed JSON. No database, no
// emulator, no network. Prerequisite: `npm run build` in functions/.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveLegacyRoleGrants } from "../lib/eosOps/migration/inventoryCapabilityGrantMigration.js";
import { OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES } from "../lib/access/governedBusinessRoles.js";
import {
  OPPORTUNITY_WORKFLOW,
  SALES_AGREEMENT_WORKFLOW,
  SALES_ORDER_WORKFLOW,
} from "../lib/adminPolicy/workflowSeeds.js";

// ── THE ONE SWITCH ───────────────────────────────────────────────────────────────────────────────
// null until the Owner rules on the proposal. The correction lane sets it to the ruling's reference
// (e.g. "DECISIONS #NNN") IN THE SAME CHANGE as the migration + baseline, which un-skips the
// proposed-state suite and requires it to pass.
const OWNER_RULING = null;
const AWAITING = "PROPOSAL -- awaiting Owner ruling on docs/security/commercial-grant-parity-2026-09-25.md";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(HERE, "..", ...p), "utf8"));
const BASELINE = readJson("src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json");
const CONTRACT = readJson("..", "docs", "governance", "role-capability-contract.json");
const MANIFEST = readJson("scripts", "fixtures", "sampleCompany.v2.json");
const MIGRATIONS = path.join(HERE, "..", "migrations");

const ROLES = ["salesperson", "salesManager", "owner", "dispatcher", "generalManager", "admin"];

// The nine commercial keys registered in eos_policy.capabilities (migration 1759536000000).
const PG_COMMERCIAL = [
  "opportunity.createSalesOrder",
  "opportunity.read",
  "opportunity.write",
  "salesAgreement.accept",
  "salesAgreement.create",
  "salesAgreement.read",
  "salesAgreement.updateDraft",
  "salesOrder.read",
  "salesOrder.write",
];
// Catalog-only: in permissionCatalog.ts, deliberately NOT registered in PostgreSQL.
const CATALOG_ONLY_COMMERCIAL = ["coverage.read", "coverage.write", "salesOrder.fulfill", "salesOrder.service"];
const ALL_COMMERCIAL = [...PG_COMMERCIAL, ...CATALOG_ONLY_COMMERCIAL];

const pair = (r, c) => `${r}/${c}`;
const catalogPairs = new Set(deriveLegacyRoleGrants(ALL_COMMERCIAL).map((g) => pair(g.roleKey, g.capabilityKey)));
const baselineByPair = new Map(BASELINE.grants.map((g) => [pair(g.roleKey, g.capabilityKey), g]));
const cdnaPairs = new Set(BASELINE.catalogDeclaredNotActivated.map((p) => pair(p.roleKey, p.capabilityKey)));

const heldIn = (set, role) => ALL_COMMERCIAL.filter((c) => set.has(pair(role, c))).sort();
const baselineHeld = (role) => PG_COMMERCIAL.filter((c) => baselineByPair.has(pair(role, c))).sort();

// ════════════════════ CURRENT STATE ════════════════════

test("vocabulary: the nine commercial PostgreSQL keys are exactly the registered ones; coverage/fulfil/service are catalog-only", () => {
  const vocab = MANIFEST.expectedAccess.postgresCapabilityVocabulary;
  assert.deepEqual(vocab.filter((k) => /^(opportunity|salesAgreement|salesOrder|coverage)\./.test(k)).sort(), [...PG_COMMERCIAL].sort());
  for (const k of CATALOG_ONLY_COMMERCIAL) assert.equal(vocab.includes(k), false, `${k} must stay out of eos_policy`);
  // Commercial accountability (migration 1759276800000) is a COLUMN, not a capability: no key exists.
  assert.equal(vocab.some((k) => /accountab/i.test(k)), false);
});

test("CATALOG: the compiled Role catalog's commercial declarations, per Role", () => {
  const SALES_CORE = [
    "opportunity.createSalesOrder", "opportunity.read", "opportunity.write",
    "salesAgreement.accept", "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft",
    "salesOrder.read", "salesOrder.write",
  ];
  assert.deepEqual(heldIn(catalogPairs, "salesperson"), SALES_CORE);
  assert.deepEqual(heldIn(catalogPairs, "salesManager"), SALES_CORE);
  assert.deepEqual(heldIn(catalogPairs, "generalManager"), SALES_CORE);
  // DECISIONS #121 + compatibility base: admin and dispatcher hold the whole sell side plus fulfil/service.
  assert.deepEqual(heldIn(catalogPairs, "dispatcher"), [...SALES_CORE, "salesOrder.fulfill", "salesOrder.service"].sort());
  assert.deepEqual(heldIn(catalogPairs, "admin"), [...ALL_COMMERCIAL].sort());
  // Owner ruling A (2026-09-24, fbd670c2): maker/checker -- accept and createSalesOrder DELIBERATELY absent.
  assert.deepEqual(heldIn(catalogPairs, "owner"), [
    "coverage.read", "coverage.write",
    "opportunity.read", "opportunity.write",
    "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft",
    "salesOrder.fulfill", "salesOrder.read", "salesOrder.service", "salesOrder.write",
  ]);
});

test("BASELINE: the rebuilt PostgreSQL authority's commercial grants, per Role, with provenance", () => {
  const SEVEN_MIGRATION_BACKED = [
    "opportunity.read", "opportunity.write",
    "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft",
    "salesOrder.read", "salesOrder.write",
  ];
  for (const role of ["salesperson", "dispatcher", "generalManager", "admin"]) {
    assert.deepEqual(baselineHeld(role), [...PG_COMMERCIAL].sort(), role);
    for (const c of ["opportunity.createSalesOrder", "salesAgreement.accept"]) {
      const g = baselineByPair.get(pair(role, c));
      assert.equal(g.source, "CANONICAL_CATALOG", `${role}/${c}`);
      assert.equal(g.observedGrantedBy, "sample-company-v2:rudy", `${role}/${c} arrived via the Sample Company reconcile`);
    }
  }
  for (const role of ["salesManager", "owner"]) {
    assert.deepEqual(baselineHeld(role), SEVEN_MIGRATION_BACKED, role);
    for (const c of SEVEN_MIGRATION_BACKED) {
      assert.equal(baselineByPair.get(pair(role, c)).source, "MIGRATION_BACKED", `${role}/${c}`);
    }
  }
});

test("GAP: catalog-declared but not granted -- exactly salesManager x {accept, createSalesOrder} among these Roles", () => {
  const gap = [];
  for (const role of ROLES) {
    for (const c of PG_COMMERCIAL) {
      if (catalogPairs.has(pair(role, c)) && !baselineByPair.has(pair(role, c))) gap.push(pair(role, c));
    }
  }
  assert.deepEqual(gap.sort(), ["salesManager/opportunity.createSalesOrder", "salesManager/salesAgreement.accept"]);
  for (const p of gap) assert.ok(cdnaPairs.has(p), `${p} is recorded in catalogDeclaredNotActivated`);
});

test("NO OVER-GRANT against the catalog: every baseline commercial grant for these Roles is catalog-declared", () => {
  for (const role of ROLES) {
    for (const c of baselineHeld(role)) assert.ok(catalogPairs.has(pair(role, c)), `${role}/${c} granted but not catalog-declared`);
  }
});

test("OWNER: ruling A holds in every source -- neither accept nor createSalesOrder is granted or declared", () => {
  for (const c of ["opportunity.createSalesOrder", "salesAgreement.accept"]) {
    assert.ok(OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES.includes(c), `${c} is a named Owner exclusion`);
    assert.equal(catalogPairs.has(pair("owner", c)), false);
    assert.equal(baselineByPair.has(pair("owner", c)), false);
  }
});

test("STALE RECORD: catalogDeclaredNotActivated still lists 17 owner pairs the catalog stopped declaring at ruling A", () => {
  // The baseline was generated (87835135) before ruling A narrowed Owner (fbd670c2), both 2026-09-24.
  const keys = [...new Set(BASELINE.catalogDeclaredNotActivated.map((p) => p.capabilityKey))];
  const declared = new Set(deriveLegacyRoleGrants(keys).map((g) => pair(g.roleKey, g.capabilityKey)));
  const stale = BASELINE.catalogDeclaredNotActivated.filter((p) => !declared.has(pair(p.roleKey, p.capabilityKey)));
  assert.equal(BASELINE.catalogDeclaredNotActivated.length, 30);
  assert.equal(stale.length, 17);
  assert.ok(stale.every((p) => p.roleKey === "owner"));
  assert.deepEqual(
    stale.map((p) => p.capabilityKey).sort(),
    OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES.filter((c) => !c.startsWith("workOrder.lifecycle.")).sort(),
    "the stale rows are exactly ruling A's in-vocabulary exclusions",
  );
});

test("MECHANISM: why salesManager was missed -- no migration grants the two keys, and the reconcile never reached salesManager", () => {
  // (a) the CRED grant-preservation migration carries no salesOrder CREATE row and treats salesAgreement.E
  //     as ambiguous (updateDraft vs accept), so neither key can come from a migration.
  const cred = fs.readFileSync(path.join(MIGRATIONS, "1761523200000_cred-capability-vocabulary-and-grant-preservation.sql"), "utf8");
  assert.equal(/\('salesOrder',\s*'CREATE'\)/.test(cred), false);
  assert.match(cred, /salesAgreement\.E/);
  const grantingMigration = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).filter((f) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    return /INSERT INTO\s+(eos_policy\.)?role_capabilities/i.test(sql) && /cap_salesAgreement_accept|cap_opportunity_createSalesOrder/.test(sql);
  });
  assert.deepEqual(grantingMigration, [], "no migration grants accept/createSalesOrder to anyone");
  // (b) the only reconcile that applied them was the Sample Company seed, scoped to its manifest Roles.
  const scope = new Set(MANIFEST.principals.flatMap((p) => p.securityRoles));
  for (const r of ["salesperson", "dispatcher", "generalManager", "admin"]) assert.ok(scope.has(r), r);
  assert.equal(scope.has("salesManager"), false, "salesManager is not a Sample Company Role, so the scoped reconcile never reached it");
});

test("MATRIX: the governed business-intent Object matrix, commercial rows", () => {
  const rows = (role) => CONTRACT.rows.filter((r) => r.businessRoleId === role && ["Opportunities", "Sales Orders"].includes(r.object));
  const view = (role) => Object.fromEntries(rows(role).map((r) => [r.object, `${r.accessCode}:${[...r.capabilityIds].sort().join(",")}`]));
  const SELLER = {
    Opportunities: "CRE:opportunity.createSalesOrder,opportunity.read,opportunity.write",
    "Sales Orders": "CRE:salesOrder.read,salesOrder.write",
  };
  assert.deepEqual(view("salesperson"), SELLER);
  assert.deepEqual(view("salesManager"), SELLER, "the matrix names salesManager for createSalesOrder");
  assert.deepEqual(view("generalManager"), SELLER);
  assert.deepEqual(view("admin"), SELLER);
  // TENSION, recorded not resolved: the matrix (designStatus Proposed) still names Owner for
  // createSalesOrder; ruling A (later) withholds it. See the report's Owner question 2.
  assert.deepEqual(view("owner"), SELLER);
  // Dispatcher: the matrix asks for Sales Order READ only. The baseline grants the whole sell side (D-18).
  // (Opportunities is an explicit empty cell -- no access asked.)
  assert.deepEqual(view("dispatcher"), { Opportunities: ":", "Sales Orders": "R:salesOrder.read" });
  // Sales Agreement has no matrix row at all; its authority is DECISIONS #121.
  assert.equal(CONTRACT.rows.some((r) => /agreement/i.test(r.object)), false);
});

test("WORKFLOW: salesManager is BOUND to Sales Agreement accept but lacks salesAgreement.accept (a workflow never widens)", () => {
  const accept = SALES_AGREEMENT_WORKFLOW.actions.find((a) => a.key === "accept");
  assert.deepEqual([...accept.roleKeys].sort(), ["admin", "salesManager", "salesperson"]);
  assert.equal(baselineByPair.has(pair("salesManager", "salesAgreement.accept")), false);
  // The Opportunity workflow binds salesManager to `win`; the WON -> Sales Order step then needs
  // opportunity.createSalesOrder, which salesManager does not hold.
  assert.ok(OPPORTUNITY_WORKFLOW.actions.find((a) => a.key === "win").roleKeys.includes("salesManager"));
  // Sales Order transitions bind salesManager and need salesOrder.write, which it DOES hold.
  assert.ok(SALES_ORDER_WORKFLOW.actions.some((a) => a.roleKeys.includes("salesManager")));
  assert.ok(baselineByPair.has(pair("salesManager", "salesOrder.write")));
});

// ════════════════════ PROPOSED STATE (skipped until OWNER_RULING) ════════════════════

const proposed = { skip: OWNER_RULING ? false : AWAITING };

test("PROPOSED A: salesManager holds accept + createSalesOrder, MIGRATION_BACKED by one new grant-bearing migration", proposed, () => {
  for (const c of ["opportunity.createSalesOrder", "salesAgreement.accept"]) {
    const g = baselineByPair.get(pair("salesManager", c));
    assert.ok(g, `salesManager/${c} must be in the baseline`);
    assert.equal(g.source, "MIGRATION_BACKED");
    assert.match(g.evidence, /^migration:\d+$/);
    assert.ok(BASELINE.grantBearingMigrations.includes(g.evidence));
    assert.ok(Number(g.evidence.split(":")[1]) > 1762300800000, "an activation is appended, never back-dated");
    assert.equal(cdnaPairs.has(pair("salesManager", c)), false, "a pair cannot be both authority and a recorded gap");
  }
  assert.deepEqual(baselineHeld("salesManager"), [...PG_COMMERCIAL].sort(), "salesManager now equals salesperson on the sell side");
  assert.equal(BASELINE.totalGrants, 415);
  assert.equal(BASELINE.grants.length, 415);
  assert.equal(BASELINE.countsBySource.MIGRATION_BACKED, 357);
  assert.equal(BASELINE.countsBySource.CANONICAL_CATALOG, 53);
  assert.equal(BASELINE.countsBySource.UNEXPLAINED, 0);
});

test("PROPOSED A: the catalog/baseline gap for these Roles is ZERO", proposed, () => {
  for (const role of ROLES) {
    for (const c of PG_COMMERCIAL) {
      if (catalogPairs.has(pair(role, c))) assert.ok(baselineByPair.has(pair(role, c)), `${role}/${c} still catalog-declared and not granted`);
    }
  }
});

test("PROPOSED B: catalogDeclaredNotActivated carries no pair the catalog no longer declares (17 stale owner rows removed)", proposed, () => {
  const keys = [...new Set(BASELINE.catalogDeclaredNotActivated.map((p) => p.capabilityKey))];
  const declared = new Set(deriveLegacyRoleGrants(keys).map((g) => pair(g.roleKey, g.capabilityKey)));
  assert.deepEqual(BASELINE.catalogDeclaredNotActivated.filter((p) => !declared.has(pair(p.roleKey, p.capabilityKey))), []);
  // 30 - 2 (salesManager activated) - 17 (stale owner) = 11
  assert.equal(BASELINE.catalogDeclaredNotActivated.length, 11);
});

test("INVARIANT UNDER THE PROPOSAL: Owner gains nothing, dispatcher is not silently narrowed", () => {
  // Runs NOW and must keep passing after the correction: the proposal adds two salesManager rows and
  // nothing else. Owner stays maker/checker-excluded; D-18 (dispatcher) is a separate Owner decision.
  assert.equal(baselineByPair.has(pair("owner", "salesAgreement.accept")), false);
  assert.equal(baselineByPair.has(pair("owner", "opportunity.createSalesOrder")), false);
  assert.deepEqual(baselineHeld("dispatcher"), [...PG_COMMERCIAL].sort());
});
