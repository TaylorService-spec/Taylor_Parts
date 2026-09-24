// THE MIGRATION LEDGER, once `--no-check-order` has been turned on for the deploy.
//
// ════════════════════ WHAT HAPPENED, AND WHY A CLI-STRING TEST WOULD BE WORTHLESS ════════════════
//
// On 2026-09-22 nonprod applied `1760486400000_tenant-operating-company-key-binding` TWENTY MINUTES
// after `1761004800000_work-order-object-authority`, although its id sorts BEFORE it. Measured:
//
//     1761004800000_work-order-object-authority            run_on 2026-09-22 22:20:31.786167
//     1761091200000_work-order-parts-plan-authority        run_on 2026-09-22 22:20:31.786167
//     1760486400000_tenant-operating-company-key-binding   run_on 2026-09-22 22:40:31.178640
//
// `node-pg-migrate` reads the ledger with `ORDER BY run_on, id` and compares it index by index with
// the directory listing, so from 2026-09-22 onward EVERY deploy failed in pre-deploy with
//
//     Error: Not run migration 1760486400000_tenant-operating-company-key-binding
//            is preceding already run migration 1761004800000_work-order-object-authority
//
// The Owner has ruled that both migrations are legitimately applied: the ledger is correct and the
// ordering check is what is wrong about it. So `functions/package.json`'s `migrate:up` -- the whole
// of `render.yaml`'s `preDeployCommand` -- now passes `--no-check-order`, matching what every test
// helper in this repository has always passed.
//
// ════════════════════ THE POINT OF THIS FILE ════════════════════
//
// `--no-check-order` is a guard being switched off. A test that greps package.json for the flag
// would assert that it is off -- which is not a safety property, it is the defect's own wording.
// The question that matters is what the ordering check was standing in for, and that is the
// INVENTORY: that the ledger and the directory still describe the same chain.
//
// So this file models the ledger and asserts the five properties that `checkOrder` can no longer
// be relied on to notice:
//
//   1. the historical anomaly is ENUMERATED and ACCEPTED -- and exhaustively, so that a SECOND,
//      undocumented out-of-order pair is not waved through by the same flag;
//   2. every applied name is a known repository migration -- a rename or a hand-applied file is
//      no longer caught by the index comparison, so it is caught here;
//   3. no name is applied twice;
//   4. no UNEXPLAINED pending migration -- a newly authored migration whose id is BACK-DATED into
//      the middle of already-applied history. This is the real hazard the flag creates: before,
//      such a file aborted the deploy; now it would apply silently, against a schema that already
//      moved past it;
//   5. the chain itself is still well formed -- unique ids, filename order == id order, and the
//      deferred migration still never applied.
//
// NO LIVE CONNECTION. CI has no route to nonprod, so the ledger is MODELLED from the measurement
// below and, for the executable half, replayed into a disposable database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(FUNCTIONS_DIR, "migrations");
const DEFERRED_DIR = join(MIGRATIONS_DIR, "deferred");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP_PG = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to replay the ledger into";

/**
 * NONPROD'S LEDGER, MEASURED -- `SELECT name FROM pgmigrations ORDER BY run_on, id` against
 * eos-policy-nonprod on 2026-09-24, read-only. This is exactly the sequence `node-pg-migrate`
 * compares against the directory listing, out-of-order pair and all: note that
 * 1760486400000 sits BELOW 1761004800000 and 1761091200000 rather than above them.
 *
 * It is a MODEL, not a mirror. It does not have to track nonprod forward: a migration applied
 * after this measurement simply shows up as pending, and rule 4 decides whether that is explained.
 */
