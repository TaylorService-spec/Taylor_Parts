// OWNER-APPROVED, APPLIED NOWHERE -- the proof that both halves of that sentence are true.
//
// Set POLICY_TEST_DATABASE_URL to run the database phases; without it they SKIP and every
// pure-function proof still runs, so the separation controls are demonstrated on any machine.
//
// ════════════════════ WHAT IS PROVED ════════════════════
//
// 1. The MEASURED baseline is untouched: still 387 rows, still the same source split, and a clean
//    rebuild still reproduces nonprod exactly. Adding a pending manifest did not weaken the guard
//    whose purpose is that the repository reproduces reality.
// 2. The PENDING set is DISJOINT from the measured authority -- nothing approved is already live,
//    and nothing live is re-declared as approved.
// 3. Applying the pending set to a rebuilt database is REFUSED by the existing guard, which is what
//    makes "approved, not applied" a checkable state rather than a claim.
// 4. THE SIX SEPARATION PROOFS, each executable:
//      counter != reconciler
//      technician does not gain PARTS_OPERATIONS
//      Parts Associate does not gain queue / assignment management
//      Service Manager does not gain completion
//      warehouse POSITION alone does not gain placement / relocation write
//      Owner does not become Admin
// 5. LEAST PRIVILEGE: every Role's projected capability set grows by exactly the pairs the Owner
//    ruling named, and by nothing else.
//
// The database phases WRITE ONLY to POLICY_TEST_DATABASE_URL, a disposable local database.
// Nothing here reads or writes nonprod.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { seedTenantPolicy } from "../lib/adminPolicy/seed/policySeed.js";
import { SOD_EXCLUSIVE_PAIRS } from "../scripts/governance/functionalRoleComposition.mjs";
import {
  AUTHORITY_BASELINE_GRANTS,
  AuthorityBaselineError,
  CATALOG_DECLARED_NOT_ACTIVATED,
  GLOBAL_CATALOG_ACTIVATED_GRANTS,
  NONPROD_ACTIVATED_CAPABILITY_GRANTS,
  SEED_BOUNDARY_MIGRATION,
  assertAuthorityRebuildMatches,
  countsBySource,
  globalAuthorityGrants,
  nonprodAuthorityGrants,
} from "../lib/adminPolicy/roleCapabilityAuthorityBaseline.js";
import {
  PENDING_APPLIED_ENVIRONMENTS,
  PENDING_CAPABILITIES,
  PENDING_CRED_READ_WIRING,
  PENDING_GRANTS,
  PENDING_STATUS,
  PendingCorrectionsError,
  REFUSED_GRANTS,
  RESIDUAL_EDIT_WITHOUT_READ,
  assertPendingIsNotAuthority,
  assertRefusedGrantsAreNotHeld,
  assertSeparationOfDutyPreserved,
  countsByRuling,
  pendingGrantPairs,
  projectedAuthorityIfApplied,
} from "../lib/adminPolicy/pendingAuthorityCorrections.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to rebuild against";

const TENANT = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
const TENANT_KEY = "taylor-nonprod";
const REBUILD_ACTOR = "pending-corrections-rebuild";

const pairId = (p) => `${p.roleKey}\u0000${p.capabilityKey}`;

/** What a Role holds TODAY, from the measured baseline. */
const measuredCapabilitiesOf = (roleKey) =>
  new Set(AUTHORITY_BASELINE_GRANTS.filter((g) => g.roleKey === roleKey).map((g) => g.capabilityKey));

/** What a Role WOULD hold if the pending set were applied. Analysis only -- never authority. */
const projectedCapabilitiesOf = (roleKey) => {
  const held = measuredCapabilitiesOf(roleKey);
  for (const g of PENDING_GRANTS) if (g.roleKey === roleKey) held.add(g.capabilityKey);
  return held;
};

