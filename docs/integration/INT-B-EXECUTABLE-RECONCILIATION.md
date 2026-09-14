# INT-B — Executable Reconciliation against current `main`

**Lane:** INT-B-EXEC-RECONCILE · **Mode:** EVIDENCE_WRITE (analysis only; nothing merged, nothing implemented)

**Baseline:** `origin/main` = `64008d5ae0bdd9532909671b15a91122400accf1`, verified against the live remote
(`git ls-remote origin refs/heads/main` returned `64008d5ae0bdd9532909671b15a91122400accf1`), i.e. unmoved.

**Worktree / branch:** `ext/reporting-reconcile` @ `e50b390e`.

All findings are `[OBSERVED AT: 64008d5a]` unless a different ref is named. Every reading was taken with
`git show <ref>:<path>` or `git diff <ref>..<ref>` so no working-tree or wrong-branch content can leak into a
claim. Where a claim concerns a candidate branch, the branch is named explicitly. A correct reading from the
wrong branch is still a false statement about the product, so the ref is attached to every row.

---

## 0. Ref verification

| Ref | SHA | At origin? | merge-base with `64008d5a` | Ancestor of main? |
|---|---|---|---|---|
| `post/eng-a-audit-read` | `acdd87b9` | yes | `64008d5a` | no |
| `post/eng-b-firebase-guard` | `bccf0759` | yes | `64008d5a` | no |
| `post/eng-c-parity-vacuity` | `276e0417` | yes | `64008d5a` | no |
| `post/eng-d-environment-fence` | `129c485d` | yes | `64008d5a` | no |
| `night/p2c2-adc-failclosed` | `5981645c` | yes | `d104cf49` | no |
| `night/p2m-sandbox-project-resolution` | `2aeee87c` | yes | `d104cf49` | no |
| `rpt/reporting-remediation` | `8e28e32d` | yes | `64008d5a` | no |
| `fix/crash-diagnostics-flake` | `bcb91387` | yes | `64008d5a` | no |
| `night/p2l-functions-test-registration` | `5013f8a3` | yes | `d104cf49` | no |
| `night/p2c1-parity` | `ab61540c` | yes | `d104cf49` | no |
| `night/p2n-governed-role-resolution` | `7cbca122` | yes | `d104cf49` | no |
| `night/p2k-finance-detectors` | `d9b63963` | yes | `d104cf49` | no |
| `night/p2j-onhand-derivation` | `3c554144` | yes | `d104cf49` | no |
| `night/p2f-nonprod-blockers` | `f1ddf2b7` | yes | `d104cf49` | no |
| `night/p2g-capability-request-blindness` | `17a96ed3` | yes | `d104cf49` | no |
| `atlas/p30b-identity-verification` | `8af319d0` | yes | `d104cf49` | no |
| `rpt/client-outcome-honesty` | `8e28e32d` | **LOCAL ONLY** | `64008d5a` | no |
| `post/eng-e-report-scope` | `92db1d19` | **LOCAL ONLY** | `64008d5a` | no |
| `rpt/false-empty-and-audit` | `8521cd88` | **LOCAL ONLY** | `64008d5a` | no |
| `night/p2h-report-scope-bound` | `d1491997` | **LOCAL ONLY** | `d104cf49` | no |
| `atlas/guard-admin-firestore` | `4d2ec94b` | **LOCAL ONLY** | `33945090` | no |

**Brief correction (B1).** The brief states the candidates are "all now at origin". Five refs it names are
**local-only** with no `origin/` counterpart: `rpt/client-outcome-honesty`, `post/eng-e-report-scope`,
`rpt/false-empty-and-audit`, `night/p2h-report-scope-bound`, `atlas/guard-admin-firestore`. Custody for those
exists **only in this clone**. Harmless for the three that are ancestors or superseded, but a real custody gap
for anything the controller later intends to rely on.

**Brief confirmation.** `origin/rpt/reporting-remediation` and local `rpt/client-outcome-honesty` are the same
commit `8e28e32d`. The identity claim holds.

---

## 1. Absorption test — method and result

**Method: content comparison, not ancestry.** For every candidate I computed
`git diff 64008d5a..<ref> -- <the exact path set the ref changes>` plus a per-file
`git diff --quiet 64008d5a..<ref> -- <file>`. A ref is ALREADY ABSORBED only if that residual is empty.
Because a same-substance/different-text absorption would still show a textual residual, I added an
artifact-existence probe on `main` (`git cat-file -e 64008d5a:<path>`) for every new module each ref
introduces.

**Result: no candidate is absorbed by content, and not one of the new modules exists on `main` at all.**

| Probe on `64008d5a` | Result |
|---|---|
| `scripts/firebaseShimBoundary.mjs` | ABSENT |
| `scripts/firebaseShimBoundary.test.mjs` | ABSENT |
| `docs/architecture/firebase-shim-consumer-census.json` | ABSENT |
| `functions/scripts/projectTargetGuard.js` | ABSENT |
| `functions/scripts/environmentTargetShared.js` | ABSENT |
| `functions/scripts/sandboxTargetGuard.js` | ABSENT |
| `functions/src/reporting/reportRowScope.ts` | ABSENT |
| `functions/test/reportRowScopeBound.test.mjs` | ABSENT |
| `functions/test/reportFalseEmptyHonesty.test.mjs` | ABSENT |
| `functions/test/reportAuditContextInjection.test.mjs` | ABSENT |
| `functions/test/support/reportEngineHarness.mjs` | ABSENT |
| `functions/test/operatorScriptEnvironmentFence.test.mjs` | ABSENT |
| `functions/test/inventoryCapabilityParityHarnessVacuity.test.mjs` | ABSENT |
| `functions/test/recordChangeHistoryDefaultRoleCatalog.test.mjs` | ABSENT |
| `functions/scripts/testRegistrationRatchet.mjs` | ABSENT |
| `functions/src/identity/recordId.ts` | ABSENT |
| `field-ops-app-vite/src/access/shellCapabilityGates.js` | ABSENT |

So **there is no ALREADY ABSORBED row below.** `main` at `64008d5a` carries none of these corrections.
Absorption was disproved by content, which is the stronger test; ancestry agrees (no candidate is an
ancestor of `main`).

---

## 2. Per-concern reconciliation table

