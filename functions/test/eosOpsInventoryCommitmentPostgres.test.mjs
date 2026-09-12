// Inventory COMMITMENT persistence and the Work Order REPLAY authority — the POSTGRESQL proofs.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as eosOpsPostgres.test.mjs and adminPolicyPostgres.test.mjs: set
// POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails. This file resets BOTH
// `eos_policy` and `eos_ops` from clean, so it MUST be registered in the SAME serialized
// `test:adminPolicyPostgres` command as the other resetters — adminPolicyPostgres.test.mjs's "every
// suite that resets the schema is covered by that one command" mechanically enforces that, and the
// registration line is recorded in docs/handoff/w1-c1-registrations.md because functions/package.json
// is integration-writer territory in this wave.
//
// ════════════════════ WHAT IS PROVED HERE AND WHY IT NEEDS A DATABASE ════════════════════
//
// "The writer will remember to pass an operating company" is not a property; "the database refuses a
// row without one" is. Likewise "two concurrent callers won't both process the same Work Order
// state" is only a property if the uniqueness that stops them is real. Every claim below is either a
// constraint the server enforces or a derivation the server computes.
import test from "node:test";
import { declaredTablesIn } from "./support/migrationSchema.mjs";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import * as repo from "../lib/eosOps/inventoryCommitmentRepository.js";
import { OperatingCompanyAuthorityError } from "../lib/eosOps/operatingCompanyCustody.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
// OPAQUE governed keys, deliberately not real company names: nothing in this schema or these proofs
// may depend on which operating companies a deployment happens to have.
const COMPANY_A = "oc-alpha";
const COMPANY_B = "oc-beta";
const ACTOR = "uid-trusted-writer";

let pool = null;
function repoPool() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  // EVERY schema the migrations create, read from functions/migrations rather than listed here.
  //
  // Each of these resetters carried its own hand-written list, and at the W1 integration no two of
  // them agreed: some dropped eos_crm, some eos_commercial, most neither. A schema left standing
  // while `pgmigrations` is dropped makes the next `up` re-run its migration against objects that
  // still exist -- the failure is `type "commercial_handoff_source" already exists`, 48 tests deep in
  // a suite that has nothing to do with the commercial schema. Derived, the list cannot drift again.
  for (const schema of declaredSchemas()) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  migrate(["up"]);
  const seed = new pg.Client({ connectionString: URL });
  await seed.connect();
  for (const id of [TENANT_A, TENANT_B]) {
    await seed.query(
      "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
      [id],
    );
  }
  await seed.end();
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

const enumLabels = (typeName) => query(
  `SELECT e.enumlabel FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'eos_ops' AND t.typname = $1
    ORDER BY e.enumsortorder`,
  [typeName],
).then((r) => r.rows.map((row) => row.enumlabel));

const ctx = (overrides = {}) => ({
  tenantId: TENANT_A,
  operatingCompanyKey: COMPANY_A,
  workOrderId: "wo-1",
  actorId: ACTOR,
  idempotencyKey: "op-1",
  ...overrides,
});

// ============================ schema ============================

test("clean database -> migrate -> the commitment and replay tables exist beside the movement ledger", { skip: SKIP }, async () => {
  await reset();
  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops' ORDER BY 1",
  );
  // THE RULE, NOT A LIST. An exhaustive eos_ops list here became wrong as soon as any sibling lane
  // added an operational table, and eleven did. What this test claims is about THIS migration: it
  // contributes exactly its own two tables, and it removes none of migration 005's four.
  const names = tables.rows.map((r) => r.table_name);
  assert.deepEqual(declaredTablesIn("eos_ops", ["1758067200000_inventory-commitment-and-work-order-replay.sql"]),
    ["inventory_commitments", "work_order_inventory_effects"],
    "this migration declares exactly its own two tables");
  for (const mine of ["inventory_commitments", "work_order_inventory_effects"]) {
    assert.ok(names.includes(mine), `${mine} was created`);
  }
  for (const foundation of ["cycle_count_lines", "cycle_count_sheets", "inventory_movements", "serialized_custody"]) {
    assert.ok(names.includes(foundation), `migration 005's ${foundation} survives -- this migration removes none`);
  }
});

