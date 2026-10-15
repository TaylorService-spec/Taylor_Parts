# Support-Readability Pilot: Work Orders (eosOps)

- **Date:** 2026-10-14
- **Base:** `origin/main` @ `fc8baf26`
- **Rubric:** [support-readability-rubric.md](../engineering/support-readability-rubric.md), revised with
  the pilot's feedback
- **Scope:** the 19 `functions/src/eosOps/workOrder*.ts` files, 5,823 lines. Migration tooling is
  excluded.
- **Method:** two `design-code-reviewer` agents each read half of the scope in full. I re-checked 8 of the
  S1 claims against the code and all 8 held. Findings only; nothing has been fixed.

## Verdict

The code itself is sound and its safety comments are often excellent. `workOrderRecordRead.ts` and
`workOrderNumbering.ts` are good models for the rest. The problem is what surrounds the rules:
- **Stale or false statements** a support engineer would act on.
- **Governance history** layered over the rules.
- **Copied constants and helpers** with nothing keeping them in sync.

About **half of the comment lines are noise**. The bigger risk is the S1 findings: comments that
contradict the code.

| Severity | Count | Examples |
|---|---|---|
| S1: Misleads | 12 | the cited test doesn't exist; the header describes a dead fail-closed path; the "replay returns original outcome" claim is false |
| S2: Blocks | 12 | the window-holding statuses are defined twice with no test; "own assignment" is borrowed from the Complete edge; helpers have drifted apart |
| S3: Slows | 10 | banners, Owner and Controller rulings, Firebase-port history, undefined codes |
| S4: Polish | 8 | import style, confusing names, unused destructures |

## S1 findings: fix first

| # | Location | Problem | Fix class |
|---|---|---|---|
| 1 | `workOrderPartsPlanAuthority.ts:54-58` | Claims `workOrderPartsPlanAuthority.test.mjs` pins the terminal statuses. **That test doesn't exist.** The list is one of four copies. | mechanical (comment) + structural (import `TERMINAL_STATUSES`) |
| 2 | `workOrderScheduling.ts:55-58`, `workOrderAvailability.ts:105-108` | Window-holding statuses are defined in both files. Each comment points at the other, and at symbols that exist only in the Firebase-era `workOrderAvailability.ts`. | structural |
| 3 | `workOrderLifecycle.ts:1-29, 97-106, 426-430` | The header presents `NOT_YET_IMPLEMENTED` as a live fail-closed answer, but no matrix rule uses it, so the branch and `dependsOn` are dead. | mechanical + structural |
| 4 | `workOrderLifecycle.ts:24-29, 125-137` | `inventoryBoundary` says completion consumes no stock. Truck consumption really happens in `workOrderExecution.ts`, and this string is returned to API callers. | structural (returned text) |
| 5 | `workOrderExecution.ts:20-21` | "A replay returns the original outcome" is false: it returns current totals with zero deltas and no movement ids. | mechanical |
| 6 | `workOrderAssignmentAuthority.ts:3-6` | The header lists a "record the transition" step that the code deliberately doesn't do (`:250-252`). | mechanical |
| 7 | `workOrderWriterState.ts:1-25` | Describes Firestore freeze/activation steps and says Equipment install isn't routed. Both are stale. | mechanical; file is a deletion candidate |
| 8 | `workOrderEquipmentInstall.ts:29` | "A MOBILE (truck) source fails closed", but `:59-62` allows MOBILE. | mechanical |
| 9 | `workOrderAvailability.ts:457` | A user-facing refusal message embeds "DECISION 5 … Firebase ND-20 warning is superseded". | structural (runtime text) |
| 10 | `workOrderAnalytics.ts:1-11` | Says the KPI definitions replace Firebase reads. The SQL here *is* the definition now. | mechanical |
| 11 | `workOrderQueries.ts:273` | `includeCompleted` actually means "include COMPLETED, not CLOSED", with a hard-coded list. | mechanical (comment) |
| 12 | `workOrderCreateCommand.ts:182` | Migration history appears in a user-visible error message. | structural (runtime text) |

## Patterns: these will repeat across the codebase

1. **Copies with no sync.** Status lists, time limits (60 s, 14 days, 500- and 2,000-character caps) and the
   schedulable-technician SQL are restated across files. Their pinning tests either don't exist or guard
   only the Firebase copy.
2. **Drifted helpers.** `ID_SHAPE` is defined in 21 surviving files. `refuse`, `personName` and the
   transaction wrapper are copied per file, and the copies differ: only some map Postgres `23505` to
   CONFLICT, and the category unions differ.
3. **Safety rules enforced but never stated (rubric §4):**
   - **Tenant scoping:** the tenant comes from the verified caller, never from input.
   - **Quarantine:** it is checked by hand in every command; a new command that forgets it silently
     touches quarantined records.
   - **Lock order:** the Work Order row lock, then the employee placement lock.
   - **Idempotency key scopes:** four different scopes, never compared side by side.
   - **Error categories:** what each one means to the caller, and which are retryable.
4. **History written against Firebase.** "Preserved from the Firebase process" and "Firebase parity"
   sections become meaningless after the exit.
5. **Findability is fine.** It takes 2–4 hops from `eosOpsHttp.ts` to the logic. The one obstacle is an
   eight-arm ternary in `eosOpsHttp.ts:899-938`, repeated twice.

## Estimate for the full fan-out

**Surviving scope:** 1,390 files, about 288k lines (all source minus Firebase-importing files and
migration tooling). The pilot is 2% of it.

The pilot cost about 270k agent tokens for 5.8k lines, roughly 47 tokens per line. Reviewing everything at
pilot depth would cost about 13.5M tokens, which isn't worth it. Use three tiers instead:

| Tier | What | Scope | Cost |
|---|---|---|---|
| **A: Scripted scan** | Banner lines (1,231), bare codes (486), ruling/authorization bookkeeping (541), Firebase mentions in surviving code (934), duplicated helpers | all 288k lines | minutes, near-zero tokens; produces the mechanical fix list directly |
| **B: Deep review** | The API (`eosOps`, `adminPolicy`, `access`, `eosAuth`, `eosWorkforce`, finance/commercial/catalog) plus client `domain/`, `access/`, `services/` | about 150k lines, about 15 agents of about 10k lines each | about 7M tokens, about 30–40 min wall clock in parallel |
| **C: Sampled review** | Client UI `modules/`, `hooks/`, `shared/`, `metadata/` | about 100k lines, 10% sample in 2–3 agents | about 0.5M tokens; extend only where the sample shows S1s |

**Expected yield:** at the pilot's rate (about 7 findings per 1,000 lines), tier B produces about 1,000
findings, about 300 of them S1. That is too many to act on one by one, so fixes would go in this order:
1. **S1 comment corrections**, one PR per domain (mechanical, low risk).
2. **Scripted noise removal:** banners, bookkeeping, Firebase history. This can run mostly unattended
   once the Firebase exit for each domain is done.
3. **Structural PRs**, each with tests proving unchanged behavior: shared `eosOps` helper module,
   constant consolidation, dead-path removal, `workOrderAvailability.ts` split.
4. **Runtime-message changes**, which alter API text and so need UI and test checks.

**Sequencing:** run tier A and the tier B review now; findings are cheap and don't go stale quickly. But
schedule step 2 for each domain *after* its Firebase retirement lands, so the comments aren't rewritten
twice.