| # | Concern | Authoritative ref today | Disposition | Basis |
|---|---|---|---|---|
| C1 | audit read correction | `post/eng-a-audit-read` `acdd87b9` | **STILL REQUIRED** | 4-file residual vs `64008d5a`; `functions/test/recordChangeHistoryDefaultRoleCatalog.test.mjs` absent on main |
| C2 | Firebase guard / shim-boundary correction | `post/eng-b-firebase-guard` `bccf0759` | **STILL REQUIRED** | 8-file residual; `scripts/firebaseShimBoundary.mjs` + census JSON absent on main |
| C2a | predecessor `atlas/guard-admin-firestore` `4d2ec94b` | — | **SUPERSEDED** | Touches the same two files (`scripts/firebaseExitGuard{,.test}.mjs`). Residual vs main is 389+/407-, i.e. main has already moved past it. Not an ancestor of eng-b either — supersession is by content and lineage, not ancestry |
| C3 | capability parity correction (vacuity) | `post/eng-c-parity-vacuity` `276e0417` | **STILL REQUIRED** | 5-file residual; vacuity test absent on main |
| C3a | `night/p2c1-parity` `ab61540c` | — | **EVIDENCE ONLY** | docs + one CLI + one test; no runtime `functions/src` or `field-ops-app-vite/src` change |
| C4 | ADC / environment fence | `post/eng-d-environment-fence` `129c485d` | **STILL REQUIRED** | 11-file residual; `functions/scripts/projectTargetGuard.js` absent on main |
| C4a | `night/p2c2-adc-failclosed` `5981645c` | — | **CONFLICTED** (partly superseded) | see section 3 |
| C5 | sandbox project resolution | `night/p2m-sandbox-project-resolution` `2aeee87c` | **STILL REQUIRED** | 10-file residual; `sandboxTargetGuard.js` absent on main; script set disjoint from C4/C4a |
| C6 | report-row and report-outcome honesty / reporting remediation | `rpt/reporting-remediation` `8e28e32d` | **STILL REQUIRED** | 21-file residual; all four new reporting artifacts absent on main |
| C6a | `post/eng-e-report-scope` `92db1d19` | — | **SUPERSEDED (strict ancestor)** | `git merge-base --is-ancestor` vs `8e28e32d` returns YES |
| C6b | `rpt/false-empty-and-audit` `8521cd88` | — | **SUPERSEDED (strict ancestor)** | `git merge-base --is-ancestor` vs `8e28e32d` returns YES |
| C6c | `night/p2h-report-scope-bound` `d1491997` | — | **SUPERSEDED (independent)** | NOT an ancestor of `8e28e32d`. Both add `functions/src/reporting/reportRowScope.ts`: p2h's is 236 lines, the chain's 358, with 322 differing lines. Same module path, two implementations; the chain is the maintained one |
| C7 | crash-diagnostics deterministic fixture | `fix/crash-diagnostics-flake` `bcb91387` | **STILL REQUIRED** | 2-file residual in `field-ops-app-vite/src/diagnostics/crashDiagnostics.js` + its test |
| A1-a | functions test registration ratchet | `night/p2l-functions-test-registration` `5013f8a3` | **CONFLICTED** | Only ref that conflicts against `main` (`functions/package.json`), plus the NUL-byte/binary defect — see section 4 |
| A1-b | governed role resolution | `night/p2n-governed-role-resolution` `7cbca122` | **EVIDENCE ONLY** | Changes exactly `docs/architecture/governed-role-binding-analysis.md`, `functions/package.json`, `functions/test/governedRoleBinding.test.mjs`. **Zero runtime source.** It characterises main's behaviour; it does not change it |
| A1-c | finance detectors | `night/p2k-finance-detectors` `d9b63963` | **STILL REQUIRED** | 3 runtime files (`invoiceTotals.ts`, `financialReconciliation.ts`, `invoiceCommands.ts`) + detector-wiring test, absent from main |
| A1-d | on-hand derivation / sign authority | `night/p2j-onhand-derivation` `3c554144` | **STILL REQUIRED** | 2 runtime files (`inventoryAnalyticsEngine.ts`, `cycleCountExpectedQuantity.ts`) + 3 new tests |
| A1-e | non-prod blockers | `night/p2f-nonprod-blockers` `f1ddf2b7` | **STILL REQUIRED, quarantine** | No runtime `src/`, but 19,488+/6,258- dominated by regenerated `docs/architecture/repo-graph.{json,md}`. Generated-artifact churn: must be regenerated on the integration tip, never text-merged |
| A1-f | capability request blindness | `night/p2g-capability-request-blindness` `17a96ed3` | **STILL REQUIRED** | 5 runtime files under `field-ops-app-vite/src/access` and `modules/administration`; `shellCapabilityGates.js` absent on main |
| A1-g | identity verification / record-id standard | `atlas/p30b-identity-verification` `8af319d0` | **EVIDENCE ONLY** | 3 new docs + `functions/src/identity/recordId.ts`, which **no runtime file imports** (`git grep identity/recordId` over `functions/src` and `field-ops-app-vite/src` on that ref returns no hits). A standard proposal plus an unreferenced module |

---

## 3. C4 / C4a — the environment-fence overlap, precisely

The brief says `post/eng-d-environment-fence` supersedes most of `night/p2c2-adc-failclosed` "except its fence
on `functions/scripts/inventoryCapabilityParityHarness.js`". The overlap is real, but the residual is **larger
than one file** and the two branches install **two different guard modules**.

Shared script set (both fence the same 7 scripts — this is where eng-d supersedes p2c2):
`assignTechnicianToUser.js`, `d1SmokeCompleteAssignedJob.js`, `d2SmokeRulesVerification.js`,
`d3SmokeUiVerification.js`, `generatePasswordResetLink.js`, `provisionEmployeeAccess.js`,
`receivingE2VerifierCli.js`.

p2c2-unique (`comm -23` over the two `functions/scripts/` sets):

| p2c2-unique path | Note |
|---|---|
| `functions/scripts/environmentTargetShared.js` | p2c2's guard module — a *competing* mechanism to eng-d's `projectTargetGuard.js` |
| `functions/scripts/inventoryCapabilityParityHarness.js` | the fence the brief names |
| `functions/scripts/operatorAccessCommand.js` | **not named in the brief** |
| `functions/scripts/productionFoundationVerification.js` | **not named in the brief** |

**Brief correction (B2).** p2c2's unfenced-by-eng-d residual is **three operator scripts, not one**:
`inventoryCapabilityParityHarness.js`, `operatorAccessCommand.js`, `productionFoundationVerification.js`.

**Brief confirmation.** The `inventoryCapabilityParityHarness.js` claim holds exactly. On `64008d5a`:

- `functions/scripts/inventoryCapabilityParityHarness.js:262` — `const args = process.argv.slice(2);`, and the
  only argument parsed is `--tenant`. There is **no** `--projectId`.
- `functions/scripts/inventoryCapabilityParityHarness.js:192` —
  `const db = opts.db || require("firebase-admin/firestore").getFirestore();`, i.e. Firestore is bound from
  **ambient ADC**. The comment at `:258-259` confirms it requires "a live Firestore credential
  (GOOGLE_APPLICATION_CREDENTIALS / ADC)". The fence is genuinely missing on `main`.

**Brief correction (B3) — a collision the brief does not flag.** `post/eng-c-parity-vacuity` **also modifies
`functions/scripts/inventoryCapabilityParityHarness.js`**, and it does **not** add a project fence: its diff
touches only classification / vacuity / guard-reason logic (verified — no `projectId`, `initializeApp`,
`argv` or `EMULATOR` additions anywhere in `git diff 64008d5a..post/eng-c-parity-vacuity` for that file).
So p2c2's residual fence and eng-c's vacuity fix **land in the same file** and cannot both be applied blind.

Further, eng-d exports `{ parseArgs, assertProjectTarget, PRODUCTION_PROJECT_ID }` from
`projectTargetGuard.js` (with `PRODUCTION_PROJECT_ID = "taylor-parts"`), while p2c2's
`environmentTargetShared.js` exports `assertProjectTarget`, `assertResolvedProjectId` and
`assertCapabilityActivationProject`. Two modules, an overlapping export name, the same purpose. Taking both
verbatim installs **two competing fences**. Hence C4a is **CONFLICTED**, not merely "superseded except one
file".

p2c2 does carry one piece of analysis eng-d lacks: the `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT`
activation-override trap, where an empty override set makes 12 of the 18 census operations report a spurious
`EXTRA_POSTGRES_GRANT`. That reasoning is worth preserving even if the code is not taken as-is.

---

## 4. A1-a — the `night/p2l` NUL bytes, corrected

Verified: `functions/scripts/testRegistrationRatchet.mjs` on `night/p2l-functions-test-registration` is
11,308 bytes and contains exactly **2 NUL bytes, at offsets 3602 and 3649 (lines 64 and 66)**.
`git diff --numstat 64008d5a..night/p2l... -- <that file>` returns `-` / `-`, i.e. git classifies it as
binary. The brief's byte count and its merge-blocking consequence are both correct.