test("the commitment vocabulary and the movement vocabulary stay disjoint IN THE DATABASE", { skip: SKIP }, async () => {
  // THE BINDING RULE, as the server actually holds it. A label present in both enums would let a
  // promise be summed by a balance query that sums physical facts.
  const movement = await enumLabels("ops_movement_type");
  const commitment = await enumLabels("ops_commitment_event_type");

  assert.deepEqual(commitment, ["RESERVED", "RELEASED", "CONSUMED"]);
  assert.deepEqual(movement, [
    "RECEIVED", "RETURNED", "TRANSFER_OUT", "TRANSFER_IN", "RELOCATION_OUT", "RELOCATION_IN",
    "WORK_ORDER_CONSUMPTION", "SCRAPPED", "ADJUSTED",
  ], "migration 008 did not widen the movement vocabulary");
  assert.deepEqual(movement.filter((label) => commitment.includes(label)), [],
    "no commitment lifecycle label is a movement type");
});

test("a commitment row cannot be written into the movement ledger -- it has nothing to put in its NOT NULL columns", { skip: SKIP }, async () => {
  // The mechanical reason the two families cannot be merged, proved rather than asserted: the live
  // commitment record is {workOrderId, partId, type, quantity} and inventory_movements demands a
  // tracking mode, a location type and a location id it has never had.
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.inventory_movements
         (id, tenant_id, operating_company_key, part_id, movement_type, quantity_delta,
          source_kind, source_id, created_by)
       VALUES ('m1', $1, $2, 'p1', 'ADJUSTED', 5, 'WORK_ORDER', 'wo-1', $3)`,
      [TENANT_A, COMPANY_A, ACTOR],
    ),
    /null value in column "(tracking_mode|location_type|location_id)"/,
  );
});

test("the operating company is mandatory on a commitment, with no default to fall back on", { skip: SKIP }, async () => {
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.inventory_commitments
         (id, tenant_id, work_order_id, part_id, event_type, quantity, idempotency_key, created_by)
       VALUES ('c1', $1, 'wo-1', 'p1', 'RESERVED', 1, 'k-raw', $2)`,
      [TENANT_A, ACTOR],
    ),
    /null value in column "operating_company_key"/,
  );
  // ...and the repository refuses first, with a reason instead of a constraint name.
  await assert.rejects(
    () => repo.recordCommitmentEvent(repoPool(), {
      tenantId: TENANT_A, operatingCompanyKey: "", workOrderId: "wo-1", partId: "p1",
      eventType: "RESERVED", quantity: 1, idempotencyKey: "k-x", actorId: ACTOR,
    }),
    OperatingCompanyAuthorityError,
  );
});

test("quantity is strictly positive at the SQL boundary too", { skip: SKIP }, async () => {
  for (const bad of [0, -3]) {
    await assert.rejects(
      () => query(
        `INSERT INTO eos_ops.inventory_commitments
           (id, tenant_id, operating_company_key, work_order_id, part_id, event_type, quantity,
            idempotency_key, created_by)
         VALUES ($1, $2, $3, 'wo-1', 'p1', 'RESERVED', $4, $1, $5)`,
        [`c-${bad}`, TENANT_A, COMPANY_A, bad, ACTOR],
      ),
      /commitment_quantity_positive/,
    );
  }
});

test("a commitment belongs to a real tenant", { skip: SKIP }, async () => {
  await assert.rejects(
    () => repo.recordCommitmentEvent(repoPool(), {
      tenantId: "tenant-that-does-not-exist", operatingCompanyKey: COMPANY_A, workOrderId: "wo-1",
      partId: "p1", eventType: "RESERVED", quantity: 1, idempotencyKey: "k-fk", actorId: ACTOR,
    }),
    /violates foreign key constraint/,
  );
});

// ============================ reserve / release / consume ============================

test("reserve sums duplicate lines for one Part before writing, and writes one row per Part", { skip: SKIP }, async () => {
  await reset();
  // A Work Order's plan may legitimately carry two rows for one sku. Reserving them separately would
  // size each against the same un-decremented figure; summing first is what the live path does.
  const written = await repo.reserve(repoPool(), ctx(), [
    { partId: "p1", quantity: 2 },
    { partId: "p1", quantity: 3 },
    { partId: "p2", quantity: 4 },
  ]);
  assert.deepEqual(written.map((w) => [w.record.partId, w.record.quantity, w.outcome]), [
    ["p1", 5, "applied"],
    ["p2", 4, "applied"],
  ]);
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 5);
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p2"), 4);
});

test("replaying the same reserve operation commits nothing further", { skip: SKIP }, async () => {
  await reset();
  const lines = [{ partId: "p1", quantity: 5 }];
  await repo.reserve(repoPool(), ctx(), lines);
  const replay = await repo.reserve(repoPool(), ctx(), lines);

  assert.deepEqual(replay.map((w) => w.outcome), ["replayed"], "the second run recognises itself");
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 5,
    "a retried Work Order transition must not double-reserve");
  const { rows } = await query("SELECT count(*)::int AS n FROM eos_ops.inventory_commitments");
  assert.equal(rows[0].n, 1);
});

