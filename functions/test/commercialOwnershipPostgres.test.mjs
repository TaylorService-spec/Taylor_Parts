// EOS Commercial Data Plane — migration 008's STRUCTURAL proofs: the commercial ownership
// authority, against a real PostgreSQL server.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as eosOpsPostgres.test.mjs and adminPolicyPostgres.test.mjs: set
// POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails.
//
// ════════════════════ WHY THIS SUITE DOES NOT RESET THE SCHEMA ════════════════════
//
// adminPolicyPostgres.test.mjs's "every suite that resets the schema is covered by that one
// command" scans every test file for a schema reset and requires it to appear in the serialized
// `test:adminPolicyPostgres` script, because two suites that each rebuild the same schema will race
// under `node --test`'s file-level concurrency. That test is right, and this suite therefore does
// NOT rebuild anything: it runs `migrate up` (a no-op once applied) and confines every row it
// writes to a tenant id generated for this process. It can run beside the resetting suites without
// racing them, and it never depends on rows a previous run left behind.
//
// The one claim that genuinely needs a rebuild is the down migration's refusal to discard ownership
// history. It is proved over the migration SOURCE in commercialOwnershipAuthority.test.mjs, and
// registering this file in the serialized script would let it be proved here too -- recorded in
// docs/handoff/w1-c10-registrations.md, because functions/package.json is not this lane's to edit.
//
// The claims below are STRUCTURAL on purpose. "The writers will remember to supply an owner" is not
// a property; "the database refuses a row without one" is.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  createCommercialRecord,
  readCommercialRecord,
  readOwnershipHistory,
  transferCommercialOwnership,
  CommercialRecordNotFoundError,
} from "../lib/eosCommercial/commercialOwnershipRepository.js";
import { CommercialOwnershipError } from "../lib/eosCommercial/commercialOwnershipAuthority.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

/** One tenant per process. Nothing here reads a row it did not write. */
const TENANT = `tenant-c10-${randomUUID()}`;
const ACTOR = "uid-actor";
const uniq = () => randomUUID().slice(0, 8);

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

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

let prepared = false;
async function prepare() {
  if (prepared) return;
  migrate(["up"]);
  await query(
    "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
    [TENANT],
  );
  prepared = true;
}

/** A minimum-valid Opportunity, written through the repository. */
async function anOpportunity(overrides = {}) {
  return createCommercialRecord(repoPool(), TENANT, ACTOR, {
    kind: "OPPORTUNITY",
    recordNumber: `OPP-2026-${uniq()}`,
    accountId: "acct-1",
    ownerEmployeeId: "emp-rudy",
    createdBy: "emp-assistant",
    ...overrides,
  });
}

test.after(async () => {
  if (pool) await pool.end();
});

// ============================ the schema exists and is a sibling ============================

test("migration 008 creates eos_commercial beside eos_policy and eos_ops", { skip: SKIP }, async () => {
  await prepare();
  const schemas = await query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'eos_%' ORDER BY schema_name",
  );
  const names = schemas.rows.map((r) => r.schema_name);
  assert.ok(names.includes("eos_commercial"), "the commercial schema is there");
  assert.ok(names.includes("eos_policy") && names.includes("eos_ops"), "and its siblings are untouched");

  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_commercial' ORDER BY table_name",
  );
  assert.deepEqual(
    tables.rows.map((r) => r.table_name),
    ["opportunities", "ownership_handoffs", "sales_agreements", "sales_orders"],
    "four tables: three commercial records and their shared ownership history",
  );
});

test("there is no sales_territories table, because coverage is not ownership", { skip: SKIP }, async () => {
  await prepare();
  const found = await query(
    "SELECT count(*)::int n FROM information_schema.tables" +
    " WHERE table_schema = 'eos_commercial' AND table_name = 'sales_territories'",
  );
  assert.equal(found.rows[0].n, 0);
});

// ============================ ruling 1: every record has an owner ============================

test("the owner column is NOT NULL with no default on all three record tables", { skip: SKIP }, async () => {
  await prepare();
  const columns = await query(
    `SELECT table_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'eos_commercial' AND column_name = 'owner_employee_id'
      ORDER BY table_name`,
  );
  assert.deepEqual(
    columns.rows.map((r) => r.table_name),
    ["opportunities", "sales_agreements", "sales_orders"],
  );
  for (const row of columns.rows) {
    assert.equal(row.is_nullable, "NO", `${row.table_name} refuses an ownerless row`);
    assert.equal(row.column_default, null, `${row.table_name} manufactures no owner`);
  }
});

