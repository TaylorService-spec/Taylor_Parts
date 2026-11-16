# EOS CI performance

Lane CIP, opened 2026-10-21. Owner decision "EOS CI PERFORMANCE OPTIMIZATION" and the delivery-pivot addendum (P1, delivery-enabling).

| Phase | What | Status |
| --- | --- | --- |
| 1 | The admin policy PostgreSQL suites run as 5 parallel partitions, each with its own postgres | **BUILT**, validated on one commit (this PR) |
| 2 | A migrated template database cloned per file | DESIGN + one measurement. Not built. Not recommended yet (see section 7) |
| 3 | Affected-area selection for pull requests | DESIGN only. Not activated. Needs a further Owner decision |
| FX | Firebase-exit CI checks | DESIGN only |

Nothing here changes branch protection, which checks are required, product code, Firebase, or any business authority.

## 1. Before / After

Required check: **"Admin policy engine -- authorization, workflow, tenancy, schema, seed"**. "Before" has two sources. **History**: `main` at `96530fe3` (run 39623688103) and the 17 successful full-lane runs of 2026-10-21. **Same commit**: the OLD workflow run on exactly the commit the NEW one ran on (`371733f1`, section 4), the cleanest comparison. "After" is the NEW run on that commit.

Shared runners vary a lot (the old workflow took 18m32s on one run and 23m15s on another this afternoon), so the history median is the representative "before" and the same-commit pair is the like-for-like.

| Metric | Before (history) | Before (same commit) | After | Notes |
| --- | --- | --- | --- | --- |
| Median required-check duration (run start to the required check finishing) | **26m19s** (n=17, range 14m00s to 28m20s) | **23m32s** (1 run) | **6m33s** (1 run) | After has one sample on the final design. Re-measure on the first 10 runs after merge (the operational-readiness CI section carries the refresh recipe) |
| PostgreSQL suite duration | **24m39s** (one serialized step) | **21m40s** | **5m16s** (the longest of 5 parallel steps; the 5 steps sum to 25m14s) | Sum is about +2% over the history figure: the cost of re-creating the database for each file |
| Total tests executed, offline | 1946 | **1957** | **1957** | History is `main` before this lane. Same commit: identical. The +11 over history are this lane's own guard tests (`adminPolicyPartitions.test.mjs`), registered in the offline group |
| Total tests executed, PostgreSQL | 2904 | **2904** | **2904** | Identical in all three. Excludes the 4 isolation-pretest tests, which every version runs before the suites |
| Failed / skipped, offline | 0 / 2 | 0 / 2 | 0 / 2 | The same two skips, now named in the partition map |
| Failed / skipped, PostgreSQL | 0 / 1 | 0 / 1 | 0 / 1 | The same Firestore-emulator skip, now named in the partition map |
| Unexpected skips (target 0) | not asserted; read by eye | not asserted | **0, asserted** | A skip not named in `expectedSkips` fails the gate |
| Runner minutes per run, billed (each job rounded up to a minute) | 30 | 27 | 36 | +6 over history (+20%), +9 over the same-commit run (+33%) |
| Runner minutes per run, exact | 27.9 | 24.7 | 31.7 | +3.8 over history (+14%), +7.0 over the same-commit run (+28%) |
| Estimated cost per run | $0.18 | $0.16 | $0.22 | Assumes $0.006 per Linux 2-core minute (list price; the repository may be on included minutes, in which case the cash change is nil). Formula: billed minutes x rate. Not measured from an invoice. +$0.04 to +$0.05 per run |
| Security / authorization coverage | all suites, serialized | all suites, serialized | all suites, every one run exactly once | Section 5 |
| CI reliability, last 40 runs of the workflow (2026-10-21) | 24 success (7 of them the cheap irrelevant-lane skip), 6 failure, 10 cancelled | n/a | not yet measurable | 10 of 40 were cancelled by a newer push. A 6.5 minute gate is a window 3.6x to 4x shorter to be superseded in. Re-measure after merge |
| Queue wait | about 3 s (engine job started 3 s after `changes` finished) | about 3 s | about 3 s (all 7 parallel jobs started 3 s after `changes` finished) | One observation: the OLD workflow's push run on the same commit sat pending for 9 minutes while the new run's jobs started at once. Concurrency limits are an org setting; if they bind under three active lanes, the partitions queue and the wall-clock gain shrinks. Watch queue wait in the readiness section |