**Brief correction (B4) — the characterisation is wrong.** The NULs are **not corruption**. They are a
deliberate sentinel in a glob-to-regex converter: `**` is first parked as a literal NUL so the subsequent
single-`*` rule cannot eat it, then restored as `.*` (the three chained `.replace()` calls at lines 63-66,
where the second and third arguments contain the raw byte rather than an escape).

The script **runs correctly**. Executed on the ref after `npm run build`, it printed:

```
functions/test files: 467 | registered: 451 | run nowhere: 16 (baseline 16)
OK: nothing newly unregistered.
```

So this is a **reviewability / merge** defect, not a functional one, and the remedy is to write the sentinel
as an escape (` `) or pick an improbable printable sentinel, which restores the file to text. Recording
it as "corrupt" would send the controller looking for the wrong fix.

p2l is **CONFLICTED** on two independent grounds: the binary classification above, **and** it is the only
candidate whose read-only `git merge-tree --write-tree` probe against `64008d5a` reports a real conflict
(`CONFLICT (content): Merge conflict in functions/package.json`).

---

## 5. STILL REQUIRED set — file counts, Tier-2, rebase exposure, re-provability

Rebase exposure was measured read-only with `git merge-tree --write-tree --name-only 64008d5a <ref>`.
No branch was created, checked out, merged, rebased or pushed.

| Concern | Ref | Files | Touches `firestore.rules`? | Rebase exposure onto `64008d5a` | Tests re-proven? |
|---|---|---|---|---|---|
| C1 audit read | `acdd87b9` | 4 | **No** | CLEAN | **YES — 6/6 pass** |
| C2 firebase guard / shim boundary | `bccf0759` | 8 | **No** | CLEAN | **YES — 29/29 + 70/70 pass** |
| C3 parity vacuity | `276e0417` | 5 | **No** | CLEAN, but same file as p2c2 (see B3) | **YES — 13/13 + 12/12 pass** |
| C4 environment fence | `129c485d` | 11 | **No** | CLEAN; 7-script overlap with p2c2 | **YES — 17/17 pass** |
| C5 sandbox project resolution | `2aeee87c` | 10 | **No** | CLEAN | **YES — 1/1 suite pass** |
| C6 reporting remediation | `8e28e32d` | 21 | **No** | CLEAN | **YES — 72/72 functions + 3/3 client suites** |
| C7 crash diagnostics | `bcb91387` | 2 | **No** | CLEAN | **YES — 17/17 pass** |
| A1-c finance detectors | `d9b63963` | 8 | **No** | CLEAN | NOT_RUN |
| A1-d on-hand derivation | `3c554144` | 7 | **No** | CLEAN | NOT_RUN |
| A1-e non-prod blockers | `f1ddf2b7` | 10 | **No** | CLEAN; generated-artifact churn | NOT_RUN |
| A1-f capability request blindness | `17a96ed3` | 8 | **No** | CLEAN | NOT_RUN |
| C4a p2c2 residual (3 scripts) | `5981645c` | 16 (4 unique) | **No** | CLEAN vs main; **CONFLICTED vs eng-c and eng-d** | **YES — 25/25 pass** |
| A1-a test registration ratchet | `5013f8a3` | 4 | **No** | **CONFLICT — `functions/package.json`** | script executes; ratchet reports OK |

**Brief correction (B5) — no Tier-2 item exists in this set.** I grepped every candidate's changed-path list
for `firestore.rules`: **zero hits across all 16 origin candidates.** Nothing in the executable-fix set is
Tier-2, and nothing in it is excluded from a normal wave on rules grounds. The only Tier-2 surface in this
lane is the `firestore.rules` finding in the bypass census (section 6), which belongs to no candidate branch.

### Re-provability method — PROVEN

The `git archive` + borrowed `node_modules` + build-on-the-ref method **works**, and was used for every "YES"
above. No emulator was started and `java` was never invoked.

1. `git -C <worktree> archive <ref> | tar -x -C <scratch>/<name>` — exports the ref's tree only.
2. `ln -sfn <donor>/functions/node_modules <scratch>/<name>/functions/node_modules`, and the same for
   `field-ops-app-vite/node_modules`. Donor: `/home/rudy2/.local/share/eos-worktrees/w2-integration-rehearsal`,
   chosen as IDLE (`functions/node_modules` mtime `2026-09-12 03:33`). Symlink only — **nothing was written
   into the donor.**
3. `cd <scratch>/<name>/functions && npm run build` (`tsc`). **`functions/lib` is built from the ref under
   test and was never borrowed.** Build succeeded on every ref attempted: eng-a, eng-c, eng-d,
   reporting-remediation, p2c2, p2m, p2l.
4. `node --test <test path>`.

Notes worth carrying forward:

- `post/eng-a-audit-read`'s test **requires** step 3. Without a build it dies with `ERR_MODULE_NOT_FOUND` on
  `functions/lib/access/recordChangeHistoryReadService.js`. That is the expected failure mode of a skipped
  build, not a test defect.
- `post/eng-b-firebase-guard` needs **no** `node_modules` at all (pure `node:` builtins; the donor has no
  repo-root `node_modules` to borrow anyway). 99 tests pass on the bare archive.
- 43 worktrees carry `functions/node_modules`, consistent with the brief's "~43 of 107".

### Measured test results (real, unpiped counts)

| Ref | Test | Result |
|---|---|---|
| `acdd87b9` | `functions/test/recordChangeHistoryDefaultRoleCatalog.test.mjs` | 6 tests / 6 pass / 0 fail |
| `bccf0759` | `scripts/firebaseShimBoundary.test.mjs` | 29 / 29 / 0 |
| `bccf0759` | `scripts/firebaseExitGuard.test.mjs` | 70 / 70 / 0 |
| `276e0417` | `functions/test/inventoryCapabilityParityHarnessVacuity.test.mjs` | 13 / 13 / 0 |
| `276e0417` | `functions/test/inventoryCapabilityParityHarnessClassification.test.mjs` | 12 / 12 / 0 |
| `129c485d` | `functions/test/operatorScriptEnvironmentFence.test.mjs` | 17 / 17 / 0 |
| `8e28e32d` | `functions/test/reportRowScopeBound.test.mjs` | 28 / 28 / 0 |
| `8e28e32d` | `functions/test/reportFalseEmptyHonesty.test.mjs` | 17 / 17 / 0 |
| `8e28e32d` | `functions/test/reportAuditContextInjection.test.mjs` | 16 / 16 / 0 |
| `8e28e32d` | `functions/test/reportingActivationBoundary.test.mjs` | 11 / 11 / 0 |
| `8e28e32d` | `field-ops-app-vite/test/reportOutcomeContractRatchet.test.mjs` | 1 / 1 / 0 |
| `8e28e32d` | `field-ops-app-vite/test/reportResultState.test.mjs` | 1 / 1 / 0 |
| `8e28e32d` | `field-ops-app-vite/test/reportRunOutcome.test.mjs` | 1 / 1 / 0 |
| `bcb91387` | `field-ops-app-vite/test/crashDiagnostics.test.mjs` | 17 / 17 / 0 |
| `5981645c` | `functions/test/environmentSelectionFailClosed.test.mjs` | 25 / 25 / 0 |
| `2aeee87c` | `functions/test/sandboxTargetGuard.test.mjs` | 1 / 1 / 0 |
| `d9b63963`, `3c554144`, `f1ddf2b7`, `17a96ed3`, `ab61540c`, `7cbca122`, `8af319d0` | — | **NOT_RUN** — out of this pass's budget. Not a failure, and not to be relabelled |

---

## 6. Collision surface for the controller's serialized wave

