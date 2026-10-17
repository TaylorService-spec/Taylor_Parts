// GRANT-IMPACT PREVIEW (PR 3, advisory) -- NEVER COMMIT, NO SIDE EFFECTS, BOUNDED, AND A CATALOG THAT KEEPS IT TRUE.
//
//   1. statement log      the engine's last statement is ROLLBACK and no COMMIT ever reaches the server; every statement
//                          the command or the resolver sent is a plain row statement; savepoints balance
//   2. database fence     a transaction carrying eos_policy.preview = 'on' can never COMMIT a governed row
//   3. deferred fidelity  a change whose REAL commit fails on a DEFERRED constraint is WOULD_REFUSE, never WOULD_APPLY
//   4. shim refusals      COMMIT / NOTIFY / LISTEN / sequences / session locks / session settings / the fence marker
//   5. faults             a throw after writes, a backend killed mid-preview: nothing survives
//   6. bounded            PREVIEW_BUSY on the governance lock, on a statement timeout, at the concurrency cap, and on
//                          a state that keeps moving; no advisory lock outlives the preview
//   7. no external call   runtime spies on fetch / timers / console; a LISTENing session receives nothing
//   8. catalog purity     the written tables' triggers (incl. the fence), trigger function bodies, deferrable
//                          constraints, sequences, rules, event triggers, publications and FK actions are pinned
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import pg from "pg";
import { buildPreviewWorld, privateDatabase, tableHashes } from "./support/authorityPreviewFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const require = createRequire(import.meta.url);
const { createAuthorityChangePreview, PreviewSafetyViolation } = require("../lib/eosOps/authorityChangePreview.js");
const commands = require("../lib/adminPolicy/policyCommands.js");

const ADMIN = "gip-admin-a";
const WRITTEN_TABLES = ["audit_events", "capability_grant_conditions", "principal_access_versions", "principal_capabilities",
  "role_capabilities", "role_capability_decisions", "user_role_assignments"];