/** Who would hold a capability if the pending set were applied. */
const projectedHoldersOf = (capabilityKey) =>
  [...new Set([
    ...AUTHORITY_BASELINE_GRANTS.filter((g) => g.capabilityKey === capabilityKey).map((g) => g.roleKey),
    ...PENDING_GRANTS.filter((g) => g.capabilityKey === capabilityKey).map((g) => g.roleKey),
  ])].sort();

// ════════════════════ THE MEASURED BASELINE IS UNTOUCHED ════════════════════

test("the MEASURED baseline still says exactly what nonprod holds -- 387, same split", () => {
  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 387, "the pending manifest must not have grown the measurement");
  assert.deepEqual(countsBySource(), {
    MIGRATION_BACKED: 329, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0,
  });
  assert.equal(globalAuthorityGrants().length, 382);
  assert.equal(nonprodAuthorityGrants().length, 387);
});

test("the manifest declares itself APPROVED and applied to NO environment", () => {
  assert.equal(PENDING_STATUS, "APPROVED_NOT_APPLIED");
  assert.deepEqual([...PENDING_APPLIED_ENVIRONMENTS], [],
    "this lane is not authorized to apply anything; a non-empty list here is a false claim");
});

test("the pending set is DISJOINT from the measured authority, in both directions", () => {
  assertPendingIsNotAuthority(nonprodAuthorityGrants());
  const measured = new Set(nonprodAuthorityGrants().map(pairId));
  for (const p of pendingGrantPairs()) {
    assert.ok(!measured.has(pairId(p)), `${p.roleKey}/${p.capabilityKey} is already held -- it is not pending`);
  }
  // ...and the guard is not vacuous: a pending row that IS held is refused.
  assert.throws(
    () => assertPendingIsNotAuthority(nonprodAuthorityGrants(),
      [{ roleKey: "admin", capabilityKey: "warehouse.record.read" }]),
    (err) => err instanceof PendingCorrectionsError && /already held/.test(err.message),
  );
});

test("the pending set is never merged into GLOBAL or NONPROD authority", () => {
  const pending = new Set(pendingGrantPairs().map(pairId));
  for (const p of globalAuthorityGrants()) assert.ok(!pending.has(pairId(p)));
  for (const p of nonprodAuthorityGrants()) assert.ok(!pending.has(pairId(p)));
  for (const p of NONPROD_ACTIVATED_CAPABILITY_GRANTS) assert.ok(!pending.has(pairId(p)));
  for (const p of GLOBAL_CATALOG_ACTIVATED_GRANTS) assert.ok(!pending.has(pairId(p)));
});

test("the corrections are exactly the Owner's five rulings, and nothing else", () => {
  assert.equal(PENDING_GRANTS.length, 10);
  assert.deepEqual(countsByRuling(), { S1: 2, S2: 4, S3: 1, S4: 1, S6: 2 });
  assert.deepEqual(pendingGrantPairs().map((p) => `${p.roleKey}/${p.capabilityKey}`).sort(), [
    "fieldManager/workOrder.lifecycle.cancel",
    "fieldManager/workOrder.lifecycle.dispatch",
    "inventoryCycleCountReconciler/inventory.cycleCount.close",
    "inventoryPutAwayOperator/inventory.placement.record",
    "inventoryStockRelocationOperator/inventory.stock.relocate",
    "owner/receivingOrder.record.read",
    "owner/workOrder.record.read",
    "partsManager/reorder.request.assign",
    "warehouseAssociate/warehouse.record.read",
    "warehouseManager/warehouse.record.read",
  ]);
  for (const g of PENDING_GRANTS) assert.ok(g.why.length > 20, `${g.roleKey}/${g.capabilityKey} lacks a reason`);
});