test("the DATABASE refuses an ownerless row, not merely the validator", { skip: SKIP }, async () => {
  await prepare();
  // Straight past the repository and the pure authority, the way a future writer that forgot them
  // would arrive. This is the claim the validator cannot make on its own.
  await assert.rejects(
    query(
      `INSERT INTO eos_commercial.opportunities
         (id, tenant_id, opportunity_number, account_id, created_by, updated_by)
       VALUES ($1, $2, $3, 'acct-1', 'u', 'u')`,
      [`opp_${uniq()}`, TENANT, `OPP-2026-${uniq()}`],
    ),
    /owner_employee_id/,
  );
});

test("an ownerless row is refused for every one of the three tables", { skip: SKIP }, async () => {
  await prepare();
  const cases = [
    ["opportunities", "opportunity_number"],
    ["sales_agreements", "sales_agreement_number"],
    ["sales_orders", "sales_order_number"],
  ];
  for (const [table, numberColumn] of cases) {
    const company = table === "sales_orders" ? ", operating_company_key" : "";
    const companyValue = table === "sales_orders" ? ", 'taylor'" : "";
    await assert.rejects(
      query(
        `INSERT INTO eos_commercial.${table}
           (id, tenant_id, ${numberColumn}, account_id, created_by, updated_by${company})
         VALUES ($1, $2, $3, 'acct-1', 'u', 'u'${companyValue})`,
        [`x_${uniq()}`, TENANT, `N-${uniq()}`],
      ),
      /owner_employee_id/,
      `${table} must refuse an ownerless row`,
    );
  }
});

// ============================ ruling R-8: the operating company ============================

test("a Sales Order without an operating company is refused by the column, not only the command", { skip: SKIP }, async () => {
  await prepare();
  await assert.rejects(
    query(
      `INSERT INTO eos_commercial.sales_orders
         (id, tenant_id, sales_order_number, account_id, owner_employee_id, created_by, updated_by)
       VALUES ($1, $2, $3, 'acct-1', 'emp-rudy', 'u', 'u')`,
      [`sor_${uniq()}`, TENANT, `SO-2026-${uniq()}`],
    ),
    /operating_company_key/,
  );
});

test("an Opportunity may be company-unresolved, exactly as its command allows", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();
  assert.equal(opportunity.operatingCompanyKey, null, "nullable where the command returns null");
});

test("the schema stores a governed company key without knowing which companies exist", { skip: SKIP }, async () => {
  await prepare();
  // The column is opaque TEXT: the AUTHORITY layer decides `taylor | ventana`, and it does --
  // the repository's pure builder refuses an ungoverned id before the INSERT is ever issued.
  const order = await createCommercialRecord(repoPool(), TENANT, ACTOR, {
    kind: "SALES_ORDER",
    recordNumber: `SO-2026-${uniq()}`,
    accountId: "acct-1",
    ownerEmployeeId: "emp-rudy",
    createdBy: "emp-rudy",
    operatingCompanyId: "ventana",
  });
  assert.equal(order.operatingCompanyKey, "ventana");

  await assert.rejects(
    createCommercialRecord(repoPool(), TENANT, ACTOR, {
      kind: "SALES_ORDER",
      recordNumber: `SO-2026-${uniq()}`,
      accountId: "acct-1",
      ownerEmployeeId: "emp-rudy",
      createdBy: "emp-rudy",
      operatingCompanyId: "acme",
    }),
    (err) => err instanceof CommercialOwnershipError && err.code === "COMPANY_UNGOVERNED",
  );

  const enumTypes = await query(
    `SELECT count(*)::int n FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace
      WHERE ns.nspname = 'eos_commercial' AND t.typname LIKE '%company%'`,
  );
  assert.equal(enumTypes.rows[0].n, 0, "no SQL enum hard-codes this deployment's companies");
});

// ============================ ruling 3: the assistant case ============================

test("owner and creator are stored separately and neither is derived from the other", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();
  assert.equal(opportunity.ownerEmployeeId, "emp-rudy", "the Customer's owner keeps the record");
  assert.equal(opportunity.createdBy, "emp-assistant", "the assistant is recorded as the creator");
  assert.notEqual(opportunity.ownerEmployeeId, opportunity.createdBy);

  const stored = await query(
    "SELECT owner_employee_id, created_by, updated_by FROM eos_commercial.opportunities WHERE id = $1",
    [opportunity.id],
  );
  assert.equal(stored.rows[0].owner_employee_id, "emp-rudy");
  assert.equal(stored.rows[0].created_by, "emp-assistant");
  // updated_by is the ACTOR -- a third fact again, never folded into ownership.
  assert.equal(stored.rows[0].updated_by, ACTOR);
});

