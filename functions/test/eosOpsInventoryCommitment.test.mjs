// Inventory COMMITMENT authority — the proofs that need no database.
//
// Two kinds of claim live here, and neither one needs Postgres to be true:
//
//   STRUCTURAL   what migration 008 does and does not declare, read out of the SQL itself. "The
//                commitment table has no location columns" is a property of the file, and a file can
//                be read without a server.
//   REFUSAL      the guards that fire BEFORE any query is issued. They are proved against a database
//                handle that throws if it is ever touched, so a passing test is also evidence the
//                refusal happened above the SQL boundary rather than being a constraint violation
//                dressed up as validation.
//
// The behavioural proofs (idempotency, the derivations, the replay authority) are in
// test/eosOpsInventoryCommitmentPostgres.test.mjs, against a real postgres:16.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  recordCommitmentEvent,
  COMMITMENT_EVENT_TYPES,
  WORK_ORDER_EFFECT_STATES,
  InventoryCommitmentError,
} from "../lib/eosOps/inventoryCommitmentRepository.js";
import { OperatingCompanyAuthorityError } from "../lib/eosOps/operatingCompanyCustody.js";

const MIGRATION_FILE = "1758067200000_inventory-commitment-and-work-order-replay.sql";
const MIGRATION = readFileSync(join("migrations", MIGRATION_FILE), "utf8");
const REPOSITORY = readFileSync(join("src", "eosOps", "inventoryCommitmentRepository.ts"), "utf8");
const FOUNDATION = readFileSync(join("migrations", "1757808000000_eos-ops-foundation.sql"), "utf8");

/** A handle that fails the test if the code under test reaches the database at all. */
const neverQueried = {
  query() {
    throw new Error("the guard must refuse before any query is issued");
  },
};

const validInput = {
  tenantId: "tenant-a",
  operatingCompanyKey: "oc-alpha",
  workOrderId: "wo-1",
  partId: "p1",
  eventType: "RESERVED",
  quantity: 1,
  idempotencyKey: "k1",
  actorId: "u1",
};

// ============================ the vocabulary stays disjoint ============================

test("the commitment lifecycle is a SEPARATE enum, and none of its labels leak into ops_movement_type", () => {
  // THE BINDING RULE, PROVED IN BOTH DIRECTIONS. RESERVED / RELEASED / CONSUMED are commitment
  // facts; ops_movement_type is the vocabulary of the sole quantity-mutating table. A label in both
  // places would let a promise be summed as though it were physical stock.
  assert.deepEqual([...COMMITMENT_EVENT_TYPES], ["RESERVED", "RELEASED", "CONSUMED"]);

  const movementEnum = FOUNDATION.match(/CREATE TYPE ops_movement_type AS ENUM \(([\s\S]*?)\);/);
  assert.ok(movementEnum, "the foundation migration still declares ops_movement_type");
  for (const label of COMMITMENT_EVENT_TYPES) {
    assert.doesNotMatch(
      movementEnum[1],
      new RegExp(`'${label}'`),
      `${label} is a commitment lifecycle fact and must never be a movement type`,
    );
  }

  // ...and migration 008 must not sneak them in by ALTERing the enum instead of declaring its own.
  assert.doesNotMatch(MIGRATION, /ALTER TYPE\s+ops_movement_type/i, "migration 008 does not widen the movement vocabulary");
  assert.match(MIGRATION, /CREATE TYPE ops_commitment_event_type AS ENUM \('RESERVED', 'RELEASED', 'CONSUMED'\)/);
});

test("a commitment row writes to inventory_commitments and never to inventory_movements", () => {
  // The repository is the only writer this migration ships. If it mentioned the movement table at
  // all, a commitment could reach it.
  const code = REPOSITORY.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
  assert.doesNotMatch(code, /inventory_movements/, "the commitment repository never touches the movement ledger");
  assert.doesNotMatch(code, /serialized_custody/, "nor the custody pointer");
});

test("the commitment table declares no location, no tracking mode and no serial identity", () => {
  // Not an omission to be fixed later: a commitment has never had a location (the live reservation
  // is "summed across ALL locations"), and inventing one would assert a warehouse choice neither
  // demand family makes.
  const table = MIGRATION.match(/CREATE TABLE inventory_commitments \(([\s\S]*?)\n\);/);
  assert.ok(table, "the commitment table is declared");
  for (const forbidden of ["location_type", "location_id", "tracking_mode", "serial_number", "quantity_delta"]) {
    assert.ok(!table[1].includes(forbidden), `inventory_commitments must not declare ${forbidden}`);
  }
  // What it MUST declare: the mandatory authority, and a strictly positive quantity.
  assert.match(table[1], /operating_company_key TEXT NOT NULL/);
  assert.match(table[1], /CHECK \(quantity > 0\)/);
  assert.match(table[1], /idempotency_key\s+TEXT NOT NULL/);
});

