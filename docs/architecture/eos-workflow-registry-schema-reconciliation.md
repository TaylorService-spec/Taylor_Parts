# Schema reconciliation — the three activity libraries and the workflow registry

Companion to [`eos-workflow-registry.md`](./eos-workflow-registry.md). Lane **P3-D**.

The three Phase-3 activity libraries hold 1,010 activities between them and use **three different
schemas** with **three different vocabularies**. This note records how they map onto one another and
onto the registry, so that the mapping is a decision someone can disagree with rather than a silent
coercion.

The short version: the libraries agree about far more than their field names suggest, they disagree
about one thing that matters enormously, and one library's central field conflates two axes that the
registry has to split apart again.

---

## 0. The libraries

| Lane | Files | Activities | Stories | Key style | Activity id style |
|---|---|---:|---:|---|---|
| **P3-B1** Service + Technician | `docs/scenarios/day-in-the-life/service-technician.{md,json}` | 330 | 33 | `camelCase` | `P3B1-S01-A01` |
| **P3-B2** Inventory · Warehouse · Purchasing · Scanner | `docs/scenarios/day-in-the-life/inventory-warehouse-purchasing.{md,json}` | 330 | 33 | `snake_case` | `S01-A01` |
| **P3-B3** Sales · CRM · Financial · Administration · Management · Adversarial | `docs/activities/p3b3-*.json` (6 files) + one `.md` | 350 | — (blocks, not stories) | `snake_case` | `P3B3-SALES-001` |

**The first reconciliation problem is identity.** P3-B2's ids carry no lane prefix — `S01-A01` is
ambiguous against P3-B1's `P3B1-S01-A01` once the libraries are read together. **The registry
namespaces every P3-B2 reference as `P3B2-S01-A01`.** That is a rewrite of the source id, done
consistently and recorded here; nothing in P3-B2 itself was changed.

**The second is shape.** P3-B1 and P3-B2 are story-first: 33 narrative arcs of 10 activities each,
so the story is already workflow-shaped. P3-B3 is block-first: six thematic blocks of atomic acts
with no narrative spine, but with a `crosses_into` field on 40 activities that does the same job by
another route. The registry's workflows were derived from the 66 stories where they existed, and
assembled from P3-B3's blocks, `trigger` fields and `crosses_into` edges where they did not.

---

## 1. Field-by-field mapping

