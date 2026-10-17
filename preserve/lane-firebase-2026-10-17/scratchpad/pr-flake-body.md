Issued: 2026-10-17 (America/Phoenix) · base main `ef199c11` · assigned by the EOS controller (CI flake in "Admin policy engine")

**Test-only. The controller merges.** Lane D review is requested on the exact head.

## Symptom
`functions/test/assignmentScopeRuntimePostgres.test.mjs:368`, the "concurrency: revoke / re-assign a scoped assignment while reads evaluate" subtest, intermittently reports:

> generated asynchronous activity after the test ended … error: terminating connection due to administrator command

That error arrives as an `uncaughtException`, so the file fails. It hit #2111 and #2116; the #2116 instance is run 38995333965, attempt 1.

## Root cause: a teardown race, not a source leak
- **What the CI log shows.** In run 38995333965 attempt 1, **all 10 subtests passed and the parent test passed (`ok 105`)**. The server log then shows `[659] FATAL: terminating connection due to administrator command` during teardown.
- **Why `end()` isn't enough.** `pg-pool` 3.14.0's `Pool.end()` resolves as soon as it has *asked* each client to close:
  - `_pulseQueue` → `_remove(client)` drops the client from `_clients` synchronously, then calls `client.end()` **without waiting** for it.
  - So `_clients` is empty at once, and the `end()` promise resolves before the sockets close.
- **How that becomes a failure.**
  - The test's `t.after` then runs `DROP DATABASE … WITH (FORCE)`. That terminates any backend that has not yet processed its Terminate message.
  - That client is still ending and its pool idle listener is attached, so the listener re-emits 57P01 on the pool, which has no error handler.
  - The result is an `uncaughtException`. node:test attributes it to the subtest that opened the client: the concurrency subtest, which grows the pool to 16.
- **Deterministic probe** on a private PostgreSQL 16 (a pool of 16 clients, `end()`, count `pg_stat_activity`, forced DROP; 20 runs per mode):
  - `end()` alone: backends were still attached in **3 of 20** runs, and there was **one unhandled 57P01**. The first probe run crashed with exactly the CI error and stack (`Client.idleListener` → `BoundPool` `error`).
  - With the drain below: **0 of 20** runs had backends attached, and there were **0 errors**.

## Fix (this file only)
- Track every client the pool opens, using the pool's `connect` and `remove` events.
- Teardown awaits `pool.end()`, then waits until every tracked client has emitted `remove`. That event fires from `client.end`'s callback, after the socket has closed.
- Only then does it drop the database.
- **The concurrency assertions are unchanged.**

## Verification (WSL Ubuntu-24.04, private PostgreSQL 16 on 127.0.0.1:55507, database `fbx_gate`; never the shared :55432)
| Run | Result |
|---|---|
| Fixed file 20× on the exact head `cd1278f7` | **20 / 20 pass**; 0 `terminating connection` FATALs in the server log during the loop |
| Fixed file 30× (pre-rebase, same file content) | 29 / 30. The one failure was an **external SIGTERM** mid-test, not an assertion or teardown error. The Filtering lane confirmed an over-broad `pkill` of theirs caused it. |
| Original file 30× (baseline) | 30 / 30. The race is rare at whole-file granularity, which is why the probe above is the deterministic evidence. |
| `npm run test:adminPolicyPostgres` (the full suite) once | **2394 tests: 2393 pass, 0 fail, 1 skipped** |

## Not in this PR
122 `functions/test/*Postgres*.test.mjs` files share the same `pool.end()` → forced-DROP teardown. A shared drain helper is approved as a **separate** test-only follow-up, sequenced after #2110 and Scheduling PR-2.

No production source, migration, Rules, deploy or credential change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