Cost reading: the split buys 17 to 20 minutes of wall-clock per run for 4 to 7 extra runner minutes (6 to 9 billed), about $0.04 to $0.05 per run at list price. It does not reduce spend. If spend must not rise, the lever is fewer superseded pushes (10 of the last 40 runs were cancelled), not fewer partitions.

### Baseline method (the "before" numbers)

* Run list: `gh run list --workflow eos-admin-policy-tests.yml --limit 40` (2026-10-21, 40 runs from `39568635098` to `39628377900`).
* Per-step timing: `gh run view 39623688103 --json jobs` and that job's log. The engine job took 26m20s: container start 24s, checkout 4s, Node 3s, install 10s, build 18s, offline proofs 35s (1946 tests: 1944 pass, 0 fail, 2 skipped), PostgreSQL 24m39s (2904 tests: 2903 pass, 0 fail, 1 skipped), seed check under 1s.
* Median: the 17 successful runs that ran the full lane have run durations of 13:58, 18:28, 18:37, 21:53, 24:00, 24:17, 24:28, 25:52, 26:19, 26:20, 26:23, 26:37, 26:43, 26:54, 28:04, 28:19, 28:20. Median 26:19.
* Per-file durations (used to balance the partitions) were read from the TAP log of the same run: 785 top-level test durations, assigned to files in registry order (the run is `--test-concurrency=1`, so output is file by file). 38 durations, mostly the 4 isolation-pretest tests, could not be matched by name and were charged to the preceding file. The total is 1410s. Balance does not need more precision than that.

## 2. What was built (Phase 1)

```
changes  (unchanged)
  |-- policy-offline   build, offline proofs, seed-snapshot check          no database
  |-- policy-postgres  matrix of 5, each its own postgres:16 service        the work
  `-- policy           GATE, same job id and same check name as before      aggregate verdict