test("the two pending grants the Role catalog ALREADY declares are the ones the baseline records as not activated", () => {
  const catalogDeclared = new Set(CATALOG_DECLARED_NOT_ACTIVATED.map(pairId));
  for (const g of PENDING_GRANTS) {
    const declared = catalogDeclared.has(pairId(g));
    assert.equal(declared, g.alreadyCatalogDeclared,
      `${g.roleKey}/${g.capabilityKey} claims alreadyCatalogDeclared=${g.alreadyCatalogDeclared} but the baseline says ${declared}`);
  }
  assert.deepEqual(PENDING_GRANTS.filter((g) => g.alreadyCatalogDeclared).map((g) => `${g.roleKey}/${g.capabilityKey}`).sort(), [
    "inventoryPutAwayOperator/inventory.placement.record",
    "inventoryStockRelocationOperator/inventory.stock.relocate",
  ], "S2's functional-Role grants ACTIVATE declarations the catalog already carries; they are not new authority");
});

// ════════════════════ S1 -- EDIT WITHOUT READ ════════════════════

test("S1: each of the four Objects is reconciled, and two of them need NO new authority at all", () => {
  assert.deepEqual(PENDING_CRED_READ_WIRING.map((w) => w.objectKey).sort(),
    ["employee", "receivingOrder", "rolesPermissions", "workOrder"]);

  // employee and rolesPermissions: the READ capability EXISTS and Owner ALREADY HOLDS it. The
  // measured can_read=false is a CRED projection defect, not an authority defect.
  for (const key of ["employee", "rolesPermissions"]) {
    const w = PENDING_CRED_READ_WIRING.find((x) => x.objectKey === key);
    assert.equal(w.capabilityAlreadyExists, true);
    assert.equal(w.ownerAlreadyHolds, true);
    assert.ok(measuredCapabilitiesOf("owner").has(w.readCapabilityKey),
      `owner must already hold ${w.readCapabilityKey}`);
    assert.equal(PENDING_GRANTS.filter((g) => g.capabilityKey === w.readCapabilityKey).length, 0,
      `${key} needs a wiring correction, NOT a grant -- granting here would invent authority`);
  }

  // receivingOrder and workOrder: the Object's READ verb is ungoverned -- no capability exists.
  for (const key of ["receivingOrder", "workOrder"]) {
    const w = PENDING_CRED_READ_WIRING.find((x) => x.objectKey === key);
    assert.equal(w.capabilityAlreadyExists, false);
    assert.ok(PENDING_CAPABILITIES.some((c) => c.capabilityKey === w.readCapabilityKey),
      `${key} read must be registered as a pending capability before it can be granted`);
  }
});

test("S1: the pending READ capabilities are READ and confer no write", () => {
  assert.equal(PENDING_CAPABILITIES.length, 2);
  for (const c of PENDING_CAPABILITIES) {
    assert.equal(c.actionKind, "READ");
    assert.equal(c.actionKey, "read");
    assert.match(c.capabilityKey, /\.record\.read$/);
    assert.equal(c.capabilityKey.split(".")[0], c.objectKey === "receivingOrder" ? "receivingOrder" : "workOrder");
  }
  // Owner gets the READ only -- no lifecycle authority rides along.
  const owner = projectedCapabilitiesOf("owner");
  for (const k of ["workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel", "workOrder.lifecycle.complete",
    "inventory.stock.receive"]) {
    assert.ok(!owner.has(k), `owner must not gain ${k} from an S1 READ correction`);
  }
});

test("S1: the residual edit-without-read this lane did NOT close is recorded, not hidden", () => {
  assert.ok(RESIDUAL_EDIT_WITHOUT_READ.length > 0);
  for (const r of RESIDUAL_EDIT_WITHOUT_READ) {
    assert.ok(measuredCapabilitiesOf(r.roleKey).has(r.holdsModifyCapability),
      `${r.roleKey} is recorded as holding ${r.holdsModifyCapability} and does not`);
    assert.ok(!PENDING_GRANTS.some((g) => g.roleKey === r.roleKey && g.capabilityKey.endsWith(".record.read")),
      `${r.roleKey} is a RESIDUAL row -- this lane must not silently grant it the read`);
  }
  assert.ok(!RESIDUAL_EDIT_WITHOUT_READ.some((r) => r.roleKey === "owner"),
    "owner must NOT be residual -- the ruling scopes S1 to closing the Owner's exposure");
});

// ════════════════════ THE SIX SEPARATION PROOFS ════════════════════

