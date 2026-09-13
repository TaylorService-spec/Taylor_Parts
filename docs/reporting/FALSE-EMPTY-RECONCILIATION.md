# FALSE-EMPTY RECONCILIATION — `reportExecutionService.ts` kind ladder

**Lane:** REPORTING-RECONCILIATION · **Mode:** EVIDENCE_WRITE · **Branch:** `ext/reporting-reconcile` (off `64008d5a`)
**Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (`origin/main`)
**Question:** does the reporting remediation chain make the *false claim about data* impossible, or only add honest states elsewhere while leaving the `rowCount === 0` ordering intact?

## VERDICT: **PARTIALLY FIXED**

The chain closes the **completeness/truncation** flavour of the false empty structurally and provably.
It does **not** touch the ordering on the **authorization/scope** axis. The kind ladder is
**byte-identical at `64008d5a` and at `8e28e32d`**, and the gate the chain inserted in front of it
consults exactly two inputs — `scanTruncated` and `rowCount`. Every authorization and tenancy fact is
either ranked *below* the zero-row branch or not ranked at all.

## 1. Refs — verified, not assumed

| Ref | SHA | Relation to `8e28e32d` |
|---|---|---|
| `origin/main` (baseline) | `64008d5ae0bdd9532909671b15a91122400accf1` | strict ancestor |
| `origin/rpt/reporting-remediation` | `8e28e32d31cd2e6be485010a1d827bd834316d10` | — (remote custody) |
| `rpt/client-outcome-honesty` (local) | `8e28e32d31cd2e6be485010a1d827bd834316d10` | **identical SHA — confirmed** |
| `rpt/false-empty-and-audit` | `8521cd8823897a407ffcb34064797a0ac2d5f061` | strict ancestor — superseded |
| `post/eng-e-report-scope` | `92db1d19cef179f8b6acf965e4fb7db38f5e6cc0` | strict ancestor — superseded |
| `night/p2h-report-scope-bound` | `d1491997eb321cc4ad1dc25afef6ccf4b87edbcd` | **not an ancestor** — independent |

Chain, oldest first (`git log origin/main..8e28e32d`): `92db1d19` → `b8308e48` → `5d8193fb` →
`510eba1c` → `8521cd88` → `9d3ab48d` → `d65be79c` → `8e28e32d`.
`reportRowScope.ts`: 358 lines on `post/eng-e-report-scope` and `8e28e32d`; **236** on
`night/p2h-report-scope-bound` — the brief's line counts are correct.

## 2. The ordering, located on each ref (line numbers moved; the logic is the same)

| Ref | Location | Is `rowCount === 0` still tested FIRST? | Is scope/completeness evaluated BEFORE it? |
|---|---|---|---|
| `64008d5a` (baseline) | `functions/src/reporting/reportExecutionService.ts:627-634` | **Yes** | **No.** Nothing precedes the ladder. |
| `night/p2h-report-scope-bound` | `reportExecutionService.ts:784-791` | **Yes** | **No.** No absence gate, no `completeness` field. Row scope only. |
| `post/eng-e-report-scope` | `reportExecutionService.ts:842` | **Yes** | **No.** |
| `rpt/false-empty-and-audit` | `reportExecutionService.ts:972` + gate at `:930` | **Yes** | **Completeness only** (`judgeAbsenceProvenance` at `:201-207`). |
| `8e28e32d` (remediation head) | `reportExecutionService.ts:971-978` + gate at `:930` | **Yes — identical text** | **Completeness only.** |

The ladder at `8e28e32d:971-978`:

```ts
  const kind: RunReportOutcomeKind =
    rowCount === 0
      ? "empty"
      : droppedColumnLabels.length > 0
        ? "partially-authorized"
        : truncated || widened
          ? "truncated-widened"
          : "results";
```

The gate in front of it, `8e28e32d:930`:

```ts
  if (judgeAbsenceProvenance({ scanTruncated, rowCount }) === "refuse-unproven-absence") {
```

and the judge itself, `8e28e32d:201-207`:

```ts
export function judgeAbsenceProvenance(input: {
  scanTruncated: boolean;
  rowCount: number;
}): AbsenceVerdict {
  if (input.rowCount > 0) return "not-an-absence";
  return input.scanTruncated ? "refuse-unproven-absence" : "proven-absence";
}
```