test("the same idempotency key for a DIFFERENT commitment is a conflict, never a silent replay", { skip: SKIP }, async () => {
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 5 }]);
  await assert.rejects(
    () => repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 9 }]),
    (err) => err instanceof repo.CommitmentIdempotencyConflictError,
    "swallowing this would drop a real commitment on the floor",
  );
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 5);
});

test("reserve is ALL-OR-NOTHING: a refused line leaves no partial commitment behind", { skip: SKIP }, async () => {
  await reset();
  // Stage a conflicting row for p2 only. p1 sorts first and is written, then p2 conflicts -- if the
  // operation were not one transaction, p1's reservation would survive as a half-applied dispatch.
  await repo.recordCommitmentEvent(repoPool(), {
    tenantId: TENANT_A, operatingCompanyKey: COMPANY_A, workOrderId: "wo-1", partId: "p2",
    eventType: "RESERVED", quantity: 99, idempotencyKey: "op-1:RESERVED:p2", actorId: ACTOR,
  });

  await assert.rejects(
    () => repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 1 }, { partId: "p2", quantity: 2 }]),
    (err) => err instanceof repo.CommitmentIdempotencyConflictError,
  );
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 0,
    "no partial reservation ever lands");
});

test("release is derived from the COMMITMENT LEDGER, so a Part dropped from the plan is not orphaned", { skip: SKIP }, async () => {
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 5 }, { partId: "p2", quantity: 2 }]);
  // The plan is never consulted here. p2 could have been deleted from the Work Order entirely and
  // its commitment would still be found and released -- the orphan leak a plan-driven loop cannot see.
  const released = await repo.releaseOutstanding(repoPool(), ctx({ idempotencyKey: "op-cancel" }));

  assert.deepEqual(released.map((w) => [w.record.partId, w.record.quantity]), [["p1", 5], ["p2", 2]]);
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 0);
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p2"), 0);
  assert.deepEqual([...(await repo.outstandingByPart(repoPool(), TENANT_A, "wo-1"))], [["p1", 0], ["p2", 0]]);
});

test("releasing a Work Order that never reserved anything writes nothing and does not fail", { skip: SKIP }, async () => {
  await reset();
  const released = await repo.releaseOutstanding(repoPool(), ctx({ workOrderId: "wo-never", idempotencyKey: "op-c2" }));
  assert.deepEqual(released, []);
});

test("consumption reconciles the commitment to ACTUAL usage: consume what was used, release the rest", { skip: SKIP }, async () => {
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 5 }]);
  const written = await repo.reconcileConsumption(repoPool(), ctx({ idempotencyKey: "op-complete" }), [
    { partId: "p1", qtyPlanned: 5, qtyUsed: 3 },
  ]);

  assert.deepEqual(written.map((w) => [w.record.eventType, w.record.quantity]), [
    ["CONSUMED", 3],
    ["RELEASED", 2],
  ], "no top-up was needed, and the unused remainder is not left stranded");
  assert.deepEqual([...(await repo.outstandingByPart(repoPool(), TENANT_A, "wo-1"))], [["p1", 0]],
    "the Work Order holds nothing further");
});

test("consumption tops the reservation up to the plan first, and only by the shortfall", { skip: SKIP }, async () => {
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 2 }]);
  const written = await repo.reconcileConsumption(repoPool(), ctx({ idempotencyKey: "op-complete" }), [
    { partId: "p1", qtyPlanned: 5 }, // no qtyUsed recorded -> falls back to qtyPlanned
  ]);
  assert.deepEqual(written.map((w) => [w.record.eventType, w.record.quantity]), [
    ["RESERVED", 3],
    ["CONSUMED", 5],
  ], "the top-up is the delta, never a re-reservation of the whole line");
});

test("consumption beyond the plan is REFUSED, not silently clamped", { skip: SKIP }, async () => {
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 5 }]);
  await assert.rejects(
    () => repo.reconcileConsumption(repoPool(), ctx({ idempotencyKey: "op-complete" }), [
      { partId: "p1", qtyPlanned: 5, qtyUsed: 7 },
    ]),
    (err) => err instanceof repo.InventoryCommitmentError && err.code === "CONSUMPTION_EXCEEDS_PLAN",
    "clamping here would destroy the evidence that an overage happened",
  );
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM eos_ops.inventory_commitments WHERE event_type <> 'RESERVED'",
  );
  assert.equal(rows[0].n, 0, "the refusal wrote nothing at all");
});