test("PROOF 1/6: counter != reconciler -- the cycle count segregation survives S3", () => {
  const counter = projectedCapabilitiesOf("inventoryCycleCountCounter");
  const reconciler = projectedCapabilitiesOf("inventoryCycleCountReconciler");
  assert.ok(reconciler.has("inventory.cycleCount.close"), "S3 grants close to the reconciler");
  assert.ok(!counter.has("inventory.cycleCount.close"),
    "DECISIONS #111: the counter may not approve their own material variance");
  assert.deepEqual([...counter].filter((c) => reconciler.has(c)), [],
    "counter and reconciler must share NO capability");
  assert.deepEqual(projectedHoldersOf("inventory.cycleCount.close"), ["inventoryCycleCountReconciler"]);

  // the declared SOD pairs hold over the PROJECTED authority, not merely the measured one
  assertSeparationOfDutyPreserved(SOD_EXCLUSIVE_PAIRS, projectedCapabilitiesOf);
  // ...and the check is not vacuous
  assert.throws(
    () => assertSeparationOfDutyPreserved([["a", "b", "synthetic"]],
      () => new Set(["inventory.cycleCount.close"])),
    (err) => err instanceof PendingCorrectionsError && /separation of duty defeated/.test(err.message),
  );
});

test("PROOF 2/6: technician does not gain PARTS_OPERATIONS, and keeps the capability its denial does NOT rest on", () => {
  // PARTS_OPERATIONS is a WORK ELIGIBILITY qualification code, not a capability. This lane changes
  // no eligibility and no scope, so the technician's standing negative case is untouched.
  assert.equal(PENDING_GRANTS.filter((g) => g.roleKey === "technician").length, 0,
    "technician gains NOTHING from this lane");
  assert.deepEqual([...projectedCapabilitiesOf("technician")].sort(),
    [...measuredCapabilitiesOf("technician")].sort(),
    "the technician's capability set is byte-identical before and after");

  // MEASURED CONTEXT WORTH KEEPING: the technician DOES hold reorder.request.read. The queue denial
  // rests on a withheld SCOPE row, so removing the capability would be a false "strengthening".
  assert.ok(measuredCapabilitiesOf("technician").has("reorder.request.read"),
    "technician must KEEP reorder.request.read -- the denial is a scope fact, not a capability fact");
  assert.ok(projectedCapabilitiesOf("technician").has("reorder.request.read"));

  const manifest = JSON.parse(readFileSync(
    join(import.meta.dirname, "../src/adminPolicy/seed/pendingAuthorityCorrections.json"), "utf8"));
  assert.match(manifest.unchanged.workEligibility, /no qualification code added/);
  assert.match(manifest.unchanged.operationalScope, /no scope row added/);
});

test("PROOF 3/6: Parts Associate does not gain queue / assignment management", () => {
  const pa = projectedCapabilitiesOf("partsAssociate");
  assert.ok(!pa.has("reorder.request.assign"), "assignment is queue management; a parts associate does not assign");
  assert.equal(PENDING_GRANTS.filter((g) => g.roleKey === "partsAssociate").length, 0);
  assert.ok(REFUSED_GRANTS.some((r) => r.roleKey === "partsAssociate" && r.capabilityKey === "reorder.request.assign"),
    "the refusal is written down, so its absence is a control rather than an oversight");
  // S4 lands on partsManager ALONE -- not dispatcher, technician, purchasing, or every parts employee.
  assert.deepEqual(projectedHoldersOf("reorder.request.assign"), ["partsManager"]);
});

test("PROOF 4/6: Service Manager does not gain completion", () => {
  const fm = projectedCapabilitiesOf("fieldManager");
  assert.ok(fm.has("workOrder.lifecycle.dispatch"), "S6 grants dispatch");
  assert.ok(fm.has("workOrder.lifecycle.cancel"), "S6 grants cancel");
  assert.ok(!fm.has("workOrder.lifecycle.complete"),
    "completion remains technician execution authority: a manager who may dispatch AND complete can close work nobody performed");
  assert.deepEqual(projectedHoldersOf("workOrder.lifecycle.complete"), ["technician"],
    "completion holders must be unchanged by this lane");
  assert.ok(REFUSED_GRANTS.some((r) => r.roleKey === "fieldManager" && r.capabilityKey === "workOrder.lifecycle.complete"));
});