`droppedColumnLabels`, `droppedPredicateFieldIds`, `refusedJoinObjectIds`, `rowScopeKind` and
`companyReach` are **not parameters of the judge** and are **not consulted anywhere before the
ladder**.

## 3. What the chain actually closed

| Flavour of false empty | Status at `8e28e32d` | Mechanism |
|---|---|---|
| **Scan truncation** — matching rows beyond the bounded page | **CLOSED, structurally** | `UnprovenAbsenceError` thrown at `:943` before the `"applied"` audit event and before the ladder; a throw cannot lose a single-winner ranking contest. `completeness`/`scanTruncated` published as orthogonal fields (`:988-989`). Client grew an `empty-unproven` display state (`reportResultState.js:134-142`) driven by `populationVerdict()` (`:88-99`), which fails conservatively. |
| **Join refused on ownership grounds** (`refusedJoinObjectIds`) | **OPEN in code, UNREACHABLE today, and PINNED** | `joinRelatedDocs` refuses an `unsupported` related collection (`:1157-1160`); `getFieldValue` then returns `undefined` (`:563-567`) and a surviving `eq` filter drops every row (`matchesFilter`, `:1017`). Not caught by the predicate-drop rule, because the **field** is authorized — its **collection** is what is unbounded. Unreachable only because `employee` is the sole `unsupported` join target and `REPORT_FIELDS` declares no `employee.*` field. Pinned by `functions/test/reportFalseEmptyHonesty.test.mjs:350`. |
| **Company-bound related document dropped from a join** | **OPEN in code, UNREACHABLE today** | `documentSatisfiesCompanyBound` drop at `:1189-1192`, same silent-narrowing consequence. Unreachable because every join target (`accounts`, `contacts`, `locations`) is `company-neutral` — asserted at `reportRowScopeBound.test.mjs:429-433`, with the structural shape pinned at `:562`. |
| **Authorization-narrowed column drop + zero rows** | **OPEN, REACHABLE, UNTESTED before this lane** | See §4. |
| **Tenancy bound + zero rows** | **OPEN, REACHABLE, UNTESTED** | See §4. |

The chain **knew** about the join flavour and wrote its own latent tripwire for it. That is real
engineering, and the reconciliation should not be read as accusing it of blindness. But `:350`'s own
rationale is **incomplete** — see §5.

## 4. The residual, recorded from a real run **ON BRANCH `8e28e32d`**

Definition: `equipment`, `fields: ["equipment.name","equipment.status"]`,
`filters: [{ fieldId: "equipment.name", op: "eq", value: "NO-SUCH-EQUIPMENT" }]`.
Runner `u-taylor`, roles = the 25 production-activated `report.*` ids **minus**
`report.equipment.field.status.read`, `maxScanDocs: 50`. Harness: `functions/test/support/reportEngineHarness.mjs`.

Server outcome:

```json
{ "kind": "empty", "rowCount": 0, "droppedColumnLabels": ["Status"],
  "droppedFieldIds": ["equipment.status"], "completeness": "proven-complete",
  "scanTruncated": false, "truncated": false, "widened": false,
  "rowScopeKind": "company-bound", "companyReach": ["taylor"], "refusedJoinObjectIds": [] }
```

Client descriptor, from `field-ops-app-vite/src/domain/reporting/reportResultState.js` at the same ref:

```json
{ "kind": "empty", "tone": "info", "role": "status", "title": "No matching records",
  "message": "This report ran successfully but no records matched.", "notes": [] }
```

Two authorization facts are lost to the single-winner collapse and are invisible to the reader:

1. **A column was dropped.** `droppedColumnLabels: ["Status"]` — the report that ran was not the
   report that was saved. `"partially-authorized"` would have said so with a note; `"empty"` outranks
   it and the `empty` branch emits `notes: []`.
2. **The answer is bounded to one operating company.** `rowScopeKind: "company-bound"`,
   `companyReach: ["taylor"]`. At `64008d5a` the base query carried **no `where()` at all**
   (`reportExecutionService.ts` pre-ENG-E: `db.collection(object.collection).limit(maxScanDocs + 1)`),
   so `"empty"` then meant "nothing in the collection matched" — a genuinely wider claim. ENG-E
   correctly narrowed the population server-side (`8e28e32d:790-793`) **but the `empty` sentence did
   not change**, and the `empty` branch reads neither `rowScopeKind` nor `companyReach`. The
   qualification ENG-E introduced is never surfaced.