// ============================ the derivations ============================

test("committed quantity is RESERVED - RELEASED, and CONSUMED is deliberately not subtracted", { skip: SKIP }, async () => {
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 10 }]);
  await repo.reconcileConsumption(repoPool(), ctx({ idempotencyKey: "op-complete" }), [
    { partId: "p1", qtyPlanned: 10, qtyUsed: 4 },
  ]);
  // RESERVED 10, CONSUMED 4, RELEASED 6.
  //
  // The live authority's arithmetic, preserved EXACTLY rather than re-derived: consumed quantity
  // stays counted as committed. inventoryService.ts's openCommitment() explains why -- nothing
  // removes consumed stock from physical on-hand there, so keeping it committed keeps it out of
  // availability ("wrong reason, right number"). Whether eos_ops should instead subtract CONSUMED,
  // now that ops_movement_type HAS a WORK_ORDER_CONSUMPTION movement, is DECISIONS #165's open
  // ruling -- this package preserves the existing answer rather than making that decision.
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 4);
  // The same rows, asked the OTHER question: what does this Work Order still hold? Nothing.
  assert.deepEqual([...(await repo.outstandingByPart(repoPool(), TENANT_A, "wo-1"))], [["p1", 0]]);
});

test("committed quantity is floored at 0 and never reports a negative promise", { skip: SKIP }, async () => {
  await reset();
  await repo.recordCommitmentEvent(repoPool(), {
    tenantId: TENANT_A, operatingCompanyKey: COMPANY_A, workOrderId: "wo-odd", partId: "p1",
    eventType: "RELEASED", quantity: 3, idempotencyKey: "k-odd", actorId: ACTOR,
  });
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 0);
  // Per Work Order the fault is NOT hidden: a negative outstanding is evidence of a real accounting
  // error, and this derivation reports it rather than flooring it away.
  assert.deepEqual([...(await repo.outstandingByPart(repoPool(), TENANT_A, "wo-odd"))], [["p1", -3]]);
});

test("a Part with no commitment at all is 0 committed and absent from the outstanding map", { skip: SKIP }, async () => {
  await reset();
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "never-seen"), 0);
  assert.deepEqual([...(await repo.outstandingByPart(repoPool(), TENANT_A, "wo-never"))], []);
});

// ============================ isolation ============================

test("one tenant's commitments are invisible to another's derivations", { skip: SKIP }, async () => {
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 5 }]);
  await repo.reserve(repoPool(), ctx({ tenantId: TENANT_B }), [{ partId: "p1", quantity: 7 }]);

  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 5);
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_B, COMPANY_A, "p1"), 7);
  assert.deepEqual([...(await repo.outstandingByPart(repoPool(), TENANT_A, "wo-1"))], [["p1", 5]]);
  assert.deepEqual((await repo.readCommitmentHistory(repoPool(), TENANT_A, "wo-1")).map((r) => r.quantity), [5]);
});

test("the same idempotency key in two tenants is two commitments, not a collision", { skip: SKIP }, async () => {
  // The unique index is (tenant_id, idempotency_key). A global key space would let one tenant's
  // replay identity silently suppress another tenant's commitment.
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 1 }]);
  const other = await repo.reserve(repoPool(), ctx({ tenantId: TENANT_B }), [{ partId: "p1", quantity: 1 }]);
  assert.deepEqual(other.map((w) => w.outcome), ["applied"]);
});

test("one operating company's commitments do not net against another's stock", { skip: SKIP }, async () => {
  // Why the column is mandatory: the committed quantity exists to be subtracted from physical
  // on-hand, and every inventory_movements row carries a company. Without this scoping a claim would
  // be netted against every company's shelf at once.
  await reset();
  await repo.reserve(repoPool(), ctx(), [{ partId: "p1", quantity: 5 }]);
  await repo.reserve(repoPool(), ctx({ operatingCompanyKey: COMPANY_B, idempotencyKey: "op-b" }), [
    { partId: "p1", quantity: 8 },
  ]);
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_A, "p1"), 5);
  assert.equal(await repo.committedQuantityForPart(repoPool(), TENANT_A, COMPANY_B, "p1"), 8);
});

// ============================ the Work Order replay authority ============================

test("a state can be claimed once, and a second caller is refused", { skip: SKIP }, async () => {
  await reset();
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", ACTOR), true);
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", "uid-other"), false,
    "a live transition racing an operator retry tool cannot both run the trigger");
  // A DIFFERENT state of the same Work Order is a different claim, not a collision.
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "COMPLETED", ACTOR), true);
});