// ============================ rulings 4, 5, 6: transfer, history, and what follows ============================

test("a negotiated transfer moves the owner AND records who held it before", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();

  const handoff = await transferCommercialOwnership(repoPool(), TENANT, ACTOR, {
    kind: "OPPORTUNITY",
    recordId: opportunity.id,
    newOwnerEmployeeId: "emp-lee",
    source: "DIRECT_HANDOFF",
    reason: "negotiated at the quarterly book review",
  });
  assert.equal(handoff.previousOwnerEmployeeId, "emp-rudy", "read from the record, never from the caller");
  assert.equal(handoff.newOwnerEmployeeId, "emp-lee");

  // RULING 6: the current owner moved, so anything created from this record afterwards inherits Lee.
  const now = await readCommercialRecord(repoPool(), TENANT, "OPPORTUNITY", opportunity.id);
  assert.equal(now.ownerEmployeeId, "emp-lee");

  // RULING 5: and the record still says Rudy held it.
  const history = await readOwnershipHistory(repoPool(), TENANT, "OPPORTUNITY", opportunity.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].previousOwnerEmployeeId, "emp-rudy");
  assert.equal(history[0].recordedBy, ACTOR);
});

test("two transfers leave a chain, not an overwrite", { skip: SKIP }, async () => {
  await prepare();
  const order = await createCommercialRecord(repoPool(), TENANT, ACTOR, {
    kind: "SALES_ORDER",
    recordNumber: `SO-2026-${uniq()}`,
    accountId: "acct-1",
    ownerEmployeeId: "emp-rudy",
    createdBy: "emp-rudy",
    operatingCompanyId: "taylor",
  });
  const base = { kind: "SALES_ORDER", recordId: order.id, source: "DIRECT_HANDOFF" };
  await transferCommercialOwnership(repoPool(), TENANT, ACTOR, { ...base, newOwnerEmployeeId: "emp-lee" });
  await transferCommercialOwnership(repoPool(), TENANT, ACTOR, { ...base, newOwnerEmployeeId: "emp-sam" });

  const history = await readOwnershipHistory(repoPool(), TENANT, "SALES_ORDER", order.id);
  assert.deepEqual(
    history.map((h) => [h.previousOwnerEmployeeId, h.newOwnerEmployeeId]),
    [["emp-rudy", "emp-lee"], ["emp-lee", "emp-sam"]],
    "each handoff records the owner the previous one installed",
  );
  const now = await readCommercialRecord(repoPool(), TENANT, "SALES_ORDER", order.id);
  assert.equal(now.ownerEmployeeId, "emp-sam");
});

test("a recorded handoff cannot be edited or deleted -- the STORE refuses, not the repository", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();
  const handoff = await transferCommercialOwnership(repoPool(), TENANT, ACTOR, {
    kind: "OPPORTUNITY", recordId: opportunity.id, newOwnerEmployeeId: "emp-lee", source: "DIRECT_HANDOFF",
  });

  await assert.rejects(
    query("UPDATE eos_commercial.ownership_handoffs SET new_owner_employee_id = 'emp-sam' WHERE id = $1", [handoff.id]),
    /append-only/,
  );
  await assert.rejects(
    query("DELETE FROM eos_commercial.ownership_handoffs WHERE id = $1", [handoff.id]),
    /append-only/,
  );

  const survived = await readOwnershipHistory(repoPool(), TENANT, "OPPORTUNITY", opportunity.id);
  assert.equal(survived.length, 1, "the history is intact");
  assert.equal(survived[0].newOwnerEmployeeId, "emp-lee", "and unedited");
});

test("a no-op handoff is refused, and the record is left exactly as it was", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();
  await assert.rejects(
    transferCommercialOwnership(repoPool(), TENANT, ACTOR, {
      kind: "OPPORTUNITY", recordId: opportunity.id, newOwnerEmployeeId: "emp-rudy", source: "DIRECT_HANDOFF",
    }),
    (err) => err instanceof CommercialOwnershipError && err.code === "HANDOFF_NO_OP",
  );
  const history = await readOwnershipHistory(repoPool(), TENANT, "OPPORTUNITY", opportunity.id);
  assert.equal(history.length, 0, "the refused transfer wrote nothing");
  const now = await readCommercialRecord(repoPool(), TENANT, "OPPORTUNITY", opportunity.id);
  assert.equal(now.ownerEmployeeId, "emp-rudy");
});