test("GRANT-IMPACT PREVIEW: never commits, leaves no trace, calls nothing external", { skip: SKIP, concurrency: 1 }, async (t) => {
  const db = await privateDatabase(URL_BASE, "gip_safety");
  let world;
  const extraPools = [];
  t.after(async () => {
    for (const p of extraPools) await endPoolAndDrain(p);
    await endPoolAndDrain(world?.pool);
    await db.drop();
  });
  world = await buildPreviewWorld(db.url);
  const { q, pool, repo, call, T, P } = world;
  const A = T.a;
  const sidePool = new pg.Pool({ connectionString: db.url, max: 4, idleTimeoutMillis: 0 });
  extraPools.push(sidePool);
  const adminActor = { tenantId: A, uid: P.a.admin, heldRoleKeys: ["admin"], protectedAdministrator: true };
  const request = (run, extra = {}) => ({ actor: adminActor, operation: "grantObjectActionToRole", input: {}, subject: null, detail: true, run, ...extra });
  const grantInput = { objectKey: "workOrder", actionKey: "dispatch", roleKey: "partsManager", reason: "safety proof" };

  await t.test("1. STATEMENT LOG: ends in ROLLBACK, no COMMIT reaches the server, command statements are row statements", async () => {
    world.statements.length = 0;
    const r = await call(ADMIN, "previewAuthorityChange", { change: { operation: "applyObjectWideRoleAuthority",
      input: { objectKey: "supplierCatalogItem", roleKey: "purchasingManager", mode: "GRANT", reason: "log proof" } } });
    assert.equal(r.data.outcome, "WOULD_APPLY");
    assert.equal(world.statements.length, 1, "one attempt");
    const log = world.statements[0];
    assert.match(log[0].text, /^BEGIN ISOLATION LEVEL READ COMMITTED$/);
    assert.equal(log[log.length - 1].text, "ROLLBACK");
    assert.equal(log[log.length - 1].origin, "engine");
    assert.equal(log.filter((s) => /^\s*(COMMIT|END|PREPARE)\b/i.test(s.text)).length, 0, "a COMMIT reached the server");
    for (const s of log.filter((x) => x.origin === "command")) assert.match(s.text, /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i);
    const opened = log.filter((s) => /^SAVEPOINT preview_sim_/.test(s.text)).length;
    const closed = log.filter((s) => /^RELEASE SAVEPOINT preview_sim_/.test(s.text)).length;
    const transacted = r.data.perAction.filter((a) => a.outcome !== "ALREADY_HELD").length;
    assert.ok(transacted >= 5, JSON.stringify(r.data.perAction));
    assert.equal(opened, transacted, "one savepoint per object-wide action that opened a transaction");
    assert.equal(opened, closed, "every simulated transaction ended");
    assert.ok(log.some((s) => /^SET CONSTRAINTS .*role_capability_decisions.* IMMEDIATE$/.test(s.text)), "deferred constraints forced at the simulated commit point");
    assert.equal(log.some((s) => /SET CONSTRAINTS ALL/i.test(s.text) || /SET CONSTRAINTS .*preview_never_commits/.test(s.text)), false,
      "the fence must never be armed by the simulation");
    // Each constraint is restored to its ORIGINAL deferral, read from the catalog (condeferred), not a blanket DEFERRED.
    const initiallyDeferred = (await q(`SELECT format('%I.%I', n.nspname, c.conname) AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE c.condeferrable AND c.condeferred AND n.nspname IN ('eos_policy', 'eos_workforce') AND c.conname <> 'preview_never_commits' ORDER BY 1`)).rows
      .map((r) => r.name.split(".").map((x) => `"${x.replace(/^"|"$/g, "")}"`).join("."));
    const restores = log.filter((s) => / DEFERRED$/.test(s.text) && /^SET CONSTRAINTS /.test(s.text));
    assert.ok(restores.length > 0);
    for (const s of restores) assert.equal(s.text, `SET CONSTRAINTS ${initiallyDeferred.join(", ")} DEFERRED`);
    // COST: tenant-wide reads are made once per snapshot side (memoized), not once per member.
    const members = (await repo.listTenantPrincipalIds(A)).length;
    const perMemberSide = log.length / (members * 2);
    assert.ok(perMemberSide < 40, `${log.length} statements for ${members} members x 2 sides = ${perMemberSide.toFixed(1)} per member-side`);
    const { rows } = await q(`SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    assert.equal(rows[0].n, 0, "an advisory lock outlived the preview");
  });

  await t.test("2. DATABASE FENCE: a transaction marked as a preview can never commit a governed row", async () => {
    const insertAudit = (c, id) => c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
      VALUES ($1, $2, 'fenceProof', 'fixture', 'fence', 'f', NULL, NULL, now(), 'fence proof')`, [id, A]);
    const c = await sidePool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('eos_policy.preview', 'on', true)`);
      await insertAudit(c, "fence-preview");
      await assert.rejects(c.query("COMMIT"), /PREVIEW_COMMIT_REFUSED/);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE id = 'fence-preview'`)).rows[0].n, 0);
      // Unmarked, the same write commits: the fence costs an ordinary writer nothing.
      await c.query("BEGIN");
      await insertAudit(c, "fence-ordinary");
      await c.query("COMMIT");
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE id = 'fence-ordinary'`)).rows[0].n, 1);
    } finally { c.release(); }
  });

  // A TEST-ONLY "command": two CURRENT decisions for one cell. Accepted while the exclusion constraint is deferred;
  // refused by a real COMMIT. Uses the repository's own connection path (connect/BEGIN/COMMIT), like repo.transact.
  const twoCurrentDecisions = (tag) => async (repoLike) => {
    const c = await repoLike.pool.connect();
    await c.query("BEGIN");
    try {
      await c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, occurred_at, reason)
        VALUES ($1, $2, 'deferredProof', 'fixture', 'decision', 'd', now(), 'deferred proof')`, [`ae-${tag}`, A]);
      for (const n of [1, 2]) {
        await c.query(`INSERT INTO eos_policy.role_capability_decisions (id, tenant_id, role_key, capability_key, decision, requires_condition, reason, actor_principal_id, audit_event_id)
          VALUES ($1, $2, 'partsManager', 'workOrder.lifecycle.dispatch', 'ADMIN_GRANTED', false, 'deferred proof', 'fixture', $3)`, [`dec-${tag}-${n}`, A, `ae-${tag}`]);
      }
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    } finally { c.release(); }
  };

  await t.test("3. DEFERRED FIDELITY: a change whose real COMMIT fails is WOULD_REFUSE, never WOULD_APPLY", async () => {
    const hashes = await tableHashes(q);
    const result = await world.simulator(request(twoCurrentDecisions("sim")));
    assert.equal(result.outcome, "WOULD_REFUSE");
    assert.equal(result.error.code, "23P01", "the one-current-decision exclusion, checked at the simulated commit point");
    assert.deepEqual(await tableHashes(q), hashes);
    // The same "command" against a REAL transaction: the COMMIT is what fails.
    await assert.rejects(twoCurrentDecisions("real")({ pool: sidePool }), (err) => err.code === "23P01");
    // ...and through the API the refusal is the one a commit would return.
    const r = await world.simulator(request(async (simRepo) => {
      await commands.grantObjectActionToRole(simRepo, adminActor, grantInput);
      await twoCurrentDecisions("api")(simRepo);
    }));
    assert.equal(r.outcome, "WOULD_REFUSE");
  });

  await t.test("4. SHIM: statements a rollback cannot undo are refused and abort the preview", async () => {
    const hashes = await tableHashes(q);
    for (const sql of ["COMMIT", "NOTIFY eos_policy_changed", "LISTEN eos_policy_changed", "SELECT pg_notify('x', 'y')",
      "SELECT nextval('some_sequence')", "SELECT pg_advisory_lock(1)", "SELECT pg_advisory_unlock_all()",
      "SELECT set_config('eos_policy.preview', 'off', true)", "SELECT set_config('statement_timeout', '0', false)",
      "SET SESSION statement_timeout = 0", "BEGIN", "SAVEPOINT x", "ROLLBACK", "TRUNCATE eos_policy.audit_events",
      "CREATE TABLE eos_policy.x (a int)", "DO $$ BEGIN END $$", "COPY eos_policy.roles TO STDOUT"]) {
      await assert.rejects(world.simulator(request(async (simRepo) => { await simRepo.pool.query(sql); })),
        (err) => err instanceof PreviewSafetyViolation, sql);
    }
    // A violation the "command" swallows still aborts the preview (object-wide authority catches per-action errors).
    await assert.rejects(world.simulator(request(async (simRepo) => {
      try { await simRepo.pool.query("NOTIFY x"); } catch { /* swallowed */ }
      return "pretend success";
    })), (err) => err instanceof PreviewSafetyViolation);
    assert.deepEqual(await tableHashes(q), hashes);
  });

  await t.test("5. FAULTS: a throw after writes, and a backend killed mid-preview, leave nothing behind", async () => {
    const hashes = await tableHashes(q);
    const thrown = await world.simulator(request(async (simRepo) => {
      await commands.grantObjectActionToRole(simRepo, adminActor, grantInput);
      throw new Error("injected fault after the command wrote");
    }));
    assert.equal(thrown.outcome, "WOULD_REFUSE");
    assert.deepEqual(await tableHashes(q), hashes);
    await assert.rejects(world.simulator(request(async (simRepo) => {
      await commands.grantObjectActionToRole(simRepo, adminActor, grantInput);
      const { rows } = await simRepo.pool.query("SELECT pg_backend_pid() AS pid");
      await sidePool.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
      await simRepo.pool.query("SELECT 1");
    })));
    assert.deepEqual(await tableHashes(q), hashes, "a killed preview committed something");
    // The pool is still usable (the dead client was destroyed, not returned).
    assert.equal((await call(ADMIN, "previewAuthorityChange", { change: { operation: "grantObjectActionToRole", input: grantInput } })).data.outcome, "WOULD_APPLY");
  });

  await t.test("6. BOUNDED: PREVIEW_BUSY on the governance lock, a statement timeout, the concurrency cap, a moving state", async () => {
    const holder = await sidePool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [A]);
      const quick = createAuthorityChangePreview({ pool, lockTimeoutMs: 150 });
      const busy = await quick(request(async () => null));
      assert.deepEqual([busy.outcome, busy.busy.reason], ["PREVIEW_BUSY", "LOCK_TIMEOUT"]);
      // The cap: one preview waiting on the lock, a second one is refused at once.
      const capped = createAuthorityChangePreview({ pool, lockTimeoutMs: 10_000, maxConcurrent: 1 });
      const waiting = capped(request(async (simRepo) => commands.grantObjectActionToRole(simRepo, adminActor, grantInput)));
      const refused = await capped(request(async () => null));
      assert.deepEqual([refused.outcome, refused.busy.reason], ["PREVIEW_BUSY", "CONCURRENCY"]);
      await holder.query("COMMIT");
      assert.equal((await waiting).outcome, "WOULD_APPLY", "the waiting preview completes once the lock is free");
    } finally { holder.release(); }
    const slow = createAuthorityChangePreview({ pool, statementTimeoutMs: 100 });
    const timedOut = await slow(request(async (simRepo) => simRepo.pool.query("SELECT pg_sleep(2)")));
    assert.deepEqual([timedOut.outcome, timedOut.busy.reason], ["PREVIEW_BUSY", "STATEMENT_TIMEOUT"]);
    // A non-Administration writer (employment status) is not blocked by the governance lock: a preview whose state
    // keeps moving is retried once, then reported UNSTABLE -- never a report about a state that no longer exists.
    let flips = 0;
    const moving = await world.simulator(request(async () => {
      flips += 1;
      await sidePool.query(`UPDATE eos_workforce.employees SET employment_status = $1 WHERE id = 'emp-gip-inel'`, [flips % 2 ? "ACTIVE" : "TERMINATED"]);
    }));
    assert.deepEqual([moving.outcome, moving.busy.reason, flips], ["PREVIEW_BUSY", "UNSTABLE", 2]);
    const status = async () => (await q(`SELECT employment_status::text s FROM eos_workforce.employees WHERE id = 'emp-gip-inel'`)).rows[0].s;
    const start = await status();
    let once = 0;
    const settles = await world.simulator(request(async () => {
      once += 1;
      if (once === 1) await sidePool.query(`UPDATE eos_workforce.employees SET employment_status = $1 WHERE id = 'emp-gip-inel'`, [start === "ACTIVE" ? "TERMINATED" : "ACTIVE"]);
    }));
    assert.deepEqual([settles.outcome, once], ["NO_OP", 2], "retried once on a fresh state, then reported");
    assert.equal((await q(`SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`)).rows[0].n, 0);
  });

  await t.test("6b. TIME BUDGET: a slow preview cannot hold the governance lock beyond its budget, and a real commit waits at most that long", async () => {
    const BUDGET = 1500;
    const budgeted = createAuthorityChangePreview({ pool, budgetMs: BUDGET, statementTimeoutMs: 5_000 });
    let inside;
    const entered = new Promise((resolve) => { inside = resolve; });
    const started = Date.now();
    const slow = budgeted(request(async (simRepo) => {
      inside();
      for (let i = 0; i < 100; i += 1) await simRepo.pool.query("SELECT pg_sleep(0.05)");
    }));
    await entered; // the preview now holds the tenant governance lock
    const commitStarted = Date.now();
    const real = await call(ADMIN, "grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "shopManager", reason: "budget proof" });
    const commitWaited = Date.now() - commitStarted;
    const result = await slow;
    const held = Date.now() - started;
    assert.deepEqual([result.outcome, result.busy.reason], ["PREVIEW_BUSY", "BUDGET"]);
    assert.equal(real.ok, true, JSON.stringify(real));
    assert.ok(held < BUDGET + 1_000, `the preview ran ${held}ms on a ${BUDGET}ms budget`);
    assert.ok(commitWaited < BUDGET + 1_000, `a real commit waited ${commitWaited}ms behind a ${BUDGET}ms preview`);
    // The lock is free the moment the preview answered.
    const c = await sidePool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '100ms'");
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [A]);
      await c.query("ROLLBACK");
    } finally { c.release(); }
    // A single long statement is cut at the deadline too (statement_timeout lowered inside the last window).
    const t0 = Date.now();
    const oneLong = await budgeted(request(async (simRepo) => simRepo.pool.query("SELECT pg_sleep(30)")));
    assert.deepEqual([oneLong.outcome, oneLong.busy.reason], ["PREVIEW_BUSY", "BUDGET"]);
    assert.ok(Date.now() - t0 < BUDGET + 1_000, `one statement held the preview ${Date.now() - t0}ms`);
  });

  await t.test("6c. ROWS, not statements: a 0-row UPDATE is NO_OP; a real write is WOULD_APPLY", async () => {
    const none = await world.simulator(request(async (simRepo) => {
      const c = await simRepo.pool.connect();
      await c.query("BEGIN");
      await c.query("UPDATE eos_policy.user_role_assignments SET status = 'disabled' WHERE tenant_id = $1 AND id = 'no-such-assignment'", [A]);
      await c.query("COMMIT");
      c.release();
    }));
    assert.equal(none.outcome, "NO_OP");
    const some = await world.simulator(request(async (simRepo) => commands.grantObjectActionToRole(simRepo, adminActor, grantInput)));
    assert.equal(some.outcome, "WOULD_APPLY");
  });

  await t.test("7. NO EXTERNAL CALL: no fetch, no timer, no console, nothing NOTIFYed during a preview", async () => {
    const listener = await sidePool.connect();
    const heard = [];
    listener.on("notification", (n) => heard.push(n));
    for (const channel of ["eos_policy", "policy_changed", "admin_policy", "authority_change"]) await listener.query(`LISTEN ${channel}`);
    // Warm the pool so no connection is opened inside the spied window.
    await call(ADMIN, "previewAuthorityChange", { change: { operation: "grantObjectActionToRole", input: grantInput } });
    const calls = [];
    const saved = {};
    const spy = (obj, name) => { saved[name] = obj[name]; obj[name] = (...args) => { calls.push(name); return saved[name].apply(obj, args); }; };
    const consoleNames = ["log", "info", "warn", "error", "debug"];
    const savedConsole = Object.fromEntries(consoleNames.map((n) => [n, console[n]]));
    for (const n of consoleNames) console[n] = (...a) => { calls.push(`console.${n}`); return savedConsole[n](...a); };
    for (const name of ["fetch", "setTimeout", "setInterval", "setImmediate", "queueMicrotask"]) if (typeof globalThis[name] === "function") spy(globalThis, name);
    let report;
    try {
      report = await call(ADMIN, "previewAuthorityChange", { change: { operation: "assignRole",
        input: { principalId: P.a.plain2, roleId: (await repo.getRoleByKey(A, "dispatcher")).id, reason: "spy" } } });
    } finally {
      for (const [name, fn] of Object.entries(saved)) globalThis[name] = fn;
      for (const n of consoleNames) console[n] = savedConsole[n];
    }
    assert.equal(report.data.outcome, "WOULD_APPLY");
    assert.deepEqual(calls, [], `external effects during a preview: ${calls.join(", ")}`);
    await listener.query("SELECT 1");
    assert.deepEqual(heard, []);
    listener.release();
  });

  await t.test("8. CATALOG PURITY: the written tables carry exactly the pinned triggers, constraints and nothing else", async () => {
    const triggers = (await q(`SELECT c.relname || '|' || t.tgname || '|' || p.proname || '|' || md5(p.prosrc) AS x
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE n.nspname = 'eos_policy' AND NOT t.tgisinternal AND c.relname = ANY($1) ORDER BY 1`, [WRITTEN_TABLES])).rows.map((r) => r.x);
    // 9 behavioural triggers (raise-or-lock only; none writes another table) + the 7 never-commit fence triggers
    // (migration 1764540000000). A NEW trigger, or a changed body, fails here and forces a side-effect census review.
    assert.deepEqual(triggers, [
      "audit_events|audit_events_append_only|audit_events_append_only|6074f29e61031cc64c4c2ee4886d2c05",
      "audit_events|audit_events_no_truncate|governed_history_no_truncate|52d8e374407d5698dc8781b124d2679c",
      "audit_events|preview_never_commits|authority_preview_never_commits|13e6cee9d4d1aacbc65b8581adc83b7a",
      "capability_grant_conditions|capability_grant_conditions_never_widen|capability_grant_conditions_never_widen|7a3c11a23b1b9ebb63433a04b0b0c183",
      "capability_grant_conditions|capability_grant_conditions_no_truncate|governed_history_no_truncate|52d8e374407d5698dc8781b124d2679c",
      "capability_grant_conditions|preview_never_commits|authority_preview_never_commits|13e6cee9d4d1aacbc65b8581adc83b7a",
      "principal_access_versions|preview_never_commits|authority_preview_never_commits|13e6cee9d4d1aacbc65b8581adc83b7a",
      "principal_capabilities|preview_never_commits|authority_preview_never_commits|13e6cee9d4d1aacbc65b8581adc83b7a",
      "principal_capabilities|principal_capabilities_cell_lock|principal_capabilities_cell_lock|4dc2fab29234a6b7bef528c0ffa4e0ef",
      "role_capabilities|preview_never_commits|authority_preview_never_commits|13e6cee9d4d1aacbc65b8581adc83b7a",
      "role_capabilities|role_capabilities_honour_decisions|role_capabilities_honour_decisions|65a8b3f19e87de3edaa7bd126668a3c1",
      "role_capability_decisions|preview_never_commits|authority_preview_never_commits|13e6cee9d4d1aacbc65b8581adc83b7a",
      "role_capability_decisions|role_capability_decisions_append_only|role_capability_decisions_append_only|5cbe15d2240b51a463506dc11ebe90de",
      "role_capability_decisions|role_capability_decisions_no_truncate|governed_history_no_truncate|52d8e374407d5698dc8781b124d2679c",
      "user_role_assignments|preview_never_commits|authority_preview_never_commits|13e6cee9d4d1aacbc65b8581adc83b7a",
      "user_role_assignments|user_role_assignments_sales_channel_active|user_role_assignments_sales_channel_active|3aba36c080902d59ba0e3d408c5c0962",
    ]);
    // Every fence trigger is a DEFERRED constraint trigger gated on the preview marker.
    const fence = (await q(`SELECT c.relname, t.tgdeferrable, t.tginitdeferred, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = 'preview_never_commits' ORDER BY 1`)).rows;
    assert.deepEqual(fence.map((r) => r.relname), WRITTEN_TABLES);
    for (const r of fence) {
      assert.equal(r.tgdeferrable && r.tginitdeferred, true, r.relname);
      assert.match(r.def, /AFTER INSERT OR DELETE OR UPDATE .* DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN \(\(COALESCE\(current_setting\('eos_policy\.preview'::text, true\), ''::text\) = 'on'::text\)\)/);
    }
    const deferrable = (await q(`SELECT DISTINCT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE c.condeferrable AND n.nspname IN ('eos_policy', 'eos_workforce') ORDER BY 1`)).rows.map((r) => r.conname);
    assert.deepEqual(deferrable, ["preview_never_commits", "role_capability_decisions_tenant_id_role_key_capability_ke_excl",
      "role_capability_decisions_tenant_id_superseded_by_fkey"]);
    const sequences = (await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'eos_policy' AND table_name = ANY($1)
        AND (column_default LIKE 'nextval%' OR is_identity = 'YES')`, [WRITTEN_TABLES])).rows;
    assert.deepEqual(sequences, []);
    assert.equal((await q(`SELECT count(*)::int n FROM pg_sequences WHERE schemaname = 'eos_policy'`)).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM pg_event_trigger`)).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM pg_rules WHERE schemaname = 'eos_policy'`)).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM pg_publication`)).rows[0].n, 0);
    const cascades = (await q(`SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype = 'f' AND n.nspname = 'eos_policy' AND t.relname = ANY($1) AND (c.confdeltype <> 'a' OR c.confupdtype <> 'a')`, [WRITTEN_TABLES])).rows;
    assert.deepEqual(cascades, []);
    const notifiers = (await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('eos_policy', 'eos_workforce') AND p.prosrc ~* '(pg_notify|\\mNOTIFY\\M|dblink|http_)'`)).rows;
    assert.deepEqual(notifiers, []);
  });
});
