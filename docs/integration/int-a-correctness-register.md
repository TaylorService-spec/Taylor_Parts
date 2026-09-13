# INT-A-CORRECTNESS — integration register for the post-Wave-1 program

**Lane:** INT-A-CORRECTNESS · **Mode:** CODE_WRITE (this document only) · **Single integration writer:** controller
**Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` = `ATLAS-BASE-2026-09-12-A` = `origin/main`
**Baseline verified against the live remote**, not only locally: `git ls-remote --heads origin main` → `64008d5a…`. `origin/main` is **unmoved**.
**Date:** 2026-09-13

## 0. What this document is, and is not

It is the **classification** of every branch this program produced, against the code that is actually on
`main` today. It decides what should be integrated, in what order, and what must not be.

It is **not** an integration. No branch is merged by this document. No `firestore.rules` change is
authorized by it. It executes nothing against any environment.

**Reliability order used throughout:** EXECUTED BEHAVIOUR > SOURCE + CONFIG RECONCILIATION > STATIC
SOURCE READING. Where a classification rests only on the third, it says so.

---

## 1. A correction to a blocker this program has been reporting

`gh auth status` reports no GitHub host, and this run has repeatedly recorded that as
**GITHUB_AUTH_REQUIRED** without qualifying it. That was too broad.

| Operation | Transport | Status |
|---|---|---|
| `git fetch` / `git ls-remote` / `git push` | SSH key | **WORKS** |
| PR create / PR list / PR state / CI status | GitHub REST API (token) | **BLOCKED** |

So the accurate statement is: **branch publication is available; pull-request and CI operations are not.**
Anything in this program that was deferred as "blocked on GitHub auth" when it only needed a push was
deferred on a wrong premise. Correcting it forward, not retroactively.

## 2. §17 — PR movement since the open-PR register

Re-run with the same API-free method the register used (`git ls-remote origin 'refs/pull/*/head'`):

| Measure | At the register | Now | Δ |
|---|---|---|---|
| `refs/pull/N/head` refs | 1,792 | **1,792** | **0** |
| Highest PR number | 1898 | **1898** | **0** |
| `origin/main` | `64008d5a` | **`64008d5a`** | **unmoved** |

**No new pull request has been opened and none has been force-pushed into existence.** The register's
dispositions therefore stand unchanged.

**Still unverifiable without the API:** whether any of the register's 71 candidates changed between
open and closed-unmerged. A close leaves the ref in place, so ref equality cannot detect it. This is
**UNPROVEN**, not "unchanged."

**The register's own caveat is restated because it is easy to misread:** `refs/pull/N/head` exists for
open, closed-unmerged *and* merged PRs. **71 is not an open-PR backlog and must not be quoted as one.**

---

## 3. Method

For every branch this program created:

1. `git merge-base --is-ancestor <branch> origin/main` → **ABSORBED** if true. This is ancestry, not
   content similarity, and it is the only test that proves absorption outright.
2. Otherwise, per file, `git diff origin/main..<branch> -- <file>` → **SAME-AS-MAIN** when empty
   (content already present by some other route), **DIVERGES** otherwise.
3. Rebase exposure measured as the intersection of *files the branch changed since its merge-base* with
   *files `main` changed since that same merge-base*. Set intersection, not a conflict simulation — it
   bounds the risk, it does not prove a textual conflict.
4. Supersession established by ancestry first; where two branches are independent and touch one file,
   by reading both versions of that file.

Docs-only branches are separated out rather than dropped: they are not correctness-integration
candidates, but several are the run's evidence and are listed in §8 so they are not silently lost.

---

## 4. The systemic integration hazard — read this before merging anything

**14 candidate branches each add a `node --test` glob to the same `functions/package.json` scripts
block.** That single file is the only overlap between `main` and almost every night-run branch:

| Branch | Files it changed since merge-base | Files also changed on `main` since then |
|---|---|---|
| `night/p2c1-parity` | 2 | **0** |
| `night/p2c2-adc-failclosed` | 14 | 1 — `functions/package.json` |
| `night/p2f-nonprod-blockers` | 8 | 1 — `functions/package.json` |
| `night/p2g-capability-request-blindness` | 8 | 1 — `field-ops-app-vite/test/suites.json` |
| `night/p2h-report-scope-bound` | 4 | 1 — `functions/package.json` |
| `night/p2i-stale-authority-claims` | 56 | 1 — `functions/package.json` |
| `night/p2j-onhand-derivation` | 7 | 1 — `functions/package.json` |
| `night/p2k-finance-detectors` | 7 | 1 — `functions/package.json` |
| `night/p2l-functions-test-registration` | 4 | 1 — `functions/package.json` |
| `night/p2m-sandbox-project-resolution` | 10 | 1 — `functions/package.json` |
| `night/p2n-governed-role-resolution` | 2 | 1 — `functions/package.json` |
| `night/p30-identity-standard` | 3 | 1 — `functions/package.json` |
| `night/p30b-business-numbers` | 21 | 1 — `functions/package.json` |
| `atlas/p30b-identity-verification` | 4 | 1 — `functions/package.json` |

This is the good news and the trap in the same table. Even `night/p2i-stale-authority-claims`, which
changes **56 code files**, overlaps `main` on **one** — and that one is a test-registration line, not
business logic. Semantic conflict risk across the night run is far lower than its size suggests.

**The trap.** `node --test` resolves each positional argument as path-or-glob and takes the **union** of
what matches. It errors only when the union is **empty** *and* one argument was a literal path.
**A non-matching argument is silently dropped when any other argument resolves.** So a
`functions/package.json` whose merged test script names a glob for files that did not land will
**pass, reporting success, having run fewer tests than it claims.**

**Therefore, mandatory after every merge into this sequence:** assert that each glob in the merged test
script matches at least one file. A merge is not verified by a green test run; it is verified by a green
test run *plus* proof that the run covered what the script names. `night/p2l-functions-test-registration`
exists to ratchet exactly this, which is why it is sequenced early in A1.

**A second `p2l`-specific hazard:** `functions/test-registration-baseline.json` is a recorded baseline.
It must be **regenerated after rebase**, never merged as-is, or it ratchets against a tree that no
longer exists.

---

## 5. INTEGRATION A1 — normal correctness

No `firestore.rules` change. No migration. No credential or environment-authority change. These may
proceed as ordinary correctness work once each is rebased and re-proven.

| Order | Branch | What it fixes | Code files | Rebase exposure | Evidence grade |
|---|---|---|---|---|---|
| A1-1 | `night/p2l-functions-test-registration` | Test-registration ratchet — closes the silently-dropped-glob hole that every later merge depends on | 4 | `functions/package.json` | EXECUTED (own lane) |
| A1-2 | `fix/crash-diagnostics-flake` | Crash-id test flake, reproduced at 30/4000 = 0.750%, fixed by `Object.defineProperty` injection; 200/200 deterministic after | 2 | **none** — based on `main` | **EXECUTED, reproduced and re-proven** |
| A1-3 | `post/eng-a-audit-read` | Record-change-history read service default role catalogue | 4 | **none** — based on `main` | EXECUTED (own lane) |
| A1-4 | `post/eng-c-parity-vacuity` | The inventory capability parity harness could pass **vacuously**; adds classification + vacuity tests | 5 | **none** — based on `main` | EXECUTED (own lane) |
| A1-5 | `night/p2c1-parity` | Inventory capability **grant migration CLI** (a different file from A1-4 — see §6.2) | 2 | **none** | EXECUTED (own lane) |
| A1-6 | `night/p2n-governed-role-resolution` | Governed-role binding test. **Test-only** — 237 added lines, no `src` change | 2 | `functions/package.json` | EXECUTED (own lane) |
| A1-7 | `night/p2k-finance-detectors` | Finance detector wiring + financial reconciliation | 7 | `functions/package.json` | EXECUTED (own lane) |
| A1-8 | `night/p2j-onhand-derivation` | On-hand **sign authority** unified to one source; `cycleCountExpectedQuantity.ts` now **refuses** an impossible negative rather than clamping it to 0 | 7 | `functions/package.json` | EXECUTED (own lane) |
| A1-9 | `night/p2f-nonprod-blockers` | Administration object drift, technician identity trap, repo graph | 8 | `functions/package.json` | EXECUTED (own lane) |
| A1-10 | `night/p2g-capability-request-blindness` | Client gates a capability it **never requests** — 153-line `shellCapabilityGates.js` + 249-line coverage test | 8 | `field-ops-app-vite/test/suites.json` | EXECUTED (own lane) |
| A1-11 | `atlas/p30b-identity-verification` | Record-id standard + property tests. Supersedes `night/p30-identity-standard` | 4 | `functions/package.json` | EXECUTED (own lane) |
| A1-12 | `rpt/client-outcome-honesty` | **The reporting chain HEAD** — false-empty honesty, audit-context injection, row-scope bound, client outcome contract. 21 code files | 21 | **none** — based on `main` | EXECUTED (own lane) |

**A1-8 is a behaviour change, not a refactor, and must be reviewed as one.** Clamping a negative
on-hand to `0` made every unit a counter physically finds read as *surplus* against an expected `0`;
reconciliation then posts an `ADJUSTED` for the whole counted quantity and "corrects" the ledger toward
a figure the clamp invented. The branch refuses instead. That is the right call — but it converts a
silent wrong answer into a visible refusal on a live operator path, and somebody will see a new error.

**A1-12 ordering is not negotiable.** Reporting is the **only** domain with production capability
activations, so it is the only chain whose behaviour a production user can currently reach. It goes
last in A1 so that the test-registration ratchet (A1-1) is already guarding the merge that matters most.

## 6. Supersession — do not merge these

| Branch | Superseded by | Basis |
|---|---|---|
| `post/eng-e-report-scope` | `rpt/client-outcome-honesty` | **strict ancestor** — proven by `merge-base --is-ancestor` |
| `rpt/false-empty-and-audit` | `rpt/client-outcome-honesty` | **strict ancestor** |
| `night/p2h-report-scope-bound` | `rpt/client-outcome-honesty` | independent, not an ancestor. Both create `functions/src/reporting/reportRowScope.ts`: **236 lines** on `p2h`, **358** on the chain. Content subsumed |
| `night/p30-identity-standard` | `atlas/p30b-identity-verification` | **strict ancestor** |
| `atlas/guard-admin-firestore` | `post/eng-b-firebase-guard` | independent, not an ancestor — see §6.1 |

### 6.1 `scripts/firebaseExitGuard.mjs` — three versions, and a number that disagrees

| Ref | Lines | Base |
|---|---|---|
| `origin/main` | 406 | — |
| `atlas/guard-admin-firestore` | 474 | `33945090` (**pre-merge**) |
| `post/eng-b-firebase-guard` | 577 | `64008d5a` (**`main`**) |

`eng-b` is a strict refinement of the same design, not a rival one: same header, same namespace-form
bypass analysis, plus `.mjs` in `SCAN_EXTENSIONS` (without which `integrations/` was walked but every
file in it was invisible to the classifier — a bypass, not a filter), plus `integrations` as a third
scan root, plus `categoryOwnsPath`. **`eng-b` wins on both correctness and base.**

**A discrepancy to resolve during the A2 merge, not to paper over:** `atlas/guard-admin-firestore`
documents a **369-entry** baseline; `post/eng-b-firebase-guard` documents **366 guarded entries**. Two
values for one measured baseline. Only one can be right for the tree being merged, and the number is
load-bearest — it is what the ratchet compares against. **Re-derive it on the rebased tree; adopt
neither figure on the strength of its comment.**

This file is also where this program's **third branch-provenance violation** occurred: "12 categories /
roots are not a per-file filter" were read from PR #1898 and reported as facts about `main`. Both
statements were true of the branch and false of the product. Hence the re-derivation requirement above.

### 6.2 A correction to this lane's own first pass

An earlier pass of this classification listed `night/p2c1-parity` and `post/eng-c-parity-vacuity` as a
conflicting pair on `functions/scripts/inventoryCapabilityParityHarness.js`. **Wrong.** `p2c1` does not
touch that file at all — its two files are `inventoryCapabilityGrantMigrationCli.js` and its test. The
pair is independent and both are needed. Recorded because the error came from matching on lane *topic*
instead of on the file set, which is exactly the mistake this register exists to prevent.

## 7. INTEGRATION A2 — Firebase guard / migration safety / environment authority

**Separated from A1 deliberately, and must not be smuggled into a normal correctness change.** Each of
these changes what the system is *permitted to reach*. A reviewer approving a test fix is not thereby
approving a change to credential fencing.

| Order | Branch | What it changes | Code files | Why A2 |
|---|---|---|---|---|
| A2-1 | `post/eng-b-firebase-guard` | Firebase-exit guard + shim boundary; widens the fence to `integrations` and `.mjs` | 5 | Changes what the guard **forbids**. Widening a fence can fail builds that previously passed |
| A2-2 | `post/eng-d-environment-fence` | Operator-script environment fence — `projectTargetGuard.js`, 7 scripts fenced, 234-line test | 11 | **This is the fence the Owner ruled must never be weakened.** Merging it is the only way to stop weakening it by omission |
| A2-3 | `night/p2c2-adc-failclosed` — **RESIDUE ONLY** | Fences `inventoryCapabilityParityHarness.js`, which on `main` takes **no project argument at all** and binds Firestore from **ambient ADC** | **2 of 14** | Closes an ambient-targeting hole in a script that reads Firestore and Postgres. Must be applied **after** A1-4, which rewrites the same file. See §7.1 |
| A2-4 | `night/p2m-sandbox-project-resolution` | `sandboxTargetGuard.js` + 3 backfill/repair CLIs fenced to sandbox | 10 | **Data-migration CLIs.** An unfenced backfill CLI is the highest-consequence unguarded surface in the repo |

### 7.1 `night/p2c2-adc-failclosed` is PARTIALLY superseded — and the residue is ONE file, not four

For the 7 files both branches touch, `post/eng-d-environment-fence` wins: it is based on `main`
(`p2c2` is based on `d104cf49`, pre-merge) and its fence is larger
(`generatePasswordResetLink.js`: `main` 69 lines → `p2c2` 128 → **`eng-d` 148**).

`p2c2` covers 4 files `eng-d` never touches. **A first pass of this register claimed all four were
unfenced on `main`. That was wrong for three of them, and it was wrong in the specific way this register
warns about: a static negative over a chosen marker set.** Searching for `EOS_TARGET_ENV`,
`requireExplicitEnvironment`, `projectTargetGuard`, `assertTarget` and `environmentTargetShared` returned
zero matches — because `main` fences by a **different mechanism with different names**.

| File | On `main`? | Actual state on `main` | Residue needed? |
|---|---|---|---|
| `functions/scripts/operatorAccessCommand.js` | yes | **FENCED** — `assertProjectTarget()` at `:109-121`: `--projectId` **required, no default**; `--projectId taylor-parts` additionally requires exact-match `--confirmProduction`; checked **before `initializeApp()`** at `:382-395` | **no** |
| `functions/scripts/productionFoundationVerification.js` | yes | **FENCED** — same pattern at `:85-97`, and its own comment says it matches `operatorAccessCommand.js` deliberately | **no** |
| `functions/scripts/environmentTargetShared.js` | **absent** | n/a — it is `p2c2`'s new shared fence module | only as the vehicle for the row below |
| `functions/scripts/inventoryCapabilityParityHarness.js` | yes | **UNFENCED** | **YES** |

**The one real hole, and it is a good one.** `inventoryCapabilityParityHarness.js` on `main` requires
`--tenant` and at least one `--subject` (`:264`, `:270`) and **takes no project or environment argument
at all**. Its own comment at `:254-258` states the operator contract: it reads Postgres from
`POLICY_TEST_DATABASE_URL` or the standard config and Firestore from **"a live Firestore credential
(GOOGLE_APPLICATION_CREDENTIALS / ADC)"**. It reaches `getFirestore()` with no app of its own — so it
binds to whatever the ambient environment already initialised.

That is precisely the pattern the standing ruling forbids: **NO EXPLICIT ENVIRONMENT = REFUSE**, and do
not infer the environment from ambient credentials. Run this harness on a machine holding production
ADC and it reads production, with no flag anywhere in the invocation naming production.

`p2c2` closes it, and finds a second trap while doing so that this register had not identified:
**`GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` silently supply the capability-*activation* environment,
which is a different thing from the Firestore project being read.** A deployed Cloud Function always has
`GCLOUD_PROJECT` set by the runtime; an operator laptop often has one set too. So `p2c2` requires **both**
to be stated and to **agree** — `assertProjectTarget`, `assertResolvedProjectId` and
`assertCapabilityActivationProject`, all before any Firestore or Postgres client is constructed.

**Action:** port `environmentTargetShared.js` plus the `inventoryCapabilityParityHarness.js` fence onto
`eng-d`. Drop `p2c2`'s changes to `operatorAccessCommand.js` and `productionFoundationVerification.js` —
`main` already fences both, and re-fencing them risks regressing a working guard.

**Note the collision:** `post/eng-c-parity-vacuity` (A1-4) also rewrites
`inventoryCapabilityParityHarness.js`, to 535 lines, for vacuity rather than fencing. Two lanes, one
file, two unrelated concerns — **both needed, and they must be sequenced, not chosen between.** Take
`eng-c`'s vacuity version first (A1-4), then apply the fence on top (A2-3). Doing it in the other order
means resolving the fence into a file that is about to be rewritten.

## 8. TIER-2 HOLD — Owner decision required, not a correctness merge

| Branch | Code files | Why held |
|---|---|---|
| `night/p2i-stale-authority-claims` | 56 | Changes **`firestore.rules` and `field-ops-app-vite/firestore.rules`** (13+/2- each), **`permissionCatalog.ts` ×2 mirrors** (123+/48-), **`functions/src/index.ts`** (53+/29-), `compatibilityRoles.ts`, `governedBusinessRoles.ts`. This is the capability and Role surface |
| `night/p30b-business-numbers` | 21 | Changes **`firestore.rules`** (11+/0-) and the numbering authority of **9 business domains** at once (WO, invoice, opportunity, sales order, sales agreement, transfer, receiving, reorder). Includes `backfillOperationalNumbering.mjs` — a **data-migration script** |

Both are **held, not rejected.** Both contain real fixes. Neither may move without the Owner's Tier-2
authorization, and `p30b` additionally implies a production data migration that is prohibited outright
under the standing rulings.

`p2i` carries a further reason for care: it edits `permissionCatalog.ts` in **both** mirrors, and the
48 removed lines are `main`'s content the branch has not seen. On a 123+/48- change to the capability
catalogue, "rebase and re-run the tests" is not sufficient review.

### 8.1 A live TIER-2 defect that NO candidate branch fixes

Surfaced by the OWN-ENGINEERING-GAP lane and independently verified here by reading
`firestore.rules` at the baseline. It is recorded in this register because the register's job is to say
what integration covers, and **nothing in A1, A2 or the TIER-2 HOLD set touches it.**

**`firestore.rules:381-384` — `fieldops_jobs` update, admin/dispatcher branch:**

```
allow update: if resource.data.status != 'complete'
  && (
    (isAdminOrDispatcher()
      && isValidJobTransition(resource.data.status, request.resource.data.status))
```

There is **no `affectedKeys().hasOnly(...)` allowlist on this branch.** The technician branch below it
has one — `jobStatusOnlyChange()` — and the block's own comment explains that it "makes
technicianId/workOrderId/customer/address/completedAt/completedBy or any other field client-immutable
**in this transition**." That qualifier is doing more work than it looks: the immutability applies to the
*technician* path only. An admin/dispatcher performing any valid status or assignment transition may
rewrite **every other field on the document in the same write**, including `operatingCompanyId` — a
populated ownership field.

This is the standing ruling *reassignment ≠ ownership transfer* violated in shipped Rules, and it is a
better example than the one this program had been citing.

**Correcting what this program had been citing instead.** I have repeatedly named
`firestore.rules:765-790` on `reorder_requests` as the site where ownership moves with assignment. That
was wrong in two independent ways, and both matter:

1. **Wrong lines.** The `allow update: if` opens at `:763`. The **Approve/Reject** branch (`:764`ff)
   changes `currentOwner` with **no assignee named at all** — a counter-example. The branch that moves
   `currentOwner` *and* `assignedToUserId` together is the **Assign** branch, whose allowlist is
   `hasOnly(["status", "currentOwner", "assignedToUserId", "assignedBy", "assignedAt"])`.
2. **Wrong field semantics, which is the more serious error.** `currentOwner` on `reorder_requests`
   holds a **role string** — the literal values in the Rules are `"PARTS_MANAGER"` and
   `"PARTS_ASSOCIATE"`. It is a workflow **baton**, not a record owner, and
   `ownershipMatrix.ts:286-288` accordingly does not treat it as an ownership field. Moving a baton
   alongside an assignment is the correct behaviour for a queue hand-off. **There was no defect at that
   site.** Citing it made a correct Rules block look like a ruling violation while the real violation sat
   uncited a few hundred lines above.

**SEVERITY, CORRECTED DOWN — and this register overstated it.** The TIER2-RULES-PACKET lane established
three things that narrow the finding materially, and they belong here because §8.1 as first written read
as a privilege-escalation report:

- **`operatingCompanyId` is NOT read for authority on this family.** The one live read is FIN-004
  `financialVisibility.ts:170`, which matches a *grant's* bound value against `invoice.companyId` —
  invoices, not jobs. Zero `allow` predicates, zero client guards, zero `where('operatingCompanyId', …)`
  queries touch it on `fieldops_jobs`.
- **It is `0/12` in production.** 41/45 in sandbox, never backfilled to production. So the exposure is
  **authoring a false company fact**, not corrupting a true one.
- **Reachability is narrower than "any valid transition."** The branch is reachable only bundled with one
  of four `isValidJobTransition` edges; a field-only patch yields `from == to` and is already denied.

So this is **a standing-ruling violation and an ownership-integrity defect, not privilege escalation.**
Still TIER-2 — it is a `firestore.rules` change on a declared owner field — but it must not be escalated
in tone beyond what the evidence carries.

**Two things that got WORSE on inspection.** The mutable-field set is **unbounded, not a 19-key list**:
with no `keys()` or `affectedKeys()` constraint on the branch, arbitrary *new* keys and key *removals* are
permitted too, so 19 is a lower bound derived from known writers and docs. And **there is zero test
coverage** for field immutability against admin/dispatcher on this collection — of 14 update assertions in
`legacyJobsTechniciansRules.test.js`, 12 are on the technician branch and the 2 on admin/dispatcher test
the outer guard, not fields.

**The minimum correction is a no-op for every live writer.** `hasOnly(['status','technicianId'])` as one
added conjunct — the `jobStatusOnlyChange()` pattern 32 lines above. Verified against `assignJob`
(`{technicianId, status}`), `updateJobStatus` (`{status}`), `completeAssignedJob` (Admin SDK, unaffected),
`createJob` (orphaned) and `jobsStore.update` (stamps nothing). `['status']` alone would break the
existing ALLOW at `:214`.

**A citation correction that affects this whole program.** **No document in the repository contains the
phrase "reassignment ≠ ownership transfer"** — zero matches, likewise "manager intervention ≠ …". The
substance holds and is real, but it must be cited to where it actually lives: DECISIONS **#142** at
`:3277-3279`, non-collapse at `:3307-3310`, `ownershipMatrix.ts:199-201,271`, and **#110** at `:1601-1606`,
where the Owner enumerates what a reassignment records — **and company is absent from that list.** This
program has been quoting a ruling by a paraphrase of its name. That is the same failure as the
`CURRENT_SUPPORTED_SERVER_KINDS` one: a paraphrased identifier is indistinguishable from a verified one
once written down.

**SCOPE NOTE — the denominator here was wrong, and it understated the finding roughly fourfold.** An
earlier revision said *"5 of 30 `allow update` statements are permissive with no `hasOnly` allowlist."*
Re-counted at the baseline:

| Measure | Count |
|---|---|
| `allow [create, ] update` statements in `firestore.rules` | **25** |
| …of which are `if false` — closed to every client | **18** |
| …of which permit a client update | **7** |

So the correct framing is **5 of 7 client-writable statements, not 5 of 30.** *"5 of 30"* reads like a
rounding error; **5 of 7 is a structural property of the file.** The 18 closed statements are not a
denominator — they are the pattern the other 7 depart from.

**And "no allowlist" flattened four distinct mechanisms, which would have overstated two of them.** The
seven, each verified for **helper-wrapped** allowlists as well as inline ones — because a literal `hasOnly`
search misses `jobStatusOnlyChange()`, and missing it is how this register got §7.1 wrong once already:

| Statement | Field constraint | Verdict |
|---|---|---|
| `reorder_requests:763` | inline `hasOnly` ×2 | **allowlisted** |
| `equipment:1542` | inline `hasOnly` + `equipmentNameValid()` / `equipmentCreateShapeValid()` | **allowlisted** |
| `fieldops_jobs:381` | `jobStatusOnlyChange()` **on the technician branch only** | **THE DEFECT** (§8.1) — allowlisted on one branch of two |
| `accounts:1335` | `accountGovernedFieldsUnchanged()` — constrains governed fields **by equality, not by allowlist** | constrained by a **different mechanism**; **not** "no field constraint" |
| `fieldops_technicians:418` | helpers are `isAdminOrDispatcher()` / `isSignedIn()` — **neither contains `hasOnly`** | **no field constraint** |
| `locations:1343` | `isAdminOrDispatcher()` only | **no field constraint** |
| `contacts:1557` | `isAdminOrDispatcher()` only | **no field constraint** |

**Three statements have no field constraint of any kind** — `fieldops_technicians`, `locations`,
`contacts` — and one is allowlisted on only one of its two branches, which is the `fieldops_jobs` defect
this register already carries. **`accounts` is NOT in that group** and must not be reported as if it were.

**Still reported and deliberately NOT expanded:** the three unconstrained statements and `accounts`'
equality mechanism are **unassessed**. This register makes no claim about whether any of them is
exploitable, only about what the predicates do and do not constrain.

**Disposition:** TIER-2, no candidate, no authorization. It needs a `firestore.rules` change and
therefore an Owner ruling, and it must not be folded into any A1 or A2 merge.

**UNPROVEN:** that the write is reachable in practice — this is a static read of the Rules, and the
Firestore emulator could not be run in this environment (no JRE available; port 8080 held by an
unrelated process). Whether an `operatingCompanyId` rewrite through this branch actually succeeds
against deployed Rules has **not** been executed. Both the `hasOnly` absence and the role-valued
`currentOwner` were read directly from the file at `64008d5a`.

## 9. Discarded

| Branch | Why |
|---|---|
| `scratch/p1b-integration-dryrun` | A rehearsal branch. **7 of its 11 code files are byte-identical to `main`** (absorbed via the P1-B impl branches); the 2 that diverge do so mostly by *lacking* `main`'s content. Nothing to integrate |

**A note on this branch's own paperwork.** `docs/integration/w1-integration-rehearsal.md:21` on this
lineage reads "The tree goes from 7 migrations to 18." That is a true statement about two git trees. It
was re-voiced overnight as the live measurement **"7 of 18 migrations,"** propagated through the whole
run, and appears in **no** input as a measurement. It is **withdrawn and must never be reused.**
Verified: **7 pre-merge, 18 at baseline, 5 schemas, 54 tables, 3 views.**

## 10. Absorbed — proven ancestors of `origin/main`

`integration/wave-1` · `impl/p1b-part-tracking-contract` · `impl/p1b-company-custody-schema` ·
`impl/p1b-inventory-import-mapping` · `impl/p1b-employee-truck-crosswalk` ·
`docs/p1b-reference-authority-census` · `night/p2e-scheduling-union` ·
`auto/control/firebase-exit-1fdef0b7-20260911T202025Z`

Plus the **32 `impl/w1-*` branches**, all 32 proven ancestors of `64008d5a` and recorded in
[`../atlas/ATLAS-BASE-2026-09-12-A.md`](../atlas/ATLAS-BASE-2026-09-12-A.md) — 33 merge commits, zero
squashes.

## 11. Evidence branches — not correctness candidates, not to be lost

Zero code files; these are the run's findings. Listed so that classifying them as "not integration
material" does not read as "discard."

`phase3/operational-reality-evidence` (8) · `emp/own-synthesis` (25) ·
`archaeology/recovered-design-evidence` (67) · `night/p3b3-activities-sales` (14) ·
`post/p3-wf-registry` (3) · `night/p3d-workflow-registry` (3) · `rpt/p0-blast-radius` (3) ·
`atlas/eng-impl-reporting-company-scope` (2) · `atlas/p3arch-source-unavailable` (2) ·
`post/p3-fb-census` (2) · `night/p3b1-activities-service` (2) · `night/p3b2-activities-inventory` (2) ·
`emp/accountability` · `emp/experience` · `emp/information` · `emp/performance` · `emp/role-map` ·
`emp/work-matrix` · `own/design-reconciliation` · `own/e2e-census` · `post/p3-mig-reality` ·
`night/p2b1-runtime-census` · `night/p2b2-rules-browser` · `night/p2b3-functions-transport` ·
`night/p2c3-nonprod-readiness` · `night/p2d-decision-ledger` · `night/p3a1-archaeology-service` ·
`night/p3a2-archaeology-inventory` · `night/p3a3-archaeology-sales` · `night/p3c-design-master-brief` ·
`phase2/firebase-retirement-census` · `phase2/nonprod-activation-readiness`

Four extension lanes were writing when this register was compiled and are therefore not classified
here: `ext/own-decision-packet`, `ext/own-engineering-gap`, `ext/ux-honest-absence`, `ext/ux-kpi-drill`.

---

## 12. Totals

| Class | Branches |
|---|---|
| INTEGRATION A1 — normal correctness | **12** |
| INTEGRATION A2 — guard / migration / environment authority | **4** (one residue-only, 2 files) |
| TIER-2 HOLD — Owner decision | **2** |
| SUPERSEDED — do not merge | **5** |
| DISCARDED | **1** |
| ABSORBED — proven ancestors | **8** + the 32 `impl/w1-*` |
| Evidence-only | **32** + 4 in flight |

**16 branches carry code that `main` does not have and should.** Two more carry code `main` should
probably have but cannot receive without an Owner ruling.

## 12.1 REPORTING IS ACTIVATED IN PRODUCTION — a withdrawal, and a raised risk on A1-12

Surfaced by the UX-KPI-DRILL lane. Two lanes reached opposite conclusions on it, so every link was
re-verified here, at `64008d5a`, before anything was written down.

**The program held two contradictory positions on this at once, and neither was right.** In conversation
and in the reporting-closure posture it said reporting stays fail-closed in production. In the canonical
run handoff (`docs/atlas/run-verdict-2026-09-13.md` §A.3, `C8`, §D, §J) it said the 25 are **live in
production, flatly** — and called Reporting "the only production-activated family." The first is false.
The second overshoots in the other direction: activation is established by source and configuration, and
deployment by dated committed evidence, but *reachability today* is not established by either. The
correct standing is narrower than both. The chain that **is** verified:

| # | Link | Verified |
|---|---|---|
| 1 | The environment named `taylor-parts-production` declares **25** `productionCapabilityActivations`, all `report.*` | `:679` — counted, all 25 match `report.*` |
| 2 | Its `role` is `"production"`, so the production authority applies | `:667`, gate at `:748` |
| 3 | Each declared id must pass `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` | `:755`. That set holds **exactly 25** entries and the 25 declared ids are exactly those. **25 of 25 survive; none dropped** |
| 4 | The resolver **prefers** the production set over the non-production one | `:774` (see §12.2) |
| 5 | The report engine passes the resolved set into the permission resolver | `reportExecutionService.ts:273` |
| 6 | Presence of the id **suppresses the `active: false` deny** | `resolveEffectivePermission.ts:264` |
| 7 | `runReportDefinitionCallable` is **deployed and ACTIVE** in `projects/taylor-parts` | committed `gcloud functions describe` output: `docs/audits/functions-live-state/2026-07-21/function-describes/runReportDefinitionCallable.json` → `state = ACTIVE`, `environment = GEN_2`, `updateTime 2026-07-21T05:07:33Z`. Also present in `docs/audits/sandbox-provisioning-20260806/prod-functions.json` |

**A comment in shipped code is wrong about the code it annotates.**
`reportExecutionService.ts:271-272` reads *"Production carries no overrides, so Reporting stays
fail-closed there until a separate activation ruling."* Production carries **25** overrides. The
environment registry's own comment at `:83-85` states the opposite of the program's position and is the
correct one: *"production ACTIVATION was never reviewed, and `runReportDefinitionCallable` is already
deployed there."*

**What is left standing after the deny is lifted** is only the ordinary Role/Scope/Condition/accessVersion
check, which `resolveEffectivePermission.ts` leaves unchanged — so a lifted capability with no qualifying
grant still denies. But `ADMIN_ALL_PERMISSIONS` (`compatibilityRoles.ts:235`) spreads the whole catalogue
onto `admin`. **So a reachable-by-admin path for reporting in production is a live possibility, not a
theoretical one.**

**One qualification on the principal, because this program has overstated it.** The committed census
`be1e5579` reports `totals.roleAssignments: 2` but **itemises only one** — `admin@global`, `employeeId:
null` — because its listing is scoped to a manager-exposure query. **The second assignment is identified
nowhere.** So "zero governed-business-role occupancy" is supportable and "the single production principal
is `admin@global`" is **not**: it is one of two, and the other is **UNPROVEN**. The census is also dated
**2026-09-02** and was not re-read live. The reachable set cannot be closed while one of two production
assignments is unidentified.

**Withdrawn:** "reporting stays fail-closed in production" and the unqualified "nothing is reachable in
production." The second was always about *commercial* surfaces and stays true of those; stated without
that qualifier it is false, because reporting is reachable and reporting reads customer data.

**Consequence for this register: A1-12 is the highest-risk merge in the sequence, not merely the last.**
`rpt/client-outcome-honesty` changes the behaviour of the one family a production caller can actually
reach. Its A1-12 position stands — the test-registration ratchet must be in place first — but it must be
reviewed as a production-reachable behaviour change, not as a test-honesty cleanup.

**Two live defects recorded, not fixed, and not covered by any candidate:**
`coverageReadCallables.ts:59-60` takes a **caller-supplied `companyId` as the query scope with no
membership check**, and `:72-74` returns `status: "ready"` with zero rows for **every thrown error** —
"no rows for that company" as a response to a failure, which is the exact false-empty the standing
invariant forbids. Latent today: `coverage.read` is inactive and not production-activated. And
`createOpportunity` spreads attacker-controlled `request.data` (`opportunityCallables.ts:228`), so
`operatingCompanyId` flows unchecked into a downstream finance authorization key.

**UNPROVEN, and it is the load-bearing gap.** Deployment rests on committed snapshots dated **2026-07-21**
and **2026-08-06** — real observations by a credentialed operator, not static source reading, but **not
re-verified in this run and now weeks old.** A function deployed then may have been deleted since.
Whether a report has ever actually been *run* in production is also unproven, as is whether
`effectiveAccessFeed.ts` passes the production activation set to the client. **No production contact was
made and none is authorized.** The correct standing is: *activated and deployed on the strength of dated
committed evidence, awaiting live re-verification* — not *proven reachable today*.

## 12.2 Activation composition is a PREFERENCE, not a union

`environmentCapabilityOverrides.ts:774` — `cachedOverrides = production.size > 0 ? production : nonProduction;`

The comment at `:770-771` calls it a union: *"The union is therefore a statement of intent, not an
overlap to reason about."* **It is a ternary.** If the production set is non-empty the non-production set
is **discarded entirely**, not merged. That is harmless today only because the registry happens to
populate one field per environment — a fact about the registry's contents, not an invariant the code
enforces.

This program has said throughout that the two fields *"compose"*. **That word is withdrawn**; it implies
a union and the code implements precedence.

Two further corrections while verifying it, both affecting figures quoted all run:

- **The resolver keys on `projectId`, not the environment name** (`:742`). The environment *named*
  `taylor-parts-production` carries `firebase.projectId: "taylor-parts"` (`:667`). "25 entries on
  `taylor-parts-production`" describes the record correctly and the lookup key incorrectly.
- **There is a third gate, previously unrecorded.** Production activation passes
  `role === "production"` (`:748`), **then** the `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` allowlist (`:755`),
  **then** the preference (`:774`). A declared-but-ineligible id is silently dropped. Today 25 of 25
  survive, so the gate is invisible — which is exactly how it would be missed if it ever bit.

## 12.3 Triage of four newly reported defects — three shrink under verification

Triage only, as instructed: classify and assign, **do not implement everything merely because it was
discovered.** Each was re-read at `64008d5a` before being written down, and three of the four turned out
to be materially smaller than reported. That is the point of triaging before implementing.

| # | Reported | Verified | Class | Assigned |
|---|---|---|---|---|
| A | `opportunityCallables.ts:228` — attacker-controlled `request.data` spread influences `operatingCompanyId` in a finance authorization key | **SUBSTANTIALLY WRONG** — see §12.3.A | **AUTHORITY GAP**, narrow | **DEFERRED** |
| B | `coverageReadCallables.ts` — caller-supplied `companyId` scopes the query; returns `status:"ready"` + zero rows on failure | **HALF WRONG** — the `"ready"` half is false; the scope half is real | **LATENT** + **AUTHORITY GAP** | **DEFERRED** (capability inactive) |
| C | `operatingCompanyAuthority.ts` — `resolveOperatingCompany` returns `INACTIVE`, `deriveCompanyOwner` discards it | **CONTESTED** — discarding may be deliberate policy | **MODEL GAP** | **OWNER DECISION** (folds into OD-6) |
| D | `inventoryCapabilityParityHarness.js` — ambient ADC binding | **CONFIRMED** | **TEST/HARNESS SAFETY** + **AUTHORITY GAP** | **A2-3** (already sequenced) |

### 12.3.A The spread is real; the injection is not

`opportunityCallables.ts:228` does spread caller data — `buildCreateOpportunity({ ...data, inheritedOwner }, …)`.
Two things blunt it. `inheritedOwner` is appended **after** the spread, so a caller cannot override it. And
`operatingCompanyId` does not pass through raw: `opportunityCommands.ts:175` routes it through
`resolveCommercialCompanyScope`, which at `commercialCompanyScope.ts:59-72` resolves the value against the
governed operating-company registry and **throws `CommercialCompanyScopeError` for anything not governed** —
with the message *"It is never inferred from the account owner, the salesperson, lineOfBusiness, or a
display name."*

**So arbitrary values cannot reach the authorization key.** The claim as reported is withdrawn.

**What remains is real but much narrower:** the resolver validates that the company **exists and is
governed**, not that **this caller is entitled to it**. A caller may therefore book an Opportunity to any
governed operating company, including one they have no relationship with. With two companies in the
registry the blast radius is one alternative. **DEFERRED** — it is an entitlement question, not an
injection, and it belongs with the company-scope authority work rather than in a correctness merge.

### 12.3.B The honest half, and the real half

The reported *"`status:"ready"` with zero rows for every thrown error"* is **false.** The handler's `catch`
returns **`status: "unavailable"`** with an empty array, and the truncation branch at `:64-66` likewise
returns `"unavailable"` with the comment *"A bounded resolver must never label a truncated result as
complete."* **That is the standing invariant being honoured, not violated** — and it is a pattern worth
copying to the surfaces that do violate it, so it is recorded here as a **positive control**, not a defect.

The real half stands: `:51` requires a `companyId` from `request.data` and `:58` uses it directly as
`where("companyId", "==", data.companyId)` with **no membership or entitlement check**. A caller who names
another company's id reads that company's coverage assignments. **LATENT** — `coverage.read` is inactive and
not production-activated, so no caller can reach it today. Classified separately from live defects, as
instructed. It must not be activated before the check exists.

### 12.3.C Discarding `INACTIVE` may be the policy, not a bug

`commercialCompanyScope.ts:63-68` **deliberately accepts `INACTIVE`**, and gives a sound reason: *"a record
booked to a company that has since been deactivated still landed on that company's books, and rejecting it
would rewrite history to tidy a registry."* That is the same standing principle as *historical stays
historical*.

So there are two readings and this register picks neither:

- **Defect** — `deriveCompanyOwner` (`typedOwner.ts:137-143`) throws away a distinction
  `resolveOperatingCompany` computed (`operatingCompanyAuthority.ts:54,80`), so the census cannot see that an
  owner's company is deactivated.
- **Policy** — discarding is *consistent with* `commercialCompanyScope.ts:63-68`: company ownership is
  deliberately existence-checked, not activity-checked, for the same historical-integrity reason.

**And there are FOUR sites that accept `INACTIVE`, not one — the fourth by a different mechanism, which is
why it was missed.** `typedOwner.ts:206` re-checks a COMPANY owner as
`resolveOperatingCompany(value.id).company === null`. An INACTIVE company **has** a company object, so it
**passes** — the acceptance is a side effect of testing for existence by null-check rather than an explicit
`state === "INACTIVE"` branch. So the "policy" reading is stronger than §12.3.C first credited: the
behaviour is consistent across four sites. But it is **emergent at this one**, not declared, which is a
different thing from deliberate — and it is the site the census actually dispatches for stored owners.

Both readings are carried. **This is an OD-6 input, not an engineering fix**, because the whole question OD-6
asks is what a resolver owes the census about an owner's current validity — and the answer for the person
axis should not be chosen while the company axis's answer is undecided. **Do not "fix" this before OD-6.**

### 12.3.D Confirmed, already placed

`inventoryCapabilityParityHarness.js` takes no project or environment argument and binds Firestore from
ambient ADC — see §7.1. Already **A2-3**; nothing further to assign.

**None of A–D is implemented, and none is authorized.**

## 13. What this register does NOT establish

- **That any A1 or A2 branch still passes.** Every "EXECUTED (own lane)" grade is evidence from that
  lane's own tree at its own base. After rebase onto `64008d5a` each must be **re-proven**, unpiped —
  a test run read through `| tail -3` reports the exit code of `tail`, which this program has already
  got wrong once and acted on.
- **Re-proof IS possible. A claim in an earlier revision of this section said it was not, and that claim
  was wrong.** It said *"no Linux worktree has `node_modules` or `functions/lib`."* Re-counted across all
  107 worktrees: **43 have `functions/node_modules` (637 packages) and many have `functions/lib`.** The
  earlier survey sampled **8** — the newest ones, all created fresh from `64008d5a`, which is precisely
  why none of them had it — and generalised from that sample. **Same error class as §7.1's:** a static
  negative over an unrepresentative sample, stated as a fact about the whole. Twice in one register is a
  method problem, not bad luck: **a negative result needs its population justified before it is written
  down.**

  What *is* true: there is **no `java`**, so the Firestore emulator cannot start anywhere, and every
  emulator suite stays **NOT_RUN**.

  **The correct re-proof method, demonstrated by the REPORTING-RECONCILIATION lane rather than theorised:**
  `git archive` the ref under test into the scratchpad; symlink `node_modules` from an **idle** worktree
  whose dependency **and** devDependency sets are verified byte-identical to that ref; run `npm run build`
  so `functions/lib` is compiled **from the ref under test**; confirm `lib` is a real directory and its
  sources `diff`-identical to the ref; remove the symlink; confirm the lender intact. That yields a real
  execution with correct provenance, and it is the standard for every A1/A2 re-proof.

  **And one borrowing rule that is absolute.** `node_modules` may be borrowed from an idle checkout —
  dependencies are branch-independent apart from `package.json` drift. **`functions/lib` may never be
  borrowed.** It is compiled output of whatever branch produced it, and the `.mjs` suites import
  `../lib/**/*.js` directly, so a borrowed `lib` runs the test against another branch's compiled code and
  reports the result as the branch under test. That is precisely the branch-provenance failure this
  program has committed three times. `functions/lib` is **built on the ref under test, or absent.**
- **That the rebase exposure in §4 will not conflict.** It is a set intersection. It bounds risk; it
  does not simulate a merge.
- **That `operatorAccessCommand.js` and `productionFoundationVerification.js` are safe in every respect.** §7.1 proves only that each requires an explicit `--projectId` with no default and gates production behind an exact-match confirmation, read from source. Their *other* behaviour is not assessed here.
- **That `inventoryCapabilityParityHarness.js` would actually reach production.** §7.1 reads its argument parsing and its own documented credential contract; it was not executed, and no environment was contacted to find out what its ambient ADC would resolve to.
- **Whether the 71 PR candidates are open or closed-unmerged.** Needs the API. Still **UNPROVEN**.
- **The correct `firebaseExitGuard` baseline count** — 369 and 366 both appear in committed comments.
- **Any production state whatsoever.** Nothing here was executed against any environment.