surfaces (unchanged)
```

* `.github/workflows/eos-admin-policy-tests.yml`: the old single `policy` job is split into `policy-offline` and `policy-postgres`, and `policy` becomes the gate. The triggers, the `changes` job, the relevance list and the `surfaces` job are untouched.
* `.github/ci/eos-admin-policy-postgres-partitions.json`: the committed partition map. 190 suites, 5 partitions of 37 to 39 files, balanced by longest-processing-time-first on the measured seconds (284, 284, 284, 284, 283). Inside a partition the files keep registry order.
* `functions/scripts/adminPolicyPartitions.mjs`: the manifest guard (section 3).
* `functions/scripts/adminPolicyManifestReporter.mjs`: a `node:test` reporter that writes what a run executed, per file (tests, pass, fail, skipped, todo, cancelled, and the names of skipped tests). The ordinary TAP log still goes to stdout.
* `functions/scripts/runAdminPolicySuites.mjs`: gains `postgres --partition N [--isolate-databases]`. Without those flags it behaves exactly as before, so local `npm run test:adminPolicyPostgres` is unchanged.
* `functions/test/adminPolicyPartitions.test.mjs`: 11 tests of the guard, in the offline group.
* `scripts/adminPolicyCiRelevance.test.mjs`: the workflow contract test is updated for the new shape (gate `needs`, both work jobs carry the same job-level `if`).
* `.github/ci/eos-admin-policy-paths.txt`: four lines appended, so a change to the map or the guard fires the lane.
* `functions/scripts/ciTemplateCloneMeasure.mjs`: the Phase 2 measurement script. Not run by any gate.

### How the required-check name is preserved

The required check is a **job name**, "Admin policy engine -- authorization, workflow, tenancy, schema, seed". The job that carries that name is still the job with id `policy`, with the same name string, in the same workflow, with the byte-identical job-level `if: ${{ !cancelled() && needs.changes.outputs.relevant != 'false' }}`. The old job became the aggregator ("the old job becomes the aggregator" option of the brief). Consequences:

* No branch-protection edit, no new required check, no rename.
* Irrelevant change: `changes` answers `false`, all three jobs are skipped by their job-level `if`, and GitHub reports the required check as skipped, which satisfies it. Same as today.
* Relevant change: the gate runs. It fails unless `policy-offline` AND `policy-postgres` both finished `success` (a skipped or cancelled partition is a failure here, not a pass), and then runs the manifest aggregation.
* `scripts/adminPolicyCiRelevance.test.mjs` pins all of this (id, name, `needs`, the exact `if`).

## 3. How nothing is lost

Splitting a gate is only safe if the split is provably lossless. Three checks, all in `adminPolicyPartitions.mjs`:

1. **The map covers the registry exactly** (`mapProblems`). Every suite in `functions/test/adminPolicySuites.json` "postgres" is in exactly one partition. It fails on an unassigned suite (the message names the lightest partition to add it to), a duplicate, a suite the registry does not name, an empty partition, and a measured imbalance above 1.25 times the mean. It runs in the offline group of every lane run, in the runner before any partition starts, and in the gate.
2. **Each run is checked against its assignment** (`manifestProblems`). From the reporter's manifest: every assigned file produced a result, none ran zero tests, none failed or was cancelled, none has a `todo`, nothing unassigned ran, and every skipped test is named in `expectedSkips` of the map (by name prefix, per group). The three expected skips are the three the baseline has.
3. **The gate re-checks everything together** (`aggregateProblems`). It downloads every manifest, and fails on a missing partition, a suite that ran in two partitions, a registered suite that no partition ran, and a missing offline run. It prints the totals into the job summary.

Adding a PostgreSQL suite now takes one more line: register it in `adminPolicySuites.json` as before, and add it to a partition in the map. Forgetting the second line fails the offline group with the file name and the partition to use. Re-balancing means re-running the arithmetic on a newer run's durations; it is never needed for correctness.

### Choosing 5 partitions

Test time is 1410s. Each job adds about 65s of fixed cost (container, checkout, install, build). Billing rounds each job up to a minute.

| Partitions | Longest job (estimate) | Billed minutes, engine lane |
| --- | --- | --- |
| 4 | about 7 min | about 29 |
| 5 | about 6 min (measured 5m48s to 6m04s) | 31 measured, 36 with the other jobs |
| 6 | about 5 min | about 36 |

Five is the cheapest point that is under the 6 to 8 minute target.

### The state coupling the split exposed (and what was done)

The first correct-looking run failed in two partitions. Two suites, `eosOpsCashApplicationPostgres` and `truckFleetPostgres`, run `node-pg-migrate up` against whatever the previous file left in the shared database; they passed in the serialized run only because of what ran before them, and failed when a different file (or none) preceded them. This is exactly the "shared database state that could invalidate isolation" the addendum warns about. The fix is in the runner, not in the suites: with `--isolate-databases` each file starts on a database that is dropped and re-created **empty**, which is also the state the first file of every partition always had (and passed from). The flag refuses anything but a dedicated database on localhost. No assertion or fixture of any suite was edited.

The stronger isolation cannot turn a failing assertion green; it removes leftover state as a source of either outcome. It does mean these two suites now run from empty, and CI shows they pass that way.

## 4. Validation

A pull request that edits a workflow gets no `pull_request` CI, so the new workflow was proved by `workflow_dispatch`, with the OLD workflow run on the same commit.

Commit under test: `371733f1` on branch `cip/validation-same-commit`. That tree is this PR's code plus a temporary copy of the old workflow (`cip-baseline-admin-policy-TEMP.yml`, a push-triggered copy of `main`'s file) so the old and new definitions could run on one commit. That copy is NOT in the PR branch.

| Run | Workflow | Result |
| --- | --- | --- |
| https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/39633908480 | NEW (dispatch) | success. Gate: 190 postgres suites, 2904 tests, 2903 pass, 0 fail, 1 skipped; offline 131 suites, 1957 tests, 1955 pass, 0 fail, 2 skipped; "every registered suite ran exactly once, none empty, none failed, no unexpected skip" |
| https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/39633910406 | OLD (push), same commit | success. Engine job 23m15s (PostgreSQL step 21m40s). Offline 1957 tests, 1955 pass, 0 fail, 2 skipped; PostgreSQL 2904 tests, 2903 pass, 0 fail, 1 skipped. **Identical counts and results to the NEW run** |

Earlier runs on the way, kept because they show the guard working:

| Run | What it showed |
| --- | --- |
| https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/39631858494 | Red. A missing import in the runner. All five partitions and the offline job failed in under a minute, the gate failed with "finished 'failure', not 'success'" |
| https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/39632372299 | Red. 3 of 5 partitions green; the state coupling of section 3 failed partitions 4 and 5; the gate failed and named both |
| https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/39632372052 | Green, OLD workflow, one commit earlier (`21012496`, before the per-file database re-creation). Engine job 18m32s. Shows the old flow also passes through the changed runner, and how far a shared runner varies (18m32s here, 23m15s above) |

A dispatch of the real workflow on the pushed PR head is recorded as a PR comment, because a run's URL cannot be inside the commit it tests.

## 5. Security and authorization coverage preserved

* The same 190 PostgreSQL suites and 130 offline suites run, each exactly once; the guard fails otherwise.
* Zero-trace, tenancy, company-isolation, authority-preview, protected-owner and rollback suites are all in the registry, so they are all in the map and counted by the gate. Suites that assert zero-trace behaviour include `authorityPreviewEquivalencePostgres`, `authorityPreviewSafetyPostgres`, `commercialCompanyAuthorityPostgres`, `f1aInvoiceIssuePostgres` and `f1bInvoiceCorrectionPostgres`; isolation and authority suites include `authorizationDenialAuditPostgres`, `inventoryCompanyIsolationPostgres`, `protectedOwnerInvariantPostgres` and `roleCapabilityAuthorityBaselinePostgres`; rollback suites include `f1bInvoiceCorrectionDownPostgres`, `reorderObjectMigrationPostgres` and `adminPolicyActivation`.
* Migration up/down/up proofs run unchanged. The 2904 PostgreSQL test count is identical to the serialized run, so no proof was dropped, merged or skipped.
* Each partition's postgres is its own container: no database state is shared between partitions. Within a partition each file starts on an empty database.
* The security gates are not weakened: the required check still fails on any failed test, any missing or duplicated suite, and any unnamed skip.

## 6. Operating it

* A partition fails: open that partition's job; the log is the ordinary TAP log, file after file, each file introduced by `# ---- file N of M`.
* The gate fails with "MISSING PARTITION" or "NOT RUN": a partition job did not finish; re-run the failed jobs. The gate never reads a missing partition as green.
* Re-run a single partition locally (needs your own dedicated database): `POLICY_TEST_DATABASE_URL=postgres://... npm run test:adminPolicyPostgres -- --partition 3 --isolate-databases`. `--isolate-databases` DROPS and re-creates that database; it refuses a remote host and the shared `postgres`, `template0`, `template1` databases.
* The artifacts `manifest-*` (retention 7 days) hold each run's per-file results.
* Roll back: revert the workflow commit. `runAdminPolicySuites.mjs` without flags is the old behaviour.

