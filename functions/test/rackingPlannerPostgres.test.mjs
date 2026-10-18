// THE WAREHOUSE RACKING PLANNER ON EOS -- against a real postgres:16 (Firebase exit B3, DECISIONS #B3; Owner rulings 5-7).
//
// It proves what the Firebase bin callables did, now on PostgreSQL, WITHOUT redesigning their atomicity: a batch is applied ONE BIN PER
// TRANSACTION and answers PER ITEM (CREATED / UNCHANGED / REFUSED) -- partial success is normal, nothing aborts the remaining work, a retry of
// the same batch is, per bin, UNCHANGED, and there is never a single "success" flag. Every created bin carries its own audit row with the
// stated reason. COMPANY ISOLATION: a warehouse (or a bin of one) outside the caller's companies reads exactly as a nonexistent one, and a
// principal with no company authority is refused before any row is read.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createWarehouseBinAdministration } = require("../lib/eosOps/warehouseBinAdministration.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const key = (wh, area, aisle, bay, position) => `binadm:v1:${wh}:${area}:${aisle}:${bay}:${position}`;
const row = (aisle, bay, position, wh = "wh-t", area = "PARTS") => ({ area, aisle, bay, position, idempotencyKey: key(wh, area, aisle, bay, position) });

test("Warehouse Racking on PostgreSQL: partial success, per-item outcomes, safe retry, company isolation", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rack_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const principal = async (subject) => repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const taylorAdmin = await principal("uid-taylor");
  const ventanaAdmin = await principal("uid-ventana");
  const noEmployee = await principal("uid-none");

  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','taylor-co','ACTIVE','NATIVE','fixture','f','f'), ('t1','ventana','ventana-co','ACTIVE','NATIVE','fixture','f','f')`);
  const warehouse = (id, key2, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,'t1',$2,$1,'Sampleton',$3,'NATIVE','fixture','fixture')`, [id, key2, status]);
  await warehouse("wh-t", "taylor-co");
  await warehouse("wh-t2", "taylor-co");
  await warehouse("wh-t-off", "taylor-co", "INACTIVE");
  await warehouse("wh-v", "ventana-co");
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-t','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('epl-t','t1',$1,'e-t','taylor','OPERATOR_ASSERTED','f','test','active'), ('epl-v','t1',$2,'e-v','ventana','OPERATOR_ASSERTED','f','test','active')`, [taylorAdmin, ventanaAdmin]);

  const admin = createWarehouseBinAdministration(pool);
  const as = (principalId) => ({ tenantId: "t1", principalId });
  const call = (op, input, who = taylorAdmin, reason = "initial racking layout") => admin(op, as(who), { ...input, ...(reason ? { reason } : {}) }, reason);
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const snapshot = async () => ({
    bins: (await q(`SELECT count(*)::int n FROM eos_ops.bins`)).rows[0].n,
    claims: (await q(`SELECT count(*)::int n FROM eos_ops.bin_code_claims`)).rows[0].n,
    audits: (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action LIKE 'bin.%'`)).rows[0].n,
  });

  // ════════════════════════════ COMPANY ISOLATION ════════════════════════════

  await t.test("a principal with no company authority is refused before any row is read", async () => {
    const before = await snapshot();
    for (const [op, input] of [["listRackingWarehouses", {}], ["listRackingBins", { warehouseId: "wh-t" }], ["previewBinCreates", { warehouseId: "wh-t", proposals: [] }],
      ["createBins", { warehouseId: "wh-t", proposals: [row("A", 1, 1)] }]]) {
      const err = await refusal(() => call(op, input, noEmployee));
      assert.equal(err.code, "COMPANY_AUTHORITY_REQUIRED", op);
      assert.equal(err.category, "FORBIDDEN");
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test("the warehouse picker lists only the caller's companies' warehouses", async () => {
    const mine = (await call("listRackingWarehouses", {}, taylorAdmin, null)).items.map((w) => w.warehouseId);
    const theirs = (await call("listRackingWarehouses", {}, ventanaAdmin, null)).items.map((w) => w.warehouseId);
    assert.deepEqual([...mine].sort(), ["wh-t", "wh-t-off", "wh-t2"]);
    assert.deepEqual(theirs, ["wh-v"]);
  });

  await t.test("a warehouse of another company reads EXACTLY as a nonexistent one, on every operation, and nothing is written", async () => {
    const before = await snapshot();
    for (const [op, input] of [["listRackingBins", { warehouseId: "wh-v" }], ["previewBinCreates", { warehouseId: "wh-v", proposals: [row("A", 1, 1, "wh-v")] }],
      ["createBins", { warehouseId: "wh-v", proposals: [row("A", 1, 1, "wh-v")] }]]) {
      const hidden = await refusal(() => call(op, input, taylorAdmin));
      const missing = await refusal(() => call(op, { ...input, warehouseId: "wh-nope" }, taylorAdmin));
      assert.deepEqual([hidden.code, hidden.category, hidden.message], [missing.code, missing.category, missing.message], op);
      assert.equal(hidden.code, "WAREHOUSE_NOT_FOUND");
    }
    assert.deepEqual(await snapshot(), before);
  });

  // ════════════════════════════ PREVIEW, BATCH CREATE, PARTIAL SUCCESS ════════════════════════════

  await t.test("preview classifies against the store and writes nothing", async () => {
    const before = await snapshot();
    const out = await call("previewBinCreates", { warehouseId: "wh-t", proposals: [row("A", 1, 1), row("A", 1, 3), { ...row("A", 1, 5), aisle: "ZZZ" }] }, taylorAdmin, null);
    assert.deepEqual(out.rows.map((r) => [r.classification, r.code ?? null]), [["NEW", "A01-001"], ["NEW", "A01-003"], ["INVALID", null]]);
    assert.equal(out.rows[2].reason, "aisle_invalid");
    assert.equal(out.rows.every((r) => !("value" in r)), true, "the internal value never leaves the server");
    assert.deepEqual(out.summary, { NEW: 2, INVALID: 1 });
    assert.equal(out.warehouseStatus, "ACTIVE");
    assert.deepEqual(await snapshot(), before);
    const tooMany = await refusal(() => call("previewBinCreates", { warehouseId: "wh-t", proposals: Array.from({ length: 251 }, (_, i) => row("A", 1, i * 2 + 1)) }, taylorAdmin, null));
    assert.equal(tooMany.code, "TOO_MANY_PROPOSALS", "never silently truncated");
  });

  await t.test("a reason is REQUIRED for every mutation", async () => {
    const before = await snapshot();
    const err = await refusal(() => call("createBins", { warehouseId: "wh-t", proposals: [row("A", 1, 1)] }, taylorAdmin, null));
    assert.equal(err.code, "REASON_REQUIRED");
    assert.deepEqual(await snapshot(), before);
  });

  await t.test("PARTIAL SUCCESS: good bins commit, refused ones are named, nothing aborts the rest, and there is no single success flag", async () => {
    // Another bin already occupies A/2/1 under a DIFFERENT idempotency key (the WarehouseMasters key scheme).
    const taken = await call("createBin", { warehouseId: "wh-t", area: "PARTS", aisle: "A", bay: 2, position: 1, idempotencyKey: "bin-wh-t-PARTS-A-2-1" }, taylorAdmin, "added by hand before the planner");
    assert.equal(taken.code, "A02-001");
    const proposals = [row("A", 1, 1), { ...row("A", 1, 3), aisle: "ZZZ" }, row("A", 1, 5), row("A", 1, 5), row("A", 2, 1), row("A", 2, 3)];
    const out = await call("createBins", { warehouseId: "wh-t", proposals });
    assert.deepEqual(out.items.map((i) => [i.index, i.outcome, i.classification, i.reason]), [
      [0, "CREATED", "NEW", null],
      [1, "REFUSED", "INVALID", "aisle_invalid"],
      [2, "CREATED", "NEW", null],
      [3, "REFUSED", "INVALID", "duplicate_in_request"],
      [4, "REFUSED", "POSITION_TAKEN", "position_taken_by_another_bin"],
      [5, "CREATED", "NEW", null],
    ]);
    assert.deepEqual([out.requested, out.created, out.unchanged, out.refused, out.complete], [6, 3, 0, 3, false]);
    // Each created bin and its HELD claim exist, each with its own audit row carrying the stated reason.
    const bins = await q(`SELECT code, status::text AS status FROM eos_ops.bins WHERE warehouse_id = 'wh-t' ORDER BY code`);
    assert.deepEqual(bins.rows.map((b) => b.code), ["A01-001", "A01-005", "A02-001", "A02-003"]);
    const claims = await q(`SELECT code, claim_state::text AS s FROM eos_ops.bin_code_claims WHERE warehouse_id = 'wh-t' ORDER BY code`);
    assert.deepEqual(claims.rows.map((c) => [c.code, c.s]), [["A01-001", "HELD"], ["A01-005", "HELD"], ["A02-001", "HELD"], ["A02-003", "HELD"]]);
    const audits = await q(`SELECT reason, target_id FROM eos_policy.audit_events WHERE action = 'bin.created' AND reason = 'initial racking layout'`);
    assert.equal(audits.rows.length, 3);
  });

  await t.test("SAFE RETRY: the same batch again creates nothing and writes no audit; the refused stay refused with the same reasons", async () => {
    const before = await snapshot();
    const proposals = [row("A", 1, 1), { ...row("A", 1, 3), aisle: "ZZZ" }, row("A", 1, 5), row("A", 1, 5), row("A", 2, 1), row("A", 2, 3)];
    const out = await call("createBins", { warehouseId: "wh-t", proposals });
    assert.deepEqual(out.items.map((i) => i.outcome), ["UNCHANGED", "REFUSED", "UNCHANGED", "REFUSED", "REFUSED", "UNCHANGED"]);
    assert.deepEqual([out.created, out.unchanged, out.refused], [0, 3, 3]);
    assert.deepEqual(await snapshot(), before, "a retry is exact per bin: no new bin, claim or audit");
    const preview = await call("previewBinCreates", { warehouseId: "wh-t", proposals: [row("A", 1, 1), row("A", 2, 1)] }, taylorAdmin, null);
    assert.deepEqual(preview.rows.map((r) => r.classification), ["ALREADY_EXISTS", "POSITION_TAKEN"]);
  });

  await t.test("a code once claimed stays reserved: after a relabel the old code is CODE_RESERVED, never reissued", async () => {
    const list = await call("listRackingBins", { warehouseId: "wh-t" }, taylorAdmin, null);
    const bin = list.items.find((b) => b.code === "A01-005");
    // Move the bin to a new rack position through the existing governed relabel; its old code claim becomes SUPERSEDED, permanently.
    await call("relabelBin", { binId: bin.binId, area: "PARTS", aisle: "B", bay: 1, position: 5 });
    // The SAME key now names a bin that has moved: the stored record disagrees with the request, and nothing is repaired.
    const same = await call("previewBinCreates", { warehouseId: "wh-t", proposals: [row("A", 1, 5)] }, taylorAdmin, null);
    assert.deepEqual([same.rows[0].classification, same.rows[0].reason], ["INTEGRITY_ERROR", "bin_disagrees_with_request"]);
    // A DIFFERENT key for the vacated position finds the position free but the code still claimed: reserved, forever.
    const other = { ...row("A", 1, 5), idempotencyKey: `${key("wh-t", "PARTS", "A", 1, 5)}:alt` };
    const out = await call("previewBinCreates", { warehouseId: "wh-t", proposals: [other] }, taylorAdmin, null);
    assert.deepEqual([out.rows[0].classification, out.rows[0].reason], ["CODE_RESERVED", "code_reserved_by_another_bin"]);
    const created = await call("createBins", { warehouseId: "wh-t", proposals: [other, row("A", 1, 5)] }); // (the second is the same rack position and code: duplicate_in_request)
    assert.deepEqual([created.created, created.items.map((i) => i.classification)], [0, ["CODE_RESERVED", "INVALID"]]);
  });

  await t.test("an INACTIVE warehouse accepts no bins (the whole request is refused, nothing written)", async () => {
    const before = await snapshot();
    const err = await refusal(() => call("createBins", { warehouseId: "wh-t-off", proposals: [row("A", 1, 1, "wh-t-off")] }));
    assert.equal(err.code, "WAREHOUSE_NOT_ACTIVE");
    assert.deepEqual(await snapshot(), before);
  });

  await t.test("the same position in two warehouses is two bins (codes are warehouse-scoped)", async () => {
    const out = await call("createBins", { warehouseId: "wh-t2", proposals: [row("A", 1, 1, "wh-t2")] });
    assert.deepEqual([out.created, out.items[0].code], [1, "A01-001"]);
  });

  // ════════════════════════════ RENAME AND STATUS ════════════════════════════

  await t.test("a NAME edit keeps the bin's code and claim; an unchanged name is changed:false with no audit", async () => {
    const bin = (await call("listRackingBins", { warehouseId: "wh-t" }, taylorAdmin, null)).items.find((b) => b.code === "A01-001");
    const auditsBefore = (await snapshot()).audits;
    const renamed = await call("renameRackingBin", { binId: bin.binId, name: "Fast movers" });
    assert.deepEqual([renamed.changed, renamed.code, renamed.name, renamed.binId], [true, "A01-001", "Fast movers", bin.binId]);
    assert.equal((await snapshot()).audits, auditsBefore + 1);
    const claim = await q(`SELECT claim_state::text AS s FROM eos_ops.bin_code_claims WHERE warehouse_id = 'wh-t' AND code = 'A01-001'`);
    assert.deepEqual(claim.rows.map((c) => c.s), ["HELD"]);
    const again = await call("renameRackingBin", { binId: bin.binId, name: "Fast movers" });
    assert.equal(again.changed, false);
    assert.equal((await snapshot()).audits, auditsBefore + 1, "no change, no audit row");
    const cleared = await call("renameRackingBin", { binId: bin.binId, name: null });
    assert.deepEqual([cleared.changed, cleared.name], [true, null]);
  });

  await t.test("deactivate and reactivate; a bin of another company reads as nonexistent", async () => {
    const bin = (await call("listRackingBins", { warehouseId: "wh-t" }, taylorAdmin, null)).items.find((b) => b.code === "A02-003");
    const off = await call("setRackingBinStatus", { binId: bin.binId, status: "INACTIVE" });
    assert.deepEqual([off.changed, off.status], [true, "INACTIVE"]);
    assert.equal((await call("setRackingBinStatus", { binId: bin.binId, status: "INACTIVE" })).changed, false);
    const on = await call("setRackingBinStatus", { binId: bin.binId, status: "ACTIVE" });
    assert.deepEqual([on.changed, on.status], [true, "ACTIVE"]);
    for (const [op, input] of [["setRackingBinStatus", { binId: bin.binId, status: "INACTIVE" }], ["renameRackingBin", { binId: bin.binId, name: "x" }]]) {
      const hidden = await refusal(() => call(op, input, ventanaAdmin));
      assert.equal(hidden.code, "BIN_NOT_FOUND");
    }
    assert.equal((await q(`SELECT status::text AS s FROM eos_ops.bins WHERE id = $1`, [bin.binId])).rows[0].s, "ACTIVE");
    // R2: the company filter is in the WHERE, so a foreign-company bin is never row-locked: while another session holds the Taylor bin FOR UPDATE,
    // the Ventana admin's refusal returns at once (BIN_NOT_FOUND) instead of queueing behind it.
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM eos_ops.bins WHERE tenant_id = 't1' AND id = $1 FOR UPDATE", [bin.binId]);
      const timer = new Promise((resolve) => setTimeout(() => resolve("BLOCKED"), 4000));
      const out = await Promise.race([refusal(() => call("renameRackingBin", { binId: bin.binId, name: "y" }, ventanaAdmin)), timer]);
      assert.notEqual(out, "BLOCKED", "a foreign-company caller must not wait on a bin row lock");
      assert.equal(out.code, "BIN_NOT_FOUND");
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });
});