**Reachability in production.** Reporting is the one domain with production activation, so this is the
one reachable instance. Verified at baseline: `config/environments.json:303` declares
`productionCapabilityActivations`; `functions/src/access/environmentCapabilityOverrides.ts:679-705`
holds **25** ids, all `report.*`; **all 25** survive the `PRODUCTION_ACTIVATION_ELIGIBLE_IDS`
allowlist at `:52` filtered at `:755` (derived: the two sets are set-equal, 25 = 25, empty symmetric
difference); the production set is **preferred over** the non-production set at `:774`; consumed at
`reportExecutionService.ts:273`; the `active: false` deny is suppressed at
`resolveEffectivePermission.ts:264`. The 25 include the four object reads but **exclude ten sensitive
field reads**, so a saved definition selecting one of those is column-dropped in production — exactly
the fixture above.

### Does the *false claim about data* become impossible?

**No — and yes, with the distinction that matters.**

- For the **truncation** flavour the data lie is **structurally impossible**: `rowCount === 0` can no
  longer reach `"empty"` out of a cut population, because the throw precedes the ladder and neither
  `rowCount` nor `scanTruncated` is reassigned in between (pinned at
  `reportFalseEmptyHonesty.test.mjs:331-344`).
- For the **authorization** flavour the data lie is **not closed by the ordering**. It is closed
  **contingently**, by catalog facts — no `employee.*` field exists, every join target is
  `company-neutral`, `serviceHistory` declares no fields — with two tripwires and one unguarded class
  (§5). Change the catalog and the data lie returns; the ladder will not stop it.
- In its **reachable** form today the residual is an **availability** omission, not a data lie: with
  zero rows the absence itself is real, so `"no records matched"` is true about the rows while silently
  false about *which report ran* and *over what population*. This is precisely the second outcome the
  brief warned about — **honest states added alongside an ordering left intact** — with the important
  correction that the chain documented the gap rather than hiding it.

**The standing invariant is not yet fully satisfied.** "EOS MUST NOT REPRESENT UNPROVEN ABSENCE AS
PROVEN EMPTY" holds against *truncation*. It does not yet hold against *authorization-narrowed
absence*, whose non-occurrence rests on catalog accident.

### The fix is one reorder, and the client already handles it

Mutation-tested in the scratchpad (see §6): hoisting `droppedColumnLabels.length > 0` above
`rowCount === 0` produces `kind: "partially-authorized"`, and
`reportResultState.js`'s existing `partially-authorized` branch (`:206-234`) emits the note
*"Columns you can't view were left out: Status."* with **no client change at all**. Whoever fixes this
needs one server line and the inverted assertion in the new test. The tenancy half (2) needs a
decision, not just a reorder: either the `empty` branch reads `rowScopeKind`/`companyReach`, or the
message is reworded to be scope-honest for every company-bound report.

## 5. Corrections and new findings