const NONPROD_LEDGER = Object.freeze([
  "1757462400000_admin-policy",
  "1757548800000_tenant-and-identity",
  "1757635200000_assignment-integrity",
  "1757721600000_operational-capabilities",
  "1757808000000_eos-ops-foundation",
  "1757894400000_operational-capability-vocabulary",
  "1757980800000_operating-company-and-serialized-custody",
  "1758067200000_inventory-commitment-and-work-order-replay",
  "1758240000000_warehouse-and-bin-location-authority",
  "1758326400000_truck-and-mobile-location-registry",
  "1758412800000_employee-principal-linkage",
  "1758499200000_supplier-and-supplier-catalog-authority",
  "1758585600000_equipment-and-installed-custody",
  "1758672000000_purchasing-object-authority",
  "1758758400000_crm-account-contact-location",
  "1758844800000_commercial-ownership-authority",
  "1758931200000_invoice-authority",
  "1759017600000_ar-cash-application-authority",
  "1759104000000_employee-business-authority",
  "1759276800000_commercial-accountability-authority",
  "1759363200000_accountability-history-action-and-source",
  "1759449600000_commercial-schema-parity-numbering-receipts",
  "1759536000000_commercial-capability-vocabulary",
  "1759622400000_crm-capability-vocabulary",
  "1759708800000_crm-account-business-facts-and-receipts",
  "1759795200000_catalog-part-identity-reference-authority",
  "1759838400000_employee-profile-and-reporting-authority",
  "1759881600000_catalog-master-descriptive-authority",
  "1759924800000_crm-account-ownership-history",
  "1759968000000_tenant-operating-company-authority",
  "1760011200000_employee-job-role-authority",
  "1760054400000_employee-work-eligibility-authority",
  "1760097600000_employee-operational-scope-authority",
  "1760140800000_reorder-assignment-identity",
  // ── THE ANOMALY, as applied. These three lines are the whole reason this file exists. ──
  "1761004800000_work-order-object-authority",
  "1761091200000_work-order-parts-plan-authority",
  "1760486400000_tenant-operating-company-key-binding",
  // ───────────────────────────────────────────────────────────────────────────────────────
  "1761177600000_work-order-number-allocator",
  "1761264000000_work-order-native-capability-vocabulary",
  "1761350400000_canonical-capability-object-action-metadata",
  "1761436800000_principal-capability-grants",
  "1761523200000_cred-capability-vocabulary-and-grant-preservation",
  "1761609600000_finance-administration-reorder-vocabulary",
  "1761696000000_parts-associate-eligibility-and-reorder-queue-scope",
  "1761782400000_manufacturer-catalog-authority",
  "1761868800000_retire-stock-location-policy-object",
  "1761955200000_retire-dispatch-notification-objects-rehome-coordinated-visit",
  "1762041600000_administration-security-policy-read-authority",
  "1762128000000_workflow-definition-read-authority",
  "1762214400000_capability-grant-conditions",
]);

/**
 * THE ACCEPTED ANOMALY, ENUMERATED EXHAUSTIVELY.
 *
 * The Render error named only the FIRST index at which the two sequences diverge. The measured
 * ledger actually contains TWO inversions, both produced by the SAME single displaced migration:
 * 1760486400000 was applied after 1761004800000 AND after 1761091200000. Naming the pair from the
 * error message alone would leave the second one unaccounted for, and "unaccounted for" is the
 * state this whole lane exists to end.
 *
 * `authoredEarlier` has the lower id; `appliedFirst` was written into the ledger before it anyway.
 */
const ACCEPTED_OUT_OF_ORDER = Object.freeze([
  Object.freeze({
    authoredEarlier: "1760486400000_tenant-operating-company-key-binding",
    appliedFirst: "1761004800000_work-order-object-authority",
  }),
  Object.freeze({
    authoredEarlier: "1760486400000_tenant-operating-company-key-binding",
    appliedFirst: "1761091200000_work-order-parts-plan-authority",
  }),
]);

/** Tracked but NEVER applied, by design. It lives outside the migrations dir so the runner never sees it. */
const DEFERRED_MIGRATION = "1759190400000_employee-principal-link-employee-fk.sql";

const RUNNABLE_MIGRATION_COUNT = 50;
const TRACKED_MIGRATION_COUNT = 51; // the 50 runnable + the one deferred file

const repoMigrations = () =>
  readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")).sort();
const idOf = (name) => Number(name.split("_")[0]);
const sortPairs = (pairs) =>
  [...pairs].sort((a, b) =>
    a.authoredEarlier.localeCompare(b.authoredEarlier) || a.appliedFirst.localeCompare(b.appliedFirst));