## 7. Phase 2 (design + measurement): migrated template reuse

Question: would `CREATE DATABASE ... TEMPLATE <migrated>` per file save enough to be worth the isolation risk?

**Measurement** (CI, `postgres:16` service, 118 migrations, 7 rounds, `functions/scripts/ciTemplateCloneMeasure.mjs`, run https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/39632071207):

| | median |
| --- | --- |
| create database + migrate from scratch | 1339 ms (1318 to 1893) |
| `CREATE DATABASE ... TEMPLATE` clone of the migrated database | 130 ms (111 to 159) |
| clone is an identical schema (tables, applied migrations) | yes |

So a clone saves about 1.2s per fresh database. `node-pg-migrate` is mentioned 195 times across 161 suite files; if every mention became a clone the ceiling is 195 x 1.2s = **about 4 minutes of serial time, about 47s of wall-clock per partition after Phase 1**. The 24-minute step is not migration time: it is the tests' own work (the five heaviest files are 96s, 93s, 64s, 59s and 45s).

**Design if it is ever built.**

* One template per partition job, built once after the service is healthy (`CREATE DATABASE tpl; migrate up`), then `CREATE DATABASE <name> TEMPLATE tpl` where a suite today creates and migrates its own database. The template is never connected to by a test (`CREATE DATABASE ... TEMPLATE` needs no other session on it); marked `ALLOW_CONNECTIONS false`.
* No shared state: every clone is a private database; the template is read-only and discarded with the job. A zero-trace or isolation assertion sees exactly what it sees after a from-scratch migrate, because the clone is byte-identical in schema and `pgmigrations` rows (the script asserts it).
* **Suites that must keep migrating from scratch** (they prove migration application, rollback or recovery, so cloning would assert nothing): every suite that runs `migrate down`, replays the full migration set, or compares the rebuilt result to a baseline. A first scan finds 37 test files that contain a `"down"` step (for example `adminPolicyPostgres`, `f1bInvoiceCorrectionDownPostgres`, `eosOpsCashApplicationPostgres`, `truckFleetPostgres`, `catalogCutoverPostgres`), plus the replay and baseline suites (`roleCapabilityAuthorityBaselinePostgres`, `migrationLedgerOrderGuard`, `adminPolicyActivation`, the `reorder*Migration*` suites). The enforceable rule is a static scan: a suite that spawns `node-pg-migrate` with `down`, or that reads the migration directory to replay it, is on a committed list of "migrate-from-scratch" suites and the scan fails if a suite on neither list does either.
* Cost: one more guard (the scan), one more committed list, a change to how ~160 suites obtain a database.