`git merge-tree` against `64008d5a` is CLEAN for 15 of 16 candidates, but that is a *pairwise-with-main*
result. In a serialized wave each ref rebases onto the previous tip, so the shared-file set is the real
collision surface.

| Shared path | # refs | Refs |
|---|---|---|
| `functions/package.json` | **12** | p30b, p2c2, p2f, p2j, p2k, p2l, p2m, p2n, reporting-remediation, eng-a, eng-c, eng-d |
| `functions/scripts/assignTechnicianToUser.js` | 2 | p2c2, eng-d |
| `functions/scripts/d1SmokeCompleteAssignedJob.js` | 2 | p2c2, eng-d |
| `functions/scripts/d2SmokeRulesVerification.js` | 2 | p2c2, eng-d |
| `functions/scripts/d3SmokeUiVerification.js` | 2 | p2c2, eng-d |
| `functions/scripts/generatePasswordResetLink.js` | 2 | p2c2, eng-d |
| `functions/scripts/provisionEmployeeAccess.js` | 2 | p2c2, eng-d |
| `functions/scripts/receivingE2VerifierCli.js` | 2 | p2c2, eng-d |
| `functions/scripts/inventoryCapabilityParityHarness.js` | 2 | **p2c2, eng-c** |
| `field-ops-app-vite/test/suites.json` | 2 | p2g, reporting-remediation |
| `.github/workflows/eos-admin-policy-tests.yml` | 2 | p2f, eng-c |

`functions/package.json` is the single serialization chokepoint: 12 refs each append `test:*` scripts
(`test:administrationUsers`, `test:adminPolicy`, `test:operatorEnvironmentFence`,
`test:reportingOutcomeHonesty` / `test:reporting` / `test:reportingRowScope` / `test:reportingHonesty`,
`test:environmentSelection` / `test:schedulingDomain`, and so on). Each collision is mechanical, but there
are 12 of them and they must be resolved in wave order, not batched.

**Do not merge the EVIDENCE ONLY branches into runtime.** `night/p2c1-parity`,
`night/p2n-governed-role-resolution` and `atlas/p30b-identity-verification` exist to record analysis; custody
is not a reason to land them. `p2n` changes no runtime source at all, and `p30b`'s
`functions/src/identity/recordId.ts` has no importer.

---

## 7. The bounded bypass census — record ownership and accountability

Scope held to the three surfaces named in the brief: exported callables in `functions/src/index.ts` that can
write an ownership field, client-writable `firestore.rules` update statements touching an ownership field,
and operator scripts under `functions/scripts/` that write one. Nothing else was surveyed.

### 7.1 The ownership field vocabulary that actually exists

`functions/src/ownership/ownershipMatrix.ts` is the authority. `ownerFields` is documented at
`ownershipMatrix.ts:29` as "the EXISTING storage the typed owner derives from. Empty = no storage yet."

| Field | Owner class | Families | Declaration |
|---|---|---|---|
| `accountOwner` (map, keyed `assignedToEmployeeId`) | PERSON | `accounts` | `ownershipMatrix.ts:120`; shape read at `typedOwner.ts:96-107` |
| `owner` | PERSON | `contacts`, `locations` | `ownershipMatrix.ts:128`, `:135` |
| `ownerEmployeeId` | PERSON | `opportunities`, `sales_agreements`, `sales_orders` | `ownershipMatrix.ts:149`, `:158`, `:168` |
| `operatingCompanyId` | COMPANY | `fieldops_jobs`, `stock_locations`, `trucks`, `inventory_transactions`, `receiving_orders`, `cycle_counts`, `equipment` | `ownershipMatrix.ts:268`, `:329`, `:363`, `:386`, `:404`, `:412`, `:462`; `ASSIGNED_FIELD` at `warehouseRootCompanyAssignment.ts:55` |
| `sourceOperatingCompanyId` / `destinationOperatingCompanyId` | PARTICIPATING_COMPANIES, **not** owner fields | `inventory_transactions`, `transfer_orders` | `ownershipMatrix.ts:390`, `:450`; held apart at `:78-81` |
| `companyScopeField: "operatingCompanyId"` | company **scope**, orthogonal to person ownership | `opportunities`, `sales_agreements`, `sales_orders` | `ownershipMatrix.ts:148`, `:157`, `:167`; rationale `:85-89` |

Names the brief suggested that **do not exist** on this ref: `ownerId`, `ownerUserId`, `assignedTo` (prose
only, e.g. `ownershipMatrix.ts:227`), `accountableUserId`, `custodian*` (zero occurrences of `custodian`
anywhere in `functions/src`).

`currentOwner` / `assignedToUserId` on `reorder_requests` is a **workflow queue token**, not record
ownership: its values are `INVENTORY` / `PARTS_MANAGER` / `PARTS_ASSOCIATE` (`firestore.rules:277`, `:768`,
`:779`) and `reorderRequest`'s `ownerFields` is `[]` (`ownershipMatrix.ts:288`). NOT APPLICABLE.

### 7.2 Surface A — exported callables in `functions/src/index.ts`

| Path | file:line | Writes | Classification | Missing stage |
|---|---|---|---|---|
| `updateOpportunity` | `functions/src/opportunity/opportunityCallables.ts:363-403`; write `:335`; audit `:337-350`; field accepted `:387`; allowlist `opportunityCommands.ts:244`; change recorded `opportunityCommands.ts:312-317` | `opportunities.ownerEmployeeId` — a **MOVE**, not creation | **INERT** today (`opportunity.write` is `active: false`, `permissionCatalog.ts:159`, hard deny for all principals); becomes a **BYPASS DEFECT** the moment the capability is granted | **AUDIT.** Every other stage is present: entry, gate `requireOpportunityWrite` `:181-194`, authority read `tx.get` `:317`, pure validator `buildUpdateOpportunity`, write `:335`, audit, commit. The audit emitted is `action: "updateOpportunity"` with a free-text `summary`; no `OWNERSHIP_HANDOFF`, no `previousOwner`/`newOwner` |
| `createOpportunity` | `opportunityCallables.ts:198`; `opportunityCommands.ts:159,173` | `ownerEmployeeId` at creation (`resolveCreationOwner`) | **GOVERNED** — creation stamping, not a handoff | none |
| `createSalesOrder` / `transitionSalesOrder` | `salesOrder/salesOrderCommands.ts:261,274-287` | `ownerEmployeeId` + `operatingCompanyId` at creation; refuses a missing company `:279` | **GOVERNED** | none |
| `createSalesAgreement` | `salesAgreement/salesAgreementCommands.ts:280,301,304` | `ownerEmployeeId` + `operatingCompanyId` at creation | **GOVERNED** | none |
| `updateSalesAgreementDraft` | `salesAgreementCommands.ts:456-477`, enforced `:518-522` | **cannot** touch `ownerEmployeeId` or `operatingCompanyId` — neither is on `SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS` | **GOVERNED** (closed) | none |
| `createSalesOrderFromOpportunity` | `opportunity/createSalesOrderFromOpportunity.ts:200,206` | inherited owner + company at creation | **GOVERNED** | none |
| `closeOpportunityAsWon` | `opportunity/closeOpportunityAsWon.ts:283,293` | inherited owner + company at creation | **GOVERNED** | none |
| reorder callables | `reorderRequest/reorderCommands.ts:130-133,190,293-296,375` | `operatingCompanyId` derived from the governed Warehouse; **explicitly refuses a caller-supplied value** | **GOVERNED** | none |
| `issueInvoice` | `finance/invoiceCommands.ts:132-141,254-259,314` | `operatingCompanyId` inherited from the Sales Order; refuses absent/mismatched | **GOVERNED** | none |
| cycle-count sheet creation | `cycleCount/cycleCountSheetCallables.ts:50`; `cycleCountSheetRepository.ts:115,127` | `operatingCompanyId` at creation from warehouse | **GOVERNED** | none |
| `receiveInventoryStock` | `inventoryReceiving/receiveInventoryStockCommand.ts:445-448` | `operatingCompanyId` on a cost record at creation | **GOVERNED** | none |
| `updateEmployeeProfile` (via `administrationUsersCallables`) | `access/employeeProfileCommands.ts:215`; import `administrationUsersCallables.ts:20` | **UPDATE** of `employees/{id}.operatingCompanyId` | **NOT APPLICABLE** — `employees` is EXCLUDED from the matrix as "person authority — a subject of ownership, not an object" (`ownershipMatrix.ts:514`). This is the employing company, not record ownership | n/a. Per-field change audits are emitted; `OWNERSHIP_HANDOFF` is deliberately excluded (`employeeProfileCommands.ts:252-257`) |
| any callable writing `accountOwner` | — | — | **MISSING INPUT — does not exist** | **No callable anywhere in `functions/src` writes `accountOwner`.** Every hit is a read (`typedOwner.ts:96`, `ownershipCensus.ts:166`, `crm/customerMigrationSource.ts:260`, `reporting/reportCatalog.ts:142`). The root of the entire person-owned inheritance chain (ruling D-4, `ownershipMatrix.ts:116`) has **no server-side write path at all** |
| any callable writing `contacts.owner` / `locations.owner` | — | — | **MISSING INPUT — does not exist** | Same: no backend writer |
| `ownershipHandoffCommand` | `functions/src/ownership/ownershipHandoffCommand.ts:78,200`; action emitted `:180` | the only producer of `action: "OWNERSHIP_HANDOFF"` | **INERT** — self-declared at `:7-14`: not exported from `index.ts`, no caller in the repo | COMMIT (it stages only, by design) |