test("PROOF 5/6: warehouse POSITION alone does not gain placement / relocation write", () => {
  for (const position of ["warehouseManager", "warehouseAssociate"]) {
    const caps = projectedCapabilitiesOf(position);
    assert.ok(caps.has("warehouse.record.read"), `${position} gets the warehouse READ`);
    assert.ok(!caps.has("inventory.placement.record"),
      `${position} must NOT receive an inventory operating write because of its job title`);
    assert.ok(!caps.has("inventory.stock.relocate"), `${position} must NOT receive the relocation write`);
    // the position gains the READ and NOTHING else
    const gained = [...caps].filter((c) => !measuredCapabilitiesOf(position).has(c));
    assert.deepEqual(gained, ["warehouse.record.read"]);
  }
  // Position != Functional Role: the writes land on the FUNCTIONAL Roles only.
  assert.deepEqual(projectedHoldersOf("inventory.placement.record"), ["admin", "inventoryPutAwayOperator"]);
  assert.deepEqual(projectedHoldersOf("inventory.stock.relocate"), ["admin", "inventoryStockRelocationOperator"]);
});

test("PROOF 6/6: Owner does not become Admin", () => {
  const admin = projectedCapabilitiesOf("admin");
  const owner = projectedCapabilitiesOf("owner");

  // MEASURED TODAY: owner is a STRICT SUBSET of admin -- 47 of admin's 66, 19 admin-only, 0 owner-only.
  const measuredAdmin = measuredCapabilitiesOf("admin");
  const measuredOwner = measuredCapabilitiesOf("owner");
  assert.equal(measuredAdmin.size, 66);
  assert.equal(measuredOwner.size, 47);
  assert.equal([...measuredAdmin].filter((c) => !measuredOwner.has(c)).length, 19);

  // AFTER the corrections, admin STILL holds 19 authorities owner does not. Nothing was copied
  // across: the Owner's two new reads are Owner-specific and admin does not receive them.
  const adminOnly = [...admin].filter((c) => !owner.has(c)).sort();
  assert.equal(adminOnly.length, 19, "Owner must not absorb Admin's administration authority");
  for (const k of ["admin.dataImport.execute", "inventory.stock.receive", "inventory.placement.record",
    "inventory.stock.relocate", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel",
    "inventory.cycleCount.create", "inventory.cycleCount.reconcile"]) {
    assert.ok(adminOnly.includes(k), `${k} must remain Admin-only`);
  }

  // ...and neither is a superset of the other any more: Owner holds two reads Admin does not, so
  // the two Roles are DISTINCT authorities rather than nested ones (S5: Owner is NOT Administrator).
  const ownerOnly = [...owner].filter((c) => !admin.has(c)).sort();
  assert.deepEqual(ownerOnly, ["receivingOrder.record.read", "workOrder.record.read"]);

  // The rolesPermissions reconciliation does NOT copy Admin to Owner: Owner reads the security
  // policy on a grant it already independently holds.
  assert.ok(measuredOwner.has("admin.securityPolicy.read"));
  assert.ok(!owner.has("admin.roleAssignment.write") || measuredOwner.has("admin.roleAssignment.write"),
    "this lane must not add any administration WRITE to owner");
  assert.equal(PENDING_GRANTS.filter((g) => g.roleKey === "owner" && !g.capabilityKey.endsWith(".record.read")).length, 0,
    "every pending owner grant is a READ");
});

// ════════════════════ LEAST PRIVILEGE ════════════════════