/**
 * THE WHOLE GUARD, as one pure function over two name lists. Pure so that every failure mode below
 * can be INJECTED and shown to be reported, rather than asserted to be impossible.
 *
 * @param {string[]} repo    migration names as the runner would order them (id order)
 * @param {string[]} applied migration names in ledger order (`ORDER BY run_on, id`)
 */
export function analyseLedger(repo, applied) {
  const known = new Set(repo);
  const rank = new Map(repo.map((n, i) => [n, i]));

  const unknownApplied = applied.filter((n) => !known.has(n));

  const seen = new Set();
  const duplicates = [];
  for (const n of applied) {
    if (seen.has(n)) duplicates.push(n);
    seen.add(n);
  }

  // Every inversion, not just the first -- `checkOrder` stops at the first divergence, which is
  // precisely how the second half of this anomaly stayed unnamed until now.
  const outOfOrder = [];
  for (let i = 0; i < applied.length; i += 1) {
    for (let j = i + 1; j < applied.length; j += 1) {
      const a = rank.get(applied[i]);
      const b = rank.get(applied[j]);
      if (a === undefined || b === undefined) continue; // reported as unknownApplied instead
      if (a > b) outOfOrder.push({ authoredEarlier: applied[j], appliedFirst: applied[i] });
    }
  }

  const appliedSet = new Set(applied.filter((n) => known.has(n)));
  const pending = repo.filter((n) => !appliedSet.has(n));
  // A pending migration is EXPLAINED only if it is genuinely new work appended to the end of the
  // chain. One whose id lands inside already-applied history is the hazard `--no-check-order`
  // creates: the runner will now apply it happily, against a schema that has already moved past it.
  const highestApplied = applied.filter((n) => known.has(n)).reduce((m, n) => Math.max(m, idOf(n)), -1);
  // `<=`, not `<`: a pending migration sharing an id with the highest applied one is a collision,
  // which is at least as unexplained as a back-dated one.
  const unexplainedPending = pending.filter((n) => idOf(n) <= highestApplied);

  return { unknownApplied, duplicates, outOfOrder, pending, unexplainedPending };
}

// ════════════════════ THE CHAIN ITSELF ════════════════════

test("the migration chain is well formed: 50 runnable, 51 tracked, unique ids, filename order == id order", () => {
  const repo = repoMigrations();
  assert.equal(repo.length, RUNNABLE_MIGRATION_COUNT,
    `expected ${RUNNABLE_MIGRATION_COUNT} runnable migrations, found ${repo.length}. ` +
    `${RUNNABLE_MIGRATION_COUNT} runnable vs ${TRACKED_MIGRATION_COUNT} tracked is the deferred file, not drift; ` +
    "a new migration is a deliberate change to this number, made together with the ledger model below");

  const deferred = readdirSync(DEFERRED_DIR).filter((f) => f.endsWith(".sql"));
  assert.deepEqual(deferred, [DEFERRED_MIGRATION], "the deferred directory holds exactly the one deferred migration");
  assert.equal(repo.length + deferred.length, TRACKED_MIGRATION_COUNT);

  const ids = repo.map(idOf);
  assert.ok(ids.every(Number.isInteger), "every migration filename begins with an integer id");
  assert.equal(new Set(ids).size, ids.length, "two migrations may not share an id");
  assert.deepEqual([...ids], [...ids].sort((a, b) => a - b),
    "lexical filename order must equal numeric id order -- the runner uses the former and humans read the latter");
});

test("the deferred migration is never in the ledger", () => {
  const deferredName = DEFERRED_MIGRATION.replace(/\.sql$/, "");
  assert.equal(NONPROD_LEDGER.includes(deferredName), false,
    `${deferredName} is deferred by design; an application of it is an event, not a routine deploy`);
  assert.equal(repoMigrations().includes(deferredName), false,
    "the deferred migration must stay OUT of the runnable directory");
});

// ════════════════════ THE LEDGER, AGAINST TODAY'S CHAIN ════════════════════

test("every applied migration is a known repository migration", () => {
  const { unknownApplied } = analyseLedger(repoMigrations(), NONPROD_LEDGER);
  assert.deepEqual(unknownApplied, [],
    "the ledger names a migration this repository does not contain -- a rename, a deletion, or a " +
    "hand-applied file. With --no-check-order the runner will no longer notice it.");
});