### 7.3 Surface B — `firestore.rules` client-writable updates touching an ownership field

| Path | file:line | Ownership field reachable | Classification | Missing stage |
|---|---|---|---|---|
| `fieldops_jobs`, admin/dispatcher branch | statement `firestore.rules:381-391`; branch `:383-384` | `operatingCompanyId` — rewritable | **BYPASS DEFECT · TIER-2** | Everything after ENTRY: no field allowlist, no authority read, no pure validator, no audit. The technician branch `:386-390` *is* pinned by `jobStatusOnlyChange()` -> `hasOnly(['status'])` at `:350`; the admin branch is not |
| `accounts` | `firestore.rules:1335-1337` | `accountOwner` — rewritable | **BYPASS DEFECT · TIER-2** | Same. `accountGovernedFieldsUnchanged()` (`:1306-1309`) pins **only** `paymentTerms` and `taxStatus`; `accountOwner` is not named, and the leading `isAdmin() ||` at `:1337` skips the check entirely for admins. The seven-field completeness invariant `isCompleteAccountOwner()` exists **client-side only** (`field-ops-app-vite/src/domain/typedOwner.js`, `commercialProfile.js`) — the string `accountOwner` does not appear anywhere in `firestore.rules` |
| `locations` | `firestore.rules:1343` | `owner` — rewritable | **BYPASS DEFECT · TIER-2** | Everything after ENTRY. `allow create, update: if isAdminOrDispatcher();` — no constraint whatsoever |
| `contacts` | `firestore.rules:1557` | `owner` — rewritable | **BYPASS DEFECT · TIER-2** | Same |
| `equipment` | `firestore.rules:1542-1547`; allowlist `:1396-1401`, keys `:1371-1378` | `operatingCompanyId` — **NOT** reachable; absent from both `equipmentEditableKeys()` and `equipmentWritableKeys()`, so `affectedKeys().hasOnly(...)` denies adding it | **GOVERNED** (client-immutable) | none |
| `reorder_requests` | `firestore.rules:763-1001`; stated at `:247-250` | `operatingCompanyId` — **NOT** reachable; no branch's `hasOnly` names it | **GOVERNED** | none |
| `fieldops_technicians` | `firestore.rules:418-419` | none — the collection carries no ownership field | **NOT APPLICABLE** — EXCLUDED family, "person authority" (`ownershipMatrix.ts:515`) | n/a |

The three person-owned commercial families are Admin-SDK-only (`allow read, write: if false` at
`firestore.rules:1741` `opportunities`, `:1750` `sales_orders`, `:1795` `sales_agreements`), which is exactly
why `updateOpportunity` is the only route to `ownerEmployeeId`.

### 7.4 Surface C — operator scripts under `functions/scripts/`

| Path | file:line | Writes | Classification | Missing stage |
|---|---|---|---|---|
| `assignWarehouseRootCompany.js` | write `:231`, audit `:234`; handoff input `ownership/warehouseRootCompanyAssignment.ts:373-395` | `warehouses.operatingCompanyId` | **GOVERNED** — the only complete chain in the repo: ENTRY (CLI, dry-run default, two confirm flags `:147-155`) -> AUTHORITY READ (`txn.get` `:216`) -> PURE VALIDATOR -> WRITE (`txn.update` `:231`) -> AUDIT (`stageOwnershipHandoff` `:234`) -> COMMIT (one transaction) | none. In-file caveat at `:389-392`: `OWNERSHIP_HANDOFF_SOURCES` has no token for a *first* assignment, so `ADMIN_CORRECTION` is reused |
| `ownershipSandboxBackfill.js` | write `:233` (`tx.set(..., {merge:true})`) | 1,015 docs across the `operatingCompanyId` / `owner` families | **LEGACY** — sandbox-only, hard production refusal `:11-12`, never-overwrite `:21-22`, capped `:19-20` | **AUDIT.** No audit event is emitted; the only auditability is an id list printed to stdout (`:258`). Defensible in a bounded one-shot backfill, but it is a stage the handoff authority requires and this lacks |
| `certificationWorld/seedAccountOwners.mjs` | write `:223` (`batch.set({accountOwner}, {merge:true})`), commit `:226` | `accounts.accountOwner` | **LEGACY** — fixture seeder; dry-run default, `--apply` plus `--apply-live-*` | **AUDIT**, deliberately. Stated at `:50`: an ownership change "is an explicit audited act and is not what a seeding script does" |
| `financialReviewFixtures.mjs` | `:427` | sales-order docs carrying `ownerEmployeeId` / `operatingCompanyId` at creation | **LEGACY** — sandbox-only, `ALLOWED_PROJECT = "eos-platform-sandbox"` `:70` | n/a (creation) |
| `ownershipBackfillSimulation.js` | `:21-22` | nothing — "STRICTLY READ-ONLY. No Firestore write, and no `--apply` mode", asserted by `functions/test/ownershipProductionGuard.test.mjs` | **INERT** | n/a |
| `r32ProductionExposureCensus.js` | `:169-170` | nothing; `--read-only` is the only mode | **INERT** | n/a |
| `ownershipCensusDryRun.js`, `ownershipDerivationCheck.js`, `governance/effectiveAuthority.mjs`, `rulesRegressionRunner.mjs`, `verifyTruckRegistryDeployment.js`, `certificationWorld/data/*.mjs` | — | no ownership write | **INERT** / data modules | n/a |

### 7.5 Corrected `firestore.rules` allow-update inventory

Real counts: **25 total / 18 `if false` / 7 permissive — those three match the brief. The `hasOnly` count and
the "three unconstrained" list do not.**

