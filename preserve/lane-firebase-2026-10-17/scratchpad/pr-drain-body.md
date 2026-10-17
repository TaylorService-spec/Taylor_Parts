Issued: 2026-10-17 (America/Phoenix) · base main `bd77a454` (#2120 merged), with main `29114359` merged in · approved by the controller as a separate, test-only follow-up to #2120

**Test-only. The controller merges.** Lane D review is requested on the exact head.

## Why
#2120 proved that `pg-pool` 3.x resolves `pool.end()` before its sockets close. A forced `DROP DATABASE … WITH (FORCE)` issued right afterwards can terminate a backend that is still ending, and that surfaces 57P01 "terminating connection due to administrator command" as an `uncaughtException`. #2120 fixed one file. **150 other test and support files share the same teardown.**

## What
- **New `functions/test/support/poolTeardown.mjs`:** `endPoolAndDrain(pool)`.
  - It ends the pool, then waits for one `remove` event per client. pg-pool emits `remove` from `client.end`'s callback, once the socket has closed.
  - It is bounded: past 15 s it **fails loudly**, with a count of the clients still open, rather than hanging a CI job.
  - It is a no-op for a missing pool or one already ending.
- **Every test and support file that ends a `pg.Pool`** now tears down through it: 151 files, 169 call sites, mechanical. That includes `support/workOrderTechniciansCompanySuite.mjs`, new on main from #2126.
  - `await pool?.end();`, `await pool.end();`, `await racePool.end();`, `() => pool?.end()` and `await world?.pool.end();` become `endPoolAndDrain(…)`.
  - Each file gets one import.
- **#2120's hand-rolled drain** in `assignmentScopeRuntimePostgres` is replaced by the helper.
- **One deliberate exception:** `crmAuthorityPostgres` subtest (12) keeps `await pool.end()` **inside its subprocess script**. That script runs in a separate `node -e` process, where the helper does not exist.

No assertion, fixture, timing or production source changes.

## Evidence
- **Helper probe** on a private PostgreSQL 16 (a 16-client pool, teardown, count `pg_stat_activity`, forced DROP) over 40 runs: **0** runs left backends attached, and there were **0** 57P01 errors. By comparison, `end()` alone left backends attached in 3 of 20 runs and produced one unhandled 57P01 (#2120).

## Verification (WSL Ubuntu-24.04, private PostgreSQL 16 on 127.0.0.1:55507, database `fbx_gate`; never the shared :55432)
- **`npm run test:adminPolicyPostgres`** (covers 115 of the changed files), first full run at `f80a641f`: **2394 tests, 2390 pass, 3 fail, 1 skipped**. All 3 failures were the two codemod mistakes below, and both are fixed. Per the Owner's resource directive, the full suite is **not re-run locally on the final head; remote CI is the gate**.
- **The other 31 changed Postgres files, run alone:** 29 pass. 2 fail **identically on main `bd77a454` with the files unchanged**, so the failures pre-date this PR:
  - `coordinatedVisitObjectRehome`: it expects 40 governed-seed Objects, and the seed now has 49.
  - `manufacturerRuntimeAuthorityPostgres` (`test:manufacturerAuthorityPostgres`): it pins a "newest migration" that main has since passed.
  - **Neither file is run by any CI workflow**, which is why the drift went unnoticed. Reported to the controller as findings; not fixed here.
- **The two files this PR first got wrong:**
  - The #2120 file: the import was skipped because a comment mentioned the module.
  - The `crmAuthority` subprocess script.
  - Both were fixed and re-run 5/5 each.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
