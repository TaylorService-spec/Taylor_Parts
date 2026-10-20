// F-1b migration DOWN, over real PostgreSQL (migration 1764712000000_invoice-corrections; the slot is provisional until the controller writes the file).
//   CLEAN      on a database with no corrections the Down reverses completely: the table, the triggers, the three approval capabilities, the CUSTOMER_REFUND kind and the view's
//              refunded column are gone, F-1a's immutability trigger is back to "an issued invoice admits no change" -- and the Up re-applies cleanly (reversible both ways).
//   REFUSAL    an approval key granted to a Role (this migration grants none), and any correction / refund record / adjustment fact / voided invoice, make the Down REFUSE with a named
//              reason and change nothing of Finance history.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-f1b-down";
const MINE = "1764712000000";
const KEYS = ["finance.adjustment.approve", "finance.refund.approve", "finance.invoice.void.approve"];

/** node-pg-migrate against `url`: `direction` over `count` migrations. Throws with the runner's output on failure. */
const migrate = (url, direction, count) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", direction, "--migrations-dir", "migrations", "--no-check-order", String(count)],
  { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
/** Mine and every migration after it (newer ones are peeled first by a down). */
const fromMine = () => readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql") && f.split("_")[0] >= MINE).length;

test("F-1b migration down over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, pool, admin } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "f1bdn" });
  const url = pool.options.connectionString;
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const present = async () => ({
    table: (await one(`SELECT to_regclass('eos_finance.invoice_corrections') IS NOT NULL AS p`)).p,
    caps: (await one(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = ANY($1)`, [KEYS])).n,
    trigger: (await one(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'financial_fact_adjustment_approved' AND NOT tgisinternal`)).n,
    viewCols: (await one(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'eos_finance' AND table_name = 'settlement_balances'`)).n,
    kindCheck: (await one(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'settlements_kind_check' AND conrelid = 'eos_finance.settlements'::regclass`)).d.includes("CUSTOMER_REFUND"),
    voidGate: (await one(`SELECT prosrc LIKE '%invoice_corrections%' AS g FROM pg_proc WHERE proname = 'refuse_issued_invoice_change'`)).g,
  });
  const UP = { table: true, caps: 3, trigger: 1, viewCols: 11, kindCheck: true, voidGate: true };
  assert.deepEqual(await present(), UP, "the Up is applied");
  const n = fromMine();
  assert.ok(n >= 1);

  await t.test("REFUSAL: an approval key granted to a Role (this migration grants none) makes the Down refuse and change nothing", async () => {
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc_f1b_down_probe', $1, r.id, c.id, 'down-test', 'down-test', 'down-test' FROM eos_policy.roles r, eos_policy.capabilities c
              WHERE r.tenant_id = $1 AND r.key = 'owner' AND c.key = $2`, [TENANT, KEYS[1]]);
    let failure = null;
    try { migrate(url, "down", n); } catch (e) { failure = String(e.stderr ?? e.stdout ?? e.message); }
    assert.match(failure ?? "", /F1B_INVOICE_CORRECTIONS: refuses to reverse -- 1 Role grant\(s\) hold an approval capability/);
    // any migration NEWER than this one was peeled before the refusal (its own transaction); put the chain back and prove the refused Down changed nothing of ours
    if (n > 1) migrate(url, "up", n - 1);
    assert.deepEqual(await present(), UP);
    await q(`DELETE FROM eos_policy.role_capabilities WHERE id = 'rc_f1b_down_probe'`);
  });

  await t.test("REFUSAL WITH HISTORY: a correction, a recorded refund, an adjustment fact, a voided invoice, a direct Principal grant or an Administration decision makes the Down refuse with a named reason (rows written with triggers and FKs off, then removed)", async () => {
    const c = await pool.connect();
    const rows = [
      ["1 invoice correction(s)", `INSERT INTO eos_finance.invoice_corrections (id, tenant_id, operating_company_id, invoice_id, obligation_id, kind, amount_minor, currency, reason, requested_by, requested_by_employee_id, request_idempotency_key, request_fingerprint)
         VALUES ('icr-hist', '${TENANT}', 'taylor', 'inv-hist', 'obl-hist', 'CREDIT_MEMO', 1, 'USD', 'history', 'p-hist', 'e-hist', 'k-hist', 'fp')`, `DELETE FROM eos_finance.invoice_corrections WHERE id = 'icr-hist'`],
      ["1 recorded refund(s)", `INSERT INTO eos_finance.settlements (id, tenant_id, operating_company_id, counterparty_id, kind, direction, amount_minor, currency, business_date, source_reference, idempotency_key, request_fingerprint, recorded_by)
         VALUES ('stl-hist', '${TENANT}', 'taylor', 'cp-hist', 'CUSTOMER_REFUND', 'DISBURSEMENT', 1, 'USD', current_date, 'refund:x', 'refund:x', 'fp', 'p-hist')`, `DELETE FROM eos_finance.settlements WHERE id = 'stl-hist'`],
      ["1 receivable adjustment fact(s)",`INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, fact_class, fact_type, source_domain, source_record_id, amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, obligation_id, created_by)
         VALUES ('ff-hist', '${TENANT}', 'taylor', 'OBLIGATION', 'RECEIVABLE_CREDITED', 'INVOICE_CORRECTION', 'icr-x', -1, 'USD', 'raw', now(), 'ff-hist', 'fp', 'obl-hist', 'raw')`, `DELETE FROM eos_finance.financial_facts WHERE id = 'ff-hist'`],
      ["1 voided invoice(s)", `INSERT INTO eos_finance.invoices (id, tenant_id, operating_company_key, invoice_number, account_id, sales_order_id, currency, due_date, issued_by, voided_at, void_reason, voided_by)
         VALUES ('inv-hist', '${TENANT}', 'taylor', 'INV-0000-000001', 'a', 'so', 'USD', now(), 'p-hist', now(), 'r', 'p-hist')`, `DELETE FROM eos_finance.invoices WHERE id = 'inv-hist'`],
      ["1 direct grant(s) hold an approval capability", `INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, created_by, updated_by)
         SELECT 'pc-hist', '${TENANT}', 'p-hist', c.id, 'down-test', 'down-test', 'down-test' FROM eos_policy.capabilities c WHERE c.key = 'finance.refund.approve'`, `DELETE FROM eos_policy.principal_capabilities WHERE id = 'pc-hist'`],
      ["1 Administration decision(s) name an approval capability", `INSERT INTO eos_policy.role_capability_decisions (id, tenant_id, role_key, capability_key, decision, reason, actor_principal_id, audit_event_id)
         VALUES ('rcd-hist', '${TENANT}', 'owner', 'finance.refund.approve', 'ADMIN_GRANTED', 'history', 'p-hist', 'audit-hist')`, `DELETE FROM eos_policy.role_capability_decisions WHERE id = 'rcd-hist'`],
    ];
    try {
      await c.query("SET session_replication_role = replica");
      for (const [message, insert, remove] of rows) {
        await c.query(insert);
        let failure = null;
        try { migrate(url, "down", n); } catch (e) { failure = String(e.stderr ?? e.stdout ?? e.message); }
        assert.match(failure ?? "", new RegExp(`F1B_INVOICE_CORRECTIONS: refuses to reverse -- ${message.replace(/[()]/g, "\\$&")}`), message);
        if (n > 1) migrate(url, "up", n - 1);
        await c.query(remove);
        assert.deepEqual(await present(), UP, "a refused Down changes nothing of this migration");
      }
    } finally {
      await c.query("SET session_replication_role = DEFAULT").catch(() => undefined);
      c.release();
    }
  });

  await t.test("CLEAN: with no history the Down reverses completely, and the Up re-applies cleanly", async () => {
    migrate(url, "down", n);
    assert.deepEqual(await present(), { table: false, caps: 0, trigger: 0, viewCols: 10, kindCheck: false, voidGate: false }, "everything this migration created is gone; the view is back to ten columns; F-1a's immutability is restored");
    // F-1a's behavior is back: an issued invoice admits no change at all (the function no longer knows a void exception)
    assert.equal((await one(`SELECT prosrc LIKE '%INVOICE_IMMUTABLE%' AS g FROM pg_proc WHERE proname = 'refuse_issued_invoice_change'`)).g, true);
    migrate(url, "up", n);
    assert.deepEqual(await present(), UP, "reversible both ways");
    // and the capabilities are registered again with NO grant
    assert.equal((await one(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = ANY($1)`, [KEYS])).n, 0);
    assert.ok(admin);
  });
});
