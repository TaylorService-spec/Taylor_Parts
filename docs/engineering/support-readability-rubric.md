# Support-Readability Rubric

The standard for reviewing and writing EOS code so that a **support engineer who has never seen this
repository** can make a safe change. It applies to code that survives the Firebase exit: the EOS API
(`functions/src/eos*`, `adminPolicy`, `access`, `finance`), the client's `domain/`, `modules/`, `hooks/`
and `services/`, and the PostgreSQL migrations. It does not apply to Firebase-era code that the retirement
ledgers are deleting.

**The test for every comment, name and file:** if the reader has only this file, the code it imports, and
its tests, can they tell what it does, what must stay true, and where to change it? Anything that doesn't
help with that is noise, however accurate it is.

## 1. Comments: keep the rules, drop the story

| Keep (signal) | Remove or move (noise) |
|---|---|
| **Invariants**: what must stay true and what breaks if it doesn't ("all status writes go through `applyTransitionWithinTransaction`") | **History narration**: how the code got here, earlier designs, "previously…", "was moved from…" |
| **Why a non-obvious choice was made**, in one or two sentences | **Governance bookkeeping**: authorization names, Owner rulings, package IDs, dates, PR/Decision/issue numbers in prose |
| **Domain meaning** a newcomer can't guess (what `READY_TO_DISPATCH` means to a dispatcher) | **Restating the code** ("loops over rows", "returns the result") |
| **Fail-closed behavior and its reason** | **Deployment state** ("DEPLOYED_NOT_CALLED", "not deployed to production"): this goes stale the day it's written |
| **One link** to the governing decision, when the rule is policy rather than code: `// Policy: DECISIONS.md #179` | **Defensive essays**: paragraphs arguing that a design is right, or that an alternative was considered |
| A `TODO(owner-or-issue)` with a concrete exit condition | **References to code that no longer exists or is being retired** (Firebase files, removed callables) |

History belongs in `DECISIONS.md`, commit messages and PR descriptions. Code says what is true *now*.

- **A bare code is never an explanation.** `DQ-015`, `ND-18`, `H20` and similar codes must be replaced by
  the rule in words; a `Policy: DECISIONS.md #N` link may follow, but it doesn't stand alone.
- **Don't define things against a system being retired.** "Nothing here reads Firestore" and "the Firebase
  version did X" mean nothing after the exit. State the current rule instead.
- **Retiring references.** A pointer to a file on a Firebase retirement ledger is noise. A pointer to a
  live file must be correct; if it marks a mirror, see §3.
- **Not-yet-activated states are fine** when they are part of the runtime contract, as long as the comment
  names the exit condition (what flips, and where).
- **Governance text in runtime messages** (error messages, API strings shown to users) is always S1.

**Shape:** a module header of at most about 10 lines covering the module's purpose and what it must never
do, optionally followed by a short **Invariants** bullet list, which doesn't count toward the cap. A
fail-closed rationale may be longer; put it next to the line it protects. Banner art (`════`), all-caps
headings and multi-screen headers count as noise. Per-function comments are only for contracts the
signature can't express.

## 2. Names and vocabulary

- One name per concept across the client, the API and SQL. A status, capability or table has one spelling
  everywhere; a restated list must be pinned to its source by a test.
- Names describe the business action (`scheduleWorkOrder`), not the governance process
  (`governedAuthorityCommandCommit`). Words like "governed", "authority" and "canonical" in a name must add
  meaning a reader can act on.
- Codes and abbreviations (`DQ-015`, `ND-18`) must be defined where they are used, or replaced by a word.

## 3. Structure

- **One home per rule.** Logic duplicated between client and server, or across modules, is a finding.
  Name which copy is the source and which is a mirror, and name the test that keeps them in sync. **A
  mirror with no pinning test is S2.**
- **Shared helpers.** A helper copied into three or more files (`ID_SHAPE`, `refuse`, transaction
  wrappers) converges into one shared module. Copies that have already drifted apart are S2, because a
  reader can't tell whether the differences are deliberate.
- **File size**: over about 600 lines needs a reason; over 1,000 is a finding. Split along business
  actions, not along layers.
- **Entry points are findable.** From the HTTP handler to the function holding the business logic should
  take three hops or fewer: count each function or dispatch table the reader must open, handler included.
  The route table should say where each operation lives.
- **No dead paths**: unused exports, unreachable branches or dispositions, flags that are always on or off,
  and "kept for compatibility" code with no consumer. Evidence is a consumer search across `src`,
  `scripts` and tests. Removal is always a structural fix.

## 4. Safety a support engineer must not miss

These are never "noise", and if they are missing that is a finding:
- authorization and tenant (operating company) checks, and where they are enforced
- transaction boundaries and the single-writer rules
- idempotency and retry behavior on commands
- what each error code means to the caller
- lock order, when more than one lock is taken
- the test that proves an invariant, named by its path (tests live in `functions/test/`, not beside the
  source). A comment that cites a test which doesn't exist is S1.

## 5. Finding format and severity

Each finding names the file and line range, the rubric section, and the concrete fix.

| Severity | Meaning |
|---|---|
| **S1: Misleads** | A comment or name says something false or stale; a reader would make a wrong change. |
| **S2: Blocks** | A support engineer can't safely change this without asking someone (missing invariant, duplicated rule, unfindable entry point). |
| **S3: Slows** | Noise that costs reading time but misleads nobody (history narration, banners, restated code). |
| **S4: Polish** | Naming and consistency nits. |

**Fix classes.** *Mechanical* fixes delete or shorten comments or rename locals; behavior is unchanged and
the existing tests prove it. *Structural* fixes move, split or deduplicate code; they need their own PR,
with tests showing identical behavior.

## For AI-assisted work

New code follows this rubric. Agents record history in `DECISIONS.md` and PR text, never in code comments.