test("a processed state can never be claimed again -- this is what stops replay", { skip: SKIP }, async () => {
  await reset();
  await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", ACTOR);
  await repo.markWorkOrderEffectProcessed(repoPool(), TENANT_A, "wo-1", "DISPATCHED");

  assert.equal(await repo.hasProcessedWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED"), true);
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", ACTOR), false,
    "NB-7: losing this guard re-opens processed work orders to replay");
});

test("a failure records why, releases the claim, and permits exactly one retry at a time", { skip: SKIP }, async () => {
  await reset();
  await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", ACTOR);
  await repo.recordWorkOrderEffectFailure(repoPool(), TENANT_A, "wo-1", "DISPATCHED", "Insufficient stock: p1");

  const [failed] = await repo.readWorkOrderEffects(repoPool(), TENANT_A, "wo-1");
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failureMessage, "Insufficient stock: p1");
  assert.equal(failed.attempts, 1);

  // FAILED is claimable -- that IS the retry path. Firestore needs recordFailure + clearClaim to say
  // the same thing; here one status column cannot hold both.
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", "uid-retry"), true);
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", "uid-third"), false,
    "the retry re-claims it; a third caller still waits");

  const [retried] = await repo.readWorkOrderEffects(repoPool(), TENANT_A, "wo-1");
  assert.equal(retried.attempts, 2);
  assert.equal(retried.status, "CLAIMED");
});

test("success clears the recorded failure, and the schema forbids a PROCESSED row that still claims to need attention", { skip: SKIP }, async () => {
  await reset();
  await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", ACTOR);
  await repo.recordWorkOrderEffectFailure(repoPool(), TENANT_A, "wo-1", "DISPATCHED", "transient");
  await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", ACTOR);
  await repo.markWorkOrderEffectProcessed(repoPool(), TENANT_A, "wo-1", "DISPATCHED");

  const [effect] = await repo.readWorkOrderEffects(repoPool(), TENANT_A, "wo-1");
  assert.equal(effect.status, "PROCESSED");
  assert.equal(effect.failureMessage, null, "a retry tool must not be told this still needs attention");

  await assert.rejects(
    () => query(
      `UPDATE eos_ops.work_order_inventory_effects SET failure_message = 'x', failed_at = now()
        WHERE tenant_id = $1 AND work_order_id = 'wo-1' AND state = 'DISPATCHED'`,
      [TENANT_A],
    ),
    /wo_effect_processed_has_no_open_failure/,
  );
});

test("an effect nobody claimed cannot be declared processed or failed", { skip: SKIP }, async () => {
  await reset();
  for (const call of [
    () => repo.markWorkOrderEffectProcessed(repoPool(), TENANT_A, "wo-1", "DISPATCHED"),
    () => repo.recordWorkOrderEffectFailure(repoPool(), TENANT_A, "wo-1", "DISPATCHED", "boom"),
  ]) {
    await assert.rejects(call, (err) => err.code === "EFFECT_NOT_CLAIMED");
  }
  assert.equal(await repo.hasProcessedWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED"), false,
    "an unseen Work Order is 'never processed', not an error");
});

test("only the three states that have an inventory effect are representable", { skip: SKIP }, async () => {
  // ARRIVED and WORK_IN_PROGRESS have no ledger-writeable meaning; the live authority deliberately
  // records no marker for them at all, and an enum is how that stays true of a SQL writer.
  await reset();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.work_order_inventory_effects (tenant_id, work_order_id, state, status, claimed_by)
       VALUES ($1, 'wo-1', 'ARRIVED', 'CLAIMED', $2)`,
      [TENANT_A, ACTOR],
    ),
    /invalid input value for enum eos_ops\.ops_work_order_effect_state/,
  );
});

test("replay state is per tenant: the same Work Order id in another tenant is a separate claim", { skip: SKIP }, async () => {
  await reset();
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_A, "wo-1", "DISPATCHED", ACTOR), true);
  assert.equal(await repo.claimWorkOrderEffect(repoPool(), TENANT_B, "wo-1", "DISPATCHED", ACTOR), true);
  await repo.markWorkOrderEffectProcessed(repoPool(), TENANT_A, "wo-1", "DISPATCHED");
  assert.equal(await repo.hasProcessedWorkOrderEffect(repoPool(), TENANT_B, "wo-1", "DISPATCHED"), false);
});

test.after(async () => { if (pool) await pool.end(); });