| Concept | P3-B1 | P3-B2 | P3-B3 | Registry |
|---|---|---|---|---|
| Activity id | `activityId` | `activity_id` (no lane prefix) | `id` | `supporting_activities[]`, P3-B2 namespaced |
| Parent | `storyId`, `storyTitle`, `sequence` | `story_id` | *(block, from the file)* | the workflow record itself |
| Title | `title` | `title` | `title` | — |
| Who | `persona` + `role` (snake_case system role) | `persona` + `role` (Title Case job) | `actor_role` (Title Case job) | `actors[]` |
| Company | `operatingCompany` | `operating_company` | *(absent; in `narrative`)* | not carried; company handling is a workflow-level fact |
| Customer context | `accountContext` | `customer_account_context` | *(in `narrative`)* | not carried |
| Starting state | `startingRecordsAndState` | `starting_records_state` | *(in `narrative`)* | not carried |
| Why | `businessPurpose` | `business_purpose` | `trigger` + `narrative` | `trigger` |
| Preconditions | `preconditions` (array) | `preconditions` (string) | *(in `narrative`)* | encoded in `steps[]` order |
| The act | `action` | `action` | `narrative` | `steps[].step` |
| Expected state change | `expectedEosStateTransition` | `expected_eos_state_transition` | *(in `narrative`)* | not carried |
| Authority | `expectedAuthorityCapability` (prose) + `evidence[]` | `expected_authority_capability` (prose) + `evidence[]` | `authority_path` (prose with `file:line`) | `authority_path`, `steps[].authority` |
| Objects | *(implicit in evidence)* | *(implicit in evidence)* | `objects_touched[]` | `objects_touched[]` |
| UI expectation | `expectedUiResult` | `expected_ui_result` | — | not carried |
| Audit expectation | `expectedAuditResult` | `expected_audit_result` | — | not carried |
| Cross-object effect | `expectedCrossObjectEffect` | `expected_cross_object_effect` | `crosses_into` | the registry's **seams** (§4 of the registry) |
| Failure behaviour | `exceptionRecoveryBehaviour` | `exception_recovery_behaviour` | — | feeds `break_point` |
| Device | `deviceContext` | `device` | — | named in `steps[].surface` where it matters |
| Coverage tags | `coverageCategories[]` (20 tokens) | `coverage[]` (22 tokens) | — | not carried — see §3 |
| AI opportunity | `aiOpportunityClassification` (6 tokens) | `ai_opportunity` (5 tokens) | — | not carried — see §3 |
| Help | `helpOpportunity` | `help_info_opportunity` | — | not carried |
| Friction | `frictionScore` (11 camelCase keys) | `scores` (11 snake_case keys) | — | not carried — see §3 |
| Reset | `resetReplayNotes` | `reset_replay_notes` | — | not carried |
| Did it run | `executionResult` (10-token enum, **all 330 = `NOT_RUN`**) | `execution_status` (`NOT_RUN`/`RUN`, **all 330 = `NOT_RUN`**) | `status` (7-token enum; 42 are `EXECUTED_PASS`/`EXECUTED_FAIL`) | `evidence_status` |
| Why it failed | `executionResult` (same field, different half of the enum) | `execution_result` (9-token enum, **null on all 330**) | `blocking_mechanism` | `blocking_mechanism` + `break_point` |
| Could it run | `fullActivityExecutability` + `fullActivityBlocker` + `coreAssertionMode` | `executability` | — | not carried — see §4 |
| Claim type | `behaviourClaim` (`CURRENT` 321 / `DESIRED` 9) | — | — | every registry record is a CURRENT claim |
| Defects | `defectsThisWouldCatch` (158 assertions) | — | — | feeds `break_point` |
| Owner question | — | — | `owner_question` (71 raisings → 58 consolidated) | `owner_questions[]` |
| Evidence | `evidence[]` of `"path:line — CURRENT: …"` | `evidence[]`, same shape | inline in `authority_path` | `authority_path`, re-verified at `64008d5ae0bdd9532909671b15a91122400accf1` (574/574 citations resolve; 0 line numbers past EOF) |

---

## 2. The one disagreement that matters: what "executed" means

This is the reconciliation that a reader must not get wrong, because two of the three libraries carry
a field that **reads like** an execution result and is not one.

| Library | Field | Values | What it actually asserts |
|---|---|---|---|
| P3-B1 | `executionResult` | `NOT_RUN` on all 330 | Nothing was run. The library says so in its own `executionStatement`. |
| P3-B1 | `fullActivityExecutability` | `BLOCKED_BY_TEST_ENVIRONMENT` on all 330 | Nothing *could* be run end to end either. |
| P3-B1 | `coreAssertionExecutableToday` | true on **223** of 330 | A *unit-level* assertion could be written today. **Not a run.** |
| P3-B2 | `execution_status` | `NOT_RUN` on all 330 | Nothing was run. |
| P3-B2 | `executability` | `EXECUTABLE_TODAY` on **105** of 330 | A test *could* be written and run without the emulator. **Not a run.** |
| P3-B3 | `status` | `EXECUTED_PASS` 22, `EXECUTED_FAIL` 20 | 42 activities **were** run and their output recorded. |

**`EXECUTABLE_TODAY` is the trap.** It appears 105 times in P3-B2 and it means *"a test for this
could be written and run in this environment"*. It does **not** mean the activity was run, and it does
not mean the workflow works. A reader skimming P3-B2 for green rows will find 105 and conclude
something false. P3-B2 is not at fault — its `execution_status` field says `NOT_RUN` on every one of
the same 330 rows — but the two fields sit far apart in the record and only one of them looks like a
verdict.

**The registry's rule.** `evidence_status: EXECUTED` requires that *something was run and its output
recorded*. Mapping:

```
P3-B1  executionResult NOT_RUN                       -> TRACED   (all 330)
P3-B1  coreAssertionExecutableToday true              -> TRACED   (a capability claim, not a run)
P3-B2  execution_status NOT_RUN                       -> TRACED   (all 330)
P3-B2  executability EXECUTABLE_TODAY                 -> TRACED   (a capability claim, not a run)
P3-B3  status EXECUTED_PASS | EXECUTED_FAIL           -> EXECUTED (42)
P3-B3  status IMPLEMENTED_UNEXECUTED | PARTIAL |
              BLOCKED | NOT_SUPPORTED                 -> TRACED
P3-B3  status DESIGNED_ONLY                           -> TRACED   (see §5)
```

A registry record is `EXECUTED` only where its break point rests on a capability resolution that was
actually run — by P3-B3, or re-run by this lane at the integrated head. Thirty-four of 86 qualify,
and each carries an `evidence_note` saying which half was run and which half was read.

---

## 3. Vocabularies that look different and are not

**Coverage: 20 tokens vs 22, but the same 20 concepts.** P3-B2 splits two of P3-B1's composite tokens:

| P3-B1 | P3-B2 |
|---|---|
| `BACK_BUTTON_ABANDONED_FLOW` | `BACK_BUTTON` + `ABANDONED_FLOW` |
| `RETRY_IDEMPOTENCY` | `RETRY` + `IDEMPOTENCY` |

The other eighteen are identical strings. **Nothing else differs.** Neither taxonomy is better; the
split one is more precise and the composite one matches how the scenarios were actually written. The
registry carries neither, because a workflow's coverage is the union of its activities' coverage and
that union is uninformative at workflow granularity.

**Friction: identical concepts, different case.** Both libraries carry the same eleven scored
dimensions — `had_to_hunt_for_information`, `unnecessary_explanation_occupying_page`,
`help_missing_when_needed`, `ai_could_materially_shorten`, `ai_would_be_noise`,
`no_obvious_why_location`, `no_obvious_what_next_location`, `recovery_unclear`,
`role_handoff_unclear`, `operating_company_attribution_unclear`, `ownership_unclear` — P3-B1 in
`camelCase` under `frictionScore`, P3-B2 in `snake_case` under `scores`. A mechanical rename
reconciles them completely. P3-B3 carries none. Not carried into the registry.

**AI opportunity: two different axes, not two dialects of one.**

| P3-B1 (`aiOpportunityClassification`) | P3-B2 (`ai_opportunity`) | Relationship |
|---|---|---|
| `CLASSIFY`, `DRAFT`, `EXPLAIN`, `SHORTEN` | `AI_MATERIAL`, `AI_ASSIST_NARROW` | **No mapping.** P3-B1 classifies the *kind* of help; P3-B2 classifies its *strength*. A `SHORTEN` could be either `AI_MATERIAL` or `AI_ASSIST_NARROW` and the record does not say which. |
| `NOISE` | `AI_NOISE` | Direct. |
| `NONE` | `AI_NOT_APPLICABLE` | Direct. |
| *(no counterpart)* | `AI_UNSAFE_HERE` | **A real gap.** P3-B1 has no token for "AI must not be offered here", so its 330 service and technician activities cannot express the judgement P3-B2 makes 
in the warehouse. Given that the design grammar independently rules the Scanner and cycle count **Quiet** because *"suggestions would bias counts"*, the missing token is the one the service domain most needed. |

Reconciling these two would require re-judging 660 activities on a two-dimensional axis and is out of
this lane's scope. It is recorded so nobody attempts a lossy one-to-one map. **Recommendation: adopt
P3-B2's axis and add P3-B1's kind as a second, orthogonal field** — `{strength, kind}` — rather than
picking one.

---

## 4. Executability metadata: three schemes, no common ground