test("no migration name appears twice in the ledger", () => {
  const { duplicates } = analyseLedger(repoMigrations(), NONPROD_LEDGER);
  assert.deepEqual(duplicates, [], "a migration recorded twice means the ledger was edited by hand");
});

test("the ONLY out-of-order pairs are the two documented and accepted ones", () => {
  const { outOfOrder } = analyseLedger(repoMigrations(), NONPROD_LEDGER);
  assert.deepEqual(sortPairs(outOfOrder), sortPairs(ACCEPTED_OUT_OF_ORDER),
    "a second, UNDOCUMENTED out-of-order pair. --no-check-order makes the deploy tolerate it " +
    "silently; this assertion is the only thing that does not. Establish why it happened and " +
    "record it here deliberately -- do not widen the list to make the test pass.");
  // Non-vacuity: the accepted set must actually be present, so a future edit that empties the
  // ledger model cannot make this test pass by having nothing to compare.
  assert.equal(outOfOrder.length, 2, "the accepted anomaly is two inversions from one displaced migration");
  for (const pair of outOfOrder) {
    assert.equal(pair.authoredEarlier, "1760486400000_tenant-operating-company-key-binding",
      "both accepted inversions come from the SAME displaced migration");
    assert.ok(idOf(pair.authoredEarlier) < idOf(pair.appliedFirst), "an inversion is defined by id, not by name");
  }
});

test("there is no unexplained pending migration", () => {
  const { pending, unexplainedPending } = analyseLedger(repoMigrations(), NONPROD_LEDGER);
  assert.deepEqual(unexplainedPending, [],
    "a pending migration whose id falls INSIDE already-applied history. Before --no-check-order " +
    "this aborted the deploy; now it applies silently against a schema that moved past it. " +
    "Re-date it above the highest applied id.");
  // Today the model and the chain agree exactly; say so, so that a pending migration appearing at
  // all is a deliberate, visible change to this line rather than a silent drift.
  assert.deepEqual(pending, [], "the modelled ledger and the repository chain are the same 50 migrations");
});

// ════════════════════ THE GUARD BITES -- each failure mode, injected ════════════════════

test("an unknown applied name is REPORTED, not tolerated", () => {
  const repo = repoMigrations();
  const injected = [...NONPROD_LEDGER, "1762300800000_a-migration-this-repository-does-not-have"];
  const { unknownApplied } = analyseLedger(repo, injected);
  assert.deepEqual(unknownApplied, ["1762300800000_a-migration-this-repository-does-not-have"]);
});

test("a duplicated ledger entry is REPORTED, not tolerated", () => {
  const repo = repoMigrations();
  const injected = [...NONPROD_LEDGER, "1761004800000_work-order-object-authority"];
  const { duplicates } = analyseLedger(repo, injected);
  assert.deepEqual(duplicates, ["1761004800000_work-order-object-authority"]);
});

test("a SECOND out-of-order pair -- one that is not the accepted anomaly -- is REPORTED", () => {
  const repo = repoMigrations();
  // Displace an unrelated migration: apply 1761868800000 before 1761782400000.
  const injected = [...NONPROD_LEDGER];
  const i = injected.indexOf("1761782400000_manufacturer-catalog-authority");
  const j = injected.indexOf("1761868800000_retire-stock-location-policy-object");
  [injected[i], injected[j]] = [injected[j], injected[i]];

  const { outOfOrder } = analyseLedger(repo, injected);
  const extra = sortPairs(outOfOrder).filter((p) =>
    !ACCEPTED_OUT_OF_ORDER.some((a) => a.authoredEarlier === p.authoredEarlier && a.appliedFirst === p.appliedFirst));
  assert.deepEqual(extra, [{
    authoredEarlier: "1761782400000_manufacturer-catalog-authority",
    appliedFirst: "1761868800000_retire-stock-location-policy-object",
  }]);
  // And the real assertion above would fail on it, because the sets are no longer equal.
  assert.notDeepEqual(sortPairs(outOfOrder), sortPairs(ACCEPTED_OUT_OF_ORDER));
});