**Recommendation: do not build it now.** About 47s of wall-clock per run, behind a new classification of 190 suites, is a poor trade after Phase 1 already bought 20 minutes. Revisit if migrations grow past ~500 or the partition floor drops under 3 minutes.

## 8. Phase 3 (design only): affected-area PR testing

Not activated. Activating any selective required check needs an independent missed-dependency review, tests for the selector, and a further Owner decision.

**Goal.** A pull request runs the suites its change can affect, plus anything that could not be proved unaffected. The full suite keeps running on `main` and on a schedule.

**Inputs, all committed.**

1. `domains.json`: business domain -> path globs it owns (Inventory, Commercial, Finance, Work Orders, Workforce, Administration, Reporting, Identity ...). Extends the existing relevance list, which is the union of what the lane watches today.
2. `suite-domains.json`: suite -> the domains it exercises (generated from the registry plus an import graph; reviewed, not guessed).
3. `always-full.json`: path globs whose change forces the FULL suite.

**Algorithm.** `changed files` -> for each, the owning domain(s) -> the suites of those domains. Output is the suite list for the partition map.

**Full coverage, always, when the change touches** (the addendum's list, each a glob set in `always-full.json`):

* authorization and security: `functions/src/adminPolicy/**`, capability and grant catalogs, role seeds, anything with `authority`, `capability`, `grant`, `scope`, `identity` or `session` in its path;
* cross-company access: any `operatingCompany`, `tenant` or company-reach module;
* shared business authority: the object and workflow registries, DAL ports, `src/eos*` shared modules imported by more than one domain;
* migrations: `functions/migrations/**` and the baseline manifests they are checked against;
* CI itself: `.github/**`, `scripts/adminPolicy*`, the registry, the map, `package.json`, lockfiles;
* test infrastructure: `functions/test/support/**`, shared fixtures.

**Fail closed.** If a changed file matches no domain, or matches a domain with no suites, or the selector errors, or the mapping files themselves changed: run the full suite. "Cannot determine" is never "nothing to run". The selector may only ever NARROW a run that would otherwise be full when it can prove the narrowing; its default output is everything.

**Independent validation of the selector** before any activation:

1. A property test over history: for the last N merged PRs, the selector's suite list must be a superset of the suites that actually failed or were fixed in the following 30 days, and of the suites that changed in the PR. Any miss is a defect in the maps, not a tolerated rate.
2. Mutation check: for a sample of source files, inject a failing assertion consumer and confirm the selector includes the suite that would catch it.
3. A reviewer who did not write the maps reviews them (the missed-dependency review).
4. Shadow mode first: run the selector and the full suite side by side for a fixed period; log every case where the selector's list excluded a suite that failed. Zero is the gate to the Owner decision.

**What stays unchanged.** Required-check names; the full run on `main` and on a nightly schedule; the gate's manifest guard (it would assert the selected subset equals the selector's output, not the registry).

## 9. Firebase-exit CI checks (design only)

**Inventory of the guards that exist today** (build on these; do not duplicate):