| Library | Fields | Granularity |
|---|---|---|
| P3-B1 | `fullActivityExecutability` (2 tokens), `fullActivityBlocker` (6 tokens: `UI_BROWSER` 226, `EMULATOR_CALLABLE` 39, `EMULATOR_RULES` 36, `EMULATOR_CALLABLE_PLUS_TRANSPORT` 12, `DEVICE_OFFLINE` 14, `MANUAL_CONFIGURATION` 3), `fullActivityBlockedReason`, `coreAssertionMode` (4 tokens), `coreAssertionExecutableToday`, `coreAssertionNote` | Splits the activity into a *full* run and a *core assertion*, and blocks them separately. The most careful of the three. |
| P3-B2 | `executability` (2 tokens) | One flag for the whole activity. |
| P3-B3 | — | No executability concept at all; `status` carries implementation state instead. |

**No common ground exists and none was invented.** P3-B1's two-level model is strictly more
expressive than P3-B2's one-level flag, and P3-B3's absence is not an omission — it measures a
different thing. The registry carries none of it. What it needed from this territory it took from
P3-B1's blocker tokens directly into prose: `EMULATOR_RULES` is why every `RULES_DENY` in the
registry is a reading, and `UI_BROWSER` is why no workflow is `WORKS_END_TO_END`.

---

## 5. P3-B3's `status` conflates two axes, and the registry splits them

This is the most consequential reconciliation in the note.

P3-B3's `status` has seven values on what looks like one scale:

```
EXECUTED_PASS  22    EXECUTED_FAIL  20    IMPLEMENTED_UNEXECUTED 141
PARTIAL        68    BLOCKED        64    NOT_SUPPORTED          26    DESIGNED_ONLY 9
```

They are not one scale. They answer two different questions at once:

| Value | *How do we know?* | *What state is the thing in?* |
|---|---|---|
| `EXECUTED_PASS` | run | works |
| `EXECUTED_FAIL` | run | does not work |
| `IMPLEMENTED_UNEXECUTED` | read | built |
| `PARTIAL` | read | partly built |
| `BLOCKED` | read | built and unreachable |
| `NOT_SUPPORTED` | read | not built |
| `DESIGNED_ONLY` | read | designed, not built |

Reading the histogram as a single scale produces a false impression in both directions: it makes
`IMPLEMENTED_UNEXECUTED` (40%) look like a middling outcome when it is an epistemic statement about
141 perfectly ordinary built things, and it hides that `EXECUTED_FAIL` and `BLOCKED` describe the
same *state* by two different *methods*.

**The registry splits the axes back apart:**

```
how do we know   ->  evidence_status   EXECUTED | TRACED | INFERRED
what state is it ->  state             WORKS_END_TO_END | WORKS_WITH_GAPS |
                                       BROKEN_MIDWAY | CANNOT_START | NO_IMPLEMENTATION
```