test("the no-op refusal is also a database CHECK, reachable without the repository", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();
  await assert.rejects(
    query(
      `INSERT INTO eos_commercial.ownership_handoffs
         (id, tenant_id, opportunity_id, previous_owner_employee_id, new_owner_employee_id, source, recorded_by)
       VALUES ($1, $2, $3, 'emp-rudy', 'emp-rudy', 'DIRECT_HANDOFF', 'u')`,
      [`hof_${uniq()}`, TENANT, opportunity.id],
    ),
    /ownership_handoff_is_not_a_no_op/,
  );
});

test("NO CASCADE: a handoff row names exactly one record, and the database enforces it", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();
  const order = await createCommercialRecord(repoPool(), TENANT, ACTOR, {
    kind: "SALES_ORDER",
    recordNumber: `SO-2026-${uniq()}`,
    accountId: "acct-1",
    ownerEmployeeId: "emp-rudy",
    createdBy: "emp-rudy",
    operatingCompanyId: "taylor",
    opportunityId: opportunity.id,
  });

  // Naming two records in one handoff -- the cascade shape -- is unrepresentable.
  await assert.rejects(
    query(
      `INSERT INTO eos_commercial.ownership_handoffs
         (id, tenant_id, opportunity_id, sales_order_id, previous_owner_employee_id,
          new_owner_employee_id, source, recorded_by)
       VALUES ($1, $2, $3, $4, 'emp-rudy', 'emp-lee', 'DIRECT_HANDOFF', 'u')`,
      [`hof_${uniq()}`, TENANT, opportunity.id, order.id],
    ),
    /ownership_handoff_names_exactly_one_record/,
  );
  // And naming none is refused too, which is what stops a "global" handoff.
  await assert.rejects(
    query(
      `INSERT INTO eos_commercial.ownership_handoffs
         (id, tenant_id, previous_owner_employee_id, new_owner_employee_id, source, recorded_by)
       VALUES ($1, $2, 'emp-rudy', 'emp-lee', 'DIRECT_HANDOFF', 'u')`,
      [`hof_${uniq()}`, TENANT],
    ),
    /ownership_handoff_names_exactly_one_record/,
  );

  // Handing off the Opportunity leaves the Sales Order where it was.
  await transferCommercialOwnership(repoPool(), TENANT, ACTOR, {
    kind: "OPPORTUNITY", recordId: opportunity.id, newOwnerEmployeeId: "emp-lee", source: "DIRECT_HANDOFF",
  });
  const downstream = await readCommercialRecord(repoPool(), TENANT, "SALES_ORDER", order.id);
  assert.equal(downstream.ownerEmployeeId, "emp-rudy", "no cascade -- moving it is a separate decision");
});

// ============================ identity, lineage and tenancy ============================

test("two records cannot answer to one canonical number within a tenant", { skip: SKIP }, async () => {
  await prepare();
  const number = `OPP-2026-${uniq()}`;
  await anOpportunity({ recordNumber: number });
  await assert.rejects(anOpportunity({ recordNumber: number }), /opportunities_number_unique/);
});

test("the commercial lineage is a real foreign key", { skip: SKIP }, async () => {
  await prepare();
  await assert.rejects(
    createCommercialRecord(repoPool(), TENANT, ACTOR, {
      kind: "SALES_AGREEMENT",
      recordNumber: `SA-2026-${uniq()}`,
      accountId: "acct-1",
      ownerEmployeeId: "emp-rudy",
      createdBy: "emp-rudy",
      opportunityId: "opp_does_not_exist",
    }),
    /foreign key|violates/i,
  );
});

test("a record is invisible to another tenant, and cannot be handed off from one", { skip: SKIP }, async () => {
  await prepare();
  const opportunity = await anOpportunity();
  const other = `${TENANT}-other`;
  await query(
    "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
    [other],
  );
  assert.equal(await readCommercialRecord(repoPool(), other, "OPPORTUNITY", opportunity.id), null);
  await assert.rejects(
    transferCommercialOwnership(repoPool(), other, ACTOR, {
      kind: "OPPORTUNITY", recordId: opportunity.id, newOwnerEmployeeId: "emp-lee", source: "DIRECT_HANDOFF",
    }),
    (err) => err instanceof CommercialRecordNotFoundError,
  );
});

test("the handoff source vocabulary is closed at the database", { skip: SKIP }, async () => {
  await prepare();
  const labels = await query(
    `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'eos_commercial' AND t.typname = 'commercial_handoff_source'
      ORDER BY e.enumsortorder`,
  );
  assert.deepEqual(
    labels.rows.map((r) => r.enumlabel),
    ["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"],
  );
});