test("LEAST PRIVILEGE: every Role grows by exactly the named pairs and by nothing else", () => {
  const touched = [...new Set(PENDING_GRANTS.map((g) => g.roleKey))].sort();
  assert.deepEqual(touched, [
    "fieldManager", "inventoryCycleCountReconciler", "inventoryPutAwayOperator",
    "inventoryStockRelocationOperator", "owner", "partsManager", "warehouseAssociate", "warehouseManager",
  ]);
  // No Role outside that list changes at all.
  const allRoles = [...new Set(AUTHORITY_BASELINE_GRANTS.map((g) => g.roleKey))];
  for (const role of allRoles) {
    const gained = [...projectedCapabilitiesOf(role)].filter((c) => !measuredCapabilitiesOf(role).has(c));
    if (!touched.includes(role)) {
      assert.deepEqual(gained, [], `${role} is not named by any ruling and must gain nothing`);
    } else {
      const expected = PENDING_GRANTS.filter((g) => g.roleKey === role).map((g) => g.capabilityKey).sort();
      assert.deepEqual(gained.sort(), expected, `${role} gained something the ruling did not name`);
    }
  }
  // NOTHING IS REVOKED: the corrections are strictly additive.
  for (const role of allRoles) {
    for (const c of measuredCapabilitiesOf(role)) {
      assert.ok(projectedCapabilitiesOf(role).has(c), `${role} must not lose ${c}`);
    }
  }
  // The whole approved end state is 397 pairs -- 387 measured plus 10 approved, and not one more.
  assert.equal(projectedAuthorityIfApplied(nonprodAuthorityGrants()).length, 397);
});

test("every REFUSED grant is held by nobody and smuggled into nothing", () => {
  assertRefusedGrantsAreNotHeld(nonprodAuthorityGrants());
  assert.ok(REFUSED_GRANTS.length >= 10);
  for (const r of REFUSED_GRANTS) assert.ok(r.why.startsWith("NOT AUTHORIZED"), `${r.roleKey}/${r.capabilityKey}`);
  // not vacuous: a refusal that IS held is reported
  assert.throws(
    () => assertRefusedGrantsAreNotHeld(nonprodAuthorityGrants(),
      [{ roleKey: "admin", capabilityKey: "warehouse.record.read", ruling: "S2", why: "NOT AUTHORIZED synthetic" }]),
    (err) => err instanceof PendingCorrectionsError && /is HELD/.test(err.message),
  );
});

// ════════════════════ THE DATABASE: APPROVED MEANS NOT APPLIED ════════════════════