Mapping, at activity granularity (a workflow's `state` is the **worst** of its steps, not a vote):

| P3-B3 `status` | → `evidence_status` | → contributes to `state` |
|---|---|---|
| `EXECUTED_PASS` | `EXECUTED` | the step is reachable; does not by itself make a workflow whole |
| `EXECUTED_FAIL` | `EXECUTED` | `CANNOT_START` if it is step 1, else `BROKEN_MIDWAY` |
| `IMPLEMENTED_UNEXECUTED` | `TRACED` | `WORKS_WITH_GAPS` at best — never `WORKS_END_TO_END`, because nobody ran it |
| `PARTIAL` | `TRACED` | `WORKS_WITH_GAPS` or `BROKEN_MIDWAY`, by whether the path settles |
| `BLOCKED` | `TRACED` | `CANNOT_START` if it is step 1, else `BROKEN_MIDWAY` |
| `NOT_SUPPORTED` | `TRACED` | `NO_IMPLEMENTATION` if the whole path is absent, else `BROKEN_MIDWAY` |
| `DESIGNED_ONLY` | `TRACED` | `NO_IMPLEMENTATION` |

**The rule that makes the two axes independent:** an `EXECUTED_PASS` step does **not** promote a
workflow toward `WORKS_END_TO_END`. All **42** of P3-B3's executed rows (**22 PASS, 20 FAIL**) are
capability resolutions — they prove who may do a thing, never that the thing completes. That is why the
registry has **32** `EXECUTED` records and zero `WORKS_END_TO_END` ones, and the two facts are not in
tension.

Two cautions on that corpus, carried here so this mapping is not misread (**lane P3-WF, `64008d5ae0bdd9532909671b15a91122400accf1`**):
**968 of the 1,010 records are not executed, but only 660 carry the literal `NOT_RUN` token** — the 968
must never be described as `NOT_RUN`; and **34 of P3-B3's 118 recorded output lines are unanchored, and
are `INFERRED` rather than `EXECUTED`.** Neither fact demotes any registry record, because no record's
`authority_path` rests on a P3-B3 output line — but a lane mapping P3-B3 directly must apply both.

---

## 6. `blocking_mechanism`: the one vocabulary that carried over, and how it was cleaned

P3-B3 is the only library with a blocking vocabulary, and the registry adopts it. Two mechanical
differences:

1. **P3-B3's field is free text with the token as a prefix.** Of 79 non-null values, 8 are a bare
   token and 71 are `TOKEN — prose`, with the prose running to several hundred characters. The
   registry normalises on the prefix before the em dash and moves the prose into `break_point` and
   `blocking_note`, so the token is machine-comparable.
2. **P3-B3 records at most one mechanism per activity.** A workflow routinely has several. The
   registry keeps one `blocking_mechanism` — the mechanism that stops the path **first** — and puts
   the rest in `blocking_note`. Twenty-two of 86 records carry one. A reader who takes the mechanism
   histogram as a census of blockers will undercount.

Token counts, P3-B3 (79 citations) against the registry (86 workflows), **recomputed at `64008d5ae0bdd9532909671b15a91122400accf1`**:

| Token | P3-B3 | Registry |
|---|---:|---:|
| `CAPABILITY_INACTIVE` | 49 | 21 |
| `OWNER_DECISION_PENDING` | 15 | 15 |
| `SCHEMA_ABSENT_NONPROD` | 8 | 0 |
| `RULES_DENY` | 5 | 4 |
| `TRANSPORT_UNREACHABLE` | 2 | 1 |
| `NOT_GRANTED_TO_ANY_JOB` | 0 | 3 |
| `CLIENT_GATE_NEVER_REQUESTED` | 0 | 3 |
| `ENVIRONMENT_NOT_ACTIVATED` | 0 | 4 |
| `NO_CODE` | 0 | 35 |

The shape change is structural, not a disagreement. P3-B3's library is Sales/CRM/Finance/Admin, where
the dominant wall genuinely is an inactive capability; the registry adds Service, Inventory, Warehouse
and Scanner, where the dominant wall is that the next step was never written. `SCHEMA_ABSENT_NONPROD`
drops to zero because the one workflow it governs is stopped earlier by `TRANSPORT_UNREACHABLE` — the
schema absence is real and is recorded in that record's `blocking_note`.

**Three modes the vocabulary cannot express** were found while building the registry — client-side
readiness constants, objects whose permissions are not capability-expressible at all, and capabilities
named in code and absent from the catalog. They are set out in §5 of the registry with the records
they affect and a recommendation to extend the vocabulary.

**Vocabulary count, reconciled.** There are **seven distinct authority failure modes**: the
programme's established **four**, plus these **three**. This companion, the registry's §5 body and the
registry's §5 *heading* now all say three-plus-four; the heading previously said *"the two the
vocabulary cannot express"*, which contradicted its own table. **Corrected by lane P3-WF at
`64008d5ae0bdd9532909671b15a91122400accf1`.** `NOT_GRANTED_TO_ANY_JOB` is preserved as mode 4 and
remains live vocabulary (3 records).

---

## 7. Actor vocabulary: three naming systems over one set of jobs

| Library | Style | Distinct values | Example |
|---|---|---:|---|
| P3-B1 | snake_case system role | 8 | `service_coordinator`, `field_technician`, `after_hours_coordinator` |
| P3-B2 | Title Case job title | 14 | `Receiving Lead`, `Stocker/scanner operator`, `Branch Parts Coordinator` |
| P3-B3 | Title Case job title | 18 | `Accounting Manager`, `Office Manager`, `Report Viewer` |

**None of the three is the repository's own vocabulary.** At `64008d5ae0bdd9532909671b15a91122400accf1` the access
model declares **45 governed business roles** (`functions/src/access/governedBusinessRoles.ts`) and
**3 compatibility roles** (`admin`, `dispatcher`, `technician`, in `compatibilityRoles.ts`) — 48 in
total, all `camelCase` ids such as `inventoryCycleCountReconciler` and `serviceInboundWorkReviewer`.

Overlaps across the three libraries are partial and unreliable. `dispatcher` / `Dispatcher` is the
same job and the same governed id. `field_technician` / `Field Technician` / `Technician` is one job
under three names. `parts_counter` (P3-B1) and `Parts Associate` (P3-B2) probably are and are not
stated to be. `Stocker` and `Stocker/scanner operator` appear as separate values inside P3-B2 itself.

**The registry does not unify them.** `actors[]` uses the job title in business language and names
the governed role id in parentheses **only where a lane stated the correspondence** — for example
`Field Technician (field_technician)`, `Equipment Installer (equipmentInstaller)`. Where no lane
stated it, the registry uses the job title alone rather than guessing.

**This is a recorded refusal, not an omission.** Inferring a governed role id from a job title is the
same class of error as inferring a grant from a grep: the answer looks obvious and the resolver is the
only thing that knows. A persona-to-governed-role mapping is real work, it is an Owner-adjacent
decision (it determines who can do what), and it should be done once, deliberately, against the
resolver — not incidentally by a consolidation lane.

---

## 8. What was deliberately not carried into the registry

Recorded so nobody assumes it was lost rather than judged out of scope.

| Dropped | Why |
|---|---|
| `coverageCategories` / `coverage` | A workflow's coverage is the union of its activities'. The union is uninformative at workflow granularity, and the 20-vs-22 token split would have to be resolved for no gain. |
| `frictionScore` / `scores` | Eleven UX dimensions per activity. Genuinely valuable and a different product: they belong in a UX findings register, not a workflow map. |
| `aiOpportunityClassification` / `ai_opportunity` | The two axes do not map (§3). Carrying one would assert a reconciliation that does not exist. |
| `expectedUiResult`, `expectedAuditResult`, `helpOpportunity`, `resetReplayNotes` | Per-activity test-design detail. The registry's unit is the path. |
| `fullActivityBlocker`, `coreAssertionMode`, `executability` | Test-environment metadata, not business-path facts (§4). Their conclusions were carried into prose. |
| `behaviourClaim` | P3-B1 marks 9 of 330 as `DESIRED` rather than `CURRENT`. Every registry record is a CURRENT claim; the 9 desired-state activities informed break-point wording and support no state. |
| P3-B1's `defectsThisWouldCatch` (158 assertions) | Folded into `break_point` where the defect survives at the integrated head, and into §7 of the registry where it does not. |

---

## 9. Reconciliation defects found while doing this

Four things that only became visible by reading the three schemas side by side.

1. **P3-B2's activity ids are not globally unique.** `S01-A01` collides with P3-B1's story numbering
   space. Any future consolidation must namespace them; this one did.
2. **P3-B1 collapses execution *status* and execution *result* into one field.** `executionResult`
   holds `NOT_RUN` — a status — alongside `PASS`, `UX_GAP`, `AUTHORITY_GAP` and six other result
   classes. P3-B2 declares the same nine result tokens in `execution_result_vocabulary` and keeps
   status separate in `execution_status`. P3-B2's structure is the correct one; P3-B1's is the one
   with data in it.
3. **P3-B2's `execution_result` is declared and null on all 330 rows.** The vocabulary exists, the
   field exists, and nothing populates it. Harmless today; a consolidator who keys on it gets an empty
   set rather than an error.
4. **P3-B3's `blocking_mechanism` prose repeats itself verbatim across many records.** A 500-character
   boilerplate paragraph about the production activation set appears in roughly a dozen values. It is
   accurate every time and it means the field cannot be compared as a string. The registry compares
   the prefix token only.

---

*Lane P3-D. Documentation only. No activity library was modified. No runtime code changed.*