| # | Finding | Evidence |
|---|---|---|
| C1 | **Brief correction.** `reportingActivationBoundary.test.mjs:77-79` asserting false production fail-closure is **LIVE AT BASELINE only**. `ON BRANCH 8e28e32d` it is **fixed** by `510eba1c`: the test now resolves through `resolveRuntimeCapabilityOverrides()` with `GCLOUD_PROJECT` pinned (`:112-116`), keeps the old resolver only "to assert the blind spot itself" (`:117-119`), and pins the true posture id-by-id (`PRODUCTION_ACTIVE_REPORT_IDS`, `:123+`). Not fixed in this lane, per instruction. | baseline `functions/test/reportingActivationBoundary.test.mjs:74-89` vs `8e28e32d:60-135` |
| C2 | **Brief confirmed, and the chain corrects it.** Baseline `reportExecutionService.ts:267-272` claims *"Production carries no overrides, so Reporting stays fail-closed there"* — false. `8e28e32d:430-438` replaces it with *"The reporting family IS production-activated. Reporting is NOT fail-closed in production by activation, and this service must not be written as though it were."* | both refs, cited lines |
| C3 | **Brief confirmed.** `rows` is `null` on every aggregate run: `resultRows = []` (`64008d5a:584`), `projectedRows = null` (`:601-603`), returned as `rows: projectedRows` (`:639`). Unchanged at `8e28e32d:891, 908-910, 983`. **It does make the ordering worse:** on a grouped/aggregate run `rowCount` counts *group* rows with no row set beside it, so a consumer has nothing to cross-check `rowCount === 0` against. Mitigated at `8e28e32d` only for the aggregate case, and by a *different* gate — `judgeScanCompleteness` refuses an aggregate over a cut scan at `:809`, before the absence gate is reached. A **grouped but aggregate-free** zero-group run still reaches the ladder (the chain's own `EQUIPMENT_RETIRED_GROUPED_DEF` reproduction, `reportFalseEmptyHonesty.test.mjs:178`). |
| C4 | **Brief confirmed.** `reportRunOutcome.js:27` ships *"Running reports isn't available yet. Nothing was read or changed."* at baseline; it survives at `8e28e32d:113`, correctly — it is the honest not-deployed state, not this defect. |
| **N1** | **NEW — the unrecorded join skips.** `joinRelatedDocs` (`8e28e32d:1148-1160`) records a refusal in `refusedJoinObjectIds` **only** for `relatedRowScope.kind === "unsupported"`. Three earlier `continue`s — `!relationship` (`:1149`), `!toObject?.collection` (`:1151`), `!viaField` (`:1153`) — skip the join and record **nothing**. `REPORT_OBJECTS` declares a null-collection object **today**: `obj("serviceHistory", "Service History", null, 2, false, …)` at `reportCatalog.ts:92`. A surviving filter on such a related field would drop every row and the outcome would carry **no trace at all** — strictly worse than the refusal flavour that *is* pinned, because even `refusedJoinObjectIds` would be empty. `reportFalseEmptyHonesty.test.mjs:350`'s rationale — *"`employee` is the only related object whose collection has no governed bound"* — is therefore **incomplete**: `serviceHistory` has no collection at all and is skipped one branch earlier, before any recording can happen. Unreachable today only because `serviceHistory` is not a relationship target **and** declares no fields (two barriers); `employee` has one barrier (the relationship `customer->employee` via `customer.accountOwner` **exists**, `reportCatalog.ts:209`; only the `employee.*` field is missing). Now pinned — see §6 test 5. |
| **N2** | **NEW — `night/p2h-report-scope-bound` addresses none of this** and carries substantial unrelated churn (scheduling `availabilityModel.ts`/`schedulingCommands.ts`, metadata `stockLocation.js`, admin-policy seed snapshots; 43 files, +2084/−1289 vs baseline). Its ladder at `:784-791` is the baseline ladder verbatim, it publishes `operatingCompanyReach` (not `companyReach`) and no completeness axis. **Merge collision risk**, not a source of the fix. |

## 6. Test decision — §4

**A test was warranted and one was added.** The chain already tests the ordering against
*completeness*; it does **not** test it against *authorization*, and the reachable case in §4 was
uncovered.

**Existing chain tests, reported by name rather than duplicated:**

| Test | File:line | What it already covers |
|---|---|---|
| `RATCHET: the absence gate stands BEFORE the kind ladder and before the 'applied' Audit Event` | `functions/test/reportFalseEmptyHonesty.test.mjs:303` | gate ordering |
| `RATCHET: the 'empty' branch of the kind ladder is unreachable unless absence was proven` | `reportFalseEmptyHonesty.test.mjs:331` | `"empty"` reachable only for proven absence (truncation axis) |
| `LATENT: no catalog field exists on a join-refused object, so a refused join cannot manufacture an absence YET` | `reportFalseEmptyHonesty.test.mjs:350` | the **recorded** refused-join flavour |
| `reportRowScopeForCollection` classification + join-drop structure | `functions/test/reportRowScopeBound.test.mjs:429-433, 560-568` | every join target is `company-neutral`; the drop/refuse shape |

**New file:** `functions/test/reportEmptyLadderAuthorizationOrdering.test.mjs` — 5 tests.
Two are **CHARACTERIZING** (they assert the current, unfixed behaviour and are *expected to fail* when
the ordering is fixed — stated in the file); three are ratchets/tripwires, including N1.

**Written against `8e28e32d`, not runnable at `64008d5a`** — the baseline has no
`reportEngineHarness.mjs`, no `reportRowScope.ts`, and no `completeness`/`companyReach`/
`refusedJoinObjectIds` on `RunReportOutcome`. It is committed on `ext/reporting-reconcile` as a
reconciliation artifact and must be grafted onto the remediation chain, plus registered in
`.github/workflows/report-execution-service-tests.yml` (one `node --test` path per file, per that
workflow's own stated rule — that file is outside this lane's surface).

### Execution — real, unpiped

**Provenance.** `functions/lib` was **built from the ref under test**, never borrowed:
`git archive 8e28e32d functions config firebase.json field-ops-app-vite/src/domain/reporting` extracted
to the scratchpad, `node_modules` symlinked from the **idle** worktree `p2c1-parity` (637 packages;
its `functions/package.json` dependency + devDependency sets are **byte-identical** to `8e28e32d`'s),
then `npm run build` (`tsc`) in the extracted tree — exit 0. `functions/lib` was a **real directory**,
not a symlink. Source verified identical to `8e28e32d` (`diff` clean) before the recorded run. Symlink
removed afterwards; lender verified intact (637 packages, clean `git status`).

```
$ node --test test/reportEmptyLadderAuthorizationOrdering.test.mjs test/reportFalseEmptyHonesty.test.mjs
ok 1 - CHARACTERIZING (unfixed): an AUTHORIZATION-NARROWED zero-row run is still headlined "empty", and the reader is told nothing
ok 2 - CHARACTERIZING (unfixed): the tenancy bound is equally invisible on the same outcome
ok 3 - judgeAbsenceProvenance() is a COMPLETENESS judge: no authorization or tenancy fact can change its verdict
ok 4 - RATCHET: the absence gate is passed only the completeness pair, and the ladder still ranks rowCount first
ok 5 - TRIPWIRE: every relationship target has a backing collection and a declared via-field, so no join can be skipped without being recorded
... (tests 6-22: the chain's own reportFalseEmptyHonesty.test.mjs, unchanged)
# tests 22
# pass 22
# fail 0
UNPIPED EXIT=0
```

All 22 subtests are named in the output, so both path arguments were genuinely picked up — not
silently dropped by `node --test`'s union resolution.

**Mutation check — the test is not a guard that passes either way.** With the ladder hoisted in the
scratchpad copy to `droppedColumnLabels.length > 0 ? "partially-authorized" : rowCount === 0 ? "empty" : …`
and rebuilt, **3 of 5 flip to fail**:

```
not ok 1 - ... + 'partially-authorized'  - 'empty'   (ERR_ASSERTION)
not ok 2 - ... Expected values to be strictly equal: 1 !== 0   (the client now emits one note)
ok   3
not ok 4 - ... the authorization branch still sits BELOW the zero-row branch
ok   5
# tests 5 / # pass 2 / # fail 3
```

The mutation was reverted and the source re-verified identical to `8e28e32d` before the recorded run
above. No product source was modified on `ext/reporting-reconcile`.

## 7. UNPROVEN

- **Emulator-dependent suites were not run:** `functions/test/reportExecutionService.test.mjs` and
  `functions/test/savedDefinitionCommands.test.mjs`. No `java` on this machine, so the Firestore
  emulator cannot start. The chain records the same limitation
  (`reportFalseEmptyHonesty.test.mjs:59-62`).
- **No production or deployed-runtime observation.** Every production claim in §4 is a **source and
  configuration** reading of `config/environments.json` and
  `functions/src/access/environmentCapabilityOverrides.ts` at `64008d5a`. Whether any saved definition
  in the `taylor-parts` production project actually selects one of the ten non-activated sensitive
  fields is **UNPROVEN** — it was not and must not be checked from this lane.
- **Client rendering was proven at the descriptor level only** (`describeRunOutcome`), not through
  `ReportBuilder`'s `ResultArea` JSX. The chain's own comment
  (`reportResultState.js:135-138`) asserts the routing consequence; that routing was not executed here.
- **No capability ALLOW count is quoted.** The only count used is 25 = 25 (adopted vs eligible
  `report.*` ids), derived by set-comparing `productionCapabilityActivations`
  (`environmentCapabilityOverrides.ts:679-705`) with `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` (`:52+`):
  both 25, symmetric difference empty. Method stated; no method-mixing.
- **`origin/rpt/reporting-remediation` was read from the local ref.** No `git fetch` was issued, so the
  remote could have advanced since this repository last fetched.