function migrate(count) {
  const args = ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"];
  if (count !== undefined) args.push(String(count));
  execFileSync(process.execPath, args, { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

async function dropEverything() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const schema of declaredSchemas()) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query("DROP TABLE IF EXISTS public.pgmigrations");
  await client.end();
}

async function grantsIn(pool) {
  const { rows } = await pool.query(
    `SELECT r.key AS role_key, c.key AS capability_key
       FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r ON r.id = rc.role_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 ORDER BY 1, 2`,
    [TENANT],
  );
  return rows.map((r) => ({ roleKey: r.role_key, capabilityKey: r.capability_key }));
}

async function applyPairs(pool, pairs, grantedBy) {
  const applied = [];
  for (const { roleKey, capabilityKey } of pairs) {
    const { rowCount } = await pool.query(
      `INSERT INTO eos_policy.role_capabilities
             (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT 'rc_pending_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
         FROM eos_policy.roles r, eos_policy.capabilities c
        WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
       ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`,
      [TENANT, roleKey, capabilityKey, grantedBy],
    );
    applied.push({ roleKey, capabilityKey, rowCount });
  }
  return applied;
}

/** The SAME pipeline the measured guard uses, so this suite proves against the real rebuild. */
async function rebuild(pool) {
  await dropEverything();
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
  const beforeSeed = files.filter((f) => f < SEED_BOUNDARY_MIGRATION).length;
  migrate(beforeSeed);
  await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $2)", [TENANT, TENANT_KEY]);
  await seedTenantPolicy(new PostgresPolicyRepository(pool), TENANT, REBUILD_ACTOR);
  migrate();
  await applyPairs(pool, GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:" + REBUILD_ACTOR);
  await applyPairs(pool, NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:" + REBUILD_ACTOR);
  return grantsIn(pool);
}

test("the rebuild STILL reproduces nonprod exactly, and holds NONE of the pending corrections",
  { skip: SKIP }, async () => {
    const pool = new pg.Pool({ connectionString: URL, max: 2 });
    try {
      const rebuilt = await rebuild(pool);
      assertAuthorityRebuildMatches(nonprodAuthorityGrants(), rebuilt);
      assert.equal(rebuilt.length, 387, "adding a pending manifest must not change what the rebuild produces");

      const live = new Set(rebuilt.map(pairId));
      for (const p of pendingGrantPairs()) {
        assert.ok(!live.has(pairId(p)), `${p.roleKey}/${p.capabilityKey} is APPROVED but must not be APPLIED`);
      }
    } finally {
      await pool.end();
    }
  });

test("the two pending READ capabilities do NOT exist in the vocabulary -- the S1 read is ungoverned, not withheld",
  { skip: SKIP }, async () => {
    const pool = new pg.Pool({ connectionString: URL, max: 2 });
    try {
      await rebuild(pool);
      for (const c of PENDING_CAPABILITIES) {
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM eos_policy.capabilities WHERE key = $1",
          [c.capabilityKey]);
        assert.equal(rows[0].n, 0, `${c.capabilityKey} must not exist yet -- registering it is part of the activation`);
      }
      // ...while the two READ capabilities the wiring corrections reuse DO already exist.
      for (const key of ["employee.record.read", "admin.securityPolicy.read"]) {
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM eos_policy.capabilities WHERE key = $1", [key]);
        assert.equal(rows[0].n, 1, `${key} already governs its Object's READ -- no new capability is needed`);
      }
      // and neither of the four Objects can be read by anyone today
      const { rows: ungoverned } = await pool.query(
        `SELECT o.key FROM eos_policy.objects o
          WHERE o.tenant_id = $1 AND o.key = ANY($2)
            AND NOT EXISTS (SELECT 1 FROM eos_policy.capabilities c
                             WHERE c.object_key = o.key AND c.action_kind = 'READ')
          ORDER BY 1`,
        [TENANT, ["employee", "receivingOrder", "rolesPermissions", "workOrder"]],
      );
      assert.deepEqual(ungoverned.map((r) => r.key), ["receivingOrder", "workOrder"],
        "only receivingOrder and workOrder lack a READ capability outright");
    } finally {
      await pool.end();
    }
  });

test("APPLYING the pending set is REFUSED by the measured guard -- which is what makes 'not applied' checkable",
  { skip: SKIP }, async () => {
    const pool = new pg.Pool({ connectionString: URL, max: 2 });
    try {
      await rebuild(pool);
      const applied = await applyPairs(pool, pendingGrantPairs(), "pending-correction:PROOF-ONLY");

      // The eight whose capability already exists land; the two S1 reads cannot, because their
      // capability is not in the vocabulary yet. That is the vocabulary gap, demonstrated.
      const landed = applied.filter((a) => a.rowCount === 1).map((a) => `${a.roleKey}/${a.capabilityKey}`).sort();
      const refused = applied.filter((a) => a.rowCount === 0).map((a) => `${a.roleKey}/${a.capabilityKey}`).sort();
      assert.equal(landed.length, 8);
      assert.deepEqual(refused, ["owner/receivingOrder.record.read", "owner/workOrder.record.read"]);

      const after = await grantsIn(pool);
      assert.equal(after.length, 395, "387 measured + 8 applicable pending");

      // THE GUARD STILL FAILS CLOSED. A migration that applied these would break the rebuild proof,
      // which is exactly why the corrections are a manifest rather than a migration.
      assert.throws(
        () => assertAuthorityRebuildMatches(nonprodAuthorityGrants(), after),
        (err) => err instanceof AuthorityBaselineError && /MISSING DECLARATION \(8\)/.test(err.message),
      );
    } finally {
      await pool.end();
    }
  });