| Guard | Where | What it proves | What it does not |
| --- | --- | --- | --- |
| "No new Firebase business-runtime dependencies, directly or behind a transitional shim" | `.github/workflows/firebase-exit-guard.yml`, `scripts/firebaseExitGuard.mjs`, ratchet `docs/architecture/firebase-exit-baseline.json` | By exact import signature, no NEW frontend Firestore, frontend Functions callable, server `firebase-admin` Firestore or `firebase-functions` business runtime beyond a baseline that may only shrink | Auth/identity imports (deliberately excluded); config files; workflows; hosting endpoints; runtime behavior |
| "No Firebase deploy can silently target production" | `.github/workflows/firebase-deploy-guard.yml`, `scripts/firebaseDeployGuard.mjs` | No package script, workflow or runbook deploys without an explicit project; production deploy shapes rejected by the predeploy hook | Whether EOS code calls a Firebase endpoint |
| Business Capability Equivalence Gate | `.github/workflows/firebase-capability-equivalence.yml`, `scripts/firebaseCapabilityEquivalenceGuard.mjs` | A retired Firebase export has a verified EOS equivalent or an Owner-accepted gap | Anything about code that is not retired |
| `verify:eos-only` (FBX #2205) | `field-ops-app-vite/test/verifyEosOnlyBuild.mjs`, Vite Build Check lane | The EOS-only BUILD output carries no Firebase identity values and loads the inert Firebase module | The server side; runtime network behavior |
| No-Firebase source guards in this lane | `functions/test/adminPolicyNoFirebase.test.mjs`, `eosOpsNoFirebase.test.mjs` | `src/adminPolicy` and the EOS ops modules import no Firestore | Other directories |

**Checks to add**, each mapped to the requirement:

| Requirement | Check | Reuse |
| --- | --- | --- |
| Firebase SDK imports in operational EOS code | Extend the exit guard's classes with an `identity` class and a per-root ratchet for EOS operational roots (`functions/src/eos*`, `functions/src/adminPolicy`, EOS API), strict (zero) rather than baseline-tolerant | `firebaseExitGuard.mjs` signatures and baseline machinery |
| Firebase config referenced by EOS runtime components | Scan EOS runtime roots, `render.yaml`, Vercel config and EOS build configs for `firebaseConfig`, `.firebaserc`, `firebase.json`, `FIREBASE_*`, `GOOGLE_APPLICATION_CREDENTIALS` | extend `verifyEosOnlyBuild.mjs` from client bundle to server bundle and deploy config |
| Functions or Firestore calls from EOS workflows | Scan `.github/workflows/*.yml` and `scripts/` run by EOS lanes for `firebase `, `firestore`, emulator hosts, `--only functions` | `firebaseDeployGuard.mjs` already walks every workflow |
| Firebase identity or permission fallbacks | AST-level check that no EOS authorization path reads `users/{uid}.role`, custom claims, or `firebase-admin/auth` as a source of permission; tests for each fallback the code once had | `eosSessionAuthContext`, `b2AuthContextEosOnly` tests; Doorway invariant tests |
| Dependencies on Firebase-backed hosting or endpoints | Scan built output and config for `*.web.app`, `*.firebaseapp.com`, `cloudfunctions.net`, `firebaseio.com`, `googleapis.com/identitytoolkit` | `verifyEosOnlyBuild.mjs` |
| Reintroduction of retired Firebase functionality | A retired-export list (the capability-equivalence records already hold it): fail if a retired callable name or collection name appears again outside the records | `firebaseCapabilityEquivalenceGuard.mjs` |

**Legacy versus EOS.** During migration every check takes an explicit scope: `EOS_OPERATIONAL` roots (strict) versus `APPROVED_LEGACY_PRODUCTION` roots (the existing baseline, tolerated, may only shrink). A pull request that touches only legacy files cannot fail the strict checks, because the strict checks scan only EOS roots and only fail on what is in them. The scope lists are committed and changed only by a reviewed edit. Strict enforcement of the whole repository starts after the authorized cutover, by deleting the legacy scope, not by editing the checks.

**A source scan is not proof of runtime independence.** It cannot see dynamic imports built at run time, a transitive dependency, an environment variable that turns Firebase back on, or a hosted service that still calls a Firebase endpoint. So pair it with runtime evidence:

1. **Build and deploy configuration check.** Build the EOS API and the EOS-only client in CI with no Firebase credentials in the environment and no `firebase-tools` on the path; fail if the build needs them. Diff the dependency graph (`npm ls`) of the EOS API for `firebase*` and `@google-cloud/firestore`.
2. **Network-egress census.** Run the EOS API and the browser journeys (the Codex UAT personas) in a sandbox whose egress is recorded (a proxy log or `--network` capture). Fail on any request to a Firebase or Google Identity host. Publish the census of every host contacted as an artifact: the evidence that EOS ran without Firebase is a list of hosts, not an absence of imports.
3. **Credential-free boot.** Start the EOS API with every Firebase variable unset and Firebase unreachable (DNS blocked); the health and the persona journeys must still pass.

These runtime checks belong in the post-cutover gate and as an informational job beforehand; making them required before the cutover is an Owner decision.