test("a BACK-DATED pending migration is REPORTED -- the hazard --no-check-order newly creates", () => {
  const repo = [...repoMigrations(), "1760500000000_a-migration-back-dated-into-applied-history"].sort();
  const { pending, unexplainedPending } = analyseLedger(repo, NONPROD_LEDGER);
  assert.deepEqual(pending, ["1760500000000_a-migration-back-dated-into-applied-history"]);
  assert.deepEqual(unexplainedPending, ["1760500000000_a-migration-back-dated-into-applied-history"]);
});

test("a properly APPENDED pending migration is explained, and is not reported", () => {
  const repo = [...repoMigrations(), "1762300800000_a-migration-appended-after-the-chain"].sort();
  const { pending, unexplainedPending } = analyseLedger(repo, NONPROD_LEDGER);
  assert.deepEqual(pending, ["1762300800000_a-migration-appended-after-the-chain"]);
  assert.deepEqual(unexplainedPending, [], "new work at the end of the chain is normal and must not fire the guard");
});

// ════════════════════ THE DEPLOY PATH, REPLAYED INTO A REAL DATABASE ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const migrateUpArgs = () => {
  // Read the ACTUAL deploy command out of package.json rather than hard-coding it, so this replays
  // whatever render.yaml's `preDeployCommand` will really run.
  const pkg = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "package.json"), "utf8"));
  const script = pkg.scripts["migrate:up"];
  assert.ok(script?.startsWith("node-pg-migrate up "), `migrate:up is not a node-pg-migrate up invocation: ${script}`);
  return script.split(/\s+/).slice(1); // everything after the binary name, starting with "up"
};

test("the deploy's migrate:up returns cleanly over the anomalous ledger, applying nothing",
  { skip: SKIP_PG, concurrency: 1 }, async (t) => {
    const name = `migledger_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
    t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)));

    // Seed pgmigrations with exactly the table node-pg-migrate creates, in the measured order.
    // Nothing else is created: this proves the ORDERING decision, which happens before any
    // migration body would run.
    await withClient(dbUrlFor(name), async (c) => {
      await c.query("CREATE TABLE pgmigrations (id SERIAL PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL)");
      for (const [i, m] of NONPROD_LEDGER.entries()) {
        await c.query("INSERT INTO pgmigrations (name, run_on) VALUES ($1, TIMESTAMP '2026-09-01 00:00:00' + ($2 * INTERVAL '1 minute'))", [m, i]);
      }
    });

    const env = { ...process.env, DATABASE_URL: dbUrlFor(name) };
    const runner = "node_modules/node-pg-migrate/bin/node-pg-migrate.js";

    // NON-VACUITY, and the measured defect reproduced: WITHOUT the flag the deploy still dies the
    // way Render died. If this ever stops throwing, the anomaly is gone and so is the reason for
    // --no-check-order -- which is a finding, not a pass.
    assert.throws(
      () => execFileSync(process.execPath, [runner, "up", "--migrations-dir", "migrations"],
        { cwd: FUNCTIONS_DIR, env, stdio: "pipe" }),
      (error) => {
        const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`;
        assert.match(text, /Not run migration 1760486400000_tenant-operating-company-key-binding is preceding already run migration 1761004800000_work-order-object-authority/);
        return true;
      },
      "the ordering check must still reject this ledger -- otherwise the flag is protecting nothing");

    // THE FIX, as the deploy will really invoke it.
    const output = execFileSync(process.execPath, [runner, ...migrateUpArgs()],
      { cwd: FUNCTIONS_DIR, env, stdio: "pipe" }).toString();
    assert.match(output, /No migrations to run!/, "an up-to-date ledger must apply nothing");
    assert.equal(/^> - /m.test(output), false, "no migration may be applied by a no-op deploy");

    const after = await withClient(dbUrlFor(name), (c) =>
      c.query("SELECT name FROM pgmigrations ORDER BY run_on, id"));
    assert.equal(after.rows.length, NONPROD_LEDGER.length, "the ledger must be untouched: 0 unexpected migrations applied");
    assert.deepEqual(after.rows.map((r) => r.name), [...NONPROD_LEDGER], "and in the same order it was read in");
  });