test("the replay authority is keyed by (tenant, work order, state) and knows only the three trigger states", () => {
  assert.deepEqual([...WORK_ORDER_EFFECT_STATES], ["DISPATCHED", "COMPLETED", "CANCELLED"]);
  assert.match(MIGRATION, /PRIMARY KEY \(tenant_id, work_order_id, state\)/);
  assert.match(MIGRATION, /CREATE TYPE ops_work_order_effect_state AS ENUM \('DISPATCHED', 'COMPLETED', 'CANCELLED'\)/);
  // ARRIVED / WORK_IN_PROGRESS have no ledger-writeable meaning and must not appear as no-op states.
  assert.doesNotMatch(MIGRATION, /'ARRIVED'/);
  assert.doesNotMatch(MIGRATION, /'WORK_IN_PROGRESS'/);
});

test("the commitment ledger has no update or delete path in its repository", () => {
  // Same enforcement posture migration 005 records for inventory_movements: the repository offers no
  // mutation method, and this proves it by exhaustion over the source rather than by memory.
  const statements = REPOSITORY.match(/UPDATE\s+\$\{SCHEMA\}\.(\w+)|DELETE\s+FROM\s+\$\{SCHEMA\}\.(\w+)/g) ?? [];
  for (const statement of statements) {
    assert.ok(
      !statement.includes("inventory_commitments"),
      `commitment evidence is append-only; found: ${statement}`,
    );
  }
  // The replay table is the ONE mutable table here, and it is supposed to be: claimed -> processed,
  // or claimed -> failed -> re-claimed. Proving it is updated is proving the two are not confused.
  assert.ok(
    statements.some((s) => s.includes("work_order_inventory_effects")),
    "the replay authority is processing state, and does get updated",
  );
});

test("the migration follows the house style and uses the pre-allocated id", () => {
  assert.match(MIGRATION, /^-- Up Migration/);
  assert.match(MIGRATION, /\n-- Down Migration\n/);
  // The down migration must actually reverse what the up migration created.
  for (const dropped of [
    "DROP TABLE IF EXISTS work_order_inventory_effects",
    "DROP TABLE IF EXISTS inventory_commitments",
    "DROP TYPE IF EXISTS ops_commitment_event_type",
    "DROP TYPE IF EXISTS ops_work_order_effect_state",
    "DROP TYPE IF EXISTS ops_work_order_effect_status",
  ]) {
    assert.ok(MIGRATION.includes(dropped), `the down migration must ${dropped}`);
  }
});

// ============================ the refusals, above the SQL boundary ============================

test("a missing operating company is refused before any query is issued", async () => {
  // Never defaulted, never inferred from a Warehouse, a Truck, an Employee or a homeWarehouseId.
  for (const bad of [undefined, null, "", "   "]) {
    await assert.rejects(
      () => recordCommitmentEvent(neverQueried, { ...validInput, operatingCompanyKey: bad }),
      OperatingCompanyAuthorityError,
    );
  }
});

test("a signed or zero quantity is refused: direction is the event type, never a sign", async () => {
  // The defence against census NB-1, which measured three sign conventions in one live column and
  // warned that a naive copy silently inverts rows. A column that only holds positives cannot be
  // corrupted by a convention it does not have.
  for (const bad of [0, -1, -5, 1.5, Number.NaN, "3"]) {
    await assert.rejects(
      () => recordCommitmentEvent(neverQueried, { ...validInput, quantity: bad }),
      (err) => err instanceof InventoryCommitmentError && err.code === "QUANTITY_INVALID",
    );
  }
});

test("a commitment with no replay identity is refused", async () => {
  // Every commitment write originates in a Work Order transition that is retried on failure, so
  // there is no commitment event that may be written without an idempotency key.
  await assert.rejects(
    () => recordCommitmentEvent(neverQueried, { ...validInput, idempotencyKey: "" }),
    (err) => err instanceof InventoryCommitmentError && err.code === "FIELD_REQUIRED",
  );
});