| # | Line | Collection | Verdict |
|---|---|---|---|
| 1 | 381 | `fieldops_jobs` | **PARTIALLY constrained** — technician branch `hasOnly(['status'])`; **admin/dispatcher branch unconstrained** |
| 2 | 418 | `fieldops_technicians` | **unconstrained** (value-shape check `isTechnicianStatus` only, no field allowlist) |
| 3 | 497 | `employees` | if false |
| 4 | 509 | `fieldops_wos` | if false |
| 5 | 514 | `counters` | if false |
| 6 | 534 | `inventory_transactions` | if false |
| 7 | 539 | `inventory_sync_status` | if false |
| 8 | 549 | `receiving_orders` | if false |
| 9 | 763 | `reorder_requests` | **constrained** — `affectedKeys().hasOnly(...)` on every branch (773, 789, 805, 823, 871, 919, 975) |
| 10 | 1079 | `reorder_purchase_orders` | if false |
| 11 | 1129 | `reorder_purchase_order_voids` | if false |
| 12 | 1157 | `inventory_actions` | if false |
| 13 | 1178 | `warehouses` | if false |
| 14 | 1203 | `transfer_orders` | if false |
| 15 | 1231 | `mobile_locations` | if false |
| 16 | 1236 | `trucks` | if false |
| 17 | 1247 | `location_truck_claims` | if false |
| 18 | 1257 | `suppliers` | if false |
| 19 | 1262 | `supplier_catalog` | if false |
| 20 | 1267 | `purchase_orders` | if false |
| 21 | 1335 | `accounts` | **constrained by EQUALITY on `paymentTerms`/`taxStatus` ONLY** — `accountOwner` unconstrained; admins skip the check |
| 22 | 1343 | `locations` | **unconstrained** |
| 23 | 1542 | `equipment` | **constrained** — `affectedKeys().hasOnly(equipmentEditableKeys())` |
| 24 | 1557 | `contacts` | **unconstrained** |
| 25 | 1636 | `parts` | if false |

Corrections: **3 statements carry `hasOnly`, not 2** (381 partially, 763, 1542). **4 paths have no field
constraint, not 3** — 418, 1343, 1557 **plus** `fieldops_jobs:381`'s admin branch.

Context the 25-statement frame omits: a further **30** statements deny update without spelling the word —
`allow read, write: if false` at 1213, 1593, 1639, 1646, 1653, 1677, 1681, 1685, 1689, 1693, 1715, 1719,
1723, 1727, 1731, 1741, 1750, 1774, 1777, 1795, 1804, 1813, 1816, 1825, 1833, 1836, 1844, 1859, 1873, plus
`allow write: if false` at 429.

### 7.6 Accountability — empty by construction

| Check on `64008d5a` | Result |
|---|---|
| `grep -ci accountable` across `functions/src/ownership/**` | **0** — confirmed, all 12 files |
| widened to `functions/src/**` | **4 hits, all prose in comments**: `workOrderLabor/workOrderLaborCommand.ts:86`, `access/governedBusinessRoles.ts:1494`, `:1520`, `:1524` |
| `custodian` in `functions/src/**` | **0** |
| `accountableUserId`, `responsibleUserId` in `functions/**` | **0** |

**Accountability has no field anywhere in the functions runtime on this ref.** It exists only as an English
word in design commentary. The accountability half of this census is therefore **empty by construction**, and
the brief is right to anticipate that.

What it implies for **#184**'s bypass rule going forward: a bypass rule cannot police a field that does not
exist. There is no key to constrain in `firestore.rules`, no key to add to a `hasOnly` allowlist, no key for
a callable to refuse, and no value for an audit event to carry as `previousOwner`/`newOwner`. Any #184 bypass
rule scoped to accountability would be **vacuously true at baseline** — it would pass a test suite while
enforcing nothing, which is the same vacuity failure mode `post/eng-c-parity-vacuity` exists to detect on the
parity harness. **Introducing the field is a prerequisite for the rule, not a follow-on.** Until then #184's
rule can only be written against the ownership vocabulary in 7.1.

### 7.7 Brief corrections arising from the census

| # | Brief claim | Correct reading |
|---|---|---|
| B6 | path `functions/src/sales/opportunityCallables.ts` | **Does not exist on this ref.** Real path is `functions/src/opportunity/opportunityCallables.ts` |
| B7 | `updateOpportunity` "moves ownership **in production**" | **Refuted as stated.** The callable is gated on `opportunity.write`, registered `active: false` at `permissionCatalog.ts:159` — a hard deny for every principal until a separate Owner grant. `index.ts:39-41` states EXPORT != DEPLOY and REGISTER != GRANT. The mechanism and the missing-audit defect are real, but the path is **INERT**, not live. Calling it a production bypass overstates it — though the brief is right that on #184 it is a bypass defect and not "merely unwired" |
| B8 | it emits no `OWNERSHIP_HANDOFF` and writes a free-text `summary` (`:337-350`) | **CONFIRMED exactly.** `action: "updateOpportunity"`; `summary` at `:349` is free text listing changed field names only; the in-file comment `:343-348` concedes before/after values cannot be recorded. `ownerEmployeeId` arrives at `:387` and is applied at `opportunityCommands.ts:312-317`. Nothing in `functions/src` emits `OWNERSHIP_HANDOFF` except the INERT `ownershipHandoffCommand.ts` |
| B9 | `firestore.rules:381-384` | **CONFIRMED in substance, line range wrong.** The statement spans **381-391**; 381-384 is only its opening. The admin/dispatcher branch (383-384) has no field constraint; the technician branch (386-390) does, via `jobStatusOnlyChange()` at `:350` |
| B10 | "2 carry `hasOnly`" | **WRONG — 3**: lines 381 (partial), 763, 1542 |
| B11 | "three have no field constraint at all" | **WRONG — 4**: 418, 1343, 1557 **and** 381's admin branch. The brief is internally inconsistent here: its own `fieldops_jobs` claim asserts 381 is unconstrained while this count excludes it |
| B12 | `fieldops_technicians:418` offered as an unconstrained ownership surface | **Misleading.** It does lack a field allowlist, but the collection carries no ownership field and is EXCLUDED from the matrix as person authority (`ownershipMatrix.ts:515`). NOT APPLICABLE to an ownership census |
| B13 | "`accounts:1335` constrains by equality via `accountGovernedFieldsUnchanged()` — a different mechanism, not no constraint" | **True of the rule, false of ownership.** The helper pins only `paymentTerms` and `taxStatus`; `accountOwner` is unconstrained and `isAdmin() ||` bypasses the helper entirely. Presenting 1335 as "constrained" **understates** it: it is a bypass path for the root of the whole person-owned chain |
| B14 | implied: `locations:1343` and `contacts:1557` are simply unconstrained | Correct but incomplete. The ownership field there is `owner`, and **no backend writer for it exists**, so client Rules is its *only* mutation path — which makes the missing constraint the whole of the control, not a redundancy |

The brief's instruction stands and is reinforced: `fieldops_jobs` A/B is BUSINESS CASE NOT ESTABLISHED, so no
Change-Company operation is proposed here. All four rules findings are **TIER-2** and excluded from any
normal wave.

---

## 8. `employmentStatus` consumers (#186)

### 8.1 Verified vocabulary, mirror and test

`EMPLOYMENT_STATUS_VALUES` at `functions/src/access/employeeProfileCommands.ts:122-129` is
`Object.freeze([...])` over **ACTIVE, ON_LEAVE, INACTIVE, TERMINATED, RETIRED, CONTRACTOR** — exactly as the
brief states.

- Canonical client home: `field-ops-app-vite/src/domain/constants.js:36-43` (`EMPLOYMENT_STATUS`).
- Label layer: `field-ops-app-vite/src/domain/employeeVocabulary.js:41-51`.
- Metadata enum mirror: `field-ops-app-vite/src/metadata/definitions/employee.js:279`.
- Mirror-assertion test: `functions/test/employeeProfileCommands.test.mjs:570-582`.

**Brief correction (B15).** The six-value list is **not** mirrored in
`functions/scripts/provisionEmployeeAccess.js`. That script contains only
`const EMPLOYMENT_STATUS_ACTIVE = "ACTIVE";` (`provisionEmployeeAccess.js:212`, used at `:480` and `:563`).
The mirror test at `employeeProfileCommands.test.mjs:570` compares `EMPLOYMENT_STATUS_VALUES` against
`domain/constants.js`, **not** against the provisioning script, and says so explicitly: "The employment
vocabulary has never lived in the provisioning script -- that script only ever writes ACTIVE." The test that
*does* check a provisioning-script mirror (`:560-568`) mirrors `VALID_OPERATIONAL_ROLES`.

**Repo defect found in passing (independent of #186):** the file-header prose at
`employeeProfileCommands.ts:118-120` itself asserts that the provisioning script "holds the same two closed
sets". That prose is wrong, and the test at `:570` contradicts it.

**Brief correction (B16).** `operationalRoleContext.ts:51-52` is the **doc comment**, not the code. The
executable collapse is at `functions/src/access/operationalRoleContext.ts:123`, with the constant declared at
`:71`.

### 8.2 Consumer table

Policy column: **EA** = execution authority (may this principal act *now*), **AE** = accountability
eligibility (may this person be *newly* assigned), **RV** = reference validity (can this id resolve/display
on an existing record).

| Consumer `file:line` | Field read | Collapse | Policy | Classification | Justification |
|---|---|---|---|---|---|
| `functions/src/access/operationalRoleContext.ts:123` (const `:71`) | `employees/{id}.employmentStatus` | `!== "ACTIVE"` -> false | **EA** | **CORRECT FOR THAT SPECIFIC POLICY** | Resolves `ConditionContext.operationalRoleActive` — whether this principal may exercise a capability now. Mirrors Rules term-for-term; documented as an intentional fusion (ADR-012 section 2.2a) |
| `firestore.rules:118` (`isActiveOperationalRole()`) | caller's linked `employee.employmentStatus` | `== "ACTIVE"` | **EA** | **CORRECT** | Gates whether the *requesting* principal may act; all ~20 call sites are caller-authority grants. `field-ops-app-vite/firestore.rules` is byte-identical |
| `firestore.rules:145` (`isAssignedToWarehouse()`) | caller's linked `employee.employmentStatus` | `== "ACTIVE"` | **EA** | **CORRECT** | Same predicate, warehouse-scoped, still about the acting principal |
| `firestore.rules:494` | **subject** `resource.data.employmentStatus` | `== "ACTIVE"` on the Employee doc being read | **AE** | **CORRECT for that policy** — but see the coupled finding | Scopes a `PARTS_MANAGER` to picker candidates. Correct as an eligibility grant; the defect is that no reference-validity read grant exists beside it |
| `functions/src/access/adminCredentialCommands.ts:267` (const `:232`) | actor `employmentStatus` | `!== "ACTIVE"` -> deny `inactive-employment` | **EA** | **CORRECT** | The #187 `MI-R` case: a TERMINATED admin must not execute credential commands |
| `functions/src/access/adminCredentialCommands.ts:200` | target `employmentStatus` | `!== "ACTIVE"` -> `inactive-employment-target` | **AE** | **CORRECT** | Grants a new capability to the target rather than displaying them; the target stays listed and identifiable, just ineligible |
| `functions/src/truckRegistry/truckRegistryRepository.ts:199` (`isEmployeeActive`) | `employees/{id}.employmentStatus` | `=== "ACTIVE"` boolean | **AE** | **CORRECT** | Only two callers, both new-assignment gates; never used to resolve or display an existing driver |
| `functions/src/truckRegistry/truckRegistryCommands.ts:193` | via `isEmployeeActive` | throws `EmployeeInvalidError` | **AE** | **CORRECT** | Assigning accountability at `createTruck` time |
| `functions/src/truckRegistry/truckRegistryCommands.ts:277` | via `isEmployeeActive` | throws `EmployeeInvalidError` | **AE** | **CORRECT** | `assignDriver` / `reassignDriver` — a new accountability assignment |
| `field-ops-app-vite/src/domain/employees.js:25` (`buildAssignableEmployeesQuery`) | `where("employmentStatus","==",ACTIVE)` | query filter | **AE** | **CORRECT** | Header `:13-15` states the distinction; the companion `buildEmployeeDirectoryQuery()` (`:52`) is deliberately unfiltered for exactly the historical-resolution case #186 protects |
| `field-ops-app-vite/src/hooks/useAssignableEmployees.js:61-72` | via the above | eligible subset only | **AE** | **CORRECT** | Picker feed |
| `field-ops-app-vite/src/hooks/useDriverOptions.js:12` | via `useAssignableEmployees` | ACTIVE-only options | **AE** | **CORRECT** | Production "Current driver" *display* comes from a separate unfiltered resolver (`hooks/useTruckRegistrySource.js:63-65` -> `services/truckRegistryQueries.js:57`), so reference validity is preserved independently |
| **`field-ops-app-vite/src/modules/inventoryRole/PartsManagerHome.jsx:40-43`, `:68-80`, `:124`** | `employee.displayName` keyed off the ACTIVE-only **and** `PARTS_ASSOCIATE`-only assignable set | not in set -> `"Unknown assignee"` | **RV** — resolving the already-persisted `assignedToUserId` on existing Reorder Requests | **LOSSY / DEFECTIVE** | An assignee who has since gone ON_LEAVE / INACTIVE / TERMINATED / RETIRED, or who merely lost the PARTS_ASSOCIATE role, stops resolving on a *historical* record and becomes "Unknown assignee". The file's own comment at `:35-39` announces the substitution of an eligibility set for a directory read |
| `field-ops-app-vite/src/navigation/navConfig.js:637-639` (`hasEligibleOperationalRole`) | `operationalContext.employmentStatus` | `!== ACTIVE` -> false | **EA** | **CORRECT** | Mirrors `isActiveOperationalRole()` at the presentation layer for the *signed-in* user; says nothing about another person's reference |
| `field-ops-app-vite/src/metadata/definitions/employee.js:404-409` (saved view `active`) | `employmentStatus EQUALS "ACTIVE"` | optional saved-view filter | presentation filter (non-default; default is `recent`, `:403`) | **CORRECT** | User-selectable convenience view; the index itself is unfiltered (`:394`, `:400`) and the enum fully declared at `:279` |
| `functions/scripts/r32ProductionExposureCensus.js:69` | `employee.employmentStatus` | `!== "ACTIVE"` -> `[]` roles | **EA** | **CORRECT** | `:65-66` states it: "an operational role on a terminated employee is not live authority". It counts live authority, not identities |
| `functions/scripts/onboardEmployeeVerify.js:127-129` | `employee.employmentStatus` | `!== "ACTIVE"` -> failure | provisioning postcondition | **CORRECT** | Verifies what `provisionEmployeeAccess.js` just wrote, and that script only ever writes ACTIVE |
| `field-ops-app-vite/src/domain/employeeProfile.js:292-306` (`employmentStatusTone`) | `employee.employmentStatus` | **no collapse** — 6-way switch | presentation | **CORRECT** (non-collapsing; listed as the counter-example) | Distinguishes ACTIVE / ON_LEAVE+CONTRACTOR / TERMINATED+RETIRED+INACTIVE |

**Net result: exactly one LOSSY / DEFECTIVE consumer** — `PartsManagerHome.jsx`. Every other ACTIVE-only
collapse implements either execution authority or accountability eligibility, for which ACTIVE-only is the
correct policy under #187's `MI-R` clause. The brief's caution against mechanically condemning boolean
consumers was warranted: 17 of 18 collapses are correct.

**Coupled finding (not a separate defective consumer).** `firestore.rules:491-496` grants a `PARTS_MANAGER`
only the ACTIVE assignment-candidate read of `employees`; the unconditional directory read is
`isAdminOrDispatcher()`-only. So `PartsManagerHome.jsx`'s collapse is not merely a code shortcut — at this ref
**there is no reference-validity read path a PARTS_MANAGER could use.** The eligibility grant is correct for
its own policy; what is missing is a companion narrow read, or a server-resolved name projection, for ids
already persisted on records the manager may legitimately see. This is the concrete shape of #186's
"fix consumers, not the vocabulary" — and here the consumer fix requires a Rules or projection change, not
just a client edit.

### 8.3 Non-consumers checked and cleared (reference validity intact, unfiltered)

`field-ops-app-vite/src/domain/employees.js:52` · `hooks/useEmployeeDirectory.js:33-60` ·
`domain/actorDisplayName.js:30` · `modules/inventory/PartsList.jsx:356-359` ·
`modules/inventory/PartDetail.jsx` (all `resolveActorDisplayName` sites) ·
`services/truckRegistryQueries.js:45-57` ·
`functions/src/access/recordChangeHistoryReadService.ts:146-157,197-201` ·
`functions/src/access/trustedWriterCommands.ts:1537-1547` ·
`functions/src/access/adminCredentialCallables.ts:104-116,183-204` (pass-through into facts) ·
`functions/src/reporting/reportCatalog.ts:96` (employee object registered with no status filter) ·
`field-ops-app-vite/src/auth/employeeSession.js`, `auth/employeeSessionResult.js:24`,
`auth/AuthContext.jsx:98,144` (verbatim pass-through) ·
`field-ops-app-vite/src/metadata/definitions/truck.js:204-211` (REFERENCE field, no eligibility filter).

Confirmed **not** an `employmentStatus` consumer: `modules/technicians/Technicians.jsx` reads the disjoint
`fieldops_technicians` collection (`field-ops-app-vite/test/techniciansSurfaceEmployeeDivergence.test.jsx:1-45`).

---

## 9. UNPROVEN / MISSING INPUT / NOT_RUN

| Item | Status |
|---|---|
| Tests for `d9b63963`, `3c554144`, `f1ddf2b7`, `17a96ed3`, `ab61540c`, `7cbca122`, `8af319d0` | **NOT_RUN** — out of this pass's budget. Not a failure; must not be relabelled |
| Whether `opportunity.write` is granted in any live project | **UNPROVEN.** `permissionCatalog.ts:159` is `active: false`, but `environmentCapabilityOverrides.ts:122`, `:482` and `policySeedSnapshot.json:615` also name the capability. The effective live grant requires deployed policy state, which is not in the repo. The INERT classification of `updateOpportunity` holds **for the catalog baseline only** |
| Whether `firestore.rules` on this ref is what is deployed | **UNPROVEN.** Not determinable from the ref. `functions/scripts/verifyFirestoreDeployment.js` exists for this purpose; it was not run (no production contact in this lane) |
| Live counts behind the matrix's census annotations (e.g. "0/103 accountOwner", "1015/1015 trucks" at `ownershipMatrix.ts:116`, `:359`) | **UNPROVEN** — in-file assertions about sandbox data, not verifiable from source |
| Whether `suppliers` is company-scoped | **UNPROVEN** — self-declared OPEN QUESTION at `ownershipMatrix.ts:496-504`, pending an Owner ruling. Either way `firestore.rules:1257` is `if false`, so no new bypass appears |
| `OWNERSHIP_HANDOFF_SOURCES` has no token for a first assignment | Open gap recorded in-file at `warehouseRootCompanyAssignment.ts:389-392`, which reuses `ADMIN_CORRECTION`. Noted, not resolved |
| `TruckManagementPreview.jsx:63,89` — `resolveDriverName` from the ACTIVE-only `driverOptions` map | **UNPROVEN.** Same shape as the `PartsManagerHome` defect, but the component is imported by nothing (no route; `FIXTURE_DRIVERS` default at `:42`). Cannot establish it is a live surface, so not classified |
| `ManageTruckDrawer.jsx:39,104-107` — `BoundedSelect value` seeded from `record.assignedDriverEmployeeId`, possibly absent from the ACTIVE-only options | **UNPROVEN.** The current-driver *display* is separate and safe (`:95`). Whether the mismatched select value is a real bug depends on `BoundedSelect`'s unmatched-value behaviour, not judged. The gate itself is AE and correct |
| `bootstrapIssue100VerificationFixtures.js:218-220,624,895,913`; `certificationWorld/data/workforce.mjs:236-237`, `build.mjs:273` | Fixture/seed writers, not consumers. `workforce.mjs:236` is a no-op ternary (`"ACTIVE" : "ACTIVE"`) that looks like leftover scaffolding; `:237` sets a separate `active: true` boolean. Outside a consumer audit |
| Repo-root `node_modules` for the shim-boundary suite | Not present in the chosen donor. Immaterial — `post/eng-b-firebase-guard`'s tests use only `node:` builtins and pass on a bare archive |

---

## 10. Summary of brief corrections

| # | Subject |
|---|---|
| B1 | Five named refs are local-only, not at origin |
| B2 | p2c2's residual over eng-d is three operator scripts, not one |
| B3 | `post/eng-c-parity-vacuity` also modifies `inventoryCapabilityParityHarness.js`, colliding with p2c2's residual fence; eng-d and p2c2 install two competing guard modules |
| B4 | p2l's NUL bytes are a deliberate glob sentinel, not corruption; the script runs correctly. Merge/reviewability defect, trivially fixable |
| B5 | **No Task-1 candidate touches `firestore.rules`.** There is no Tier-2 item in the executable-fix set |
| B6 | `functions/src/sales/opportunityCallables.ts` does not exist; the path is `functions/src/opportunity/...` |
| B7 | `updateOpportunity` is gated on an `active: false` capability — INERT at the catalog baseline, not live in production |
| B9 | The `fieldops_jobs` statement spans `firestore.rules:381-391`, not 381-384 |
| B10 | 3 allow-update statements carry `hasOnly`, not 2 |
| B11 | 4 paths have no field constraint, not 3 (the brief is internally inconsistent on `:381`) |
| B12 | `fieldops_technicians:418` carries no ownership field — NOT APPLICABLE to this census |
| B13 | `accounts:1335` is a bypass path for `accountOwner`; calling it "constrained by equality" understates it |
| B15 | The six-value employment vocabulary is **not** mirrored in `provisionEmployeeAccess.js`; the mirror test targets `domain/constants.js`. The in-repo header prose at `employeeProfileCommands.ts:118-120` is wrong |
| B16 | The `operationalRoleContext.ts` collapse is at `:123` (const `:71`); `:51-52` is the doc comment |

Confirmed as stated: the reporting-chain identity and both ancestor claims; `p2h` independent and superseded;
the `inventoryCapabilityParityHarness.js` no-project-argument / ambient-ADC finding; the p2l NUL byte count
and its merge-blocking effect; the `updateOpportunity` missing-`OWNERSHIP_HANDOFF` / free-text-`summary`
finding at `:337-350`; `fieldops_jobs` admin-branch `operatingCompanyId` rewritability; the 25 / 18 / 7
allow-update counts; the accountability grep returning 0; and `EMPLOYMENT_STATUS_VALUES` at
`employeeProfileCommands.ts:122-129`.
